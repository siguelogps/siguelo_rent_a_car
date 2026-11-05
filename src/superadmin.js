// Superadmin de Síguelo definido por el servidor (variables SUPERADMIN_CORREO y SUPERADMIN_CLAVE):
// al arrancar se asegura que ese correo exista como superadmin y esté activo.
// SUPERADMIN_CLAVE se aplica al crearlo y cada vez que su valor cambie en el servidor (sirve para recuperar el
// acceso); si no cambia, se respeta la clave que la persona eligió en «Mi cuenta».
// Si hay un superadmin configurado, se desactiva el de la demo.
import { q, uno } from './db.js';
import { hashClave } from './auth.js';
import { hashSha256 } from './cifrado.js';

const DEMO = 'soporte@siguelogps.cl';

// 5-nov (RNT-03): sin SUPERADMIN_CORREO el superadmin demo no se desactiva. No se apaga desde aquí (si hoy es la única
// entrada del equipo Síguelo a una instalación, dejaría a todos afuera); en producción se avisa en el registro para que se
// defina SUPERADMIN_CORREO/SUPERADMIN_CLAVE, y entonces se desactiva solo en el arranque siguiente.
export const AVISO_SUPERADMIN_DEMO = `El superadmin demo ${DEMO} está activo en producción y no hay SUPERADMIN_CORREO: define SUPERADMIN_CORREO y SUPERADMIN_CLAVE en el servicio para desactivarlo.`;

export async function asegurarSuperadmin({ produccion = process.env.NODE_ENV === 'production', log = console } = {}) {
  const correo = String(process.env.SUPERADMIN_CORREO || '').trim().toLowerCase();
  if (!correo) {
    if (produccion && (await uno(`SELECT 1 AS si FROM usuarios WHERE lower(correo) = $1 AND rol = 'superadmin' AND activo`, [DEMO]))) { log.error(AVISO_SUPERADMIN_DEMO); return { aviso: AVISO_SUPERADMIN_DEMO }; }
    return null;
  }
  const u = await uno('SELECT id, rol, activo FROM usuarios WHERE lower(correo) = $1', [correo]);
  const clave = process.env.SUPERADMIN_CLAVE || '';
  const huella = clave ? hashSha256(`superadmin:${correo}:${clave}`) : null;
  const anterior = (await uno(`SELECT valor FROM sistema WHERE clave = 'superadmin_clave_aplicada'`))?.valor || null;
  if (u) {
    if (u.rol !== 'superadmin' || !u.activo) await q(`UPDATE usuarios SET rol = 'superadmin', empresa_id = NULL, activo = TRUE WHERE id = $1`, [u.id]);
    if (huella && huella !== anterior) {
      if (clave.length < 10) console.error('SUPERADMIN_CLAVE debe tener al menos 10 caracteres: no se aplicó.');
      else {
        await q('UPDATE usuarios SET clave_hash = $2 WHERE id = $1', [u.id, hashClave(clave)]);
        await q('DELETE FROM sesiones WHERE usuario_id = $1', [u.id]);
        console.log(`Clave del superadmin ${correo} actualizada desde SUPERADMIN_CLAVE.`);
      }
    }
  } else {
    const clave = process.env.SUPERADMIN_CLAVE;
    if (!clave || clave.length < 10) { console.error(`SUPERADMIN_CORREO=${correo} no existe y falta SUPERADMIN_CLAVE (mínimo 10 caracteres) para crearlo.`); return null; }
    await q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol) VALUES (NULL, $1, $2, $3, 'superadmin')`,
      [process.env.SUPERADMIN_NOMBRE || correo.split('@')[0].replace(/^./, (c) => c.toUpperCase()), correo, hashClave(clave)]);
    console.log(`Superadmin creado: ${correo}`);
  }
  if (huella && huella !== anterior && clave.length >= 10) {
    await q(`INSERT INTO sistema (clave, valor) VALUES ('superadmin_clave_aplicada', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [huella]);
  }
  if (correo !== DEMO) await q(`UPDATE usuarios SET activo = FALSE WHERE lower(correo) = $1 AND rol = 'superadmin'`, [DEMO]);
  return correo;
}
