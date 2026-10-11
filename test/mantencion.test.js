import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, admin;
before(async () => { t = await levantar(); admin = await t.como('demo@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

const vehiculo = async (pat) => (await admin.get('/api/vehiculos')).datos.find((v) => v.patente === pat);
const enDias = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() + d * 864e5));

test('órdenes de trabajo de la demo y resumen', async () => {
  const r = await admin.get('/api/ordenes-trabajo');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.some((o) => o.estado === 'en_taller'));
  assert.ok(r.datos.some((o) => o.estado === 'programada'));
  assert.ok(r.datos.filter((o) => o.estado === 'terminada').length >= 5);
  const res = await admin.get('/api/mantencion/resumen');
  assert.equal(res.datos.en_taller, 1);
  assert.ok(res.datos.costo_anio > 0);
});

test('sugeridas por km y revisión técnica', async () => {
  const s = (await admin.get('/api/mantencion/sugeridas')).datos;
  assert.ok(s.some((x) => x.patente === 'TFZB73' && x.tipo === 'preventiva' && x.por === 'km'));
  assert.ok(s.some((x) => x.patente === 'RKDS90' && x.tipo === 'revision_tecnica' && x.urgencia === 'vencida'));
  assert.ok(!s.some((x) => x.patente === 'SYPC11' && x.tipo === 'preventiva'), 'la que está en taller no se sugiere');
  assert.ok(!s.some((x) => x.patente === 'RTKP42' && x.tipo === 'preventiva'), 'la que ya tiene OT programada no se sugiere');
});

test('OT a taller crea bloqueo, saca al vehículo de la disponibilidad y al terminar lo libera', async () => {
  const v = await vehiculo('SGFT35'); // sin reservas que ocupen
  const ot = await admin.post('/api/ordenes-trabajo', { vehiculo_id: v.id, tipo: 'preventiva', motivo: 'Mantención 15.000 km', taller: 'Toyota Kaufmann', costo: 150000 });
  assert.equal(ot.estado, 201);
  assert.match(ot.datos.folio, /^OT-\d{4}$/);
  const a = await admin.post(`/api/ordenes-trabajo/${ot.datos.id}/estado`, { estado: 'en_taller', fin_estimado: enDias(2) });
  assert.equal(a.estado, 200, JSON.stringify(a.datos));
  const bloqueos = await t.db.q('SELECT * FROM bloqueos WHERE orden_trabajo_id = $1', [ot.datos.id]);
  assert.equal(bloqueos.length, 1);
  assert.ok(new Date(bloqueos[0].fin) > new Date());
  assert.equal((await vehiculo('SGFT35')).estado, 'mantencion');
  const { vehiculosDisponibles } = await import('../src/disponibilidad.js');
  const disp = await vehiculosDisponibles(v.empresa_id, { inicio: new Date(), fin: new Date(Date.now() + 864e5) });
  assert.ok(!disp.some((x) => x.id === v.id));
  // no se deja disponible a mano mientras está en taller
  assert.equal((await admin.post(`/api/vehiculos/${v.id}/estado`, { estado: 'disponible' })).estado, 409);
  // terminar: libera bloqueo y actualiza la mantención
  const tr = await admin.post(`/api/ordenes-trabajo/${ot.datos.id}/estado`, { estado: 'terminada', costo: 162000 });
  assert.equal(tr.estado, 200);
  const [b] = await t.db.q('SELECT fin FROM bloqueos WHERE orden_trabajo_id = $1', [ot.datos.id]);
  assert.ok(!b || new Date(b.fin) <= new Date());
  const desp = await vehiculo('SGFT35');
  assert.equal(desp.estado, 'disponible');
  assert.equal(desp.mant_ultima_km, desp.gps_km ?? desp.km);
  assert.ok(desp.mant_ultima_fecha);
  const otFin = (await admin.get(`/api/ordenes-trabajo/${ot.datos.id}`)).datos;
  assert.equal(otFin.costo, 162000);
  assert.equal(otFin.estado, 'terminada');
  assert.equal((await admin.post(`/api/ordenes-trabajo/${ot.datos.id}/estado`, { estado: 'en_taller' })).estado, 409);
});

test('OT a taller con reserva confirmada: 409 con folios; con forzar informa el conflicto', async () => {
  const v = await vehiculo('SJRT80'); // reserva confirmada en 2 días
  const ot = await admin.post('/api/ordenes-trabajo', { vehiculo_id: v.id, tipo: 'correctiva', motivo: 'Ruido en suspensión' });
  const r = await admin.post(`/api/ordenes-trabajo/${ot.datos.id}/estado`, { estado: 'en_taller', fin_estimado: enDias(5) });
  assert.equal(r.estado, 409);
  assert.ok(r.datos.conflictos.length >= 1);
  assert.match(r.datos.error, /R-\d+/);
  assert.equal((await t.db.q('SELECT count(*)::int AS n FROM bloqueos WHERE orden_trabajo_id = $1', [ot.datos.id]))[0].n, 0);
  assert.equal((await vehiculo('SJRT80')).estado, 'disponible');
  const f = await admin.post(`/api/ordenes-trabajo/${ot.datos.id}/estado`, { estado: 'en_taller', fin_estimado: enDias(5), forzar: true });
  assert.equal(f.estado, 200);
  assert.deepEqual(f.datos.conflictos, r.datos.conflictos.map((c) => c.folio));
  const an = await admin.post(`/api/ordenes-trabajo/${ot.datos.id}/estado`, { estado: 'anulada', notas: 'Se reprograma' });
  assert.equal(an.estado, 200);
  assert.equal((await vehiculo('SJRT80')).estado, 'disponible');
  // patio edita mantención; finanzas solo ve
  const fin = await t.como('finanzas@siguelogps.cl');
  assert.equal((await fin.post('/api/ordenes-trabajo', { vehiculo_id: v.id, motivo: 'x' })).estado, 403);
  const patio = await t.como('patio@siguelogps.cl');
  assert.equal((await patio.post('/api/ordenes-trabajo', { vehiculo_id: v.id, motivo: 'Lavado de motor', tipo: 'otro' })).estado, 201);
});

test('tarea diaria registra alertas de vencimientos una vez por día', async () => {
  const { revisarVencimientos } = await import('../src/api/12-mantencion.js');
  const n1 = await revisarVencimientos();
  assert.ok(n1 >= 1);
  assert.equal(await revisarVencimientos(), 0);
  const [b] = await t.db.q(`SELECT detalle FROM bitacora WHERE accion = 'vehiculo_alerta_vencimientos' AND detalle->>'patente' = 'RKDS90'`);
  assert.ok(b.detalle.alertas.some((a) => /Revisión técnica vencida/.test(a)));
});
