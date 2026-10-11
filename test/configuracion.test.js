import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t, admin;
// Ingreso sin caché de sesión (para probar claves nuevas y sesiones cerradas)
async function ingresar(correo, clave) {
  const r = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, clave }) });
  if (!r.ok) return { estado: r.status };
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const llamar = async (method, ruta, body) => {
    const x = await fetch(t.base + ruta, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { estado: x.status, datos: (x.headers.get('content-type') || '').includes('json') ? await x.json() : null };
  };
  return { estado: 200, get: (u) => llamar('GET', u), post: (u, b = {}) => llamar('POST', u, b), patch: (u, b = {}) => llamar('PATCH', u, b), put: (u, b = {}) => llamar('PUT', u, b) };
}

before(async () => { t = await levantar(); admin = await t.como('demo@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

test('crear usuario con clave temporal y permisos según su rol', async () => {
  const yo = await admin.get('/api/yo');
  const r = await admin.post('/api/configuracion/usuarios', { nombre: 'Ana Counter', correo: 'ana@andesrent.cl', rol: 'counter', sucursal_id: yo.datos.sucursales[0].id });
  assert.equal(r.estado, 200, JSON.stringify(r.datos));
  assert.ok(r.datos.clave_temporal.length >= 10);
  assert.equal(r.datos.usuario.clave_hash, undefined);
  const lista = await admin.get('/api/configuracion/usuarios');
  assert.ok(lista.datos.some((u) => u.correo === 'ana@andesrent.cl'));
  assert.ok(lista.datos.every((u) => !('clave_hash' in u)));
  assert.equal((await admin.post('/api/configuracion/usuarios', { nombre: 'Otra', correo: 'ana@andesrent.cl', rol: 'counter' })).estado, 400);
  assert.equal((await admin.post('/api/configuracion/usuarios', { nombre: 'Jefa', correo: 'x@andesrent.cl', rol: 'superadmin' })).estado, 400);

  const ana = await ingresar('ana@andesrent.cl', r.datos.clave_temporal);
  assert.equal(ana.estado, 200);
  assert.equal((await ana.get('/api/configuracion/usuarios')).estado, 403);
  assert.equal((await ana.post('/api/configuracion/usuarios', { nombre: 'X', correo: 'y@x.cl', rol: 'counter' })).estado, 403);
  assert.equal((await ana.get('/api/reportes')).estado, 403);
  assert.equal((await ana.get('/api/configuracion/bitacora')).estado, 403);
  assert.equal((await ana.post('/api/integraciones/correo/activar', { activa: true })).estado, 403);

  // Cambio de rol: se cierran sus sesiones y al volver a ingresar tiene los permisos nuevos
  const id = r.datos.usuario.id;
  assert.equal((await admin.patch(`/api/configuracion/usuarios/${id}`, { rol: 'finanzas' })).estado, 200);
  assert.equal((await ana.get('/api/yo')).estado, 401);
  const ana2 = await ingresar('ana@andesrent.cl', r.datos.clave_temporal);
  assert.equal((await ana2.get('/api/reportes')).estado, 200);
  // Desactivar: ya no puede ingresar
  assert.equal((await admin.patch(`/api/configuracion/usuarios/${id}`, { activo: false })).estado, 200);
  assert.equal((await ingresar('ana@andesrent.cl', r.datos.clave_temporal)).estado, 401);
  // Restablecer clave (solo administrador)
  const rc = await admin.post(`/api/configuracion/usuarios/${id}/clave`);
  assert.equal(rc.estado, 200);
  assert.notEqual(rc.datos.clave_temporal, r.datos.clave_temporal);
  const counter = await t.como('counter@siguelogps.cl');
  assert.equal((await counter.post(`/api/configuracion/usuarios/${id}/clave`)).estado, 403);
});

test('un administrador no se puede quitar el rol ni desactivarse', async () => {
  const yo = (await admin.get('/api/yo')).datos.usuario;
  assert.equal((await admin.patch(`/api/configuracion/usuarios/${yo.id}`, { rol: 'counter' })).estado, 400);
  assert.equal((await admin.patch(`/api/configuracion/usuarios/${yo.id}`, { activo: false })).estado, 400);
});

test('usuarios de otra empresa no se pueden tocar', async () => {
  const { crearEmpresa } = await import('../src/api/01-empresas.js');
  await crearEmpresa({ nombre: 'Otra Rent', admin_correo: 'admin@otra.cl', admin_clave: 'clave1234' });
  const otro = await ingresar('admin@otra.cl', 'clave1234');
  const [u] = await t.db.q(`SELECT id FROM usuarios WHERE correo = 'counter@siguelogps.cl'`);
  assert.equal((await otro.patch(`/api/configuracion/usuarios/${u.id}`, { activo: false })).estado, 404);
  assert.equal((await otro.post(`/api/configuracion/usuarios/${u.id}/clave`)).estado, 404);
  assert.ok(!(await otro.get('/api/configuracion/usuarios')).datos.some((x) => x.id === u.id));
});

test('solo administradores activan integraciones; los demás ni las ven o solo las prueban', async () => {
  for (const c of ['counter@siguelogps.cl', 'finanzas@siguelogps.cl', 'patio@siguelogps.cl']) {
    const s = await t.como(c);
    assert.equal((await s.post('/api/integraciones/webpay/activar', { activa: true })).estado, 403, c);
    assert.equal((await s.put('/api/integraciones/webpay', { api_key: 'x' })).estado, 403, c);
  }
  const r = await admin.post('/api/integraciones/webpay/activar', { activa: true });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.activa, true);
  await admin.post('/api/integraciones/webpay/activar', { activa: false });
});

test('matriz de permisos de solo lectura', async () => {
  const r = await (await t.como('counter@siguelogps.cl')).get('/api/configuracion/permisos');
  assert.equal(r.estado, 200);
  assert.equal(r.datos.matriz.administrador.usuarios, 'editar');
  assert.equal(r.datos.matriz.counter.reservas, 'editar');
  assert.equal(r.datos.matriz.patio.reportes, null);
  assert.equal(r.datos.roles.superadmin, undefined);
});

test('cambiar la clave propia', async () => {
  const p = await ingresar('patio@siguelogps.cl', 'demo1234');
  assert.equal((await p.post('/api/configuracion/mi-clave', { actual: 'mala', nueva: 'nuevaclave1' })).estado, 400);
  assert.equal((await p.post('/api/configuracion/mi-clave', { actual: 'demo1234', nueva: 'corta' })).estado, 400);
  assert.equal((await p.post('/api/configuracion/mi-clave', { actual: 'demo1234', nueva: 'nuevaclave1' })).estado, 200);
  assert.equal((await p.get('/api/yo')).estado, 200); // la sesión actual sigue
  assert.equal((await ingresar('patio@siguelogps.cl', 'demo1234')).estado, 401);
  assert.equal((await ingresar('patio@siguelogps.cl', 'nuevaclave1')).estado, 200);
});

test('sucursales: crear, editar y no dejar la empresa sin sucursales activas', async () => {
  const n = await admin.post('/api/configuracion/sucursales', { nombre: 'Temuco', direccion: 'Av. Alemania 0450', comuna: 'Temuco', ciudad: 'Temuco', lat: '-38.7359', lng: '-72.6127' });
  assert.equal(n.estado, 200);
  assert.equal(n.datos.lat, -38.7359);
  const e = await admin.patch(`/api/configuracion/sucursales/${n.datos.id}`, { horario: 'Lun a vie 09:00 a 18:00', activa: false });
  assert.equal(e.datos.activa, false);
  assert.equal((await admin.post('/api/configuracion/sucursales', { nombre: '' })).estado, 400);
  assert.equal((await admin.post('/api/configuracion/sucursales', { nombre: 'X', lat: 'abc' })).estado, 400);
  assert.equal((await (await t.como('counter@siguelogps.cl')).post('/api/configuracion/sucursales', { nombre: 'X' })).estado, 403);
});

test('plantillas: editar, vista previa con datos de ejemplo y restaurar la versión por defecto', async () => {
  const { datos } = await admin.get('/api/configuracion/plantillas');
  assert.ok(datos.variables.includes('cliente.nombre'));
  const p = datos.plantillas.find((x) => x.tipo === 'correo' && x.clave === 'reserva_confirmada');
  const ed = await admin.put(`/api/configuracion/plantillas/${p.id}`, { nombre: p.nombre, asunto: 'Hola {{cliente.nombre}}', cuerpo: 'Reserva {{reserva.folio}} en {{empresa.nombre}}', activa: true });
  assert.equal(ed.estado, 200);
  const v = await admin.post('/api/configuracion/plantillas/vista-previa', { asunto: ed.datos.asunto, cuerpo: ed.datos.cuerpo });
  assert.equal(v.datos.asunto, 'Hola Valentina');
  assert.equal(v.datos.cuerpo, 'Reserva R-1008 en Andes Rent a Car');
  const rs = await admin.post(`/api/configuracion/plantillas/${p.id}/restaurar`);
  assert.match(rs.datos.cuerpo, /está confirmada/);
  assert.equal((await (await t.como('counter@siguelogps.cl')).put(`/api/configuracion/plantillas/${p.id}`, { cuerpo: 'x' })).estado, 403);
});

test('bitácora paginada con filtros y detalle de la bandeja de salida', async () => {
  const r = await admin.get('/api/configuracion/bitacora?accion=usuario_creado');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.total >= 1);
  assert.ok(r.datos.filas.every((f) => f.accion === 'usuario_creado'));
  assert.ok(r.datos.opciones.acciones.includes('ingreso'));
  const pag = await admin.get('/api/configuracion/bitacora?por_pagina=10&pagina=1');
  assert.ok(pag.datos.filas.length <= 10);
  const { encolar } = await import('../src/salidas.js');
  const [{ id: E }] = await t.db.q(`SELECT id FROM empresas WHERE slug = 'andes-rent'`);
  const s = await encolar({ empresaId: E, canal: 'correo', destino: 'a@b.cl', asunto: 'Prueba', cuerpo: 'x'.repeat(500) });
  assert.equal(s.estado, 'retenida');
  const d = await admin.get(`/api/configuracion/salidas/${s.id}`);
  assert.equal(d.datos.cuerpo.length, 500);
});

test('superadmin: suspender empresa y cambiar plan', async () => {
  const sop = await t.como('soporte@siguelogps.cl');
  const lista = await sop.get('/api/empresas');
  const otra = lista.datos.find((e) => e.nombre === 'Otra Rent');
  assert.equal((await sop.patch(`/api/configuracion/empresas/${otra.id}`, { activa: false, plan: 'basico' })).datos.plan, 'basico');
  assert.equal((await fetch(`${t.base}/api/portal/empresa/${otra.slug}`)).status, 404);
  assert.equal((await admin.patch(`/api/configuracion/empresas/${otra.id}`, { activa: true })).estado, 403);
});
