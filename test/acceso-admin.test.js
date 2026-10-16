// Entrada desde Síguelo Admin: el pase se verifica con la clave pública del panel, sirve una vez y solo para
// «rentacar»; abre el backoffice del equipo Síguelo y nunca la cuenta de un cliente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { levantar } from './ayuda.js';
import { crearAccesoAdmin } from '../src/acceso-admin.js';
import { usarVerificador } from '../src/api/09-acceso-admin.js';

const claves = crypto.generateKeyPairSync('ed25519');
const jwk = { ...claves.publicKey.export({ format: 'jwk' }), kid: 'k1' };
function pase(datos) {
  const t = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'k1' })).toString('base64url');
  const d = Buffer.from(JSON.stringify({ iss: 'siguelo-admin', aud: 'rentacar', iat: t, exp: t + 60, jti: crypto.randomBytes(8).toString('hex'), ...datos })).toString('base64url');
  return `${h}.${d}.${crypto.sign(null, Buffer.from(`${h}.${d}`), claves.privateKey).toString('base64url')}`;
}
let t;
before(async () => {
  t = await levantar();
  usarVerificador(crearAccesoAdmin({ panel: 'https://panel.prueba', herramienta: 'rentacar', fetch: async () => new Response(JSON.stringify({ claves: [jwk] })) }));
});
after(async () => { await t?.cerrar(); });
const entrar = (p) => fetch(`${t.base}/api/acceso-admin`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ pase: p }) });

test('el equipo Síguelo entra al backoffice con el pase del panel', async () => {
  const p = pase({ sub: 'nueva.persona@siguelogps.cl', nombre: 'Nueva Persona', nivel: 'usa' });
  const r = await entrar(p);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/empresas');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const yo = await (await fetch(`${t.base}/api/yo`, { headers: { Cookie: cookie } })).json();
  assert.equal(yo.usuario.correo, 'nueva.persona@siguelogps.cl');
  assert.equal(yo.usuario.rol, 'soporte');
  assert.equal(yo.modo, 'backoffice');
  assert.equal((await entrar(p)).status, 401, 'el pase sirve una sola vez');
  const admin = await entrar(pase({ sub: 'nueva.persona@siguelogps.cl', nombre: 'Nueva Persona', nivel: 'admin' }));
  const yo2 = await (await fetch(`${t.base}/api/yo`, { headers: { Cookie: admin.headers.get('set-cookie').split(';')[0] } })).json();
  assert.equal(yo2.usuario.rol, 'superadmin', 'el nivel lo decide el panel');
});

test('no abre cuentas de clientes ni acepta pases de otra herramienta o alterados', async () => {
  assert.equal((await entrar(pase({ sub: 'demo@siguelogps.cl', nombre: 'Demo', nivel: 'admin' }))).status, 403, 'demo@ es usuario de una empresa cliente');
  assert.equal((await entrar(pase({ sub: 'x@siguelogps.cl', nivel: 'admin', aud: 'buses' }))).status, 401);
  const [h, d, s] = pase({ sub: 'y@siguelogps.cl', nivel: 've' }).split('.');
  const otro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(d, 'base64url')), nivel: 'admin' })).toString('base64url');
  assert.equal((await entrar(`${h}.${otro}.${s}`)).status, 401);
  assert.equal((await entrar('basura')).status, 401);
});
