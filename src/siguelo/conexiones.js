// Conexiones generales de Síguelo (Backoffice › Conexiones generales): las que no son de un cliente sino del servicio.
//   · almacenamiento: el bucket S3 compatible donde quedan las fotos y documentos de TODOS los clientes (antes cada
//     rentacar cargaba el suyo; 22-oct, Pablo: pasa a Síguelo). Un cliente que ya tenía bucket propio lo conserva.
//   · correo_siguelo: el servidor de correo de Síguelo (avisos al equipo, invitaciones, enlaces de carga y, si el cliente
//     lo tiene así, sus correos con su nombre de remitente).
//   · crm: Síguelo Gestión. «Solicitar a Síguelo» abre un ticket allá con un pedido firmado (HMAC-SHA256 por herramienta).
// Mismo tratamiento que las integraciones de los clientes: se guardan cifradas, los secretos nunca vuelven al navegador y
// se cargan desde la pantalla (no en variables de entorno, salvo APP_SECRET, que ya existía).
import { q, uno } from '../db.js';
import { cifrar, descifrar } from '../cifrado.js';

export const MASCARA = '••••••••';

export const GENERALES = {
  almacenamiento: {
    nombre: 'Almacenamiento de fotos y documentos', descripcion: 'Bucket S3 compatible (Cloudflare R2, AWS S3, Backblaze B2, Google Cloud Storage) común a todos los clientes. Las fotos nunca se guardan en el disco del servidor.',
    campos: [
      { clave: 'proveedor', etiqueta: 'Proveedor', opciones: ['r2', 's3', 'b2', 'gcs', 'otro'], defecto: 'r2' },
      { clave: 'endpoint', etiqueta: 'Endpoint', ejemplo: 'https://<cuenta>.r2.cloudflarestorage.com' },
      { clave: 'region', etiqueta: 'Región', defecto: 'auto' },
      { clave: 'bucket', etiqueta: 'Bucket' },
      { clave: 'access_key', etiqueta: 'Access key ID' },
      { clave: 'secret_key', etiqueta: 'Secret access key', secreto: true },
      { clave: 'prefijo', etiqueta: 'Prefijo de carpeta', defecto: 'rentacar' }
    ],
    lista: (c) => !!(c.bucket && c.access_key && c.secret_key)
  },
  correo_siguelo: {
    nombre: 'Correo de Síguelo', descripcion: 'Servidor SMTP de Síguelo: avisos al equipo, invitaciones, enlaces de carga y correos de los clientes que salen «por el servidor de Síguelo» con su nombre.',
    campos: [
      { clave: 'host', etiqueta: 'Servidor SMTP', ejemplo: 'smtp.gmail.com' },
      { clave: 'puerto', etiqueta: 'Puerto', tipo: 'numero', defecto: 587 },
      { clave: 'usuario', etiqueta: 'Usuario' },
      { clave: 'clave', etiqueta: 'Clave', secreto: true },
      { clave: 'remitente', etiqueta: 'Dirección que envía', ejemplo: 'no-responder@siguelogps.com' },
      { clave: 'aviso_equipo', etiqueta: 'Correo del equipo (recibe las solicitudes)', ejemplo: 'soporte@siguelogps.cl' }
    ],
    lista: (c) => !!(c.host && c.clave && (c.remitente || c.usuario))
  },
  crm: {
    nombre: 'Síguelo Gestión (CRM)', descripcion: '«Solicitar a Síguelo» abre un ticket en la Mesa de soporte del CRM. El secreto se genera en el CRM (Integraciones › Herramientas Síguelo › On Rent) y se pega aquí.',
    campos: [
      { clave: 'url', etiqueta: 'Dirección del CRM', defecto: 'https://gestion.siguelogps.com' },
      { clave: 'secreto', etiqueta: 'Secreto de la herramienta (sgh_…)', secreto: true }
    ],
    lista: (c) => !!(c.url && c.secreto)
  }
};

const cache = new Map();
const TTL = 30e3;
export const limpiarCacheGenerales = () => cache.clear();

export async function leerGeneral(tipo) {
  const c = cache.get(tipo);
  if (c && Date.now() - c.en < TTL) return c;
  const r = await uno('SELECT config_cifrada, estado_prueba, probado_en, actualizado_en FROM conexiones_siguelo WHERE tipo = $1', [tipo]).catch(() => null);
  const defecto = Object.fromEntries((GENERALES[tipo]?.campos || []).filter((f) => f.defecto !== undefined).map((f) => [f.clave, f.defecto]));
  let guardada = {};
  try { guardada = r?.config_cifrada ? descifrar(r.config_cifrada) : {}; } catch { guardada = {}; }
  const v = { config: { ...defecto, ...guardada }, configurada: !!r?.config_cifrada, estado_prueba: r?.estado_prueba || null, probado_en: r?.probado_en || null, actualizado_en: r?.actualizado_en || null, en: Date.now() };
  v.lista = GENERALES[tipo] ? GENERALES[tipo].lista(v.config) : false;
  cache.set(tipo, v);
  return v;
}

export async function leerGeneralPublica(tipo) {
  const v = await leerGeneral(tipo);
  const config = { ...v.config };
  for (const f of GENERALES[tipo].campos) if (f.secreto && config[f.clave]) config[f.clave] = MASCARA;
  return { tipo, nombre: GENERALES[tipo].nombre, descripcion: GENERALES[tipo].descripcion, campos: GENERALES[tipo].campos, config, lista: v.lista, estado_prueba: v.estado_prueba, probado_en: v.probado_en, actualizado_en: v.actualizado_en };
}

export async function guardarGeneral(tipo, cambios, usuarioId) {
  if (!GENERALES[tipo]) throw new Error('Conexión desconocida');
  const actual = (await leerGeneral(tipo)).config;
  const nueva = { ...actual };
  for (const f of GENERALES[tipo].campos) {
    if (!(f.clave in cambios)) continue;
    const v = cambios[f.clave];
    if (f.secreto && (v === MASCARA || v === undefined)) continue; // no se tocó
    nueva[f.clave] = f.tipo === 'numero' && v !== '' ? Number(v) : typeof v === 'string' ? v.trim() : v;
  }
  await q(`INSERT INTO conexiones_siguelo (tipo, config_cifrada, actualizado_por, actualizado_en) VALUES ($1,$2,$3, now())
           ON CONFLICT (tipo) DO UPDATE SET config_cifrada = EXCLUDED.config_cifrada, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
  [tipo, cifrar(nueva), usuarioId]);
  cache.delete(tipo);
}

export async function registrarPruebaGeneral(tipo, estado) {
  await q(`INSERT INTO conexiones_siguelo (tipo, estado_prueba, probado_en) VALUES ($1,$2, now())
           ON CONFLICT (tipo) DO UPDATE SET estado_prueba = EXCLUDED.estado_prueba, probado_en = now()`, [tipo, String(estado).slice(0, 500)]);
  cache.delete(tipo);
}
