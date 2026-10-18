import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t;
before(async () => { t = await levantar(); });
after(async () => { delete process.env.SUPERADMIN_CORREO; delete process.env.SUPERADMIN_CLAVE; await t.cerrar(); });

test('el superadmin se define por SUPERADMIN_CORREO y el de la demo queda desactivado', async () => {
  process.env.SUPERADMIN_CORREO = 'Pablo@siguelogps.cl';
  process.env.SUPERADMIN_CLAVE = 'clave-larga-123';
  const { asegurarSuperadmin } = await import('../src/superadmin.js');
  await asegurarSuperadmin();
  await asegurarSuperadmin(); // idempotente
  const p = await t.db.uno(`SELECT rol, empresa_id, activo FROM usuarios WHERE correo = 'pablo@siguelogps.cl'`);
  assert.deepEqual([p.rol, p.empresa_id, p.activo], ['superadmin', null, true]);
  assert.equal((await t.db.uno(`SELECT activo FROM usuarios WHERE correo = 'soporte@siguelogps.cl'`)).activo, false);
  // cambiar SUPERADMIN_CLAVE en el servidor cambia la clave al siguiente arranque; si no cambia, se respeta la de «Mi cuenta»
  process.env.SUPERADMIN_CLAVE = 'otra-clave-456';
  await asegurarSuperadmin();
  await assert.rejects(() => t.como('pablo@siguelogps.cl', 'clave-larga-123'));
  const s0 = await t.como('pablo@siguelogps.cl', 'otra-clave-456');
  assert.equal((await s0.post('/api/configuracion/mi-clave', { actual: 'otra-clave-456', nueva: 'clave-larga-123' })).estado, 200);
  await asegurarSuperadmin(); // misma variable: no pisa la clave elegida
  const login = (clave) => fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'pablo@siguelogps.cl', clave }) }).then((r) => r.status);
  assert.equal(await login('clave-larga-123'), 200);
  assert.equal(await login('otra-clave-456'), 401);
  const s = await t.como('pablo@siguelogps.cl', 'clave-larga-123');
  const yo = await s.get('/api/yo');
  assert.equal(yo.datos.usuario.rol, 'superadmin');
  assert.equal(yo.datos.modo, 'backoffice');
  assert.equal(yo.datos.empresa, null);
});

test('equipo Síguelo: backoffice, «ver como», planes y límites', async () => {
  const sa = await t.como('pablo@siguelogps.cl', 'clave-larga-123');
  // sin «ver como» no accede a datos de clientes
  assert.equal((await sa.get('/api/reservas')).estado, 400);
  const E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
  // crear usuario de soporte
  const nuevo = await sa.post('/api/backoffice/equipo', { nombre: 'Ana Soporte', correo: 'ana@siguelogps.cl', rol: 'soporte' });
  assert.equal(nuevo.estado, 200);
  const ana = await t.como('ana@siguelogps.cl', nuevo.datos.clave_temporal);
  assert.equal((await ana.get('/api/backoffice/equipo')).estado, 403, 'soporte no administra el equipo');
  assert.equal((await ana.get('/api/backoffice/planes')).estado, 200);
  assert.equal((await ana.get('/api/empresas')).estado, 200);
  const vc = await ana.post('/api/empresa-activa', { empresa_id: E });
  assert.equal(vc.datos.destino, '/inicio');
  const yo = await ana.get('/api/yo');
  assert.equal(yo.datos.ver_como, true);
  assert.equal((await ana.get('/api/reservas')).estado, 200);
  await ana.post('/api/empresa-activa', { empresa_id: null });
  assert.equal((await ana.get('/api/yo')).datos.modo, 'backoffice');
  // plan Básico: sin GPS y con límite de vehículos
  assert.equal((await sa.patch(`/api/configuracion/empresas/${E}`, { plan: 'basico' })).estado, 200);
  const admin = await t.como('demo@siguelogps.cl');
  assert.equal((await admin.get('/api/gps/vehiculos')).estado, 403);
  assert.equal((await admin.get('/api/yo')).datos.permisos.gps, null);
  const suc = await admin.post('/api/configuracion/sucursales', { nombre: 'Temuco' });
  assert.equal(suc.estado, 403, 'el plan Básico permite 1 sucursal');
  assert.match(suc.datos.error, /plan Básico/);
  // con máximo 1 el sustantivo va en singular («1 sucursal», no «1 sucursales»)
  assert.match(suc.datos.error, /hasta 1 sucursal \(/);
  await sa.patch(`/api/configuracion/empresas/${E}`, { plan: 'pro' });
});
