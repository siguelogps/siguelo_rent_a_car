// Mercado Pago (API REST, sin SDK).
//   Arriendo / liquidación: preferencia de Checkout Pro (POST /checkout/preferences) → el cliente paga en Mercado Pago.
//   Garantía: pago con capture:false (POST /v1/payments, requiere el token de tarjeta del Card Payment Brick) →
//             capturar PUT /v1/payments/{id} {capture:true, transaction_amount} o liberar PUT {status:'cancelled'}.
//   Reembolso: POST /v1/payments/{id}/refunds {amount}. Notificaciones: POST /api/pagos/webhook/mercadopago.
import crypto from 'node:crypto';

const BASE = 'https://api.mercadopago.com';

// Estado de un pago de MP → estado de la tabla pagos.
export function estadoDesdeMp(p) {
  switch (p?.status) {
    case 'approved': return 'pagado';
    case 'authorized': return 'retenido';
    case 'rejected': return 'rechazado';
    case 'cancelled': return 'anulado';
    case 'refunded': case 'charged_back': return 'reembolsado';
    default: return 'pendiente'; // pending, in_process, in_mediation
  }
}

export function crearClienteMp(config = {}, { fetch: f = globalThis.fetch } = {}) {
  const token = config.access_token;
  if (!token) throw new Error('Falta el access token de Mercado Pago');

  async function llamar(metodo, ruta, cuerpo, { idempotencia = false } = {}) {
    let r;
    try {
      r = await f(`${BASE}${ruta}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(idempotencia ? { 'X-Idempotency-Key': crypto.randomUUID() } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(30000)
      });
    } catch (e) { throw new Error(`No se pudo conectar con Mercado Pago: ${e.message}`); }
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { texto: txt }; }
    if (!r.ok) {
      const motivo = r.status === 401 ? 'access token rechazado' : j?.message || `error ${r.status}`;
      throw Object.assign(new Error(`Mercado Pago: ${motivo}`), { estado: 502, respuesta: j });
    }
    return j;
  }

  return {
    yo: () => llamar('GET', '/users/me'),
    // → { id, init_point, sandbox_init_point }
    crearPreferencia: ({ titulo, monto, referencia, urlRetorno, urlWebhook, correo = null }) => llamar('POST', '/checkout/preferences', {
      items: [{ title: String(titulo).slice(0, 250), quantity: 1, currency_id: 'CLP', unit_price: Math.round(Number(monto)) }],
      external_reference: referencia,
      back_urls: { success: urlRetorno, failure: urlRetorno, pending: urlRetorno },
      auto_return: 'approved',
      notification_url: urlWebhook,
      binary_mode: true,
      ...(correo ? { payer: { email: correo } } : {})
    }, { idempotencia: true }),
    // Garantía con tarjeta tokenizada (Card Payment Brick en el portal): queda autorizada, sin capturar.
    crearPagoAutorizado: ({ tokenTarjeta, metodoPago, cuotas = 1, monto, correo, referencia, descripcion, urlWebhook }) => llamar('POST', '/v1/payments', {
      token: tokenTarjeta, payment_method_id: metodoPago, installments: cuotas, transaction_amount: Math.round(Number(monto)),
      description: descripcion, external_reference: referencia, capture: false, payer: { email: correo }, notification_url: urlWebhook
    }, { idempotencia: true }),
    obtenerPago: (id) => llamar('GET', `/v1/payments/${encodeURIComponent(id)}`),
    buscarPorReferencia: (ref) => llamar('GET', `/v1/payments/search?external_reference=${encodeURIComponent(ref)}&sort=date_created&criteria=desc`),
    capturar: (id, monto) => llamar('PUT', `/v1/payments/${encodeURIComponent(id)}`, { capture: true, transaction_amount: Math.round(Number(monto)) }),
    cancelar: (id) => llamar('PUT', `/v1/payments/${encodeURIComponent(id)}`, { status: 'cancelled' }),
    reembolsar: (id, monto) => llamar('POST', `/v1/payments/${encodeURIComponent(id)}/refunds`, monto ? { amount: Math.round(Number(monto)) } : {}, { idempotencia: true })
  };
}
