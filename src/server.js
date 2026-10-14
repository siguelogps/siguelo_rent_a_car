// Arranque: abre la base, aplica migraciones, siembra datos de prueba si está vacía y levanta el servidor.
import { config } from './config.js';
import { abrir, migrar, uno } from './db.js';
import { crearApp } from './app.js';
import { iniciarTareas } from './tareas.js';

// En producción sin DATABASE_URL no se arranca la base embebida (no persiste y consume mucha memoria):
// se levanta una página que explica el paso que falta.
if (config.produccion && !config.baseDatos && process.env.PERMITIR_PGLITE !== '1') {
  const { default: express } = await import('express');
  const app = express();
  app.get('/salud', (_req, res) => res.status(503).json({ ok: false, servicio: 'siguelo-rentacar', error: 'Falta DATABASE_URL' }));
  app.use((_req, res) => res.status(503).type('html').send(`<!doctype html><meta charset="utf-8"><title>Síguelo On Rent</title>
    <body style="font-family:system-ui;max-width:560px;margin:80px auto;padding:0 16px;color:#15181D">
    <img src="/img/logo-siguelo.png" alt="Síguelo GPS" style="height:34px"><h1 style="font-size:22px">Falta conectar la base de datos</h1>
    <p>Agrega la variable <b>DATABASE_URL</b> con la «Internal Database URL» de PostgreSQL en Render (servicio › Environment) y el sistema arrancará solo.</p></body>`));
  app.use('/img', express.static(new URL('../public/img', import.meta.url).pathname));
  app.listen(config.puerto, () => console.error('Falta DATABASE_URL: se sirve solo la página de aviso. Configúrala en el servicio.'));
} else {
await abrir();
const aplicadas = await migrar();
if (aplicadas.length) console.log(`Migraciones aplicadas: ${aplicadas.join(', ')}`);

const hay = await uno('SELECT count(*)::int AS n FROM empresas');
if (!hay.n && config.sembrarDemo) {
  const { sembrarDemo } = await import('./demo.js');
  await sembrarDemo({ clave: process.env.DEMO_CLAVE || 'demo1234' });
  console.log(`Datos de prueba creados: administrador demo@siguelogps.cl${process.env.DEMO_CLAVE ? ' (clave en DEMO_CLAVE)' : ' / demo1234'}`);
}

const { asegurarSuperadmin } = await import('./superadmin.js');
await asegurarSuperadmin();

const app = await crearApp();
app.listen(config.puerto, () => console.log(`Síguelo On Rent escuchando en ${config.urlBase} (puerto ${config.puerto}, base: ${config.baseDatos ? 'PostgreSQL' : 'PGlite'})`));
if (config.tareas) iniciarTareas();
}
