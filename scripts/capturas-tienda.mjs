// Capturas para las fichas de Google Play y App Store (apps/movil/tienda/capturas/…), con los datos de prueba.
// Levanta el sistema en memoria (PGlite + demo), toma cada pantalla en tamaño de teléfono/tablet y la monta
// sobre el fondo de marca con un titular. Uso: npm run capturas-tienda   (requiere Playwright con Chromium)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.TAREAS = '0'; process.env.DATABASE_URL = ''; process.env.PGLITE_DIR = ''; process.env.SEMBRAR_DEMO = '0';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'apps/movil/tienda/capturas');

// Tamaños exigidos: Play (teléfono 9:16 y tablet), App Store (iPhone 6,9" y iPad 13").
const EQUIPOS = {
  android: { lienzo: [1080, 1920], escala: 2.5, vista: [393, 820] },
  iphone: { lienzo: [1320, 2868], escala: 3, vista: [402, 900] },
  ipad: { lienzo: [2064, 2752], escala: 2, vista: [900, 1300] }
};
const PANTALLAS = [
  ['01-inicio', '/inicio', 'Tu rent a car,<br><b>de un vistazo</b>', 'Entregas y devoluciones del día, flota y cobros pendientes'],
  ['02-reservas', '/reservas', 'Reservas <b>sin topes</b>', 'Disponibilidad por vehículo y sucursal, sin dobles reservas'],
  ['03-patio', '/patio', 'Entrega y devolución<br><b>desde el patio</b>', 'Kilometraje, combustible y fotos con fecha, hora y lugar'],
  ['04-inspeccion', 'INSPECCION', 'Fotos de <b>cada daño</b>', 'Compara la entrega con la devolución en segundos'],
  ['05-contrato', 'CONTRATO', 'Contrato con <b>firma digital</b>', 'El cliente firma en el teléfono y recibe su copia con QR'],
  ['06-flota', '/vehiculos', 'Toda tu <b>flota</b>', 'Estado, mantenciones, TAG, multas y ubicación GPS']
];

const db = await import('../src/db.js');
await db.abrir(); await db.migrar();
await (await import('../src/demo.js')).sembrarDemo();
const app = await (await import('../src/app.js')).crearApp();
const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
const base = `http://127.0.0.1:${srv.address().port}`;

const nav = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') && !process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: '/opt/pw-browsers/chromium' } : {});
const logo = `data:image/png;base64,${fs.readFileSync(path.join(RAIZ, 'public/img/logo-pin.png')).toString('base64')}`;
const fuente = (p) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(RAIZ, 'node_modules/@fontsource/ibm-plex-sans/files', p)).toString('base64')})`;
const CSS_FUENTES = `@font-face{font-family:Plex;font-weight:400;src:${fuente('ibm-plex-sans-latin-400-normal.woff2')}}@font-face{font-family:Plex;font-weight:700;src:${fuente('ibm-plex-sans-latin-700-normal.woff2')}}`;

async function rutaDinamica(pag, clave) {
  if (clave === 'INSPECCION') {
    await pag.goto(`${base}/patio`, { waitUntil: 'networkidle' });
    return pag.evaluate(() => document.querySelector('a[href^="/patio/"]')?.getAttribute('href') || '/patio');
  }
  if (clave === 'CONTRATO') {
    const lista = await pag.evaluate(() => fetch('/api/contratos').then((r) => r.json()));
    const c = (lista.contratos || lista.datos || lista).find?.((x) => x.estado === 'firmado') || (lista.contratos || lista.datos || lista)[0];
    return c ? `/contratos/${c.id}` : '/contratos';
  }
  return clave;
}

for (const [equipo, { lienzo, escala, vista }] of Object.entries(EQUIPOS)) {
  fs.mkdirSync(path.join(SALIDA, equipo), { recursive: true });
  const ctx = await nav.newContext({ viewport: { width: vista[0], height: vista[1] }, deviceScaleFactor: escala, locale: 'es-CL', timezoneId: 'America/Santiago', isMobile: equipo !== 'ipad', hasTouch: true });
  const pag = await ctx.newPage();
  await pag.goto(`${base}/ingresar`);
  await pag.fill('input[name=correo]', 'demo@siguelogps.cl');
  await pag.fill('input[name=clave]', 'demo1234');
  await Promise.all([pag.waitForURL(/\/inicio/), pag.click('button[type=submit]')]);
  const marco = await ctx.newPage();
  await marco.setViewportSize({ width: lienzo[0] / escala, height: lienzo[1] / escala });
  for (const [nombre, ruta, titular, bajada] of PANTALLAS) {
    await pag.goto(base + await rutaDinamica(pag, ruta), { waitUntil: 'networkidle' });
    await pag.addStyleTag({ content: '.rc-marcha { display: none !important; }' }); // la marcha blanca es solo de la demo
    await pag.evaluate(() => document.fonts.ready);
    await pag.waitForTimeout(400);
    const foto = (await pag.screenshot({ type: 'png' })).toString('base64');
    const W = lienzo[0] / escala;
    await marco.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS_FUENTES}
      *{box-sizing:border-box;margin:0}html,body{width:100%;height:100%;background:#15181D;font-family:Plex,sans-serif;overflow:hidden}
      body{display:flex;flex-direction:column}
      .cab{padding:${W * 0.09}px ${W * 0.08}px ${W * 0.06}px;color:#fff;display:flex;flex-direction:column;gap:${W * 0.025}px}
      .marca{display:flex;align-items:center;gap:10px;font-size:${W * 0.035}px;letter-spacing:.04em;text-transform:uppercase;color:#FFD500;font-weight:700}
      .marca img{height:${W * 0.06}px}
      h1{font-size:${W * (equipo === 'ipad' ? 0.06 : 0.082)}px;line-height:1.12;font-weight:400}h1 b{color:#FFD500;font-weight:700}
      p{font-size:${W * (equipo === 'ipad' ? 0.026 : 0.038)}px;color:#C9CDD3;line-height:1.35}
      .tel{flex:1;min-height:0;margin:0 auto;width:${equipo === 'ipad' ? 88 : 86}%;border-radius:${W * 0.05}px ${W * 0.05}px 0 0;overflow:hidden;border:${W * 0.012}px solid #2A2F37;border-bottom:0;background:#fff}
      .tel img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}</style></head><body>
      <div class="cab"><div class="marca"><img src="${logo}">Síguelo On Rent</div><h1>${titular}</h1><p>${bajada}</p></div>
      <div class="tel"><img src="data:image/png;base64,${foto}"></div></body></html>`);
    await marco.evaluate(() => document.fonts.ready);
    const archivo = path.join(SALIDA, equipo, `${nombre}.png`);
    await marco.screenshot({ path: archivo, type: 'png' });
    console.log('✓', path.relative(RAIZ, archivo));
  }
  await ctx.close();
}

// Gráfico destacado de Google Play (1024×500)
const g = await nav.newPage({ viewport: { width: 1024, height: 500 } });
await g.setContent(`<!doctype html><html><head><style>${CSS_FUENTES}*{margin:0;box-sizing:border-box}body{width:1024px;height:500px;background:#15181D;font-family:Plex,sans-serif;display:flex;align-items:center;gap:48px;padding:0 80px;color:#fff}
  img{height:210px}h1{font-size:64px;font-weight:700;line-height:1}h1 span{color:#FFD500}p{font-size:26px;color:#C9CDD3;margin-top:16px;line-height:1.3}</style></head>
  <body><img src="${logo}"><div><h1>Síguelo <span>On Rent</span></h1><p>Reservas, contratos con firma digital,<br>entregas y devoluciones con fotos.</p></div></body></html>`);
await g.evaluate(() => document.fonts.ready);
await g.screenshot({ path: path.join(RAIZ, 'apps/movil/tienda/grafico-destacado-play.png') });
fs.copyFileSync(path.join(RAIZ, 'apps/movil/assets/icon-only.png'), path.join(RAIZ, 'apps/movil/tienda/icono-1024.png'));
console.log('✓ apps/movil/tienda/grafico-destacado-play.png e icono-1024.png');

await nav.close();
srv.close();
await db.cerrar();
