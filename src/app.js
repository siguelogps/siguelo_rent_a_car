// Aplicación Express: API en /api (rutas cargadas desde src/api/*.js), páginas en /public con URLs limpias.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cargarSesion, soloLectura, ErrorHttp } from './auth.js';
import { config } from './config.js';
import { idempotencia } from './app-nativa/idempotencia.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLICO = path.join(RAIZ, 'public');

export async function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Cabeceras de seguridad (31-oct, revisión de seguridad):
  //   · HSTS solo en producción (en desarrollo se entra por http://localhost y el navegador recordaría el «solo https»).
  //   · La API responde con «Cache-Control: no-store» por defecto, para que un navegador compartido no guarde listas de
  //     clientes, pagos o contratos; las rutas que sí se cachean (logo, archivos) ponen la suya después y mandan.
  //   · X-Frame-Options fuera del portal público (/portal, /reservar, /embed), que los clientes incrustan en su sitio.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (config.produccion) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (!req.path.startsWith('/portal') && !req.path.startsWith('/reservar') && !req.path.startsWith('/embed')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use(express.json({ limit: '25mb' }));            // fotos y firmas llegan como data URL
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(cargarSesion);
  app.use('/api', idempotencia); // reintentos de la cola de la app nativa (cabecera Idempotency-Key)
  // «Ver como» del equipo Síguelo es de solo lectura EN EL SERVIDOR (22-oct, espec. Backoffice): cualquier cambio se rechaza.
  app.use('/api', soloLectura);

  app.get('/salud', (_req, res) => res.json({ ok: true, servicio: 'siguelo-rentacar' }));

  // Entrada desde Síguelo On Board también en /acceso-admin (la ruta por defecto que usa el panel).
  const { entradaDesdeAdmin } = await import('./api/09-acceso-admin.js');
  app.post('/acceso-admin', entradaDesdeAdmin);

  // API: cada archivo de src/api exporta `default` = express.Router (montado en /api)
  const api = express.Router();
  const dirApi = path.join(RAIZ, 'src/api');
  for (const f of fs.readdirSync(dirApi).filter((f) => f.endsWith('.js')).sort()) {
    const mod = await import(pathToFileURL(path.join(dirApi, f)).href);
    if (mod.default) api.use(mod.default);
  }
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new ErrorHttp(404, 'Ruta no encontrada')));

  // Ícono del menú Apps de la plataforma GPS: la plataforma le pega «/app/logo.png» a la URL registrada tal cual
  // (medido en Síguelo OS). Se muestra desde el dominio de la plataforma: Cross-Origin-Resource-Policy: cross-origin.
  const { rutasIcono, CABECERAS_ICONO } = await import('./app-plataforma.js');
  app.get(rutasIcono(['/app-plataforma.html']), (_req, res) => {
    res.sendFile(path.join(PUBLICO, 'app', 'logo.png'), { headers: CABECERAS_ICONO }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  });

  // Archivos estáticos y fuentes (IBM Plex, sin depender de Google Fonts)
  app.use('/node_modules/@fontsource', express.static(path.join(RAIZ, 'node_modules/@fontsource'), { maxAge: '30d' }));
  app.use('/vendor/leaflet', express.static(path.join(RAIZ, 'node_modules/leaflet/dist'), { maxAge: '30d' }));
  app.use(express.static(PUBLICO, { extensions: ['html'], index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

  // URLs limpias de las páginas con parámetro: /reservas/123 → reserva.html, /verificar/ABC → verificar.html, etc.
  const PAGINAS_PARAM = { empresas: 'empresa', invitacion: 'invitacion', carga: 'carga', reservas: 'reserva', vehiculos: 'vehiculo', clientes: 'cliente', contratos: 'contrato', incidentes: 'incidente', liquidaciones: 'liquidacion', verificar: 'verificar', reservar: 'reservar', portal: 'portal', firmar: 'firmar', patio: 'patio-inspeccion', embed: 'reservar' };
  app.get('/:pagina/:id', (req, res, next) => {
    const html = PAGINAS_PARAM[req.params.pagina];
    if (!html) return next();
    const archivo = path.join(PUBLICO, `${html}.html`);
    fs.existsSync(archivo) ? res.sendFile(archivo, { dotfiles: 'allow' }) : next();
  });
  app.get('/', (req, res) => res.redirect(!req.usuario ? '/ingresar' : req.usuario.siguelo && !req.empresaId ? '/empresas' : '/inicio'));

  app.use((req, res) => {
    if (req.accepts('html')) return res.status(404).sendFile(path.join(PUBLICO, '404.html'), { dotfiles: 'allow' });
    res.status(404).json({ error: 'No encontrado' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const estado = err.estado || err.status || 500;
    if (estado >= 500) console.error(`[${req.method} ${req.path}]`, err);
    const { estado: _e, status: _s, message: _m, stack: _st, retryAfter, ...extra } = err;
    if (estado === 429 && retryAfter) res.setHeader('Retry-After', String(retryAfter));
    res.status(estado).json({ ...(estado < 500 ? extra : {}), error: estado >= 500 && process.env.NODE_ENV === 'production' ? 'Ocurrió un error inesperado. Inténtalo de nuevo.' : err.message });
  });
  return app;
}
