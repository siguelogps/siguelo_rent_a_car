// Superadmin de Síguelo definido por el servidor (variables SUPERADMIN_CORREO y SUPERADMIN_CLAVE):
// al arrancar se asegura que ese correo exista como superadmin. La clave solo se usa al crearlo
// (después se cambia desde «Mi cuenta»). Si hay un superadmin configurado, se desactiva el de la demo.
import { q, uno } from './db.js';
import { hashClave } from './auth.js';

const DEMO = 'soporte@siguelogps.cl';

export async function asegurarSuperadmin() {
  const correo = String(process.env.SUPERADMIN_CORREO || '').trim().toLowerCase();
  if (!correo) return null;
  const u = await uno('SELECT id, rol, activo FROM usuarios WHERE lower(correo) = $1', [correo]);
  if (u) {
    if (u.rol !== 'superadmin' || !u.activo) await q(`UPDATE usuarios SET rol = 'superadmin', empresa_id = NULL, activo = TRUE WHERE id = $1`, [u.id]);
  } else {
    const clave = process.env.SUPERADMIN_CLAVE;
    if (!clave || clave.length < 10) { console.error(`SUPERADMIN_CORREO=${correo} no existe y falta SUPERADMIN_CLAVE (mínimo 10 caracteres) para crearlo.`); return null; }
    await q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol) VALUES (NULL, $1, $2, $3, 'superadmin')`,
      [process.env.SUPERADMIN_NOMBRE || correo.split('@')[0].replace(/^./, (c) => c.toUpperCase()), correo, hashClave(clave)]);
    console.log(`Superadmin creado: ${correo}`);
  }
  if (correo !== DEMO) await q(`UPDATE usuarios SET activo = FALSE WHERE lower(correo) = $1 AND rol = 'superadmin'`, [DEMO]);
  return correo;
}
