// Almacenamiento de fotos y documentos, intercambiable: S3 compatible (R2, S3, B2, GCS) o «bd» (solo desarrollo/demo,
// guarda el contenido en la tabla archivos_contenido). Nunca se escribe en el disco del servidor.
// guardarArchivo({ …, cifrado: true }) guarda el contenido cifrado (certificado digital, CAF); leerArchivo lo descifra.
// API: guardarArchivo({ empresaId, entidad, entidadId, tipo, nombre, mime, datos: Buffer, meta, usuarioId }) → fila de archivos
//      leerArchivo(empresaId, id) → { fila, datos: Buffer }
import crypto from 'node:crypto';
import { q, uno } from '../db.js';
import { leer } from '../integraciones/index.js';
import { leerGeneral } from '../siguelo/conexiones.js';
import { config } from '../config.js';

const clientes = new Map();

function clienteS3(c, k) {
  if (!clientes.has(k)) {
    clientes.set(k, (async () => {
      const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({ region: c.region || 'auto', endpoint: c.endpoint || undefined, forcePathStyle: !!c.endpoint, credentials: { accessKeyId: c.access_key, secretAccessKey: c.secret_key } });
      return {
        poner: (clave, datos, mime) => s3.send(new PutObjectCommand({ Bucket: c.bucket, Key: clave, Body: datos, ContentType: mime })),
        sacar: async (clave) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: c.bucket, Key: clave }))).Body.transformToByteArray()),
        borrar: (clave) => s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: clave })),
        prefijo: c.prefijo || 'rentacar'
      };
    })());
  }
  return clientes.get(k);
}
const BD = {
  prefijo: 'rentacar',
  poner: (clave, datos) => q('INSERT INTO archivos_contenido (clave, datos) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET datos = EXCLUDED.datos', [clave, datos]),
  sacar: async (clave) => { const r = await uno('SELECT datos FROM archivos_contenido WHERE clave = $1', [clave]); if (!r) throw new Error('Archivo no encontrado'); return Buffer.from(r.datos); },
  borrar: (clave) => q('DELETE FROM archivos_contenido WHERE clave = $1', [clave])
};
const listo = (c) => !!(c.bucket && c.access_key && c.secret_key);

// 22-oct (Pablo): el almacenamiento pasa a ser de Síguelo (Conexiones generales), común a todos los clientes. Para no
// perder nada, cada archivo anota en meta.almacen dónde quedó: 'empresa' (bucket propio que el cliente ya tenía; se sigue
// usando para ese cliente), 'general' (el de Síguelo) o 'bd' (solo desarrollo y demo). Los archivos anteriores no traen la
// marca: se leen como antes (bucket propio si existe; si no, la base).
async function almacen(nombre, empresaId) {
  if (nombre === 'empresa') {
    const c = (await leer(empresaId, 'almacenamiento')).config;
    return listo(c) ? { nombre, ...(await clienteS3(c, `e:${empresaId}:${c.endpoint}:${c.bucket}:${c.access_key}`)) } : null;
  }
  if (nombre === 'general') {
    const c = (await leerGeneral('almacenamiento')).config;
    return listo(c) ? { nombre, ...(await clienteS3(c, `g:${c.endpoint}:${c.bucket}:${c.access_key}`)) } : null;
  }
  return { nombre: 'bd', ...BD };
}

async function driverParaGuardar(empresaId) {
  const d = (await almacen('empresa', empresaId)) || (await almacen('general'));
  if (d) return d;
  if (config.produccion && process.env.PERMITIR_ALMACENAMIENTO_BD !== '1') {
    throw new Error('El almacenamiento de fotos y documentos todavía no está listo. Avisa a Síguelo GPS.');
  }
  return almacen('bd');
}

async function driverDe(empresaId, fila) {
  const marca = fila.meta?.almacen;
  if (marca === 'general' || marca === 'empresa') {
    const d = await almacen(marca, empresaId);
    if (!d) throw new Error('El almacenamiento donde quedó este archivo ya no está configurado');
    return d;
  }
  if (marca === 'bd') return almacen('bd');
  return (await almacen('empresa', empresaId)) || almacen('bd'); // archivo anterior a la marca: como antes
}

// Certificado digital y CAF (y lo que se pida con «cifrar»): el contenido se guarda cifrado con AES-256-GCM, con una llave
// distinta de la de las credenciales, derivada del mismo APP_SECRET. Ni el bucket ni la base ven el archivo en claro.
const llaveArchivos = crypto.createHash('sha256').update(`rentacar:archivos:${config.secreto}`).digest();
function cifrarDatos(datos) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llaveArchivos, iv);
  const cuerpo = Buffer.concat([c.update(datos), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), cuerpo]);
}
function descifrarDatos(b) {
  const d = crypto.createDecipheriv('aes-256-gcm', llaveArchivos, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'image/svg+xml': 'svg', 'application/vnd.android.package-archive': 'apk', 'application/vnd.android.aab': 'aab' };

export async function guardarArchivo({ empresaId, entidad, entidadId = null, tipo = null, nombre = null, mime = 'application/octet-stream', datos, meta = {}, usuarioId = null, maximoMb = 15, cifrado = false }) {
  if (!Buffer.isBuffer(datos)) throw new Error('datos debe ser un Buffer');
  if (datos.length > maximoMb * 1024 * 1024) throw new Error(`El archivo supera los ${maximoMb} MB`);
  const d = await driverParaGuardar(empresaId);
  const clave = `${d.prefijo}/${empresaId}/${entidad}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${cifrado ? 'cif' : (EXT[mime] || 'bin')}`;
  await d.poner(clave, cifrado ? cifrarDatos(datos) : datos, cifrado ? 'application/octet-stream' : mime);
  const [fila] = await q(
    `INSERT INTO archivos (empresa_id, entidad, entidad_id, tipo, clave, nombre, mime, tamano, meta, subido_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [empresaId, entidad, entidadId, tipo, clave, nombre, mime, datos.length, JSON.stringify({ ...meta, almacen: d.nombre, ...(cifrado ? { cifrado: 'v1' } : {}) }), usuarioId]);
  return fila;
}

export async function leerArchivo(empresaId, id) {
  const fila = await uno('SELECT * FROM archivos WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!fila) return null;
  const d = await driverDe(empresaId, fila);
  const datos = await d.sacar(fila.clave);
  return { fila, datos: fila.meta?.cifrado === 'v1' ? descifrarDatos(datos) : datos };
}

export async function borrarArchivo(empresaId, id) {
  const fila = await uno('SELECT * FROM archivos WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!fila) return;
  const d = await driverDe(empresaId, fila).catch(() => null);
  if (!d) { await q('DELETE FROM archivos WHERE id = $1', [id]); return; }
  await d.borrar(fila.clave).catch(() => {});
  await q('DELETE FROM archivos WHERE id = $1', [id]);
}

// data URL (lo que manda el navegador desde la cámara o el canvas de firma) → { mime, datos }
// 31-oct (revisión de seguridad): un archivo subido por una persona de la empresa se servía con el Content-Type que ella
// misma declaró en la data URL. Un HTML o un SVG con script, abierto desde /api/archivos/:id, corría en el mismo origen que
// el sistema con la sesión de quien lo abría (XSS almacenado: un counter contra el administrador). Ahora solo las fotos y
// los PDF se muestran en el navegador; cualquier otro tipo baja como adjunto binario, sin ejecutar nada.
export const MIME_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MIME_EN_PANTALLA = [...MIME_IMAGEN, 'application/pdf'];
export const MIME_SUBIDA = [...MIME_EN_PANTALLA];

// Lanza 400 (ErrorHttp-compatible) si el tipo no está en la lista permitida.
export function exigirMime(mime, permitidos, mensaje = 'Sube una foto (JPG, PNG o WebP) o un PDF.') {
  if (!permitidos.includes(String(mime || '').toLowerCase())) { const e = new Error(mensaje); e.estado = 400; e.campo = 'archivo'; throw e; }
  return mime;
}

// Manda un archivo leído con leerArchivo(). Solo fotos y PDF van «inline» con su tipo real; el resto, como descarga binaria.
export function entregarArchivo(res, { fila, datos }, { nombre = null, cache = 'private, no-cache', descarga = false } = {}) {
  const mime = String(fila.mime || '').toLowerCase();
  const seguro = MIME_EN_PANTALLA.includes(mime);
  const archivo = encodeURIComponent(nombre || fila.nombre || 'archivo');
  res.setHeader('Content-Type', seguro ? mime : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Disposition', `${descarga || !seguro ? 'attachment' : 'inline'}; filename*=UTF-8''${archivo}`);
  res.end(datos);
}

export function desdeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) throw new Error('Imagen inválida');
  return { mime: m[1], datos: Buffer.from(m[2], 'base64') };
}
