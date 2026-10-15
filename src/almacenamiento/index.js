// Almacenamiento de fotos y documentos, intercambiable: S3 compatible (R2, S3, B2, GCS) o «bd» (solo desarrollo/demo,
// guarda el contenido en la tabla archivos_contenido). Nunca se escribe en el disco del servidor.
// API: guardarArchivo({ empresaId, entidad, entidadId, tipo, nombre, mime, datos: Buffer, meta, usuarioId }) → fila de archivos
//      leerArchivo(empresaId, id) → { fila, datos: Buffer }
import crypto from 'node:crypto';
import { q, uno } from '../db.js';
import { leer } from '../integraciones/index.js';
import { config } from '../config.js';

const clientes = new Map();

async function driver(empresaId) {
  const v = await leer(empresaId, 'almacenamiento');
  const c = v.config;
  if (c.bucket && c.access_key && c.secret_key) {
    const k = `${empresaId}:${c.endpoint}:${c.bucket}:${c.access_key}`;
    if (!clientes.has(k)) {
      const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({ region: c.region || 'auto', endpoint: c.endpoint || undefined, forcePathStyle: !!c.endpoint, credentials: { accessKeyId: c.access_key, secretAccessKey: c.secret_key } });
      clientes.set(k, {
        nombre: 's3',
        poner: (clave, datos, mime) => s3.send(new PutObjectCommand({ Bucket: c.bucket, Key: clave, Body: datos, ContentType: mime })),
        sacar: async (clave) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: c.bucket, Key: clave }))).Body.transformToByteArray()),
        borrar: (clave) => s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: clave })),
        prefijo: c.prefijo || 'rentacar'
      });
    }
    return clientes.get(k);
  }
  if (config.produccion && process.env.PERMITIR_ALMACENAMIENTO_BD !== '1') {
    throw new Error('Configura el almacenamiento externo (Configuración › Integraciones › Almacenamiento) para subir fotos y documentos.');
  }
  return {
    nombre: 'bd', prefijo: 'rentacar',
    poner: (clave, datos) => q('INSERT INTO archivos_contenido (clave, datos) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET datos = EXCLUDED.datos', [clave, datos]),
    sacar: async (clave) => { const r = await uno('SELECT datos FROM archivos_contenido WHERE clave = $1', [clave]); if (!r) throw new Error('Archivo no encontrado'); return Buffer.from(r.datos); },
    borrar: (clave) => q('DELETE FROM archivos_contenido WHERE clave = $1', [clave])
  };
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'image/svg+xml': 'svg', 'application/vnd.android.package-archive': 'apk', 'application/vnd.android.aab': 'aab' };

export async function guardarArchivo({ empresaId, entidad, entidadId = null, tipo = null, nombre = null, mime = 'application/octet-stream', datos, meta = {}, usuarioId = null, maximoMb = 15 }) {
  if (!Buffer.isBuffer(datos)) throw new Error('datos debe ser un Buffer');
  if (datos.length > maximoMb * 1024 * 1024) throw new Error(`El archivo supera los ${maximoMb} MB`);
  const d = await driver(empresaId);
  const clave = `${d.prefijo}/${empresaId}/${entidad}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${EXT[mime] || 'bin'}`;
  await d.poner(clave, datos, mime);
  const [fila] = await q(
    `INSERT INTO archivos (empresa_id, entidad, entidad_id, tipo, clave, nombre, mime, tamano, meta, subido_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [empresaId, entidad, entidadId, tipo, clave, nombre, mime, datos.length, JSON.stringify(meta), usuarioId]);
  return fila;
}

export async function leerArchivo(empresaId, id) {
  const fila = await uno('SELECT * FROM archivos WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!fila) return null;
  const d = await driver(empresaId);
  return { fila, datos: await d.sacar(fila.clave) };
}

export async function borrarArchivo(empresaId, id) {
  const fila = await uno('SELECT * FROM archivos WHERE id = $1 AND empresa_id = $2', [id, empresaId]);
  if (!fila) return;
  const d = await driver(empresaId);
  await d.borrar(fila.clave).catch(() => {});
  await q('DELETE FROM archivos WHERE id = $1', [id]);
}

// data URL (lo que manda el navegador desde la cámara o el canvas de firma) → { mime, datos }
export function desdeDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) throw new Error('Imagen inválida');
  return { mime: m[1], datos: Buffer.from(m[2], 'base64') };
}
