import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, a;
before(async () => { t = await levantar(); a = await t.como('demo@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('alta de cliente valida el RUT con dígito verificador', async () => {
  const mal = await a.post('/api/clientes', { nombre: 'Ana', apellidos: 'Pérez', documento_tipo: 'rut', documento: '11.111.111-2' });
  assert.equal(mal.estado, 400);
  assert.equal(mal.datos.campo, 'documento');
  const ok = await a.post('/api/clientes', { nombre: 'Ana', apellidos: 'Pérez', documento_tipo: 'rut', documento: '11.111.111-1', licencia_vence: '01-02-2030' });
  assert.equal(ok.estado, 201, JSON.stringify(ok.datos));
  assert.equal(ok.datos.documento, '11111111-1');
  assert.equal(ok.datos.licencia_vence, '2030-02-01');
  const dup = await a.post('/api/clientes', { nombre: 'Otra', documento: '11111111-1' });
  assert.equal(dup.estado, 409);
});

test('extranjero con pasaporte y búsqueda', async () => {
  const r = await a.post('/api/clientes', { nombre: 'Marie', apellidos: 'Dupont', documento_tipo: 'pasaporte', documento: '18av-12345', nacionalidad: 'Francia' });
  assert.equal(r.estado, 201);
  assert.equal(r.datos.documento, '18AV12345');
  const b = await a.get('/api/clientes?q=dupont');
  assert.equal(b.datos.clientes.length, 1);
  const neg = await a.get('/api/clientes?lista_negra=1');
  assert.ok(neg.datos.clientes.every((c) => c.lista_negra));
});

test('lista negra exige motivo y queda en la bitácora; finanzas no puede', async () => {
  const c = await t.db.uno(`SELECT id FROM clientes WHERE documento = '18664012-8'`);
  assert.equal((await a.post(`/api/clientes/${c.id}/lista-negra`, { lista_negra: true })).estado, 400);
  const r = await a.post(`/api/clientes/${c.id}/lista-negra`, { lista_negra: true, motivo: 'No devolvió el TAG' });
  assert.equal(r.datos.lista_negra, true);
  const b = await t.db.uno(`SELECT * FROM bitacora WHERE entidad = 'cliente' AND entidad_id = $1 AND accion = 'cliente_lista_negra_agregado'`, [c.id]);
  assert.equal(b.detalle.motivo, 'No devolvió el TAG');
  const fin = await t.como('finanzas@siguelogps.cl');
  assert.equal((await fin.post(`/api/clientes/${c.id}/lista-negra`, { lista_negra: false, motivo: 'x' })).estado, 403);
  await a.post(`/api/clientes/${c.id}/lista-negra`, { lista_negra: false, motivo: 'Lo devolvió' });
});

test('documentos y conductores adicionales', async () => {
  const c = await t.db.uno(`SELECT id FROM clientes WHERE documento = '19234567-7'`);
  const d = await a.post(`/api/clientes/${c.id}/documentos`, { tipo: 'cedula_frente', dataUrl: PNG });
  assert.equal(d.estado, 201);
  assert.equal((await a.get(`/api/archivos/${d.datos.id}`)).estado, 200);
  const cond = await a.post(`/api/clientes/${c.id}/conductores`, { nombre: 'Pedro Silva', documento_tipo: 'rut', documento: '12.345.670-K', licencia_clase: 'B', licencia_vence: '2029-01-01' });
  assert.equal(cond.estado, 201);
  assert.equal((await a.post(`/api/clientes/${c.id}/conductores`, { nombre: 'X', documento: '12.345.670-1' })).estado, 400);
  const f = await a.get(`/api/clientes/${c.id}`);
  assert.equal(f.datos.conductores.length, 1);
  assert.equal(f.datos.documentos.length, 1);
  assert.equal((await a.del(`/api/clientes/${c.id}/documentos/${d.datos.id}`)).estado, 200);
  assert.equal((await a.del(`/api/clientes/${c.id}/conductores/${cond.datos.id}`)).estado, 200);
});

test('multi-empresa: no se ve un cliente de otra empresa', async () => {
  const { crearEmpresa } = await import('../src/api/01-empresas.js');
  const e = await crearEmpresa({ nombre: 'Otra Rent', admin_correo: 'otra@ejemplo.cl', admin_clave: 'demo1234' });
  const [c] = await t.db.q(`INSERT INTO clientes (empresa_id, nombre, documento) VALUES ($1, 'Ajeno', '5126663-3') RETURNING id`, [e.id]);
  assert.equal((await a.get(`/api/clientes/${c.id}`)).estado, 404);
});
