import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, admin;
async function ingresar(correo, clave) {
  const r = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, clave }) });
  if (!r.ok) return { estado: r.status };
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const post = async (ruta, body = {}) => {
    const x = await fetch(t.base + ruta, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { estado: x.status, datos: await x.json() };
  };
  return { estado: 200, post };
}

before(async () => { t = await levantar(); admin = await t.como('demo@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

test('páginas que exigen las tiendas y la PWA son públicas', async () => {
  for (const ruta of ['/privacidad', '/soporte', '/sin-conexion.html', '/manifest.webmanifest', '/sw.js', '/nativa.js', '/img/app/icono-512.png']) {
    const r = await fetch(t.base + ruta);
    assert.equal(r.status, 200, ruta);
  }
  const m = await (await fetch(`${t.base}/manifest.webmanifest`)).json();
  assert.equal(m.name, 'Síguelo On Rent');
  assert.match(await (await fetch(`${t.base}/privacidad`)).text(), /Eliminar tu cuenta/);
});

test('eliminar mi cuenta: borra datos personales y sesiones, pide clave y protege al único administrador', async () => {
  const yo = await admin.get('/api/yo');
  const n = await admin.post('/api/configuracion/usuarios', { nombre: 'Pedro Patio', correo: 'pedro@andesrent.cl', rol: 'patio', sucursal_id: yo.datos.sucursales[0].id });
  assert.equal(n.estado, 200, JSON.stringify(n.datos));
  const clave = n.datos.clave_temporal;
  const p = await ingresar('pedro@andesrent.cl', clave);
  assert.equal(p.estado, 200);
  assert.equal((await p.post('/api/configuracion/eliminar-mi-cuenta', { clave: 'mala' })).estado, 400);
  assert.equal((await p.post('/api/configuracion/eliminar-mi-cuenta', { clave })).estado, 200);
  assert.equal((await p.post('/api/configuracion/eliminar-mi-cuenta', { clave })).estado, 401); // sesión cerrada
  assert.equal((await ingresar('pedro@andesrent.cl', clave)).estado, 401);
  const lista = await admin.get('/api/configuracion/usuarios');
  const u = lista.datos.find((x) => x.id === n.datos.usuario.id);
  assert.equal(u.nombre, 'Usuario eliminado');
  assert.equal(u.activo, false);
  assert.ok(!lista.datos.some((x) => x.correo === 'pedro@andesrent.cl'));

  const r = await admin.post('/api/configuracion/eliminar-mi-cuenta', { clave: 'demo1234' });
  assert.equal(r.estado, 400);
  assert.match(r.datos.error, /único administrador/);
});
