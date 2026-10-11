// Arranque: abre la base, aplica migraciones, siembra datos de prueba si está vacía y levanta el servidor.
import { config } from './config.js';
import { abrir, migrar, uno } from './db.js';
import { crearApp } from './app.js';
import { iniciarTareas } from './tareas.js';

await abrir();
const aplicadas = await migrar();
if (aplicadas.length) console.log(`Migraciones aplicadas: ${aplicadas.join(', ')}`);

const hay = await uno('SELECT count(*)::int AS n FROM empresas');
if (!hay.n && config.sembrarDemo) {
  const { sembrarDemo } = await import('./demo.js');
  await sembrarDemo();
  console.log('Datos de prueba creados: administrador demo@siguelogps.cl / demo1234');
}

const app = await crearApp();
app.listen(config.puerto, () => console.log(`Síguelo Rentacar escuchando en ${config.urlBase} (puerto ${config.puerto}, base: ${config.baseDatos ? 'PostgreSQL' : 'PGlite'})`));
if (config.tareas) iniciarTareas();
