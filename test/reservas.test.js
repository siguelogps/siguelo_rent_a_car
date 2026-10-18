import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, a;
before(async () => { t = await levantar(); a = await t.como('demo@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

const DIA = 864e5;
const enDias = (d, h = 10) => { const x = new Date(Date.now() + d * DIA); x.setUTCHours(h + 3, 0, 0, 0); return x.toISOString(); };
const vehiculo = async (pat) => (await t.db.uno('SELECT * FROM vehiculos WHERE patente = $1', [pat]));
const cliente = async (doc) => (await t.db.uno('SELECT * FROM clientes WHERE documento = $1', [doc]));

async function crear(body) {
  const r = await a.post('/api/reservas', body);
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  return r.datos;
}

test('calendario: vehículos, reservas, bloqueos e indicadores', async () => {
  const r = await a.get(`/api/reservas/calendario?desde=${enDias(-3)}&hasta=${enDias(11)}`);
  assert.equal(r.estado, 200);
  assert.ok(r.datos.vehiculos.length >= 10);
  assert.ok(r.datos.reservas.some((x) => x.estado === 'en_curso'));
  assert.ok(r.datos.bloqueos.length >= 1);
  assert.ok(r.datos.kpis.atrasadas.length >= 1);
});

test('cotizar y crear cotización (folio C) y confirmarla (folio R nuevo, C en notas, aviso retenido)', async () => {
  const v = await vehiculo('SJRT80'), c = await cliente('16482903-0');
  const base = { cliente_id: c.id, categoria_id: v.categoria_id, vehiculo_id: v.id, sucursal_retiro_id: v.sucursal_id, sucursal_devolucion_id: v.sucursal_id, inicio: enDias(20), fin: enDias(23) };
  const cot = await a.post('/api/reservas/cotizar', base);
  assert.equal(cot.estado, 200);
  assert.equal(cot.datos.dias, 3);
  const r = await crear({ ...base, estado: 'cotizacion' });
  assert.match(r.folio, /^C-\d{4}$/);
  assert.equal(r.total, cot.datos.total);
  const conf = await a.post(`/api/reservas/${r.id}/estado`, { estado: 'confirmada' });
  assert.equal(conf.estado, 200, JSON.stringify(conf.datos));
  assert.match(conf.datos.folio, /^R-\d+$/);
  assert.match(conf.datos.notas, new RegExp(r.folio));
  const sal = await t.db.q(`SELECT * FROM salidas WHERE entidad = 'reserva' AND entidad_id = $1`, [r.id]);
  assert.ok(sal.length >= 1 && sal.every((s) => s.estado === 'retenida'), 'marcha blanca: aviso retenido');
});

test('transiciones de estado válidas e inválidas', async () => {
  const v = await vehiculo('SJRT80'), c = await cliente('17935221-4');
  const r = await crear({ cliente_id: c.id, vehiculo_id: v.id, sucursal_retiro_id: v.sucursal_id, inicio: enDias(30), fin: enDias(32), estado: 'confirmada' });
  assert.match(r.folio, /^R-/);
  // confirmada → en_curso no se hace desde aquí (patio)
  assert.equal((await a.post(`/api/reservas/${r.id}/estado`, { estado: 'en_curso' })).estado, 409);
  // cancelar exige motivo
  assert.equal((await a.post(`/api/reservas/${r.id}/estado`, { estado: 'cancelada' })).estado, 400);
  const can = await a.post(`/api/reservas/${r.id}/estado`, { estado: 'cancelada', motivo: 'Cambió de planes' });
  assert.equal(can.datos.estado, 'cancelada');
  assert.equal((await a.post(`/api/reservas/${r.id}/estado`, { estado: 'confirmada' })).estado, 409);
  // patio sin permiso de edición
  const patio = await t.como('patio@siguelogps.cl');
  assert.equal((await patio.post(`/api/reservas/${r.id}/estado`, { estado: 'cancelada', motivo: 'x' })).estado, 403);
});

test('helper cambiarEstado: en_curso marca arrendado y devuelta libera el vehículo', async () => {
  const { cambiarEstado } = await import('../src/reservas/estados.js');
  const v = await vehiculo('SJRT80'), c = await cliente('9876543-3');
  const r = await crear({ cliente_id: c.id, vehiculo_id: v.id, sucursal_retiro_id: v.sucursal_id, inicio: enDias(40), fin: enDias(42), estado: 'confirmada' });
  const fila = await t.db.uno('SELECT * FROM reservas WHERE id = $1', [r.id]);
  await t.db.transaccion((tx) => cambiarEstado(tx, fila, 'en_curso', null));
  assert.equal((await vehiculo('SJRT80')).estado, 'arrendado');
  await t.db.transaccion((tx) => cambiarEstado(tx, fila, 'devuelta', null));
  assert.equal((await vehiculo('SJRT80')).estado, 'disponible');
  await assert.rejects(t.db.transaccion((tx) => cambiarEstado(tx, fila, 'confirmada', null)), /no puede pasar/);
});

test('mover: 409 con el folio en conflicto y movimiento válido con recotización', async () => {
  const ocupada = await t.db.uno(`SELECT r.* FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE v.patente = 'RKDS90' AND r.estado = 'confirmada'`);
  const otra = await t.db.uno(`SELECT r.* FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE v.patente = 'TFZB73' AND r.estado = 'confirmada'`);
  // mover la reserva de TFZB73 encima de la confirmada de RKDS90
  const rk = await vehiculo('RKDS90');
  const r = await a.patch(`/api/reservas/${otra.id}/mover`, { vehiculo_id: rk.id, inicio: ocupada.inicio, fin: ocupada.fin });
  assert.equal(r.estado, 409);
  assert.equal(r.datos.folio, ocupada.folio);
  assert.match(r.datos.error, new RegExp(ocupada.folio));
  // en curso no se mueve
  const enCurso = await t.db.uno(`SELECT id FROM reservas WHERE estado = 'en_curso' LIMIT 1`);
  assert.equal((await a.patch(`/api/reservas/${enCurso.id}/mover`, { inicio: enDias(50), fin: enDias(52) })).estado, 409);
  // movimiento válido a otra categoría en fechas libres: simular y aplicar
  const sj = await vehiculo('SJRT80');
  const cuerpo = { vehiculo_id: sj.id, inicio: enDias(60), fin: enDias(60 + 7) };
  const sim = await a.patch(`/api/reservas/${otra.id}/mover`, { ...cuerpo, simular: true });
  assert.equal(sim.estado, 200);
  assert.equal(sim.datos.cambia_categoria, true);
  const ok = await a.patch(`/api/reservas/${otra.id}/mover`, cuerpo);
  assert.equal(ok.estado, 200, JSON.stringify(ok.datos));
  assert.equal(ok.datos.vehiculo_id, sj.id);
  assert.equal(ok.datos.categoria_id, sj.categoria_id);
  assert.equal(ok.datos.total, sim.datos.total_nuevo);
});

test('no se reserva a un cliente en lista negra ni un vehículo ocupado', async () => {
  const negro = await cliente('17654321-3'), v = await vehiculo('RKDS90');
  const ocupada = await t.db.uno(`SELECT * FROM reservas WHERE vehiculo_id = $1 AND estado = 'confirmada'`, [v.id]);
  const r1 = await a.post('/api/reservas', { cliente_id: negro.id, vehiculo_id: v.id, sucursal_retiro_id: v.sucursal_id, inicio: enDias(70), fin: enDias(71) });
  assert.equal(r1.estado, 409);
  assert.match(r1.datos.error, /lista negra/);
  const c = await cliente('16482903-0');
  const r2 = await a.post('/api/reservas', { cliente_id: c.id, vehiculo_id: v.id, sucursal_retiro_id: v.sucursal_id, inicio: ocupada.inicio, fin: ocupada.fin, estado: 'confirmada' });
  assert.equal(r2.estado, 409);
  assert.equal(r2.datos.folio, ocupada.folio);
});

test('ficha, lista con filtros y Excel', async () => {
  const id = (await t.db.uno(`SELECT id FROM reservas WHERE estado = 'en_curso' LIMIT 1`)).id;
  const f = await a.get(`/api/reservas/${id}`);
  assert.equal(f.estado, 200);
  assert.ok(f.datos.url_portal.includes('/portal/'));
  const l = await a.get('/api/reservas?estado=atrasada');
  assert.ok(l.datos.length >= 1 && l.datos.every((x) => x.atrasada));
  const x = await a.get('/api/reservas/excel');
  assert.equal(x.estado, 200);
  assert.equal(x.datos.slice(0, 2).toString(), 'PK');
  assert.equal((await a.get('/api/reservas/999999')).estado, 404);
});

test('ocupación de hoy: Inicio y Reservas usan la misma regla', async () => {
  // Antes Inicio contaba toda la flota activa y Reservas sacaba los fuera de servicio (6 de 12 vs 6 de 11).
  const comparar = async () => {
    const ini = (await a.get('/api/inicio')).datos.flota;
    const cal = (await a.get(`/api/reservas/calendario?desde=${enDias(-1)}&hasta=${enDias(1)}`)).datos.kpis.flota;
    assert.equal(ini.total, cal.total);
    assert.equal(ini.ocupados, cal.ocupados);
    return cal;
  };
  const antes = await comparar();
  const E = (await t.db.uno(`SELECT empresa_id FROM vehiculos WHERE patente = 'SJRT80'`)).empresa_id;
  const base = await t.db.uno(`SELECT count(*)::int AS n FROM vehiculos WHERE empresa_id = $1 AND activo AND estado <> 'fuera_servicio'`, [E]);
  assert.equal(antes.total, base.n, 'la base no incluye los vehículos fuera de servicio');
  // un vehículo libre pasa a fuera de servicio: baja la base en ambas pantallas por igual
  const libre = await t.db.uno(`SELECT v.id, v.estado FROM vehiculos v WHERE v.empresa_id = $1 AND v.activo AND v.estado = 'disponible'
      AND NOT EXISTS (SELECT 1 FROM reservas r WHERE r.vehiculo_id = v.id AND r.estado = 'en_curso') LIMIT 1`, [E]);
  await t.db.q(`UPDATE vehiculos SET estado = 'fuera_servicio' WHERE id = $1`, [libre.id]);
  try {
    const despues = await comparar();
    assert.equal(despues.total, antes.total - 1);
    assert.equal(despues.ocupados, antes.ocupados);
  } finally {
    await t.db.q('UPDATE vehiculos SET estado = $2 WHERE id = $1', [libre.id, libre.estado]);
  }
});
