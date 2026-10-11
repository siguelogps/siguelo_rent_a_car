// TAG y multas: importación (archivo o dashboard Síguelo), asignación al contrato, aviso al cliente y cobros posteriores.
// Toda consulta filtra por req.empresaId.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { leer } from '../integraciones/index.js';
import { normalizarPatente } from '../util/patente.js';
import { previsualizar, importarArchivo } from '../tagmultas/importar.js';
import { asignarTag, asignarMultas, asignarManual } from '../tagmultas/asignar.js';
import { notificarReserva } from '../tagmultas/notificar.js';
import { sincronizarEmpresa as sincronizarDashboard, ultimaSincronizacion } from '../tagmultas/dashboard.js';

const r = express.Router();
const CLIENTE = `trim(c.nombre || ' ' || coalesce(c.apellidos, ''))`;
const MAX_ARCHIVO = 15 * 1024 * 1024;

function bufferDe(body) {
  const datos = String(body.datos || '').replace(/^data:[^,]*,/, '');
  if (!datos) throw new ErrorHttp(400, 'Adjunta el archivo');
  const buf = Buffer.from(datos, 'base64');
  if (buf.length > MAX_ARCHIVO) throw new ErrorHttp(400, 'El archivo supera los 15 MB');
  return buf;
}
const tipoValido = (t) => { if (!['tag', 'multas'].includes(t)) throw new ErrorHttp(400, 'Tipo de importación no válido'); return t; };

r.get('/tag-multas/resumen', requiere('tag_multas'), async (req, res) => {
  const E = req.empresaId;
  const [tag, mul, notif, post] = await Promise.all([
    uno(`SELECT count(*) FILTER (WHERE fecha_hora >= date_trunc('month', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago')::int AS mes,
               coalesce(sum(monto) FILTER (WHERE fecha_hora >= date_trunc('month', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago'), 0)::bigint AS monto_mes,
               count(*) FILTER (WHERE estado = 'sin_contrato')::int AS sin_contrato, coalesce(sum(monto) FILTER (WHERE estado = 'sin_contrato'), 0)::bigint AS monto_sin_contrato
          FROM tag_transitos WHERE empresa_id = $1`, [E]),
    uno(`SELECT count(*) FILTER (WHERE estado = 'revisar')::int AS revisar, count(*) FILTER (WHERE estado = 'sin_contrato')::int AS sin_contrato,
               count(*) FILTER (WHERE estado IN ('asignada','notificada'))::int AS por_cobrar, coalesce(sum(monto) FILTER (WHERE estado IN ('asignada','notificada')), 0)::bigint AS monto_por_cobrar
          FROM multas WHERE empresa_id = $1`, [E]),
    uno(`SELECT count(DISTINCT reserva_id)::int AS reservas, coalesce(sum(monto), 0)::bigint AS monto FROM (
          SELECT reserva_id, monto FROM tag_transitos WHERE empresa_id = $1 AND estado = 'asignado' AND notificado_en IS NULL
          UNION ALL SELECT reserva_id, monto FROM multas WHERE empresa_id = $1 AND estado = 'asignada') x`, [E]),
    uno(`SELECT count(DISTINCT x.cliente_id)::int AS clientes, coalesce(sum(x.monto), 0)::bigint AS monto FROM (
          SELECT r.cliente_id, t.monto FROM tag_transitos t JOIN reservas r ON r.id = t.reserva_id WHERE t.empresa_id = $1 AND t.estado = 'asignado' AND r.estado = 'cerrada'
          UNION ALL SELECT r.cliente_id, m.monto FROM multas m JOIN reservas r ON r.id = m.reserva_id WHERE m.empresa_id = $1 AND m.estado IN ('asignada','notificada') AND r.estado = 'cerrada') x`, [E])
  ]);
  res.json({ tag, multas: mul, por_notificar: notif, cobros_posteriores: post });
});

r.get('/tag-multas/tag', requiere('tag_multas'), async (req, res) => {
  const estado = req.query.estado || null;
  const pat = req.query.q ? `%${normalizarPatente(req.query.q)}%` : null;
  res.json(await q(`SELECT t.*, r.folio, r.estado AS reserva_estado, ${CLIENTE} AS cliente, c.id AS cliente_id, v.marca, v.modelo
      FROM tag_transitos t LEFT JOIN reservas r ON r.id = t.reserva_id LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
     WHERE t.empresa_id = $1 AND ($2::text IS NULL OR t.estado = $2) AND ($3::text IS NULL OR t.patente LIKE $3)
       AND ($4::date IS NULL OR t.fecha_hora >= $4::date) AND ($5::date IS NULL OR t.fecha_hora < $5::date + 1)
     ORDER BY t.fecha_hora DESC LIMIT 1000`, [req.empresaId, estado, pat, req.query.desde || null, req.query.hasta || null]));
});

r.get('/tag-multas/multas', requiere('tag_multas'), async (req, res) => {
  const estado = req.query.estado || null;
  const pat = req.query.q ? `%${normalizarPatente(req.query.q)}%` : null;
  res.json(await q(`SELECT m.*, r.folio, r.estado AS reserva_estado, ${CLIENTE} AS cliente, v.marca, v.modelo
      FROM multas m LEFT JOIN reservas r ON r.id = m.reserva_id LEFT JOIN clientes c ON c.id = m.cliente_id LEFT JOIN vehiculos v ON v.id = m.vehiculo_id
     WHERE m.empresa_id = $1 AND ($2::text IS NULL OR m.estado = $2) AND ($3::text IS NULL OR m.patente LIKE $3)
     ORDER BY m.fecha_infraccion DESC LIMIT 1000`, [req.empresaId, estado, pat]));
});

// Reservas con TAG o multas aún sin avisar al cliente
r.get('/tag-multas/por-notificar', requiere('tag_multas'), async (req, res) => {
  res.json(await q(`SELECT r.id AS reserva_id, r.folio, r.estado, r.inicio, r.fin, r.retiro_real, r.devolucion_real, ${CLIENTE} AS cliente, c.correo, c.telefono, v.patente,
        count(*) FILTER (WHERE x.tipo = 'tag')::int AS n_tag, count(*) FILTER (WHERE x.tipo = 'multa')::int AS n_multas,
        coalesce(sum(x.monto) FILTER (WHERE x.tipo = 'tag'), 0)::bigint AS monto_tag, coalesce(sum(x.monto) FILTER (WHERE x.tipo = 'multa'), 0)::bigint AS monto_multas,
        coalesce(sum(x.monto), 0)::bigint AS total
      FROM (SELECT 'tag' AS tipo, reserva_id, monto FROM tag_transitos WHERE empresa_id = $1 AND estado = 'asignado' AND notificado_en IS NULL
            UNION ALL SELECT 'multa', reserva_id, monto FROM multas WHERE empresa_id = $1 AND estado = 'asignada') x
      JOIN reservas r ON r.id = x.reserva_id AND r.empresa_id = $1 LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
     GROUP BY r.id, c.id, v.id ORDER BY max(coalesce(r.devolucion_real, r.fin)) DESC`, [req.empresaId]));
});

// TAG y multas que llegaron con el contrato ya cerrado: quedan por cobrar al cliente (la liquidación ya pasó)
r.get('/tag-multas/cobros-posteriores', requiere('tag_multas'), async (req, res) => {
  const filas = await q(`SELECT x.*, r.folio, r.devolucion_real, c.id AS cliente_id, ${CLIENTE} AS cliente, c.correo, c.telefono FROM (
        SELECT 'tag' AS tipo, t.id, t.reserva_id, t.patente, t.fecha_hora AS fecha, true AS hora_conocida, concat_ws(' – ', t.autopista, t.portico) AS detalle, t.monto, t.estado, t.notificado_en AS avisado_en
          FROM tag_transitos t WHERE t.empresa_id = $1 AND t.estado = 'asignado'
        UNION ALL
        SELECT 'multa', m.id, m.reserva_id, m.patente, m.fecha_infraccion, m.hora_conocida, coalesce(m.motivo, 'Multa'), m.monto, m.estado, m.notificada_en
          FROM multas m WHERE m.empresa_id = $1 AND m.estado IN ('asignada','notificada')) x
      JOIN reservas r ON r.id = x.reserva_id AND r.empresa_id = $1 AND r.estado = 'cerrada' LEFT JOIN clientes c ON c.id = r.cliente_id
     ORDER BY cliente, x.fecha`, [req.empresaId]);
  const grupos = new Map();
  for (const f of filas) {
    const g = grupos.get(f.cliente_id) || { cliente_id: f.cliente_id, cliente: f.cliente, correo: f.correo, telefono: f.telefono, total: 0, items: [] };
    g.total += Number(f.monto); g.items.push(f); grupos.set(f.cliente_id, g);
  }
  res.json([...grupos.values()].sort((a, b) => b.total - a.total));
});

r.get('/tag-multas/reservas/:id', requiere('tag_multas'), async (req, res) => {
  const [tag, multas] = await Promise.all([
    q('SELECT * FROM tag_transitos WHERE empresa_id = $1 AND reserva_id = $2 ORDER BY fecha_hora', [req.empresaId, req.params.id]),
    q('SELECT * FROM multas WHERE empresa_id = $1 AND reserva_id = $2 ORDER BY fecha_infraccion', [req.empresaId, req.params.id])
  ]);
  res.json({ tag, multas });
});

r.post('/tag-multas/reservas/:id/notificar', requiere('tag_multas', 'editar'), async (req, res) => {
  const out = await notificarReserva(req.empresaId, req.params.id);
  if (out.error) throw new ErrorHttp(out.estado, out.error);
  await registrar(req, 'tag_multas_notificados', 'reserva', out.reserva_id, { tag: out.tag, multas: out.multas, total: out.total });
  res.json(out);
});

// ── Importación desde archivo ──
r.get('/tag-multas/importaciones', requiere('tag_multas'), async (req, res) => {
  res.json(await q(`SELECT i.*, u.nombre AS usuario FROM importaciones i LEFT JOIN usuarios u ON u.id = i.usuario_id WHERE i.empresa_id = $1 ORDER BY i.creado_en DESC LIMIT 200`, [req.empresaId]));
});

r.post('/tag-multas/importar/previa', requiere('tag_multas', 'editar'), async (req, res) => {
  const tipo = tipoValido(req.body.tipo);
  try { res.json(await previsualizar(bufferDe(req.body), String(req.body.nombre || ''), tipo, { mapeo: req.body.mapeo || null, filaEncabezados: req.body.fila_encabezados ?? null })); }
  catch (e) { throw e instanceof ErrorHttp ? e : new ErrorHttp(400, `No se pudo leer el archivo: ${e.message}`); }
});

r.post('/tag-multas/importar', requiere('tag_multas', 'editar'), async (req, res) => {
  const tipo = tipoValido(req.body.tipo);
  const buf = bufferDe(req.body);
  let out;
  try {
    out = await importarArchivo(req.empresaId, buf, String(req.body.nombre || ''), tipo, { mapeo: req.body.mapeo || null, filaEncabezados: req.body.fila_encabezados ?? null, usuarioId: req.usuario.id });
  } catch (e) { throw e instanceof ErrorHttp || e.estado ? new ErrorHttp(e.estado || 400, e.message) : new ErrorHttp(400, `No se pudo importar: ${e.message}`); }
  await registrar(req, `importacion_${tipo}`, 'importacion', out.id, { nombre: req.body.nombre, nuevas: out.nuevas, duplicadas: out.duplicadas, asignadas: out.asignadas });
  res.json(out);
});

// Vuelve a intentar asignar lo pendiente (por ejemplo, después de registrar una devolución atrasada)
r.post('/tag-multas/reasignar', requiere('tag_multas', 'editar'), async (req, res) => {
  const tag = await asignarTag(req.empresaId);
  const multas = await asignarMultas(req.empresaId);
  await registrar(req, 'tag_multas_reasignados', null, null, { tag, multas });
  res.json({ tag, multas });
});

// Reservas candidatas para asignar a mano (mismo vehículo, ±5 días)
r.get('/tag-multas/candidatas', requiere('tag_multas'), async (req, res) => {
  const p = normalizarPatente(req.query.patente);
  const f = new Date(req.query.fecha || Date.now());
  if (Number.isNaN(f.getTime())) throw new ErrorHttp(400, 'Fecha no válida');
  res.json(await q(`SELECT r.id, r.folio, r.estado, coalesce(r.retiro_real, r.inicio) AS desde, coalesce(r.devolucion_real, r.fin) AS hasta, ${CLIENTE} AS cliente
      FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id LEFT JOIN clientes c ON c.id = r.cliente_id
     WHERE r.empresa_id = $1 AND v.patente = $2 AND r.estado IN ('en_curso','devuelta','cerrada')
       AND coalesce(r.retiro_real, r.inicio) < $3::timestamptz + interval '5 days' AND coalesce(r.devolucion_real, r.fin) > $3::timestamptz - interval '5 days'
     ORDER BY coalesce(r.retiro_real, r.inicio)`, [req.empresaId, p, f]));
});

for (const [ruta, tabla] of [['tag', 'tag'], ['multas', 'multas']]) {
  r.post(`/tag-multas/${ruta}/:id/asignar`, requiere('tag_multas', 'editar'), async (req, res) => {
    const out = await asignarManual(req.empresaId, tabla, req.params.id, req.body.reserva_id || null);
    if (out.error) throw new ErrorHttp(out.estado, out.error);
    await registrar(req, `${tabla === 'tag' ? 'tag' : 'multa'}_asignado_manual`, tabla === 'tag' ? 'tag_transito' : 'multa', out.fila.id, { reserva_anterior: out.anterior.reserva_id, reserva_nueva: out.fila.reserva_id, motivo: req.body.motivo || null });
    res.json(out.fila);
  });
  r.post(`/tag-multas/${ruta}/:id/condonar`, requiere('tag_multas', 'editar'), async (req, res) => {
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) throw new ErrorHttp(400, 'Escribe el motivo', { campo: 'motivo' });
    const t = tabla === 'tag' ? 'tag_transitos' : 'multas';
    const [f] = await q(`UPDATE ${t} SET estado = $3 WHERE id = $1 AND empresa_id = $2 AND estado NOT IN ('cobrado','cobrada','pagada') RETURNING *`,
      [req.params.id, req.empresaId, tabla === 'tag' ? 'condonado' : 'condonada']);
    if (!f) throw new ErrorHttp(404, 'Registro no encontrado o ya cobrado');
    await registrar(req, `${tabla === 'tag' ? 'tag' : 'multa'}_condonado`, tabla === 'tag' ? 'tag_transito' : 'multa', f.id, { motivo, monto: f.monto, reserva_id: f.reserva_id });
    res.json(f);
  });
}

// ── Dashboard Síguelo ──
r.get('/tag-multas/dashboard', requiere('tag_multas'), async (req, res) => {
  const { activa, config } = await leer(req.empresaId, 'dashboard_siguelo');
  const ultima = await ultimaSincronizacion(req.empresaId);
  const cob = ultima?.cobertura || [];
  res.json({
    activa, configurada: !!(config.api_key && config.url), cada_horas: Number(config.sincronizar_cada_horas) || 24, ultima,
    cobertura: { revisadas: cob.filter((c) => c.estado === 'revisada').length, fallidas: cob.filter((c) => c.estado === 'fallida').length, nunca: cob.filter((c) => c.estado === 'nunca').length, detalle: cob }
  });
});

r.post('/tag-multas/dashboard/sincronizar', requiere('tag_multas', 'editar'), async (req, res) => {
  const { config } = await leer(req.empresaId, 'dashboard_siguelo');
  if (!config.api_key || !config.url) throw new ErrorHttp(400, 'Primero configura el dashboard Síguelo en Configuración › Integraciones');
  const out = await sincronizarDashboard(req.empresaId, { usuarioId: req.usuario.id, config });
  await registrar(req, 'dashboard_tag_multas_sincronizado', 'dashboard', out.id, { desde: out.desde, hasta: out.hasta, pasadas: out.pasadas, multas: out.multas, estado: out.estado });
  res.json(out);
});

export default r;
