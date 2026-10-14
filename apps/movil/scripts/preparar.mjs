// Deja www/servidor.js con la dirección del sistema (la misma de capacitor.config.json → server.url),
// para que la pantalla «Sin conexión» sepa adónde volver. Se corre solo antes de `cap sync` (npm run sincronizar).
import fs from 'node:fs';

const raiz = new URL('..', import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL('capacitor.config.json', raiz), 'utf8'));
const url = process.env.SERVIDOR_ON_RENT || config.server?.url;
if (!/^https:\/\//.test(url || '')) throw new Error(`server.url debe ser https:// (está «${url}»)`);
if (process.env.SERVIDOR_ON_RENT && process.env.SERVIDOR_ON_RENT !== config.server.url) {
  config.server.url = process.env.SERVIDOR_ON_RENT;
  fs.writeFileSync(new URL('capacitor.config.json', raiz), `${JSON.stringify(config, null, 2)}\n`);
}
fs.writeFileSync(new URL('www/servidor.js', raiz), `window.SERVIDOR_ON_RENT = ${JSON.stringify(url)};\n`);
console.log(`Servidor de la app: ${url}`);
