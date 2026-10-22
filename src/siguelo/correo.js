// Correo que sale por el servidor de Síguelo (Conexiones generales › Correo de Síguelo).
// Lo usan: los avisos al equipo («Solicitar a Síguelo»), las invitaciones al primer administrador, los enlaces de carga
// del certificado y los CAF, y los correos de los clientes configurados «por el servidor de Síguelo» con su nombre.
// No pasa por la marcha blanca del cliente: estos correos son de Síguelo (los del cliente a SUS clientes sí, en salidas.js).
import nodemailer from 'nodemailer';
import { leerGeneral } from './conexiones.js';

let transporteFalso = null;
/** Solo para las pruebas: reemplaza el envío real (recibe el mensaje armado). */
export const _usarTransporte = (fn) => { transporteFalso = fn; };

export async function correoSigueloListo() {
  return (await leerGeneral('correo_siguelo')).lista;
}

// { para, asunto, html | texto, nombreRemitente, responderA, adjuntos } → { ok, motivo }
export async function enviarCorreoSiguelo({ para, asunto, html = null, texto = null, nombreRemitente = 'Síguelo GPS', responderA = null, adjuntos = [] }) {
  const { config: c, lista } = await leerGeneral('correo_siguelo');
  const destino = Array.isArray(para) ? para.filter(Boolean).join(', ') : para;
  if (!destino) return { ok: false, motivo: 'Sin destinatario' };
  if (!lista && !transporteFalso) return { ok: false, motivo: 'El correo de Síguelo no está configurado (Conexiones generales)' };
  const direccion = c.remitente || c.usuario || 'no-responder@siguelogps.com';
  const limpio = String(nombreRemitente || 'Síguelo GPS').replace(/["<>\r\n]/g, '').slice(0, 80);
  const cuerpo = html || `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-line">${String(texto || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`;
  const msj = { from: `"${limpio}" <${direccion}>`, to: destino, subject: asunto, html: cuerpo, ...(responderA ? { replyTo: responderA } : {}), attachments: adjuntos };
  try {
    if (transporteFalso) await transporteFalso(msj);
    else {
      const t = nodemailer.createTransport({ host: c.host, port: Number(c.puerto) || 587, secure: Number(c.puerto) === 465, auth: { user: c.usuario || direccion, pass: c.clave } });
      await t.sendMail(msj);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: String(e.message || e).slice(0, 300) };
  }
}
