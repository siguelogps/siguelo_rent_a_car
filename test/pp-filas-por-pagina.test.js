// «Filas por página» 10 · 25 · 50 · 100 (pedido de Pablo del 2-nov, igual que en el CRM Síguelo Gestión, PR #106).
// El selector llegó a On Rent el 5-nov (RNT-11); estas pruebas lo dejan amarrado como en el CRM (test/pp-filas-por-pagina):
//   · funciones puras de public/paginador.js: tramo con el tamaño elegido, valores válidos, clave de cada lista, el selector
//     y los dos navs (con total y por cursor);
//   · que ninguna pantalla arme una paginación a mano sin el nav común (y, por lo tanto, sin el selector);
//   · por la API: las bitácoras que paginan en el servidor respetan ?por= y las listas por partes aceptan ?limite= hasta
//     1000 (más que las 100 filas de la opción más grande).
// Las pruebas de memoria del navegador (leerPorPagina / guardarPorPagina con try/catch) están en estandar-fase1.test.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { levantar } from './ayuda.js';
import {
  POR_PAGINA, OPCIONES_POR_PAGINA, MINIMO_CON_NAV, calcularPagina, calcularTramo, normalizarPorPagina,
  selectorPorPagina, htmlPaginacion, htmlPaginacionCursor, claveDeLista,
} from '../public/paginador.js';
import { OPCIONES_POR_PAGINA as OPCIONES_SERVIDOR, porPagina, tramo } from '../src/paginacion.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('opciones 10 · 25 · 50 · 100, 50 por omisión, el nav desde 11 filas, y el servidor con las mismas opciones', () => {
  assert.deepEqual(OPCIONES_POR_PAGINA, [10, 25, 50, 100]);
  assert.deepEqual(OPCIONES_SERVIDOR, OPCIONES_POR_PAGINA, 'pantalla y servidor ofrecen lo mismo');
  assert.equal(POR_PAGINA, 50);
  assert.equal(MINIMO_CON_NAV, 10);
});

test('calcularPagina y calcularTramo reciben el tamaño elegido', () => {
  assert.deepEqual(calcularPagina(120, 1, 100), { pagina: 1, paginas: 2, desde: 0, hasta: 100, por: 100 });
  assert.equal(calcularPagina(120, 99, 10).pagina, 12, 'no pasa de la última');
  assert.equal(calcularPagina(5, 1, 0).por, 50, 'un tamaño inválido cae en 50');
  // Lista del servidor (las bitácoras): sabe dónde parte, no su página.
  assert.deepEqual(calcularTramo(4764, 100, 50), { pagina: 3, paginas: 96, desde: 100, hasta: 150, por: 50 });
  assert.deepEqual(calcularTramo(30, 20, 10), { pagina: 3, paginas: 3, desde: 20, hasta: 30, por: 10 });
});

test('normalizarPorPagina: solo las opciones; si no, el de la lista (data-por-pagina) o 50', () => {
  assert.equal(normalizarPorPagina(100), 100);
  assert.equal(normalizarPorPagina('abc', 25), 25);
  assert.equal(normalizarPorPagina(1000, 30), 50, 'un valor por omisión que no es opción cae en 50');
});

test('selectorPorPagina: 4 opciones, la elegida marcada y sin selector buscable', () => {
  const s = selectorPorPagina(25);
  assert.match(s, /Filas por página/);
  assert.match(s, /<select [^>]*data-pg-por[^>]*data-sin-buscar/);
  assert.equal((s.match(/<option /g) || []).length, 4);
  assert.doesNotMatch(s, /value="50" selected/);
});

test('htmlPaginacion y htmlPaginacionCursor: «Anterior · Página X de Y · … · Siguiente» con el selector', () => {
  const h = htmlPaginacion({ total: 4764, desde: 50, por: 50, lista: 'cf-bitacora', unidad: 'registros' });
  assert.match(h, /^<nav class="paginacion pg-nav" aria-label="Páginas de la lista" data-pg-lista="cf-bitacora">/);
  assert.match(h, /data-pg-mover="-1">Anterior<\/button>/, 'en la página 2, «Anterior» está activo');
  assert.match(h, /Página 2 de 96 · 51–100 de 4\.764 registros/);
  assert.match(h, /data-pg-por/);
  const una = htmlPaginacion({ total: 12, desde: 0, por: 25 });
  assert.match(una, /data-pg-mover="-1" disabled>Anterior/);
  assert.match(una, /data-pg-mover="1" disabled>Siguiente/);
  assert.match(una, /Página 1 de 1 · 1–12 de 12/, 'con 11 filas o más aparece, aunque quepa en una página, para poder elegir 10');
  const c = htmlPaginacionCursor({ pagina: 2, hayMas: false, texto: '40 cambios', por: 50, lista: 'x', antes: 'Más recientes', despues: 'Anteriores' });
  assert.match(c, /Más recientes<\/button><span>Página 2 · 40 cambios<\/span><button[^>]* disabled>Anteriores/);
  assert.match(c, /data-pg-por/);
});

test('claveDeLista: la página más data-pg-clave, el id o los encabezados (cada lista recuerda lo suyo)', () => {
  assert.equal(claveDeLista({ ruta: '/reservas', encabezados: ['Folio ', 'Cliente', ''] }), '/reservas:Folio|Cliente');
  assert.equal(claveDeLista({ ruta: '/x', id: 'grid', encabezados: ['A'] }), '/x:grid');
  assert.equal(claveDeLista({ ruta: '/x', pgClave: 'propia', id: 'grid' }), '/x:propia');
  assert.equal(claveDeLista({ ruta: '/x' }), '/x:lista');
});

// Todos los archivos de pantalla (también la app de patio en public/js).
function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return ['fuentes', 'img'].includes(e.name) ? [] : archivos(p);
    return /\.(js|html)$/.test(e.name) ? [p] : [];
  });
}

test('toda paginación usa el nav común con «Filas por página» (ninguna escrita a mano)', () => {
  // Botones «Anterior» / «Siguiente» que no son de una lista: los pasos del asistente de inspección del patio. Van en esta
  // lista a propósito; cualquier otro es una paginación propia sin el selector.
  const otros = new Set(['public/js/patio-asistente.js']);
  const fallas = [];
  for (const f of archivos(path.join(RAIZ, 'public'))) {
    const rel = path.relative(RAIZ, f).split(path.sep).join('/');
    if (rel === 'public/paginador.js') continue;
    const t = fs.readFileSync(f, 'utf8');
    if (/<nav class="[^"]*\b(paginacion|pg-nav)\b/.test(t)) fallas.push(`${rel}: <nav class="paginacion"> escrito a mano (usa htmlPaginacion() de paginador.js)`);
    if (/htmlPaginacion(Cursor)?\(/.test(t) && !/enlazarPaginacion\(/.test(t)) fallas.push(`${rel}: arma el nav pero no lo enlaza (enlazarPaginacion)`);
    if (!otros.has(rel) && />Anterior<\/button>/.test(t)) fallas.push(`${rel}: botón «Anterior» propio (paginación sin el nav común)`);
  }
  assert.deepEqual(fallas, []);
  // Las listas que pagina el servidor por página (las bitácoras) piden con el tamaño elegido, recordado en el navegador.
  for (const [f, clave] of [['configuracion.html', 'configuracion:bitacora'], ['empresa.html', 'empresa:bitacora'], ['bitacora-global.html', 'bitacora-global']]) {
    const t = fs.readFileSync(path.join(RAIZ, 'public', f), 'utf8');
    assert.match(t, /leerPorPagina\(/, `${f}: parte en el tamaño recordado`);
    assert.ok(t.includes(`'${clave}'`), `${f}: lista ${clave}`);
  }
});

test('servidor: porPagina() solo acepta las opciones y tramo() deja pedir hasta 1000 filas', () => {
  assert.equal(porPagina({ query: { por: '10' } }), 10);
  assert.equal(porPagina({ query: { por: '100' } }), 100);
  assert.equal(porPagina({ query: { por: '37' } }), 50);
  assert.equal(porPagina({ query: {} }, 25), 25);
  assert.equal(tramo({ query: { limite: '100' } }).limite, 100);
  assert.equal(tramo({ query: { limite: '5000' } }).limite, 1000);
});

// ── Por la API: el tamaño que pide la pantalla ──
let t, demo, sop;
before(async () => { t = await levantar(); demo = await t.como('demo@siguelogps.cl'); sop = await t.como('soporte@siguelogps.cl'); });
after(async () => { await t?.cerrar(); });

test('API: las tres bitácoras respetan ?por= (10 · 100) y sin pedir nada van de a 50', async () => {
  const cf = (await demo.get('/api/configuracion/bitacora?por=10')).datos;
  assert.equal(cf.por_pagina, 10);
  assert.equal(cf.filas.length, Math.min(10, cf.total));
  assert.equal(cf.paginas, Math.max(1, Math.ceil(cf.total / 10)));
  assert.equal((await demo.get('/api/configuracion/bitacora')).datos.por_pagina, 50);
  assert.equal((await demo.get('/api/configuracion/bitacora?por=100')).datos.por_pagina, 100);

  const glob = (await sop.get('/api/backoffice/bitacora?por=10')).datos;
  assert.equal(glob.por, 10);
  assert.equal(glob.filas.length, Math.min(10, glob.total));
  assert.equal((await sop.get('/api/backoffice/bitacora?por=5000')).datos.por, 50, 'un tamaño que no es opción vuelve a 50');

  const empresas = (await sop.get('/api/backoffice/clientes')).datos.clientes;
  const cli = (await sop.get(`/api/backoffice/clientes/${empresas[0].id}/bitacora?por=25`)).datos;
  assert.equal(cli.por, 25);
  assert.ok(cli.filas.length <= 25);
});

test('API: una lista por partes entrega 100 filas cuando se piden (la opción más grande cabe en una parte)', async () => {
  const todas = (await demo.get('/api/reservas')).datos;
  const cien = (await demo.get('/api/reservas?limite=100')).datos;
  assert.equal(cien.length, Math.min(100, todas.length));
});
