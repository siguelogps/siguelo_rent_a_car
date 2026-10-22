// App nativa Síguelo On Rent (Android): sesión con token Bearer, versión mínima, teléfonos para avisos push,
// idempotencia de la cola y el aviso de reserva nueva.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { levantar } from './ayuda.js';

let t, admin, soporte;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function ingresarNativa(correo, clave = 'demo1234') {
  const r = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, clave, nativa: true }) });
  return { estado: r.status, cookie: r.headers.get('set-cookie'), datos: await r.json() };
}
function conToken(token) {
  const llamar = async (method, ruta, body, extra = {}) => {
    const r = await fetch(t.base + ruta, { method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { estado: r.status, datos: await r.json().catch(() => null), headers: r.headers };
  };
  return { get: (u) => llamar('GET', u), post: (u, b = {}, h) => llamar('POST', u, b, h), del: (u, b) => llamar('DELETE', u, b), put: (u, b = {}) => llamar('PUT', u, b) };
}

before(async () => { t = await levantar(); admin = await t.como('demo@siguelogps.cl'); soporte = await t.como('soporte@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

test('ingreso de la app: el token llega en la respuesta (sin cookie) y sirve como Bearer; la web no recibe token', async () => {
  const n = await ingresarNativa('patio@siguelogps.cl');
  assert.equal(n.estado, 200);
  assert.ok(n.datos.token && n.datos.token.length >= 40);
  assert.equal(n.cookie, null, 'la app no recibe cookie');
  const app = conToken(n.datos.token);
  const yo = await app.get('/api/yo');
  assert.equal(yo.estado, 200);
  assert.equal(yo.datos.usuario.rol, 'patio');
  assert.ok(yo.datos.empresa?.id, 'la empresa sale de la sesión');

  const web = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'patio@siguelogps.cl', clave: 'demo1234' }) });
  const w = await web.json();
  assert.equal(w.token, undefined, 'el navegador nunca recibe el token');
  assert.ok(web.headers.get('set-cookie'));

  assert.equal((await app.post('/api/salir')).estado, 200);
  assert.equal((await app.get('/api/yo')).estado, 401, 'al salir, el token deja de servir');
  assert.equal((await conToken('x'.repeat(43)).get('/api/yo')).estado, 401);
});

test('versión mínima: pública para la app, solo un superadmin la cambia y se valida', async () => {
  const r0 = await (await fetch(`${t.base}/api/app/version-minima`)).json();
  assert.deepEqual(r0, { android: { minima: null, mensaje: null } });
  assert.equal((await admin.put('/api/backoffice/app-movil', { minima: '1.0.9' })).estado, 403);
  const mala = await soporte.put('/api/backoffice/app-movil', { minima: 'uno' });
  assert.equal(mala.estado, 400);
  const ok = await soporte.put('/api/backoffice/app-movil', { minima: '1.0.42', mensaje: 'Hay una versión nueva con arreglos de fotos.' });
  assert.equal(ok.estado, 200);
  const r1 = await (await fetch(`${t.base}/api/app/version-minima`)).json();
  assert.equal(r1.android.minima, '1.0.42');
  assert.match(r1.android.mensaje, /versión nueva/);
  await soporte.put('/api/backoffice/app-movil', { minima: '', mensaje: '' });
  assert.equal((await (await fetch(`${t.base}/api/app/version-minima`)).json()).android.minima, null);
});

test('teléfono para avisos: empresa y usuario salen de la sesión; al salir se borra', async () => {
  const n = await ingresarNativa('counter@siguelogps.cl');
  const app = conToken(n.datos.token);
  const token = 'fcm-' + crypto.randomBytes(30).toString('hex');
  assert.equal((await app.post('/api/app/dispositivo', { token, version_app: '1.0.7', empresa_id: 999999, usuario_id: 1 })).estado, 200);
  const [d] = await t.db.q('SELECT d.*, u.correo FROM dispositivos d JOIN usuarios u ON u.id = d.usuario_id WHERE token = $1', [token]);
  assert.equal(d.correo, 'counter@siguelogps.cl');
  assert.notEqual(Number(d.empresa_id), 999999);
  assert.equal(d.version_app, '1.0.7');
  assert.equal((await app.post('/api/app/dispositivo', { token: 'corto' })).estado, 400);
  assert.equal((await app.del('/api/app/dispositivo', { token })).estado, 200);
  assert.equal((await t.db.q('SELECT 1 FROM dispositivos WHERE token = $1', [token])).length, 0);
});

test('idempotencia: el mismo envío dos veces crea un solo incidente; la clave no se reutiliza en otra ruta', async () => {
  const n = await ingresarNativa('demo@siguelogps.cl');
  const app = conToken(n.datos.token);
  const [v] = await t.db.q("SELECT patente FROM vehiculos WHERE activo ORDER BY id LIMIT 1");
  const clave = crypto.randomUUID();
  const cuerpo = { tipo: 'dano', patente: v.patente, descripcion: 'Raya en la puerta (prueba de reintento)', fotos: [PNG, PNG] };
  const a = await app.post('/api/incidentes', cuerpo, { 'Idempotency-Key': clave });
  assert.equal(a.estado, 200, JSON.stringify(a.datos));
  const b = await app.post('/api/incidentes', cuerpo, { 'Idempotency-Key': clave });
  assert.equal(b.estado, 200);
  assert.equal(b.datos.id, a.datos.id);
  assert.equal(b.headers.get('idempotent-replayed'), 'true');
  const [c] = await t.db.q("SELECT count(*)::int AS n FROM incidentes WHERE descripcion = $1", [cuerpo.descripcion]);
  assert.equal(c.n, 1);
  const fotos = await t.db.q("SELECT nombre FROM archivos WHERE entidad = 'incidente' AND entidad_id = $1 ORDER BY id", [a.datos.id]);
  assert.equal(fotos.length, 2, 'las dos fotos del teléfono quedan en el incidente');
  assert.equal((await app.post('/api/app/dispositivo', { token: 'x'.repeat(40) }, { 'Idempotency-Key': clave })).estado, 422);
  // Un error no deja la clave tomada: el reintento corregido funciona.
  const clave2 = crypto.randomUUID();
  assert.equal((await app.post('/api/incidentes', { ...cuerpo, descripcion: '' }, { 'Idempotency-Key': clave2 })).estado, 400);
  assert.equal((await app.post('/api/incidentes', { ...cuerpo, descripcion: 'Segundo intento', fotos: [] }, { 'Idempotency-Key': clave2 })).estado, 200);
  assert.equal((await app.post('/api/incidentes', { ...cuerpo, fotos: ['no-es-foto'] }, { 'Idempotency-Key': crypto.randomUUID() })).estado, 400);
});

test('avisos push: la cuenta de servicio no vuelve al navegador y la reserva nueva avisa al resto del equipo', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cuenta = { type: 'service_account', project_id: 'onrent-prueba', client_email: 'push@onrent-prueba.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  assert.equal((await soporte.put('/api/backoffice/app-movil', { cuenta_push: '{"no":"sirve"}' })).estado, 400);
  const g = await soporte.put('/api/backoffice/app-movil', { cuenta_push: JSON.stringify(cuenta) });
  assert.equal(g.estado, 200);
  const ver = await soporte.get('/api/backoffice/app-movil');
  assert.equal(ver.datos.push.configurado, true);
  assert.equal(ver.datos.push.proyecto, 'onrent-prueba');
  assert.ok(!JSON.stringify(ver.datos).includes('PRIVATE KEY'), 'la clave privada nunca vuelve');
  const [fila] = await t.db.q("SELECT valor FROM sistema WHERE clave = 'app_push_cuenta'");
  assert.ok(!fila.valor.includes('PRIVATE KEY'), 'queda cifrada');

  const enviados = [];
  const push = await import('../src/app-nativa/push.js');
  push._usarFetch(async (url, op) => {
    if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 'acceso', expires_in: 3600 }) };
    const m = JSON.parse(op.body).message;
    enviados.push(m);
    if (m.token.startsWith('viejo')) return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
  const tel = async (correo, token) => { const n = await ingresarNativa(correo); await conToken(n.datos.token).post('/api/app/dispositivo', { token }); return conToken(n.datos.token); };
  const tokenCounter = 'counter-' + 'a'.repeat(40), tokenViejo = 'viejo-' + 'b'.repeat(40), tokenAdmin = 'admin-' + 'c'.repeat(40);
  await tel('counter@siguelogps.cl', tokenCounter);
  await tel('patio@siguelogps.cl', tokenViejo);
  const appAdmin = await tel('demo@siguelogps.cl', tokenAdmin);

  const op = (await admin.get('/api/reservas/opciones')).datos;
  const disp = await admin.get(`/api/reservas/disponibles?inicio=2031-03-10T10:00:00-03:00&fin=2031-03-12T10:00:00-03:00`);
  const veh = Array.isArray(disp.datos) ? disp.datos[0] : null;
  const [cli] = await t.db.q('SELECT id FROM clientes WHERE NOT lista_negra ORDER BY id LIMIT 1');
  const r = await appAdmin.post('/api/reservas', { cliente_id: cli.id, categoria_id: veh?.categoria_id ?? op.categorias?.[0]?.id, vehiculo_id: veh?.id, sucursal_retiro_id: op.sucursales?.[0]?.id,
    sucursal_devolucion_id: op.sucursales?.[0]?.id, inicio: '2031-03-10T10:00:00-03:00', fin: '2031-03-12T10:00:00-03:00' });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  for (let i = 0; i < 50 && enviados.length < 2; i++) await new Promise((ok) => setTimeout(ok, 20));
  const destinos = enviados.map((m) => m.token).sort();
  assert.deepEqual(destinos, [tokenCounter, tokenViejo].sort(), 'avisa al counter y al patio, no a quien creó la reserva');
  const m = enviados.find((x) => x.token === tokenCounter);
  assert.match(m.notification.title, /Reserva nueva/);
  assert.equal(m.data.tipo, 'reserva');
  assert.equal(m.data.reserva_id, String(r.datos.id));
  assert.ok(!/wialon|gurtam|firebase/i.test(m.notification.body));
  for (let i = 0; i < 50; i++) { if (!(await t.db.q('SELECT 1 FROM dispositivos WHERE token = $1', [tokenViejo])).length) break; await new Promise((ok) => setTimeout(ok, 20)); }
  assert.equal((await t.db.q('SELECT 1 FROM dispositivos WHERE token = $1', [tokenViejo])).length, 0, 'el token que Firebase ya no reconoce se borra');
  await soporte.put('/api/backoffice/app-movil', { cuenta_push: null });
  assert.equal((await soporte.get('/api/backoffice/app-movil')).datos.push.configurado, false);
});

test('cola de la entrega sin señal: daños y cierre repetidos con la misma clave no se duplican', async () => {
  const n = await ingresarNativa('patio@siguelogps.cl');
  const app = conToken(n.datos.token);
  const tareas = await app.get('/api/patio/tareas');
  assert.equal(tareas.estado, 200);
  const res = tareas.datos.entregas.find((x) => !x.inspeccion_estado || x.inspeccion_estado === 'borrador');
  assert.ok(res, 'hay una entrega pendiente en los datos de prueba');
  const ini = await app.post(`/api/patio/reservas/${res.id}/iniciar`);
  assert.equal(ini.estado, 200, JSON.stringify(ini.datos));
  const insp = ini.datos.inspeccion.id;
  // La app manda «iniciar» otra vez al reintentar: devuelve la misma inspección.
  assert.equal((await app.post(`/api/patio/reservas/${res.id}/iniciar`)).datos.inspeccion.id, insp);
  assert.equal((await app.put(`/api/patio/inspecciones/${insp}`, { km: 48320, combustible: 7 })).estado, 200);
  for (const posicion of ini.datos.obligatorias) {
    const f = await app.post(`/api/patio/inspecciones/${insp}/fotos`, { posicion, dataUrl: PNG, tomada_en: '2026-10-22T10:00:00Z', lat: -33.4, lng: -70.6 });
    assert.equal(f.estado, 200, JSON.stringify(f.datos));
  }
  const kd = crypto.randomUUID();
  const dano = { vista: 'izquierdo', x: 40, y: 200, tipo: 'raya', descripcion: 'Raya 5 cm' };
  const d1 = await app.post(`/api/patio/inspecciones/${insp}/danos`, dano, { 'Idempotency-Key': kd });
  const d2 = await app.post(`/api/patio/inspecciones/${insp}/danos`, dano, { 'Idempotency-Key': kd });
  assert.equal(d1.datos.id, d2.datos.id);
  assert.equal((await t.db.q('SELECT count(*)::int AS n FROM danos WHERE inspeccion_id = $1', [insp]))[0].n, 1);
  const kc = crypto.randomUUID();
  const fin = { firma: PNG, firmante_nombre: 'Cliente Prueba', lat: -33.4, lng: -70.6 };
  const c1 = await app.post(`/api/patio/inspecciones/${insp}/completar`, fin, { 'Idempotency-Key': kc });
  assert.equal(c1.estado, 200, JSON.stringify(c1.datos));
  const c2 = await app.post(`/api/patio/inspecciones/${insp}/completar`, fin, { 'Idempotency-Key': kc });
  assert.equal(c2.estado, 200, 'el reintento recibe la misma respuesta, no «ya está completa»');
  assert.equal(c2.datos.reserva_estado, 'en_curso');
});
