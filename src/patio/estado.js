// Cambio de estado de la reserva y del vehículo al entregar / recibir (versión mínima local del módulo de patio).
// Cuando exista el helper compartido src/reservas/estados.js (cambiarEstado) se puede delegar en él.
// Siempre dentro de una transacción: recibe `tx` y usa solo tx.query.
import { ErrorHttp } from '../auth.js';

async function lecturaGps(tx, { empresaId, vehiculoId, reservaId, km, combustible, lat, lng }) {
  await tx.query('INSERT INTO gps_lecturas (empresa_id, vehiculo_id, reserva_id, km, combustible, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [empresaId, vehiculoId, reservaId, km, combustible, lat ?? null, lng ?? null]);
}

// Entrega (check-out): reserva confirmada → en_curso, vehículo → arrendado.
export async function aplicarEntrega(tx, { empresaId, reservaId, vehiculoId, km, combustible, lat, lng }) {
  const r = await tx.query(`UPDATE reservas SET estado = 'en_curso', retiro_real = now(), actualizado_en = now()
    WHERE id = $1 AND empresa_id = $2 AND estado = 'confirmada' RETURNING id`, [reservaId, empresaId]);
  if (!r.length) throw new ErrorHttp(409, 'La reserva ya no está confirmada: no se puede entregar.');
  await tx.query(`UPDATE vehiculos SET estado = 'arrendado', km = GREATEST(km, $3), combustible_nivel = $4 WHERE id = $1 AND empresa_id = $2`,
    [vehiculoId, empresaId, km, combustible]);
  await lecturaGps(tx, { empresaId, vehiculoId, reservaId, km, combustible, lat, lng });
}

// Devolución (check-in): reserva en_curso → devuelta, vehículo → disponible (o en mantención si el patio lo marca).
export async function aplicarDevolucion(tx, { empresaId, reservaId, vehiculoId, km, combustible, lat, lng, mantencion = false }) {
  const r = await tx.query(`UPDATE reservas SET estado = 'devuelta', devolucion_real = now(), actualizado_en = now()
    WHERE id = $1 AND empresa_id = $2 AND estado = 'en_curso' RETURNING sucursal_devolucion_id`, [reservaId, empresaId]);
  if (!r.length) throw new ErrorHttp(409, 'La reserva no está en curso: no se puede recibir.');
  await tx.query(`UPDATE vehiculos SET estado = $3, km = GREATEST(km, $4), combustible_nivel = $5, sucursal_id = COALESCE($6, sucursal_id)
    WHERE id = $1 AND empresa_id = $2`, [vehiculoId, empresaId, mantencion ? 'mantencion' : 'disponible', km, combustible, r[0].sucursal_devolucion_id]);
  await lecturaGps(tx, { empresaId, vehiculoId, reservaId, km, combustible, lat, lng });
}
