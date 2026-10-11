import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const POS = ['frente', 'atras', 'izquierdo', 'derecho', 'esq_fi', 'esq_fd', 'esq_ti', 'esq_td', 'interior', 'odometro', 'combustible'];

let t, patio, db;
before(async () => { t = await levantar(); db = t.db; patio = await t.como('patio@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

const reservaDe = async (estado, patente) => (await db.q(`SELECT r.* FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.estado = $1 AND v.patente = $2 ORDER BY r.id LIMIT 1`, [estado, patente]))[0];
async function subirFotos(inspId, posiciones) {
  for (const p of posiciones) {
    const r = await patio.post(`/api/patio/inspecciones/${inspId}/fotos`, { posicion: p, dataUrl: PNG, lat: -33.3968, lng: -70.7937, tomada_en: new Date().toISOString() });
    assert.equal(r.estado, 200, JSON.stringify(r.datos));
  }
}

test('tareas del día: entregas y devoluciones de la sucursal', async () => {
  const r = await patio.get('/api/patio/tareas');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.entregas.some((x) => x.patente === 'PBVX61'), 'la entrega de hoy de PBVX61 aparece');
  assert.ok(r.datos.recientes.some((x) => x.patente === 'PBVX61' && x.estado === 'devuelta'));
  const b = await patio.get('/api/patio/tareas?q=rkds-90');
  assert.ok(b.datos.devoluciones.some((x) => x.patente === 'RKDS90' && x.atrasada));
});

test('entrega: no se completa sin las 11 fotos; al completar la reserva pasa a en curso y el vehículo a arrendado', async () => {
  const rv = await reservaDe('confirmada', 'PBVX61');
  const ini = await patio.post(`/api/patio/reservas/${rv.id}/iniciar`);
  assert.equal(ini.estado, 200, JSON.stringify(ini.datos));
  assert.equal(ini.datos.tipo, 'entrega');
  assert.equal(ini.datos.modo, 'entrega');
  assert.equal(ini.datos.inspeccion.estado, 'borrador');
  assert.equal(ini.datos.danos_previos.length, 4, 'los daños activos del vehículo aparecen como preexistentes');
  assert.equal(ini.datos.lectura.origen, 'plataforma_gps');
  const id = ini.datos.inspeccion.id;
  // retomar: el mismo borrador
  assert.equal((await patio.post(`/api/patio/reservas/${rv.id}/iniciar`)).datos.inspeccion.id, id);

  await patio.put(`/api/patio/inspecciones/${id}`, { km: 48320, combustible: 7, km_gps: 48320, combustible_gps: 7, checklist: { repuesto: true, gata: true, triangulos: 2, extintor: true, documentos: true, tag: true, limpieza: 'sucio', notas: { limpieza: 'Polvo en tablero' } } });
  let c = await patio.post(`/api/patio/inspecciones/${id}/completar`, { firma: PNG, firmante_nombre: 'Valentina Soto Riquelme' });
  assert.equal(c.estado, 400);
  assert.match(c.datos.error, /Faltan 11 de 11 fotos/);
  await subirFotos(id, POS.slice(0, 10));
  c = await patio.post(`/api/patio/inspecciones/${id}/completar`, { firma: PNG, firmante_nombre: 'Valentina Soto Riquelme' });
  assert.equal(c.estado, 400);
  assert.match(c.datos.error, /Faltan 1 de 11 fotos obligatorias: Combustible/);
  // reemplazar una foto no duplica
  await subirFotos(id, ['frente', 'combustible']);
  // un daño nuevo en la entrega queda como preexistente
  const d = await patio.post(`/api/patio/inspecciones/${id}/danos`, { vista: 'superior', x: 180, y: 250, tipo: 'raya', descripcion: 'Raya en el techo' });
  assert.equal(d.estado, 200);
  c = await patio.post(`/api/patio/inspecciones/${id}/completar`, { firma: PNG, firmante_nombre: 'Valentina Soto Riquelme', lat: -33.39, lng: -70.79 });
  assert.equal(c.estado, 200, JSON.stringify(c.datos));
  assert.equal(c.datos.inspeccion.estado, 'completa');
  assert.equal(c.datos.incidentes.length, 0, 'la entrega no genera incidentes');
  const r2 = (await db.q('SELECT estado, retiro_real FROM reservas WHERE id = $1', [rv.id]))[0];
  assert.equal(r2.estado, 'en_curso');
  assert.ok(r2.retiro_real);
  const v = (await db.q('SELECT estado, km, combustible_nivel FROM vehiculos WHERE id = $1', [rv.vehiculo_id]))[0];
  assert.equal(v.estado, 'arrendado');
  assert.equal(v.combustible_nivel, 7);
  const g = await db.q('SELECT * FROM gps_lecturas WHERE reserva_id = $1', [rv.id]);
  assert.equal(g.length, 1);
  assert.equal((await db.q('SELECT count(*)::int AS n FROM inspeccion_fotos WHERE inspeccion_id = $1', [id]))[0].n, 11);
  // ya no se puede volver a completar ni editar
  assert.equal((await patio.post(`/api/patio/inspecciones/${id}/completar`, { firma: PNG })).estado, 409);
  assert.equal((await patio.del(`/api/patio/danos/${d.datos.id}`)).estado, 409);
});

test('devolución con un daño nuevo crea un incidente y la comparación entrega los números', async () => {
  const rv = await reservaDe('en_curso', 'PBVX61');
  assert.ok(rv, 'la reserva quedó en curso en la prueba anterior');
  const ini = await patio.post(`/api/patio/reservas/${rv.id}/iniciar`);
  assert.equal(ini.datos.tipo, 'devolucion');
  assert.equal(ini.datos.danos_previos.length, 5);
  assert.equal(ini.datos.inspeccion.checklist.triangulos, 2, 'el checklist parte desde el de la entrega');
  const id = ini.datos.inspeccion.id;
  await subirFotos(id, POS);
  const d = await patio.post(`/api/patio/inspecciones/${id}/danos`, { vista: 'derecho', x: 300, y: 170, tipo: 'abolladura', descripcion: 'Abolladura puerta delantera der.', dataUrl: PNG });
  assert.equal(d.estado, 200);
  assert.ok(d.datos.archivo_id);
  // un daño marcado por error se puede borrar mientras sea borrador
  const borrar = await patio.post(`/api/patio/inspecciones/${id}/danos`, { vista: 'frente', x: 180, y: 40, tipo: 'otro' });
  assert.equal((await patio.del(`/api/patio/danos/${borrar.datos.id}`)).estado, 200);
  // km menor que la entrega: rechazado
  await patio.put(`/api/patio/inspecciones/${id}`, { km: 48000, combustible: 4 });
  let c = await patio.post(`/api/patio/inspecciones/${id}/completar`, { firma: PNG });
  assert.equal(c.estado, 400);
  assert.match(c.datos.error, /menor que el de la entrega/);
  await patio.put(`/api/patio/inspecciones/${id}`, { km: 50000, combustible: 4, checklist: { repuesto: true, gata: true, triangulos: 1, extintor: false, documentos: true, tag: true, limpieza: 'sucio', notas: { limpieza: 'Requiere lavado' } } });
  c = await patio.post(`/api/patio/inspecciones/${id}/completar`, { firma: PNG, firmante_nombre: 'Valentina Soto', mantencion: true });
  assert.equal(c.estado, 200, JSON.stringify(c.datos));
  assert.equal(c.datos.incidentes.length, 1);
  assert.match(c.datos.incidentes[0].folio, /^INC-\d{4}$/);
  const inc = (await db.q('SELECT * FROM incidentes WHERE id = $1', [c.datos.incidentes[0].id]))[0];
  assert.equal(inc.tipo, 'dano');
  assert.equal(inc.estado, 'reportado');
  assert.equal(inc.reserva_id, rv.id);
  assert.equal(inc.vehiculo_id, rv.vehiculo_id);
  assert.equal(inc.cliente_id, rv.cliente_id);
  assert.equal(inc.deducible, rv.deducible);
  const ev = await db.q('SELECT tipo FROM incidente_eventos WHERE incidente_id = $1', [inc.id]);
  assert.deepEqual(ev.map((e) => e.tipo), ['reporte']);
  assert.equal((await db.q('SELECT incidente_id FROM danos WHERE id = $1', [d.datos.id]))[0].incidente_id, inc.id);
  const r2 = (await db.q('SELECT estado, devolucion_real FROM reservas WHERE id = $1', [rv.id]))[0];
  assert.equal(r2.estado, 'devuelta');
  assert.ok(r2.devolucion_real);
  assert.equal((await db.q('SELECT estado FROM vehiculos WHERE id = $1', [rv.vehiculo_id]))[0].estado, 'mantencion');

  const cmp = (await patio.get(`/api/patio/reservas/${rv.id}/comparacion`)).datos;
  assert.equal(cmp.completa, true);
  assert.equal(cmp.km_entrega, 48320);
  assert.equal(cmp.km_devolucion, 50000);
  assert.equal(cmp.km_recorridos, 1680);
  assert.equal(cmp.km_incluidos, rv.km_incluidos);
  assert.equal(cmp.km_extra, Math.max(0, 1680 - rv.km_incluidos));
  assert.equal(cmp.combustible_entrega, 7);
  assert.equal(cmp.combustible_devolucion, 4);
  assert.equal(cmp.octavos_faltantes, 3);
  assert.equal(cmp.litros_faltantes, 16.9); // 3/8 de 45 L
  assert.equal(cmp.danos_antes, 5);
  assert.equal(cmp.danos_despues, 6);
  assert.equal(cmp.danos_nuevos.length, 1);
  assert.equal(cmp.danos_nuevos[0].incidente_id, inc.id);
  assert.equal(cmp.danos_nuevos[0].n, 6);
  assert.equal(cmp.checklist.triangulos_faltantes, 1);
  assert.deepEqual(cmp.checklist.faltantes, ['extintor']);
  assert.equal(cmp.checklist.requiere_lavado, true);
  assert.equal(cmp.fotos.find((f) => f.posicion === 'derecho').danos_nuevos[0].n, 6);
  assert.equal(cmp.liquidacion_url, `/liquidaciones/${rv.id}`);
});

test('comparación de la devolución de prueba (R-1008): atraso, km extra y combustible', async () => {
  const [rv] = await db.q(`SELECT * FROM reservas WHERE folio = 'R-1008'`);
  const fin = await t.como('finanzas@siguelogps.cl'); // liquidaciones también la consume
  const r = await fin.get(`/api/patio/reservas/${rv.id}/comparacion`);
  assert.equal(r.estado, 200);
  const c = r.datos;
  assert.equal(c.reserva.folio, 'R-1008');
  assert.equal(c.km_recorridos, 1340);
  assert.equal(c.km_extra, 1340 - rv.km_incluidos);
  assert.equal(c.octavos_faltantes, 3);
  assert.equal(c.atraso_minutos, 104);
  assert.equal(c.tolerancia_min, 59);
  assert.equal(c.dias_extra, 1);
  assert.equal(c.danos_antes, 3);
  assert.equal(c.danos_despues, 4);
  assert.equal(c.danos_nuevos[0].incidente_estado, 'presupuestado');
  assert.equal(c.fotos.filter((f) => f.entrega && f.devolucion).length, 11);
  // finanzas no hace inspecciones
  assert.equal((await fin.post(`/api/patio/reservas/${rv.id}/iniciar`)).estado, 403);
});

test('las inspecciones son de la empresa: otra empresa no las ve', async () => {
  const rv = await reservaDe('devuelta', 'PBVX61');
  const [e2] = await db.q(`INSERT INTO empresas (nombre, slug) VALUES ('Otra', 'otra-rent') RETURNING id`);
  const { hashClave } = await import('../src/auth.js');
  await db.q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol) VALUES ($1,'Otro patio','patio@otra.cl',$2,'patio')`, [e2.id, hashClave('demo1234')]);
  const otro = await t.como('patio@otra.cl');
  assert.equal((await otro.get(`/api/patio/reservas/${rv.id}/comparacion`)).estado, 404);
  assert.equal((await otro.get('/api/patio/tareas')).datos.entregas.length, 0);
});
