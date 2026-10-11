// Pagos y garantía: interfaz común para Webpay Plus y Mercado Pago, usada por las pantallas internas y por el portal del cliente.
//
//   iniciarCobro({ empresaId, reservaId, concepto, monto, proveedor, urlRetorno, diferido, usuarioId, tarjeta })
//       → { pagoId, redirigir: { url, metodo: 'POST'|'GET', campos }, simulado }
//   confirmarRetorno(proveedor, datos)          → fila de pagos actualizada (datos = query o body del retorno)
//   capturar(empresaId, pagoId, monto, { usuarioId })   → captura parcial o total de una garantía retenida (el resto se libera)
//   liberar(empresaId, pagoId, { usuarioId })           → reversa la retención completa
//   reembolsar(empresaId, pagoId, monto, { usuarioId }) → devuelve dinero de un pago cobrado
//   registrarManual({ empresaId, reservaId, concepto, metodo, monto, referencia, usuarioId })
//   crearLink({ empresaId, reservaId, concepto, monto, proveedor, usuarioId }) → { pago, url }
//
// Marcha blanca o integración apagada: no se llama a nadie afuera. El pago queda «simulado» y el flujo sigue como aprobado,
// para poder probar el sistema completo de punta a punta.
import crypto from 'node:crypto';
import { q, uno } from '../db.js';
import { config } from '../config.js';
import { puedeActuar, leer } from '../integraciones/index.js';
import { registrarProbador } from '../integraciones/probadores.js';
import { registrar } from '../bitacora.js';
import { ErrorHttp } from '../auth.js';
import { clp } from '../util/formato.js';
import { crearClienteWebpay, ordenCompra, aprobada, TIPO_PAGO } from './webpay.js';
import { crearClienteMp, estadoDesdeMp } from './mercadopago.js';

export const CONCEPTOS = { arriendo: 'Arriendo', garantia: 'Garantía', liquidacion: 'Liquidación', reembolso: 'Reembolso', multa: 'Multa', tag: 'TAG', incidente: 'Incidente' };
export const METODOS = { webpay: 'Webpay Plus', mercadopago: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', pos: 'POS', otro: 'Otro' };
export const ESTADOS = { pendiente: 'Pendiente', autorizado: 'Autorizado', retenido: 'Retenida', capturado: 'Capturada', liberado: 'Liberada', pagado: 'Pagado', rechazado: 'Rechazado', anulado: 'Anulado', reembolsado: 'Reembolsado', simulado: 'Simulado' };
export const PROVEEDORES = ['webpay', 'mercadopago'];

// fetch intercambiable (las pruebas lo reemplazan por uno simulado)
let fetchPagos = (...a) => globalThis.fetch(...a);
export const usarFetch = (f) => { fetchPagos = f || ((...a) => globalThis.fetch(...a)); };

const bit = (empresaId, usuarioId, accion, id, detalle = {}) => registrar({ empresaId, usuario: usuarioId ? { id: usuarioId } : null }, accion, 'pago', id, detalle);
const fusionarDetalle = (id, extra) => q(`UPDATE pagos SET detalle = detalle || $2::jsonb, actualizado_en = now() WHERE id = $1`, [id, JSON.stringify(extra)]);

// Firma para las páginas públicas (resultado del pago): evita que se puedan recorrer pagos por id.
export const firmaPublica = (pagoId) => crypto.createHmac('sha256', config.secreto).update(`pago:${pagoId}`).digest('hex').slice(0, 20);
export const verificarFirma = (pagoId, t) => { const a = Buffer.from(firmaPublica(pagoId)), b = Buffer.from(String(t || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
export const urlResultado = (pagoId) => `/pago-resultado?pago=${pagoId}&t=${firmaPublica(pagoId)}`;

// ¿El pago cuenta como dinero recibido?
export const cobrado = (p) => (p.concepto === 'garantia' ? Number(p.monto_capturado || 0) : ['pagado', 'simulado', 'capturado'].includes(p.estado) ? Number(p.monto) : 0);
export const esSimulado = (p) => p.estado === 'simulado' || !!p.detalle?.simulado;

// Etapa de una garantía: solicitada → retenida → capturada (parcial) → liberada
export function etapaGarantia(p) {
  if (!p || p.concepto !== 'garantia') return null;
  if (p.estado === 'pendiente' || p.estado === 'autorizado') return 'solicitada';
  if (p.estado === 'retenido' || p.estado === 'simulado') return 'retenida';
  if (p.estado === 'capturado') return 'capturada';
  if (p.estado === 'liberado' || p.estado === 'anulado' || p.estado === 'reembolsado') return 'liberada';
  return p.estado; // rechazado
}

async function ajustes(empresaId) { return (await uno('SELECT ajustes FROM empresas WHERE id = $1', [empresaId]))?.ajustes || {}; }
const diasRetencion = (aj) => Math.max(1, Number(aj.garantia_dias_retencion) || 30);
const venceDesde = (aj) => new Date(Date.now() + diasRetencion(aj) * 864e5);

export async function obtenerPago(empresaId, pagoId) {
  const p = await uno('SELECT * FROM pagos WHERE id = $1 AND empresa_id = $2', [pagoId, empresaId]);
  if (!p) throw new ErrorHttp(404, 'Pago no encontrado');
  return p;
}

async function reservaDe(empresaId, reservaId) {
  if (!reservaId) return null;
  const r = await uno(`SELECT r.id, r.folio, r.cliente_id, r.garantia, r.total, c.nombre, c.apellidos, c.correo, c.telefono
                         FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id WHERE r.id = $1 AND r.empresa_id = $2`, [reservaId, empresaId]);
  if (!r) throw new ErrorHttp(404, 'Reserva no encontrada');
  return r;
}

const validarMonto = (monto) => {
  const m = Math.round(Number(monto));
  if (!Number.isFinite(m) || m <= 0) throw new ErrorHttp(400, 'El monto debe ser mayor que cero', { campo: 'monto' });
  if (m > 50_000_000) throw new ErrorHttp(400, 'El monto parece demasiado alto', { campo: 'monto' });
  return m;
};
const retornoSeguro = (u) => (typeof u === 'string' && u.startsWith('/') && !u.startsWith('//') ? u.slice(0, 300) : null);

// ── Cobro en línea ──
export async function iniciarCobro({ empresaId, reservaId = null, concepto = 'arriendo', monto, proveedor = 'webpay', urlRetorno = null, diferido = null, usuarioId = null, tarjeta = null, pagoId = null }) {
  if (!['arriendo', 'garantia', 'liquidacion', 'multa', 'tag', 'incidente'].includes(concepto)) throw new ErrorHttp(400, 'Concepto de pago no válido');
  if (!PROVEEDORES.includes(proveedor)) throw new ErrorHttp(400, 'Elige Webpay Plus o Mercado Pago');
  const m = validarMonto(monto);
  const res = await reservaDe(empresaId, reservaId);
  const dif = diferido ?? concepto === 'garantia';
  let pago;
  if (pagoId) {
    pago = await obtenerPago(empresaId, pagoId);
    if (pago.estado !== 'pendiente') throw new ErrorHttp(409, 'Este cobro ya fue procesado');
    [pago] = await q(`UPDATE pagos SET metodo = $2, detalle = detalle || $3::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`, [pago.id, proveedor, JSON.stringify({ diferido: dif, url_retorno: retornoSeguro(urlRetorno) ?? pago.detalle?.url_retorno ?? null })]);
  } else {
    [pago] = await q(`INSERT INTO pagos (empresa_id, reserva_id, cliente_id, concepto, metodo, estado, monto, registrado_por, detalle)
                      VALUES ($1,$2,$3,$4,$5,'pendiente',$6,$7,$8) RETURNING *`,
      [empresaId, res?.id ?? null, res?.cliente_id ?? null, concepto, proveedor, m, usuarioId, JSON.stringify({ diferido: dif, url_retorno: retornoSeguro(urlRetorno) })]);
  }
  const referencia = ordenCompra(empresaId, pago.id);
  await q('UPDATE pagos SET referencia = $2 WHERE id = $1', [pago.id, referencia]);
  const aj = await ajustes(empresaId);
  const p = await puedeActuar(empresaId, proveedor);

  if (!p.ok) {
    // Marcha blanca: queda simulado y el flujo continúa como aprobado.
    await q(`UPDATE pagos SET estado = 'simulado', autorizacion = $2, vence_retencion = $3, detalle = detalle || $4::jsonb, actualizado_en = now() WHERE id = $1`,
      [pago.id, `SIM-${String(pago.id).padStart(6, '0')}`, concepto === 'garantia' ? venceDesde(aj) : null, JSON.stringify({ simulado: true, motivo_simulado: p.motivo })]);
    await bit(empresaId, usuarioId, 'pago_simulado', pago.id, { concepto, monto: m, proveedor, motivo: p.motivo, reserva_id: res?.id });
    return { pagoId: pago.id, simulado: true, motivo: p.motivo, redirigir: { url: urlResultado(pago.id), metodo: 'GET', campos: {} } };
  }

  const titulo = `${CONCEPTOS[concepto]}${res ? ` reserva ${res.folio}` : ''}`;
  if (proveedor === 'webpay') {
    const wp = crearClienteWebpay(p.config, { diferido: dif, fetch: fetchPagos });
    const r = await wp.crear({ buyOrder: referencia, sessionId: `S${pago.id}`, amount: m, returnUrl: `${config.urlBase}/api/pagos/retorno/webpay` });
    await q(`UPDATE pagos SET token_externo = $2, detalle = detalle || $3::jsonb WHERE id = $1`, [pago.id, r.token, JSON.stringify({ ambiente: wp.ambiente, codigo_comercio: wp.codigoComercio })]);
    await bit(empresaId, usuarioId, 'pago_iniciado', pago.id, { concepto, monto: m, proveedor });
    return { pagoId: pago.id, simulado: false, redirigir: { url: r.url, metodo: 'POST', campos: { token_ws: r.token } } };
  }
  const mp = crearClienteMp(p.config, { fetch: fetchPagos });
  const urlWebhook = `${config.urlBase}/api/pagos/webhook/mercadopago?empresa=${empresaId}`;
  if (concepto === 'garantia' && tarjeta?.token) {
    // Garantía con el Card Payment Brick: pago autorizado sin capturar.
    const r = await mp.crearPagoAutorizado({ tokenTarjeta: tarjeta.token, metodoPago: tarjeta.metodo, cuotas: 1, monto: m, correo: tarjeta.correo || res?.correo, referencia, descripcion: titulo, urlWebhook });
    await actualizarDesdeMp(pago.id, r, aj);
    await bit(empresaId, usuarioId, 'pago_iniciado', pago.id, { concepto, monto: m, proveedor });
    return { pagoId: pago.id, simulado: false, redirigir: { url: urlResultado(pago.id), metodo: 'GET', campos: {} } };
  }
  // Checkout Pro (también para una garantía sin tarjeta tokenizada: se cobra y luego se reembolsa la diferencia).
  const r = await mp.crearPreferencia({ titulo, monto: m, referencia, urlRetorno: `${config.urlBase}/api/pagos/retorno/mercadopago`, urlWebhook, correo: res?.correo || null });
  await q(`UPDATE pagos SET token_externo = $2, detalle = detalle || $3::jsonb WHERE id = $1`, [pago.id, r.id, JSON.stringify({ mp_preferencia: r.id, ...(concepto === 'garantia' ? { garantia_como_cobro: true } : {}) })]);
  await bit(empresaId, usuarioId, 'pago_iniciado', pago.id, { concepto, monto: m, proveedor });
  return { pagoId: pago.id, simulado: false, redirigir: { url: r.init_point, metodo: 'GET', campos: {} } };
}

async function actualizarDesdeMp(pagoId, pagoMp, aj = {}) {
  const [actual] = await q('SELECT * FROM pagos WHERE id = $1', [pagoId]);
  let estado = estadoDesdeMp(pagoMp);
  // Garantía cobrada por Checkout Pro: se trata como retenida (al liberar se reembolsa).
  if (estado === 'pagado' && actual.concepto === 'garantia' && !['capturado', 'liberado'].includes(actual.estado)) estado = 'retenido';
  if (['capturado', 'liberado', 'reembolsado'].includes(actual.estado) && estado !== 'reembolsado') estado = actual.estado;
  const [p] = await q(`UPDATE pagos SET estado = $2, autorizacion = COALESCE($3, autorizacion), tarjeta = COALESCE($4, tarjeta),
                        vence_retencion = CASE WHEN concepto = 'garantia' AND vence_retencion IS NULL AND $2 = 'retenido' THEN $5::timestamptz ELSE vence_retencion END,
                        detalle = detalle || $6::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`,
    [pagoId, estado, pagoMp.authorization_code || (pagoMp.id ? String(pagoMp.id) : null), pagoMp.card?.last_four_digits || null, venceDesde(aj),
      JSON.stringify({ mp_pago: pagoMp.id, mp_estado: pagoMp.status, mp_detalle: pagoMp.status_detail, marca: pagoMp.payment_method_id || null })]);
  return p;
}

// ── Retorno desde el proveedor (navegador del cliente) ──
export async function confirmarRetorno(proveedor, datos = {}) {
  if (proveedor === 'webpay') return confirmarReservaPortal(await retornoWebpay(datos));
  if (proveedor === 'mercadopago') return confirmarReservaPortal(await retornoMp(datos));
  throw new ErrorHttp(400, 'Proveedor desconocido');
}

// Reserva del portal que quedó como cotización mientras el cliente pagaba: con el pago del arriendo aprobado se confirma
// (si el vehículo sigue libre; si no, queda como cotización y el equipo la resuelve).
async function confirmarReservaPortal(pago) {
  if (!pago || pago.concepto !== 'arriendo' || !['pagado', 'retenido', 'capturado'].includes(pago.estado) || !pago.reserva_id) return pago;
  const r = await uno(`SELECT id, empresa_id, folio, vehiculo_id, inicio, fin, estado, origen FROM reservas WHERE id = $1`, [pago.reserva_id]);
  if (!r || r.estado !== 'cotizacion' || r.origen !== 'portal') return pago;
  const { conflictos } = await import('../disponibilidad.js');
  if (r.vehiculo_id && (await conflictos(r.empresa_id, r.vehiculo_id, r.inicio, r.fin, { excluirReservaId: r.id })).length) return pago;
  const { siguienteFolio } = await import('../db.js');
  const folio = r.folio.startsWith('C-') ? await siguienteFolio(r.empresa_id, 'R') : r.folio;
  await q(`UPDATE reservas SET estado = 'confirmada', folio = $2, notas = trim(coalesce(notas,'') || $3), actualizado_en = now() WHERE id = $1`,
    [r.id, folio, folio !== r.folio ? ` Cotización ${r.folio} confirmada con pago en línea.` : '']);
  await bit(r.empresa_id, null, 'reserva_confirmada_por_pago', pago.id, { reserva: folio });
  return pago;
}

async function retornoWebpay(d) {
  // Flujo normal: token_ws. Cliente abortó: TBK_TOKEN + TBK_ORDEN_COMPRA. Tiempo agotado: solo TBK_ORDEN_COMPRA.
  if (!d.token_ws) {
    const pago = d.TBK_TOKEN ? await uno('SELECT * FROM pagos WHERE token_externo = $1', [d.TBK_TOKEN])
      : d.TBK_ORDEN_COMPRA ? await uno('SELECT * FROM pagos WHERE referencia = $1', [d.TBK_ORDEN_COMPRA]) : null;
    if (!pago) throw new ErrorHttp(404, 'No se encontró el pago');
    if (pago.estado !== 'pendiente') return pago;
    const motivo = d.TBK_TOKEN ? 'El cliente anuló el pago en Webpay' : 'Se agotó el tiempo para pagar en Webpay';
    const [p] = await q(`UPDATE pagos SET estado = 'anulado', detalle = detalle || $2::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`, [pago.id, JSON.stringify({ motivo })]);
    await bit(pago.empresa_id, null, 'pago_anulado', pago.id, { motivo });
    return p;
  }
  const pago = await uno('SELECT * FROM pagos WHERE token_externo = $1', [d.token_ws]);
  if (!pago) throw new ErrorHttp(404, 'No se encontró el pago');
  if (pago.estado !== 'pendiente') return pago; // recarga de la página: ya se confirmó
  const { config: conf } = await leer(pago.empresa_id, 'webpay');
  const wp = crearClienteWebpay(conf, { diferido: !!pago.detalle?.diferido, fetch: fetchPagos });
  let r;
  try { r = await wp.confirmar(d.token_ws); }
  catch (e) {
    // Si el commit falla (p. ej. ya confirmado), se consulta el estado.
    try { r = await wp.estado(d.token_ws); } catch { r = { status: 'FAILED', error: e.message }; }
  }
  const ok = aprobada(r);
  const aj = await ajustes(pago.empresa_id);
  const estado = !ok ? 'rechazado' : pago.concepto === 'garantia' || pago.detalle?.diferido ? 'retenido' : 'pagado';
  const [p] = await q(`UPDATE pagos SET estado = $2, autorizacion = $3, tarjeta = $4, vence_retencion = $5, detalle = detalle || $6::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`,
    [pago.id, estado, r.authorization_code || null, r.card_detail?.card_number || null, estado === 'retenido' ? venceDesde(aj) : null,
      JSON.stringify({ wp_estado: r.status, wp_codigo: r.response_code, tipo_pago: TIPO_PAGO[r.payment_type_code] || r.payment_type_code || null, cuotas: r.installments_number || null, fecha_transaccion: r.transaction_date || null })]);
  await bit(pago.empresa_id, null, ok ? (estado === 'retenido' ? 'garantia_retenida' : 'pago_aprobado') : 'pago_rechazado', pago.id, { monto: pago.monto, proveedor: 'webpay', autorizacion: r.authorization_code });
  return p;
}

async function retornoMp(d) {
  const ref = d.external_reference;
  const pago = ref ? await uno('SELECT * FROM pagos WHERE referencia = $1', [ref]) : null;
  if (!pago) throw new ErrorHttp(404, 'No se encontró el pago');
  const idMp = d.payment_id || d.collection_id;
  if (!idMp || idMp === 'null') {
    if (pago.estado === 'pendiente' && (d.status === 'null' || d.collection_status === 'null')) {
      const [p] = await q(`UPDATE pagos SET estado = 'anulado', detalle = detalle || '{"motivo":"El cliente volvió sin pagar"}'::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`, [pago.id]);
      return p;
    }
    return pago;
  }
  return sincronizarMp(pago, idMp);
}

async function sincronizarMp(pago, idMp) {
  const { config: conf } = await leer(pago.empresa_id, 'mercadopago');
  const mp = crearClienteMp(conf, { fetch: fetchPagos });
  const pm = await mp.obtenerPago(idMp); // nunca se confía en el estado que trae la URL: se consulta a MP
  if (pm.external_reference && pm.external_reference !== pago.referencia) throw new ErrorHttp(400, 'El pago no corresponde a esta referencia');
  const antes = pago.estado;
  const p = await actualizarDesdeMp(pago.id, pm, await ajustes(pago.empresa_id));
  if (antes !== p.estado) await bit(pago.empresa_id, null, `pago_${p.estado}`, pago.id, { monto: pago.monto, proveedor: 'mercadopago', mp_pago: pm.id });
  return p;
}

// Notificación de Mercado Pago: { type: 'payment', data: { id } } (o topic/id en la query, formato antiguo).
export async function webhookMercadoPago(empresaId, body = {}, query = {}) {
  const r = await webhookMercadoPagoBase(empresaId, body, query);
  if (r.pagoId) await confirmarReservaPortal(await uno('SELECT * FROM pagos WHERE id = $1', [r.pagoId]));
  return r;
}
async function webhookMercadoPagoBase(empresaId, body = {}, query = {}) {
  const tipo = body.type || body.topic || query.type || query.topic;
  const id = body.data?.id || query['data.id'] || query.id;
  if (tipo !== 'payment' || !id || !empresaId) return { ignorado: true };
  const { config: conf } = await leer(empresaId, 'mercadopago');
  if (!conf.access_token) return { ignorado: true };
  const pm = await crearClienteMp(conf, { fetch: fetchPagos }).obtenerPago(id);
  const pago = pm.external_reference ? await uno('SELECT * FROM pagos WHERE referencia = $1 AND empresa_id = $2', [pm.external_reference, empresaId]) : null;
  if (!pago) return { ignorado: true };
  const p = await actualizarDesdeMp(pago.id, pm, await ajustes(empresaId));
  return { pagoId: p.id, estado: p.estado };
}

// ── Garantía: capturar (parcial) o liberar ──
// Garantía presencial (voucher POS, efectivo): se captura o devuelve a mano, sin proveedor.
async function permisoProveedor(empresaId, p) {
  if (!PROVEEDORES.includes(p.metodo)) return { ok: false, manual: true, motivo: 'Garantía presencial: se resuelve en el local' };
  if (esSimulado(p)) return { ok: false, motivo: p.detalle?.motivo_simulado || 'Pago simulado' };
  return puedeActuar(empresaId, p.metodo);
}

function exigirRetenida(p) {
  if (p.concepto !== 'garantia') throw new ErrorHttp(400, 'Solo se capturan o liberan garantías');
  if (etapaGarantia(p) !== 'retenida') throw new ErrorHttp(409, `La garantía no está retenida (estado: ${ESTADOS[p.estado] || p.estado})`);
}

export async function capturar(empresaId, pagoId, monto, { usuarioId = null, motivo = null } = {}) {
  const p = await obtenerPago(empresaId, pagoId);
  exigirRetenida(p);
  const m = Math.round(Number(monto));
  if (!Number.isFinite(m) || m < 0) throw new ErrorHttp(400, 'Monto a capturar no válido');
  if (m === 0) return liberar(empresaId, pagoId, { usuarioId, motivo });
  if (m > p.monto) throw new ErrorHttp(400, `No se puede capturar más que lo retenido (${clp(p.monto)})`);
  const libera = p.monto - m;
  const pa = await permisoProveedor(empresaId, p);
  let extra = { captura_motivo: motivo };
  if (pa.manual) extra = { ...extra, captura_manual: true };
  else if (!pa.ok) extra = { ...extra, captura_simulada: true, simulado: true, motivo_simulado: pa.motivo };
  else if (p.metodo === 'webpay') {
    const wp = crearClienteWebpay(pa.config, { diferido: true, fetch: fetchPagos });
    const r = await wp.capturar(p.token_externo, { buyOrder: p.referencia, authorizationCode: p.autorizacion, amount: m });
    if (Number(r.response_code) !== 0) throw new ErrorHttp(502, `Webpay rechazó la captura (código ${r.response_code})`);
    extra = { ...extra, wp_captura: { autorizacion: r.authorization_code, fecha: r.authorization_date, monto: r.captured_amount } };
  } else if (p.metodo === 'mercadopago') {
    const mp = crearClienteMp(pa.config, { fetch: fetchPagos });
    if (p.detalle?.garantia_como_cobro) { if (libera > 0) await mp.reembolsar(p.detalle.mp_pago, libera); }
    else await mp.capturar(p.detalle?.mp_pago, m);
  }
  const [r] = await q(`UPDATE pagos SET estado = 'capturado', monto_capturado = $2, monto_liberado = $3, detalle = detalle || $4::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`,
    [p.id, m, libera, JSON.stringify(extra)]);
  await bit(empresaId, usuarioId, 'garantia_capturada', p.id, { capturado: m, liberado: libera, simulado: !pa.ok && !pa.manual, motivo });
  return r;
}

export async function liberar(empresaId, pagoId, { usuarioId = null, motivo = null } = {}) {
  const p = await obtenerPago(empresaId, pagoId);
  if (p.concepto === 'garantia' && etapaGarantia(p) === 'solicitada') {
    const [r] = await q(`UPDATE pagos SET estado = 'anulado', detalle = detalle || $2::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`, [p.id, JSON.stringify({ motivo: motivo || 'Solicitud de garantía anulada' })]);
    await bit(empresaId, usuarioId, 'garantia_anulada', p.id, { motivo });
    return r;
  }
  exigirRetenida(p);
  const pa = await permisoProveedor(empresaId, p);
  let extra = { liberacion_motivo: motivo };
  if (pa.manual) extra = { ...extra, liberacion_manual: true };
  else if (!pa.ok) extra = { ...extra, liberacion_simulada: true, simulado: true, motivo_simulado: pa.motivo };
  else if (p.metodo === 'webpay') {
    const wp = crearClienteWebpay(pa.config, { diferido: true, fetch: fetchPagos });
    const r = await wp.reembolsar(p.token_externo, p.monto);
    extra = { ...extra, wp_reversa: { tipo: r.type, codigo: r.response_code ?? null } };
  } else if (p.metodo === 'mercadopago') {
    const mp = crearClienteMp(pa.config, { fetch: fetchPagos });
    if (p.detalle?.garantia_como_cobro) await mp.reembolsar(p.detalle.mp_pago, p.monto);
    else await mp.cancelar(p.detalle?.mp_pago);
  }
  const [r] = await q(`UPDATE pagos SET estado = 'liberado', monto_liberado = monto, detalle = detalle || $2::jsonb, actualizado_en = now() WHERE id = $1 RETURNING *`, [p.id, JSON.stringify(extra)]);
  await bit(empresaId, usuarioId, 'garantia_liberada', p.id, { liberado: p.monto, simulado: !pa.ok && !pa.manual, motivo });
  return r;
}

// ── Reembolso de un pago cobrado (queda como pago «reembolso» aparte) ──
export async function reembolsar(empresaId, pagoId, monto, { usuarioId = null, motivo = null } = {}) {
  const p = await obtenerPago(empresaId, pagoId);
  if (!['pagado', 'simulado', 'capturado'].includes(p.estado) || p.concepto === 'reembolso') throw new ErrorHttp(409, 'Solo se reembolsan pagos cobrados');
  const ya = Number(p.detalle?.reembolsado || 0);
  const disponible = cobrado(p) - ya;
  const m = validarMonto(monto);
  if (m > disponible) throw new ErrorHttp(400, `Se puede reembolsar como máximo ${clp(disponible)}`);
  const manual = ['efectivo', 'transferencia', 'pos', 'otro'].includes(p.metodo);
  const pa = manual || esSimulado(p) ? { ok: false, motivo: manual ? 'Reembolso manual' : 'Pago simulado' } : await puedeActuar(empresaId, p.metodo);
  const extraOrigen = {};
  if (pa.ok && p.metodo === 'webpay') {
    const r = await crearClienteWebpay(pa.config, { diferido: !!p.detalle?.diferido, fetch: fetchPagos }).reembolsar(p.token_externo, m);
    extraOrigen.wp_reembolso = { tipo: r.type, codigo: r.response_code ?? null };
  } else if (pa.ok && p.metodo === 'mercadopago') {
    await crearClienteMp(pa.config, { fetch: fetchPagos }).reembolsar(p.detalle?.mp_pago, m);
  }
  const simulado = !pa.ok && !manual;
  const [reemb] = await q(`INSERT INTO pagos (empresa_id, reserva_id, cliente_id, concepto, metodo, estado, monto, referencia, registrado_por, detalle)
                           VALUES ($1,$2,$3,'reembolso',$4,$5,$6,$7,$8,$9) RETURNING *`,
    [empresaId, p.reserva_id, p.cliente_id, p.metodo, simulado ? 'simulado' : 'pagado', m, p.referencia, usuarioId, JSON.stringify({ pago_origen: p.id, motivo, simulado })]);
  const total = ya + m;
  await q(`UPDATE pagos SET estado = CASE WHEN $3 >= $4 AND concepto <> 'garantia' THEN 'reembolsado' ELSE estado END, detalle = detalle || $2::jsonb, actualizado_en = now() WHERE id = $1`,
    [p.id, JSON.stringify({ reembolsado: total, ...extraOrigen }), total, cobrado(p)]);
  await bit(empresaId, usuarioId, 'pago_reembolsado', p.id, { monto: m, motivo, simulado });
  return reemb;
}

// ── Pago presencial (efectivo, transferencia, POS) ──
export async function registrarManual({ empresaId, reservaId = null, concepto = 'arriendo', metodo, monto, referencia = null, usuarioId = null, tarjeta = null, notas = null }) {
  if (!['efectivo', 'transferencia', 'pos', 'otro'].includes(metodo)) throw new ErrorHttp(400, 'Método no válido: efectivo, transferencia o POS', { campo: 'metodo' });
  if (!CONCEPTOS[concepto] || concepto === 'reembolso') throw new ErrorHttp(400, 'Concepto no válido', { campo: 'concepto' });
  const m = validarMonto(monto);
  const res = await reservaDe(empresaId, reservaId);
  const garantia = concepto === 'garantia';
  const aj = garantia ? await ajustes(empresaId) : {};
  const [p] = await q(`INSERT INTO pagos (empresa_id, reserva_id, cliente_id, concepto, metodo, estado, monto, referencia, tarjeta, vence_retencion, registrado_por, detalle)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [empresaId, res?.id ?? null, res?.cliente_id ?? null, concepto, metodo, garantia ? 'retenido' : 'pagado', m, referencia ? String(referencia).slice(0, 120) : null,
      tarjeta ? String(tarjeta).replace(/\D/g, '').slice(-4) || null : null, garantia ? venceDesde(aj) : null, usuarioId, JSON.stringify({ manual: true, notas: notas || null })]);
  await bit(empresaId, usuarioId, 'pago_registrado', p.id, { concepto, metodo, monto: m, referencia, reserva_id: res?.id });
  return p;
}

// ── Enlace de pago para enviar al cliente ──
export async function crearLink({ empresaId, reservaId = null, concepto = 'arriendo', monto, proveedor = 'webpay', usuarioId = null }) {
  if (!PROVEEDORES.includes(proveedor)) throw new ErrorHttp(400, 'Elige Webpay Plus o Mercado Pago');
  const m = validarMonto(monto);
  const res = await reservaDe(empresaId, reservaId);
  const token = crypto.randomBytes(18).toString('base64url');
  const [p] = await q(`INSERT INTO pagos (empresa_id, reserva_id, cliente_id, concepto, metodo, estado, monto, link_token, registrado_por, detalle)
                       VALUES ($1,$2,$3,$4,$5,'pendiente',$6,$7,$8,$9) RETURNING *`,
    [empresaId, res?.id ?? null, res?.cliente_id ?? null, concepto, proveedor, m, token, usuarioId, JSON.stringify({ diferido: concepto === 'garantia', enlace: true })]);
  await bit(empresaId, usuarioId, 'enlace_pago_creado', p.id, { concepto, monto: m, proveedor });
  return { pago: p, url: `${config.urlBase}/api/pagos/link/${token}`, reserva: res };
}

// El cliente abre el enlace → se inicia el cobro en el proveedor (o se muestra el resultado si ya se pagó).
export async function abrirLink(token) {
  const p = await uno('SELECT * FROM pagos WHERE link_token = $1', [String(token || '')]);
  if (!p) throw new ErrorHttp(404, 'El enlace de pago no existe o venció');
  if (p.estado !== 'pendiente') return { pagoId: p.id, redirigir: { url: urlResultado(p.id), metodo: 'GET', campos: {} } };
  return iniciarCobro({ empresaId: p.empresa_id, reservaId: p.reserva_id, concepto: p.concepto, monto: p.monto, proveedor: p.metodo, pagoId: p.id });
}

// Garantía activa de una reserva (la más reciente no terminada)
export async function garantiaVigente(empresaId, reservaId, cx = null) {
  const ej = cx || { query: q };
  const [g] = await ej.query(`SELECT * FROM pagos WHERE empresa_id = $1 AND reserva_id = $2 AND concepto = 'garantia'
                               AND estado IN ('retenido','simulado','pendiente','autorizado','capturado','liberado') ORDER BY (estado IN ('retenido','simulado'))::int DESC, id DESC LIMIT 1`, [empresaId, reservaId]);
  return g || null;
}

// Totales de una reserva para la ficha: pagado, garantía, saldo
export async function resumenReserva(empresaId, reservaId) {
  const pagos = await q('SELECT * FROM pagos WHERE empresa_id = $1 AND reserva_id = $2 ORDER BY id', [empresaId, reservaId]);
  const arriendo = pagos.filter((p) => p.concepto === 'arriendo').reduce((s, p) => s + cobrado(p), 0);
  const reembolsos = pagos.filter((p) => p.concepto === 'reembolso' && ['pagado', 'simulado'].includes(p.estado)).reduce((s, p) => s + p.monto, 0);
  const garantia = pagos.filter((p) => p.concepto === 'garantia').at(-1) || null;
  return { pagos, arriendo_pagado: arriendo, reembolsos, garantia };
}

// HTML que envía el formulario al proveedor (Webpay exige POST con token_ws)
export function htmlRedireccion({ url, metodo = 'GET', campos = {} }) {
  const e = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Redirigiendo al pago…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F4F5F7;color:#14181E}</style></head>
<body><form id="f" method="${metodo === 'POST' ? 'POST' : 'GET'}" action="${e(url)}">${Object.entries(campos).map(([k, v]) => `<input type="hidden" name="${e(k)}" value="${e(v)}">`).join('')}
<noscript><button type="submit">Continuar al pago</button></noscript></form><p>Redirigiendo al pago seguro…</p>
<script>document.getElementById('f').submit();</script></body></html>`;
}

// ── Pruebas de conexión (Configuración › Integraciones) ──
registrarProbador('webpay', async (conf) => {
  const wp = crearClienteWebpay(conf, { fetch: fetchPagos });
  const r = await wp.crear({ buyOrder: `PRUEBA${Date.now().toString(36)}`.slice(0, 26), sessionId: 'prueba', amount: 10, returnUrl: `${config.urlBase}/api/pagos/retorno/webpay` });
  if (!r.token) throw new Error('Webpay no devolvió un token');
  let dif = '';
  if (conf.codigo_comercio_diferido || wp.ambiente === 'integracion') {
    try { await crearClienteWebpay(conf, { diferido: true, fetch: fetchPagos }).crear({ buyOrder: `PRUEBAD${Date.now().toString(36)}`.slice(0, 26), sessionId: 'prueba', amount: 10, returnUrl: `${config.urlBase}/api/pagos/retorno/webpay` }); dif = ' · captura diferida OK'; }
    catch (e) { dif = ` · captura diferida con error: ${e.message}`; }
  }
  return `Conectado a Webpay Plus (${wp.ambiente === 'produccion' ? 'producción' : 'integración'}, comercio ${wp.codigoComercio}): se creó una transacción de prueba de $10${dif}`;
});

registrarProbador('mercadopago', async (conf) => {
  const yo = await crearClienteMp(conf, { fetch: fetchPagos }).yo();
  return `Conectado a Mercado Pago como ${yo.nickname || yo.email || yo.id}${yo.site_id ? ` (${yo.site_id})` : ''}`;
});
