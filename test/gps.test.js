import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';
import { haversine, puntoEnPoligono, dentroDeZona, aOctavos, normalizarUnidad, ClienteGps, _usarFetch } from '../src/gps/wialon.js';
import { evaluarReglas, dentroDeHorario, calcularDetenido } from '../src/gps/alertas.js';
import { desdeLocal } from '../src/util/formato.js';

let t, db, E;
before(async () => { t = await levantar(); db = t.db; E = (await db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id; });
after(async () => { _usarFetch(null); await t.cerrar(); });

const json = (cuerpo) => new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('geometría: haversine, punto en polígono, círculo y línea', () => {
  const d = haversine(-33.4489, -70.6693, -33.0472, -71.6127); // Santiago → Valparaíso ≈ 98 km
  assert.ok(d > 95000 && d < 101000);
  const rm = [{ x: -71.8, y: -32.9 }, { x: -69.8, y: -32.9 }, { x: -69.8, y: -34.3 }, { x: -71.8, y: -34.3 }];
  assert.equal(puntoEnPoligono(-33.45, -70.66, rm), true);
  assert.equal(puntoEnPoligono(-22.45, -68.93, rm), false); // Calama
  assert.equal(dentroDeZona({ t: 3, p: [{ x: -70.66, y: -33.45, r: 5000 }] }, -33.46, -70.67), true);
  assert.equal(dentroDeZona({ t: 3, p: [{ x: -70.66, y: -33.45, r: 500 }] }, -33.47, -70.67), false);
  assert.equal(dentroDeZona({ t: 1, w: 200, p: [{ x: -70.70, y: -33.45 }, { x: -70.60, y: -33.45 }] }, -33.4505, -70.65), true);
});

test('sensores: combustible a octavos y lectura normalizada de una unidad', () => {
  assert.equal(aOctavos(50, { m: '%' }), 4);
  assert.equal(aOctavos(45, { m: 'l' }, 45), 8);
  assert.equal(aOctavos(-348201.3876, { m: '%' }), null);
  const u = normalizarUnidad({ id: 30001, nm: 'SXLR-27 Kia Morning', pos: { x: -70.6, y: -33.4, s: 57, t: 1760000000 }, cnm: 21500,
    sens: { 1: { id: 1, n: 'Nivel Combustible', m: '%', t: 'fuel level' }, 2: { id: 2, n: 'Estado Motor', m: '' }, 3: { id: 3, n: 'Bloqueo de Motor', m: '' } } }, { 1: 75, 2: 1, 3: 0 });
  assert.deepEqual({ km: u.km, comb: u.combustible, motor: u.motor, vel: u.velocidad, lat: u.lat }, { km: 21500, comb: 6, motor: true, vel: 57, lat: -33.4 });
});

test('cliente de la plataforma: token/login, reingreso con error 1 y probador «Conectado: N unidades»', async () => {
  const svcs = [];
  let primera = true;
  _usarFetch(async (url, op) => {
    const svc = op.body.get('svc');
    svcs.push(svc);
    assert.equal(url, 'https://hst-api.wialon.com/wialon/ajax.html');
    if (svc === 'token/login') return json({ eid: `sid-${svcs.length}`, user: { nm: 'andes' } });
    if (svc === 'core/search_items') { if (primera) { primera = false; return json({ error: 1 }); } return json({ items: [{ id: 1, nm: 'A' }, { id: 2, nm: 'B' }, { id: 3, nm: 'C' }] }); }
    return json({});
  });
  const c = new ClienteGps({ url: 'https://hst-api.wialon.com', token: 'tk' });
  const items = await c.buscarUnidades(1);
  assert.equal(items.length, 3);
  assert.deepEqual(svcs, ['token/login', 'core/search_items', 'token/login', 'core/search_items']);
  const admin = await t.como('demo@siguelogps.cl');
  await admin.put('/api/integraciones/gps', { token: 'tk' });
  const p = await admin.post('/api/integraciones/gps/probar', {});
  assert.equal(p.datos.ok, true);
  assert.match(p.datos.mensaje, /^Conectado: 3 unidades/);
  _usarFetch(null);
});

test('reglas de alerta: velocidad, geocerca, detenido fuera de horario y sin señal', () => {
  const ahora = desdeLocal('2026-10-11', '02:00');
  const v = { id: 9, estado: 'arrendado' };
  const base = { vehiculo: v, reserva: { id: 4 }, config: { velocidad_maxima: 120, horario_desde: '06:00', horario_hasta: '23:00' }, ahora };
  const r1 = evaluarReglas({ ...base, lectura: { velocidad: 134, en: ahora, lat: -33, lng: -70 }, dentroZona: false, nombreZona: 'Chile continental' });
  assert.deepEqual(r1.map((a) => a.tipo).sort(), ['geocerca', 'velocidad']);
  assert.match(r1.find((a) => a.tipo === 'geocerca').detalle, /Chile continental/);
  const det = evaluarReglas({ ...base, lectura: { velocidad: 0, en: ahora, lat: -33, lng: -70 }, detenidoDesde: new Date(ahora - 45 * 60e3) });
  assert.deepEqual(det.map((a) => a.tipo), ['detenido_fuera_horario']);
  const dia = evaluarReglas({ ...base, ahora: desdeLocal('2026-10-11', '14:00'), lectura: { velocidad: 0, en: desdeLocal('2026-10-11', '14:00') }, detenidoDesde: desdeLocal('2026-10-11', '10:00') });
  assert.equal(dia.length, 0);
  const sen = evaluarReglas({ ...base, lectura: { velocidad: 150, en: new Date(ahora - 7 * 3600e3) } });
  assert.deepEqual(sen.map((a) => a.tipo), ['sin_senal']);
  assert.equal(dentroDeHorario(desdeLocal('2026-10-11', '23:30'), '22:00', '05:00'), true);
  const d = calcularDetenido({ gps_lat: -33.4, gps_lng: -70.6, gps_detenido_desde: '2026-10-10T10:00:00Z' }, { lat: -33.4001, lng: -70.6001, velocidad: 0 });
  assert.equal(d.toISOString(), '2026-10-10T10:00:00.000Z');
  assert.equal(calcularDetenido({}, { lat: 1, lng: 1, velocidad: 30 }), null);
});

test('sincronización: une por patente, actualiza vehículo, guarda lecturas y alertas sin duplicar', async () => {
  const { sincronizarEmpresa } = await import('../src/gps/sincronizar.js');
  await db.q(`UPDATE vehiculos SET gps_unidad_id = NULL WHERE patente = 'TFZB73'`);
  const rav = await db.uno(`SELECT id FROM vehiculos WHERE patente = 'TFZB73'`);
  const reserva = await db.uno(`SELECT id FROM reservas WHERE vehiculo_id = $1 AND estado = 'en_curso'`, [rav.id]);
  const antes = (await db.uno('SELECT count(*)::int AS n FROM gps_lecturas WHERE reserva_id = $1', [reserva.id])).n;
  const ahora = new Date(Date.now() + 20 * 60e3); // la última muestra de la demo es de hace 10 minutos
  const unidades = [{ id: '99001', nombre: 'TFZB-73 RAV4 blanca', lat: -39.28, lng: -71.97, velocidad: 131, motor: true, km: 19800, combustible: 3, en: ahora },
    { id: '99002', nombre: 'Unidad sin auto', lat: -33, lng: -70, velocidad: 0, en: ahora }];
  const r = await sincronizarEmpresa(E, { unidades, ahora });
  assert.equal(r.emparejadas, 1);
  assert.equal(r.vinculadas, 1);
  assert.equal(r.sin_vehiculo, 1);
  const v = await db.uno('SELECT * FROM vehiculos WHERE id = $1', [rav.id]);
  assert.equal(v.gps_unidad_id, '99001');
  assert.equal(v.gps_km, 19800);
  assert.equal(v.gps_combustible, 3);
  assert.equal(v.gps_velocidad, 131);
  assert.equal((await db.uno('SELECT count(*)::int AS n FROM gps_lecturas WHERE reserva_id = $1', [reserva.id])).n, antes + 1);
  assert.ok(await db.uno(`SELECT id FROM gps_alertas WHERE vehiculo_id = $1 AND tipo = 'velocidad' AND reserva_id = $2 AND huella LIKE 'vel:%'`, [rav.id, reserva.id]));
  const r2 = await sincronizarEmpresa(E, { unidades, ahora: new Date(ahora.getTime() + 60e3) });
  assert.equal(r2.alertas, 0); // misma hora: no se repite
  assert.equal(r2.lecturas, 0); // máximo una muestra cada 15 minutos
  const rec = await (await t.como('counter@siguelogps.cl')).get(`/api/gps/reservas/${reserva.id}/recorrido`);
  assert.equal(rec.estado, 200);
  assert.equal(rec.datos.fin.km, 19800);
  assert.ok(rec.datos.km_recorridos > 0);
  assert.ok(rec.datos.muestras.length > 2);
});

test('inmovilización: doble validación, nunca con el vehículo en movimiento, marcha blanca → simulada', async () => {
  const admin = await t.como('demo@siguelogps.cl');
  const soporte = await t.como('soporte@siguelogps.cl'); // superadmin: segundo validador
  await soporte.post('/api/empresa-activa', { empresa_id: (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id }); // «ver como»
  const counter = await t.como('counter@siguelogps.cl');
  const patio = await t.como('patio@siguelogps.cl');
  await admin.post('/api/integraciones/gps/activar', { activa: false });
  const v = await db.uno(`SELECT id, patente FROM vehiculos WHERE patente = 'SXLR27'`);
  await db.q('UPDATE vehiculos SET gps_velocidad = 0, gps_motor = false WHERE id = $1', [v.id]);
  assert.equal((await patio.post('/api/gps/inmovilizaciones', { vehiculo_id: v.id, accion: 'inmovilizar', motivo: 'Arriendo vencido' })).estado, 403);
  assert.equal((await counter.post('/api/gps/inmovilizaciones', { vehiculo_id: v.id, accion: 'inmovilizar', motivo: '' })).estado, 400);
  const s = await counter.post('/api/gps/inmovilizaciones', { vehiculo_id: v.id, accion: 'inmovilizar', motivo: 'Arriendo vencido y no contesta' });
  assert.equal(s.estado, 201);
  assert.equal(s.datos.estado, 'solicitada');
  assert.equal((await counter.post('/api/gps/inmovilizaciones', { vehiculo_id: v.id, accion: 'inmovilizar', motivo: 'Otra vez lo mismo' })).estado, 409);
  // el mismo usuario no confirma; un counter tampoco (debe ser administrador)
  assert.equal((await counter.post(`/api/gps/inmovilizaciones/${s.datos.id}/confirmar`, { patente: v.patente })).estado, 403);
  const s2 = await admin.post(`/api/gps/inmovilizaciones/${s.datos.id}/cancelar`, { motivo: 'prueba' });
  assert.equal(s2.datos.estado, 'rechazada');
  const sol = await admin.post('/api/gps/inmovilizaciones', { vehiculo_id: v.id, accion: 'inmovilizar', motivo: 'Arriendo vencido y no contesta' });
  const id = sol.datos.id;
  const mismo = await admin.post(`/api/gps/inmovilizaciones/${id}/confirmar`, { patente: v.patente });
  assert.equal(mismo.estado, 403);
  assert.match(mismo.datos.error, /otra persona/);
  assert.equal((await soporte.post(`/api/gps/inmovilizaciones/${id}/confirmar`, { patente: 'AAAA11' })).estado, 400);
  // en movimiento: queda confirmada y pendiente
  await db.q('UPDATE vehiculos SET gps_velocidad = 48, gps_motor = true WHERE id = $1', [v.id]);
  const conf = await soporte.post(`/api/gps/inmovilizaciones/${id}/confirmar`, { patente: 'sxlr-27' });
  assert.equal(conf.estado, 200);
  assert.equal(conf.datos.estado, 'confirmada');
  assert.equal(conf.datos.en_movimiento, true);
  assert.equal(conf.datos.mensaje, 'El vehículo está en movimiento: se enviará solo detenido');
  assert.equal(conf.datos.velocidad_al_enviar, 48);
  const rei = await admin.post(`/api/gps/inmovilizaciones/${id}/reintentar`, {});
  assert.equal(rei.datos.estado, 'confirmada');
  // detenido → marcha blanca → simulada, sin tocar el vehículo
  await db.q('UPDATE vehiculos SET gps_velocidad = 0, gps_motor = false WHERE id = $1', [v.id]);
  const fin = await admin.post(`/api/gps/inmovilizaciones/${id}/reintentar`, {});
  assert.equal(fin.datos.estado, 'simulada');
  assert.equal((await db.uno('SELECT gps_inmovilizado FROM vehiculos WHERE id = $1', [v.id])).gps_inmovilizado, false);
  assert.deepEqual(fin.datos.eventos.map((e) => e.tipo), ['solicitada', 'confirmada', 'en_movimiento', 'en_movimiento', 'simulada']);
  assert.ok(await db.uno(`SELECT id FROM bitacora WHERE accion = 'inmovilizacion_simulada' AND entidad_id = $1`, [id]));
  assert.equal((await admin.post(`/api/gps/inmovilizaciones/${id}/reintentar`, {})).estado, 409);
});

test('inmovilización real (sin marcha blanca): exec_cmd con el vehículo detenido, liberación con el mismo flujo', async () => {
  const admin = await t.como('demo@siguelogps.cl');
  const soporte = await t.como('soporte@siguelogps.cl');
  await soporte.post('/api/empresa-activa', { empresa_id: (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id });
  const v = await db.uno(`SELECT id, patente, gps_unidad_id FROM vehiculos WHERE patente = 'RVLW56'`);
  const cmds = [];
  _usarFetch(async (_url, op) => {
    const svc = op.body.get('svc'), params = JSON.parse(op.body.get('params'));
    if (svc === 'token/login') return json({ eid: 'sid' });
    if (svc === 'core/search_item') return json({ item: { id: Number(params.id), nm: v.patente, pos: { x: -71.25, y: -29.9, s: 0, t: Math.floor(Date.now() / 1000) }, cnm: 27900, sens: {} } });
    if (svc === 'unit/exec_cmd') { cmds.push(params); return json({}); }
    return json({});
  });
  try {
    await admin.put('/api/integraciones/gps', { token: 'tk', comando_inmovilizar: 'Activar Corte de Motor', comando_liberar: 'Desactivar Corte de Motor' });
    await admin.post('/api/integraciones/gps/activar', { activa: true });
    await db.q('UPDATE empresas SET marcha_blanca = false WHERE id = $1', [E]);
    await db.q('UPDATE vehiculos SET gps_velocidad = 80 WHERE id = $1', [v.id]); // lo guardado dice que se mueve, pero la lectura en vivo manda
    for (const [accion, comando, queda] of [['inmovilizar', 'Activar Corte de Motor', true], ['liberar', 'Desactivar Corte de Motor', false]]) {
      const s = await admin.post('/api/gps/inmovilizaciones', { vehiculo_id: v.id, accion, motivo: `Prueba de ${accion}` });
      const c = await soporte.post(`/api/gps/inmovilizaciones/${s.datos.id}/confirmar`, { patente: v.patente });
      assert.equal(c.datos.estado, 'enviada');
      assert.deepEqual(cmds.at(-1), { itemId: Number(v.gps_unidad_id), commandName: comando, linkType: '', param: '', timeout: 60, flags: 0 });
      assert.equal((await db.uno('SELECT gps_inmovilizado FROM vehiculos WHERE id = $1', [v.id])).gps_inmovilizado, queda);
    }
    assert.equal(cmds.length, 2);
  } finally {
    _usarFetch(null);
    await db.q('UPDATE empresas SET marcha_blanca = true WHERE id = $1', [E]);
    await admin.post('/api/integraciones/gps/activar', { activa: false });
  }
});

test('API del mapa: vehículos con contrato, alertas y atender con nota', async () => {
  const counter = await t.como('counter@siguelogps.cl');
  const vs = await counter.get('/api/gps/vehiculos');
  assert.equal(vs.estado, 200);
  const pk = vs.datos.find((x) => x.patente === 'PKHG24');
  assert.equal(pk.cliente, 'Constructora Aconcagua SpA');
  assert.ok(pk.alertas >= 1);
  const al = await counter.get('/api/gps/alertas');
  const geo = al.datos.find((a) => a.tipo === 'geocerca');
  assert.match(geo.detalle, /Salida de la región permitida/);
  assert.equal((await counter.post(`/api/gps/alertas/${geo.id}/atender`, {})).estado, 400);
  const ok = await counter.post(`/api/gps/alertas/${geo.id}/atender`, { nota: 'Faena autorizada en Calama' });
  assert.equal(ok.datos.atendida, true);
  const patio = await t.como('patio@siguelogps.cl');
  assert.equal((await patio.post(`/api/gps/alertas/${geo.id}/atender`, { nota: 'x' })).estado, 403);
  assert.equal((await patio.get('/api/gps/unidades')).estado, 403);
});
