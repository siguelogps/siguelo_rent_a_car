// Cifrado de credenciales de integraciones (AES-256-GCM con una llave derivada de APP_SECRET).
import crypto from 'node:crypto';
import { config } from './config.js';

const llave = crypto.createHash('sha256').update(`rentacar:${config.secreto}`).digest();

export function cifrar(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llave, iv);
  const datos = Buffer.concat([c.update(JSON.stringify(obj ?? {}), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), datos.toString('base64')].join('.');
}

export function descifrar(txt) {
  if (!txt) return {};
  const [v, iv, tag, datos] = String(txt).split('.');
  if (v !== 'v1') throw new Error('Formato de credencial desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', llave, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8'));
}

export const hashSha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
export const tokenAleatorio = (n = 24) => crypto.randomBytes(n).toString('base64url');
