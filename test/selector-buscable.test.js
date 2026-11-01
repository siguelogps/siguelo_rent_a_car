// Selector buscable · 1-nov-2026 (maqueta aprobada por Pablo): todo <select> de 8 opciones o más tiene un cuadro con
// buscador por palabras (public/selector-buscable.js), instalado por comun.js › iniciarPagina() igual que el paginador,
// y en la página pública de reservas. El <select> nativo sigue siendo la fuente del valor.
// Aquí se prueba la lógica pura (filtro, resaltado, regla de conversión) y que el control esté enchufado donde
// corresponde; la conducta en pantalla (escribir, teclado, modal, teléfono) se comprobó con Playwright (capturas en la
// entrega), porque el repo no tiene jsdom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { filtrarOpciones, resaltar, debeConvertir, palabrasDe, sinTildes, calzaPalabras, UMBRAL, TOPE } from '../public/selector-buscable.js';

const RAIZ = path.join(import.meta.dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');

const VEHICULOS = [
  { i: 0, v: '', t: 'Elige un vehículo', s: '', g: '', dis: false },
  { i: 1, v: '17', t: 'BCDF-12 · Toyota Yaris', s: 'Económico', g: 'Santiago', dis: false },
  { i: 2, v: '18', t: 'GHJK-34 · Toyota Corolla', s: 'Sedán', g: 'Santiago', dis: false },
  { i: 3, v: '21', t: 'LMNP-56 · Hyundai Tucson', s: 'SUV', g: 'Antofagasta', dis: false },
  { i: 4, v: '30', t: 'RSTV-78 · Kia Rio', s: '', g: 'Antofagasta', dis: true },
  { i: 5, v: '99', t: 'Juan Carlos Pérez González', s: '', g: '', dis: false }
];

test('filtra por palabras: cualquier orden, sin mayúsculas ni tildes, y el texto secundario también cuenta', () => {
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'toyota corolla').map((o) => o.v), ['18']);
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'COROLLA toyota').map((o) => o.v), ['18'], 'en cualquier orden');
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'perez gonzalez').map((o) => o.v), ['99'], 'sin tildes');
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'PÉREZ').map((o) => o.v), ['99'], 'con tilde escrita también calza');
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'sedan').map((o) => o.v), ['18'], 'por el texto secundario');
  assert.deepEqual(filtrarOpciones(VEHICULOS, '').map((o) => o.v), VEHICULOS.map((o) => o.v), 'sin búsqueda: todas, en su orden');
  assert.deepEqual(filtrarOpciones(VEHICULOS, '   ').map((o) => o.v), VEHICULOS.map((o) => o.v));
  // Misma regla que comun.js › calzaPalabras (fase 1).
  assert.equal(sinTildes('  Núñez  PÉREZ '), 'nunez perez');
  assert.ok(calzaPalabras('Juan Carlos Pérez González', 'perez juan'));
  assert.ok(!calzaPalabras('Juan Carlos Pérez González', 'perez maria'));
});

test('un valor pegado entero (patente, RUT) se busca entero, nunca por el inicio; sin resultados devuelve vacío y no inventa', () => {
  const ops = [{ i: 0, v: '1', t: '12.345.678-5', s: '', g: '', dis: false }, { i: 1, v: '2', t: '12.345.679-3', s: '', g: '', dis: false }];
  assert.deepEqual(filtrarOpciones(ops, '12.345.679-3').map((o) => o.v), ['2']);
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'LMNP-56 · Hyundai Tucson').map((o) => o.v), ['21']);
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'toyota yaris suv'), []);
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'toyota yaris').map((o) => o.v), ['17']);
});

test('el orden original se respeta (los grupos siguen juntos) y una opción deshabilitada sigue en la lista', () => {
  assert.deepEqual(filtrarOpciones(VEHICULOS, 'o').map((o) => o.i), [0, 1, 2, 3, 4, 5]);
  assert.equal(filtrarOpciones(VEHICULOS, 'kia')[0].dis, true);
});

test('resalta las palabras que calzan trasladando las posiciones al texto con tildes, y escapa el HTML', () => {
  assert.equal(resaltar('Toyota Corolla', 'coro toyota'), '<mark>Toyota</mark> <mark>Coro</mark>lla');
  assert.equal(resaltar('Juan Carlos Pérez González', 'perez juan'), '<mark>Juan</mark> Carlos <mark>Pérez</mark> González');
  assert.equal(resaltar('<b>x</b> & y', 'x'), '&lt;b&gt;<mark>x</mark>&lt;/b&gt; &amp; y', 'nunca inyecta HTML');
  assert.equal(resaltar('Sin nada', ''), 'Sin nada');
  assert.equal(resaltar('a a a', 'a'), '<mark>a</mark> <mark>a</mark> <mark>a</mark>', 'todas las apariciones');
  assert.equal(resaltar('Ñandú', 'nandu'), '<mark>Ñandú</mark>');
  assert.deepEqual(palabrasDe('  Juan   PÉREZ '), ['juan', 'perez']);
});

// Un <select> de mentira con lo justo para la regla (sin navegador).
const sel = ({ n = 8, attrs = {}, multiple = false, hidden = false, listo = false } = {}) => ({
  tagName: 'SELECT', multiple, hidden, options: { length: n }, dataset: listo ? { sbListo: '1' } : {},
  hasAttribute: (a) => a in attrs, getAttribute: (a) => attrs[a] ?? null
});

test(`regla de conversión: desde ${UMBRAL} opciones; data-sin-buscar excluye, data-buscar fuerza; multiple, hidden y size no se tocan`, () => {
  assert.equal(UMBRAL, 8);
  assert.equal(debeConvertir(sel({ n: 8 })), true);
  assert.equal(debeConvertir(sel({ n: 7 })), false);
  assert.equal(debeConvertir(sel({ n: 3, attrs: { 'data-buscar': '' } })), true, 'data-buscar fuerza uno corto');
  assert.equal(debeConvertir(sel({ n: 400, attrs: { 'data-sin-buscar': '' } })), false, 'data-sin-buscar excluye uno largo');
  assert.equal(debeConvertir(sel({ n: 400, multiple: true })), false, 'multiple no en esta tanda');
  assert.equal(debeConvertir(sel({ n: 400, hidden: true })), false);
  assert.equal(debeConvertir(sel({ n: 400, attrs: { size: '6' } })), false, 'una lista abierta (size) no es un desplegable');
  assert.equal(debeConvertir(sel({ n: 400, listo: true })), false, 'ya convertido');
  assert.equal(debeConvertir({ tagName: 'INPUT' }), false);
  assert.ok(TOPE >= 100, 'con el cuadro vacío se dibujan las primeras TOPE y se pide escribir para ver más');
});

test('el control se instala en iniciarPagina() y en la página pública de reservas; comun.js reexporta la búsqueda; la regla queda en CLAUDE.md', () => {
  const comun = leer('public/comun.js');
  assert.match(comun, /import \{ instalarSelectorBuscable, sinTildes, calzaPalabras \} from '\/selector-buscable\.js'/);
  assert.match(comun, /instalarPaginador\(\);\s*\n\s*instalarSelectorBuscable\(\);/, 'se instala junto al paginador');
  assert.match(comun, /export \{ sinTildes, calzaPalabras \};/, 'una sola definición de la búsqueda por palabras en el repo');
  assert.match(leer('public/reservar.html'), /instalarSelectorBuscable\(\);/, 'la página pública tiene <select> largos (horas, licencia)');
  const css = leer('public/rentacar.css');
  assert.match(css, /\.sb-lista \{/, 'rentacar.css viste la lista');
  assert.doesNotMatch(css.slice(css.indexOf('.sb {')), /100vw|100vh/, 'el control no usa 100vw ni 100vh');
  assert.match(leer('CLAUDE.md'), /selector buscable/i);
  // Nada de librerías externas ni de comun.js (para poder probarse en Node).
  assert.doesNotMatch(leer('public/selector-buscable.js'), /https?:\/\/|^import /m);
});
