import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, admin;
before(async () => { t = await levantar(); admin = await t.como('demo@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

const enDias = (d, h = 10) => { const x = new Date(Date.now() + d * 864e5); x.setUTCHours(h + 3, 0, 0, 0); return x.toISOString(); };

test('pantalla de tarifas y catálogo', async () => {
  const r = await admin.get('/api/tarifas');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.categorias.length >= 5 && r.datos.tarifas.length >= 10 && r.datos.extras.length >= 5);
  const patio = await t.como('patio@siguelogps.cl');
  assert.equal((await patio.get('/api/tarifas')).estado, 403);
  const cat = await patio.get('/api/catalogo');
  assert.equal(cat.estado, 200, 'el catálogo lo usa cualquier usuario con empresa');
  assert.ok(cat.datos.categorias[0].precio_dia > 0 && cat.datos.sucursales.length >= 3 && cat.datos.extras.length >= 5);
});

test('cotizar: tarifa, extras, otra sucursal, conductor joven y descuento', async () => {
  const { categorias, sucursales } = (await admin.get('/api/catalogo')).datos;
  const city = categorias.find((c) => c.nombre === 'Citycar');
  const body = { categoria_id: city.id, inicio: enDias(2), fin: enDias(5), sucursal_retiro_id: sucursales[0].id, sucursal_devolucion_id: sucursales[1].id,
    extras: [{ codigo: 'silla_nino', cantidad: 1 }], codigo_descuento: 'BIENVENIDA', fecha_nacimiento: '2004-01-01' };
  const r = await admin.post('/api/tarifas/cotizar', body);
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  assert.equal(r.datos.dias, 3);
  const cod = r.datos.lineas.map((l) => l.codigo);
  for (const c of ['arriendo', 'extra:silla_nino', 'recargo:otra_sucursal', 'recargo:conductor_joven', 'descuento:BIENVENIDA']) assert.ok(cod.includes(c), `${c} en ${cod.join()}`);
  assert.equal(r.datos.total, r.datos.lineas.reduce((s, l) => s + l.monto, 0));
  assert.equal(r.datos.garantia, 300000);
  // validaciones
  assert.equal((await admin.post('/api/tarifas/cotizar', { ...body, fin: enDias(1) })).estado, 400);
  assert.equal((await admin.post('/api/tarifas/cotizar', { ...body, categoria_id: 999999 })).estado, 400);
  // counter también cotiza
  const counter = await t.como('counter@siguelogps.cl');
  assert.equal((await counter.post('/api/tarifas/cotizar', body)).estado, 200);
});

test('editar tarifa y temporada se reflejan en la cotización', async () => {
  const d = (await admin.get('/api/tarifas')).datos;
  const van = d.categorias.find((c) => c.nombre === 'Van');
  const desde = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10), hasta = new Date(Date.now() + 50 * 864e5).toISOString().slice(0, 10);
  const tem = await admin.post('/api/temporadas', { nombre: 'Evento prueba', desde, hasta, prioridad: 50 });
  assert.equal(tem.estado, 201);
  const ta = await admin.put('/api/tarifas', { categoria_id: van.id, temporada_id: tem.datos.id, precio_dia: 100000, km_libre: true, garantia: 900000, deducible: 800000 });
  assert.equal(ta.estado, 200);
  const r = await admin.post('/api/tarifas/cotizar', { categoria_id: van.id, inicio: enDias(42), fin: enDias(44) });
  assert.equal(r.datos.temporada, 'Evento prueba');
  assert.equal(r.datos.lineas[0].monto, 200000);
  assert.equal(r.datos.km_libre, true);
  assert.equal((await admin.put('/api/tarifas', { categoria_id: van.id, precio_dia: 0 })).estado, 400);
  // borrar la temporada borra su tarifa
  assert.equal((await admin.del(`/api/temporadas/${tem.datos.id}`)).estado, 200);
  const r2 = await admin.post('/api/tarifas/cotizar', { categoria_id: van.id, inicio: enDias(42), fin: enDias(44) });
  assert.equal(r2.datos.temporada, 'Base');
});

test('extras, recargos y códigos de descuento', async () => {
  const x = await admin.post('/api/extras', { nombre: 'Portaesquís', cobro: 'fijo', precio: 15000 });
  assert.equal(x.estado, 201);
  assert.equal(x.datos.codigo, 'portaesquis');
  assert.equal((await admin.post('/api/extras', { nombre: 'Otro', codigo: 'portaesquis' })).estado, 409);
  assert.equal((await admin.put(`/api/extras/${x.datos.id}`, { activo: false })).datos.activo, false);
  assert.equal((await admin.post('/api/recargos', { tipo: 'conductor_joven', nombre: 'Joven' })).estado, 400);
  assert.equal((await admin.post('/api/descuentos', { codigo: 'v', tipo: 'porcentaje', valor: 20 })).estado, 400);
  const ok = await admin.post('/api/descuentos', { codigo: 'verano20', tipo: 'porcentaje', valor: 20, desde: '01-12-2026', hasta: '28-02-2027', usos_max: 50 });
  assert.equal(ok.estado, 201);
  assert.equal(ok.datos.codigo, 'VERANO20');
  assert.equal(ok.datos.desde, '2026-12-01');
  assert.equal((await admin.post('/api/descuentos', { codigo: 'VERANO20', tipo: 'monto', valor: 1000 })).estado, 409);
  const counter = await t.como('counter@siguelogps.cl');
  assert.equal((await counter.post('/api/descuentos', { codigo: 'HACK99', tipo: 'porcentaje', valor: 99 })).estado, 403);
});
