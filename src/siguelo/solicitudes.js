// «Solicitar a Síguelo» (22-oct, espec. Backoffice): el cliente pide activar o cambiar una conexión (o lo que sea).
// La solicitud queda en la bandeja «Solicitudes» del backoffice y en la bitácora del cliente, se avisa por correo al
// equipo y se abre un ticket en Síguelo Gestión (contrato en crm.js). Si el correo o el CRM fallan, la solicitud NO se
// pierde: queda en la bandeja con el motivo y el CRM se reintenta solo (tarea «solicitudes_crm»).
import { q, uno } from '../db.js';
import { config } from '../config.js';
import { enviarCorreoSiguelo } from './correo.js';
import { leerGeneral } from './conexiones.js';
import { enviarAlCrm } from './crm.js';
import { formatearRut } from '../util/rut.js';

export const TIPOS_SOLICITUD = {
  gps: 'Plataforma GPS', siguelo_os: 'Síguelo OS (TAG y multas)', facturacion: 'Facturación electrónica', folios: 'Más folios',
  correo: 'Correo de salida', whatsapp: 'WhatsApp', push: 'Avisos a la app', marcha_blanca: 'Terminar la marcha blanca', plan: 'Cambio de plan', otro: 'Otro'
};
// Tipo de integración (pantalla) → tipo de solicitud (contrato con el CRM)
export const TIPO_DE_INTEGRACION = { gps: 'gps', dashboard_siguelo: 'siguelo_os', simpleapi: 'facturacion', correo: 'correo', whatsapp: 'whatsapp', push: 'push' };

async function enviarTicket(s, e) {
  const r = await enviarAlCrm({
    id: `onrent-${s.id}`, empresa: { id: String(e.id), nombre: e.razon_social || e.nombre, rut: e.rut ? formatearRut(e.rut) : null },
    tipo: s.tipo, detalle: s.detalle || '', solicitante: { nombre: s.solicitante_nombre || null, correo: s.solicitante_correo || null },
    url_backoffice: `${config.urlBase}/empresas/${e.id}#actividad`
  });
  await q('UPDATE solicitudes_siguelo SET crm_estado = $2, crm_ticket = COALESCE($3, crm_ticket), crm_intentos = crm_intentos + 1 WHERE id = $1',
    [s.id, r.ok ? `ok${r.estado ? `: ${r.estado}` : ''}` : `pendiente: ${r.motivo}`, r.ok ? r.ticket : null]);
  return r;
}

export async function crearSolicitud(req, { tipo, detalle }) {
  const t = TIPOS_SOLICITUD[tipo] ? tipo : 'otro';
  const e = await uno('SELECT id, nombre, razon_social, rut FROM empresas WHERE id = $1', [req.empresaId]);
  const [s] = await q(`INSERT INTO solicitudes_siguelo (empresa_id, tipo, detalle, solicitante_id, solicitante_nombre, solicitante_correo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [e.id, t, String(detalle || '').trim().slice(0, 2000) || null, req.usuario.id, req.usuario.nombre, req.usuario.correo]);
  const aviso = (await leerGeneral('correo_siguelo')).config.aviso_equipo;
  const correo = aviso
    ? await enviarCorreoSiguelo({ para: aviso, responderA: req.usuario.correo, asunto: `On Rent · ${e.nombre} solicita: ${TIPOS_SOLICITUD[t]}`,
      texto: `${req.usuario.nombre} (${req.usuario.correo}) de ${e.nombre} pide: ${TIPOS_SOLICITUD[t]}.\n\n${s.detalle || 'Sin detalle.'}\n\nBandeja de solicitudes: ${config.urlBase}/solicitudes` })
    : { ok: false, motivo: 'Falta el correo del equipo en Conexiones generales' };
  await q('UPDATE solicitudes_siguelo SET correo_estado = $2 WHERE id = $1', [s.id, correo.ok ? 'enviado' : `pendiente: ${correo.motivo}`]);
  const crm = await enviarTicket(s, e);
  return { ...s, correo_estado: correo.ok ? 'enviado' : 'pendiente', crm_ticket: crm.ticket || null };
}

// Reintenta los tickets que no llegaron al CRM (máximo 10 intentos; el CRM es idempotente por id).
export async function reintentarCrm() {
  const pend = await q(`SELECT s.* FROM solicitudes_siguelo s WHERE (s.crm_estado IS NULL OR s.crm_estado LIKE 'pendiente%') AND s.crm_intentos < 10 AND s.creado_en > now() - interval '7 days' ORDER BY s.id LIMIT 20`);
  for (const s of pend) {
    const e = await uno('SELECT id, nombre, razon_social, rut FROM empresas WHERE id = $1', [s.empresa_id]);
    await enviarTicket(s, e);
  }
  return pend.length;
}
