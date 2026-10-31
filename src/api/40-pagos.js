// Módulo 7 · Pagos y garantías: listado, pagos presenciales, cobro en línea (Webpay Plus / Mercado Pago), enlaces de pago,
// garantías (retener → capturar parcial o liberar), reembolsos y retornos públicos desde los proveedores.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { limitar } from '../limite.js';
import { registrar } from '../bitacora.js';
import { encolar } from '../salidas.js';
import { clp, fechaHora } from '../util/formato.js';
import {
  iniciarCobro, confirmarRetorno, capturar, liberar, reembolsar, registrarManual, crearLink, abrirLink, webhookMercadoPago,
  etapaGarantia, esSimulado, cobrado, urlResultado, verificarFirma, htmlRedireccion, resumenReserva, CONCEPTOS, METODOS
} from '../pagos/index.js';

const r = express.Router();

const SELECT_PAGO = `SELECT p.*, r.folio AS reserva_folio, r.estado AS reserva_estado, v.patente,
       trim(coalesce(c.nombre,'') || ' ' || coalesce(c.apellidos,'')) AS cliente, u.nombre AS registrado_por_nombre
  FROM pagos p LEFT JOIN reservas r ON r.id = p.reserva_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
  LEFT JOIN clientes c ON c.id = p.cliente_id LEFT JOIN usuarios u ON u.id = p.registrado_por`;

const decorar = (p) => ({ ...p, simulado: esSimulado(p), etapa: etapaGarantia(p), cobrado: cobrado(p) });

// Listado con filtros y totales. ?reserva_id= lo usa la ficha de la reserva.
r.get('/pagos', requiere('pagos', 'ver'), async (req, res) => {
  const f = req.query;
  const cond = ['p.empresa_id = $1'], vals = [req.empresaId];
  const add = (sql, v) => { vals.push(v); cond.push(sql.replace('?', `$${vals.length}`)); };
  if (f.reserva_id) add('p.reserva_id = ?', Number(f.reserva_id));
  if (f.concepto) add('p.concepto = ?', f.concepto);
  if (f.metodo) add('p.metodo = ?', f.metodo);
  if (f.estado === 'simulado') cond.push(`(p.estado = 'simulado' OR (p.detalle->>'simulado')::boolean IS TRUE)`);
  else if (f.estado) add('p.estado = ?', f.estado);
  if (f.desde) add(`p.creado_en >= (?::date)::timestamp AT TIME ZONE 'America/Santiago'`, f.desde);
  if (f.hasta) add(`p.creado_en < ((?::date + 1)::timestamp AT TIME ZONE 'America/Santiago')`, f.hasta);
  if (f.q) add(`(r.folio ILIKE ? OR c.nombre || ' ' || coalesce(c.apellidos,'') ILIKE $${vals.length} OR p.referencia ILIKE $${vals.length} OR v.patente ILIKE $${vals.length})`, `%${String(f.q).replace(/[-\s]/g, '%')}%`);
  const filas = (await q(`${SELECT_PAGO} WHERE ${cond.join(' AND ')} ORDER BY p.creado_en DESC, p.id DESC LIMIT 500`, vals)).map(decorar);
  const totales = { cobrado: 0, pendiente: 0, reembolsado: 0, garantias_retenidas: 0, garantias_n: 0, simulados: 0, cantidad: filas.length };
  for (const p of filas) {
    if (p.concepto === 'reembolso') { if (['pagado', 'simulado'].includes(p.estado)) totales.reembolsado += p.monto; continue; }
    totales.cobrado += p.cobrado;
    if (p.estado === 'pendiente' && p.concepto !== 'garantia') totales.pendiente += p.monto;
    if (p.etapa === 'retenida') { totales.garantias_retenidas += p.monto; totales.garantias_n++; }
    if (p.simulado) totales.simulados++;
  }
  totales.neto = totales.cobrado - totales.reembolsado;
  res.json({ pagos: filas, totales });
});

// Garantías: retenidas, por vencer, capturadas y liberadas
r.get('/pagos/garantias', requiere('pagos', 'ver'), async (req, res) => {
  const filas = (await q(`${SELECT_PAGO} WHERE p.empresa_id = $1 AND p.concepto = 'garantia' AND p.estado NOT IN ('rechazado')
                          ORDER BY (p.estado IN ('retenido','simulado'))::int DESC, p.vence_retencion NULLS LAST, p.id DESC LIMIT 300`, [req.empresaId])).map(decorar);
  const emp = await uno('SELECT ajustes FROM empresas WHERE id = $1', [req.empresaId]);
  res.json({ garantias: filas.map((g) => ({ ...g, dias_restantes: g.vence_retencion ? Math.ceil((new Date(g.vence_retencion) - Date.now()) / 864e5) : null })), dias_retencion: Number(emp?.ajustes?.garantia_dias_retencion) || 30 });
});

// Resumen de pagos de una reserva (ficha de la reserva y portal)
r.get('/pagos/resumen/:reservaId', requiere('pagos', 'ver'), async (req, res) => {
  const s = await resumenReserva(req.empresaId, Number(req.params.reservaId));
  res.json({ ...s, pagos: s.pagos.map(decorar), garantia: s.garantia ? decorar(s.garantia) : null });
});

// Buscador de reservas para los formularios (folio, cliente, patente) con lo pagado y la garantía
r.get('/pagos/reservas', requiere('pagos', 'ver'), async (req, res) => {
  const t = `%${String(req.query.q || '').trim().replace(/[-\s]/g, '%')}%`;
  const filas = await q(`SELECT r.id, r.folio, r.estado, r.total, r.garantia, r.inicio, r.fin, v.patente,
        trim(coalesce(c.nombre,'') || ' ' || coalesce(c.apellidos,'')) AS cliente, c.correo, c.telefono,
        coalesce((SELECT sum(CASE WHEN p.estado IN ('pagado','simulado') THEN p.monto ELSE 0 END) FROM pagos p WHERE p.reserva_id = r.id AND p.concepto = 'arriendo'), 0) AS pagado,
        (SELECT p.estado FROM pagos p WHERE p.reserva_id = r.id AND p.concepto = 'garantia' ORDER BY p.id DESC LIMIT 1) AS garantia_estado
      FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
     WHERE r.empresa_id = $1 AND r.estado NOT IN ('cancelada','no_show')
       AND ($2 = '%%' OR r.folio ILIKE $2 OR (c.nombre || ' ' || coalesce(c.apellidos,'')) ILIKE $2 OR v.patente ILIKE $2 OR c.documento ILIKE $2)
     ORDER BY (r.estado IN ('confirmada','en_curso','devuelta'))::int DESC, r.inicio DESC LIMIT 20`, [req.empresaId, t]);
  res.json(filas.map((x) => ({ ...x, saldo: Math.max(0, x.total - x.pagado) })));
});

// Pago presencial: efectivo, transferencia o POS
r.post('/pagos/manual', requiere('pagos', 'editar'), async (req, res) => {
  const b = req.body || {};
  const p = await registrarManual({ empresaId: req.empresaId, reservaId: b.reserva_id ? Number(b.reserva_id) : null, concepto: b.concepto || 'arriendo', metodo: b.metodo, monto: b.monto, referencia: b.referencia, tarjeta: b.tarjeta, notas: b.notas, usuarioId: req.usuario.id });
  res.json(decorar(p));
});

// Cobro en línea desde el counter (abre Webpay o Mercado Pago en este navegador)
r.post('/pagos/cobrar', requiere('pagos', 'editar'), async (req, res) => {
  const b = req.body || {};
  res.json(await iniciarCobro({ empresaId: req.empresaId, reservaId: b.reserva_id ? Number(b.reserva_id) : null, concepto: b.concepto || 'arriendo', monto: b.monto, proveedor: b.proveedor || 'webpay', urlRetorno: '/pagos', usuarioId: req.usuario.id }));
});

// Enlace de pago para enviar por WhatsApp o correo
r.post('/pagos/link', requiere('pagos', 'editar'), async (req, res) => {
  const b = req.body || {};
  const { pago, url, reserva } = await crearLink({ empresaId: req.empresaId, reservaId: b.reserva_id ? Number(b.reserva_id) : null, concepto: b.concepto || 'arriendo', monto: b.monto, proveedor: b.proveedor || 'webpay', usuarioId: req.usuario.id });
  const emp = await uno('SELECT nombre FROM empresas WHERE id = $1', [req.empresaId]);
  const texto = `Hola ${reserva?.nombre || ''}, ${emp.nombre} te envía el enlace para pagar ${CONCEPTOS[pago.concepto].toLowerCase()}${reserva ? ` de tu reserva ${reserva.folio}` : ''} por ${clp(pago.monto)}: ${url}`;
  const salidas = [];
  const canales = Array.isArray(b.enviar) ? b.enviar : [];
  if (canales.includes('whatsapp') && (b.telefono || reserva?.telefono)) salidas.push(await encolar({ empresaId: req.empresaId, canal: 'whatsapp', destino: b.telefono || reserva.telefono, cuerpo: texto, entidad: 'pago', entidadId: pago.id }));
  if (canales.includes('correo') && (b.correo || reserva?.correo)) salidas.push(await encolar({ empresaId: req.empresaId, canal: 'correo', destino: b.correo || reserva.correo, asunto: `Enlace de pago${reserva ? ` · reserva ${reserva.folio}` : ''} · ${emp.nombre}`, cuerpo: texto, entidad: 'pago', entidadId: pago.id }));
  res.json({ pago: decorar(pago), url, texto, salidas: salidas.filter(Boolean).map((s) => ({ id: s.id, canal: s.canal, destino: s.destino, estado: s.estado, error: s.error })) });
});

r.post('/pagos/:id/capturar', requiere('pagos', 'editar'), async (req, res) => {
  res.json(decorar(await capturar(req.empresaId, Number(req.params.id), req.body?.monto, { usuarioId: req.usuario.id, motivo: req.body?.motivo || null })));
});
r.post('/pagos/:id/liberar', requiere('pagos', 'editar'), async (req, res) => {
  res.json(decorar(await liberar(req.empresaId, Number(req.params.id), { usuarioId: req.usuario.id, motivo: req.body?.motivo || null })));
});
r.post('/pagos/:id/reembolsar', requiere('pagos', 'editar'), async (req, res) => {
  if (!String(req.body?.motivo || '').trim()) throw new ErrorHttp(400, 'Indica el motivo del reembolso', { campo: 'motivo' });
  res.json(decorar(await reembolsar(req.empresaId, Number(req.params.id), req.body?.monto, { usuarioId: req.usuario.id, motivo: req.body.motivo })));
});
// Anular un cobro pendiente (enlace que no se pagará)
r.post('/pagos/:id/anular', requiere('pagos', 'editar'), async (req, res) => {
  const [p] = await q(`UPDATE pagos SET estado = 'anulado', link_token = NULL, detalle = detalle || $3::jsonb, actualizado_en = now()
                        WHERE id = $1 AND empresa_id = $2 AND estado = 'pendiente' RETURNING *`, [req.params.id, req.empresaId, JSON.stringify({ motivo: req.body?.motivo || 'Anulado' })]);
  if (!p) throw new ErrorHttp(409, 'Solo se anulan cobros pendientes');
  await registrar(req, 'pago_anulado', 'pago', p.id, { motivo: req.body?.motivo || null });
  res.json(decorar(p));
});

r.get('/pagos/:id', requiere('pagos', 'ver'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return next();
  const p = await uno(`${SELECT_PAGO} WHERE p.id = $1 AND p.empresa_id = $2`, [req.params.id, req.empresaId]);
  if (!p) throw new ErrorHttp(404, 'Pago no encontrado');
  const historial = await q(`SELECT b.accion, b.detalle, b.creado_en, u.nombre AS usuario FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
                              WHERE b.empresa_id = $1 AND b.entidad = 'pago' AND b.entidad_id = $2 ORDER BY b.id`, [req.empresaId, p.id]);
  res.json({ ...decorar(p), historial: historial.map((h) => ({ ...h, cuando: fechaHora(h.creado_en) })), metodo_nombre: METODOS[p.metodo] });
});

// ── Públicos (sin sesión): retornos, notificaciones, enlace de pago y página de resultado ──
const aResultado = (res, pago) => res.redirect(303, urlResultado(pago.id));
const errorPublico = (res, e) => res.redirect(303, `/pago-resultado?error=${encodeURIComponent(e.message || 'No se pudo confirmar el pago')}`);

const retornoWebpay = async (req, res) => {
  try { aResultado(res, await confirmarRetorno('webpay', { ...req.query, ...(req.body || {}) })); }
  catch (e) { errorPublico(res, e); }
};
r.get('/pagos/retorno/webpay', retornoWebpay);
r.post('/pagos/retorno/webpay', retornoWebpay);
r.get('/pagos/retorno/mercadopago', async (req, res) => {
  try { aResultado(res, await confirmarRetorno('mercadopago', req.query)); }
  catch (e) { errorPublico(res, e); }
});
r.post('/pagos/webhook/mercadopago', async (req, res) => {
  try { res.json(await webhookMercadoPago(Number(req.query.empresa) || null, req.body || {}, req.query)); }
  catch (e) { console.error('[webhook mercadopago]', e.message); res.status(200).json({ ok: false }); } // 200 para que MP no reintente sin fin
});
// Enlaces públicos de pago (31-oct): límite por IP para que nadie recorra tokens o ids a ciegas.
r.use(['/pagos/link', '/pagos/publico'], limitar({ nombre: 'pagos-publico', max: 120, ventanaMs: 60e3 }));
r.get('/pagos/link/:token', async (req, res) => {
  try {
    const x = await abrirLink(req.params.token);
    if (x.redirigir.metodo === 'POST') return res.type('html').send(htmlRedireccion(x.redirigir));
    res.redirect(303, x.redirigir.url);
  } catch (e) { errorPublico(res, e); }
});
r.get('/pagos/publico/:id', async (req, res) => {
  if (!verificarFirma(req.params.id, req.query.t)) throw new ErrorHttp(404, 'Pago no encontrado');
  const p = await uno(`SELECT p.id, p.concepto, p.metodo, p.estado, p.monto, p.tarjeta, p.autorizacion, p.detalle, p.creado_en, p.actualizado_en, p.vence_retencion,
                              r.folio AS reserva_folio, e.nombre AS empresa, e.slug, e.color, e.logo_clave IS NOT NULL AS tiene_logo, e.telefono, e.correo
                         FROM pagos p JOIN empresas e ON e.id = p.empresa_id LEFT JOIN reservas r ON r.id = p.reserva_id WHERE p.id = $1`, [req.params.id]);
  if (!p) throw new ErrorHttp(404, 'Pago no encontrado');
  res.json({
    id: p.id, concepto: p.concepto, concepto_nombre: CONCEPTOS[p.concepto], metodo: METODOS[p.metodo], estado: p.estado, monto: p.monto, tarjeta: p.tarjeta,
    autorizacion: p.autorizacion, simulado: esSimulado(p), motivo: p.detalle?.motivo || null, motivo_simulado: p.detalle?.motivo_simulado || null,
    tipo_pago: p.detalle?.tipo_pago || null, cuotas: p.detalle?.cuotas || null, fecha: p.actualizado_en, vence_retencion: p.vence_retencion,
    reserva_folio: p.reserva_folio, url_retorno: p.detalle?.url_retorno || null,
    empresa: { nombre: p.empresa, slug: p.slug, color: p.color, logo: p.tiene_logo, telefono: p.telefono, correo: p.correo }
  });
});

export default r;
