// Lado del cliente del backoffice estándar (22-oct):
//   · «Solicitar a Síguelo» desde Configuración › Conexiones (y desde la marcha blanca): bandeja + correo + ticket en el CRM.
//   · Páginas públicas con enlace de un solo uso: /invitacion/:token (el administrador crea su clave) y /carga/:token
//     (certificado digital y CAF). Sin sesión: el enlace es la credencial, vence y sirve una vez.
import express from 'express';
import { q } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { crearSolicitud, TIPOS_SOLICITUD } from '../siguelo/solicitudes.js';
import { leerInvitacion, aceptarInvitacion } from '../siguelo/invitaciones.js';
import { leerEnlace, recibirCarga } from '../siguelo/carga.js';
import { limitar } from '../limite.js';

const r = express.Router();

r.get('/solicitudes', requiere('configuracion', 'ver'), async (req, res) => {
  res.json({ solicitudes: await q('SELECT id, tipo, detalle, estado, creado_en, resuelta_en, nota FROM solicitudes_siguelo WHERE empresa_id = $1 ORDER BY id DESC LIMIT 50', [req.empresaId]), tipos: TIPOS_SOLICITUD });
});

r.post('/solicitudes', requiere('configuracion', 'ver'), async (req, res) => {
  const b = req.body || {};
  if (!TIPOS_SOLICITUD[b.tipo]) throw new ErrorHttp(400, 'Elige qué necesitas', { campo: 'tipo' });
  const s = await crearSolicitud(req, { tipo: b.tipo, detalle: b.detalle });
  await registrar(req, 'solicitud_siguelo', 'solicitud', s.id, { tipo: s.tipo });
  res.json({ id: s.id, tipo: s.tipo, estado: s.estado, creado_en: s.creado_en });
});

// ── Invitación ──
// Enlaces públicos (el token es la credencial): límite por IP para que nadie los pruebe a ciegas (31-oct).
r.use(['/invitacion', '/carga'], limitar({ nombre: 'enlaces', max: 60, ventanaMs: 10 * 60e3 }), (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
r.get('/invitacion/:token', async (req, res) => {
  const u = await leerInvitacion(req.params.token);
  if (!u) throw new ErrorHttp(410, 'Esta invitación ya se usó o venció. Pide una nueva a Síguelo GPS.');
  res.json({ nombre: u.nombre, correo: u.correo, empresa: u.empresa, vence_en: u.invitacion_vence });
});
r.post('/invitacion/:token', async (req, res) => {
  const clave = String(req.body?.clave || '');
  if (clave.length < 10) throw new ErrorHttp(400, 'La clave debe tener al menos 10 caracteres.', { campo: 'clave' });
  const u = await aceptarInvitacion(req.params.token, clave);
  if (!u) throw new ErrorHttp(410, 'Esta invitación ya se usó o venció. Pide una nueva a Síguelo GPS.');
  await registrar({ usuario: u, empresaId: u.empresa_id, ip: req.ip }, 'invitacion_aceptada', 'usuario', u.id);
  res.json({ ok: true, correo: u.correo });
});

// ── Enlace de carga ──
r.get('/carga/:token', async (req, res) => {
  const c = await leerEnlace(req.params.token);
  if (!c) throw new ErrorHttp(410, 'Este enlace ya se usó o venció. Pide uno nuevo a Síguelo GPS.');
  res.json(c);
});
r.post('/carga/:token', async (req, res) => res.json(await recibirCarga(req.params.token, req.body || {})));

export default r;
