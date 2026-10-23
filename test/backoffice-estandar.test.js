// Backoffice Síguelo estándar (espec. aprobada por Pablo el 22-oct): «Ver como» de solo lectura en el servidor, «Operar»
// con motivo y nivel de On Board, integraciones gestionadas por Síguelo (salvo los cobros), marcha blanca solo de Síguelo,
// alta con invitación, suspender / reactivar / baja, «Solicitar a Síguelo» con CRM simulado, enlace de carga de un solo
// uso, almacenamiento general y que ninguna conexión existente se pierda.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { levantar } from './ayuda.js';

let t, E, sop, admin;
const correos = [];
const crm = [];
const SECRETO_CRM = 'sgh_secreto-de-prueba-123';

before(async () => {
  t = await levantar();
  E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
  const { _usarTransporte } = await import('../src/siguelo/correo.js');
  _usarTransporte(async (m) => { correos.push(m); });
  const { _usarFetchCrm } = await import('../src/siguelo/crm.js');
  // CRM simulado que verifica el contrato: cabeceras, firma HMAC sobre el cuerpo crudo y campos del cuerpo.
  _usarFetchCrm(async (url, op) => {
    const firma = crypto.createHmac('sha256', SECRETO_CRM).update(op.body).digest('hex');
    crm.push({ url, headers: op.headers, body: JSON.parse(op.body), firmaOk: op.headers['X-Siguelo-Firma'] === `sha256=${firma}` });
    return new Response(JSON.stringify({ ok: true, id: JSON.parse(op.body).id, ticket: 'T-1187', estado: 'vinculada', repetida: false }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  });
  sop = await t.como('soporte@siguelogps.cl');
  admin = await t.como('demo@siguelogps.cl');
  await sop.put('/api/backoffice/conexiones/crm', { url: 'https://crm.prueba.cl', secreto: SECRETO_CRM });
  await sop.put('/api/backoffice/conexiones/correo_siguelo', { host: 'smtp.prueba.cl', usuario: 'no-responder@siguelogps.com', clave: 'x', remitente: 'no-responder@siguelogps.com', aviso_equipo: 'equipo@siguelogps.cl' });
});
after(async () => {
  (await import('../src/siguelo/correo.js'))._usarTransporte(null);
  (await import('../src/siguelo/crm.js'))._usarFetchCrm(null);
  await t.cerrar();
});

test('«Ver como» es de solo lectura en el servidor y queda en la actividad del cliente', async () => {
  const v = await sop.post(`/api/backoffice/clientes/${E}/entrar`, { modo: 'ver' });
  assert.equal(v.estado, 200);
  const yo = (await sop.get('/api/yo')).datos;
  assert.equal(yo.siguelo_modo, 'ver');
  assert.equal(yo.solo_lectura, true);
  assert.equal((await sop.get('/api/reservas')).estado, 200, 'mirar sí');
  const intento = await sop.post('/api/configuracion/sucursales', { nombre: 'No debería' });
  assert.equal(intento.estado, 403, 'cambiar no');
  assert.match(intento.datos.error, /Ver como/);
  assert.equal((await sop.patch('/api/empresa', { nombre: 'Otro nombre' })).estado, 403);
  assert.equal((await sop.post('/api/empresa-activa', { empresa_id: null })).estado, 200, 'volver al backoffice sí se puede');
  const bit = (await admin.get('/api/configuracion/bitacora?accion=siguelo_entro_ver')).datos;
  assert.ok(bit.filas.length >= 1, 'el cliente ve la entrada en su bitácora');
});

test('«Operar» exige motivo y nivel admin/usa; cada cambio queda con el motivo en la bitácora del cliente', async () => {
  assert.equal((await sop.post(`/api/backoffice/clientes/${E}/entrar`, { modo: 'operar', motivo: '' })).estado, 400);
  const ok = await sop.post(`/api/backoffice/clientes/${E}/entrar`, { modo: 'operar', motivo: 'Soporte, ticket 1187' });
  assert.equal(ok.estado, 200);
  const yo = (await sop.get('/api/yo')).datos;
  assert.equal(yo.siguelo_modo, 'operar');
  assert.equal(yo.siguelo_motivo, 'Soporte, ticket 1187');
  const s = await sop.post('/api/configuracion/sucursales', { nombre: 'Concepción (operado)' });
  assert.equal(s.estado, 200);
  const fila = await t.db.uno(`SELECT detalle FROM bitacora WHERE accion = 'sucursal_creada' AND entidad_id = $1`, [s.datos.id]);
  assert.deepEqual(fila.detalle.siguelo, { modo: 'operar', motivo: 'Soporte, ticket 1187' });
  const entrada = (await admin.get('/api/configuracion/bitacora?accion=siguelo_entro_operar')).datos.filas[0];
  assert.equal(entrada.detalle.motivo, 'Soporte, ticket 1187');
  await sop.post('/api/empresa-activa', { empresa_id: null });
  const ficha = (await sop.get(`/api/backoffice/clientes/${E}`)).datos;
  const op = ficha.entradas.find((x) => x.modo === 'operar');
  assert.ok(op.fin, 'la entrada se cerró al volver');
  assert.ok(op.cambios >= 1);
  // Nivel «ve» de On Board: solo «Ver como»
  await t.db.q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol, nivel_panel) VALUES (NULL, 'Vera Mira', 'vera@siguelogps.cl', (SELECT clave_hash FROM usuarios WHERE correo = 'soporte@siguelogps.cl'), 'soporte', 've')`);
  const vera = await t.como('vera@siguelogps.cl');
  assert.equal((await vera.post(`/api/backoffice/clientes/${E}/entrar`, { modo: 'operar', motivo: 'quiero operar' })).estado, 403);
  assert.equal((await vera.post(`/api/backoffice/clientes/${E}/marcha-blanca`, { activa: false })).estado, 403, 've no cambia nada en el backoffice');
  assert.equal((await vera.post(`/api/backoffice/clientes/${E}/entrar`, { modo: 'ver' })).estado, 200);
  await vera.post('/api/empresa-activa', { empresa_id: null });
});

test('integraciones: las gestionadas solo desde el backoffice; los cobros los sigue configurando el cliente', async () => {
  for (const tipo of ['gps', 'whatsapp', 'correo', 'simpleapi', 'dashboard_siguelo']) {
    const r = await admin.put(`/api/integraciones/${tipo}`, { token: 'x' });
    assert.equal(r.estado, 403, tipo);
    assert.match(r.datos.error, /Solicitar a Síguelo/);
  }
  assert.equal((await admin.put('/api/integraciones/almacenamiento', { bucket: 'x' })).estado, 404, 'el almacenamiento ya no es del cliente');
  assert.equal((await admin.put('/api/integraciones/webpay', { codigo_comercio: '597000000001', api_key: 'secreto-webpay' })).estado, 200, 'Transbank sí');
  assert.equal((await admin.put('/api/integraciones/mercadopago', { public_key: 'pk', access_token: 'secreto-mp' })).estado, 200, 'Mercado Pago sí');
  // Síguelo configura WhatsApp del cliente desde el backoffice; el secreto no vuelve
  const w = await sop.put(`/api/backoffice/clientes/${E}/integraciones/whatsapp`, { phone_id: '1234', token: 'token-whatsapp-secreto' });
  assert.equal(w.estado, 200);
  assert.equal(w.datos.config.token, '••••••••');
  assert.equal((await sop.put(`/api/backoffice/clientes/${E}/integraciones/webpay`, { api_key: 'x' })).estado, 403, 'los cobros no se tocan desde el backoffice');
  await sop.post(`/api/backoffice/clientes/${E}/integraciones/whatsapp/activar`, { activa: true });
  const vista = await admin.get('/api/integraciones');
  const txt = JSON.stringify(vista.datos);
  for (const s of ['token-whatsapp-secreto', 'secreto-webpay', 'secreto-mp']) assert.ok(!txt.includes(s), `no viaja ${s}`);
  assert.equal(vista.datos.gestionadas.find((g) => g.tipo === 'whatsapp').estado, 'activo');
  assert.ok(vista.datos.integraciones.every((i) => ['webpay', 'mercadopago'].includes(i.tipo)));
  const ficha = JSON.stringify((await sop.get(`/api/backoffice/clientes/${E}`)).datos);
  assert.ok(!ficha.includes('token-whatsapp-secreto') && !ficha.includes('secreto-webpay'), 'la ficha del backoffice tampoco trae secretos');
});

test('marcha blanca: el cliente no la cambia; Síguelo sí, desde el backoffice', async () => {
  const r = await admin.patch('/api/empresa', { marcha_blanca: false });
  assert.equal(r.estado, 403);
  assert.equal((await sop.post(`/api/backoffice/clientes/${E}/marcha-blanca`, { activa: false, motivo: 'Fin de la marcha blanca' })).estado, 200);
  assert.equal((await t.db.uno('SELECT marcha_blanca FROM empresas WHERE id = $1', [E])).marcha_blanca, false);
  await sop.post(`/api/backoffice/clientes/${E}/marcha-blanca`, { activa: true });
});

let NUEVA;
test('alta: 4 pasos, parte en marcha blanca y el administrador recibe una invitación (Síguelo no ve su clave)', async () => {
  correos.length = 0;
  const r = await sop.post('/api/backoffice/clientes', {
    datos: { nombre: 'Patagonia Rent Demo', razon_social: 'Patagonia Rent Demo SpA', rut: '76.800.900-7', comuna: 'Puerto Montt' }, plan: 'basico',
    integraciones: { gps: { cuenta: 'lite' }, correo: { remitente_nombre: 'Patagonia Rent', responder_a: 'hola@patagonia-demo.cl' }, simpleapi: { pedir_archivos: true } },
    admin: { nombre: 'Rosa Admin', correo: 'rosa@patagonia-demo.cl' }
  });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  NUEVA = r.datos.empresa.id;
  assert.equal(r.datos.invitacion.enviado, true);
  assert.equal(r.datos.enlace_carga.enviado, true);
  const e = await t.db.uno('SELECT marcha_blanca, estado, plan FROM empresas WHERE id = $1', [NUEVA]);
  assert.deepEqual([e.marcha_blanca, e.estado, e.plan], [true, 'activo', 'basico']);
  const u = await t.db.uno(`SELECT clave_hash FROM usuarios WHERE correo = 'rosa@patagonia-demo.cl'`);
  assert.equal(u.clave_hash, null, 'sin clave hasta aceptar la invitación');
  const inv = correos.find((m) => m.to === 'rosa@patagonia-demo.cl' && /acceso/.test(m.subject));
  const token = inv.html.match(/\/invitacion\/([\w-]+)/)[1];
  assert.equal((await fetch(`${t.base}/api/invitacion/${token}`)).status, 200);
  const acepta = await fetch(`${t.base}/api/invitacion/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: 'clave-de-rosa-1' }) });
  assert.equal(acepta.status, 200);
  assert.equal((await fetch(`${t.base}/api/invitacion/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: 'otra-clave-22' }) })).status, 410, 'un solo uso');
  const rosa = await t.como('rosa@patagonia-demo.cl', 'clave-de-rosa-1');
  assert.equal((await rosa.get('/api/yo')).datos.empresa.id, NUEVA);
  assert.equal((await t.db.uno(`SELECT count(*)::int AS n FROM usuarios WHERE correo = 'rosa@patagonia-demo.cl'`)).n, 1);
  assert.equal((await sop.post('/api/backoffice/clientes', { datos: { nombre: 'X' }, admin: { nombre: 'Y', correo: 'rosa@patagonia-demo.cl' } })).estado, 409);
});

test('enlace de carga: certificado y CAF de un solo uso, guardados cifrados y conectados a la facturación', async () => {
  correos.length = 0;
  const r = await sop.post(`/api/backoffice/clientes/${NUEVA}/enlace-carga`, { piezas: ['certificado', 'caf_39'], correo: 'rosa@patagonia-demo.cl' });
  assert.equal(r.estado, 200);
  const token = correos.find((m) => m.to === 'rosa@patagonia-demo.cl').html.match(/\/carga\/([\w-]+)/)[1];
  const info = await (await fetch(`${t.base}/api/carga/${token}`)).json();
  assert.deepEqual(info.piezas.map((p) => p.clave), ['certificado', 'caf_39']);
  const CAF = '<?xml version="1.0"?><AUTORIZACION><CAF version="1.0"><DA><RE>76800900-7</RE><TD>39</TD><RNG><D>1</D><H>50</H></RNG><FA>2026-01-05</FA><IDK>100</IDK></DA></CAF></AUTORIZACION>';
  const subir = (cuerpo) => fetch(`${t.base}/api/carga/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const malo = await subir({ archivos: { certificado: { nombre: 'c.pfx', base64: Buffer.from('pfx').toString('base64') }, caf_39: { nombre: 'x.xml', base64: Buffer.from(CAF.replace('<TD>39', '<TD>33')).toString('base64') } }, clave_certificado: 'c' });
  assert.equal(malo.status, 400, 'un CAF de otro tipo no gasta el enlace');
  const ok = await subir({ archivos: { certificado: { nombre: 'firma.pfx', base64: Buffer.from('contenido-pfx-secreto').toString('base64') }, caf_39: { nombre: 'caf39.xml', base64: Buffer.from(CAF).toString('base64') } }, clave_certificado: 'clave-del-pfx', rut_certificado: '11.111.111-1' });
  assert.equal(ok.status, 200);
  assert.equal((await subir({})).status, 410, 'sirve una sola vez');
  const { leer } = await import('../src/integraciones/index.js');
  const conf = (await leer(NUEVA, 'simpleapi')).config;
  assert.equal(conf.clave_certificado, 'clave-del-pfx');
  const fila = await t.db.uno('SELECT clave, meta FROM archivos WHERE id = $1', [Number(conf.certificado_archivo_id)]);
  assert.equal(fila.meta.cifrado, 'v1');
  const crudo = await t.db.uno('SELECT datos FROM archivos_contenido WHERE clave = $1', [fila.clave]);
  assert.ok(!Buffer.from(crudo.datos).toString('latin1').includes('contenido-pfx-secreto'), 'el archivo no queda en claro');
  const { leerArchivo } = await import('../src/almacenamiento/index.js');
  assert.equal((await leerArchivo(NUEVA, Number(conf.certificado_archivo_id))).datos.toString(), 'contenido-pfx-secreto');
  const ficha = (await sop.get(`/api/backoffice/clientes/${NUEVA}`)).datos;
  assert.equal(ficha.enlaces[0].estado, 'recibido');
  assert.ok(!JSON.stringify(ficha).includes('clave-del-pfx'));
});

test('«Solicitar a Síguelo»: bandeja, correo al equipo y ticket en el CRM según el contrato', async () => {
  correos.length = 0; crm.length = 0;
  const r = await admin.post('/api/solicitudes', { tipo: 'whatsapp', detalle: 'Queremos avisos por WhatsApp' });
  assert.equal(r.estado, 200);
  assert.equal(crm.length, 1);
  const c = crm[0];
  assert.equal(c.url, 'https://crm.prueba.cl/api/integracion/solicitudes');
  assert.equal(c.headers['X-Siguelo-Herramienta'], 'onrent');
  assert.equal(c.firmaOk, true, 'HMAC-SHA256 del cuerpo con el secreto de la herramienta');
  assert.deepEqual(Object.keys(c.body).sort(), ['detalle', 'empresa', 'herramienta', 'id', 'solicitante', 'tipo', 'url_backoffice'].sort());
  assert.equal(c.body.empresa.rut, '76.543.210-3');
  assert.equal(c.body.tipo, 'whatsapp');
  assert.equal(c.body.solicitante.correo, 'demo@siguelogps.cl');
  assert.ok(correos.some((m) => m.to === 'equipo@siguelogps.cl' && /WhatsApp/.test(m.subject)));
  const bandeja = (await sop.get('/api/backoffice/solicitudes')).datos.solicitudes;
  const s = bandeja.find((x) => x.id === r.datos.id);
  assert.equal(s.crm_ticket, 'T-1187');
  assert.equal((await sop.patch(`/api/backoffice/solicitudes/${s.id}`, { estado: 'resuelta', nota: 'Activado' })).datos.estado, 'resuelta');
  // CRM caído: la solicitud no se pierde y se reintenta con el mismo id (el CRM es idempotente)
  const { _usarFetchCrm } = await import('../src/siguelo/crm.js');
  _usarFetchCrm(async () => { throw new Error('sin red'); });
  const r2 = await admin.post('/api/solicitudes', { tipo: 'folios', detalle: 'Más folios' });
  assert.equal(r2.estado, 200);
  assert.match((await t.db.uno('SELECT crm_estado FROM solicitudes_siguelo WHERE id = $1', [r2.datos.id])).crm_estado, /^pendiente/);
  _usarFetchCrm(async (_u, op) => { crm.push({ body: JSON.parse(op.body) }); return new Response('{"ok":true,"ticket":"T-2","estado":"vinculada"}', { status: 201 }); });
  await sop.post('/api/backoffice/solicitudes/reintentar-crm', {});
  assert.equal(crm.at(-1).body.id, `onrent-${r2.datos.id}`);
  assert.equal((await t.db.uno('SELECT crm_ticket FROM solicitudes_siguelo WHERE id = $1', [r2.datos.id])).crm_ticket, 'T-2');
});

test('suspender y reactivar: con motivo y nombre escrito; la gente del cliente no entra mientras tanto', async () => {
  const rosa = await t.como('rosa@patagonia-demo.cl', 'clave-de-rosa-1');
  assert.equal((await sop.post(`/api/backoffice/clientes/${NUEVA}/suspender`, { motivo: 'Pago pendiente', confirmacion: 'otro nombre' })).estado, 400);
  const s = await sop.post(`/api/backoffice/clientes/${NUEVA}/suspender`, { motivo: 'Pago pendiente', detalle: 'Facturas impagas', avisar: true, confirmacion: 'patagonia rent demo' });
  assert.equal(s.estado, 200);
  assert.equal((await rosa.get('/api/yo')).estado, 401, 'sus sesiones se cerraron');
  const login = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'rosa@patagonia-demo.cl', clave: 'clave-de-rosa-1' }) });
  assert.equal(login.status, 403);
  assert.equal((await sop.post(`/api/backoffice/clientes/${NUEVA}/entrar`, { modo: 'operar', motivo: 'revisar' })).estado, 409, 'a un suspendido solo «Ver como»');
  assert.equal((await sop.post(`/api/backoffice/clientes/${NUEVA}/entrar`, { modo: 'ver' })).estado, 200);
  await sop.post('/api/empresa-activa', { empresa_id: null });
  const { puedeActuar } = await import('../src/integraciones/index.js');
  assert.equal((await puedeActuar(NUEVA, 'correo')).ok, false, 'no sale ningún mensaje');
  assert.equal((await sop.post(`/api/backoffice/clientes/${NUEVA}/reactivar`, { motivo: 'Pagó' })).estado, 200);
  assert.equal((await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'rosa@patagonia-demo.cl', clave: 'clave-de-rosa-1' }) })).status, 200);
});

test('baja: desconecta y borra secretos, 90 días de solo lectura para exportar y después se anonimiza', async () => {
  const r = await sop.post(`/api/backoffice/clientes/${NUEVA}/baja`, { motivo: 'Fin del contrato', confirmacion: 'Patagonia Rent Demo' });
  assert.equal(r.estado, 200);
  const dias = Math.round((Date.parse(r.datos.exportar_hasta) - Date.now()) / 864e5);
  assert.ok(dias >= 89 && dias <= 90, String(dias));
  const fila = await t.db.uno(`SELECT config_cifrada, activa FROM integraciones WHERE empresa_id = $1 AND tipo = 'simpleapi'`, [NUEVA]);
  assert.deepEqual([fila.config_cifrada, fila.activa], [null, false]);
  // Sesión nueva (la anterior se cerró al suspender)
  const ing = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'rosa@patagonia-demo.cl', clave: 'clave-de-rosa-1' }) });
  assert.equal(ing.status, 200);
  const cookie = ing.headers.get('set-cookie').split(';')[0];
  const llamar = (m, u, b) => fetch(t.base + u, { method: m, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then((x) => x.status);
  assert.equal(await llamar('GET', '/api/reservas'), 200, 'puede revisar y exportar');
  assert.equal(await llamar('POST', '/api/configuracion/sucursales', { nombre: 'X' }), 403, 'pero no cambiar');
  // «Ayer» en hora de Chile, como lo compara bajas.js: con current_date (UTC) la prueba fallaba entre las 21:00 y las
  // 24:00 de Santiago, cuando en UTC ya es el día siguiente y «ayer UTC» todavía es «hoy» en Chile.
  await t.db.q(`UPDATE empresas SET exportar_hasta = (now() AT TIME ZONE 'America/Santiago')::date - 1 WHERE id = $1`, [NUEVA]);
  const { procesarBajasVencidas } = await import('../src/siguelo/bajas.js');
  assert.equal(await procesarBajasVencidas(), 1);
  const u = await t.db.uno(`SELECT nombre, activo FROM usuarios WHERE empresa_id = $1 AND rol = 'administrador'`, [NUEVA]);
  assert.deepEqual([u.nombre, u.activo], ['Usuario eliminado', false]);
  assert.equal((await t.db.uno('SELECT count(*)::int AS n FROM archivos WHERE empresa_id = $1', [NUEVA])).n, 0);
});

test('migración: las conexiones que ya funcionaban siguen igual y el almacenamiento propio se respeta', async () => {
  const integ = await import('../src/integraciones/index.js');
  // Un cliente que ya tenía GPS y SMTP propio configurados por su administrador
  // (filas escritas tal como las dejaba la versión anterior, sin «modo» ni nada nuevo)
  const { cifrar } = await import('../src/cifrado.js');
  for (const [tipo, conf] of [['gps', { token: 'a'.repeat(40), cuenta: 'hosting', usuario: 'andes' }], ['correo', { host: 'smtp.andes.cl', usuario: 'u', clave: 'clave-smtp', remitente: 'Andes <r@andes.cl>' }]]) {
    await t.db.q(`INSERT INTO integraciones (empresa_id, tipo, activa, config_cifrada) VALUES ($1,$2,true,$3) ON CONFLICT (empresa_id, tipo) DO UPDATE SET config_cifrada = EXCLUDED.config_cifrada, activa = true`, [E, tipo, cifrar(conf)]);
  }
  integ.limpiarCache();
  const correo = await integ.leer(E, 'correo');
  assert.equal(correo.config.modo, 'smtp', 'quien tenía SMTP propio sigue con el suyo');
  assert.equal((await integ.leer(E, 'gps')).config.token, 'a'.repeat(40), 'mismo secreto');
  const ficha = (await sop.get(`/api/backoffice/clientes/${E}`)).datos;
  assert.equal(ficha.integraciones.find((i) => i.tipo === 'gps').config.token, '••••••••');
  // Archivo anterior a la marca de almacén: se sigue leyendo como antes
  const { leerArchivo, guardarArchivo } = await import('../src/almacenamiento/index.js');
  const a = await guardarArchivo({ empresaId: E, entidad: 'prueba', nombre: 'x.txt', datos: Buffer.from('hola') });
  await t.db.q(`UPDATE archivos SET meta = meta - 'almacen' WHERE id = $1`, [a.id]);
  assert.equal((await leerArchivo(E, a.id)).datos.toString(), 'hola');
  assert.equal(a.meta.almacen, 'bd');
  // Las sesiones del equipo que estaban dentro de un cliente quedan en «ver»
  const mig = (await import('node:fs')).readFileSync(new URL('../src/migraciones/170_backoffice_estandar.sql', import.meta.url), 'utf8');
  assert.match(mig, /UPDATE sesiones SET modo = 'ver'/);
});

test('plataforma GPS desde el backoffice: el «estado» de la vuelta decide el cliente y es de un solo uso', async () => {
  const { _usarFetch } = await import('../src/gps/wialon.js');
  _usarFetch(async () => new Response(JSON.stringify({ eid: 'sid', user: { nm: 'x' }, items: [] }), { headers: { 'Content-Type': 'application/json' } }));
  const ing = await sop.get(`/api/backoffice/clientes/${E}/integraciones/gps/ingreso?cuenta=hosting`);
  const u = new URL(ing.datos.url);
  assert.equal(u.origin, 'https://plataforma.siguelogps.com');
  const vuelta = new URL(u.searchParams.get('redirect_uri'));
  const estado = vuelta.searchParams.get('estado');
  assert.ok(estado, 'la vuelta trae un estado, no el id del cliente');
  const otro = await t.como('vera@siguelogps.cl');
  assert.equal((await otro.post('/api/backoffice/integraciones/gps/token', { token: 'b'.repeat(40), estado })).estado, 403, 'nivel ve no conecta');
  const r = await sop.post('/api/backoffice/integraciones/gps/token', { token: 'b'.repeat(40), usuario: 'andes', estado, empresa_id: NUEVA });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.empresa_id, E, 'la empresa sale del estado, no del cuerpo');
  assert.ok(!JSON.stringify(r.datos).includes('b'.repeat(40)));
  assert.equal((await sop.post('/api/backoffice/integraciones/gps/token', { token: 'b'.repeat(40), estado })).estado, 400, 'un solo uso');
  // 22-oct, más tarde (Pablo): el cliente vuelve a conectar la plataforma GPS él mismo (ver test/gps-cliente.test.js), pero
  // un «estado» creado en el backoffice no sirve en la ruta del cliente ni al revés.
  const ing2 = new URL((await sop.get(`/api/backoffice/clientes/${E}/integraciones/gps/ingreso?cuenta=hosting`)).datos.url);
  const estado2 = new URL(ing2.searchParams.get('redirect_uri')).searchParams.get('estado');
  assert.equal((await admin.post('/api/integraciones/gps/token', { token: 'c'.repeat(40), estado: estado2 })).estado, 400, 'el estado del backoffice no sirve en la ruta del cliente');
  _usarFetch(null);
});
