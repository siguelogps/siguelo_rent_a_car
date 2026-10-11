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
  const s = await t.como('pablo@siguelogps.cl', 'clave-larga-123');
  const yo = await s.get('/api/yo');
  assert.equal(yo.datos.usuario.rol, 'superadmin');
  assert.ok(yo.datos.empresas.length >= 1);
});
