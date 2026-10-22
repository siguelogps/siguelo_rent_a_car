// Integraciones por empresa, cargadas desde la pantalla, no desde variables de entorno. Cada una tiene un interruptor
// «activa»: si está apagada, no genera acciones. Mientras la empresa esté en marcha blanca, o suspendida, nada sale hacia
// afuera (correos, WhatsApp, cobros, DTE, inmovilización).
// 22-oct (Pablo, espec. Backoffice Síguelo): quién las configura lo dice «administra»:
//   · 'siguelo': solo el equipo Síguelo, cliente por cliente, desde el backoffice (plataforma GPS, Síguelo OS, facturación,
//     WhatsApp, correo). El cliente las ve como tarjetas de solo lectura y pide cambios con «Solicitar a Síguelo».
//   · 'cliente': los cobros en línea (Transbank y Mercado Pago). El dinero va a la cuenta del rentacar: los datos de comercio
//     los carga el propio cliente; Síguelo lo ayuda entrando con «Operar».
//   · 'general': el almacenamiento de archivos pasó a ser de Síguelo (Conexiones generales). La fila por empresa se sigue
//     leyendo solo para los clientes que ya tenían bucket propio (no se pierde ninguna conexión que funcionaba).
import { q, uno } from '../db.js';
import { cifrar, descifrar } from '../cifrado.js';
import { leerGeneral } from '../siguelo/conexiones.js';

// Definición de cada integración: campos que se piden en pantalla. «secreto» = no se devuelve al navegador.
export const TIPOS = {
  gps: {
    administra: 'siguelo',
    nombre: 'Plataforma GPS', descripcionCliente: 'Posición en vivo, km y combustible reales, geocercas, alertas e inmovilización.', descripcion: 'Posición en vivo, km y combustible reales, geocercas, alertas e inmovilización. Se conecta con el usuario y la clave de la plataforma GPS (los mismos del dashboard Síguelo).',
    acciones: true,
    campos: [
      { clave: 'cuenta', etiqueta: 'Plataforma', opciones: ['hosting', 'lite'], nombres: { hosting: 'Síguelo Pro', lite: 'Síguelo Lite' }, defecto: 'hosting' },
      { clave: 'usuario', etiqueta: 'Usuario conectado', soloLectura: true, ayuda: 'Se completa al conectar con usuario y clave.' },
      { clave: 'token', etiqueta: 'Token de acceso', secreto: true, avanzado: true, ayuda: 'Se obtiene solo al conectar con usuario y clave. Pégalo aquí solo si te lo entregó soporte.' },
      { clave: 'geocerca_permitida', etiqueta: 'Geocerca de zona permitida (nombre)', ejemplo: 'Chile continental' },
      { clave: 'velocidad_maxima', etiqueta: 'Velocidad máxima (km/h)', tipo: 'numero', defecto: 120 },
      { clave: 'horario_desde', etiqueta: 'Horario permitido desde', defecto: '06:00' },
      { clave: 'horario_hasta', etiqueta: 'Horario permitido hasta', defecto: '23:00' },
      { clave: 'recurso', etiqueta: 'Recurso con geocercas (opcional)', avanzado: true },
      { clave: 'comando_inmovilizar', etiqueta: 'Comando de inmovilización', defecto: 'Bloquear motor', avanzado: true },
      { clave: 'comando_liberar', etiqueta: 'Comando de liberación', defecto: 'Desbloquear motor', avanzado: true }
    ]
  },
  dashboard_siguelo: {
    administra: 'siguelo',
    nombre: 'TAG y multas · Dashboard Síguelo', nombreCliente: 'Síguelo OS', descripcionCliente: 'TAG, multas y salud de la flota desde el dashboard de Síguelo.', descripcion: 'Trae las pasadas TAG (pórticos) y las multas del registro MTT que calcula el dashboard de Síguelo, y las asigna al contrato vigente. Usa la misma conexión de la plataforma GPS: no hay que ingresar nada más.',
    acciones: true,
    campos: [
      { clave: 'sincronizar_cada_horas', etiqueta: 'Sincronizar cada (horas)', tipo: 'numero', defecto: 24 },
      { clave: 'url', etiqueta: 'Dirección del dashboard', defecto: 'https://dashboard.siguelogps.com', avanzado: true },
      { clave: 'api_key', etiqueta: 'Clave de integración (opcional)', secreto: true, opcional: true, avanzado: true, ayuda: 'Solo si soporte Síguelo te entregó una clave; si no, se usa la conexión de la plataforma GPS.' }
    ]
  },
  webpay: {
    administra: 'cliente',
    nombre: 'Transbank Webpay Plus', descripcion: 'Cobro de reservas y garantía con captura diferida (retener y luego capturar o liberar).',
    acciones: true,
    campos: [
      { clave: 'ambiente', etiqueta: 'Ambiente', opciones: ['integracion', 'produccion'], nombres: { integracion: 'Integración (pruebas)', produccion: 'Producción' }, defecto: 'integracion' },
      { clave: 'codigo_comercio', etiqueta: 'Código de comercio (Webpay Plus)' },
      { clave: 'codigo_comercio_diferido', etiqueta: 'Código de comercio captura diferida' },
      { clave: 'api_key', etiqueta: 'API Key secret', secreto: true }
    ]
  },
  mercadopago: {
    administra: 'cliente',
    nombre: 'Mercado Pago', descripcion: 'Cobro en línea y garantía con pago autorizado y captura posterior.',
    acciones: true,
    campos: [
      { clave: 'public_key', etiqueta: 'Public key' },
      { clave: 'access_token', etiqueta: 'Access token', secreto: true }
    ]
  },
  simpleapi: {
    administra: 'siguelo',
    nombre: 'SimpleAPI (boleta y factura electrónica)', nombreCliente: 'Facturación electrónica', descripcion: 'Emisión de DTE ante el SII, igual que en el CRM Síguelo Gestión. Servicio provisto por Síguelo GPS: el certificado y los CAF los envía el cliente con un enlace de carga de un solo uso.',
    descripcionCliente: 'Boletas, facturas y notas de crédito ante el SII, desde Facturación.',
    acciones: true,
    campos: [
      { clave: 'ambiente', etiqueta: 'Ambiente', opciones: ['certificacion', 'produccion'], nombres: { certificacion: 'Certificación', produccion: 'Producción' }, defecto: 'certificacion' },
      { clave: 'api_key', etiqueta: 'API key SimpleAPI', secreto: true },
      { clave: 'rut_certificado', etiqueta: 'RUT del titular del certificado' },
      { clave: 'clave_certificado', etiqueta: 'Clave del certificado (.pfx)', secreto: true },
      { clave: 'certificado_archivo_id', etiqueta: 'Certificado digital (.pfx)', tipo: 'archivo' },
      { clave: 'caf_boleta_archivo_id', etiqueta: 'CAF boletas (39)', tipo: 'archivo' },
      { clave: 'caf_factura_archivo_id', etiqueta: 'CAF facturas (33)', tipo: 'archivo' },
      { clave: 'caf_nota_credito_archivo_id', etiqueta: 'CAF notas de crédito (61)', tipo: 'archivo' },
      { clave: 'resolucion_numero', etiqueta: 'N° resolución SII', defecto: '0' },
      { clave: 'resolucion_fecha', etiqueta: 'Fecha resolución SII', ejemplo: '2014-08-22' }
    ]
  },
  whatsapp: {
    administra: 'siguelo',
    nombre: 'WhatsApp', descripcionCliente: 'Contratos, confirmaciones y avisos por WhatsApp con plantillas aprobadas. Tiene costo por mensaje.', descripcion: 'Envío de contratos, confirmaciones, liquidaciones y avisos de multas (WhatsApp Cloud API de Meta).',
    acciones: true,
    campos: [
      { clave: 'phone_id', etiqueta: 'Phone number ID' },
      { clave: 'token', etiqueta: 'Token permanente', secreto: true },
      { clave: 'plantilla', etiqueta: 'Plantilla aprobada para avisos', defecto: 'aviso_rentacar' },
      { clave: 'idioma', etiqueta: 'Idioma de la plantilla', defecto: 'es' }
    ]
  },
  correo: {
    administra: 'siguelo',
    nombre: 'Correo de salida', descripcion: 'Correos con el nombre del cliente. Normalmente salen por el servidor de Síguelo; un servidor SMTP propio queda para los clientes que ya lo tenían.',
    descripcionCliente: 'Confirmaciones, contratos y avisos con el nombre de tu empresa.',
    acciones: true,
    campos: [
      { clave: 'modo', etiqueta: 'Cómo sale', opciones: ['siguelo', 'smtp'], nombres: { siguelo: 'Servidor de Síguelo', smtp: 'Servidor SMTP propio' } },
      { clave: 'remitente_nombre', etiqueta: 'Remitente visible', ejemplo: 'Andes Rent a Car' },
      { clave: 'responder_a', etiqueta: 'Responder a', ejemplo: 'reservas@andesrent.cl' },
      { clave: 'host', etiqueta: 'Servidor SMTP', ejemplo: 'smtp.gmail.com' },
      { clave: 'puerto', etiqueta: 'Puerto', tipo: 'numero', defecto: 587 },
      { clave: 'usuario', etiqueta: 'Usuario' },
      { clave: 'clave', etiqueta: 'Clave', secreto: true },
      { clave: 'remitente', etiqueta: 'Remitente (servidor propio)', ejemplo: 'Andes Rent a Car <reservas@andesrent.cl>' }
    ]
  },
  almacenamiento: {
    administra: 'general',
    nombre: 'Almacenamiento de fotos y documentos', descripcion: 'Bucket S3 compatible (Cloudflare R2, AWS S3, Backblaze B2, Google Cloud Storage). Las fotos nunca se guardan en el disco del servidor.',
    acciones: false,
    campos: [
      { clave: 'proveedor', etiqueta: 'Proveedor', opciones: ['r2', 's3', 'b2', 'gcs', 'otro'], defecto: 'r2' },
      { clave: 'endpoint', etiqueta: 'Endpoint', ejemplo: 'https://<cuenta>.r2.cloudflarestorage.com' },
      { clave: 'region', etiqueta: 'Región', defecto: 'auto' },
      { clave: 'bucket', etiqueta: 'Bucket' },
      { clave: 'access_key', etiqueta: 'Access key ID' },
      { clave: 'secret_key', etiqueta: 'Secret access key', secreto: true },
      { clave: 'prefijo', etiqueta: 'Prefijo de carpeta', defecto: 'rentacar' }
    ]
  }
};

const cache = new Map(); // `${empresa}:${tipo}` → { activa, config, en }
const TTL = 30e3;

export async function leer(empresaId, tipo) {
  const k = `${empresaId}:${tipo}`;
  const c = cache.get(k);
  if (c && Date.now() - c.en < TTL) return c;
  const r = await uno('SELECT activa, config_cifrada, estado_prueba, probado_en, actualizado_en FROM integraciones WHERE empresa_id = $1 AND tipo = $2', [empresaId, tipo]);
  const defecto = Object.fromEntries((TIPOS[tipo]?.campos || []).filter((f) => f.defecto !== undefined).map((f) => [f.clave, f.defecto]));
  const v = { activa: !!r?.activa, config: { ...defecto, ...(r ? descifrar(r.config_cifrada) : {}) }, estado_prueba: r?.estado_prueba || null, probado_en: r?.probado_en || null, en: Date.now() };
  if (tipo === 'correo' && !v.config.modo) v.config.modo = v.config.host ? 'smtp' : 'siguelo'; // los que ya tenían SMTP siguen con el suyo
  if (tipo === 'dashboard_siguelo') {
    // El dashboard reconoce al cliente con el mismo token de la plataforma GPS: se reutiliza la conexión GPS.
    const gps = await leer(empresaId, 'gps');
    v.config.token_plataforma = gps.config.token || null;
    v.config.cuenta_plataforma = gps.config.cuenta || 'hosting';
    v.config.usuario_plataforma = gps.config.usuario || null;
  }
  cache.set(k, v);
  return v;
}

// Para mostrar en pantalla: los campos secretos se reemplazan por «••••» si existen.
export async function leerPublica(empresaId, tipo) {
  const v = await leer(empresaId, tipo);
  const config = { ...v.config };
  for (const f of TIPOS[tipo].campos) if (f.secreto && config[f.clave]) config[f.clave] = '••••••••';
  if ('token_plataforma' in config) { config.conexion_plataforma = !!config.token_plataforma; delete config.token_plataforma; }
  return { tipo, ...TIPOS[tipo], activa: v.activa, config, configurada: tieneDatos(tipo, v.config), estado_prueba: v.estado_prueba, probado_en: v.probado_en };
}

const tieneDatos = (tipo, c) => {
  if (tipo === 'dashboard_siguelo') return !!c.url && !!(c.api_key || c.token_plataforma);
  if (tipo === 'correo' && c.modo === 'siguelo') return true; // sale por el servidor de Síguelo: el cliente no pone nada
  if (tipo === 'correo') return !!(c.host && c.clave);
  return TIPOS[tipo].campos.filter((f) => f.secreto && !f.opcional).every((f) => c[f.clave]);
};

// Página de ingreso de la plataforma GPS (OAuth): la persona pone su usuario y clave allí y vuelve con un token.
export const HOST_SESION_GPS = { hosting: 'https://plataforma.siguelogps.com', lite: 'https://lite.wialon.com' };

export async function guardar(empresaId, tipo, cambios, usuarioId) {
  if (!TIPOS[tipo]) throw new Error('Integración desconocida');
  const actual = (await leer(empresaId, tipo)).config;
  const nueva = { ...actual };
  for (const f of TIPOS[tipo].campos) {
    if (!(f.clave in cambios)) continue;
    const v = cambios[f.clave];
    if (f.secreto && (v === '••••••••' || v === undefined)) continue; // no se tocó
    nueva[f.clave] = f.tipo === 'numero' && v !== '' ? Number(v) : v;
  }
  await q(`INSERT INTO integraciones (empresa_id, tipo, config_cifrada, actualizado_por, actualizado_en) VALUES ($1,$2,$3,$4, now())
           ON CONFLICT (empresa_id, tipo) DO UPDATE SET config_cifrada = EXCLUDED.config_cifrada, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
    [empresaId, tipo, cifrar(nueva), usuarioId]);
  cache.delete(`${empresaId}:${tipo}`);
}

export async function activar(empresaId, tipo, activa, usuarioId) {
  await q(`INSERT INTO integraciones (empresa_id, tipo, activa, actualizado_por) VALUES ($1,$2,$3,$4)
           ON CONFLICT (empresa_id, tipo) DO UPDATE SET activa = EXCLUDED.activa, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
    [empresaId, tipo, !!activa, usuarioId]);
  cache.delete(`${empresaId}:${tipo}`);
}

export async function registrarPrueba(empresaId, tipo, estado) {
  await q(`INSERT INTO integraciones (empresa_id, tipo, estado_prueba, probado_en) VALUES ($1,$2,$3, now())
           ON CONFLICT (empresa_id, tipo) DO UPDATE SET estado_prueba = EXCLUDED.estado_prueba, probado_en = now()`, [empresaId, tipo, String(estado).slice(0, 500)]);
  cache.delete(`${empresaId}:${tipo}`);
}

export async function marchaBlanca(empresaId) {
  const e = await uno('SELECT marcha_blanca FROM empresas WHERE id = $1', [empresaId]);
  return e ? e.marcha_blanca : true;
}

// ¿Puede esta integración generar acciones reales hacia afuera? (activa + configurada + sin marcha blanca)
export async function puedeActuar(empresaId, tipo) {
  const e = await uno('SELECT estado FROM empresas WHERE id = $1', [empresaId]);
  if (e && e.estado !== 'activo') return { ok: false, motivo: e.estado === 'baja' ? 'Cliente dado de baja' : 'Servicio suspendido' };
  const v = await leer(empresaId, tipo);
  if (!v.activa) return { ok: false, motivo: `La integración «${TIPOS[tipo].nombre}» está desactivada` };
  if (!tieneDatos(tipo, v.config)) return { ok: false, motivo: `Faltan datos de conexión de «${TIPOS[tipo].nombre}»` };
  if (TIPOS[tipo].acciones && await marchaBlanca(empresaId)) return { ok: false, motivo: 'Marcha blanca activa', marchaBlanca: true };
  if (tipo === 'correo' && v.config.modo === 'siguelo' && !(await leerGeneral('correo_siguelo')).lista) return { ok: false, motivo: 'El correo de Síguelo todavía no está configurado' };
  return { ok: true, config: v.config };
}

export const limpiarCache = () => cache.clear();

// Tipos que ve y configura cada uno. El almacenamiento ya no aparece en ninguna lista por cliente.
export const tiposDe = (administra) => Object.keys(TIPOS).filter((t) => TIPOS[t].administra === administra);
export const TIPOS_CLIENTE = Object.keys(TIPOS).filter((t) => TIPOS[t].administra !== 'general');

// Al dar de baja: se apagan las integraciones y se borran sus secretos (la fila queda para la bitácora).
export async function desconectarTodo(empresaId) {
  await q(`UPDATE integraciones SET activa = false, config_cifrada = NULL, actualizado_en = now() WHERE empresa_id = $1 AND tipo <> 'almacenamiento'`, [empresaId]);
  for (const t of Object.keys(TIPOS)) cache.delete(`${empresaId}:${t}`);
}
