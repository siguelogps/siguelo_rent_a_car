// Cambio de estado de la reserva y del vehículo al entregar / recibir. La transición la valida el helper compartido
// cambiarEstado (src/reservas/estados.js); aquí se agregan km, combustible, sucursal y la lectura del GPS.
// Siempre dentro de una transacción: recibe `tx` y usa solo tx.query.
import { ErrorHttp } from '../auth.js';
import { cambiarEstado } from '../reservas/estados.js';

async function lecturaGps(tx, { empresaId, vehiculoId, reservaId, km, combustible, lat, lng }) {
  await tx.query('INSERT INTO gps_lecturas (empresa_id, vehiculo_id, reserva_id, km, combustible, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [empresaId, vehiculoId, reservaId, km, combustible, lat ?? null, lng ?? null]);
}

// Entrega (check-out): reserva confirmada → en_curso, vehículo → arrendado.
export async function aplicarEntrega(tx, { empresaId, reservaId, vehiculoId, km, combustible, lat, lng, usuario = null }) {
  const [act] = await tx.query('SELECT estado FROM reservas WHERE id = $1 AND empresa_id = $2', [reservaId, empresaId]);
  if (act?.estado !== 'confirmada') throw new ErrorHttp(409, 'La reserva ya no está confirmada: no se puede entregar.');
  await cambiarEstado(tx, { id: reservaId, empresa_id: empresaId }, 'en_curso', usuario);
  await tx.query(`UPDATE vehiculos SET estado = 'arrendado', km = GREATEST(km, $3), combustible_nivel = $4 WHERE id = $1 AND empresa_id = $2`,
    [vehiculoId, empresaId, km, combustible]);
  await lecturaGps(tx, { empresaId, vehiculoId, reservaId, km, combustible, lat, lng });
}

// Devolución (check-in): reserva en_curso → devuelta, vehículo → disponible (o en mantención si el patio lo marca).
export async function aplicarDevolucion(tx, { empresaId, reservaId, vehiculoId, km, combustible, lat, lng, mantencion = false, usuario = null }) {
  const [act] = await tx.query('SELECT estado FROM reservas WHERE id = $1 AND empresa_id = $2', [reservaId, empresaId]);
  if (act?.estado !== 'en_curso') throw new ErrorHttp(409, 'La reserva no está en curso: no se puede recibir.');
  const r = await cambiarEstado(tx, { id: reservaId, empresa_id: empresaId }, 'devuelta', usuario);
  // cambiarEstado deja el vehículo disponible o reservado (si tiene otro retiro dentro de 24 h); el patio puede mandarlo a mantención
  await tx.query(`UPDATE vehiculos SET estado = CASE WHEN $3 THEN 'mantencion' ELSE estado END, km = GREATEST(km, $4), combustible_nivel = $5, sucursal_id = COALESCE($6, sucursal_id)
    WHERE id = $1 AND empresa_id = $2`, [vehiculoId, empresaId, mantencion, km, combustible, r.sucursal_devolucion_id]);
  await lecturaGps(tx, { empresaId, vehiculoId, reservaId, km, combustible, lat, lng });
}
