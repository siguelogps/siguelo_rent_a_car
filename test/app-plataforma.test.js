// Entrada desde el menú Apps de la plataforma GPS (estándar Síguelo OS), de punta a punta con la app real y PGlite.
// La plataforma se suplanta: nunca se llama de verdad. La parte común (SSRF fino, URL limpia, XSS) está en
// app-plataforma-comun.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

const HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
let t, demo, otra, llamadas = [], respuesta = null;

before(async () => {
  t = await levantar();
  const { _usarFetchPlataforma } = await import('../src/api/15-app-plataforma.js');
  _usarFetchPlataforma(async (url, o) => {
    const p = new URLSearchParams(o.body);
    llamadas.push({ url, svc: p.get('svc') });
    const r = p.get('svc') === 'core/use_auth_hash' ? respuesta : {};
    return { ok: true, json: async () => r };
  });
  demo = (await t.db.uno("SELECT empresa_id AS id FROM usuarios WHERE correo = 'demo@siguelogps.cl'")).id;
  otra = (await t.db.uno("INSERT INTO empresas (nombre, slug) VALUES ('Arriendos Otra', 'arriendos-otra') RETURNING id")).id;
  await t.db.q("UPDATE empresas SET gps_cuenta_id = '4242' WHERE id = $1", [demo]);
  await t.db.q("UPDATE empresas SET gps_cuenta_id = '5555' WHERE id = $1", [otra]);
});
after(async () => { await t.cerrar(); });

const quien = (id, bact, nm = 'usuario.plataforma') => ({ eid: `sid-${id}`, au: 'cuenta', user: { id, nm, bact } });
async function entrar(cuerpo, cookie = '') {
  const r = await fetch(`${t.base}/api/app-plataforma/sesion`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(cuerpo) });
  return { estado: r.status, datos: await r.json(), cookies: r.headers.getSetCookie() };
}
const cookieDe = (lista, nombre) => (lista.find((c) => c.startsWith(`${nombre}=`)) || '').split(';')[0];

test('🔥 SSRF: una baseUrl ajena da 400 y no se llama a nadie', async () => {
  llamadas = []; respuesta = quien(777, 4242);
  const r = await entrar({ authHash: HASH, baseUrl: 'https://169.254.169.254.nip.io' });
  assert.equal(r.estado, 400);
  assert.equal(r.datos.motivo, 'entrada_desconocida');
  assert.equal(llamadas.length, 0);
  assert.ok(!cookieDe(r.cookies, 'rc_sesion'));
});

test('🔥 hash vencido o reusado: error limpio, sin sesión', async () => {
  respuesta = { error: 8 };
  const r = await entrar({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' });
  assert.equal(r.estado, 401);
  assert.equal(r.datos.motivo, 'acceso_vencido');
  assert.doesNotMatch(r.datos.error, /wialon|código|8/i);
  assert.ok(!cookieDe(r.cookies, 'rc_sesion'));
});

test('🔥 cuenta que no es cliente de On Rent: pantalla «aún no está activa», con contacto y sin datos de nadie', async () => {
  respuesta = quien(901, 999999);
  const r = await entrar({ authHash: HASH, baseUrl: 'https://plataforma.siguelogps.com' });
  assert.equal(r.estado, 403);
  assert.equal(r.datos.motivo, 'sin_acceso');
  assert.match(r.datos.error, /Esta herramienta aún no está activa para tu cuenta\. Habla con tu ejecutivo de Síguelo/);
  assert.equal(r.datos.contacto.correo, 'soporte@siguelogps.cl');
  assert.deepEqual(Object.keys(r.datos).sort(), ['contacto', 'error', 'motivo']);
  assert.ok(!cookieDe(r.cookies, 'rc_sesion'));
});

test('🔥 usuario sin vincular: se pide entrar una vez con correo y clave, y ese ingreso lo vincula', async () => {
  respuesta = quien(777, 4242, 'counter.plataforma');
  const r = await entrar({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' });
  assert.equal(r.estado, 403);
  assert.equal(r.datos.motivo, 'no_vinculado');
  assert.equal(r.datos.ingreso, '/ingresar');
  const vinculo = cookieDe(r.cookies, 'vinculo_plataforma');
  assert.ok(vinculo, 'deja la cookie firmada');
  assert.match(r.cookies.find((c) => c.startsWith('vinculo_plataforma=')), /HttpOnly/);

  const ingreso = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: vinculo }, body: JSON.stringify({ correo: 'counter@siguelogps.cl', clave: 'demo1234' }) });
  assert.equal(ingreso.status, 200);
  assert.ok(cookieDe(ingreso.headers.getSetCookie(), 'volver_plataforma').includes('plataforma.siguelogps.com'), 'la sesión queda marcada como abierta desde la plataforma');
  const u = await t.db.uno("SELECT gps_usuario_id FROM usuarios WHERE correo = 'counter@siguelogps.cl'");
  assert.equal(u.gps_usuario_id, '777');

  // Desde ahora entra directo.
  const otra = await entrar({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' });
  assert.equal(otra.estado, 200);
  assert.equal(otra.datos.ok, true);
  assert.equal(otra.datos.nombre.length > 0, true);
  const sesion = cookieDe(otra.cookies, 'rc_sesion');
  const yo = await (await fetch(`${t.base}/api/yo`, { headers: { Cookie: sesion } })).json();
  assert.equal(yo.usuario.correo, 'counter@siguelogps.cl');
  assert.equal(String(yo.empresa.id), String(demo));
  assert.match(cookieDe(otra.cookies, 'volver_plataforma'), /plataforma\.siguelogps\.com/);
});

test('🔥 la empresa sale de la respuesta de la plataforma, no de lo que mande el navegador', async () => {
  // Mismo usuario de la plataforma (777), pero la plataforma dice que su cuenta es la de la otra empresa: ahí no está
  // vinculado, aunque el cuerpo pida la empresa demo.
  respuesta = quien(777, 5555);
  const r = await entrar({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com', empresa_id: demo, cuentaId: '4242', user: 'counter.plataforma' });
  assert.equal(r.estado, 403);
  assert.equal(r.datos.motivo, 'no_vinculado');
  assert.ok(!cookieDe(r.cookies, 'rc_sesion'));
});

test('el vínculo de otra empresa no se aplica al ingresar con una cuenta de On Rent ajena', async () => {
  respuesta = quien(888, 5555);
  const r = await entrar({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' });
  const vinculo = cookieDe(r.cookies, 'vinculo_plataforma');
  await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: vinculo }, body: JSON.stringify({ correo: 'finanzas@siguelogps.cl', clave: 'demo1234' }) });
  const u = await t.db.uno("SELECT gps_usuario_id FROM usuarios WHERE correo = 'finanzas@siguelogps.cl'");
  assert.equal(u.gps_usuario_id, null);
});

test('conexiones anteriores sin cuenta anotada: se reconoce por el usuario conectado y se anota la cuenta', async () => {
  const { guardar } = await import('../src/integraciones/index.js');
  const e = (await t.db.uno("INSERT INTO empresas (nombre, slug) VALUES ('Rent Antigua', 'rent-antigua') RETURNING id")).id;
  await guardar(e, 'gps', { token: 'x'.repeat(40), cuenta: 'lite', usuario: 'rent.antigua' }, null);
  await t.db.q("INSERT INTO usuarios (empresa_id, nombre, correo, rol, gps_usuario_id) VALUES ($1, 'Ana', 'ana@antigua.cl', 'administrador', '31')", [e]);
  respuesta = quien(31, 7070, 'rent.antigua');
  const r = await entrar({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  assert.equal((await t.db.uno('SELECT gps_cuenta_id FROM empresas WHERE id = $1', [e])).gps_cuenta_id, '7070');
  assert.match(cookieDe(r.cookies, 'volver_plataforma'), /lite\.wialon\.com/, 'empresa de Lite: al salir vuelve a Lite');
});

test('empresa desactivada: «tu acceso está pausado»', async () => {
  await t.db.q('UPDATE empresas SET activa = false WHERE id = $1', [otra]);
  respuesta = quien(888, 5555);
  const r = await entrar({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' });
  assert.equal(r.estado, 403);
  assert.equal(r.datos.motivo, 'suspendida');
  await t.db.q('UPDATE empresas SET activa = true WHERE id = $1', [otra]);
});

test('🔥 el ícono del menú Apps se sirve con Cross-Origin-Resource-Policy: cross-origin', async () => {
  for (const ruta of ['/app-plataforma.html/app/logo.png', '/app/logo.png', '/app-plataforma/app/logo.png']) {
    const r = await fetch(t.base + ruta);
    assert.equal(r.status, 200, ruta);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
    const b = Buffer.from(await r.arrayBuffer());
    assert.equal(b.subarray(1, 4).toString(), 'PNG');
    assert.equal(b.readUInt32BE(16), 128);
    assert.equal(b.readUInt32BE(20), 128);
  }
  const pagina = await fetch(`${t.base}/app-plataforma.html`);
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(`${t.base}/app-plataforma.html/app/otra.png`)).status, 404);
});
