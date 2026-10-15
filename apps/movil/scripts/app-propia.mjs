// Convierte el proyecto de la app en la app con la marca de un cliente (lo usa el workflow «Apps con marca»).
//   node scripts/app-propia.mjs --empresa andes-rent --app equipo|clientes --nombre "Andes Equipo" \
//        --color "#0B5FFF" --host onrent.siguelogps.com --icono /ruta/icono-512.png
// Cambia: paquete (cl.siguelogps.onrent.<empresa>.<app>), nombre, dirección que abre la app, colores,
// ícono y pantalla de inicio. Después: npx cap sync android y compilar.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, l) => (x.startsWith('--') ? [...a, [x.slice(2), l[i + 1]]] : a), []));
const { empresa, app, nombre, host } = args;
const color = /^#[0-9A-Fa-f]{6}$/.test(args.color || '') ? args.color.toUpperCase() : '#15181D';
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(empresa || '')) throw new Error(`Identificador de empresa no válido: ${empresa}`);
if (!['equipo', 'clientes'].includes(app)) throw new Error(`App desconocida: ${app}`);
if (!nombre || nombre.length > 30) throw new Error('Falta el nombre de la app (máximo 30 caracteres).');
if (!/^[a-z0-9.-]+$/.test(host || '')) throw new Error(`Dominio no válido: ${host}`);
if (!fs.existsSync(args.icono || '')) throw new Error(`No está el ícono: ${args.icono}`);

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const seg = (() => { const s = empresa.replace(/[^a-z0-9]/g, ''); return (/^[a-z]/.test(s) ? s : `e${s}`).slice(0, 30); })();
const appId = `cl.siguelogps.onrent.${seg}.${app}`;
const url = app === 'equipo' ? `https://${host}/ingresar?app=${empresa}` : `https://${host}/reservar/${empresa}`;

// 1. Capacitor
const cfgRuta = path.join(raiz, 'capacitor.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgRuta, 'utf8'));
Object.assign(cfg, { appId, appName: nombre });
cfg.server.url = url;
cfg.plugins.SplashScreen.backgroundColor = color;
fs.writeFileSync(cfgRuta, `${JSON.stringify(cfg, null, 2)}\n`);

// 2. Android: paquete y nombre (el código sigue en cl.siguelogps.onrent, que es interno)
const gradle = path.join(raiz, 'android/app/build.gradle');
fs.writeFileSync(gradle, fs.readFileSync(gradle, 'utf8').replace(/applicationId "[^"]+"/, `applicationId "${appId}"`));
const strings = path.join(raiz, 'android/app/src/main/res/values/strings.xml');
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, "\\'").replace(/"/g, '\\"');
fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8')
  .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${xml(nombre)}</string>`)
  .replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${xml(nombre)}</string>`)
  .replace(/<string name="package_name">[^<]*<\/string>/, `<string name="package_name">${appId}</string>`)
  .replace(/<string name="custom_url_scheme">[^<]*<\/string>/, `<string name="custom_url_scheme">${appId}</string>`));

// 3. Íconos y pantalla de inicio desde el ícono del cliente (512 × 512, fondo blanco con margen)
const assets = path.join(raiz, 'assets');
fs.mkdirSync(assets, { recursive: true });
const icono = await sharp(args.icono).resize(1024, 1024).png().toBuffer();
await sharp(icono).toFile(path.join(assets, 'icon-only.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#FFFFFF' } }).png().toFile(path.join(assets, 'icon-background.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp(icono).resize(700, 700).png().toBuffer(), gravity: 'center' }]).png().toFile(path.join(assets, 'icon-foreground.png'));
const marca = await sharp(icono).resize(420, 420).composite([{ input: Buffer.from('<svg width="420" height="420"><rect width="420" height="420" rx="90" ry="90"/></svg>'), blend: 'dest-in' }]).png().toBuffer();
for (const n of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: color } }).composite([{ input: marca, gravity: 'center' }]).png().toFile(path.join(assets, n));
}
execFileSync('npx', ['capacitor-assets', 'generate', '--android', '--iconBackgroundColor', '#FFFFFF', '--iconBackgroundColorDark', '#FFFFFF',
  '--splashBackgroundColor', color, '--splashBackgroundColorDark', color], { cwd: raiz, stdio: 'inherit' });

console.log(`App con marca lista: ${nombre} · ${appId} · abre ${url}`);
