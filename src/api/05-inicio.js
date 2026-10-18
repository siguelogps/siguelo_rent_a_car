// Tablero de inicio: retiros y devoluciones de hoy, atrasos, ocupación y alertas de la flota.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere } from '../auth.js';
import { ocupacionHoy } from '../flota/comun.js';

const r = express.Router();
r.get('/inicio', requiere('inicio'), async (req, res) => {
  const E = req.empresaId;
  const hoy = `(now() AT TIME ZONE 'America/Santiago')::date`;
  const local = (c) => `(${c} AT TIME ZONE 'America/Santiago')::date`;
  const base = `SELECT r.id, r.folio, r.estado, r.inicio, r.fin, c.nombre || ' ' || coalesce(c.apellidos,'') AS cliente, c.telefono, v.patente, v.marca, v.modelo,
                sr.nombre AS sucursal_retiro, sd.nombre AS sucursal_devolucion
                FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
                LEFT JOIN sucursales sr ON sr.id = r.sucursal_retiro_id LEFT JOIN sucursales sd ON sd.id = r.sucursal_devolucion_id WHERE r.empresa_id = $1`;
  const [retiros, devoluciones, atrasadas, flota, cot, venc, alertas, multas] = await Promise.all([
    q(`${base} AND r.estado = 'confirmada' AND ${local('r.inicio')} = ${hoy} ORDER BY r.inicio`, [E]),
    q(`${base} AND r.estado = 'en_curso' AND ${local('r.fin')} = ${hoy} ORDER BY r.fin`, [E]),
    q(`${base} AND r.estado = 'en_curso' AND r.fin < now() ORDER BY r.fin`, [E]),
    uno(`SELECT count(*) FILTER (WHERE activo AND estado = 'disponible')::int AS disponibles, count(*) FILTER (WHERE activo AND estado IN ('mantencion','fuera_servicio'))::int AS taller
         FROM vehiculos WHERE empresa_id = $1`, [E]),
    uno(`SELECT count(*)::int AS n FROM reservas WHERE empresa_id = $1 AND estado = 'cotizacion' AND inicio > now()`, [E]),
    q(`SELECT id, patente, marca, modelo, x.tipo, x.fecha FROM vehiculos v,
         LATERAL (VALUES ('Revisión técnica', v.venc_revision_tecnica), ('Permiso de circulación', v.venc_permiso_circulacion), ('SOAP', v.venc_soap), ('Seguro', v.venc_seguro)) AS x(tipo, fecha)
       WHERE v.empresa_id = $1 AND v.activo AND x.fecha IS NOT NULL AND x.fecha <= ${hoy} + 30 ORDER BY x.fecha LIMIT 12`, [E]),
    q(`SELECT a.id, a.tipo, a.detalle, a.ocurrido_en, v.patente FROM gps_alertas a JOIN vehiculos v ON v.id = a.vehiculo_id WHERE a.empresa_id = $1 AND NOT a.atendida ORDER BY a.ocurrido_en DESC LIMIT 8`, [E]),
    uno(`SELECT count(*) FILTER (WHERE estado = 'sin_contrato')::int AS sin_contrato, count(*) FILTER (WHERE estado = 'asignada')::int AS por_notificar FROM multas WHERE empresa_id = $1`, [E])
  ]);
  const mant = await q(`SELECT id, patente, marca, modelo, coalesce(gps_km, km) AS km, mant_ultima_km + mant_cada_km AS proxima FROM vehiculos
      WHERE empresa_id = $1 AND activo AND mant_cada_km > 0 AND coalesce(gps_km, km) >= mant_ultima_km + mant_cada_km - 1000 ORDER BY (mant_ultima_km + mant_cada_km - coalesce(gps_km, km)) LIMIT 8`, [E]);
  // ocupación con la misma regla que Reservas (ocupacionHoy)
  Object.assign(flota, await ocupacionHoy(E));
  res.json({ retiros, devoluciones, atrasadas, flota, cotizaciones: cot.n, vencimientos: venc, mantenciones: mant, alertas, multas });
});
export default r;
