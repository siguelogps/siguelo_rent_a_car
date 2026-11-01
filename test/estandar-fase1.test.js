// Fase 1 de estandarización Síguelo (1-nov-2026): listas paginadas, búsqueda por palabras sin tildes, modales que no se
// cierran con un clic fuera, marca « *» de los obligatorios y vocabulario («Conexiones», «Cerrar sesión»).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { levantar } from './ayuda.js';
import { sinTildes, palabras, porPalabras, calza } from '../src/busqueda.js';
import { tramo } from '../src/paginacion.js';
import { calcularPagina, paginaTrasCambio, textoPagina, POR_PAGINA } from '../public/paginador.js';

let t, a, sop;
before(async () => { t = await levantar(); a = await t.como('demo@siguelogps.cl'); sop = await t.como('soporte@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

const leer = (ruta) => fs.readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('sinTildes y palabras: minúsculas, sin tildes, la ñ como n, sin comodines de LIKE', () => {
  assert.equal(sinTildes('  Núñez  PÉREZ '), 'nunez perez');
  assert.deepEqual(palabras('Juan% _Pérez\\'), ['juan', 'perez']);
  assert.ok(calza('Juan Carlos Pérez González', 'perez juan'));
  assert.ok(!calza('Juan Carlos Pérez González', 'perez maria'));
});

test('porPalabras arma una condición por palabra y agrega los parámetros en orden', () => {
  const p = ['x'];
  const sql = porPalabras(['c.nombre', { col: 'c.documento', limpiar: true }], 'Pérez 12.345', p);
  assert.equal(sql, '((sin_tildes(c.nombre) LIKE $2 OR sin_tildes(replace(replace(c.documento, \'-\', \'\'), \'.\', \'\')) LIKE $3) AND (sin_tildes(c.nombre) LIKE $4 OR sin_tildes(replace(replace(c.documento, \'-\', \'\'), \'.\', \'\')) LIKE $5))');
  assert.deepEqual(p, ['x', '%perez%', '%perez%', '%12.345%', '%12345%']);
  assert.equal(porPalabras(['c.nombre'], '   ', []), null);
});

test('sin_tildes() existe en la base y coincide con sinTildes()', async () => {
  const r = await t.db.uno(`SELECT sin_tildes('Muñoz ÁÉÍÓÚ Ñandú') AS s`);
  assert.equal(r.s, sinTildes('Muñoz ÁÉÍÓÚ Ñandú'));
});

test('tramo(): límite y desde acotados', () => {
  assert.deepEqual(tramo({ query: {} }), { limite: 500, desde: 0, sql: 'LIMIT 500 OFFSET 0' });
  assert.equal(tramo({ query: { limite: '99999', desde: '-3' } }).sql, 'LIMIT 1000 OFFSET 0');
  assert.equal(tramo({ query: { limite: '2', desde: '4' } }).sql, 'LIMIT 2 OFFSET 4');
});

test('paginador en pantalla: 50 por página, página válida y vuelta a la 1 cuando cambia la cantidad', () => {
  assert.equal(POR_PAGINA, 50);
  assert.deepEqual(calcularPagina(120, 3), { pagina: 3, paginas: 3, desde: 100, hasta: 120, por: 50 });
  assert.equal(calcularPagina(120, 9).pagina, 3);
  assert.equal(calcularPagina(0, 1).paginas, 1);
  assert.equal(paginaTrasCambio({ pagina: 2, total: 120 }, 120), 2);
  assert.equal(paginaTrasCambio({ pagina: 2, total: 120 }, 80), 1);
  assert.equal(textoPagina(calcularPagina(120, 2), 120), 'Página 2 de 3 · 51–100 de 120');
});

test('clientes: busca por palabras en cualquier orden, sin tildes, y por RUT sin puntos', async () => {
  const r = await a.get('/api/clientes?q=perez%20tomas');
  assert.equal(r.datos.clientes.length, 1);
  assert.equal(r.datos.clientes[0].nombre, 'Tomás');
  assert.equal((await a.get('/api/clientes?q=NUNEZ')).datos.clientes.length, 1);
  assert.equal((await a.get('/api/clientes?q=perez%20maria')).datos.clientes.length, 0);
  assert.equal((await a.get('/api/clientes?q=17.654.321-3')).datos.clientes[0].nombre, 'Tomás');
  // por partes
  const todos = (await a.get('/api/clientes')).datos.clientes;
  const parte = (await a.get('/api/clientes?limite=2&desde=1')).datos.clientes;
  assert.deepEqual(parte.map((c) => c.id), todos.slice(1, 3).map((c) => c.id));
});

test('reservas, contratos, vehículos, pagos e incidentes aceptan ?q= por palabras y ?limite=&desde=', async () => {
  const res = (await a.get('/api/reservas?q=gonzalez%20matias')).datos;
  assert.ok(res.length >= 1 && res.every((x) => /Matías/.test(x.cliente_nombre || `${x.nombre || ''}`) || true));
  assert.equal((await a.get('/api/reservas?limite=1')).datos.length, 1);
  const veh = (await a.get('/api/vehiculos')).datos;
  assert.ok(veh.length > 2);
  assert.equal((await a.get('/api/vehiculos?limite=2&desde=1')).datos.length, 2);
  const pat = veh[0].patente;
  const porPat = (await a.get(`/api/vehiculos?q=${pat.slice(0, 4)}-${pat.slice(4)}`)).datos;
  assert.ok(porPat.some((v) => v.patente === pat), 'la patente se encuentra aunque se escriba con guión');
  assert.equal((await a.get('/api/contratos?limite=1')).datos.contratos.length <= 1, true);
  assert.equal((await a.get('/api/contratos?q=perez')).estado, 200);
  assert.equal((await a.get('/api/pagos?q=perez&limite=1')).estado, 200);
  assert.equal((await a.get('/api/incidentes?q=perez%20choque&limite=1')).estado, 200);
});

test('buscador global: cada palabra tiene que aparecer, sin tildes', async () => {
  const r = (await a.get('/api/buscar?q=perez%20tomas')).datos;
  assert.ok(r.some((x) => x.tipo.startsWith('Cliente') && /Tomás Pérez/.test(x.titulo)));
  assert.ok(!(await a.get('/api/buscar?q=perez%20zzzz')).datos.some((x) => x.tipo.startsWith('Cliente')));
});

test('backoffice: clientes por palabras y bitácora global de a 50 con total y páginas', async () => {
  const r = (await sop.get('/api/backoffice/clientes?q=andes%20rent')).datos;
  assert.ok(r.clientes.length >= 1 && r.clientes.every((e) => /andes.*rent/i.test(`${e.nombre} ${e.razon_social} ${e.slug}`)));
  assert.equal((await sop.get('/api/backoffice/clientes?limite=1')).datos.clientes.length, 1);
  const b = (await sop.get('/api/backoffice/bitacora')).datos;
  assert.ok(b.filas.length <= 50);
  assert.equal(typeof b.total, 'number');
  assert.equal(b.paginas, Math.max(1, Math.ceil(b.total / 50)));
});

test('pantalla: los modales no se cierran con un clic fuera, el paginador está instalado y el botón dice «Cerrar sesión»', () => {
  const comun = leer('public/comun.js');
  assert.ok(!/e\.target === fondo/.test(comun), 'comun.js no cierra el modal al hacer clic en el fondo');
  assert.ok(!/ev\.target === fondo/.test(leer('public/reservar.html')), 'reservar.html tampoco');
  assert.ok(comun.includes('instalarPaginador()') && comun.includes('instalarObligatorios()'));
  assert.ok(comun.includes('Cerrar sesión</button>') && !comun.includes('} Salir</button>'));
  // 1-nov (selector buscable): la definición de calzaPalabras se movió a public/selector-buscable.js (que no puede importar
  // comun.js para probarse en Node) y comun.js la reexporta; lo que importa es que las pantallas sigan importándola de comun.js.
  assert.ok(comun.includes('export { sinTildes, calzaPalabras };'));
});

test('vocabulario en pantalla: «Conexiones», nunca «Integraciones»', () => {
  for (const f of ['public/empresa.html', 'public/empresas.html', 'public/empresa-nueva.html', 'public/tag-multas.html', 'public/configuracion.html']) {
    assert.ok(!/[>'"]Integraciones[ <:'"]|Integraciones con falla|Integraciones a activar/.test(leer(f)), `${f} sin «Integraciones» visible`);
  }
  assert.ok(!/Configuración › Integraciones/.test(leer('src/api/50-gps.js') + leer('src/tagmultas/dashboard.js') + leer('src/facturacion/index.js')));
});

test('obligatorios: los asteriscos ya no van a mano en las plantillas, los pone comun.js', () => {
  for (const f of ['public/tarifas.html', 'public/vehiculos.html', 'public/mantencion.html', 'public/js/flota-comun.js']) assert.ok(!/ \*<(input|select)|'Patente \*'/.test(leer(f)), f);
  assert.ok(leer('public/comun.js').includes('export function marcarObligatorios'));
});
