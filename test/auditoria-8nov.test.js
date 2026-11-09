// Auditoría del 8-nov (aprobada por Pablo el 9-nov): una prueba por cada conducta nueva. Los números (#N) son las filas
// de la tabla de hallazgos de On Rent; «marca #12» es la de la auditoría de marca y posicionamiento.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { levantar } from './ayuda.js';
import { escEsMio } from '../public/estandar.js';
import { resumenDesdeListas, subtitulosHoy } from '../public/js/indicadores-hoy.js';
import { cabezaPortal, ciudadesDe } from '../src/portal/pagina.js';
import { esIndexable } from '../src/cabeceras.js';

const leer = (ruta) => fs.readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
let t;
before(async () => { t = await levantar(); });
after(async () => { await t.cerrar(); });

test('#1 Esc con dos ventanas abiertas cierra solo la de arriba (también el Atrás de Android, que despacha Esc)', () => {
  const abajo = {}, arriba = {};
  const esc = (extra = {}) => ({ key: 'Escape', defaultPrevented: false, ...extra });
  assert.equal(escEsMio(esc(), abajo, [abajo, arriba]), false, 'la de abajo no lo toma');
  assert.equal(escEsMio(esc(), arriba, [abajo, arriba]), true, 'la de arriba sí');
  // Ya atendido por la de arriba (preventDefault): nadie más lo toma, aunque la de abajo haya quedado última.
  assert.equal(escEsMio(esc({ defaultPrevented: true }), abajo, [abajo]), false);
  assert.equal(escEsMio({ key: 'Enter', defaultPrevented: false }, arriba, [arriba]), false);
  const comun = leer('public/comun.js');
  // modal() y «Mi cuenta» usan la misma regla y marcan el evento; ninguno queda con el Esc sin coordinar de antes.
  assert.equal(comun.match(/escEsMio\(e, fondo, document\.querySelectorAll\('\.modal-fondo'\)\)\) \{ e\.preventDefault\(\);/g)?.length, 2);
  assert.doesNotMatch(comun, /if \(e\.key === 'Escape'\) cerrar/);
  // nativa.js: el Atrás despacha UN Esc y, si la de arriba no se cerró con eso, toca solo su ✕.
  assert.match(leer('public/nativa.js'), /const ultimo = modales\[modales\.length - 1\];/);
});

test('#2 Plataforma GPS: la búsqueda de la lista es por palabras y sin tildes', () => {
  const gps = leer('public/gps.html');
  assert.match(gps, /calzaPalabras\(`\$\{v\.patente\} \$\{patente\(v\.patente\)\}/);
  assert.doesNotMatch(gps, /\.toUpperCase\(\)\.includes\(txt\)/);
});

test('#9 y #10 Plataforma GPS: no inventa «0 km» ni «detenido» cuando el dato no llegó', () => {
  const gps = leer('public/gps.html');
  assert.doesNotMatch(gps, /km_recorridos \?\? 0/);
  assert.match(gps, /rec\.km_recorridos == null \? '—'/);
  assert.doesNotMatch(gps.replace(/^\s*\/\/.*$/gm, ''), /\(v\.gps_velocidad \|\| 0\)/, 'una velocidad null ya no se vuelve 0');
  assert.match(gps, /'velocidad sin dato'/);
});

test('#3 /reservar/:slug trae nombre, descripción, Open Graph y canonical en el HTML (sin depender de JavaScript)', async () => {
  const r = await fetch(`${t.base}/reservar/andes-rent`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /<title>Reserva tu vehículo · Andes Rent a Car<\/title>/);
  assert.match(html, /<meta name="description" content="Reserva en línea tu vehículo en Andes Rent a Car: [^"]+">/);
  assert.match(html, /<meta property="og:title" content="Reserva tu vehículo · Andes Rent a Car">/);
  assert.match(html, /<meta property="og:image" content="http[^"]+\/(api\/logo\/andes-rent|img\/app\/icono-512\.png)">/);
  assert.match(html, /<link rel="canonical" href="http[^"]+\/reservar\/andes-rent">/);
  assert.doesNotMatch(html, /name="robots"/, 'el portal se puede indexar');
  assert.equal(r.headers.get('x-robots-tag'), null);
  // El script de la página es el mismo del archivo: la CSP en modo informe sigue reconociendo su hash.
  const guion = (s) => s.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  assert.equal(guion(html), guion(leer('public/reservar.html')));
  // /embed repite el portal: canonical al /reservar y sin indexar.
  const e = await (await fetch(`${t.base}/embed/andes-rent`)).text();
  assert.match(e, /<link rel="canonical" href="http[^"]+\/reservar\/andes-rent">/);
  assert.match(e, /<meta name="robots" content="noindex">/);
});

test('#3 la descripción nombra las ciudades de las sucursales sin repetir y escapa el nombre', () => {
  assert.equal(ciudadesDe([{ ciudad: 'Santiago' }, { comuna: 'Temuco' }, { ciudad: 'santiago' }, { ciudad: 'Puerto Montt' }]), 'Santiago, Temuco y Puerto Montt');
  assert.equal(ciudadesDe([]), '');
  const { titulo, etiquetas } = cabezaPortal({ empresa: { nombre: 'Rent "Sur" & Cía', slug: 'sur', logo_clave: null }, sucursales: [{ ciudad: 'Osorno' }], urlBase: 'https://x.cl' });
  assert.equal(titulo, 'Reserva tu vehículo · Rent "Sur" & Cía');
  assert.match(etiquetas, /content="Reserva en línea tu vehículo en Rent &quot;Sur&quot; &amp; Cía: [^"]+ Sucursales en Osorno\."/);
  assert.match(etiquetas, /og:image" content="https:\/\/x\.cl\/img\/app\/icono-512\.png"/);
});

test('#4 un rentacar que no existe responde 404 (con la misma página y noindex), no 200', async () => {
  for (const ruta of ['/reservar/no-existe', '/embed/no-existe']) {
    const r = await fetch(t.base + ruta);
    assert.equal(r.status, 404, ruta);
    const html = await r.text();
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /No encontramos este rentacar/, 'la página sigue explicando qué pasó');
  }
});

test('#5 las pantallas con sesión van con X-Robots-Tag: noindex y hay robots.txt', async () => {
  const inicio = await fetch(`${t.base}/inicio`);
  assert.equal(inicio.headers.get('x-robots-tag'), 'noindex, nofollow');
  for (const ruta of ['/ingresar', '/privacidad', '/soporte', '/reservar/andes-rent']) {
    assert.equal((await fetch(t.base + ruta)).headers.get('x-robots-tag'), null, ruta);
  }
  assert.equal(esIndexable('/embed/andes-rent'), false);
  assert.equal(esIndexable('/reservas/12'), false);
  assert.equal(esIndexable('/api/logo/andes-rent'), true);
  const robots = await fetch(`${t.base}/robots.txt`);
  assert.equal(robots.status, 200);
  const txt = await robots.text();
  assert.match(txt, /Disallow: \/api\//);
  assert.match(txt, /Allow: \/api\/logo\//);
});

test('#6 ingreso, privacidad y soporte tienen descripción y vista previa', () => {
  for (const f of ['ingresar', 'privacidad', 'soporte']) {
    const h = leer(`public/${f}.html`);
    assert.match(h, /<meta name="description" content="[^"]{40,}">/, f);
    assert.match(h, /<meta property="og:title" content="[^"]+">/, f);
    assert.match(h, /<meta property="og:image" content="https:\/\/onrent\.siguelogps\.com\/img\/app\/icono-512\.png">/, f);
  }
});

test('#7 la página 404 tiene idioma, viewport, estilos de la familia y logo', async () => {
  const r = await fetch(`${t.base}/no-hay-nada-aqui/de-verdad/no`);
  assert.equal(r.status, 404);
  const h = await r.text();
  assert.match(h, /<html lang="es-CL">/);
  assert.match(h, /name="viewport"/);
  assert.match(h, /href="\/app\.css"/);
  assert.match(h, /src="\/img\/siguelo-onrent-b-claro\.png"/);
  assert.match(h, /No encontramos esta página/);
});

test('#8 #18 #19 #20 hojas: 16 px en táctil, 100dvh en iOS, toast con entrada suave e interruptor con transform', () => {
  const css = leer('public/rentacar.css');
  assert.match(css, /@media \(pointer: coarse\) \{\s*input[^{]*, select, textarea \{ font-size: 16px; \}/);
  assert.match(leer('public/css/portal.css'), /@media \(pointer: coarse\) \{ \.pt-buscador \.campo, \.pt-form \.campo \{ font-size: 16px; \} \}/);
  assert.match(css, /html\.nativa-ios \.menu \{[^}]*height: calc\(100dvh - env\(safe-area-inset-top\)\)/);
  assert.match(css, /\.toast \{ animation: rc-toast-entra 200ms cubic-bezier\(0\.23, 1, 0\.32, 1\); \}/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.toast \{ animation: none; \} \}/);
  assert.match(css, /\.switch input:checked \+ span::after \{ left: 3px; transform: translateX\(18px\); \}/);
});

test('#11 #12 Contratos en una línea en el teléfono; barra corta del calendario con solo el folio', () => {
  assert.match(leer('public/contratos.html'), /<table class="tabla rc-una-linea" id="tabla">/);
  const cal = leer('public/js/reservas-calendario.js');
  assert.match(cal, /const corta = Math\.min\(b, N\) - Math\.max\(a, 0\) < 1\.6 \? ' corta' : '';/);
  assert.match(cal, /title="\$\{esc\(t\)\}"/, 'el nombre completo sigue en el title');
  assert.match(leer('public/rentacar.css'), /\.rc-barra\.corta b \{ display: none; \}/);
});

test('#13 el mapa despeja las patentes que se encimarían', () => {
  const gps = leer('public/gps.html');
  assert.match(gps, /mapa\.on\('zoomend moveend resize', \(\) => despejarEtiquetas\(\)\);/);
  assert.match(gps, /el\.style\.visibility = choca \? 'hidden' : '';/);
});

test('#14 Inicio y Reservas dicen lo mismo en cada indicador del día', () => {
  const ayu = { esc: (s) => s, patente: (p) => p.replace(/^([A-Z]{4})(\d{2})$/, '$1-$2'), atrasoTxt: () => '5 h de atraso' };
  const listas = {
    retiros: [{ sucursal_retiro: 'Aeropuerto' }, { sucursal_retiro: 'Centro' }, { sucursal_retiro: 'Aeropuerto' }],
    devoluciones: [{ sucursal_retiro: 'Centro', sucursal_devolucion: 'Aeropuerto' }, { sucursal_retiro: 'Centro', sucursal_devolucion: 'Centro' }],
    atrasadas: [{ folio: 'R-1009', patente: 'RKDS90', fin: '2026-11-08T10:00:00Z' }, { folio: 'R-1010', patente: null, fin: '2026-11-08T11:00:00Z' }]
  };
  const desdeInicio = subtitulosHoy(resumenDesdeListas(listas), ayu);
  const desdeReservas = subtitulosHoy({ retiros: 3, retiros_sucursal: { nombre: 'Aeropuerto', n: 2 }, devoluciones: 2, devoluciones_otra: 1, atrasadas: listas.atrasadas }, ayu);
  assert.deepEqual(desdeInicio, desdeReservas);
  assert.deepEqual(desdeInicio, { retiros: '2 en Aeropuerto', devoluciones: '1 en otra sucursal', atrasadas: 'RKDS-90 · 5 h de atraso y 1 más' });
  assert.deepEqual(subtitulosHoy(resumenDesdeListas({}), ayu), { retiros: 'sin retiros pendientes', devoluciones: 'sin devoluciones hoy', atrasadas: 'ninguna' });
  for (const f of ['inicio', 'reservas']) assert.match(leer(`public/${f}.html`), /subtitulosHoy\(/, f);
});

test('#15 verificación: «Código no encontrado» no se repite en el cuerpo', () => {
  const v = leer('public/verificar.html');
  assert.match(v, /\/\^código no encontrado\\\.\?\$\/i\.test/);
  assert.doesNotMatch(v, /\$\{esc\(err\.message\)\}\. Revisa/);
});

test('#16 #17 buscador de la barra con ayuda corta en el teléfono; theme-color con modo oscuro', () => {
  const comun = leer('public/comun.js');
  assert.match(comun, /window\.matchMedia\?\.\('\(max-width: 600px\)'\)/);
  assert.match(comun, /inp\.setAttribute\('aria-label', AYUDA\)/);
  assert.match(leer('public/tema.js'), /var BARRA = \{ claro: '#FFFFFF', oscuro: '#1A1F26' \};/);
});

test('marca #12: «rent a car» no aparece en los textos de la ficha ni de privacidad (solo como palabra clave de búsqueda)', () => {
  const ficha = leer('apps/movil/tienda/ficha.md');
  const sinClaves = ficha.replace(/## Palabras clave[\s\S]*?(?=\n## )/, '');
  assert.doesNotMatch(sinClaves, /rent a car/i);
  assert.doesNotMatch(ficha, /RESERVAS SIN TOPES/);
  assert.match(ficha, /Tu rentacar en el teléfono/);
  assert.doesNotMatch(leer('public/privacidad.html'), /rent a car/i);
  assert.doesNotMatch(leer('scripts/capturas-tienda.mjs'), /rent a car|sin topes/i);
});
