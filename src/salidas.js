// Bandeja de salida única para correo y WhatsApp. Todo envío queda registrado en la tabla «salidas».
// Si la empresa está en marcha blanca o la integración está apagada, el mensaje queda «retenida» y se puede
// revisar en Configuración › Bandeja de salida; al activar la integración se puede reenviar.
import nodemailer from 'nodemailer';
import { q, uno } from './db.js';
import { puedeActuar } from './integraciones/index.js';
import { leerArchivo } from './almacenamiento/index.js';

export function normalizarTelefono(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('9')) d = `56${d}`;
  if (d.length === 8) d = `569${d}`;
  if (d.length === 11 && d.startsWith('569')) return d;
  if (d.length >= 10 && d.length <= 15 && !d.startsWith('56')) return d;
  return null;
}

// Reemplaza {{variable}} y {{objeto.campo}} en una plantilla.
export const renderizar = (txt, datos) => String(txt || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
  const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), datos);
  return v == null ? '' : String(v);
});

export async function plantilla(empresaId, tipo, clave) {
  return uno('SELECT * FROM plantillas WHERE empresa_id = $1 AND tipo = $2 AND clave = $3 AND activa', [empresaId, tipo, clave]);
}

async function enviarCorreo(empresaId, conf, s) {
  const t = nodemailer.createTransport({ host: conf.host, port: Number(conf.puerto) || 587, secure: Number(conf.puerto) === 465, auth: { user: conf.usuario, pass: conf.clave } });
  const attachments = [];
  for (const a of s.adjuntos || []) {
    const r = await leerArchivo(empresaId, a.archivo_id);
    if (r) attachments.push({ filename: a.nombre || r.fila.nombre, content: r.datos, contentType: r.fila.mime });
  }
  const html = /<\w+[^>]*>/.test(s.cuerpo) ? s.cuerpo : `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-line">${s.cuerpo.replace(/</g, '&lt;')}</div>`;
  await t.sendMail({ from: conf.remitente || conf.usuario, to: s.destino, subject: s.asunto || '', html, attachments });
}

async function enviarWhatsapp(conf, s) {
  const to = normalizarTelefono(s.destino);
  if (!to) throw new Error(`El número «${s.destino}» no parece un celular válido`);
  // Para iniciar conversación Meta exige plantilla aprobada; el texto completo va como su única variable.
  const cuerpo = conf.plantilla
    ? { to, type: 'template', template: { name: conf.plantilla, language: { code: conf.idioma || 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: s.cuerpo.slice(0, 1000) }] }] } }
    : { to, type: 'text', text: { body: s.cuerpo.slice(0, 4000) } };
  const r = await fetch(`https://graph.facebook.com/v21.0/${conf.phone_id}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${conf.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }), signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`WhatsApp: ${j?.error?.message || r.status}`); }
}

// Encola y, si se puede, envía. Devuelve la fila de salidas.
export async function encolar({ empresaId, canal, destino, asunto = null, cuerpo, adjuntos = [], entidad = null, entidadId = null }) {
  if (!destino) return null;
  const [s] = await q(
    `INSERT INTO salidas (empresa_id, canal, destino, asunto, cuerpo, adjuntos, entidad, entidad_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [empresaId, canal, destino, asunto, cuerpo, JSON.stringify(adjuntos), entidad, entidadId]);
  return procesar(empresaId, s);
}

export async function procesar(empresaId, s) {
  const p = await puedeActuar(empresaId, canal2tipo(s.canal));
  if (!p.ok) {
    const [r] = await q(`UPDATE salidas SET estado = 'retenida', error = $2 WHERE id = $1 RETURNING *`, [s.id, p.motivo]);
    return r;
  }
  try {
    if (s.canal === 'correo') await enviarCorreo(empresaId, p.config, s);
    else await enviarWhatsapp(p.config, s);
    const [r] = await q(`UPDATE salidas SET estado = 'enviada', error = NULL, enviado_en = now() WHERE id = $1 RETURNING *`, [s.id]);
    return r;
  } catch (e) {
    const [r] = await q(`UPDATE salidas SET estado = 'error', error = $2 WHERE id = $1 RETURNING *`, [s.id, e.message.slice(0, 500)]);
    return r;
  }
}

const canal2tipo = (c) => (c === 'correo' ? 'correo' : 'whatsapp');

// Envía usando una plantilla de la empresa (correo y/o WhatsApp) — cómodo para los módulos.
export async function avisar({ empresaId, clave, datos, correo = null, telefono = null, adjuntos = [], entidad = null, entidadId = null }) {
  const out = [];
  if (correo) {
    const p = await plantilla(empresaId, 'correo', clave);
    if (p) out.push(await encolar({ empresaId, canal: 'correo', destino: correo, asunto: renderizar(p.asunto, datos), cuerpo: renderizar(p.cuerpo, datos), adjuntos, entidad, entidadId }));
  }
  if (telefono) {
    const p = await plantilla(empresaId, 'whatsapp', clave);
    if (p) out.push(await encolar({ empresaId, canal: 'whatsapp', destino: telefono, cuerpo: renderizar(p.cuerpo, datos), entidad, entidadId }));
  }
  return out;
}
