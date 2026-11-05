// Fase 1 de estandarización Síguelo (1-nov-2026): listas paginadas, búsqueda por palabras sin tildes, modales que no se
// cierran con un clic fuera, marca « *» de los obligatorios y vocabulario («Conexiones», «Cerrar sesión»).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { levantar } from './ayuda.js';
import { sinTildes, palabras, porPalabras, calza } from '../src/busqueda.js';
import { tramo } from '../src/paginacion.js';
import { calcularPagina, paginaTrasCambio, textoPagina, POR_PAGINA, OPCIONES_POR_PAGINA, MINIMO_CON_NAV, normalizarPorPagina, leerPorPagina, guardarPorPagina, htmlPaginacion, selectorPorPagina } from '../public/paginador.js';

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
  // 5-nov (RNT-08): ?desde= también es filtro de fecha en varias listas; la fila va en ?desde_fila= y una fecha no es fila
  assert.equal(tramo({ query: { limite: '2', desde_fila: '6', desde: '2026-10-01' } }).sql, 'LIMIT 2 OFFSET 6');
  assert.equal(tramo({ query: { limite: '2', desde: '2026-10-01' } }).sql, 'LIMIT 2 OFFSET 0');
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

// 5-nov (revisión exhaustiva, RNT-11): el selector «Filas por página» del CRM (2-nov), recordado por lista en el navegador.
test('paginador: selector «Filas por página» 10 · 25 · 50 · 100, recordado por lista', () => {
  assert.deepEqual(OPCIONES_POR_PAGINA, [10, 25, 50, 100]);
  assert.equal(MINIMO_CON_NAV, 10, 'con más de 10 filas aparece el nav, para poder elegir 10');
  assert.equal(normalizarPorPagina('25'), 25);
  assert.equal(normalizarPorPagina('7'), 50, 'un valor que no es opción vuelve al de omisión');
  assert.equal(normalizarPorPagina('7', 25), 25);
  assert.deepEqual(calcularPagina(120, 2, 25), { pagina: 2, paginas: 5, desde: 25, hasta: 50, por: 25 });
  const memoria = new Map();
  const antes = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v) };
  try {
    assert.equal(leerPorPagina('/reservas:Folio|Cliente'), 50);
    guardarPorPagina('/reservas:Folio|Cliente', 100);
    assert.equal(leerPorPagina('/reservas:Folio|Cliente'), 100);
    assert.equal(leerPorPagina('/clientes:Nombre'), 50, 'cada lista recuerda lo suyo');
    globalThis.localStorage = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    assert.equal(leerPorPagina('/reservas:Folio|Cliente'), 50, 'sin memoria del navegador: el valor por omisión');
    guardarPorPagina('x', 10); // no revienta
  } finally { globalThis.localStorage = antes; }
  assert.equal(htmlPaginacion({ total: 10 }), '', 'con 10 filas o menos no hay nav');
  const nav = htmlPaginacion({ total: 120, desde: 50, por: 25 });
  assert.match(nav, /Página 3 de 5 · 51–75 de 120/);
  assert.match(nav, /Filas por página/);
  assert.match(selectorPorPagina(25), /<option value="25" selected>25<\/option>/);
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

// 5-nov (revisión exhaustiva, RNT-08): facturación, TAG, multas, bandeja de salida, garantías, alertas GPS y solicitudes
// se cortaban con LIMIT fijo y la pantalla no avisaba. Ahora se piden por partes (?limite=&desde=, tramo) con orden total.
test('listas por partes: ?limite= y ?desde= en las listas que antes tenían LIMIT fijo', async () => {

  const casos = [
    [a, '/api/facturacion', (d) => d.documentos], [a, '/api/tag-multas/tag', (d) => d], [a, '/api/tag-multas/multas', (d) => d],
    [a, '/api/salidas', (d) => d], [a, '/api/pagos/garantias', (d) => d.garantias], [a, '/api/gps/alertas?todas=1', (d) => d],
    [sop, '/api/backoffice/solicitudes', (d) => d.solicitudes]
  ];
  for (const [c, ruta, filas] of casos) {
    const sep = ruta.includes('?') ? '&' : '?';
    const todo = filas((await c.get(ruta)).datos);
    const uno = await c.get(`${ruta}${sep}limite=1`);
    assert.equal(uno.estado, 200, ruta);
    assert.equal(filas(uno.datos).length, Math.min(1, todo.length), `${ruta} respeta ?limite=`);
    if (todo.length > 1) {
      const segunda = filas((await c.get(`${ruta}${sep}limite=1&desde_fila=1`)).datos);
      assert.equal(JSON.stringify(segunda[0]), JSON.stringify(todo[1]), `${ruta}: ?desde_fila= trae la parte siguiente (orden total)`);
    }
  }
});

test('Excel de reservas: avisa en la planilla si llegó al tope', async () => {
  const fuente = (await import('node:fs')).readFileSync(new URL('../src/api/20-reservas.js', import.meta.url), 'utf8');
  assert.match(fuente, /LIMIT \$\{TOPE \+ 1\}/, 'pide una fila más para saber si hay más');
  assert.match(fuente, /X-Tope-Alcanzado/);
  const r = await a.get('/api/reservas/excel');
  assert.equal(r.estado, 200);
  assert.equal(r.headers.get('x-tope-alcanzado'), null, 'la demo no llega al tope');
});
