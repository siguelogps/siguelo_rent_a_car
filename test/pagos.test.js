import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';
import { crearClienteWebpay, credenciales, INTEGRACION, BASES, aprobada } from '../src/pagos/webpay.js';
import { estadoDesdeMp, crearClienteMp } from '../src/pagos/mercadopago.js';

let t, admin, E, P;
before(async () => {
  t = await levantar();
  admin = await t.como('demo@siguelogps.cl');
  E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
  P = await import('../src/pagos/index.js');
});
after(async () => { P.usarFetch(null); await t.cerrar(); });

// fetch simulado que registra las llamadas y responde según la ruta
function fetchFalso(responder) {
  const llamadas = [];
  const f = async (url, op = {}) => {
    const c = { url, metodo: op.method || 'GET', headers: op.headers || {}, cuerpo: op.body ? JSON.parse(op.body) : null };
    llamadas.push(c);
    const [estado, json] = responder(c);
    return new Response(JSON.stringify(json), { status: estado, headers: { 'Content-Type': 'application/json' } });
  };
  return { f, llamadas };
}

const reservaDe = (folio) => t.db.uno('SELECT * FROM reservas WHERE empresa_id = $1 AND folio = $2', [E, folio]);

test('Webpay: arma las solicitudes REST (crear, confirmar, capturar diferido, reversar)', async () => {
  const { f, llamadas } = fetchFalso((c) => [200, c.metodo === 'POST' && c.url.endsWith('/transactions') ? { token: 'tok123', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' } : { response_code: 0, status: 'AUTHORIZED' }]);
  const wp = crearClienteWebpay({ ambiente: 'integracion' }, { fetch: f });
  const r = await wp.crear({ buyOrder: 'RC1P9', sessionId: 'S9', amount: 238455.4, returnUrl: 'http://x/api/pagos/retorno/webpay' });
  assert.equal(r.token, 'tok123');
  const c = llamadas[0];
  assert.equal(c.url, `${BASES.integracion}/rswebpaytransaction/api/webpay/v1.2/transactions`);
  assert.equal(c.metodo, 'POST');
  assert.equal(c.headers['Tbk-Api-Key-Id'], INTEGRACION.codigo_comercio);
  assert.equal(c.headers['Tbk-Api-Key-Secret'], INTEGRACION.api_key);
  assert.deepEqual(c.cuerpo, { buy_order: 'RC1P9', session_id: 'S9', amount: 238455, return_url: 'http://x/api/pagos/retorno/webpay' });
  await wp.confirmar('tok123');
  assert.equal(llamadas[1].metodo, 'PUT');
  assert.match(llamadas[1].url, /\/transactions\/tok123$/);

  const dif = crearClienteWebpay({ ambiente: 'integracion' }, { diferido: true, fetch: f });
  await dif.capturar('tokD', { buyOrder: 'RC1P10', authorizationCode: '184503', amount: 441980 });
  const cap = llamadas[2];
  assert.equal(cap.headers['Tbk-Api-Key-Id'], INTEGRACION.codigo_comercio_diferido);
  assert.equal(cap.metodo, 'PUT');
  assert.match(cap.url, /\/transactions\/tokD\/capture$/);
  assert.deepEqual(cap.cuerpo, { buy_order: 'RC1P10', authorization_code: '184503', capture_amount: 441980 });
  await dif.reembolsar('tokD', 500000);
  assert.match(llamadas[3].url, /\/transactions\/tokD\/refunds$/);
  assert.deepEqual(llamadas[3].cuerpo, { amount: 500000 });

  // producción exige credenciales propias
  assert.equal(credenciales({ ambiente: 'produccion', codigo_comercio: '5970', api_key: 'k' }).base, BASES.produccion);
  assert.throws(() => crearClienteWebpay({ ambiente: 'produccion' }), /código de comercio/);
  assert.equal(aprobada({ status: 'AUTHORIZED', response_code: 0 }), true);
  assert.equal(aprobada({ status: 'FAILED', response_code: -1 }), false);
});

test('Mercado Pago: estados y captura de un pago autorizado', async () => {
  assert.equal(estadoDesdeMp({ status: 'approved' }), 'pagado');
  assert.equal(estadoDesdeMp({ status: 'authorized' }), 'retenido');
  assert.equal(estadoDesdeMp({ status: 'in_process' }), 'pendiente');
  const { f, llamadas } = fetchFalso(() => [200, { id: 77, status: 'approved' }]);
  const mp = crearClienteMp({ access_token: 'TEST-1' }, { fetch: f });
  await mp.capturar(77, 120000);
  assert.equal(llamadas[0].url, 'https://api.mercadopago.com/v1/payments/77');
  assert.equal(llamadas[0].metodo, 'PUT');
  assert.equal(llamadas[0].headers.Authorization, 'Bearer TEST-1');
  assert.deepEqual(llamadas[0].cuerpo, { capture: true, transaction_amount: 120000 });
  await mp.cancelar(77);
  assert.deepEqual(llamadas[1].cuerpo, { status: 'cancelled' });
});

test('marcha blanca: el cobro queda simulado sin llamar al proveedor y la página pública lo muestra', async () => {
  const llamadas = [];
  P.usarFetch(async (...a) => { llamadas.push(a); throw new Error('no debería llamar'); });
  const r = await reservaDe('R-1002');
  const x = await P.iniciarCobro({ empresaId: E, reservaId: r.id, concepto: 'garantia', monto: 300000, proveedor: 'webpay', urlRetorno: '/portal/abc' });
  assert.equal(x.simulado, true);
  assert.equal(x.redirigir.metodo, 'GET');
  assert.equal(llamadas.length, 0);
  const p = await t.db.uno('SELECT * FROM pagos WHERE id = $1', [x.pagoId]);
  assert.equal(p.estado, 'simulado');
  assert.ok(p.vence_retencion);
  assert.equal(P.etapaGarantia(p), 'retenida');
  const pub = await fetch(`${t.base}/api${x.redirigir.url.replace('/pago-resultado?pago=', '/pagos/publico/').replace('&t=', '?t=')}`).then((y) => y.json());
  assert.equal(pub.simulado, true);
  assert.equal(pub.url_retorno, '/portal/abc');
  assert.equal(pub.empresa.nombre, 'Andes Rent a Car');
  assert.equal((await fetch(`${t.base}/api/pagos/publico/${x.pagoId}?t=malo`)).status, 404);
  // liberar en marcha blanca
  const lib = await admin.post(`/api/pagos/${x.pagoId}/liberar`, { motivo: 'sin cargos' });
  assert.equal(lib.datos.estado, 'liberado');
  assert.equal(lib.datos.monto_liberado, 300000);
  P.usarFetch(null);
});

test('pago manual por API, listado por reserva, reembolso y permisos', async () => {
  const r = await reservaDe('R-1004');
  const m = await admin.post('/api/pagos/manual', { reserva_id: r.id, concepto: 'arriendo', metodo: 'transferencia', monto: 50000, referencia: 'TRF 991' });
  assert.equal(m.estado, 200);
  assert.equal(m.datos.estado, 'pagado');
  assert.equal((await admin.post('/api/pagos/manual', { reserva_id: r.id, metodo: 'cheque', monto: 1 })).estado, 400);
  assert.equal((await admin.post('/api/pagos/manual', { reserva_id: r.id, metodo: 'efectivo', monto: 0 })).estado, 400);
  const l = await admin.get(`/api/pagos?reserva_id=${r.id}`);
  assert.ok(l.datos.pagos.some((p) => p.id === m.datos.id && p.referencia === 'TRF 991'));
  assert.ok(l.datos.pagos.every((p) => p.reserva_id === r.id));
  const re = await admin.post(`/api/pagos/${m.datos.id}/reembolsar`, { monto: 20000, motivo: 'descuento' });
  assert.equal(re.estado, 200);
  assert.equal(re.datos.concepto, 'reembolso');
  assert.equal((await admin.post(`/api/pagos/${m.datos.id}/reembolsar`, { monto: 40000, motivo: 'x' })).estado, 400);
  const b = await t.db.uno(`SELECT * FROM bitacora WHERE accion = 'pago_registrado' AND entidad_id = $1`, [m.datos.id]);
  assert.equal(b.detalle.monto, 50000);
  assert.equal((await (await t.como('patio@siguelogps.cl')).get('/api/pagos')).estado, 403);
  assert.equal((await (await t.como('finanzas@siguelogps.cl')).post('/api/pagos/manual', { reserva_id: r.id, metodo: 'efectivo', monto: 1000 })).estado, 200);
});

test('enlace de pago: se crea, se envía (retenido) y al abrirlo redirige al resultado', async () => {
  const r = await reservaDe('R-1006');
  const x = await admin.post('/api/pagos/link', { reserva_id: r.id, concepto: 'arriendo', monto: 15000, proveedor: 'mercadopago', enviar: ['whatsapp', 'correo'] });
  assert.equal(x.estado, 200);
  assert.equal(x.datos.salidas.length, 2);
  assert.ok(x.datos.salidas.every((s) => s.estado === 'retenida'));
  const res = await fetch(x.datos.url.replace(/^https?:\/\/[^/]+/, t.base), { redirect: 'manual' });
  assert.equal(res.status, 303);
  const p = await t.db.uno('SELECT estado FROM pagos WHERE id = $1', [x.datos.pago.id]);
  assert.equal(p.estado, 'simulado');
});

test('Webpay real (integración activa, sin marcha blanca): garantía retenida, retorno y captura parcial', async () => {
  await t.db.q('UPDATE empresas SET marcha_blanca = false WHERE id = $1', [E]);
  const integ = await import('../src/integraciones/index.js');
  await integ.guardar(E, 'webpay', { ambiente: 'integracion', codigo_comercio: INTEGRACION.codigo_comercio, codigo_comercio_diferido: INTEGRACION.codigo_comercio_diferido, api_key: INTEGRACION.api_key }, null);
  await integ.activar(E, 'webpay', true, null);
  const { f, llamadas } = fetchFalso((c) => {
    if (c.metodo === 'POST' && c.url.endsWith('/transactions')) return [200, { token: 'tokG1', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' }];
    if (c.url.endsWith('/capture')) return [200, { response_code: 0, authorization_code: '999', captured_amount: c.cuerpo.capture_amount }];
    if (c.metodo === 'PUT') return [200, { status: 'AUTHORIZED', response_code: 0, authorization_code: '184503', card_detail: { card_number: '4821' }, payment_type_code: 'VN', amount: 500000 }];
    return [404, {}];
  });
  P.usarFetch(f);
  try {
    const r = await reservaDe('R-1007');
    const x = await P.iniciarCobro({ empresaId: E, reservaId: r.id, concepto: 'garantia', monto: 500000, proveedor: 'webpay' });
    assert.equal(x.simulado, false);
    assert.deepEqual(x.redirigir, { url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction', metodo: 'POST', campos: { token_ws: 'tokG1' } });
    assert.equal(llamadas[0].headers['Tbk-Api-Key-Id'], INTEGRACION.codigo_comercio_diferido);
    assert.match(llamadas[0].cuerpo.return_url, /\/api\/pagos\/retorno\/webpay$/);
    // el navegador vuelve con token_ws
    const ret = await fetch(`${t.base}/api/pagos/retorno/webpay?token_ws=tokG1`, { redirect: 'manual' });
    assert.equal(ret.status, 303);
    assert.match(ret.headers.get('location'), new RegExp(`pago=${x.pagoId}&t=`));
    const p = await t.db.uno('SELECT * FROM pagos WHERE id = $1', [x.pagoId]);
    assert.equal(p.estado, 'retenido');
    assert.equal(p.tarjeta, '4821');
    assert.equal(p.autorizacion, '184503');
    const cap = await admin.post(`/api/pagos/${x.pagoId}/capturar`, { monto: 120000, motivo: 'daño' });
    assert.equal(cap.estado, 200, JSON.stringify(cap.datos));
    assert.equal(cap.datos.estado, 'capturado');
    assert.equal(cap.datos.monto_capturado, 120000);
    assert.equal(cap.datos.monto_liberado, 380000);
    assert.equal(cap.datos.simulado, false);
    const c = llamadas.find((l) => l.url.endsWith('/capture'));
    assert.deepEqual(c.cuerpo, { buy_order: p.referencia, authorization_code: '184503', capture_amount: 120000 });
    // abortado por el cliente
    const y = await P.iniciarCobro({ empresaId: E, reservaId: r.id, concepto: 'arriendo', monto: 1000, proveedor: 'webpay' });
    await t.db.q(`UPDATE pagos SET token_externo = 'tokAbort' WHERE id = $1`, [y.pagoId]);
    await fetch(`${t.base}/api/pagos/retorno/webpay`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'TBK_TOKEN=tokAbort&TBK_ORDEN_COMPRA=x', redirect: 'manual' });
    assert.equal((await t.db.uno('SELECT estado FROM pagos WHERE id = $1', [y.pagoId])).estado, 'anulado');
  } finally {
    P.usarFetch(null);
    await integ.activar(E, 'webpay', false, null);
    await t.db.q('UPDATE empresas SET marcha_blanca = true WHERE id = $1', [E]);
  }
});
