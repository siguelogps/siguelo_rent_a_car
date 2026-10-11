// Estados de la reserva y sus transiciones. Lo usan reservas (confirmar, cancelar, no se presentó),
// patio (en_curso al entregar, devuelta al recibir) y liquidaciones (cerrada).
// Siempre dentro de una transacción: cambiarEstado(tx, reserva, estado, usuario, { motivo }).
import { ErrorHttp } from '../auth.js';
import { conflictos } from '../disponibilidad.js';
import { siguienteFolio } from '../db.js';

export const ESTADOS = ['cotizacion', 'confirmada', 'en_curso', 'devuelta', 'cerrada', 'cancelada', 'no_show'];
export const NOMBRES = { cotizacion: 'Cotización', confirmada: 'Confirmada', en_curso: 'En curso', devuelta: 'Devuelta', cerrada: 'Cerrada', cancelada: 'Cancelada', no_show: 'No se presentó' };

// Transiciones válidas (todas). Las que el counter hace a mano desde la ficha están en MANUALES.
export const TRANSICIONES = {
  cotizacion: ['confirmada', 'cancelada'],
  confirmada: ['en_curso', 'cancelada', 'no_show'],
  en_curso: ['devuelta'],
  devuelta: ['cerrada', 'en_curso'],   // en_curso: se reabre si la devolución se registró por error
  cerrada: [],
  cancelada: [],
  no_show: []
};
export const MANUALES = { cotizacion: ['confirmada', 'cancelada'], confirmada: ['cancelada', 'no_show'] };

export const puedePasar = (de, a) => (TRANSICIONES[de] || []).includes(a);

const HORAS_RESERVADO = 24; // el vehículo se marca «reservado» si el retiro es dentro de 24 h

/**
 * Recalcula vehiculos.estado según sus reservas: en curso → arrendado; retiro confirmado dentro de 24 h → reservado;
 * si no, disponible. No toca vehículos en mantención o fuera de servicio.
 */
export async function recalcularEstadoVehiculo(tx, empresaId, vehiculoId) {
  if (!vehiculoId) return null;
  const [v] = await tx.query('SELECT id, estado FROM vehiculos WHERE id = $1 AND empresa_id = $2', [vehiculoId, empresaId]);
  if (!v || !['disponible', 'arrendado', 'reservado'].includes(v.estado)) return v?.estado ?? null;
  const [r] = await tx.query(
    `SELECT count(*) FILTER (WHERE estado = 'en_curso')::int AS en_curso,
            count(*) FILTER (WHERE estado = 'confirmada' AND inicio <= now() + interval '${HORAS_RESERVADO} hours' AND fin > now())::int AS proximas
       FROM reservas WHERE empresa_id = $1 AND vehiculo_id = $2`, [empresaId, vehiculoId]);
  const nuevo = r.en_curso ? 'arrendado' : r.proximas ? 'reservado' : 'disponible';
  if (nuevo !== v.estado) await tx.query('UPDATE vehiculos SET estado = $3 WHERE id = $1 AND empresa_id = $2', [vehiculoId, empresaId, nuevo]);
  return nuevo;
}

/**
 * Cambia el estado de una reserva validando la transición y deja el vehículo consistente.
 * - confirmada: revisa que el vehículo siga libre (con el vehículo bloqueado FOR UPDATE); si venía de cotización,
 *   le asigna un folio R nuevo y guarda el folio C en las notas. Vehículo «reservado» solo si el retiro es dentro de 24 h.
 * - en_curso: vehículo «arrendado» y retiro_real = ahora (si no estaba).
 * - devuelta: devolucion_real = ahora (si no estaba). devuelta/cerrada/cancelada/no_show: vehículo «disponible» si no hay otra en curso.
 * @param tx       transacción de db.transaccion
 * @param reserva  fila de reservas (o { id, empresa_id })
 * @param estado   estado destino
 * @param usuario  req.usuario (o { id }) para la bitácora; puede ser null (procesos automáticos o portal)
 * @returns la reserva actualizada
 */
export async function cambiarEstado(tx, reserva, estado, usuario = null, { motivo = null, ip = null } = {}) {
  if (!ESTADOS.includes(estado)) throw new ErrorHttp(400, 'Estado desconocido');
  const [r] = await tx.query('SELECT * FROM reservas WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [reserva.id, reserva.empresa_id]);
  if (!r) throw new ErrorHttp(404, 'Reserva no encontrada');
  if (r.estado === estado) return r;
  if (!puedePasar(r.estado, estado)) throw new ErrorHttp(409, `Una reserva «${NOMBRES[r.estado]}» no puede pasar a «${NOMBRES[estado]}».`);
  if (estado === 'cancelada' && !String(motivo || '').trim()) {
    throw new ErrorHttp(400, 'Indica el motivo de la cancelación', { campo: 'motivo' });
  }

  const sets = ['estado = $3', 'actualizado_en = now()'];
  const vals = [r.id, r.empresa_id, estado];
  const add = (sql, v) => { vals.push(v); sets.push(sql.replace('?', `$${vals.length}`)); };

  if (estado === 'confirmada') {
    if (!r.cliente_id) throw new ErrorHttp(400, 'La reserva no tiene cliente');
    const [cli] = await tx.query('SELECT lista_negra, lista_negra_motivo FROM clientes WHERE id = $1 AND empresa_id = $2', [r.cliente_id, r.empresa_id]);
    if (cli?.lista_negra) throw new ErrorHttp(409, `El cliente está en lista negra: ${cli.lista_negra_motivo || 'sin motivo registrado'}`);
    if (r.vehiculo_id) {
      await tx.query('SELECT id FROM vehiculos WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [r.vehiculo_id, r.empresa_id]);
      const c = await conflictos(r.empresa_id, r.vehiculo_id, r.inicio, r.fin, { excluirReservaId: r.id, cx: tx });
      if (c.length) throw new ErrorHttp(409, c[0].tipo === 'reserva' ? `El vehículo ya está tomado por la reserva ${c[0].folio}` : `El vehículo está bloqueado: ${c[0].motivo}`, { conflicto: c[0].folio || c[0].motivo });
    }
    if (r.estado === 'cotizacion' && r.folio.startsWith('C-')) {
      const folio = await siguienteFolio(r.empresa_id, 'R', tx);
      add('folio = ?', folio);
      add('notas = ?', [r.notas, `Cotización original ${r.folio}`].filter(Boolean).join('\n'));
    }
  }
  if (estado === 'cancelada' || estado === 'no_show') add('motivo_cancelacion = ?', motivo || (estado === 'no_show' ? 'El cliente no se presentó' : null));
  if (estado === 'en_curso') sets.push('retiro_real = coalesce(retiro_real, now())');
  if (estado === 'devuelta') sets.push('devolucion_real = coalesce(devolucion_real, now())');

  const [nueva] = await tx.query(`UPDATE reservas SET ${sets.join(', ')} WHERE id = $1 AND empresa_id = $2 RETURNING *`, vals);

  // Vehículo
  if (r.vehiculo_id) {
    if (estado === 'en_curso') {
      await tx.query(`UPDATE vehiculos SET estado = 'arrendado' WHERE id = $1 AND empresa_id = $2 AND estado IN ('disponible','reservado','arrendado')`, [r.vehiculo_id, r.empresa_id]);
    } else {
      await recalcularEstadoVehiculo(tx, r.empresa_id, r.vehiculo_id);
    }
  }

  await tx.query('INSERT INTO bitacora (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [r.empresa_id, usuario?.id ?? null, `reserva_${estado}`, 'reserva', r.id, JSON.stringify({ de: r.estado, a: estado, motivo, folio: nueva.folio, ...(nueva.folio !== r.folio ? { folio_anterior: r.folio } : {}) }), ip]);
  return nueva;
}
