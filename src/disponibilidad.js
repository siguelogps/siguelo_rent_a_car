// Disponibilidad sin dobles reservas: un vehículo está ocupado si tiene una reserva confirmada o en curso que se
// cruce con el período, o un bloqueo (mantención). Las cotizaciones no bloquean. Se usa dentro de una transacción
// con el vehículo bloqueado (SELECT … FOR UPDATE) para que dos counters no tomen el mismo auto a la vez.
import { q } from './db.js';

export const ESTADOS_QUE_OCUPAN = ['confirmada', 'en_curso'];
const MARGEN_MS = 60 * 60e3; // 1 h entre devolución y siguiente retiro (lavado, revisión)

export async function conflictos(empresaId, vehiculoId, inicio, fin, { excluirReservaId = null, cx = null, margenMs = MARGEN_MS } = {}) {
  const ej = cx || { query: q };
  const ini = new Date(new Date(inicio).getTime() - margenMs), f = new Date(new Date(fin).getTime() + margenMs);
  const reservas = await ej.query(
    `SELECT id, folio, estado, inicio, fin FROM reservas
      WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado = ANY($3) AND ($4::bigint IS NULL OR id <> $4)
        AND inicio < $6 AND fin > $5`, [empresaId, vehiculoId, ESTADOS_QUE_OCUPAN, excluirReservaId, ini, f]);
  const bloqueos = await ej.query(
    `SELECT id, motivo, inicio, fin FROM bloqueos WHERE empresa_id = $1 AND vehiculo_id = $2 AND inicio < $4 AND fin > $3`,
    [empresaId, vehiculoId, inicio, fin]);
  return [...reservas.map((r) => ({ tipo: 'reserva', ...r })), ...bloqueos.map((b) => ({ tipo: 'bloqueo', ...b }))];
}

export async function vehiculosDisponibles(empresaId, { inicio, fin, categoriaId = null, excluirReservaId = null, cx = null } = {}) {
  const ej = cx || { query: q };
  return ej.query(
    `SELECT v.* FROM vehiculos v
      WHERE v.empresa_id = $1 AND v.activo AND v.estado <> 'fuera_servicio' AND ($2::bigint IS NULL OR v.categoria_id = $2)
        AND NOT EXISTS (SELECT 1 FROM reservas r WHERE r.empresa_id = v.empresa_id AND r.vehiculo_id = v.id AND r.estado = ANY($3)
                         AND ($6::bigint IS NULL OR r.id <> $6) AND r.inicio < $5::timestamptz + interval '1 hour' AND r.fin > $4::timestamptz - interval '1 hour')
        AND NOT EXISTS (SELECT 1 FROM bloqueos b WHERE b.empresa_id = v.empresa_id AND b.vehiculo_id = v.id AND b.inicio < $5 AND b.fin > $4)
        AND (v.venc_revision_tecnica IS NULL OR v.venc_revision_tecnica >= ($5::timestamptz)::date)
      ORDER BY v.km`, [empresaId, categoriaId, ESTADOS_QUE_OCUPAN, inicio, fin, excluirReservaId]);
}
