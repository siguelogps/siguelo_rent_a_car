// Asignación automática de TAG y multas al contrato vigente en el momento del tránsito o la infracción.
// Período real de una reserva: [coalesce(retiro_real, inicio), coalesce(devolucion_real, fin)] con estado en
// (en_curso, devuelta, cerrada). Una reserva en curso que se atrasó sigue abierta hasta que se devuelva.
//  - TAG: hay reserva → «asignado» + reserva_id; no hay → «sin_contrato».
//  - Multa con hora exacta: igual que TAG → «asignada» + reserva_id + cliente_id.
//  - Multa con solo fecha (hora_conocida = false): una sola reserva toca ese día → «asignada»;
//    dos o más (devolución y siguiente retiro el mismo día) → «revisar» con las candidatas; ninguna → «sin_contrato».
// Solo se tocan registros pendientes (sin_contrato / revisar / asignados automáticamente y no avisados ni cobrados).
// La liquidación (otro módulo) cobra: tag_transitos (reserva_id, estado 'asignado') y multas (reserva_id, estado asignada/notificada).
import { q } from '../db.js';
import { desdeLocal } from '../util/formato.js';

const INICIO = 'coalesce(r.retiro_real, r.inicio)';
const FIN = `CASE WHEN r.estado = 'en_curso' THEN 'infinity'::timestamptz ELSE coalesce(r.devolucion_real, r.fin) END`;
const ESTADOS = `r.estado IN ('en_curso','devuelta','cerrada')`;

async function vehiculosPorPatente(empresaId) {
  const filas = await q('SELECT id, patente FROM vehiculos WHERE empresa_id = $1', [empresaId]);
  return new Map(filas.map((v) => [String(v.patente).toUpperCase().replace(/[^A-Z0-9]/g, ''), v.id]));
}

// Reservas cuyo período real contiene el instante
export function reservasEnInstante(empresaId, vehiculoId, instante) {
  return q(`SELECT r.id, r.folio, r.cliente_id, r.estado FROM reservas r
     WHERE r.empresa_id = $1 AND r.vehiculo_id = $2 AND ${ESTADOS} AND ${INICIO} <= $3 AND $3 <= ${FIN}
     ORDER BY ${INICIO} DESC`, [empresaId, vehiculoId, instante]);
}

// Reservas cuyo período real toca el día local (America/Santiago) de la fecha dada
export function reservasEnDia(empresaId, vehiculoId, instante) {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(instante));
  const desde = desdeLocal(dia, '00:00');
  const hasta = new Date(desdeLocal(dia, '23:59:59').getTime() + 1000);
  return q(`SELECT r.id, r.folio, r.cliente_id, r.estado, ${INICIO} AS desde, coalesce(r.devolucion_real, r.fin) AS hasta,
            trim(c.nombre || ' ' || coalesce(c.apellidos, '')) AS cliente
       FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id
      WHERE r.empresa_id = $1 AND r.vehiculo_id = $2 AND ${ESTADOS} AND ${INICIO} < $4 AND ${FIN} > $3
      ORDER BY ${INICIO}`, [empresaId, vehiculoId, desde, hasta]);
}

// Asigna los TAG indicados (o todos los pendientes). Devuelve { asignados, sin_contrato }.
export async function asignarTag(empresaId, ids = null) {
  const pat = await vehiculosPorPatente(empresaId);
  const filas = await q(`SELECT id, patente, fecha_hora FROM tag_transitos WHERE empresa_id = $1
      AND (estado = 'sin_contrato' OR (estado = 'asignado' AND asignacion = 'auto' AND notificado_en IS NULL))
      AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`, [empresaId, ids]);
  const res = { asignados: 0, sin_contrato: 0 };
  for (const t of filas) {
    const vehiculoId = pat.get(t.patente) || null;
    const [r] = vehiculoId ? await reservasEnInstante(empresaId, vehiculoId, t.fecha_hora) : [];
    await q(`UPDATE tag_transitos SET vehiculo_id = $3, reserva_id = $4, estado = $5, asignacion = 'auto' WHERE id = $1 AND empresa_id = $2`,
      [t.id, empresaId, vehiculoId, r?.id || null, r ? 'asignado' : 'sin_contrato']);
    res[r ? 'asignados' : 'sin_contrato']++;
  }
  return res;
}

// Decide la asignación de una multa (sin guardar) → { estado, reserva, candidatos }
export async function decidirMulta(empresaId, vehiculoId, fecha, horaConocida) {
  if (!vehiculoId) return { estado: 'sin_contrato', reserva: null, candidatos: null };
  if (horaConocida) {
    const [r] = await reservasEnInstante(empresaId, vehiculoId, fecha);
    return r ? { estado: 'asignada', reserva: r, candidatos: null } : { estado: 'sin_contrato', reserva: null, candidatos: null };
  }
  const rs = await reservasEnDia(empresaId, vehiculoId, fecha);
  if (rs.length === 1) return { estado: 'asignada', reserva: rs[0], candidatos: null };
  if (rs.length > 1) return { estado: 'revisar', reserva: null, candidatos: rs.map((r) => ({ reserva_id: r.id, folio: r.folio, cliente_id: r.cliente_id, cliente: r.cliente, desde: r.desde, hasta: r.hasta })) };
  return { estado: 'sin_contrato', reserva: null, candidatos: null };
}

export async function asignarMultas(empresaId, ids = null) {
  const pat = await vehiculosPorPatente(empresaId);
  const filas = await q(`SELECT id, patente, fecha_infraccion, hora_conocida FROM multas WHERE empresa_id = $1
      AND (estado IN ('sin_contrato','revisar') OR (estado = 'asignada' AND asignacion = 'auto'))
      AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`, [empresaId, ids]);
  const res = { asignadas: 0, revisar: 0, sin_contrato: 0 };
  for (const m of filas) {
    const vehiculoId = pat.get(m.patente) || null;
    const d = await decidirMulta(empresaId, vehiculoId, m.fecha_infraccion, m.hora_conocida);
    await q(`UPDATE multas SET vehiculo_id = $3, reserva_id = $4, cliente_id = $5, estado = $6, candidatos = $7, asignacion = 'auto' WHERE id = $1 AND empresa_id = $2`,
      [m.id, empresaId, vehiculoId, d.reserva?.id || null, d.reserva?.cliente_id || null, d.estado, d.candidatos ? JSON.stringify(d.candidatos) : null]);
    res[d.estado === 'asignada' ? 'asignadas' : d.estado]++;
  }
  return res;
}

// Asignación manual (o quitar asignación con reservaId = null). Valida que la reserva sea del mismo vehículo y empresa.
export async function asignarManual(empresaId, tabla, id, reservaId) {
  const t = tabla === 'tag' ? 'tag_transitos' : 'multas';
  const [item] = await q(`SELECT * FROM ${t} WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
  if (!item) return { error: 'Registro no encontrado', estado: 404 };
  if (['cobrado', 'cobrada', 'pagada'].includes(item.estado)) return { error: 'Ya fue cobrado: no se puede reasignar', estado: 409 };
  let r = null;
  if (reservaId) {
    [r] = await q(`SELECT r.id, r.cliente_id, r.vehiculo_id, v.patente FROM reservas r LEFT JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = $1 AND r.empresa_id = $2`, [reservaId, empresaId]);
    if (!r) return { error: 'Reserva no encontrada', estado: 404 };
  }
  if (t === 'tag_transitos') {
    const [f] = await q(`UPDATE tag_transitos SET reserva_id = $3, vehiculo_id = coalesce($4, vehiculo_id), estado = $5, asignacion = 'manual' WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [id, empresaId, r?.id || null, r?.vehiculo_id || null, r ? 'asignado' : 'sin_contrato']);
    return { fila: f, anterior: item };
  }
  const [f] = await q(`UPDATE multas SET reserva_id = $3, cliente_id = $4, vehiculo_id = coalesce($5, vehiculo_id), estado = $6, candidatos = NULL, asignacion = 'manual', notificada_en = NULL WHERE id = $1 AND empresa_id = $2 RETURNING *`,
    [id, empresaId, r?.id || null, r?.cliente_id || null, r?.vehiculo_id || null, r ? 'asignada' : 'sin_contrato']);
  return { fila: f, anterior: item };
}
