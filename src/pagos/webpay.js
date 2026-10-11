// Transbank Webpay Plus (API REST v1.2, sin SDK). Cobro normal y captura diferida (garantía: retener → capturar o reversar).
// Documentación: https://www.transbankdevelopers.cl/referencia/webpay
//   crear     POST /rswebpaytransaction/api/webpay/v1.2/transactions            {buy_order, session_id, amount, return_url}
//   confirmar PUT  /rswebpaytransaction/api/webpay/v1.2/transactions/{token}
//   estado    GET  /rswebpaytransaction/api/webpay/v1.2/transactions/{token}
//   capturar  PUT  /rswebpaytransaction/api/webpay/v1.2/transactions/{token}/capture {buy_order, authorization_code, capture_amount}
//   reversar / anular  POST /rswebpaytransaction/api/webpay/v1.2/transactions/{token}/refunds {amount}
// Cabeceras: Tbk-Api-Key-Id (código de comercio) y Tbk-Api-Key-Secret.

export const BASES = { integracion: 'https://webpay3gint.transbank.cl', produccion: 'https://webpay3g.transbank.cl' };
const RUTA = '/rswebpaytransaction/api/webpay/v1.2/transactions';

// Credenciales públicas del ambiente de integración (documentación de Transbank).
export const INTEGRACION = {
  codigo_comercio: '597055555532',
  codigo_comercio_diferido: '597055555540',
  api_key: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C'
};

// Código de respuesta 0 = aprobada; el resto, rechazada.
export const aprobada = (r) => r?.status === 'AUTHORIZED' && Number(r?.response_code) === 0;

// Tipos de pago de Webpay → texto para pantalla.
export const TIPO_PAGO = { VD: 'Débito', VN: 'Crédito', VC: 'Crédito en cuotas', SI: '3 cuotas sin interés', S2: '2 cuotas sin interés', NC: 'N cuotas sin interés', VP: 'Prepago' };

// Credenciales efectivas: en integración, si faltan, se usan las públicas de prueba.
export function credenciales(config = {}, diferido = false) {
  const ambiente = config.ambiente === 'produccion' ? 'produccion' : 'integracion';
  const integ = ambiente === 'integracion';
  const codigo = diferido ? (config.codigo_comercio_diferido || (integ ? INTEGRACION.codigo_comercio_diferido : '')) : (config.codigo_comercio || (integ ? INTEGRACION.codigo_comercio : ''));
  const secreto = config.api_key || (integ ? INTEGRACION.api_key : '');
  return { ambiente, base: BASES[ambiente], codigo, secreto };
}

// buy_order: máx. 26 caracteres alfanuméricos; session_id: máx. 61.
export const ordenCompra = (empresaId, pagoId) => `RC${empresaId}P${pagoId}T${Date.now().toString(36)}`.slice(0, 26);

export function crearClienteWebpay(config = {}, { diferido = false, fetch: f = globalThis.fetch } = {}) {
  const c = credenciales(config, diferido);
  if (!c.codigo || !c.secreto) throw new Error(`Faltan el código de comercio${diferido ? ' de captura diferida' : ''} o la API Key de Webpay Plus`);

  async function llamar(metodo, ruta, cuerpo) {
    let r;
    try {
      r = await f(`${c.base}${RUTA}${ruta}`, {
        method: metodo,
        headers: { 'Tbk-Api-Key-Id': c.codigo, 'Tbk-Api-Key-Secret': c.secreto, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(30000)
      });
    } catch (e) { throw new Error(`No se pudo conectar con Webpay: ${e.message}`); }
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { texto: txt }; }
    if (!r.ok) {
      const motivo = r.status === 401 ? 'credenciales rechazadas (código de comercio o API Key)' : j?.error_message || `error ${r.status}`;
      throw Object.assign(new Error(`Webpay: ${motivo}`), { estado: 502, respuesta: j });
    }
    return j;
  }

  return {
    ambiente: c.ambiente,
    codigoComercio: c.codigo,
    // → { token, url }  (el navegador debe hacer POST a url con token_ws=token)
    crear: ({ buyOrder, sessionId, amount, returnUrl }) => llamar('POST', '', { buy_order: String(buyOrder), session_id: String(sessionId), amount: Math.round(Number(amount)), return_url: returnUrl }),
    confirmar: (token) => llamar('PUT', `/${encodeURIComponent(token)}`),
    estado: (token) => llamar('GET', `/${encodeURIComponent(token)}`),
    capturar: (token, { buyOrder, authorizationCode, amount }) => llamar('PUT', `/${encodeURIComponent(token)}/capture`, { buy_order: String(buyOrder), authorization_code: String(authorizationCode), capture_amount: Math.round(Number(amount)) }),
    // Sobre una transacción diferida sin capturar = reversa (libera la retención). Sobre una pagada = anulación (reembolso).
    reembolsar: (token, amount) => llamar('POST', `/${encodeURIComponent(token)}/refunds`, { amount: Math.round(Number(amount)) })
  };
}
