// 22-oct, más tarde (Pablo): la plataforma GPS la conecta el propio cliente en Configuración › Conexiones (su
// administrador, o el equipo Síguelo con «Operar»), con el ingreso con usuario y clave. Lo demás lo activa solo Síguelo.
// Se prueba: quién puede conectar, que la empresa sale de la sesión, que pegar un token sigue siendo solo de soporte en el
// backoffice, que apagarla en el backoffice impide conectarla y los tres estados de las tarjetas del cliente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';
import { _usarFetch } from '../src/gps/wialon.js';
import { crearEmpresa } from '../src/api/01-empresas.js';
import { leer, limpiarCache } from '../src/integraciones/index.js';
import { limpiarCachePlanes } from '../src/planes.js';

let t, E, admin, sop;
const TOKEN = 'f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5';
const json = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'Content-Type': 'application/json' } });

before(async () => {
  t = await levantar();
  E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
  admin = await t.como('demo@siguelogps.cl');
  sop = await t.como('soporte@siguelogps.cl');
  _usarFetch(async (_url, op) => {
    const svc = op.body.get('svc');
    if (svc === 'token/login') return json({ eid: 'sid', user: { nm: 'andes_flota', id: 7 } });
    if (svc === 'core/search_items') return json({ items: [{ id: 1, nm: 'A' }] });
    return json({});
  });
});
after(async () => { _usarFetch(null); await t.cerrar(); });

const estadoDe = (url) => new URL(new URL(url).searchParams.get('redirect_uri')).searchParams.get('estado');
const tarjeta = async (quien, tipo = 'gps') => (await quien.get('/api/integraciones')).datos.gestionadas.find((g) => g.tipo === tipo);
async function limpiarGps(empresaId = E) {
  await t.db.q(`DELETE FROM integraciones WHERE empresa_id = $1 AND tipo = 'gps'`, [empresaId]);
  limpiarCache();
}

test('sin cuenta, la tarjeta GPS deja conectar (no «No contratado»), y el administrador del cliente conecta con usuario y clave', async () => {
  await limpiarGps();
  const antes = await tarjeta(admin);
  assert.equal(antes.estado, 'por_conectar', 'antes salía «No contratado» y no dejaba conectar');
  assert.equal(antes.conexion.puede_conectar, true);
  const ing = await admin.get('/api/integraciones/gps/ingreso?cuenta=lite');
  assert.equal(ing.estado, 200);
  assert.equal(new URL(ing.datos.url).origin, 'https://lite.wialon.com');
  assert.match(new URL(ing.datos.url).searchParams.get('redirect_uri'), /\/integracion-gps\?gps=lite&desde=cliente&estado=/);
  const otra = await crearEmpresa({ nombre: 'Otra GPS Rent', admin_correo: 'otra-gps@ejemplo.cl', admin_clave: 'clave-otra-1' });
  const r = await admin.post('/api/integraciones/gps/token', { token: TOKEN, usuario: 'andes_flota', estado: estadoDe(ing.datos.url), cuenta: 'hosting', empresa_id: otra.id, empresaId: otra.id });
  assert.equal(r.estado, 200);
  assert.ok(!JSON.stringify(r.datos).includes(TOKEN), 'el token no vuelve al navegador');
  assert.equal(r.datos.prueba.ok, true);
  assert.equal(r.datos.tarjeta.estado, 'activo', 'conectada por el cliente queda encendida');
  const g = await leer(E, 'gps');
  assert.equal(g.config.token, TOKEN);
  assert.equal(g.config.cuenta, 'lite', 'la cuenta es la del ingreso, no la del cuerpo');
  assert.equal((await leer(otra.id, 'gps')).config.token, undefined, 'la empresa sale de la sesión, nunca del cuerpo');
  const vista = await admin.get('/api/integraciones');
  assert.ok(!JSON.stringify(vista.datos).includes(TOKEN));
  const gps = vista.datos.gestionadas.find((x) => x.tipo === 'gps');
  assert.deepEqual(Object.fromEntries(gps.datos.map(([k, v]) => [k, v])).Cuenta, 'Síguelo Lite');
  assert.ok(gps.datos.some(([k, v]) => k === 'Usuario conectado' && v === 'andes_flota'));
  assert.ok(gps.datos.some(([k]) => k === 'Unidades vinculadas'));
  // un solo uso
  assert.equal((await admin.post('/api/integraciones/gps/token', { token: TOKEN, estado: estadoDe(ing.datos.url) })).estado, 400);
  const bit = await t.db.uno(`SELECT detalle FROM bitacora WHERE empresa_id = $1 AND accion = 'integracion_gps_conectada' ORDER BY id DESC LIMIT 1`, [E]);
  assert.equal(bit.detalle.cuenta, 'lite');
});

test('«Ver como» no puede conectar; «Operar» sí, en la empresa de la sesión', async () => {
  await limpiarGps();
  assert.equal((await sop.post(`/api/backoffice/clientes/${E}/entrar`, { modo: 'ver' })).estado, 200);
  const t1 = await tarjeta(sop);
  assert.equal(t1.estado, 'por_conectar');
  assert.equal(t1.conexion.puede_conectar, false, 'la pantalla no ofrece el botón');
  const ver = await sop.get('/api/integraciones/gps/ingreso?cuenta=hosting');
  assert.equal(ver.estado, 403);
  assert.match(ver.datos.error, /Ver como/);
  assert.equal((await sop.post('/api/integraciones/gps/token', { token: TOKEN, estado: 'x' })).estado, 403);
  assert.equal((await t.db.uno(`SELECT count(*)::int AS n FROM gps_ingresos WHERE empresa_id = $1 AND origen = 'cliente' AND usuario_id = (SELECT id FROM usuarios WHERE correo = 'soporte@siguelogps.cl')`, [E])).n, 0, '«Ver como» no deja ni el estado creado');

  assert.equal((await sop.post(`/api/backoffice/clientes/${E}/entrar`, { modo: 'operar', motivo: 'Conectar la plataforma GPS con el cliente' })).estado, 200);
  assert.equal((await tarjeta(sop)).conexion.puede_conectar, true);
  const ing = await sop.get('/api/integraciones/gps/ingreso?cuenta=hosting');
  assert.equal(ing.estado, 200);
  const r = await sop.post('/api/integraciones/gps/token', { token: TOKEN, usuario: 'andes_flota', estado: estadoDe(ing.datos.url) });
  assert.equal(r.estado, 200);
  assert.equal((await leer(E, 'gps')).config.token, TOKEN);
  const bit = await t.db.uno(`SELECT detalle FROM bitacora WHERE empresa_id = $1 AND accion = 'integracion_gps_conectada' ORDER BY id DESC LIMIT 1`, [E]);
  assert.deepEqual(bit.detalle.siguelo, { modo: 'operar', motivo: 'Conectar la plataforma GPS con el cliente' }, 'queda en la bitácora del cliente con el motivo');
  await sop.post('/api/empresa-activa', { empresa_id: null });
});

test('otro rol del cliente no puede conectar ni ve la ruta', async () => {
  for (const correo of ['counter@siguelogps.cl', 'finanzas@siguelogps.cl', 'patio@siguelogps.cl']) {
    const u = await t.como(correo);
    assert.equal((await u.get('/api/integraciones/gps/ingreso?cuenta=hosting')).estado, 403, correo);
    assert.equal((await u.post('/api/integraciones/gps/token', { token: TOKEN, estado: 'x' })).estado, 403, correo);
  }
});

test('pegar un token a mano sigue siendo solo de soporte Síguelo, en el backoffice; desconectar también', async () => {
  await limpiarGps();
  const sinEstado = await admin.post('/api/integraciones/gps/token', { token: TOKEN, cuenta: 'hosting' });
  assert.equal(sinEstado.estado, 400, 'sin el estado del ingreso no se guarda nada');
  assert.equal((await admin.post(`/api/backoffice/clientes/${E}/integraciones/gps/token`, { token: TOKEN, cuenta: 'hosting' })).estado, 403);
  assert.equal((await admin.put('/api/integraciones/gps', { token: TOKEN })).estado, 403, 'ni por los datos de conexión');
  assert.equal((await admin.post(`/api/backoffice/clientes/${E}/integraciones/gps/desconectar`, {})).estado, 403, 'desconectar es de Síguelo');
  assert.equal((await leer(E, 'gps')).config.token, undefined);
  const sopo = await sop.post(`/api/backoffice/clientes/${E}/integraciones/gps/token`, { token: TOKEN, cuenta: 'hosting' });
  assert.equal(sopo.estado, 200, 'soporte sí');
  assert.equal((await leer(E, 'gps')).config.token, TOKEN);
});

test('si Síguelo la apaga en el backoffice, el cliente no la conecta; al volver a encenderla, sí', async () => {
  await limpiarGps();
  assert.equal((await sop.post(`/api/backoffice/clientes/${E}/integraciones/gps/activar`, { activa: false })).estado, 200);
  const t1 = await tarjeta(admin);
  assert.equal(t1.estado, 'no_contratado');
  assert.equal(t1.conexion.motivo, 'apagada');
  const r = await admin.get('/api/integraciones/gps/ingreso?cuenta=hosting');
  assert.equal(r.estado, 403);
  assert.match(r.datos.error, /Solicitar a Síguelo/);
  const ficha = (await sop.get(`/api/backoffice/clientes/${E}`)).datos;
  assert.equal(ficha.integraciones.find((i) => i.tipo === 'gps').apagada_por_siguelo, true);
  await sop.post(`/api/backoffice/clientes/${E}/integraciones/gps/activar`, { activa: true });
  assert.equal((await tarjeta(admin)).estado, 'por_conectar', 'encendida y sin cuenta: la conecta el cliente (no «en preparación»)');
  assert.equal((await admin.get('/api/integraciones/gps/ingreso?cuenta=hosting')).estado, 200);
});

test('si el plan no trae la plataforma GPS: «No contratado» y no se puede conectar', async () => {
  await limpiarGps();
  const { plan } = await t.db.uno('SELECT plan FROM empresas WHERE id = $1', [E]);
  await t.db.q(`UPDATE empresas SET plan = 'basico' WHERE id = $1`, [E]);
  limpiarCachePlanes();
  try {
    const g = await tarjeta(admin);
    assert.equal(g.estado, 'no_contratado');
    assert.equal(g.conexion.puede_conectar, false);
    assert.equal((await admin.get('/api/integraciones/gps/ingreso?cuenta=hosting')).estado, 403);
  } finally {
    await t.db.q('UPDATE empresas SET plan = $2 WHERE id = $1', [E, plan]);
    limpiarCachePlanes();
  }
});

test('las demás tarjetas: encendida y sin configurar queda «en preparación» (sin Solicitar); configurada, «activo»; apagada, «no contratado»', async () => {
  await t.db.q(`DELETE FROM integraciones WHERE empresa_id = $1 AND tipo = 'whatsapp'`, [E]);
  limpiarCache();
  assert.equal((await tarjeta(admin, 'whatsapp')).estado, 'no_contratado');
  await sop.post(`/api/backoffice/clientes/${E}/integraciones/whatsapp/activar`, { activa: true });
  assert.equal((await tarjeta(admin, 'whatsapp')).estado, 'en_preparacion', 'encendida por Síguelo pero sin configurar');
  await sop.put(`/api/backoffice/clientes/${E}/integraciones/whatsapp`, { phone_id: '1234', token: 'token-wa-secreto' });
  assert.equal((await tarjeta(admin, 'whatsapp')).estado, 'activo');
  await sop.post(`/api/backoffice/clientes/${E}/integraciones/whatsapp/activar`, { activa: false });
  assert.equal((await tarjeta(admin, 'whatsapp')).estado, 'no_contratado', 'apagada con datos: no está «en preparación»');
  // La pantalla: «en preparación» sin botón Solicitar
  const html = (await import('node:fs')).readFileSync(new URL('../public/configuracion.html', import.meta.url), 'utf8');
  assert.match(html, /if \(g\.estado === 'en_preparacion' \|\| g\.estado === 'por_conectar'\) return '';/);
  assert.match(html, /Síguelo GPS la está dejando lista/);
});
