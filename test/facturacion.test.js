import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';
import { desglosar, armarLineas, leerCaf } from '../src/facturacion/calculo.js';
import { armarDocumento, leerTrackId, leerEstadoEnvio } from '../src/facturacion/simpleapi.js';

let t, admin, E, F;
before(async () => {
  t = await levantar();
  admin = await t.como('demo@siguelogps.cl');
  E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
  F = await import('../src/facturacion/index.js');
});
after(async () => { F.usarFetch(null); await t.cerrar(); });

const CAF = (tipo, d, h) => `<?xml version="1.0"?><AUTORIZACION><CAF version="1.0"><DA><RE>76543210-3</RE><RS>ANDES RENT A CAR SPA</RS><TD>${tipo}</TD><RNG><D>${d}</D><H>${h}</H></RNG><FA>2026-01-05</FA><IDK>100</IDK></DA></CAF><RSASK>-----BEGIN RSA PRIVATE KEY-----x</RSASK></AUTORIZACION>`;

test('neto e IVA desde el total con IVA incluido (19 %)', () => {
  assert.deepEqual(desglosar(35860), { neto: 30134, iva: 5726, exento: 0, total: 35860 });
  assert.deepEqual(desglosar(441980), { neto: 371412, iva: 70568, exento: 0, total: 441980 });
  const lineas = [{ nombre: 'Km extra', monto: 54720 }, { nombre: 'Combustible', monto: 28630 }, { nombre: 'TAG', monto: 18640 }, { nombre: 'Condonado', monto: 0 }];
  const b = armarLineas(lineas, 39);
  assert.equal(b.lineas.length, 3);
  assert.equal(b.lineas[0].monto, 54720); // boleta: con IVA
  assert.equal(b.total, 101990);
  const f = armarLineas(lineas, 33);
  assert.equal(f.lineas.reduce((s, l) => s + l.monto, 0), f.neto); // factura: líneas netas que cuadran con el neto
  assert.equal(f.neto + f.iva, 101990);
});

test('documento SimpleAPI, TrackID, estado del envío y CAF', () => {
  const doc = armarDocumento({ tipo: 39, folio: 5, fecha: '2026-10-11', emisor: { rut: '76543210-3', razonSocial: 'Andes', giro: 'Arriendo', direccion: 'Av. 1', comuna: 'Providencia' }, receptor: { rut: '66666666-6', razonSocial: 'Consumidor final' }, lineas: [{ nombre: 'Lavado', monto: 15000, precio: 15000 }], totales: desglosar(15000) });
  const enc = doc.Documento.Encabezado;
  assert.equal(enc.IdentificacionDTE.TipoDTE, 39);
  assert.equal(enc.IdentificacionDTE.IndicadorServicio, 3);
  assert.equal(enc.Emisor.RazonSocialBoleta, 'Andes');
  assert.equal(enc.Totales.MontoTotal, 15000);
  assert.equal(doc.Documento.Detalles[0].MontoItem, 15000);
  assert.equal(leerTrackId('{"trackId": 4455667}'), '4455667');
  assert.equal(leerTrackId('<RESPUESTA><TRACKID>123456</TRACKID></RESPUESTA>'), '123456');
  assert.equal(leerEstadoEnvio('{"estado":"EPR","aceptados":1}').estado, 'aceptado');
  assert.equal(leerEstadoEnvio('<ESTADO>RCH</ESTADO>').estado, 'rechazado');
  assert.deepEqual(leerCaf(CAF(39, 101, 200)), { tipo: 39, desde: 101, hasta: 200, rut: '76543210-3', fechaAutorizacion: '2026-01-05', ambiente: 'certificacion' });
});

test('marcha blanca: boleta queda retenida con mensaje claro; validaciones del receptor', async () => {
  const r = await t.db.uno(`SELECT id FROM reservas WHERE empresa_id = $1 AND folio = 'R-1001'`, [E]);
  const b = await admin.post('/api/facturacion', { tipo: 39, reserva_id: r.id, receptor: { rut: '66.666.666-6', razonSocial: 'Consumidor final' }, lineas: [{ nombre: 'Arriendo', monto: 119000 }] });
  assert.equal(b.estado, 200, JSON.stringify(b.datos));
  assert.equal(b.datos.estado, 'retenido');
  assert.equal(b.datos.neto, 100000);
  assert.equal(b.datos.iva, 19000);
  assert.equal(b.datos.folio, null);
  assert.match(b.datos.mensaje, /Retenido/);
  // factura a consumidor final o sin giro: no
  assert.equal((await admin.post('/api/facturacion', { tipo: 33, receptor: { rut: '66666666-6', razonSocial: 'X' }, lineas: [{ nombre: 'A', monto: 1000 }] })).estado, 400);
  assert.equal((await admin.post('/api/facturacion', { tipo: 33, receptor: { rut: '76111222-8', razonSocial: 'Aconcagua' }, lineas: [{ nombre: 'A', monto: 1000 }] })).estado, 400);
  assert.equal((await admin.post('/api/facturacion', { tipo: 39, receptor: { rut: '11.111.111-2', razonSocial: 'X' }, lineas: [{ nombre: 'A', monto: 1000 }] })).estado, 400);
  // descartar un retenido (nunca llegó al SII)
  const nc = await admin.post(`/api/facturacion/${b.datos.id}/nota-credito`, { motivo: 'error' });
  assert.equal(nc.datos.estado, 'rechazado');
  const pdf = await admin.get(`/api/facturacion/${b.datos.id}/pdf`);
  assert.equal(pdf.datos.subarray(0, 4).toString(), '%PDF');
  assert.equal((await (await t.como('counter@siguelogps.cl')).get('/api/facturacion')).estado, 403);
});

test('SimpleAPI activa: genera, arma el sobre, envía, guarda el TrackID y toma el folio del CAF', async () => {
  const { guardarArchivo } = await import('../src/almacenamiento/index.js');
  const integ = await import('../src/integraciones/index.js');
  const cert = await guardarArchivo({ empresaId: E, entidad: 'integracion', nombre: 'cert.pfx', datos: Buffer.from('pfx-falso') });
  const caf = await guardarArchivo({ empresaId: E, entidad: 'integracion', nombre: 'caf39.xml', mime: 'application/xml', datos: Buffer.from(CAF(39, 101, 200)) });
  await integ.guardar(E, 'simpleapi', { ambiente: 'certificacion', api_key: 'KEY', rut_certificado: '11111111-1', clave_certificado: 'clave', certificado_archivo_id: cert.id, caf_boleta_archivo_id: caf.id, resolucion_numero: '0', resolucion_fecha: '2014-08-22' }, null);
  await integ.activar(E, 'simpleapi', true, null);
  await t.db.q('UPDATE empresas SET marcha_blanca = false WHERE id = $1', [E]);
  const llamadas = [];
  F.usarFetch(async (url, op) => {
    const input = JSON.parse(op.body.get('input'));
    llamadas.push({ url, input, auth: op.headers.Authorization });
    if (url.endsWith('/dte/generar')) return new Response('<DTE version="1.0"><Documento ID="B101"/></DTE>');
    if (url.endsWith('/envio/generar')) return new Response('<EnvioBOLETA version="1.0"></EnvioBOLETA>');
    if (url.endsWith('/envio/enviar')) return new Response('{"trackId": 8899001}');
    return new Response('no', { status: 404 });
  });
  try {
    const d = await F.emitirDocumento({ empresaId: E, tipo: 39, receptor: { rut: '66666666-6', razonSocial: 'Consumidor final' }, lineas: [{ nombre: 'Lavado', monto: 15000 }] });
    assert.equal(d.estado, 'emitido', d.mensaje);
    assert.equal(d.folio, 101);
    assert.equal(d.track_id, '8899001');
    assert.ok(d.xml_archivo_id);
    assert.equal(llamadas.length, 3);
    assert.equal(llamadas[0].auth, 'KEY');
    assert.equal(llamadas[0].input.Documento.Encabezado.IdentificacionDTE.Folio, 101);
    assert.equal(llamadas[0].input.Certificado.Rut, '11111111-1');
    assert.equal(llamadas[2].input.ServidorBoletaREST, true);
    const d2 = await F.emitirDocumento({ empresaId: E, tipo: 39, receptor: { rut: '66666666-6', razonSocial: 'Consumidor final' }, lineas: [{ nombre: 'TAG', monto: 2000 }] });
    assert.equal(d2.folio, 102);
    // factura sin CAF cargado → error claro, sin consumir folio
    const f = await F.emitirDocumento({ empresaId: E, tipo: 33, receptor: { rut: '76111222-8', razonSocial: 'Aconcagua', giro: 'Construcción', direccion: 'Av. 1', comuna: 'Calama' }, lineas: [{ nombre: 'Arriendo', monto: 119000 }] });
    assert.equal(f.estado, 'error');
    assert.match(f.mensaje, /CAF/);
  } finally {
    F.usarFetch(null);
    await integ.activar(E, 'simpleapi', false, null);
    await t.db.q('UPDATE empresas SET marcha_blanca = true WHERE id = $1', [E]);
  }
});
