// Integraciones por empresa, cargadas desde la pantalla (Configuración › Integraciones), no desde variables de entorno.
// Cada integración tiene un interruptor «activa» que solo los administradores cambian. Si está apagada, no genera acciones.
// Además, mientras la empresa esté en marcha blanca, nada sale hacia afuera (correos, WhatsApp, cobros, DTE, inmovilización).
import { q, uno } from '../db.js';
import { cifrar, descifrar } from '../cifrado.js';

// Definición de cada integración: campos que se piden en pantalla. «secreto» = no se devuelve al navegador.
export const TIPOS = {
  gps: {
    nombre: 'Plataforma GPS', descripcion: 'Posición en vivo, km y combustible reales, geocercas, alertas e inmovilización.',
    acciones: true,
    campos: [
      { clave: 'url', etiqueta: 'URL del servidor', ejemplo: 'https://hst-api.wialon.com', defecto: 'https://hst-api.wialon.com' },
      { clave: 'token', etiqueta: 'Token de acceso', secreto: true },
      { clave: 'recurso', etiqueta: 'Recurso con geocercas (opcional)' },
      { clave: 'geocerca_permitida', etiqueta: 'Geocerca de zona permitida (nombre)', ejemplo: 'Chile continental' },
      { clave: 'velocidad_maxima', etiqueta: 'Velocidad máxima (km/h)', tipo: 'numero', defecto: 120 },
      { clave: 'horario_desde', etiqueta: 'Horario permitido desde', defecto: '06:00' },
      { clave: 'horario_hasta', etiqueta: 'Horario permitido hasta', defecto: '23:00' },
      { clave: 'comando_inmovilizar', etiqueta: 'Comando de inmovilización', defecto: 'Bloquear motor' },
      { clave: 'comando_liberar', etiqueta: 'Comando de liberación', defecto: 'Desbloquear motor' }
    ]
  },
  dashboard_siguelo: {
    nombre: 'TAG y multas · Dashboard Síguelo', descripcion: 'Trae las pasadas TAG (pórticos) y las multas del registro MTT que calcula el dashboard de Síguelo, y las asigna al contrato vigente.',
    acciones: true,
    campos: [
      { clave: 'url', etiqueta: 'URL del dashboard', defecto: 'https://dashboard.siguelogps.cl' },
      { clave: 'cliente', etiqueta: 'Cliente en el dashboard (usuario de la plataforma GPS)' },
      { clave: 'api_key', etiqueta: 'Clave de integración', secreto: true },
      { clave: 'sincronizar_cada_horas', etiqueta: 'Sincronizar cada (horas)', tipo: 'numero', defecto: 24 }
    ]
  },
  webpay: {
    nombre: 'Transbank Webpay Plus', descripcion: 'Cobro de reservas y garantía con captura diferida (retener y luego capturar o liberar).',
    acciones: true,
    campos: [
      { clave: 'ambiente', etiqueta: 'Ambiente', opciones: ['integracion', 'produccion'], defecto: 'integracion' },
      { clave: 'codigo_comercio', etiqueta: 'Código de comercio (Webpay Plus)' },
      { clave: 'codigo_comercio_diferido', etiqueta: 'Código de comercio captura diferida' },
      { clave: 'api_key', etiqueta: 'API Key secret', secreto: true }
    ]
  },
  mercadopago: {
    nombre: 'Mercado Pago', descripcion: 'Cobro en línea y garantía con pago autorizado y captura posterior.',
    acciones: true,
    campos: [
      { clave: 'public_key', etiqueta: 'Public key' },
      { clave: 'access_token', etiqueta: 'Access token', secreto: true }
    ]
  },
  simpleapi: {
    nombre: 'SimpleAPI (boleta y factura electrónica)', descripcion: 'Emisión de DTE ante el SII, igual que en el CRM Síguelo Gestión.',
    acciones: true,
    campos: [
      { clave: 'ambiente', etiqueta: 'Ambiente', opciones: ['certificacion', 'produccion'], defecto: 'certificacion' },
      { clave: 'api_key', etiqueta: 'API key SimpleAPI', secreto: true },
      { clave: 'rut_certificado', etiqueta: 'RUT del titular del certificado' },
      { clave: 'clave_certificado', etiqueta: 'Clave del certificado (.pfx)', secreto: true },
      { clave: 'certificado_archivo_id', etiqueta: 'Certificado digital (.pfx)', tipo: 'archivo' },
      { clave: 'caf_boleta_archivo_id', etiqueta: 'CAF boletas (39)', tipo: 'archivo' },
      { clave: 'caf_factura_archivo_id', etiqueta: 'CAF facturas (33)', tipo: 'archivo' },
      { clave: 'resolucion_numero', etiqueta: 'N° resolución SII', defecto: '0' },
      { clave: 'resolucion_fecha', etiqueta: 'Fecha resolución SII', ejemplo: '2014-08-22' }
    ]
  },
  whatsapp: {
    nombre: 'WhatsApp', descripcion: 'Envío de contratos, confirmaciones, liquidaciones y avisos de multas (WhatsApp Cloud API de Meta).',
    acciones: true,
    campos: [
      { clave: 'phone_id', etiqueta: 'Phone number ID' },
      { clave: 'token', etiqueta: 'Token permanente', secreto: true },
      { clave: 'plantilla', etiqueta: 'Plantilla aprobada para avisos', defecto: 'aviso_rentacar' },
      { clave: 'idioma', etiqueta: 'Idioma de la plantilla', defecto: 'es' }
    ]
  },
  correo: {
    nombre: 'Correo (SMTP)', descripcion: 'Envío de correos con el nombre y logo de la empresa.',
    acciones: true,
    campos: [
      { clave: 'host', etiqueta: 'Servidor SMTP', ejemplo: 'smtp.gmail.com' },
      { clave: 'puerto', etiqueta: 'Puerto', tipo: 'numero', defecto: 587 },
      { clave: 'usuario', etiqueta: 'Usuario' },
      { clave: 'clave', etiqueta: 'Clave', secreto: true },
      { clave: 'remitente', etiqueta: 'Remitente', ejemplo: 'Andes Rent a Car <reservas@andesrent.cl>' }
    ]
  },
  almacenamiento: {
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
  cache.set(k, v);
  return v;
}

// Para mostrar en pantalla: los campos secretos se reemplazan por «••••» si existen.
export async function leerPublica(empresaId, tipo) {
  const v = await leer(empresaId, tipo);
  const config = { ...v.config };
  for (const f of TIPOS[tipo].campos) if (f.secreto && config[f.clave]) config[f.clave] = '••••••••';
  return { tipo, ...TIPOS[tipo], activa: v.activa, config, configurada: tieneDatos(tipo, v.config), estado_prueba: v.estado_prueba, probado_en: v.probado_en };
}

const tieneDatos = (tipo, c) => TIPOS[tipo].campos.filter((f) => f.secreto).every((f) => c[f.clave]);

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
  const v = await leer(empresaId, tipo);
  if (!v.activa) return { ok: false, motivo: `La integración «${TIPOS[tipo].nombre}» está desactivada` };
  if (!tieneDatos(tipo, v.config)) return { ok: false, motivo: `Faltan datos de conexión de «${TIPOS[tipo].nombre}»` };
  if (TIPOS[tipo].acciones && await marchaBlanca(empresaId)) return { ok: false, motivo: 'Marcha blanca activa', marchaBlanca: true };
  return { ok: true, config: v.config };
}

export const limpiarCache = () => cache.clear();
