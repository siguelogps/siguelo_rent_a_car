// Bitácora de acciones (quién hizo qué y cuándo). Se usa en todos los módulos para trazabilidad.
import { q } from './db.js';

export async function registrar(req, accion, entidad = null, entidadId = null, detalle = {}) {
  const u = req?.usuario;
  await q('INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req?.empresaId ?? detalle.empresaId ?? null, u?.id ?? null, accion, entidad, entidadId, JSON.stringify(detalle), req?.ip ?? null]);
}
