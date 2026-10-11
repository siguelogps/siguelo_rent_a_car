// Liquidación al inversionista (propietario de vehículos): ingresos del mes de sus vehículos × porcentaje − costos de mantención.
import { q, uno } from '../db.js';

const LOCAL = (c) => `(${c} AT TIME ZONE 'America/Santiago')`;

export const mesActual = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7);
export const mesValido = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')) ? m : mesActual());

// → { propietario, mes, vehiculos:[{id, patente, marca, modelo, reservas, ingresos, costo_mantencion, ordenes}], ingresos, porcentaje, participacion, costos, a_pagar }
export async function liquidacionPropietario(empresaId, propietarioId, mes) {
  mes = mesValido(mes);
  const p = await uno('SELECT * FROM propietarios WHERE id = $1 AND empresa_id = $2', [propietarioId, empresaId]);
  if (!p) return null;
  const desde = `${mes}-01`;
  const vehiculos = await q(`
    SELECT v.id, v.patente, v.marca, v.modelo, v.anio,
      coalesce(ing.n, 0)::int AS reservas, coalesce(ing.total, 0)::bigint AS ingresos,
      coalesce(m.n, 0)::int AS ordenes, coalesce(m.costo, 0)::bigint AS costo_mantencion
    FROM vehiculos v
    LEFT JOIN LATERAL (SELECT count(*) AS n, sum(r.total) AS total FROM reservas r
       WHERE r.empresa_id = v.empresa_id AND r.vehiculo_id = v.id AND r.estado IN ('devuelta','cerrada')
         AND ${LOCAL('coalesce(r.devolucion_real, r.fin)')} >= $3::date AND ${LOCAL('coalesce(r.devolucion_real, r.fin)')} < ($3::date + interval '1 month')) ing ON true
    LEFT JOIN LATERAL (SELECT count(*) AS n, sum(o.costo) AS costo FROM ordenes_trabajo o
       WHERE o.empresa_id = v.empresa_id AND o.vehiculo_id = v.id AND o.estado = 'terminada'
         AND ${LOCAL('coalesce(o.fin, o.creado_en)')} >= $3::date AND ${LOCAL('coalesce(o.fin, o.creado_en)')} < ($3::date + interval '1 month')) m ON true
    WHERE v.empresa_id = $1 AND v.propietario_id = $2
    ORDER BY v.patente`, [empresaId, propietarioId, desde]);
  const ingresos = vehiculos.reduce((s, v) => s + v.ingresos, 0);
  const costos = vehiculos.reduce((s, v) => s + v.costo_mantencion, 0);
  const participacion = Math.round(ingresos * Number(p.porcentaje) / 100);
  return { propietario: p, mes, vehiculos, ingresos, porcentaje: Number(p.porcentaje), participacion, costos, a_pagar: participacion - costos };
}
