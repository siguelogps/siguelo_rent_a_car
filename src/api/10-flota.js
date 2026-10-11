// Flota: vehículos (listado con vencimientos y mantención, ficha, alta/edición, cambio de estado, Excel),
// categorías y propietarios (inversionistas) con su liquidación mensual.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { lecturaActual } from '../gps/index.js';
import { formatearPatente } from '../util/patente.js';
import { normalizarRut, validarRut } from '../util/rut.js';
import { validarPatente, limpiar, sqlInsert, sqlUpdate, deLaEmpresa, esDuplicado, mantencion, hoyIso, diasHasta, VENCIMIENTOS } from '../flota/comun.js';
import { exportarFlota, importarFlota } from '../flota/excel.js';
import { liquidacionPropietario, mesValido } from '../flota/liquidacion.js';

const r = express.Router();
const ver = requiere('flota', 'ver'), editar = requiere('flota', 'editar');

export const ESTADOS_VEHICULO = ['disponible', 'arrendado', 'reservado', 'mantencion', 'fuera_servicio'];
const TIPOS_VEHICULO = {
  patente: 'texto', marca: 'texto', modelo: 'texto', anio: 'entero', color: 'texto', vin: 'texto', motor: 'texto',
  categoria_id: 'id', sucursal_id: 'id', propietario_id: 'id', transmision: 'texto', combustible_tipo: 'texto', capacidad_estanque: 'entero',
  km: 'entero', combustible_nivel: 'entero', tag_numero: 'texto',
  venc_revision_tecnica: 'fecha', venc_permiso_circulacion: 'fecha', venc_soap: 'fecha', venc_seguro: 'fecha', seguro_compania: 'texto', seguro_poliza: 'texto',
  mant_cada_km: 'entero', mant_ultima_km: 'entero', mant_cada_meses: 'entero', mant_ultima_fecha: 'fecha',
  gps_unidad_id: 'texto', gps_nombre: 'texto', notas: 'texto'
};

// Agrega a cada vehículo: km actual, mantención y vencimientos con días restantes
export function decorar(v, hoy = hoyIso()) {
  const venc = VENCIMIENTOS.map(([campo, nombre]) => ({ campo, nombre, fecha: v[campo], dias: diasHasta(v[campo], hoy) }));
  return { ...v, patente_fmt: formatearPatente(v.patente), mantencion: mantencion(v, hoy), vencimientos: venc };
}

const SELECT_LISTA = `
  SELECT v.*, c.nombre AS categoria, c.orden AS categoria_orden, s.nombre AS sucursal, p.nombre AS propietario,
    ra.id AS reserva_id, ra.folio AS reserva_folio, ra.fin AS reserva_fin, (ra.fin < now()) AS atrasado,
    pr.folio AS proxima_folio, pr.inicio AS proxima_inicio, pr.fin AS proxima_fin,
    ot.id AS ot_id, ot.folio AS ot_folio, ot.taller AS ot_taller,
    (SELECT count(*)::int FROM danos d WHERE d.empresa_id = v.empresa_id AND d.vehiculo_id = v.id AND d.estado = 'activo') AS danos_activos
  FROM vehiculos v
  LEFT JOIN categorias c ON c.id = v.categoria_id
  LEFT JOIN sucursales s ON s.id = v.sucursal_id
  LEFT JOIN propietarios p ON p.id = v.propietario_id
  LEFT JOIN LATERAL (SELECT id, folio, fin FROM reservas x WHERE x.empresa_id = v.empresa_id AND x.vehiculo_id = v.id AND x.estado = 'en_curso' ORDER BY x.inicio DESC LIMIT 1) ra ON true
  LEFT JOIN LATERAL (SELECT folio, inicio, fin FROM reservas x WHERE x.empresa_id = v.empresa_id AND x.vehiculo_id = v.id AND x.estado = 'confirmada' AND x.fin > now() ORDER BY x.inicio LIMIT 1) pr ON true
  LEFT JOIN LATERAL (SELECT id, folio, taller FROM ordenes_trabajo o WHERE o.empresa_id = v.empresa_id AND o.vehiculo_id = v.id AND o.estado = 'en_taller' ORDER BY o.inicio DESC NULLS LAST LIMIT 1) ot ON true`;

// ── Vehículos ──
r.get('/vehiculos', ver, async (req, res) => {
  const { estado, categoria_id, sucursal_id, propietario_id, inactivos } = req.query;
  const filas = await q(`${SELECT_LISTA}
    WHERE v.empresa_id = $1 AND (v.activo OR $2::boolean)
      AND ($3::text IS NULL OR v.estado = $3) AND ($4::bigint IS NULL OR v.categoria_id = $4)
      AND ($5::bigint IS NULL OR v.sucursal_id = $5) AND ($6::bigint IS NULL OR v.propietario_id = $6)
    ORDER BY c.orden NULLS LAST, c.nombre, v.patente`,
  [req.empresaId, inactivos === '1', estado || null, Number(categoria_id) || null, Number(sucursal_id) || null, Number(propietario_id) || null]);
  const hoy = hoyIso();
  res.json(filas.map((v) => decorar(v, hoy)));
});

r.get('/vehiculos/exportar', ver, async (req, res) => {
  const buf = await exportarFlota(req.empresaId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="flota-${hoyIso()}.xlsx"`);
  res.end(Buffer.from(buf));
});

// body: { archivo: dataURL o base64 del .xlsx }
r.post('/vehiculos/importar', editar, async (req, res) => {
  const a = String(req.body.archivo || '');
  if (!a) throw new ErrorHttp(400, 'Adjunta la planilla Excel.');
  const datos = Buffer.from(a.includes('base64,') ? a.slice(a.indexOf('base64,') + 7) : a, 'base64');
  const out = await importarFlota(req.empresaId, datos);
  await registrar(req, 'flota_importada', 'vehiculo', null, { filas: out.filas, nuevas: out.nuevas, actualizadas: out.actualizadas, errores: out.errores.length });
  res.json(out);
});

r.get('/vehiculos/:id', ver, async (req, res) => {
  const E = req.empresaId, id = Number(req.params.id);
  const v = await uno(`${SELECT_LISTA} WHERE v.empresa_id = $1 AND v.id = $2`, [E, id]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const RES = `SELECT r.id, r.folio, r.estado, r.inicio, r.fin, r.total, r.retiro_real, r.devolucion_real, c.nombre || ' ' || coalesce(c.apellidos, '') AS cliente,
      sr.nombre AS sucursal_retiro, sd.nombre AS sucursal_devolucion
    FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN sucursales sr ON sr.id = r.sucursal_retiro_id LEFT JOIN sucursales sd ON sd.id = r.sucursal_devolucion_id
    WHERE r.empresa_id = $1 AND r.vehiculo_id = $2`;
  const [proximas, historial, danos, ordenes, ingresos, bloqueos, bitacora, gps] = await Promise.all([
    q(`${RES} AND r.estado IN ('cotizacion','confirmada','en_curso') AND r.fin > now() - interval '30 days' ORDER BY r.inicio LIMIT 20`, [E, id]),
    q(`${RES} AND r.estado IN ('devuelta','cerrada','cancelada','no_show') ORDER BY r.inicio DESC LIMIT 30`, [E, id]),
    q(`SELECT d.id, d.vista, d.tipo, d.descripcion, d.archivo_id, d.creado_en, d.incidente_id, i.folio AS incidente_folio FROM danos d LEFT JOIN incidentes i ON i.id = d.incidente_id
       WHERE d.empresa_id = $1 AND d.vehiculo_id = $2 AND d.estado = 'activo' ORDER BY d.creado_en DESC`, [E, id]),
    q(`SELECT id, folio, tipo, motivo, estado, taller, costo, km_programado, fecha_programada, inicio, fin, km_al_ingreso FROM ordenes_trabajo
       WHERE empresa_id = $1 AND vehiculo_id = $2 ORDER BY coalesce(inicio, creado_en) DESC LIMIT 30`, [E, id]),
    q(`SELECT to_char(coalesce(r.devolucion_real, r.fin) AT TIME ZONE 'America/Santiago', 'YYYY-MM') AS mes, count(*)::int AS reservas, sum(r.total)::bigint AS total
       FROM reservas r WHERE r.empresa_id = $1 AND r.vehiculo_id = $2 AND r.estado IN ('devuelta','cerrada')
       GROUP BY 1 ORDER BY 1 DESC LIMIT 12`, [E, id]),
    q(`SELECT id, inicio, fin, motivo, orden_trabajo_id FROM bloqueos WHERE empresa_id = $1 AND vehiculo_id = $2 AND fin > now() ORDER BY inicio`, [E, id]),
    q(`SELECT b.accion, b.detalle, b.creado_en, u.nombre AS usuario FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
       WHERE b.empresa_id = $1 AND b.entidad = 'vehiculo' AND b.entidad_id = $2 ORDER BY b.creado_en DESC LIMIT 15`, [E, id]),
    lecturaActual(E, id)
  ]);
  const tot = await uno(`SELECT coalesce(sum(total), 0)::bigint AS ingresos, count(*)::int AS reservas FROM reservas WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado IN ('devuelta','cerrada')`, [E, id]);
  const costo = await uno(`SELECT coalesce(sum(costo), 0)::bigint AS costo FROM ordenes_trabajo WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado = 'terminada'`, [E, id]);
  res.json({ vehiculo: decorar(v), proximas, historial, danos, ordenes, bloqueos, bitacora, gps,
    ingresos: { total: tot.ingresos, reservas: tot.reservas, costo_mantencion: costo.costo, por_mes: ingresos } });
});

async function validarVehiculo(req, datos) {
  const E = req.empresaId;
  if ('patente' in datos) datos.patente = validarPatente(datos.patente);
  await deLaEmpresa('categorias', datos.categoria_id, E, 'categoría');
  await deLaEmpresa('sucursales', datos.sucursal_id, E, 'sucursal');
  await deLaEmpresa('propietarios', datos.propietario_id, E, 'propietario');
  if (datos.anio != null && (datos.anio < 1980 || datos.anio > new Date().getFullYear() + 1)) throw new ErrorHttp(400, 'El año del vehículo no es válido.', { campo: 'anio' });
  if (datos.km != null && datos.km < 0) throw new ErrorHttp(400, 'El kilometraje no puede ser negativo.', { campo: 'km' });
  if (datos.combustible_nivel != null && (datos.combustible_nivel < 0 || datos.combustible_nivel > 8)) throw new ErrorHttp(400, 'El nivel de combustible va de 0 a 8 octavos.', { campo: 'combustible_nivel' });
  for (const k of ['mant_cada_km', 'mant_cada_meses', 'mant_ultima_km', 'capacidad_estanque']) if (datos[k] != null && datos[k] < 0) throw new ErrorHttp(400, 'Los valores de mantención no pueden ser negativos.', { campo: k });
  return datos;
}
const duplicada = (p) => new ErrorHttp(409, `Ya existe un vehículo con la patente ${formatearPatente(p)}.`, { campo: 'patente' });

r.post('/vehiculos', editar, async (req, res) => {
  const datos = await validarVehiculo(req, limpiar(req.body, TIPOS_VEHICULO));
  if (!datos.patente) throw new ErrorHttp(400, 'Ingresa la patente.', { campo: 'patente' });
  if (req.body.estado && ESTADOS_VEHICULO.includes(req.body.estado)) datos.estado = req.body.estado;
  for (const k of Object.keys(datos)) if (datos[k] === null) delete datos[k]; // deja los valores por defecto
  const previo = await uno('SELECT id, activo FROM vehiculos WHERE empresa_id = $1 AND patente = $2', [req.empresaId, datos.patente]);
  if (previo) throw duplicada(datos.patente);
  let v;
  try { const s = sqlInsert('vehiculos', { empresa_id: req.empresaId, ...datos }); [v] = await q(s.sql, s.params); }
  catch (e) { if (esDuplicado(e)) throw duplicada(datos.patente); throw e; }
  await registrar(req, 'vehiculo_creado', 'vehiculo', v.id, { patente: v.patente });
  res.status(201).json(decorar(v));
});

r.put('/vehiculos/:id', editar, async (req, res) => {
  const id = Number(req.params.id);
  const antes = await uno('SELECT * FROM vehiculos WHERE id = $1 AND empresa_id = $2', [id, req.empresaId]);
  if (!antes) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const datos = await validarVehiculo(req, limpiar(req.body, TIPOS_VEHICULO));
  if ('patente' in datos && !datos.patente) throw new ErrorHttp(400, 'Ingresa la patente.', { campo: 'patente' });
  for (const k of ['km', 'combustible_nivel', 'mant_ultima_km']) if (k in datos && datos[k] == null) delete datos[k];
  if (datos.patente && datos.patente !== antes.patente && await uno('SELECT 1 FROM vehiculos WHERE empresa_id = $1 AND patente = $2 AND id <> $3', [req.empresaId, datos.patente, id])) throw duplicada(datos.patente);
  const s = sqlUpdate('vehiculos', datos, id, req.empresaId);
  let v = antes;
  if (s) {
    try { [v] = await q(s.sql, s.params); } catch (e) { if (esDuplicado(e)) throw duplicada(datos.patente); throw e; }
  }
  const cambios = Object.keys(datos).filter((k) => String(antes[k] ?? '') !== String(v[k] ?? ''));
  if (cambios.length) await registrar(req, 'vehiculo_editado', 'vehiculo', id, { cambios: Object.fromEntries(cambios.map((k) => [k, { antes: antes[k], despues: v[k] }])) });
  res.json(decorar(v));
});

// Cambio manual de estado con motivo (queda en la bitácora del vehículo)
r.post('/vehiculos/:id/estado', editar, async (req, res) => {
  const id = Number(req.params.id);
  const { estado } = req.body;
  const motivo = String(req.body.motivo || '').trim();
  if (!ESTADOS_VEHICULO.includes(estado)) throw new ErrorHttp(400, 'Estado no válido.');
  const v = await uno('SELECT id, estado, patente FROM vehiculos WHERE id = $1 AND empresa_id = $2', [id, req.empresaId]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  if (['fuera_servicio', 'mantencion'].includes(estado) && !motivo) throw new ErrorHttp(400, 'Indica el motivo del cambio de estado.', { campo: 'motivo' });
  if (estado === 'disponible') {
    const ot = await uno(`SELECT folio FROM ordenes_trabajo WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado = 'en_taller' LIMIT 1`, [req.empresaId, id]);
    if (ot) throw new ErrorHttp(409, `El vehículo está en taller con la orden ${ot.folio}. Termínala en Mantención para dejarlo disponible.`);
  }
  await q('UPDATE vehiculos SET estado = $1 WHERE id = $2 AND empresa_id = $3', [estado, id, req.empresaId]);
  await registrar(req, 'vehiculo_estado', 'vehiculo', id, { antes: v.estado, despues: estado, motivo });
  res.json({ ok: true, estado });
});

// Dar de baja (no se borra: tiene reservas, contratos y multas asociadas)
r.delete('/vehiculos/:id', editar, async (req, res) => {
  const id = Number(req.params.id);
  const activa = await uno(`SELECT folio FROM reservas WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado IN ('confirmada','en_curso') AND fin > now() LIMIT 1`, [req.empresaId, id]);
  if (activa) throw new ErrorHttp(409, `No se puede dar de baja: tiene la reserva ${activa.folio} vigente.`);
  const [v] = await q('UPDATE vehiculos SET activo = false WHERE id = $1 AND empresa_id = $2 RETURNING id, patente', [id, req.empresaId]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  await registrar(req, 'vehiculo_baja', 'vehiculo', id, { patente: v.patente, motivo: req.body?.motivo || null });
  res.json({ ok: true });
});
r.post('/vehiculos/:id/reactivar', editar, async (req, res) => {
  const [v] = await q('UPDATE vehiculos SET activo = true WHERE id = $1 AND empresa_id = $2 RETURNING id', [Number(req.params.id), req.empresaId]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  await registrar(req, 'vehiculo_reactivado', 'vehiculo', v.id);
  res.json({ ok: true });
});

// ── Categorías ──
const TIPOS_CATEGORIA = { nombre: 'texto', descripcion: 'texto', pasajeros: 'entero', maletas: 'entero', transmision: 'texto', ejemplo: 'texto', orden: 'entero', activa: 'bool' };
r.get('/categorias', requiere(), async (req, res) => {
  res.json(await q(`SELECT c.*, (SELECT count(*)::int FROM vehiculos v WHERE v.categoria_id = c.id AND v.activo) AS vehiculos,
      (SELECT precio_dia FROM tarifas t WHERE t.categoria_id = c.id AND t.temporada_id IS NULL AND t.empresa_id = c.empresa_id) AS precio_dia
    FROM categorias c WHERE c.empresa_id = $1 ORDER BY c.orden, c.nombre`, [req.empresaId]));
});
r.post('/categorias', editar, async (req, res) => {
  const d = limpiar({ activa: true, ...req.body }, TIPOS_CATEGORIA);
  if (!d.nombre) throw new ErrorHttp(400, 'Ingresa el nombre de la categoría.', { campo: 'nombre' });
  if (d.orden == null) d.orden = (await uno('SELECT coalesce(max(orden), -1) + 1 AS n FROM categorias WHERE empresa_id = $1', [req.empresaId])).n;
  const s = sqlInsert('categorias', { empresa_id: req.empresaId, ...d });
  const [c] = await q(s.sql, s.params);
  await registrar(req, 'categoria_creada', 'categoria', c.id, { nombre: c.nombre });
  res.status(201).json(c);
});
r.put('/categorias/:id', editar, async (req, res) => {
  const d = limpiar(req.body, TIPOS_CATEGORIA);
  if ('nombre' in d && !d.nombre) throw new ErrorHttp(400, 'Ingresa el nombre de la categoría.', { campo: 'nombre' });
  const s = sqlUpdate('categorias', d, Number(req.params.id), req.empresaId);
  if (!s) throw new ErrorHttp(400, 'Sin cambios');
  const [c] = await q(s.sql, s.params);
  if (!c) throw new ErrorHttp(404, 'Categoría no encontrada');
  await registrar(req, 'categoria_editada', 'categoria', c.id, d);
  res.json(c);
});
r.delete('/categorias/:id', editar, async (req, res) => {
  const id = Number(req.params.id), E = req.empresaId;
  const c = await deLaEmpresa('categorias', id, E, 'categoría');
  if (!c) throw new ErrorHttp(404, 'Categoría no encontrada');
  const usada = await uno(`SELECT (SELECT count(*) FROM vehiculos WHERE categoria_id = $1)::int + (SELECT count(*) FROM reservas WHERE categoria_id = $1)::int AS n`, [id]);
  if (usada.n) { await q('UPDATE categorias SET activa = false WHERE id = $1 AND empresa_id = $2', [id, E]); await registrar(req, 'categoria_desactivada', 'categoria', id); return res.json({ ok: true, desactivada: true }); }
  await q('DELETE FROM tarifas WHERE categoria_id = $1 AND empresa_id = $2', [id, E]);
  await q('DELETE FROM categorias WHERE id = $1 AND empresa_id = $2', [id, E]);
  await registrar(req, 'categoria_eliminada', 'categoria', id, { nombre: c.nombre });
  res.json({ ok: true, eliminada: true });
});

// ── Propietarios (inversionistas) ──
const TIPOS_PROP = { nombre: 'texto', rut: 'texto', correo: 'texto', telefono: 'texto', banco: 'texto', cuenta: 'texto', porcentaje: 'numero', activo: 'bool' };
function validarProp(d) {
  if ('nombre' in d && !d.nombre) throw new ErrorHttp(400, 'Ingresa el nombre del propietario.', { campo: 'nombre' });
  if (d.rut) { if (!validarRut(d.rut)) throw new ErrorHttp(400, 'El RUT no es válido.', { campo: 'rut' }); d.rut = normalizarRut(d.rut); }
  if (d.porcentaje != null && (d.porcentaje < 0 || d.porcentaje > 100)) throw new ErrorHttp(400, 'El porcentaje debe estar entre 0 y 100.', { campo: 'porcentaje' });
  return d;
}
r.get('/propietarios', ver, async (req, res) => {
  res.json(await q(`SELECT p.*, (SELECT count(*)::int FROM vehiculos v WHERE v.propietario_id = p.id AND v.activo) AS vehiculos,
      (SELECT string_agg(v.patente, ',' ORDER BY v.patente) FROM vehiculos v WHERE v.propietario_id = p.id AND v.activo) AS patentes
    FROM propietarios p WHERE p.empresa_id = $1 ORDER BY p.activo DESC, p.nombre`, [req.empresaId]));
});
r.post('/propietarios', editar, async (req, res) => {
  const d = validarProp(limpiar({ activo: true, ...req.body }, TIPOS_PROP));
  if (!d.nombre) throw new ErrorHttp(400, 'Ingresa el nombre del propietario.', { campo: 'nombre' });
  if (d.porcentaje == null) delete d.porcentaje;
  const s = sqlInsert('propietarios', { empresa_id: req.empresaId, ...d });
  const [p] = await q(s.sql, s.params);
  await registrar(req, 'propietario_creado', 'propietario', p.id, { nombre: p.nombre });
  res.status(201).json(p);
});
r.put('/propietarios/:id', editar, async (req, res) => {
  const d = validarProp(limpiar(req.body, TIPOS_PROP));
  if ('porcentaje' in d && d.porcentaje == null) d.porcentaje = 0;
  const s = sqlUpdate('propietarios', d, Number(req.params.id), req.empresaId);
  if (!s) throw new ErrorHttp(400, 'Sin cambios');
  const [p] = await q(s.sql, s.params);
  if (!p) throw new ErrorHttp(404, 'Propietario no encontrado');
  await registrar(req, 'propietario_editado', 'propietario', p.id, d);
  res.json(p);
});
r.delete('/propietarios/:id', editar, async (req, res) => {
  const id = Number(req.params.id);
  const [p] = await q('UPDATE propietarios SET activo = false WHERE id = $1 AND empresa_id = $2 RETURNING id', [id, req.empresaId]);
  if (!p) throw new ErrorHttp(404, 'Propietario no encontrado');
  await registrar(req, 'propietario_desactivado', 'propietario', id);
  res.json({ ok: true });
});

// Liquidación al inversionista: ?mes=aaaa-mm
r.get('/propietarios/liquidacion', ver, async (req, res) => {
  const mes = mesValido(req.query.mes);
  const props = await q('SELECT id FROM propietarios WHERE empresa_id = $1 AND activo ORDER BY nombre', [req.empresaId]);
  const filas = [];
  for (const p of props) filas.push(await liquidacionPropietario(req.empresaId, p.id, mes));
  res.json({ mes, propietarios: filas });
});
r.get('/propietarios/:id/liquidacion', ver, async (req, res) => {
  const l = await liquidacionPropietario(req.empresaId, Number(req.params.id), req.query.mes);
  if (!l) throw new ErrorHttp(404, 'Propietario no encontrado');
  res.json(l);
});

export default r;
