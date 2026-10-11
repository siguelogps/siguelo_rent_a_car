// Módulo 3 · Reservas: calendario (Gantt), lista con filtros y Excel, cotizador, alta/edición, mover (arrastrar y soltar)
// con revisión de disponibilidad en transacción, cambios de estado y ficha completa de la reserva.
import express from 'express';
import ExcelJS from 'exceljs';
import { q, uno, transaccion, siguienteFolio } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { cotizar } from '../cotizador.js';
import { conflictos, vehiculosDisponibles } from '../disponibilidad.js';
import { lecturaActual } from '../gps/index.js';
import { tokenAleatorio } from '../cifrado.js';
import { diasArriendo, fechaHora } from '../util/formato.js';
import { formatearPatente, normalizarPatente } from '../util/patente.js';
import { cambiarEstado, recalcularEstadoVehiculo, MANUALES, NOMBRES } from '../reservas/estados.js';
import { SQL_LISTA, avisarConfirmada, urlPortal, documentoTxt } from '../reservas/datos.js';

const r = express.Router();
const ver = requiere('reservas', 'ver'), editar = requiere('reservas', 'editar');

const idDe = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ErrorHttp(404, 'Reserva no encontrada'); return n; };
const fechaValida = (v, campo) => { const d = new Date(v); if (!v || Number.isNaN(d.getTime())) throw new ErrorHttp(400, 'Fecha u hora inválida', { campo }); return d; };
const numOnull = (v) => (v === '' || v == null ? null : Number(v));
const mensajeConflicto = (c) => (c.tipo === 'reserva' ? `El vehículo ya está tomado por la reserva ${c.folio} (${fechaHora(c.inicio)} a ${fechaHora(c.fin)}).` : `El vehículo está bloqueado: ${c.motivo} (${fechaHora(c.inicio)} a ${fechaHora(c.fin)}).`);
// El manejador de errores del núcleo solo reenvía «campo»: los 409 de disponibilidad se responden aquí con el folio en conflicto.
const conConflicto = (fn) => async (req, res) => {
  try { return await fn(req, res); } catch (e) {
    if (e.estado === 409 && e.conflicto !== undefined) return res.status(409).json({ error: e.message, folio: e.folio ?? null, conflicto: e.conflicto });
    throw e;
  }
};
const errorConflicto = (c) => new ErrorHttp(409, mensajeConflicto(c), { conflicto: c.folio || c.motivo, folio: c.folio || null });

// ── Entrada del formulario → datos validados (cliente, categoría, sucursales, fechas, extras, conductores) ──
async function leerEntrada(E, b, ej) {
  const uno1 = async (sql, p) => (await ej.query(sql, p))[0] || null;
  const inicio = fechaValida(b.inicio, 'inicio'), fin = fechaValida(b.fin, 'fin');
  if (fin <= inicio) throw new ErrorHttp(400, 'La devolución debe ser posterior al retiro', { campo: 'fin' });
  const categoriaId = numOnull(b.categoria_id);
  let vehiculo = null;
  if (b.vehiculo_id) {
    vehiculo = await uno1('SELECT id, categoria_id, patente, estado, activo FROM vehiculos WHERE id = $1 AND empresa_id = $2', [Number(b.vehiculo_id), E]);
    if (!vehiculo || !vehiculo.activo) throw new ErrorHttp(400, 'Vehículo no encontrado', { campo: 'vehiculo_id' });
  }
  const catId = categoriaId || vehiculo?.categoria_id;
  if (!catId) throw new ErrorHttp(400, 'Elige la categoría', { campo: 'categoria_id' });
  const categoria = await uno1('SELECT id, nombre FROM categorias WHERE id = $1 AND empresa_id = $2', [catId, E]);
  if (!categoria) throw new ErrorHttp(400, 'Categoría no encontrada', { campo: 'categoria_id' });
  if (vehiculo && Number(vehiculo.categoria_id) !== Number(catId)) throw new ErrorHttp(400, 'El vehículo elegido no es de la categoría de la reserva', { campo: 'vehiculo_id' });
  const sr = numOnull(b.sucursal_retiro_id), sd = numOnull(b.sucursal_devolucion_id) || sr;
  for (const [s, campo] of [[sr, 'sucursal_retiro_id'], [sd, 'sucursal_devolucion_id']]) {
    if (!s) throw new ErrorHttp(400, 'Elige la sucursal', { campo });
    if (!(await uno1('SELECT 1 AS ok FROM sucursales WHERE id = $1 AND empresa_id = $2', [s, E]))) throw new ErrorHttp(400, 'Sucursal no encontrada', { campo });
  }
  let cliente = null;
  if (b.cliente_id) {
    cliente = await uno1('SELECT * FROM clientes WHERE id = $1 AND empresa_id = $2', [Number(b.cliente_id), E]);
    if (!cliente) throw new ErrorHttp(400, 'Cliente no encontrado', { campo: 'cliente_id' });
  }
  const extras = (Array.isArray(b.extras) ? b.extras : []).filter((x) => x && x.codigo && x.codigo !== 'conductor_adicional')
    .map((x) => ({ codigo: String(x.codigo), cantidad: Math.max(1, Math.min(10, Number(x.cantidad) || 1)) }));
  let conductores = [...new Set((Array.isArray(b.conductores) ? b.conductores : []).map(Number).filter(Boolean))];
  if (conductores.length) {
    if (!cliente) throw new ErrorHttp(400, 'Elige el cliente antes de los conductores adicionales');
    const ok = await ej.query('SELECT id FROM conductores WHERE empresa_id = $1 AND cliente_id = $2 AND id = ANY($3::bigint[])', [E, cliente.id, conductores]);
    conductores = ok.map((x) => Number(x.id));
  }
  const codigo = String(b.codigo_descuento || '').trim().toUpperCase() || null;
  return { inicio, fin, categoria, vehiculo, sr, sd, cliente, extras, conductores, codigo, notas: b.notas != null ? String(b.notas).slice(0, 2000) : undefined };
}

async function cotizarEntrada(E, d, ej) {
  const cot = await cotizar({ empresaId: E, categoriaId: d.categoria.id, inicio: d.inicio, fin: d.fin, sucursalRetiroId: d.sr, sucursalDevolucionId: d.sd,
    extras: d.extras, codigoDescuento: d.codigo, fechaNacimiento: d.cliente?.fecha_nacimiento || null, conductoresAdicionales: d.conductores.length }, ej.query === q ? null : ej);
  const avisos = [...cot.avisos];
  if (d.cliente?.lista_negra) avisos.unshift(`Cliente en lista negra: ${d.cliente.lista_negra_motivo || 'sin motivo registrado'}`);
  if (d.cliente?.licencia_vence && new Date(`${d.cliente.licencia_vence}T23:59:59`) < d.fin) avisos.push(`La licencia del cliente vence el ${d.cliente.licencia_vence.split('-').reverse().join('-')}, antes de la devolución.`);
  if (d.cliente && d.cliente.tipo === 'persona' && !d.cliente.licencia_vence) avisos.push('El cliente no tiene licencia registrada.');
  return { ...cot, avisos };
}

// ── Opciones para formularios y filtros ──
r.get('/reservas/opciones', ver, async (req, res) => {
  const E = req.empresaId;
  const [categorias, sucursales, extras, empresa] = await Promise.all([
    q('SELECT id, nombre, ejemplo, pasajeros, maletas, transmision FROM categorias WHERE empresa_id = $1 AND activa ORDER BY orden, nombre', [E]),
    q('SELECT id, nombre, ciudad FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id', [E]),
    q(`SELECT codigo, nombre, cobro, precio, tope, requiere_documento FROM extras WHERE empresa_id = $1 AND activo ORDER BY id`, [E]),
    uno('SELECT ajustes FROM empresas WHERE id = $1', [E])
  ]);
  res.json({ categorias, sucursales, extras, ajustes: empresa?.ajustes || {} });
});

// ── Calendario: vehículos, reservas y bloqueos del rango + indicadores ──
r.get('/reservas/calendario', ver, async (req, res) => {
  const E = req.empresaId;
  const desde = fechaValida(req.query.desde, 'desde'), hasta = fechaValida(req.query.hasta, 'hasta');
  if (hasta - desde > 62 * 864e5) throw new ErrorHttp(400, 'El rango máximo es de dos meses');
  const cat = numOnull(req.query.categoria_id), suc = numOnull(req.query.sucursal_id);
  const vehiculos = await q(`SELECT v.id, v.patente, v.marca, v.modelo, v.anio, v.estado, v.categoria_id, v.sucursal_id, c.nombre AS categoria, c.orden,
        EXISTS (SELECT 1 FROM reservas r WHERE r.empresa_id = v.empresa_id AND r.vehiculo_id = v.id AND r.estado = 'en_curso' AND r.fin < now()) AS atrasado
      FROM vehiculos v LEFT JOIN categorias c ON c.id = v.categoria_id
      WHERE v.empresa_id = $1 AND v.activo AND ($2::bigint IS NULL OR v.categoria_id = $2) AND ($3::bigint IS NULL OR v.sucursal_id = $3)
      ORDER BY c.orden NULLS LAST, c.nombre, v.patente`, [E, cat, suc]);
  const ids = vehiculos.map((v) => v.id);
  const reservas = await q(`${SQL_LISTA} WHERE r.empresa_id = $1 AND r.estado NOT IN ('cancelada','no_show') AND r.inicio < $3 AND r.fin > $2
      AND (r.vehiculo_id = ANY($4::bigint[]) OR (r.vehiculo_id IS NULL AND ($5::bigint IS NULL OR r.categoria_id = $5) AND ($6::bigint IS NULL OR r.sucursal_retiro_id = $6)))
      ORDER BY r.inicio`, [E, desde, hasta, ids, cat, suc]);
  const bloqueos = await q(`SELECT b.id, b.vehiculo_id, b.inicio, b.fin, b.motivo, ot.folio AS orden_folio FROM bloqueos b LEFT JOIN ordenes_trabajo ot ON ot.id = b.orden_trabajo_id
      WHERE b.empresa_id = $1 AND b.vehiculo_id = ANY($2::bigint[]) AND b.inicio < $4 AND b.fin > $3`, [E, ids, desde, hasta]);
  // Indicadores del día (hora de Chile)
  const hoy = `(now() AT TIME ZONE 'America/Santiago')::date`, local = (c) => `(${c} AT TIME ZONE 'America/Santiago')::date`;
  const k = await uno(`SELECT
      count(*) FILTER (WHERE estado = 'confirmada' AND ${local('inicio')} = ${hoy})::int AS retiros,
      count(*) FILTER (WHERE estado = 'en_curso' AND ${local('fin')} = ${hoy})::int AS devoluciones,
      count(*) FILTER (WHERE estado = 'en_curso' AND ${local('fin')} = ${hoy} AND sucursal_devolucion_id <> sucursal_retiro_id)::int AS devoluciones_otra,
      count(*) FILTER (WHERE estado = 'cotizacion' AND inicio > now())::int AS cotizaciones,
      count(*) FILTER (WHERE estado = 'cotizacion' AND inicio > now() AND inicio < now() + interval '48 hours')::int AS cotizaciones_48
    FROM reservas WHERE empresa_id = $1`, [E]);
  const retirosSuc = await q(`SELECT s.nombre, count(*)::int AS n FROM reservas r JOIN sucursales s ON s.id = r.sucursal_retiro_id
      WHERE r.empresa_id = $1 AND r.estado = 'confirmada' AND ${local('r.inicio')} = ${hoy} GROUP BY s.nombre ORDER BY n DESC LIMIT 1`, [E]);
  const atrasadas = await q(`SELECT r.id, r.folio, r.fin, v.patente FROM reservas r LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
      WHERE r.empresa_id = $1 AND r.estado = 'en_curso' AND r.fin < now() ORDER BY r.fin`, [E]);
  const flota = await uno(`SELECT count(*) FILTER (WHERE estado <> 'fuera_servicio')::int AS total,
      count(DISTINCT v.id) FILTER (WHERE EXISTS (SELECT 1 FROM reservas r WHERE r.empresa_id = v.empresa_id AND r.vehiculo_id = v.id AND r.estado = 'en_curso'))::int AS ocupados
    FROM vehiculos v WHERE v.empresa_id = $1 AND v.activo`, [E]);
  res.json({ vehiculos, reservas, bloqueos, kpis: { ...k, retiros_sucursal: retirosSuc[0] || null, atrasadas, flota } });
});

// ── Lista con filtros (y Excel) ──
function filtrosLista(req) {
  const E = req.empresaId, w = ['r.empresa_id = $1'], p = [E];
  const add = (sql, v) => { p.push(v); w.push(sql.replaceAll('?', `$${p.length}`)); };
  const est = String(req.query.estado || '').split(',').filter((x) => NOMBRES[x] || x === 'atrasada');
  if (est.includes('atrasada')) w.push(`(r.estado = 'en_curso' AND r.fin < now())`);
  else if (est.length) add('r.estado = ANY(?)', est);
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '')) add(`(r.inicio AT TIME ZONE 'America/Santiago')::date >= ?::date`, req.query.desde);
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '')) add(`(r.inicio AT TIME ZONE 'America/Santiago')::date <= ?::date`, req.query.hasta);
  if (req.query.sucursal_id) add('(r.sucursal_retiro_id = ? OR r.sucursal_devolucion_id = ?)', Number(req.query.sucursal_id));
  if (req.query.categoria_id) add('r.categoria_id = ?', Number(req.query.categoria_id));
  if (req.query.cliente_id) add('r.cliente_id = ?', Number(req.query.cliente_id));
  if (req.query.vehiculo_id) add('r.vehiculo_id = ?', Number(req.query.vehiculo_id));
  const t = String(req.query.q || '').trim();
  if (t) {
    add(`(r.folio ILIKE ? OR (c.nombre || ' ' || coalesce(c.apellidos,'')) ILIKE ? OR c.documento ILIKE ?`, `%${t}%`);
    const np = normalizarPatente(t);
    if (np.length >= 3) { p.push(`%${np}%`); w[w.length - 1] += ` OR v.patente ILIKE $${p.length})`; } else w[w.length - 1] += ')';
  }
  return { where: w.join(' AND '), p };
}

r.get('/reservas', ver, async (req, res) => {
  const { where, p } = filtrosLista(req);
  const limite = Math.min(Number(req.query.limite) || 300, 1000);
  res.json(await q(`${SQL_LISTA} WHERE ${where} ORDER BY r.inicio DESC LIMIT ${limite}`, p));
});

r.get('/reservas/excel', ver, async (req, res) => {
  const { where, p } = filtrosLista(req);
  const filas = await q(`${SQL_LISTA} WHERE ${where} ORDER BY r.inicio LIMIT 5000`, p);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Síguelo Rentacar';
  const ws = wb.addWorksheet('Reservas', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Folio', key: 'folio', width: 11 }, { header: 'Estado', key: 'estado', width: 15 }, { header: 'Cliente', key: 'cliente', width: 30 },
    { header: 'Documento', key: 'documento', width: 15 }, { header: 'Teléfono', key: 'telefono', width: 15 }, { header: 'Patente', key: 'patente', width: 10 },
    { header: 'Vehículo', key: 'vehiculo', width: 22 }, { header: 'Categoría', key: 'categoria', width: 14 }, { header: 'Retiro', key: 'inicio', width: 17 },
    { header: 'Sucursal retiro', key: 'sr', width: 18 }, { header: 'Devolución', key: 'fin', width: 17 }, { header: 'Sucursal devolución', key: 'sd', width: 18 },
    { header: 'Días', key: 'dias', width: 6 }, { header: 'Total (CLP)', key: 'total', width: 13, style: { numFmt: '"$"#,##0' } }, { header: 'Origen', key: 'origen', width: 10 }
  ];
  for (const x of filas) ws.addRow({ folio: x.folio, estado: x.atrasada ? 'Atrasada' : NOMBRES[x.estado], cliente: x.cliente, documento: documentoTxt(x.documento_tipo, x.documento), telefono: x.telefono,
    patente: x.patente ? formatearPatente(x.patente) : '', vehiculo: x.marca ? `${x.marca} ${x.modelo}` : '', categoria: x.categoria, inicio: fechaHora(x.inicio), sr: x.sucursal_retiro,
    fin: fechaHora(x.fin), sd: x.sucursal_devolucion, dias: diasArriendo(x.inicio, x.fin), total: Number(x.total), origen: x.origen });
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD500' } };
  ws.autoFilter = { from: 'A1', to: 'O1' };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="reservas-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.end(Buffer.from(await wb.xlsx.writeBuffer()));
});

// ── Cotizador y vehículos disponibles ──
r.post('/reservas/cotizar', ver, async (req, res) => {
  const d = await leerEntrada(req.empresaId, req.body, { query: q });
  res.json(await cotizarEntrada(req.empresaId, d, { query: q }));
});

r.get('/reservas/disponibles', ver, async (req, res) => {
  const inicio = fechaValida(req.query.inicio, 'inicio'), fin = fechaValida(req.query.fin, 'fin');
  const lista = await vehiculosDisponibles(req.empresaId, { inicio, fin, categoriaId: numOnull(req.query.categoria_id), excluirReservaId: numOnull(req.query.excluir) });
  const cats = Object.fromEntries((await q('SELECT id, nombre FROM categorias WHERE empresa_id = $1', [req.empresaId])).map((c) => [c.id, c.nombre]));
  res.json(lista.map((v) => ({ id: v.id, patente: v.patente, marca: v.marca, modelo: v.modelo, anio: v.anio, color: v.color, km: v.gps_km ?? v.km, combustible: v.gps_combustible ?? v.combustible_nivel,
    estado: v.estado, sucursal_id: v.sucursal_id, categoria_id: v.categoria_id, categoria: cats[v.categoria_id] })));
});

// ── Alta ──
r.post('/reservas', editar, conConflicto(async (req, res) => {
  const E = req.empresaId, b = req.body;
  const estado = b.estado === 'confirmada' ? 'confirmada' : 'cotizacion';
  const reserva = await transaccion(async (tx) => {
    const d = await leerEntrada(E, b, tx);
    if (!d.cliente) throw new ErrorHttp(400, 'Elige o crea el cliente', { campo: 'cliente_id' });
    if (d.cliente.lista_negra) throw new ErrorHttp(409, `No se puede reservar: el cliente está en lista negra. Motivo: ${d.cliente.lista_negra_motivo || 'sin motivo registrado'}`);
    if (estado === 'confirmada' && !d.vehiculo) throw new ErrorHttp(400, 'Elige un vehículo para confirmar la reserva', { campo: 'vehiculo_id' });
    if (d.vehiculo) {
      await tx.query('SELECT id FROM vehiculos WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [d.vehiculo.id, E]);
      const c = await conflictos(E, d.vehiculo.id, d.inicio, d.fin, { cx: tx });
      if (c.length) throw errorConflicto(c[0]);
    }
    const cot = await cotizarEntrada(E, d, tx);
    const folio = await siguienteFolio(E, estado === 'confirmada' ? 'R' : 'C', tx);
    const origen = ['counter', 'portal', 'agencia', 'telefono'].includes(b.origen) ? b.origen : 'counter';
    const [nueva] = await tx.query(`INSERT INTO reservas (empresa_id, folio, estado, cliente_id, vehiculo_id, categoria_id, sucursal_retiro_id, sucursal_devolucion_id, inicio, fin,
        extras, conductores, codigo_descuento, cotizacion, total, km_incluidos, precio_km_extra, garantia, deducible, origen, token_portal, notas, creado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [E, folio, estado, d.cliente.id, d.vehiculo?.id || null, d.categoria.id, d.sr, d.sd, d.inicio, d.fin, JSON.stringify(d.extras), JSON.stringify(d.conductores),
        cot.descuento ? d.codigo : null, JSON.stringify(cot), cot.total, cot.km_incluidos, cot.precio_km_extra, cot.garantia, cot.deducible, origen, tokenAleatorio(18), d.notas || null, req.usuario.id]);
    if (estado === 'confirmada') {
      await recalcularEstadoVehiculo(tx, E, nueva.vehiculo_id);
      if (nueva.codigo_descuento) await tx.query('UPDATE descuentos SET usos = usos + 1 WHERE empresa_id = $1 AND upper(codigo) = upper($2)', [E, nueva.codigo_descuento]);
    }
    await tx.query('INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [E, req.usuario.id, 'reserva_creada', 'reserva', nueva.id, JSON.stringify({ folio, estado, total: cot.total }), req.ip]);
    return { ...nueva, avisos: cot.avisos };
  });
  if (estado === 'confirmada') await avisarConfirmada(E, reserva.id).catch((e) => console.error('aviso reserva_confirmada', e.message));
  res.status(201).json(reserva);
}));

// ── Ficha ──
r.get('/reservas/:id', ver, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const reserva = await uno(`SELECT r.*, u.nombre AS creado_por_nombre, u.rol AS creado_por_rol FROM reservas r LEFT JOIN usuarios u ON u.id = r.creado_por WHERE r.id = $1 AND r.empresa_id = $2`, [id, E]);
  if (!reserva) throw new ErrorHttp(404, 'Reserva no encontrada');
  const [cliente, vehiculo, categoria, sr, sd] = await Promise.all([
    reserva.cliente_id ? uno('SELECT * FROM clientes WHERE id = $1 AND empresa_id = $2', [reserva.cliente_id, E]) : null,
    reserva.vehiculo_id ? uno(`SELECT v.*, c.nombre AS categoria FROM vehiculos v LEFT JOIN categorias c ON c.id = v.categoria_id WHERE v.id = $1 AND v.empresa_id = $2`, [reserva.vehiculo_id, E]) : null,
    uno('SELECT * FROM categorias WHERE id = $1 AND empresa_id = $2', [reserva.categoria_id, E]),
    uno('SELECT * FROM sucursales WHERE id = $1 AND empresa_id = $2', [reserva.sucursal_retiro_id, E]),
    uno('SELECT * FROM sucursales WHERE id = $1 AND empresa_id = $2', [reserva.sucursal_devolucion_id, E])
  ]);
  const idsCond = (reserva.conductores || []).map(Number).filter(Boolean);
  const [conductores, documentos, pagos, contratos, bitacora, salidas, liquidacion, stats, conductoresCliente] = await Promise.all([
    idsCond.length ? q('SELECT * FROM conductores WHERE empresa_id = $1 AND id = ANY($2::bigint[]) ORDER BY id', [E, idsCond]) : [],
    reserva.cliente_id ? q(`SELECT id, entidad, entidad_id, tipo, nombre, mime, meta, creado_en, subido_por FROM archivos WHERE empresa_id = $1
        AND ((entidad = 'cliente' AND entidad_id = $2) OR (entidad = 'conductor' AND entidad_id = ANY($3::bigint[]))) ORDER BY creado_en DESC`, [E, reserva.cliente_id, idsCond]) : [],
    q('SELECT id, concepto, metodo, estado, monto, monto_capturado, monto_liberado, referencia, autorizacion, tarjeta, vence_retencion, detalle, creado_en FROM pagos WHERE empresa_id = $1 AND reserva_id = $2 ORDER BY creado_en', [E, id]),
    q('SELECT id, folio, estado, codigo_verificacion, firmado_en, firmante_nombre, pdf_archivo_id, token_firma, token_firma_vence, creado_en FROM contratos WHERE empresa_id = $1 AND reserva_id = $2 ORDER BY id DESC', [E, id]),
    q(`SELECT b.id, b.accion, b.detalle, b.creado_en, u.nombre AS usuario FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
        WHERE b.empresa_id = $1 AND ((b.entidad = 'reserva' AND b.entidad_id = $2) OR (b.entidad = 'contrato' AND b.entidad_id IN (SELECT id FROM contratos WHERE empresa_id = $1 AND reserva_id = $2)))
        ORDER BY b.creado_en DESC LIMIT 60`, [E, id]),
    q(`SELECT id, canal, destino, asunto, estado, error, creado_en, enviado_en FROM salidas WHERE empresa_id = $1 AND ((entidad = 'reserva' AND entidad_id = $2)
        OR (entidad = 'contrato' AND entidad_id IN (SELECT id FROM contratos WHERE empresa_id = $1 AND reserva_id = $2))) ORDER BY creado_en DESC`, [E, id]),
    uno('SELECT id, folio, estado FROM liquidaciones WHERE empresa_id = $1 AND reserva_id = $2', [E, id]),
    reserva.cliente_id ? uno(`SELECT (SELECT count(*)::int FROM reservas WHERE empresa_id = $1 AND cliente_id = $2 AND estado IN ('en_curso','devuelta','cerrada')) AS arriendos,
        (SELECT count(*)::int FROM incidentes WHERE empresa_id = $1 AND cliente_id = $2 AND estado <> 'anulado') AS incidentes`, [E, reserva.cliente_id]) : null,
    reserva.cliente_id ? q('SELECT id, nombre, documento_tipo, documento, licencia_clase, licencia_vence FROM conductores WHERE empresa_id = $1 AND cliente_id = $2 ORDER BY id', [E, reserva.cliente_id]) : []
  ]);
  const gps = vehiculo ? await lecturaActual(E, vehiculo.id) : null;
  res.json({ reserva, cliente, vehiculo, categoria, sucursal_retiro: sr, sucursal_devolucion: sd, conductores, conductores_cliente: conductoresCliente, documentos, pagos, contratos,
    bitacora, salidas, liquidacion, stats, gps, url_portal: urlPortal(reserva.token_portal), transiciones: MANUALES[reserva.estado] || [] });
});

// ── Edición (cotización o confirmada) ──
r.patch('/reservas/:id', editar, conConflicto(async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const out = await transaccion(async (tx) => {
    const [act] = await tx.query('SELECT * FROM reservas WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, E]);
    if (!act) throw new ErrorHttp(404, 'Reserva no encontrada');
    if (!['cotizacion', 'confirmada'].includes(act.estado)) throw new ErrorHttp(409, `Una reserva «${NOMBRES[act.estado]}» ya no se puede editar.`);
    const b = { cliente_id: act.cliente_id, categoria_id: act.categoria_id, vehiculo_id: act.vehiculo_id, sucursal_retiro_id: act.sucursal_retiro_id, sucursal_devolucion_id: act.sucursal_devolucion_id,
      inicio: act.inicio, fin: act.fin, extras: act.extras, conductores: act.conductores, codigo_descuento: act.codigo_descuento, notas: act.notas, ...req.body };
    const d = await leerEntrada(E, b, tx);
    if (!d.cliente) throw new ErrorHttp(400, 'Elige el cliente', { campo: 'cliente_id' });
    if (d.cliente.lista_negra && Number(d.cliente.id) !== Number(act.cliente_id)) throw new ErrorHttp(409, `El cliente está en lista negra: ${d.cliente.lista_negra_motivo || ''}`);
    if (act.estado === 'confirmada' && !d.vehiculo) throw new ErrorHttp(400, 'Una reserva confirmada necesita vehículo', { campo: 'vehiculo_id' });
    if (d.vehiculo) {
      await tx.query('SELECT id FROM vehiculos WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [d.vehiculo.id, E]);
      const c = await conflictos(E, d.vehiculo.id, d.inicio, d.fin, { excluirReservaId: id, cx: tx });
      if (c.length) throw errorConflicto(c[0]);
    }
    const cot = await cotizarEntrada(E, d, tx);
    const [nueva] = await tx.query(`UPDATE reservas SET cliente_id = $3, vehiculo_id = $4, categoria_id = $5, sucursal_retiro_id = $6, sucursal_devolucion_id = $7, inicio = $8, fin = $9,
        extras = $10, conductores = $11, codigo_descuento = $12, cotizacion = $13, total = $14, km_incluidos = $15, precio_km_extra = $16, garantia = $17, deducible = $18, notas = $19, actualizado_en = now()
      WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [id, E, d.cliente.id, d.vehiculo?.id || null, d.categoria.id, d.sr, d.sd, d.inicio, d.fin, JSON.stringify(d.extras), JSON.stringify(d.conductores), cot.descuento ? d.codigo : null,
        JSON.stringify(cot), cot.total, cot.km_incluidos, cot.precio_km_extra, cot.garantia, cot.deducible, d.notas ?? act.notas]);
    if (act.vehiculo_id && Number(act.vehiculo_id) !== Number(nueva.vehiculo_id)) await recalcularEstadoVehiculo(tx, E, act.vehiculo_id);
    await recalcularEstadoVehiculo(tx, E, nueva.vehiculo_id);
    await tx.query('INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [E, req.usuario.id, 'reserva_editada', 'reserva', id, JSON.stringify({ total_anterior: act.total, total: cot.total }), req.ip]);
    return { ...nueva, avisos: cot.avisos };
  });
  res.json(out);
}));

// ── Mover (arrastrar y soltar en el calendario): otro vehículo y/o fechas ──
async function evaluarMovimiento(E, act, b, tx) {
  if (!['cotizacion', 'confirmada'].includes(act.estado)) {
    throw new ErrorHttp(409, act.estado === 'en_curso' ? 'Una reserva en curso no se puede mover: el vehículo ya fue entregado.' : `Una reserva «${NOMBRES[act.estado]}» no se puede mover.`);
  }
  const vehiculoId = Number(b.vehiculo_id || act.vehiculo_id);
  const inicio = b.inicio ? fechaValida(b.inicio, 'inicio') : new Date(act.inicio), fin = b.fin ? fechaValida(b.fin, 'fin') : new Date(act.fin);
  if (fin <= inicio) throw new ErrorHttp(400, 'La devolución debe ser posterior al retiro');
  const [v] = await tx.query(`SELECT id, patente, categoria_id, activo, estado FROM vehiculos WHERE id = $1 AND empresa_id = $2${tx.bloquear ? ' FOR UPDATE' : ''}`, [vehiculoId, E]);
  if (!v || !v.activo) throw new ErrorHttp(404, 'Vehículo no encontrado');
  if (v.estado === 'fuera_servicio') throw new ErrorHttp(409, `${formatearPatente(v.patente)} está fuera de servicio.`);
  const c = await conflictos(E, v.id, inicio, fin, { excluirReservaId: act.id, cx: tx });
  if (c.length) throw errorConflicto(c[0]);
  const cambiaCategoria = Number(v.categoria_id) !== Number(act.categoria_id);
  const [emp] = await tx.query('SELECT ajustes FROM empresas WHERE id = $1', [E]);
  const tol = emp?.ajustes?.tolerancia_min ?? 59;
  const cambiaDias = diasArriendo(inicio, fin, tol) !== diasArriendo(act.inicio, act.fin, tol);
  let cot = null;
  if (cambiaCategoria || cambiaDias) {
    const [cli] = act.cliente_id ? await tx.query('SELECT fecha_nacimiento FROM clientes WHERE id = $1', [act.cliente_id]) : [null];
    cot = await cotizar({ empresaId: E, categoriaId: v.categoria_id, inicio, fin, sucursalRetiroId: act.sucursal_retiro_id, sucursalDevolucionId: act.sucursal_devolucion_id,
      extras: act.extras || [], codigoDescuento: act.codigo_descuento, fechaNacimiento: cli?.fecha_nacimiento || null, conductoresAdicionales: (act.conductores || []).length }, tx.query === q ? null : tx);
  }
  return { v, inicio, fin, cot, cambiaCategoria, total_anterior: Number(act.total), total_nuevo: cot ? cot.total : Number(act.total) };
}

r.patch('/reservas/:id/mover', editar, conConflicto(async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  if (req.body.simular) {
    const act = await uno('SELECT * FROM reservas WHERE id = $1 AND empresa_id = $2', [id, E]);
    if (!act) throw new ErrorHttp(404, 'Reserva no encontrada');
    const m = await evaluarMovimiento(E, act, req.body, { query: q });
    return res.json({ disponible: true, patente: m.v.patente, cambia_categoria: m.cambiaCategoria, total_anterior: m.total_anterior, total_nuevo: m.total_nuevo, diferencia: m.total_nuevo - m.total_anterior });
  }
  const out = await transaccion(async (tx) => {
    const [act] = await tx.query('SELECT * FROM reservas WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, E]);
    if (!act) throw new ErrorHttp(404, 'Reserva no encontrada');
    const m = await evaluarMovimiento(E, act, req.body, { query: tx.query, bloquear: true });
    const sets = ['vehiculo_id = $3', 'categoria_id = $4', 'inicio = $5', 'fin = $6', 'actualizado_en = now()'];
    const vals = [id, E, m.v.id, m.v.categoria_id, m.inicio, m.fin];
    if (m.cot) {
      vals.push(JSON.stringify(m.cot), m.cot.total, m.cot.km_incluidos, m.cot.precio_km_extra, m.cot.garantia, m.cot.deducible);
      sets.push('cotizacion = $7', 'total = $8', 'km_incluidos = $9', 'precio_km_extra = $10', 'garantia = $11', 'deducible = $12');
    }
    const [nueva] = await tx.query(`UPDATE reservas SET ${sets.join(', ')} WHERE id = $1 AND empresa_id = $2 RETURNING *`, vals);
    if (Number(act.vehiculo_id) !== Number(m.v.id)) await recalcularEstadoVehiculo(tx, E, act.vehiculo_id);
    if (nueva.estado === 'confirmada') await recalcularEstadoVehiculo(tx, E, m.v.id);
    await tx.query('INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [E, req.usuario.id, 'reserva_movida', 'reserva', id, JSON.stringify({ de: { vehiculo_id: act.vehiculo_id, inicio: act.inicio, fin: act.fin }, a: { vehiculo_id: m.v.id, patente: m.v.patente, inicio: m.inicio, fin: m.fin }, total_anterior: m.total_anterior, total: m.total_nuevo }), req.ip]);
    return { ...nueva, diferencia: m.total_nuevo - m.total_anterior };
  });
  res.json(out);
}));

// ── Cambio de estado manual: cotización → confirmada | cancelada; confirmada → cancelada | no_show ──
r.post('/reservas/:id/estado', editar, conConflicto(async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const { estado, motivo = null } = req.body;
  const nueva = await transaccion(async (tx) => {
    const [act] = await tx.query('SELECT * FROM reservas WHERE id = $1 AND empresa_id = $2', [id, E]);
    if (!act) throw new ErrorHttp(404, 'Reserva no encontrada');
    if (!(MANUALES[act.estado] || []).includes(estado)) {
      throw new ErrorHttp(409, `Desde «${NOMBRES[act.estado]}» no se puede pasar a «${NOMBRES[estado] || estado}» desde aquí.${['en_curso', 'devuelta'].includes(estado) ? ' Usa Entregas y devoluciones.' : ''}`);
    }
    if (estado === 'confirmada' && !act.vehiculo_id) throw new ErrorHttp(400, 'Asigna un vehículo antes de confirmar');
    const n = await cambiarEstado(tx, act, estado, req.usuario, { motivo, ip: req.ip });
    if (estado === 'confirmada' && n.codigo_descuento) await tx.query('UPDATE descuentos SET usos = usos + 1 WHERE empresa_id = $1 AND upper(codigo) = upper($2)', [E, n.codigo_descuento]);
    return n;
  });
  if (estado === 'confirmada') await avisarConfirmada(E, id).catch((e) => console.error('aviso reserva_confirmada', e.message));
  res.json(nueva);
}));

// Enlace del portal del cliente (subir documentos, ver su reserva y contrato)
r.post('/reservas/:id/portal', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const act = await uno('SELECT id, token_portal FROM reservas WHERE id = $1 AND empresa_id = $2', [id, E]);
  if (!act) throw new ErrorHttp(404, 'Reserva no encontrada');
  let token = act.token_portal;
  if (!token || req.body.renovar) {
    token = tokenAleatorio(18);
    await q('UPDATE reservas SET token_portal = $3 WHERE id = $1 AND empresa_id = $2', [id, E, token]);
    await registrar(req, 'reserva_portal_renovado', 'reserva', id);
  }
  res.json({ url: urlPortal(token) });
});

export default r;
