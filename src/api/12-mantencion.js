// Mantención: órdenes de trabajo (programada → en_taller → terminada / anulada), bloqueo del vehículo en el calendario
// mientras está en taller, mantenciones sugeridas por km (plataforma GPS) y por fecha, y alerta diaria de vencimientos.
import express from 'express';
import { q, uno, transaccion, siguienteFolio } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { conflictos } from '../disponibilidad.js';
import { lecturaActual } from '../gps/index.js';
import { registrarTarea } from '../tareas.js';
import { desdeLocal, aIsoFecha, fecha as fmtFecha, miles } from '../util/formato.js';
import { formatearPatente } from '../util/patente.js';
import { limpiar, sqlUpdate, deLaEmpresa, mantencion, hoyIso, diasHasta, HOY_SQL, VENCIMIENTOS } from '../flota/comun.js';

const r = express.Router();
const ver = requiere('mantencion', 'ver'), editar = requiere('mantencion', 'editar');

export const TIPOS_OT = { preventiva: 'Preventiva', correctiva: 'Correctiva', revision_tecnica: 'Revisión técnica', neumaticos: 'Neumáticos', otro: 'Otro' };
const CAMPOS_OT = { vehiculo_id: 'id', tipo: 'texto', motivo: 'texto', km_programado: 'entero', fecha_programada: 'fecha', taller: 'texto', costo: 'monto', notas: 'texto', incidente_id: 'id' };
const DIAS_TALLER_DEFECTO = 2;

const SELECT_OT = `SELECT o.*, v.patente, v.marca, v.modelo, v.anio, coalesce(v.gps_km, v.km) AS km_actual, v.estado AS vehiculo_estado,
    c.nombre AS categoria, u.nombre AS creado_por_nombre, i.folio AS incidente_folio,
    (SELECT b.fin FROM bloqueos b WHERE b.orden_trabajo_id = o.id AND b.empresa_id = o.empresa_id ORDER BY b.id DESC LIMIT 1) AS bloqueo_fin
  FROM ordenes_trabajo o JOIN vehiculos v ON v.id = o.vehiculo_id LEFT JOIN categorias c ON c.id = v.categoria_id
  LEFT JOIN usuarios u ON u.id = o.creado_por LEFT JOIN incidentes i ON i.id = o.incidente_id`;

r.get('/ordenes-trabajo', ver, async (req, res) => {
  const { estado, vehiculo_id, tipo } = req.query;
  res.json(await q(`${SELECT_OT} WHERE o.empresa_id = $1 AND ($2::text IS NULL OR o.estado = $2) AND ($3::bigint IS NULL OR o.vehiculo_id = $3) AND ($4::text IS NULL OR o.tipo = $4)
    ORDER BY CASE o.estado WHEN 'en_taller' THEN 0 WHEN 'programada' THEN 1 ELSE 2 END, coalesce(o.fin, o.inicio, o.fecha_programada::timestamptz, o.creado_en) DESC LIMIT 300`,
  [req.empresaId, estado || null, Number(vehiculo_id) || null, tipo || null]));
});

r.get('/ordenes-trabajo/:id', ver, async (req, res) => {
  const ot = await uno(`${SELECT_OT} WHERE o.empresa_id = $1 AND o.id = $2`, [req.empresaId, Number(req.params.id)]);
  if (!ot) throw new ErrorHttp(404, 'Orden de trabajo no encontrada');
  res.json(ot);
});

function validarOt(d, nuevo) {
  if (nuevo) { if (!d.vehiculo_id) throw new ErrorHttp(400, 'Elige el vehículo.', { campo: 'vehiculo_id' }); if (!d.motivo) throw new ErrorHttp(400, 'Describe el trabajo a realizar.', { campo: 'motivo' }); }
  if ('motivo' in d && !d.motivo) throw new ErrorHttp(400, 'Describe el trabajo a realizar.', { campo: 'motivo' });
  if (d.tipo != null && !TIPOS_OT[d.tipo]) throw new ErrorHttp(400, 'Tipo de orden no válido.', { campo: 'tipo' });
  return d;
}

r.post('/ordenes-trabajo', editar, async (req, res) => {
  const E = req.empresaId;
  const d = validarOt(limpiar(req.body, CAMPOS_OT), true);
  const v = await deLaEmpresa('vehiculos', d.vehiculo_id, E, 'vehículo');
  if (d.incidente_id) await deLaEmpresa('incidentes', d.incidente_id, E, 'incidente');
  const ot = await transaccion(async (tx) => {
    const folio = await siguienteFolio(E, 'OT', tx);
    const [o] = await tx.query(`INSERT INTO ordenes_trabajo (empresa_id, folio, vehiculo_id, tipo, motivo, km_programado, fecha_programada, taller, costo, notas, incidente_id, creado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [E, folio, v.id, d.tipo || 'preventiva', d.motivo, d.km_programado ?? null, d.fecha_programada ?? null, d.taller ?? null, d.costo ?? 0, d.notas ?? null, d.incidente_id ?? null, req.usuario.id]);
    return o;
  });
  await registrar(req, 'ot_creada', 'orden_trabajo', ot.id, { folio: ot.folio, vehiculo_id: v.id, tipo: ot.tipo });
  await registrar(req, 'ot_creada', 'vehiculo', v.id, { folio: ot.folio, motivo: ot.motivo });
  res.status(201).json(ot);
});

r.put('/ordenes-trabajo/:id', editar, async (req, res) => {
  const E = req.empresaId, id = Number(req.params.id);
  const ot = await uno('SELECT * FROM ordenes_trabajo WHERE id = $1 AND empresa_id = $2', [id, E]);
  if (!ot) throw new ErrorHttp(404, 'Orden de trabajo no encontrada');
  const d = validarOt(limpiar(req.body, CAMPOS_OT), false);
  delete d.vehiculo_id;
  if (ot.estado === 'anulada') throw new ErrorHttp(409, 'La orden está anulada.');
  if (ot.estado === 'terminada') for (const k of Object.keys(d)) if (!['costo', 'notas', 'taller'].includes(k)) delete d[k]; // terminada: solo costo, taller y notas
  if (d.incidente_id) await deLaEmpresa('incidentes', d.incidente_id, E, 'incidente');
  const s = sqlUpdate('ordenes_trabajo', d, id, E);
  if (!s) return res.json(ot);
  const [o] = await q(s.sql, s.params);
  await registrar(req, 'ot_editada', 'orden_trabajo', id, d);
  res.json(o);
});

// Cambio de estado. body: { estado, forzar, fin_estimado ('aaaa-mm-dd', para el bloqueo), costo, km, notas, venc_revision_tecnica }
r.post('/ordenes-trabajo/:id/estado', editar, async (req, res) => {
  const E = req.empresaId, id = Number(req.params.id);
  const b = req.body || {};
  const ot = await uno('SELECT * FROM ordenes_trabajo WHERE id = $1 AND empresa_id = $2', [id, E]);
  if (!ot) throw new ErrorHttp(404, 'Orden de trabajo no encontrada');
  const v = await uno('SELECT * FROM vehiculos WHERE id = $1 AND empresa_id = $2', [ot.vehiculo_id, E]);
  const permitidos = { programada: ['en_taller', 'terminada', 'anulada'], en_taller: ['terminada', 'anulada'], terminada: [], anulada: [] };
  if (!permitidos[ot.estado]?.includes(b.estado)) throw new ErrorHttp(409, `No se puede pasar una orden ${ot.estado.replace('_', ' ')} a «${String(b.estado || '').replace('_', ' ')}».`);
  const extra = limpiar(b, { costo: 'monto', km: 'entero', notas: 'texto', venc_revision_tecnica: 'fecha' });
  const ahora = new Date();
  const patente = formatearPatente(v.patente);

  if (b.estado === 'en_taller') {
    const finIso = b.fin_estimado ? aIsoFecha(b.fin_estimado) : null;
    if (b.fin_estimado && !finIso) throw new ErrorHttp(400, 'La fecha estimada de salida no es válida.', { campo: 'fin_estimado' });
    let fin = finIso ? desdeLocal(finIso, '20:00') : new Date(ahora.getTime() + DIAS_TALLER_DEFECTO * 864e5);
    if (fin <= ahora) throw new ErrorHttp(400, 'La fecha estimada de salida debe ser posterior a hoy.', { campo: 'fin_estimado' });
    const choques = (await conflictos(E, v.id, ahora, fin, { margenMs: 0 })).filter((c) => c.tipo === 'reserva');
    const folios = choques.map((c) => c.folio);
    if (choques.length && !b.forzar) {
      return res.status(409).json({
        error: `${patente} tiene ${choques.length === 1 ? 'la reserva' : 'las reservas'} ${folios.join(', ')} entre hoy y el ${fmtFecha(fin)}. Reasigna ${choques.length === 1 ? 'esa reserva' : 'esas reservas'} a otro vehículo o confirma igual.`,
        conflictos: choques.map((c) => ({ id: c.id, folio: c.folio, estado: c.estado, inicio: c.inicio, fin: c.fin }))
      });
    }
    const lectura = await lecturaActual(E, v.id);
    await transaccion(async (tx) => {
      await tx.query(`UPDATE ordenes_trabajo SET estado = 'en_taller', inicio = $1, km_al_ingreso = $2, costo = coalesce($3, costo), notas = coalesce($4, notas) WHERE id = $5`, [ahora, lectura?.km ?? v.km, extra.costo ?? null, extra.notas ?? null, id]);
      await tx.query(`UPDATE vehiculos SET estado = 'mantencion' WHERE id = $1 AND empresa_id = $2`, [v.id, E]);
      await tx.query('DELETE FROM bloqueos WHERE orden_trabajo_id = $1 AND empresa_id = $2', [id, E]);
      await tx.query('INSERT INTO bloqueos (empresa_id, vehiculo_id, inicio, fin, motivo, orden_trabajo_id, creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [E, v.id, ahora, fin, `${ot.motivo} (${ot.folio})`, id, req.usuario.id]);
    });
    await registrar(req, 'ot_en_taller', 'orden_trabajo', id, { folio: ot.folio, hasta: fin, forzado: !!choques.length, conflictos: folios });
    await registrar(req, 'vehiculo_estado', 'vehiculo', v.id, { antes: v.estado, despues: 'mantencion', motivo: `${ot.folio} · ${ot.motivo}`, conflictos: folios });
    return res.json({ ok: true, estado: 'en_taller', bloqueo_hasta: fin, conflictos: folios });
  }

  if (b.estado === 'terminada') {
    const lectura = await lecturaActual(E, v.id);
    const km = extra.km ?? lectura?.km ?? v.km;
    const hoy = hoyIso();
    await transaccion(async (tx) => {
      await tx.query(`UPDATE ordenes_trabajo SET estado = 'terminada', inicio = coalesce(inicio, $1), fin = $1, costo = coalesce($2, costo), notas = coalesce($3, notas), km_al_ingreso = coalesce(km_al_ingreso, $4) WHERE id = $5`,
        [ahora, extra.costo ?? null, extra.notas ?? null, km, id]);
      await liberarBloqueo(tx, E, id, ahora);
      const otras = await tx.query(`SELECT 1 FROM ordenes_trabajo WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado = 'en_taller' AND id <> $3`, [E, v.id, id]);
      const sets = ['km = GREATEST(km, $3)'];
      const params = [v.id, E, km];
      if (ot.tipo === 'preventiva') { sets.push('mant_ultima_km = $3', `mant_ultima_fecha = $${params.push(hoy)}`); }
      if (extra.venc_revision_tecnica) sets.push(`venc_revision_tecnica = $${params.push(extra.venc_revision_tecnica)}`);
      if (!otras.length) sets.push(`estado = CASE WHEN estado = 'mantencion' THEN 'disponible' ELSE estado END`);
      await tx.query(`UPDATE vehiculos SET ${sets.join(', ')} WHERE id = $1 AND empresa_id = $2`, params);
    });
    await registrar(req, 'ot_terminada', 'orden_trabajo', id, { folio: ot.folio, km, costo: extra.costo ?? ot.costo });
    await registrar(req, 'ot_terminada', 'vehiculo', v.id, { folio: ot.folio, km, costo: extra.costo ?? ot.costo, tipo: ot.tipo });
    return res.json({ ok: true, estado: 'terminada', km });
  }

  // anulada
  await transaccion(async (tx) => {
    await tx.query(`UPDATE ordenes_trabajo SET estado = 'anulada', fin = $1, notas = coalesce($2, notas) WHERE id = $3`, [ahora, extra.notas ?? null, id]);
    await liberarBloqueo(tx, E, id, ahora);
    if (ot.estado === 'en_taller') {
      const otras = await tx.query(`SELECT 1 FROM ordenes_trabajo WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado = 'en_taller' AND id <> $3`, [E, v.id, id]);
      if (!otras.length) await tx.query(`UPDATE vehiculos SET estado = 'disponible' WHERE id = $1 AND empresa_id = $2 AND estado = 'mantencion'`, [v.id, E]);
    }
  });
  await registrar(req, 'ot_anulada', 'orden_trabajo', id, { folio: ot.folio, motivo: extra.notas || null });
  res.json({ ok: true, estado: 'anulada' });
});

async function liberarBloqueo(tx, E, otId, ahora) {
  await tx.query('DELETE FROM bloqueos WHERE orden_trabajo_id = $1 AND empresa_id = $2 AND inicio >= $3', [otId, E, ahora]);
  await tx.query('UPDATE bloqueos SET fin = $3 WHERE orden_trabajo_id = $1 AND empresa_id = $2 AND fin > $3', [otId, E, ahora]);
}

// ── Sugeridas: por km (gps_km ?? km ≥ última + cada − 1.000), por fecha (30 días antes) y revisión técnica por vencer ──
export async function sugeridas(E) {
  const filas = await q(`SELECT v.id, v.patente, v.marca, v.modelo, v.anio, v.km, v.gps_km, v.estado, v.mant_cada_km, v.mant_ultima_km, v.mant_cada_meses, v.mant_ultima_fecha,
      v.venc_revision_tecnica, c.nombre AS categoria,
      (SELECT json_agg(json_build_object('folio', o.folio, 'tipo', o.tipo, 'estado', o.estado)) FROM ordenes_trabajo o WHERE o.empresa_id = v.empresa_id AND o.vehiculo_id = v.id AND o.estado IN ('programada','en_taller')) AS abiertas,
      (SELECT json_build_object('folio', r.folio, 'inicio', r.inicio, 'fin', r.fin, 'estado', r.estado) FROM reservas r WHERE r.empresa_id = v.empresa_id AND r.vehiculo_id = v.id AND r.estado IN ('confirmada','en_curso') AND r.fin > now() ORDER BY r.inicio LIMIT 1) AS reserva
    FROM vehiculos v LEFT JOIN categorias c ON c.id = v.categoria_id
    WHERE v.empresa_id = $1 AND v.activo AND (
      (v.mant_cada_km > 0 AND coalesce(v.gps_km, v.km) >= coalesce(v.mant_ultima_km, 0) + v.mant_cada_km - 1000)
      OR (v.mant_cada_meses > 0 AND v.mant_ultima_fecha IS NOT NULL AND (v.mant_ultima_fecha + make_interval(months => v.mant_cada_meses))::date <= ${HOY_SQL} + 30)
      OR (v.venc_revision_tecnica IS NOT NULL AND v.venc_revision_tecnica <= ${HOY_SQL} + 30))
    ORDER BY v.patente`, [E]);
  const hoy = hoyIso();
  const out = [];
  for (const v of filas) {
    const m = mantencion(v, hoy);
    const abiertas = v.abiertas || [];
    const base = { vehiculo_id: v.id, patente: v.patente, marca: v.marca, modelo: v.modelo, categoria: v.categoria, estado: v.estado, km_actual: m.km_actual, reserva: v.reserva };
    if ((m.por_km || m.por_fecha) && !abiertas.some((o) => o.tipo === 'preventiva')) {
      const porKm = m.por_km;
      out.push({ ...base, tipo: 'preventiva', por: porKm ? 'km' : 'fecha', proxima_km: m.proxima_km, faltan_km: m.faltan_km, proxima_fecha: m.proxima_fecha, faltan_dias: m.faltan_dias,
        urgencia: (porKm ? m.faltan_km <= 0 : m.faltan_dias <= 0) ? 'vencida' : 'pronto',
        motivo: porKm ? `Mantención ${miles(m.proxima_km)} km` : `Mantención anual (${fmtFecha(m.proxima_fecha)})`, km_programado: m.proxima_km, fecha_programada: porKm ? null : m.proxima_fecha });
    }
    const dRt = diasHasta(v.venc_revision_tecnica, hoy);
    if (dRt != null && dRt <= 30 && !abiertas.some((o) => o.tipo === 'revision_tecnica')) {
      out.push({ ...base, tipo: 'revision_tecnica', por: 'fecha', proxima_fecha: v.venc_revision_tecnica, faltan_dias: dRt, urgencia: dRt < 0 ? 'vencida' : 'pronto',
        motivo: `Revisión técnica (${dRt < 0 ? 'vencida' : 'vence'} el ${fmtFecha(v.venc_revision_tecnica)})`, fecha_programada: dRt < 0 ? hoy : v.venc_revision_tecnica });
    }
  }
  return out.sort((a, b) => (a.urgencia === b.urgencia ? 0 : a.urgencia === 'vencida' ? -1 : 1));
}
r.get('/mantencion/sugeridas', ver, async (req, res) => res.json(await sugeridas(req.empresaId)));

r.get('/mantencion/resumen', ver, async (req, res) => {
  const E = req.empresaId;
  const k = await uno(`SELECT count(*) FILTER (WHERE estado = 'programada')::int AS programadas, count(*) FILTER (WHERE estado = 'en_taller')::int AS en_taller,
      count(*) FILTER (WHERE estado = 'terminada' AND date_trunc('month', fin AT TIME ZONE 'America/Santiago') = date_trunc('month', now() AT TIME ZONE 'America/Santiago'))::int AS terminadas_mes,
      coalesce(sum(costo) FILTER (WHERE estado = 'terminada' AND date_trunc('month', fin AT TIME ZONE 'America/Santiago') = date_trunc('month', now() AT TIME ZONE 'America/Santiago')), 0)::bigint AS costo_mes,
      coalesce(sum(costo) FILTER (WHERE estado = 'terminada' AND date_trunc('year', fin AT TIME ZONE 'America/Santiago') = date_trunc('year', now() AT TIME ZONE 'America/Santiago')), 0)::bigint AS costo_anio
    FROM ordenes_trabajo WHERE empresa_id = $1`, [E]);
  const porVehiculo = await q(`SELECT v.id, v.patente, v.marca, v.modelo, count(o.id)::int AS ordenes, coalesce(sum(o.costo), 0)::bigint AS costo
    FROM ordenes_trabajo o JOIN vehiculos v ON v.id = o.vehiculo_id
    WHERE o.empresa_id = $1 AND o.estado = 'terminada' AND o.fin > now() - interval '12 months'
    GROUP BY v.id ORDER BY costo DESC LIMIT 8`, [E]);
  res.json({ ...k, costo_por_vehiculo: porVehiculo });
});

// ── Tarea diaria: deja en la bitácora de cada vehículo sus vencimientos y mantenciones pendientes (una vez al día) ──
export async function revisarVencimientos() {
  const hoy = hoyIso();
  const filas = await q(`SELECT v.* FROM vehiculos v JOIN empresas e ON e.id = v.empresa_id AND e.activa
    WHERE v.activo AND NOT EXISTS (SELECT 1 FROM bitacora b WHERE b.empresa_id = v.empresa_id AND b.entidad = 'vehiculo' AND b.entidad_id = v.id
        AND b.accion = 'vehiculo_alerta_vencimientos' AND (b.creado_en AT TIME ZONE 'America/Santiago')::date = ${HOY_SQL})
      AND (least(v.venc_revision_tecnica, v.venc_permiso_circulacion, v.venc_soap, v.venc_seguro) <= ${HOY_SQL} + 7
        OR (v.mant_cada_km > 0 AND coalesce(v.gps_km, v.km) >= coalesce(v.mant_ultima_km, 0) + v.mant_cada_km - 500))`);
  let n = 0;
  for (const v of filas) {
    const alertas = [];
    for (const [campo, nombre] of VENCIMIENTOS) {
      const d = diasHasta(v[campo], hoy);
      if (d != null && d <= 7) alertas.push(d < 0 ? `${nombre} vencida el ${fmtFecha(v[campo])}` : d === 0 ? `${nombre} vence hoy` : `${nombre} vence en ${d} días (${fmtFecha(v[campo])})`);
    }
    const m = mantencion(v, hoy);
    if (m.faltan_km != null && m.faltan_km <= 500) alertas.push(m.faltan_km <= 0 ? `Mantención de ${miles(m.proxima_km)} km pasada por ${miles(-m.faltan_km)} km` : `Mantención de ${miles(m.proxima_km)} km: faltan ${miles(m.faltan_km)} km`);
    if (!alertas.length) continue;
    await q(`INSERT INTO bitacora (empresa_id, accion, entidad, entidad_id, detalle) VALUES ($1, 'vehiculo_alerta_vencimientos', 'vehiculo', $2, $3)`, [v.empresa_id, v.id, JSON.stringify({ patente: v.patente, alertas })]);
    n++;
  }
  return n;
}
registrarTarea('flota-vencimientos', 6 * 3600e3, revisarVencimientos);

export default r;
