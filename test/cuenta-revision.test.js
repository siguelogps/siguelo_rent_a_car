// Cuenta de revisión de las tiendas (9-nov): empresa de demostración aislada, en marcha blanca, con un usuario cuya clave
// se muestra una sola vez al superadmin, y una agenda que siempre tiene entregas y devoluciones para hoy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, sop, primera;
const hoyChile = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(d);

before(async () => {
  t = await levantar();
  sop = await t.como('soporte@siguelogps.cl');
  primera = await sop.post('/api/backoffice/cuenta-revision');
});
after(async () => { await t.cerrar(); });

test('crea una empresa propia, en marcha blanca y con los módulos que usa la app', async () => {
  assert.equal(primera.estado, 200, JSON.stringify(primera.datos));
  const r = primera.datos;
  assert.equal(r.creada, true);
  assert.equal(r.correo, 'revision-tiendas@demo.siguelogps.cl');
  assert.match(r.clave, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/, 'clave al azar de 16 caracteres');
  assert.equal(primera.headers.get('cache-control'), 'no-store');
  const e = await t.db.uno('SELECT * FROM empresas WHERE id = $1', [r.empresa.id]);
  assert.equal(e.nombre, 'Rentacar Demo Revisión');
  assert.equal(e.marcha_blanca, true);
  assert.equal(e.estado, 'activo');
  for (const m of ['reservas', 'patio', 'contratos', 'flota', 'incidentes']) assert.ok(e.modulos_extra.includes(m), m);
  const andes = await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`);
  assert.notEqual(e.id, andes.id);
  // Tiene sus propios datos de demostración (no toma los de Andes)
  const [{ n: veh }] = await t.db.q('SELECT count(*)::int AS n FROM vehiculos WHERE empresa_id = $1', [e.id]);
  assert.ok(veh >= 10);
  const [{ n: ajenos }] = await t.db.q(`SELECT count(*)::int AS n FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.empresa_id = $1 AND v.empresa_id <> $1`, [e.id]);
  assert.equal(ajenos, 0, 'ninguna reserva usa vehículos de otra empresa');
  // Nada sale: ni correo ni WhatsApp ni cobros ni inmovilización
  const { puedeActuar } = await import('../src/integraciones/index.js');
  for (const tipo of ['correo', 'whatsapp', 'gps']) assert.equal((await puedeActuar(e.id, tipo)).ok, false, tipo);
  // La clave no queda guardada en claro en ningún lado
  const bit = await t.db.q(`SELECT detalle::text AS d FROM bitacora WHERE empresa_id = $1 AND accion LIKE 'cuenta_revision%'`, [e.id]);
  assert.equal(bit.length, 1);
  assert.ok(!bit[0].d.includes(r.clave));
  const u = await t.db.uno('SELECT clave_hash FROM usuarios WHERE correo = $1', [r.correo]);
  assert.ok(u.clave_hash && !u.clave_hash.includes(r.clave));
  // Los demás usuarios de la demo no pueden ingresar (sin clave)
  const otros = await t.db.q('SELECT correo, clave_hash FROM usuarios WHERE empresa_id = $1 AND correo <> $2', [e.id, r.correo]);
  assert.ok(otros.length >= 4);
  assert.ok(otros.every((x) => x.clave_hash == null && x.correo.endsWith('@demo.siguelogps.cl')));
});

test('el usuario ingresa con la clave mostrada y ve solo su empresa, con entregas y devoluciones de hoy', async () => {
  const { correo, clave, empresa } = primera.datos;
  const rev = await t.como(correo, clave);
  const yo = await rev.get('/api/yo');
  assert.equal(yo.datos.empresa.id, empresa.id);
  const tareas = (await rev.get('/api/patio/tareas')).datos;
  const hoy = hoyChile();
  const pendientes = tareas.entregas.filter((x) => !x.vencida);
  assert.ok(pendientes.length >= 3, `entregas pendientes: ${pendientes.length}`);
  assert.equal(tareas.entregas.filter((x) => x.vencida).length, 0, 'ninguna entrega «atrasada»');
  const devHoy = tareas.devoluciones.filter((x) => hoyChile(new Date(x.fin)) === hoy && !x.atrasada);
  // Entre 23:30 y medianoche ya no cabe una devolución «de hoy» (la agenda muestra solo las que vencen hoy): se omite.
  const horaChile = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false }).format(new Date()));
  if (horaChile < 23) assert.ok(devHoy.length >= 2, `devoluciones de hoy: ${devHoy.length}`);
  // Aislada: no ve las reservas de Andes
  const folios = new Set((await t.db.q('SELECT folio FROM reservas WHERE empresa_id = $1', [empresa.id])).map((x) => x.folio));
  const lista = (await rev.get('/api/reservas?limite=1000')).datos;
  const filas = lista.reservas || lista.datos || lista;
  assert.ok(Array.isArray(filas) && filas.length > 0);
  assert.ok(filas.every((x) => folios.has(x.folio)));
});

test('reiniciar no duplica: misma empresa, clave nueva y la anterior deja de servir', async () => {
  const antes = (await t.db.uno('SELECT count(*)::int AS n FROM empresas')).n;
  const r2 = await sop.post('/api/backoffice/cuenta-revision');
  assert.equal(r2.estado, 200);
  assert.equal(r2.datos.creada, false);
  assert.equal(r2.datos.empresa.id, primera.datos.empresa.id);
  assert.notEqual(r2.datos.clave, primera.datos.clave);
  assert.equal((await t.db.uno('SELECT count(*)::int AS n FROM empresas')).n, antes);
  assert.equal((await t.db.uno('SELECT count(*)::int AS n FROM usuarios WHERE correo = $1', [r2.datos.correo])).n, 1);
  const vieja = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: r2.datos.correo, clave: primera.datos.clave }) });
  assert.notEqual(vieja.status, 200);
  const nueva = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: r2.datos.correo, clave: r2.datos.clave, nativa: true }) });
  assert.equal(nueva.status, 200);
  // Aunque alguien haya apagado la marcha blanca, reiniciar la vuelve a encender
  await t.db.q('UPDATE empresas SET marcha_blanca = false WHERE id = $1', [r2.datos.empresa.id]);
  const r3 = await sop.post('/api/backoffice/cuenta-revision');
  assert.equal((await t.db.uno('SELECT marcha_blanca FROM empresas WHERE id = $1', [r3.datos.empresa.id])).marcha_blanca, true);
  const st = await sop.get('/api/backoffice/cuenta-revision');
  assert.equal(st.datos.existe, true);
  assert.equal(st.datos.clave, undefined, 'el estado nunca devuelve una clave');
});

test('si el revisor eliminó su cuenta desde la app, reiniciar crea otra', async () => {
  const r = await sop.post('/api/backoffice/cuenta-revision');
  // Ingreso propio (t.como guarda la sesión por correo, y reiniciar cierra las sesiones anteriores)
  const ing = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: r.datos.correo, clave: r.datos.clave }) });
  const cookie = ing.headers.get('set-cookie').split(';')[0];
  const del = { estado: (await fetch(`${t.base}/api/configuracion/eliminar-mi-cuenta`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ clave: r.datos.clave }) })).status };
  assert.equal(del.estado, 200, 'el revisor puede probar «Eliminar mi cuenta» (hay otro administrador)');
  const r2 = await sop.post('/api/backoffice/cuenta-revision');
  assert.equal(r2.datos.creada, false);
  const ok = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: r2.datos.correo, clave: r2.datos.clave }) });
  assert.equal(ok.status, 200);
});

test('solo un superadmin la crea o la ve', async () => {
  const admin = await t.como('demo@siguelogps.cl');
  assert.equal((await admin.post('/api/backoffice/cuenta-revision')).estado, 403);
  const { hashClave } = await import('../src/auth.js');
  await t.db.q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol) VALUES (NULL, 'Soporte nivel 1', 'soporte1@demo.siguelogps.cl', $1, 'soporte')`, [hashClave('demo1234')]);
  const soporte = await t.como('soporte1@demo.siguelogps.cl');
  assert.equal((await soporte.post('/api/backoffice/cuenta-revision')).estado, 403);
  assert.equal((await soporte.get('/api/backoffice/cuenta-revision')).estado, 403);
});

test('la agenda se renueva sola: al día siguiente las reservas pendientes siguen alrededor de hoy', async () => {
  const { renovarAgenda, MIN_ENTREGAS, MIN_DEVOLUCIONES } = await import('../src/siguelo/cuenta-revision.js');
  const E = primera.datos.empresa.id;
  // El revisor hizo todas las entregas y devoluciones de hoy
  await t.db.q(`UPDATE reservas SET estado = 'en_curso', retiro_real = now() WHERE empresa_id = $1 AND estado = 'confirmada' AND inicio < now() + interval '2 days'`, [E]);
  await t.db.q(`UPDATE reservas SET estado = 'devuelta', devolucion_real = now() WHERE empresa_id = $1 AND estado = 'en_curso' AND fin < now() + interval '1 day'`, [E]);
  // Al otro día (en hora de oficina, a las 11:00 de Chile)
  const { desdeLocal } = await import('../src/util/formato.js');
  const manana = new Date(Date.parse(`${hoyChile()}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const ahora = desdeLocal(manana, '11:00');
  const res = await renovarAgenda(E, ahora);
  assert.equal(res.dias_corridos, 1);
  const ent = await t.db.q(`SELECT inicio FROM reservas WHERE empresa_id = $1 AND estado = 'confirmada' AND inicio >= $2 AND (inicio AT TIME ZONE 'America/Santiago')::date <= $3::date + 1`, [E, ahora, manana]);
  assert.ok(ent.length >= MIN_ENTREGAS, `entregas: ${ent.length}`);
  const venc = await t.db.q(`SELECT id FROM reservas WHERE empresa_id = $1 AND estado = 'confirmada' AND inicio < $2`, [E, ahora]);
  assert.equal(venc.length, 0, 'ninguna entrega queda atrasada');
  const dev = await t.db.q(`SELECT id FROM reservas WHERE empresa_id = $1 AND estado = 'en_curso' AND fin > $2 AND (fin AT TIME ZONE 'America/Santiago')::date = $3::date`, [E, ahora, manana]);
  assert.ok(dev.length >= MIN_DEVOLUCIONES, `devoluciones: ${dev.length}`);
  // Sin dobles reservas
  const choques = await t.db.q(`SELECT a.id FROM reservas a JOIN reservas b ON a.vehiculo_id = b.vehiculo_id AND a.id < b.id AND a.empresa_id = b.empresa_id
     WHERE a.empresa_id = $1 AND a.estado IN ('confirmada','en_curso') AND b.estado IN ('confirmada','en_curso') AND a.inicio < b.fin AND b.inicio < a.fin`, [E]);
  assert.equal(choques.length, 0, 'sin dobles reservas');
  // Otra vez el mismo día: no agrega nada
  const otra = await renovarAgenda(E, ahora);
  assert.equal(otra.entregas_nuevas + otra.devoluciones_nuevas + otra.dias_corridos, 0);
  // Andes no se tocó
  const andes = await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`);
  assert.equal((await t.db.uno(`SELECT count(*)::int AS n FROM bitacora WHERE empresa_id = $1 AND accion LIKE 'cuenta_revision%'`, [andes.id])).n, 0);
});
