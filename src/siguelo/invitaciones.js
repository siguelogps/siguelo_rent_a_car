// Invitación al administrador de un cliente (22-oct, espec. Backoffice): Síguelo crea el usuario sin clave y le manda un
// enlace para que la cree él mismo. Vence en 72 h y sirve una vez. Síguelo no escribe ni ve la clave.
// En la base solo queda el hash del enlace. Si el correo de Síguelo no está configurado, el backoffice recibe el enlace
// para entregarlo por otro medio (es lo único que se muestra; la clave nunca).
import { q, uno } from '../db.js';
import { hashSha256, tokenAleatorio } from '../cifrado.js';
import { hashClave } from '../auth.js';
import { config } from '../config.js';
import { enviarCorreoSiguelo } from './correo.js';

const HORAS = 72;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function invitar(usuarioId) {
  const u = await uno('SELECT u.id, u.nombre, u.correo, e.nombre AS empresa FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id WHERE u.id = $1', [usuarioId]);
  if (!u) throw new Error('Usuario no encontrado');
  const token = tokenAleatorio(32);
  await q(`UPDATE usuarios SET invitacion_hash = $2, invitacion_vence = now() + interval '${HORAS} hours' WHERE id = $1`, [u.id, hashSha256(token)]);
  const enlace = `${config.urlBase}/invitacion/${token}`;
  const r = await enviarCorreoSiguelo({
    para: u.correo, asunto: `Tu acceso a Síguelo On Rent · ${u.empresa || ''}`.trim(),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#15181D">
      <p>Hola ${esc(u.nombre)}:</p>
      <p>Síguelo GPS creó tu acceso a <b>Síguelo On Rent</b> para <b>${esc(u.empresa)}</b>. Entra a este enlace para crear tu clave (vence en ${HORAS} horas y sirve una sola vez):</p>
      <p><a href="${enlace}" style="background:#FFD500;color:#15181D;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Crear mi clave</a></p>
      <p style="color:#5B6370;font-size:12px">Si no esperabas este correo, ignóralo. Nadie de Síguelo te pedirá tu clave.</p></div>`
  });
  return r.ok ? { enviado: true } : { enviado: false, motivo: r.motivo, enlace };
}

export async function leerInvitacion(token) {
  return uno(`SELECT u.id, u.nombre, u.correo, u.empresa_id, e.nombre AS empresa, u.invitacion_vence FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id
               WHERE u.invitacion_hash = $1 AND u.invitacion_vence > now() AND u.activo`, [hashSha256(String(token || ''))]);
}

export async function aceptarInvitacion(token, clave) {
  const u = await leerInvitacion(token);
  if (!u) return null;
  await q('UPDATE usuarios SET clave_hash = $2, invitacion_hash = NULL, invitacion_vence = NULL WHERE id = $1', [u.id, hashClave(clave)]);
  return u;
}
