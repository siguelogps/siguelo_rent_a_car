// Liquidación automática al cierre: calcula los cargos desde las inspecciones (tabla inspecciones), TAG, multas e incidentes,
// permite editarlos o condonarlos con motivo, y al aprobar captura de la garantía, libera el resto, cobra el saldo,
// marca TAG/multas/incidentes como cobrados, cierra la reserva, emite el DTE y avisa al cliente con el PDF.
import { cambiarEstado } from '../reservas/estados.js';
import { q, uno, transaccion, siguienteFolio } from '../db.js';
import { ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { avisar } from '../salidas.js';
import { puedeActuar } from '../integraciones/index.js';
import { guardarArchivo } from '../almacenamiento/index.js';
import { clp } from '../util/formato.js';
import { calcularLineas, fusionar, resumir, valorDia, ORIGENES } from './calculo.js';
import { pdfLiquidacion } from './pdf.js';
import { garantiaVigente, capturar, liberar, crearLink, etapaGarantia, esSimulado, cobrado, METODOS } from '../pagos/index.js';
import { emitirDocumento, receptorDeCliente, validarReceptor } from '../facturacion/index.js';

const bit = (empresaId, usuarioId, accion, id, detalle = {}) => registrar({ empresaId, usuario: usuarioId ? { id: usuarioId } : null }, accion, 'liquidacion', id, detalle);

async function cargarReserva(empresaId, reservaId) {
  const r = await uno(`SELECT r.*, row_to_json(c.*) AS cliente, row_to_json(v.*) AS vehiculo,
        (SELECT folio FROM contratos ct WHERE ct.reserva_id = r.id AND ct.estado <> 'anulado' ORDER BY ct.id DESC LIMIT 1) AS contrato_folio
      FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
     WHERE r.id = $1 AND r.empresa_id = $2`, [reservaId, empresaId]);
  if (!r) throw new ErrorHttp(404, 'Reserva no encontrada');
  return r;
}

// Datos de origen del cálculo (lee las inspecciones directo de la tabla)
export async function datosCalculo(empresaId, reserva) {
  const [emp] = await q('SELECT ajustes FROM empresas WHERE id = $1', [empresaId]);
  const insp = await q(`SELECT * FROM inspecciones WHERE empresa_id = $1 AND reserva_id = $2`, [empresaId, reserva.id]);
  const tags = await q(`SELECT id, monto, autopista, concesionaria, fecha_hora FROM tag_transitos WHERE empresa_id = $1 AND reserva_id = $2 AND estado = 'asignado' ORDER BY fecha_hora`, [empresaId, reserva.id]);
  const multas = await q(`SELECT id, monto, motivo, tipo, lugar, fecha_infraccion FROM multas WHERE empresa_id = $1 AND reserva_id = $2 AND estado IN ('asignada','notificada') ORDER BY fecha_infraccion`, [empresaId, reserva.id]);
  const incidentes = await q(`SELECT * FROM incidentes WHERE empresa_id = $1 AND reserva_id = $2 AND estado IN ('reportado','presupuestado','en_seguro') ORDER BY id`, [empresaId, reserva.id]);
  const [tarifa] = await q(`SELECT precio_dia FROM tarifas WHERE empresa_id = $1 AND categoria_id = $2 AND temporada_id IS NULL`, [empresaId, reserva.categoria_id]);
  return {
    reserva, ajustes: emp?.ajustes || {}, vehiculo: reserva.vehiculo || {},
    entrega: insp.find((i) => i.tipo === 'entrega') || null, devolucion: insp.find((i) => i.tipo === 'devolucion') || null,
    tags, multas, incidentes, tarifaDia: valorDia(reserva.cotizacion, tarifa?.precio_dia)
  };
}

const liquidacionDe = (empresaId, reservaId) => uno('SELECT * FROM liquidaciones WHERE empresa_id = $1 AND reserva_id = $2', [empresaId, reservaId]);

// Calcula (o recalcula) la liquidación en borrador, conservando ediciones y cargos manuales.
export async function calcular(empresaId, reservaId, usuarioId = null) {
  const reserva = await cargarReserva(empresaId, reservaId);
  if (!reserva.estado === 'devuelta') {
    const existe = await liquidacionDe(empresaId, reservaId);
    if (existe) return existe;
    throw new ErrorHttp(409, 'Solo se liquidan reservas devueltas');
  }
  const prev = await liquidacionDe(empresaId, reservaId);
  if (prev && prev.estado !== 'borrador') throw new ErrorHttp(409, 'La liquidación ya fue aprobada');
  const datos = await datosCalculo(empresaId, reserva);
  const lineas = fusionar(calcularLineas(datos), prev?.lineas || []);
  const g = await garantiaVigente(empresaId, reservaId);
  const gMonto = g && etapaGarantia(g) === 'retenida' ? g.monto : 0;
  const s = resumir(lineas, gMonto);
  let liq;
  if (prev) {
    [liq] = await q(`UPDATE liquidaciones SET lineas = $3, total_cargos = $4, garantia_retenida = $5, saldo_por_cobrar = $6, actualizado_en = now()
                      WHERE id = $1 AND empresa_id = $2 RETURNING *`, [prev.id, empresaId, JSON.stringify(lineas), s.total_cargos, s.garantia, s.saldo]);
  } else {
    liq = await transaccion(async (tx) => {
      const folio = await siguienteFolio(empresaId, 'LQ', tx);
      const [x] = await tx.query(`INSERT INTO liquidaciones (empresa_id, reserva_id, folio, estado, lineas, total_cargos, garantia_retenida, saldo_por_cobrar)
                                  VALUES ($1,$2,$3,'borrador',$4,$5,$6,$7) ON CONFLICT (reserva_id) DO NOTHING RETURNING *`,
        [empresaId, reservaId, folio, JSON.stringify(lineas), s.total_cargos, s.garantia, s.saldo]);
      return x;
    });
    if (!liq) return liquidacionDe(empresaId, reservaId); // otra pestaña la creó al mismo tiempo
    await bit(empresaId, usuarioId, 'liquidacion_calculada', liq.id, { reserva_id: reservaId, total: s.total_cargos });
  }
  return liq;
}

// Vista completa para la pantalla /liquidaciones/:reservaId
export async function obtener(empresaId, reservaId, { usuarioId = null } = {}) {
  const reserva = await cargarReserva(empresaId, reservaId);
  let liq = await liquidacionDe(empresaId, reservaId);
  if (!liq && reserva.estado === 'devuelta') liq = await calcular(empresaId, reservaId, usuarioId);
  if (!liq) throw new ErrorHttp(409, 'Esta reserva no tiene liquidación (solo se liquidan reservas devueltas)');
  // Saldo pagado después de aprobar → la liquidación queda cobrada
  if (liq.estado === 'aprobada' && liq.pago_saldo_id) {
    const ps = await uno('SELECT estado FROM pagos WHERE id = $1', [liq.pago_saldo_id]);
    if (ps && ['pagado', 'simulado'].includes(ps.estado)) [liq] = await q(`UPDATE liquidaciones SET estado = 'cobrada', saldo_por_cobrar = 0, actualizado_en = now() WHERE id = $1 RETURNING *`, [liq.id]);
  }
  const empresa = await uno('SELECT id, nombre, rut, razon_social, giro, direccion, comuna, ciudad, telefono, correo, logo_clave, ajustes, marcha_blanca FROM empresas WHERE id = $1', [empresaId]);
  const g = await garantiaVigente(empresaId, reservaId);
  const pagos = await q('SELECT * FROM pagos WHERE empresa_id = $1 AND reserva_id = $2 ORDER BY id', [empresaId, reservaId]);
  const arriendoPagos = pagos.filter((p) => p.concepto === 'arriendo' && cobrado(p) > 0);
  const arriendoPagado = arriendoPagos.reduce((s, p) => s + cobrado(p), 0);
  const ultimo = arriendoPagos.at(-1);
  const gMonto = liq.estado === 'borrador' ? (g && etapaGarantia(g) === 'retenida' ? g.monto : 0) : liq.garantia_retenida;
  const resumen = liq.estado === 'borrador' ? resumir(liq.lineas, gMonto)
    : { total_cargos: liq.total_cargos, garantia: liq.garantia_retenida, captura: liq.garantia_capturada, libera: liq.garantia_liberada, saldo: liq.saldo_por_cobrar };
  const dte = await q('SELECT id, tipo, folio, estado, total, mensaje, emitido_en, creado_en FROM documentos_tributarios WHERE empresa_id = $1 AND (liquidacion_id = $2 OR (reserva_id = $3 AND liquidacion_id IS NULL)) ORDER BY id', [empresaId, liq.id, reservaId]);
  const salidas = await q(`SELECT id, canal, destino, estado, error, creado_en FROM salidas WHERE empresa_id = $1 AND entidad = 'liquidacion' AND entidad_id = $2 ORDER BY id`, [empresaId, liq.id]);
  const cobros = g ? await puedeActuar(empresaId, g.metodo === 'webpay' || g.metodo === 'mercadopago' ? g.metodo : 'webpay') : await puedeActuar(empresaId, 'webpay');
  const saldoPago = liq.pago_saldo_id ? await uno('SELECT id, estado, monto, link_token, metodo FROM pagos WHERE id = $1', [liq.pago_saldo_id]) : null;
  return {
    empresa: { nombre: empresa.nombre, marcha_blanca: empresa.marcha_blanca, dias_retencion: Number(empresa.ajustes?.garantia_dias_retencion) || 30 },
    reserva: { id: reserva.id, folio: reserva.folio, estado: reserva.estado, inicio: reserva.inicio, fin: reserva.fin, retiro_real: reserva.retiro_real, devolucion_real: reserva.devolucion_real, garantia: reserva.garantia, deducible: reserva.deducible, total: reserva.total },
    cliente: reserva.cliente ? { id: reserva.cliente.id, nombre: reserva.cliente.nombre, apellidos: reserva.cliente.apellidos, documento: reserva.cliente.documento, documento_tipo: reserva.cliente.documento_tipo, correo: reserva.cliente.correo, telefono: reserva.cliente.telefono, tipo: reserva.cliente.tipo, razon_social: reserva.cliente.razon_social, giro: reserva.cliente.giro, direccion: reserva.cliente.direccion, comuna: reserva.cliente.comuna } : null,
    vehiculo: reserva.vehiculo ? { id: reserva.vehiculo.id, patente: reserva.vehiculo.patente, marca: reserva.vehiculo.marca, modelo: reserva.vehiculo.modelo } : null,
    contrato: reserva.contrato_folio ? { folio: reserva.contrato_folio } : null,
    liquidacion: liq, resumen,
    garantia: g ? { id: g.id, monto: g.monto, estado: g.estado, etapa: etapaGarantia(g), simulado: esSimulado(g), metodo: g.metodo, metodo_nombre: METODOS[g.metodo], tarjeta: g.tarjeta, marca: g.detalle?.marca || null, autorizacion: g.autorizacion, creado_en: g.creado_en, vence_retencion: g.vence_retencion, monto_capturado: g.monto_capturado, monto_liberado: g.monto_liberado } : null,
    arriendo: { pagado: arriendoPagado, ultimo: ultimo ? { fecha: ultimo.creado_en, metodo: METODOS[ultimo.metodo], autorizacion: ultimo.autorizacion, simulado: esSimulado(ultimo) } : null },
    total_contrato: resumen.total_cargos + arriendoPagado,
    cobros_activos: cobros.ok, cobros_motivo: cobros.ok ? null : cobros.motivo,
    receptor_sugerido: receptorDeCliente(reserva.cliente, reserva.cliente?.tipo === 'empresa' ? 33 : 39),
    dte, salidas, saldo_pago: saldoPago
  };
}

async function liquidacionBorrador(empresaId, reservaId) {
  const liq = await liquidacionDe(empresaId, reservaId);
  if (!liq) throw new ErrorHttp(404, 'La reserva aún no tiene liquidación: calcúlala primero');
  if (liq.estado !== 'borrador') throw new ErrorHttp(409, 'La liquidación ya fue aprobada y no se puede modificar');
  return liq;
}

async function guardarLineas(empresaId, liq, lineas) {
  const g = await garantiaVigente(empresaId, liq.reserva_id);
  const s = resumir(lineas, g && etapaGarantia(g) === 'retenida' ? g.monto : 0);
  const [x] = await q(`UPDATE liquidaciones SET lineas = $2, total_cargos = $3, garantia_retenida = $4, saldo_por_cobrar = $5, actualizado_en = now() WHERE id = $1 RETURNING *`,
    [liq.id, JSON.stringify(lineas), s.total_cargos, s.garantia, s.saldo]);
  return x;
}

// Incluir / excluir (condonar) / cambiar monto de un cargo. Condonar o cambiar el monto exige motivo.
export async function editarLinea(empresaId, reservaId, codigo, { incluir, monto, motivo }, usuarioId = null) {
  const liq = await liquidacionBorrador(empresaId, reservaId);
  const lineas = liq.lineas;
  const l = lineas.find((x) => x.codigo === codigo);
  if (!l) throw new ErrorHttp(404, 'Cargo no encontrado');
  const antes = { incluir: l.incluir, monto: l.monto };
  const nuevoMonto = monto !== undefined && monto !== null && monto !== '' ? Math.round(Number(monto)) : l.monto;
  if (!Number.isFinite(nuevoMonto) || nuevoMonto < 0) throw new ErrorHttp(400, 'Monto no válido', { campo: 'monto' });
  const nuevoIncluir = incluir === undefined ? l.incluir : !!incluir;
  const condona = antes.incluir && !nuevoIncluir && l.monto > 0;
  const cambiaMonto = nuevoMonto !== l.monto;
  const m = String(motivo || '').trim();
  if ((condona || cambiaMonto) && !m) throw new ErrorHttp(400, condona ? 'Indica el motivo para condonar este cargo' : 'Indica el motivo del cambio de monto', { campo: 'motivo' });
  Object.assign(l, { incluir: nuevoIncluir, monto: nuevoMonto, editado: true, motivo: m || l.motivo || null, editado_por: usuarioId, editado_en: new Date().toISOString() });
  const x = await guardarLineas(empresaId, liq, lineas);
  await bit(empresaId, usuarioId, condona ? 'liquidacion_cargo_condonado' : cambiaMonto ? 'liquidacion_cargo_editado' : nuevoIncluir ? 'liquidacion_cargo_incluido' : 'liquidacion_cargo_excluido', liq.id,
    { codigo, concepto: l.concepto, antes, despues: { incluir: nuevoIncluir, monto: nuevoMonto }, motivo: m || null });
  return x;
}

export async function agregarCargo(empresaId, reservaId, { concepto, monto, motivo, calculo }, usuarioId = null) {
  const liq = await liquidacionBorrador(empresaId, reservaId);
  const c = String(concepto || '').trim();
  const mm = Math.round(Number(monto));
  if (!c) throw new ErrorHttp(400, 'Indica el concepto del cargo', { campo: 'concepto' });
  if (!Number.isFinite(mm) || mm <= 0) throw new ErrorHttp(400, 'El monto debe ser mayor que cero', { campo: 'monto' });
  const codigo = `manual:${Date.now().toString(36)}`;
  const l = { codigo, concepto: c.slice(0, 80), calculo: String(calculo || motivo || 'Cargo agregado manualmente').slice(0, 200), origen: ORIGENES.manual, monto: mm, monto_calculado: mm, incluir: true, editado: true, motivo: motivo || null, editado_por: usuarioId, editado_en: new Date().toISOString() };
  const x = await guardarLineas(empresaId, liq, [...liq.lineas, l]);
  await bit(empresaId, usuarioId, 'liquidacion_cargo_agregado', liq.id, { codigo, concepto: c, monto: mm, motivo: motivo || null });
  return x;
}

export async function quitarCargo(empresaId, reservaId, codigo, usuarioId = null) {
  const liq = await liquidacionBorrador(empresaId, reservaId);
  if (!String(codigo).startsWith('manual:')) throw new ErrorHttp(400, 'Solo se eliminan cargos agregados a mano; los calculados se condonan con motivo');
  const l = liq.lineas.find((x) => x.codigo === codigo);
  if (!l) throw new ErrorHttp(404, 'Cargo no encontrado');
  const x = await guardarLineas(empresaId, liq, liq.lineas.filter((y) => y.codigo !== codigo));
  await bit(empresaId, usuarioId, 'liquidacion_cargo_eliminado', liq.id, { codigo, concepto: l.concepto, monto: l.monto });
  return x;
}

/**
 * Aprobar, cobrar y liberar saldo.
 * opciones: { documento: 'boleta'|'factura'|'ninguno', receptor?, avisar_correo, avisar_whatsapp, proveedor_saldo: 'webpay'|'mercadopago' }
 */
export async function aprobar(empresaId, reservaId, opciones = {}, usuarioId = null) {
  const liq = await liquidacionBorrador(empresaId, reservaId);
  const reserva = await cargarReserva(empresaId, reservaId);
  if (reserva.estado !== 'devuelta') throw new ErrorHttp(409, 'Solo se aprueba la liquidación de una reserva devuelta');
  const docTipo = opciones.documento === 'factura' ? 33 : opciones.documento === 'boleta' ? 39 : null;
  const incluidas = liq.lineas.filter((l) => l.incluir && l.monto > 0);
  const total = incluidas.reduce((s, l) => s + l.monto, 0);
  const receptor = docTipo ? { ...receptorDeCliente(reserva.cliente, docTipo), ...(opciones.receptor || {}) } : null;
  if (docTipo && total > 0) validarReceptor(receptor, docTipo); // antes de mover dinero

  // 1. Garantía: capturar los cargos (hasta lo retenido) y liberar el resto
  const g = await garantiaVigente(empresaId, reservaId);
  let capturado = 0, liberado = 0, gRetenida = 0, simulado = false;
  if (g && etapaGarantia(g) === 'retenida') {
    gRetenida = g.monto;
    const captura = Math.min(total, g.monto);
    const motivo = `Liquidación ${liq.folio}`;
    const r = captura > 0 ? await capturar(empresaId, g.id, captura, { usuarioId, motivo }) : await liberar(empresaId, g.id, { usuarioId, motivo });
    capturado = r.monto_capturado || 0; liberado = r.monto_liberado || 0; simulado = esSimulado(r);
  }
  // 2. Saldo por cobrar (cargos mayores que la garantía) → enlace de pago
  const saldo = Math.max(0, total - capturado);
  let link = null;
  if (saldo > 0) link = await crearLink({ empresaId, reservaId, concepto: 'liquidacion', monto: saldo, proveedor: opciones.proveedor_saldo === 'mercadopago' ? 'mercadopago' : 'webpay', usuarioId });

  // 3. TAG, multas, incidentes, reserva y vehículo
  const linea = (c) => liq.lineas.find((l) => l.codigo === c);
  const final = await transaccion(async (tx) => {
    const lt = linea('tag'), lm = linea('multas');
    if (lt?.ids?.length) await tx.query(`UPDATE tag_transitos SET estado = $3 WHERE empresa_id = $1 AND id = ANY($2::bigint[]) AND estado = 'asignado'`, [empresaId, lt.ids, lt.incluir && lt.monto > 0 ? 'cobrado' : 'condonado']);
    if (lm?.ids?.length) await tx.query(`UPDATE multas SET estado = $3 WHERE empresa_id = $1 AND id = ANY($2::bigint[]) AND estado IN ('asignada','notificada')`, [empresaId, lm.ids, lm.incluir && lm.monto > 0 ? 'cobrada' : (lm.editado ? 'condonada' : 'asignada')]);
    for (const l of liq.lineas.filter((x) => x.codigo.startsWith('dano:') && x.incluir && x.monto > 0)) {
      const id = Number(l.codigo.split(':')[1]);
      const [inc] = await tx.query(`UPDATE incidentes SET estado = 'cobrado_cliente', cobrado_cliente = cobrado_cliente + $3, monto_cliente = COALESCE(monto_cliente, $3)
                                     WHERE id = $1 AND empresa_id = $2 RETURNING id`, [id, empresaId, l.monto]);
      if (inc) await tx.query(`INSERT INTO incidente_eventos (empresa_id, incidente_id, tipo, detalle, monto, usuario_id) VALUES ($1,$2,'cobro',$3,$4,$5)`,
        [empresaId, id, `Cobrado al cliente en la liquidación ${liq.folio}${capturado ? ' (captura de la garantía)' : ''}`, l.monto, usuarioId]);
    }
    await cambiarEstado(tx, { id: reservaId, empresa_id: empresaId }, 'cerrada', usuarioId ? { id: usuarioId } : null);
    const [x] = await tx.query(`UPDATE liquidaciones SET estado = $2, total_cargos = $3, garantia_retenida = $4, garantia_capturada = $5, garantia_liberada = $6, saldo_por_cobrar = $7,
                                  aprobado_por = $8, aprobado_en = now(), opciones = $9, pago_saldo_id = $10, actualizado_en = now() WHERE id = $1 RETURNING *`,
      [liq.id, saldo > 0 ? 'aprobada' : 'cobrada', total, gRetenida, capturado, liberado, saldo, usuarioId, JSON.stringify({ ...opciones, simulado }), link?.pago.id ?? null]);
    return x;
  });
  await bit(empresaId, usuarioId, 'liquidacion_aprobada', liq.id, { reserva_id: reservaId, total, capturado, liberado, saldo, simulado });

  // 4. Documento tributario
  let dte = null, dteError = null;
  if (docTipo && total > 0) {
    try { dte = await emitirDocumento({ empresaId, tipo: docTipo, reservaId, liquidacionId: liq.id, receptor, lineas: incluidas.map((l) => ({ nombre: l.concepto, descripcion: l.calculo, monto: l.monto })), usuarioId }); }
    catch (e) { dteError = e.message; }
  }

  // 5. PDF y aviso al cliente
  const vista = await obtener(empresaId, reservaId);
  const empresa = await uno('SELECT id, nombre, rut, razon_social, giro, direccion, comuna, ciudad, telefono, correo, logo_clave FROM empresas WHERE id = $1', [empresaId]);
  const pdf = await pdfLiquidacion({ ...vista, empresa, link_saldo: link?.url });
  const arch = await guardarArchivo({ empresaId, entidad: 'liquidacion', entidadId: liq.id, tipo: 'pdf', nombre: `Liquidacion-${reserva.folio}.pdf`, mime: 'application/pdf', datos: pdf, usuarioId });
  await q('UPDATE liquidaciones SET pdf_archivo_id = $2 WHERE id = $1', [liq.id, arch.id]);
  const cli = reserva.cliente || {};
  const detalle = incluidas.map((l) => `• ${l.concepto}: ${clp(l.monto)}`).join('\n') + (saldo > 0 ? `\n\nSaldo por pagar: ${clp(saldo)} · ${link.url}` : '');
  const salidas = await avisar({
    empresaId, clave: 'liquidacion', entidad: 'liquidacion', entidadId: liq.id,
    correo: opciones.avisar_correo === false ? null : cli.correo, telefono: opciones.avisar_whatsapp === false ? null : cli.telefono,
    adjuntos: [{ archivo_id: arch.id, nombre: `Liquidacion-${reserva.folio}.pdf` }],
    datos: { cliente: { nombre: cli.nombre }, reserva: { folio: reserva.folio }, empresa: { nombre: empresa.nombre },
      liquidacion: { folio: liq.folio, total_cargos: clp(total), garantia_liberada: clp(liberado), saldo: clp(saldo), detalle: detalle || 'Sin cargos adicionales.' }, url_pago: link?.url || '' }
  });
  return { liquidacion: { ...final, pdf_archivo_id: arch.id }, capturado, liberado, saldo, link: link?.url || null, simulado, dte, dte_error: dteError, salidas: salidas.filter(Boolean).map((s) => ({ canal: s.canal, estado: s.estado, error: s.error })) };
}

// Listado: pendientes (reservas devueltas sin liquidación aprobada) e historial
export async function listar(empresaId, { vista = 'pendientes', q: buscar = '' } = {}) {
  const t = `%${String(buscar).trim().replace(/[-\s]/g, '%')}%`;
  const base = `SELECT r.id AS reserva_id, r.folio AS reserva_folio, r.estado AS reserva_estado, r.fin, r.devolucion_real, r.garantia,
      v.patente, v.marca, v.modelo, trim(coalesce(c.nombre,'') || ' ' || coalesce(c.apellidos,'')) AS cliente,
      l.id, l.folio, l.estado, l.total_cargos, l.garantia_retenida, l.garantia_capturada, l.garantia_liberada, l.saldo_por_cobrar, l.aprobado_en, l.pdf_archivo_id,
      u.nombre AS aprobado_por_nombre,
      (SELECT p.estado FROM pagos p WHERE p.reserva_id = r.id AND p.concepto = 'garantia' ORDER BY p.id DESC LIMIT 1) AS garantia_estado,
      (SELECT p.monto FROM pagos p WHERE p.reserva_id = r.id AND p.concepto = 'garantia' ORDER BY p.id DESC LIMIT 1) AS garantia_pago,
      (SELECT p.vence_retencion FROM pagos p WHERE p.reserva_id = r.id AND p.concepto = 'garantia' ORDER BY p.id DESC LIMIT 1) AS garantia_vence
    FROM reservas r LEFT JOIN liquidaciones l ON l.reserva_id = r.id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
    LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN usuarios u ON u.id = l.aprobado_por
   WHERE r.empresa_id = $1 AND ($2 = '%%' OR r.folio ILIKE $2 OR l.folio ILIKE $2 OR v.patente ILIKE $2 OR (c.nombre || ' ' || coalesce(c.apellidos,'')) ILIKE $2)`;
  if (vista === 'historial') return q(`${base} AND l.estado IN ('aprobada','cobrada','anulada') ORDER BY l.aprobado_en DESC NULLS LAST LIMIT 300`, [empresaId, t]);
  return q(`${base} AND r.estado = 'devuelta' AND (l.id IS NULL OR l.estado = 'borrador') ORDER BY coalesce(r.devolucion_real, r.fin) LIMIT 300`, [empresaId, t]);
}

export async function pdfDe(empresaId, reservaId) {
  const vista = await obtener(empresaId, reservaId);
  const empresa = await uno('SELECT id, nombre, rut, razon_social, giro, direccion, comuna, ciudad, telefono, correo, logo_clave FROM empresas WHERE id = $1', [empresaId]);
  return { pdf: await pdfLiquidacion({ ...vista, empresa }), nombre: `Liquidacion-${vista.reserva.folio}.pdf` };
}

