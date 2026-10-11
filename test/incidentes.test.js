import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, db, fin;
before(async () => { t = await levantar(); db = t.db; fin = await t.como('finanzas@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

test('lista con filtros y datos de prueba', async () => {
  const r = await fin.get('/api/incidentes');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.incidentes.length >= 4);
  const pres = await fin.get('/api/incidentes?estado=presupuestado');
  assert.equal(pres.datos.incidentes.length, 1);
  const i = pres.datos.incidentes[0];
  assert.equal(i.patente, 'PBVX61');
  assert.equal(i.presupuesto, 280000);
  assert.equal(i.deducible, 450000);
  assert.equal(i.monto_cliente, 280000);
  assert.equal(r.datos.conteo.presupuestado, 1);
  const abiertos = await fin.get('/api/incidentes?estado=abiertos');
  assert.ok(abiertos.datos.incidentes.every((x) => !['cerrado', 'anulado'].includes(x.estado)));
});

test('ficha con fotos de entrega y devolución, daños y línea de tiempo', async () => {
  const [inc] = (await fin.get('/api/incidentes?estado=presupuestado')).datos.incidentes;
  const r = await fin.get(`/api/incidentes/${inc.id}`);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.reserva_folio, 'R-1008');
  assert.equal(r.datos.danos.length, 1);
  assert.equal(r.datos.fotos[0].posicion, 'derecho');
  assert.ok(r.datos.fotos[0].entrega.archivo_id && r.datos.fotos[0].devolucion.archivo_id);
  assert.deepEqual(r.datos.eventos.map((e) => e.tipo), ['reporte', 'presupuesto']);
  const foto = await fin.get(`/api/archivos/${r.datos.danos[0].archivo_id}`);
  assert.equal(foto.estado, 200);
});

test('presupuesto: monto al cliente = menor entre presupuesto y deducible; cambiarlo exige motivo', async () => {
  const rv = (await db.q(`SELECT id FROM reservas WHERE folio = 'R-1001'`))[0];
  const patio = await t.como('patio@siguelogps.cl');
  const nuevo = await patio.post('/api/incidentes', { tipo: 'accidente', reserva_id: rv.id, descripcion: 'Choque por alcance en Costanera Norte' });
  assert.equal(nuevo.estado, 200, JSON.stringify(nuevo.datos));
  assert.match(nuevo.datos.folio, /^INC-/);
  assert.equal(nuevo.datos.deducible, 350000); // Citycar
  const id = nuevo.datos.id;
  let p = await fin.post(`/api/incidentes/${id}/presupuesto`, { taller: 'Taller Lyon', presupuesto: 900000 });
  assert.equal(p.datos.estado, 'presupuestado');
  assert.equal(p.datos.monto_cliente, 350000);
  p = await fin.post(`/api/incidentes/${id}/presupuesto`, { taller: 'Taller Lyon', presupuesto: 900000, monto_cliente: 200000 });
  assert.equal(p.estado, 400);
  p = await fin.post(`/api/incidentes/${id}/presupuesto`, { taller: 'Taller Lyon', presupuesto: 900000, monto_cliente: 200000, motivo: 'Cliente frecuente, acuerdo comercial' });
  assert.equal(p.datos.monto_cliente, 200000);

  // Flujo completo: cobrado → seguro → pagado → cerrado (daño reparado), OT correctiva
  await db.q(`INSERT INTO danos (empresa_id, vehiculo_id, vista, x, y, tipo, incidente_id) SELECT empresa_id, vehiculo_id, 'frente', 180, 40, 'abolladura', id FROM incidentes WHERE id = $1`, [id]);
  assert.equal((await fin.post(`/api/incidentes/${id}/estado`, { estado: 'en_seguro' })).estado, 400, 'sin número de siniestro');
  let e = await fin.post(`/api/incidentes/${id}/estado`, { estado: 'cobrado_cliente', cobrado: 200000 });
  assert.equal(e.datos.cobrado_cliente, 200000);
  e = await fin.post(`/api/incidentes/${id}/estado`, { estado: 'en_seguro', numero_siniestro: 'S-123', compania_seguro: 'HDI Seguros' });
  assert.equal(e.datos.numero_siniestro, 'S-123');
  assert.equal((await fin.post(`/api/incidentes/${id}/estado`, { estado: 'presupuestado' })).estado, 409, 'no retrocede');
  const ot = await fin.post(`/api/incidentes/${id}/ot`, {});
  assert.equal(ot.estado, 200);
  assert.match(ot.datos.folio, /^OT-/);
  assert.equal(ot.datos.tipo, 'correctiva');
  assert.equal(ot.datos.incidente_id, id);
  e = await fin.post(`/api/incidentes/${id}/estado`, { estado: 'pagado', recupero_seguro: 700000 });
  assert.equal(e.datos.recupero_seguro, 700000);
  e = await fin.post(`/api/incidentes/${id}/estado`, { estado: 'cerrado', costo_real: 880000 });
  assert.equal(e.datos.estado, 'cerrado');
  assert.ok(e.datos.cerrado_en);
  const d = await db.q('SELECT estado, reparado_en FROM danos WHERE incidente_id = $1', [id]);
  assert.equal(d[0].estado, 'reparado');
  const ficha = (await fin.get(`/api/incidentes/${id}`)).datos;
  assert.deepEqual(ficha.eventos.map((x) => x.tipo), ['reporte', 'presupuesto', 'presupuesto', 'cobro', 'seguro', 'nota', 'pago', 'cierre']);
  assert.equal(ficha.ordenes.length, 1);
});

test('permisos: counter solo ve incidentes', async () => {
  const counter = await t.como('counter@siguelogps.cl');
  assert.equal((await counter.get('/api/incidentes')).estado, 200);
  assert.equal((await counter.post('/api/incidentes', { tipo: 'robo', patente: 'SXLR27', descripcion: 'x' })).estado, 403);
});
