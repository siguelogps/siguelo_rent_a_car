// «Ingresar con usuario y clave» en la plataforma GPS (22-oct, Pablo): la página de cada cuenta (Síguelo Pro por el
// dominio de Síguelo, Síguelo Lite por el suyo), la vuelta a /integracion-gps?gps=<cuenta>, que el token no vuelva a
// la pantalla y que la empresa salga de la sesión, nunca del cuerpo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';
import { _usarFetch } from '../src/gps/wialon.js';
import { crearEmpresa } from '../src/api/01-empresas.js';
import { leer } from '../src/integraciones/index.js';
import { config } from '../src/config.js';

let t, E;
before(async () => { t = await levantar(); E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id; });
after(async () => { _usarFetch(null); await t.cerrar(); });

const json = (cuerpo) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
const TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';

test('ingreso: Síguelo Pro por plataforma.siguelogps.com y Síguelo Lite por el suyo, con la cuenta en la vuelta', async () => {
  const admin = await t.como('demo@siguelogps.cl');
  const pro = await admin.get('/api/integraciones/gps/ingreso?cuenta=hosting');
  assert.equal(pro.estado, 200);
  const u = new URL(pro.datos.url);
  assert.equal(u.origin + u.pathname, 'https://plataforma.siguelogps.com/login.html', 'el cliente no ve el nombre del proveedor');
  assert.deepEqual(['client_id', 'access_type', 'activation_time', 'duration', 'flags', 'lang'].map((k) => u.searchParams.get(k)), ['SigueloRentacar', '-1', '0', '0', '0x1', 'es']);
  assert.equal(u.searchParams.get('redirect_uri'), `${config.urlBase}/integracion-gps?gps=hosting`);
  const lite = new URL((await admin.get('/api/integraciones/gps/ingreso?cuenta=lite')).datos.url);
  assert.equal(lite.origin, 'https://lite.wialon.com');
  assert.equal(lite.searchParams.get('redirect_uri'), `${config.urlBase}/integracion-gps?gps=lite`);
  // quien no administra integraciones no arma la dirección
  assert.equal((await (await t.como('counter@siguelogps.cl')).get('/api/integraciones/gps/ingreso?cuenta=hosting')).estado, 403);
});

test('vuelta y token pegado a mano: se prueba, no vuelve a la pantalla y queda en la empresa de la sesión', async () => {
  _usarFetch(async (_url, op) => {
    const svc = op.body.get('svc');
    if (svc === 'token/login') return json(JSON.parse(op.body.get('params')).token === TOKEN ? { eid: 'sid', user: { nm: 'andes_lite', id: 7 } } : { error: 4 });
    if (svc === 'core/search_items') return json({ items: [{ id: 1, nm: 'A' }, { id: 2, nm: 'B' }] });
    return json({});
  });
  const otra = await crearEmpresa({ nombre: 'Otra Rent', admin_correo: 'otra@ejemplo.cl', admin_clave: 'clave-otra-1' });
  const admin = await t.como('demo@siguelogps.cl');
  assert.equal((await admin.post('/api/integraciones/gps/token', { token: 'corto', cuenta: 'lite' })).estado, 400);
  const r = await admin.post('/api/integraciones/gps/token', { token: TOKEN, usuario: 'andes_lite', cuenta: 'lite', empresa_id: otra.id, empresaId: otra.id });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.prueba.ok, true);
  assert.equal(r.datos.integracion.config.cuenta, 'lite');
  assert.ok(!JSON.stringify(r.datos).includes(TOKEN), 'la respuesta no trae el token');
  const lista = await admin.get('/api/integraciones');
  assert.ok(!JSON.stringify(lista.datos).includes(TOKEN), 'la lista de integraciones no trae el token');
  assert.equal(lista.datos.integraciones.find((i) => i.tipo === 'gps').config.token, '••••••••');
  // quedó en la empresa de la sesión, no en la que venía en el cuerpo
  assert.equal((await leer(E, 'gps')).config.token, TOKEN);
  assert.equal((await leer(otra.id, 'gps')).config.token, undefined);
  _usarFetch(null);
});
