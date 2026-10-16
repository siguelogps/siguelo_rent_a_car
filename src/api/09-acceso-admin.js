// Entrada desde Síguelo Admin (admin.siguelogps.com): el panel manda un POST con un pase firmado que vale un minuto
// y sirve una sola vez. Se verifica con la clave pública del panel (sin secretos) y se abre la sesión del equipo
// Síguelo en el backoffice. Si la persona no existe todavía, se crea sin clave: solo entra por el panel.
//   nivel del panel admin → rol superadmin · usa / ve → rol soporte
import express from 'express';
import { q, uno } from '../db.js';
import { crearSesion } from '../auth.js';
import { registrar } from '../bitacora.js';
import { esSiguelo } from '../permisos.js';
import { config } from '../config.js';
import { crearAccesoAdmin } from '../acceso-admin.js';

const r = express.Router();
let verificar = null;
export const usarVerificador = (fn) => { verificar = fn; }; // pruebas
const pagina = (titulo, texto) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title><link rel="stylesheet" href="/app.css"></head><body><main class="login"><div class="caja"><img src="/img/logo-siguelo.png" alt="Síguelo GPS" style="height:40px;width:auto;align-self:flex-start"><h1 style="font-size:20px">${titulo}</h1><p class="muted">${texto}</p><a class="btn primario" href="${config.panelAdmin}">Volver a Síguelo Admin</a></div></main></body></html>`;
const limpio = (t) => String(t || '').replace(/[<>&"']/g, '');

export async function entradaDesdeAdmin(req, res) {
  verificar ??= crearAccesoAdmin({ panel: config.panelAdmin, herramienta: 'rentacar' });
  let p;
  try { p = await verificar(String(req.body?.pase || '')); }
  catch (e) { return res.status(401).type('html').send(pagina('No se pudo entrar', `${limpio(e.message)}. Vuelve a abrir Síguelo On Rent desde el panel.`)); }
  const correo = String(p.email || '').toLowerCase();
  const rol = p.nivel === 'admin' ? 'superadmin' : 'soporte';
  let u = await uno('SELECT * FROM usuarios WHERE lower(correo) = $1', [correo]);
  if (u && !esSiguelo(u.rol)) return res.status(403).type('html').send(pagina('Sin acceso', 'Ese correo es de un usuario de una empresa cliente. El panel solo abre el backoffice del equipo Síguelo.'));
  if (u && !u.activo) return res.status(403).type('html').send(pagina('Acceso desactivado', 'Tu usuario está desactivado en Síguelo On Rent.'));
  if (!u) {
    u = await uno('INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol) VALUES (NULL, $1, $2, NULL, $3) RETURNING *', [String(p.nombre || correo).slice(0, 80), correo, rol]);
  } else if (u.rol !== rol) {
    // El nivel lo decide el panel: si cambió allá, se refleja aquí.
    await q('UPDATE usuarios SET rol = $1 WHERE id = $2', [rol, u.id]);
    u = { ...u, rol };
  }
  await crearSesion(res, { ...u, empresa_id: null }, req.headers['user-agent']);
  await registrar({ usuario: u, empresaId: null, ip: req.ip }, 'ingreso', 'usuario', u.id, { via: 'Síguelo Admin', nivel: p.nivel });
  res.redirect(303, '/empresas');
}
// Dos direcciones: /api/acceso-admin y /acceso-admin (la ruta por defecto del panel), para que funcione con cualquiera.
r.post('/acceso-admin', entradaDesdeAdmin);

export default r;
