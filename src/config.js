// Configuración del proceso. Solo lo mínimo va en variables de entorno: las conexiones de cada rentacar
// (plataforma GPS, pagos, SimpleAPI, WhatsApp, correo, almacenamiento) se cargan desde la pantalla de Configuración.
import 'dotenv/config';
import crypto from 'node:crypto';

const produccion = process.env.NODE_ENV === 'production';
if (produccion && !process.env.APP_SECRET) throw new Error('Falta APP_SECRET (se usa para cifrar las credenciales de las integraciones)');

export const config = {
  produccion,
  puerto: Number(process.env.PORT) || 3000,
  urlBase: (process.env.URL_BASE || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  baseDatos: process.env.DATABASE_URL || '',          // vacío = PGlite embebido (desarrollo, pruebas y demo)
  pgliteDir: process.env.PGLITE_DIR || '',            // vacío = en memoria
  secreto: process.env.APP_SECRET || crypto.createHash('sha256').update('siguelo-rentacar-desarrollo').digest('hex'),
  sembrarDemo: process.env.SEMBRAR_DEMO === '1' || (!produccion && process.env.SEMBRAR_DEMO !== '0'),
  tareas: process.env.TAREAS !== '0',                 // sincronización GPS, avisos de vencimientos, etc.
  // Síguelo On Board (acceso único del equipo). No es un secreto: la clave pública se lee de esa dirección.
  panelAdmin: 'https://admin.siguelogps.com'
};
