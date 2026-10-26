// 26-oct: logo «Síguelo GPS + On Rent» aprobado por Pablo (A horizontal, B apilado; «claro» para fondos claros y
// «oscuro» para fondos oscuros). Son archivos nuevos: el logo oficial (logo-siguelo.png, logo-pin.png) no se toca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (r) => fs.readFileSync(path.join(raiz, r), 'utf8');
const LOCKUPS = ['a-claro', 'a-oscuro', 'b-claro', 'b-oscuro'].map((v) => `public/img/siguelo-onrent-${v}.png`);

test('logo On Rent: los cuatro archivos existen, son PNG y livianos (menos de 20 kB)', () => {
  for (const r of LOCKUPS) {
    const b = fs.readFileSync(path.join(raiz, r));
    assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], r);
    assert.ok(b.length < 20_000, `${r} pesa ${b.length} bytes`);
  }
  for (const r of ['android/app/src/main/res/drawable-nodpi/logo_onrent_a_oscuro.png', 'android/app/src/main/res/drawable-nodpi/logo_onrent_b_oscuro.png']) {
    assert.ok(fs.existsSync(path.join(raiz, r)), r);
  }
});

test('logo On Rent: ingreso, invitación, certificado y conexión GPS llevan la versión clara y la oscura (B)', () => {
  for (const r of ['public/ingresar.html', 'public/invitacion.html', 'public/carga.html', 'public/integracion-gps.html']) {
    const s = leer(r);
    assert.match(s, /siguelo-onrent-b-claro\.png/, r);
    assert.match(s, /siguelo-onrent-b-oscuro\.png/, r);
    assert.doesNotMatch(s, /logo-siguelo\.png/, r);
  }
  const css = leer('public/rentacar.css');
  assert.match(css, /\.logo-onrent-oscuro \{ display: none !important; \}/);
  assert.match(css, /:root\[data-theme="oscuro"\] \.logo-onrent-claro \{ display: none !important; \}/);
});

test('logo On Rent: el menú lateral lleva B en claro y en oscuro; el backoffice muestra siempre el oscuro', () => {
  const comun = leer('public/comun.js');
  assert.match(comun, /siguelo-onrent-b-claro\.png/);
  assert.match(comun, /siguelo-onrent-b-oscuro\.png/);
  assert.doesNotMatch(comun, /logo-siguelo\.png/);
  assert.match(leer('public/css/backoffice.css'), /\.app\.bo \.menu-marca \.logo-onrent-claro \{ display: none !important; \}/);
});

test('logo On Rent: páginas públicas y legales llevan el horizontal (A); la app con marca pone el logo del cliente', () => {
  for (const r of ['public/privacidad.html', 'public/soporte.html', 'public/firmar.html', 'public/verificar.html', 'public/portal.html', 'public/reservar.html', 'public/pago-resultado.html']) {
    const s = leer(r);
    assert.match(s, /siguelo-onrent-a-claro\.png/, r);
    assert.doesNotMatch(s, /logo-siguelo\.png/, r);
  }
  // Marca blanca: con el logo del rentacar se quita la versión oscura y queda solo el suyo.
  const ingreso = leer('public/ingresar.html');
  assert.match(ingreso, /getElementById\('logo-oscuro'\)\?\.remove\(\)/);
  assert.match(ingreso, /logo\.src = m\.logo/);
});

test('logo On Rent: el logo oficial sigue intacto y en uso (pin del menú plegado y favicon)', () => {
  assert.ok(fs.existsSync(path.join(raiz, 'public/img/logo-siguelo.png')));
  assert.match(leer('public/comun.js'), /\/img\/logo-pin\.png/);
});
