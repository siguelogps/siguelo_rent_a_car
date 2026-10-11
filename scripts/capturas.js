// Etapa 0: genera las capturas PNG de las maquetas (mockups/*.html → mockups/capturas/*.png).
// Uso: npm run capturas   (requiere Playwright con Chromium)
const path = require('path');
const fs = require('fs');
const http = require('http');

let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const RAIZ = path.join(__dirname, '..');
const TIPOS = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };

// Las maquetas usan módulos ES: se sirven por HTTP local, no con file://
const servidor = http.createServer((req, res) => {
  const ruta = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (!ruta.startsWith(RAIZ) || !fs.existsSync(ruta) || fs.statSync(ruta).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream' });
  fs.createReadStream(ruta).pipe(res);
});

(async () => {
  await new Promise((r) => servidor.listen(0, r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const filtro = process.argv[2];
  const paginas = fs.readdirSync(path.join(RAIZ, 'mockups')).filter((f) => /^\d\d-.*\.html$/.test(f) && (!filtro || f.includes(filtro))).sort();
  const nav = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') && !process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  fs.mkdirSync(path.join(RAIZ, 'mockups/capturas'), { recursive: true });
  for (const f of paginas) {
    const html = fs.readFileSync(path.join(RAIZ, 'mockups', f), 'utf8');
    const ancho = Number((html.match(/name="captura-ancho" content="(\d+)"/) || [])[1] || 1440);
    const pag = await nav.newPage({ viewport: { width: ancho, height: 900 }, deviceScaleFactor: 1.5, locale: 'es-CL' });
    await pag.goto(`${base}/mockups/${f}`, { waitUntil: 'networkidle' });
    await pag.evaluate(() => document.fonts.ready);
    const salida = path.join(RAIZ, 'mockups/capturas', f.replace('.html', '.png'));
    await pag.screenshot({ path: salida, fullPage: true });
    console.log('✓', path.relative(RAIZ, salida));
    await pag.close();
  }
  await nav.close();
  servidor.close();
})().catch((e) => { console.error(e); process.exit(1); });
