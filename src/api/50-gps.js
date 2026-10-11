// Plataforma GPS: mapa de la flota, alertas, asignación de unidades, inmovilización remota con doble validación
// y recorrido por contrato. Toda consulta filtra por req.empresaId.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { puede } from '../permisos.js';
import { registrar } from '../bitacora.js';
import { leer, marchaBlanca } from '../integraciones/index.js';
import { leerUnidades } from '../gps/wialon.js';
import { sincronizarEmpresa, recorridoReserva, emparejar, estadoSincronizacion } from '../gps/sincronizar.js';
import { solicitar, confirmar, reintentar, cancelar, listar } from '../gps/inmovilizar.js';

const r = express.Router();

async function estadoIntegracion(empresaId) {
  const { activa, config } = await leer(empresaId, 'gps');
  return { activa, configurada: !!config.token, marcha_blanca: await marchaBlanca(empresaId), velocidad_maxima: Number(config.velocidad_maxima) || 120, geocerca: config.geocerca_permitida || null, horario: `${config.horario_desde || '06:00'}–${config.horario_hasta || '23:00'}` };
}

const SQL_VEHICULOS = `
  SELECT v.id, v.patente, v.marca, v.modelo, v.anio, v.color, v.estado, v.km, v.combustible_nivel, v.capacidad_estanque,
         v.gps_unidad_id, v.gps_nombre, v.gps_lat, v.gps_lng, v.gps_velocidad, v.gps_motor, v.gps_km, v.gps_combustible,
         v.gps_actualizado_en, v.gps_inmovilizado, v.gps_detenido_desde, s.nombre AS sucursal, cat.nombre AS categoria,
         r.id AS reserva_id, r.folio, r.inicio, r.fin, r.retiro_real, (r.fin < now()) AS atrasada,
         c.id AS cliente_id, trim(c.nombre || ' ' || coalesce(c.apellidos, '')) AS cliente, c.telefono AS cliente_telefono,
         (SELECT count(*) FROM gps_alertas a WHERE a.empresa_id = v.empresa_id AND a.vehiculo_id = v.id AND NOT a.atendida)::int AS alertas,
         (SELECT i.estado FROM inmovilizaciones i WHERE i.empresa_id = v.empresa_id AND i.vehiculo_id = v.id AND i.estado IN ('solicitada','confirmada') LIMIT 1) AS inmov_pendiente
    FROM vehiculos v
    LEFT JOIN sucursales s ON s.id = v.sucursal_id
    LEFT JOIN categorias cat ON cat.id = v.categoria_id
    LEFT JOIN LATERAL (SELECT * FROM reservas x WHERE x.empresa_id = v.empresa_id AND x.vehiculo_id = v.id AND x.estado = 'en_curso' ORDER BY x.inicio DESC LIMIT 1) r ON true
    LEFT JOIN clientes c ON c.id = r.cliente_id
   WHERE v.empresa_id = $1 AND v.activo`;

r.get('/gps/estado', requiere('gps'), async (req, res) => {
  const s = estadoSincronizacion.get(req.empresaId) || null;
  const k = await uno(`SELECT count(*) FILTER (WHERE NOT atendida)::int AS alertas FROM gps_alertas WHERE empresa_id = $1`, [req.empresaId]);
  res.json({
    integracion: await estadoIntegracion(req.empresaId), sincronizacion: s,
    alertas_pendientes: k.alertas,
    puede: { editar: puede(req.usuario.rol, 'gps', 'editar'), inmovilizar: puede(req.usuario.rol, 'inmovilizar', 'editar'), confirmar: puede(req.usuario.rol, 'inmovilizar', 'editar') && ['administrador', 'superadmin'].includes(req.usuario.rol) },
    usuario_id: req.usuario.id
  });
});

r.get('/gps/vehiculos', requiere('gps'), async (req, res) => {
  res.json(await q(`${SQL_VEHICULOS} ORDER BY v.patente`, [req.empresaId]));
});

r.get('/gps/vehiculos/:id', requiere('gps'), async (req, res) => {
  const v = await uno(`${SQL_VEHICULOS} AND v.id = $2`, [req.empresaId, req.params.id]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const [recorrido, inmovilizaciones, alertas, proxima] = await Promise.all([
    v.reserva_id ? recorridoReserva(req.empresaId, v.reserva_id) : null,
    listar(req.empresaId, { vehiculoId: v.id, limite: 30 }),
    q(`SELECT a.*, u.nombre AS atendida_nombre FROM gps_alertas a LEFT JOIN usuarios u ON u.id = a.atendida_por WHERE a.empresa_id = $1 AND a.vehiculo_id = $2 ORDER BY a.ocurrido_en DESC LIMIT 20`, [req.empresaId, v.id]),
    uno(`SELECT r.id, r.folio, r.inicio, trim(c.nombre || ' ' || coalesce(c.apellidos, '')) AS cliente FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id
         WHERE r.empresa_id = $1 AND r.vehiculo_id = $2 AND r.estado = 'confirmada' AND r.inicio > now() ORDER BY r.inicio LIMIT 1`, [req.empresaId, v.id])
  ]);
  res.json({ ...v, recorrido, inmovilizaciones, alertas_lista: alertas, proxima_reserva: proxima });
});

r.post('/gps/sincronizar', requiere('gps', 'editar'), async (req, res) => {
  const { config } = await leer(req.empresaId, 'gps');
  if (!config.token) throw new ErrorHttp(400, 'Primero configura la plataforma GPS en Configuración › Integraciones');
  try {
    const resultado = await sincronizarEmpresa(req.empresaId);
    await registrar(req, 'gps_sincronizado', 'gps', null, resultado);
    res.json(resultado);
  } catch (e) {
    estadoSincronizacion.set(req.empresaId, { en: new Date(), ok: false, error: e.message });
    throw new ErrorHttp(502, e.message);
  }
});

// ── Alertas ──
r.get('/gps/alertas', requiere('gps'), async (req, res) => {
  const todas = req.query.todas === '1';
  res.json(await q(`SELECT a.*, v.patente, v.marca, v.modelo, r.folio, trim(c.nombre || ' ' || coalesce(c.apellidos, '')) AS cliente, u.nombre AS atendida_nombre
      FROM gps_alertas a JOIN vehiculos v ON v.id = a.vehiculo_id LEFT JOIN reservas r ON r.id = a.reserva_id LEFT JOIN clientes c ON c.id = r.cliente_id
      LEFT JOIN usuarios u ON u.id = a.atendida_por
     WHERE a.empresa_id = $1 AND ($2 OR NOT a.atendida OR a.atendida_en > now() - interval '3 days')
     ORDER BY a.atendida, a.ocurrido_en DESC LIMIT 200`, [req.empresaId, todas]));
});

// Atender: quien edita la plataforma GPS o puede inmovilizar (counter de turno).
const puedeAtender = (req, _res, next) => {
  if (!puede(req.usuario.rol, 'gps', 'editar') && !puede(req.usuario.rol, 'inmovilizar', 'editar')) throw new ErrorHttp(403, 'Tu rol no tiene permiso para esta acción.');
  next();
};
r.post('/gps/alertas/:id/atender', requiere('gps'), puedeAtender, async (req, res) => {
  const nota = String(req.body.nota || '').trim();
  if (!nota) throw new ErrorHttp(400, 'Escribe una nota de lo que se hizo', { campo: 'nota' });
  const [a] = await q(`UPDATE gps_alertas SET atendida = true, atendida_por = $3, atendida_en = now(), nota = $4 WHERE id = $1 AND empresa_id = $2 AND NOT atendida RETURNING *`,
    [req.params.id, req.empresaId, req.usuario.id, nota.slice(0, 1000)]);
  if (!a) throw new ErrorHttp(404, 'Alerta no encontrada o ya atendida');
  await registrar(req, 'gps_alerta_atendida', 'gps_alerta', a.id, { tipo: a.tipo, nota });
  res.json(a);
});

// ── Asignar unidades de la plataforma a vehículos ──
r.get('/gps/unidades', requiere('gps', 'editar'), async (req, res) => {
  const { config } = await leer(req.empresaId, 'gps');
  if (!config.token) throw new ErrorHttp(400, 'Primero configura la plataforma GPS en Configuración › Integraciones');
  let unidades;
  try { unidades = await leerUnidades(req.empresaId, { config, conSensores: false }); }
  catch (e) { throw new ErrorHttp(502, e.message); }
  const vehiculos = await q('SELECT id, patente, marca, modelo, gps_unidad_id, gps_nombre FROM vehiculos WHERE empresa_id = $1 AND activo ORDER BY patente', [req.empresaId]);
  const porId = new Map(vehiculos.filter((v) => v.gps_unidad_id).map((v) => [String(v.gps_unidad_id), v]));
  const libres = vehiculos.filter((v) => !v.gps_unidad_id);
  res.json({
    unidades: unidades.map((u) => {
      const ligado = porId.get(u.id);
      const sug = ligado ? null : emparejar(u, new Map(), libres);
      return { id: u.id, nombre: u.nombre, en: u.en, lat: u.lat, lng: u.lng, vehiculo_id: ligado?.id || null, patente: ligado?.patente || null, sugerido: sug ? { id: sug.vehiculo.id, patente: sug.vehiculo.patente } : null };
    }),
    vehiculos
  });
});

r.post('/gps/unidades/vincular', requiere('gps', 'editar'), async (req, res) => {
  const v = await uno('SELECT id, patente, gps_unidad_id FROM vehiculos WHERE id = $1 AND empresa_id = $2', [req.body.vehiculo_id, req.empresaId]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  const unidad = req.body.unidad_id == null || req.body.unidad_id === '' ? null : String(req.body.unidad_id);
  if (unidad) {
    const otro = await uno('SELECT patente FROM vehiculos WHERE empresa_id = $1 AND gps_unidad_id = $2 AND id <> $3', [req.empresaId, unidad, v.id]);
    if (otro) throw new ErrorHttp(409, `Esa unidad ya está asignada a ${otro.patente}`);
  }
  const [f] = await q(`UPDATE vehiculos SET gps_unidad_id = $3, gps_nombre = $4 ${unidad ? '' : ', gps_actualizado_en = NULL'} WHERE id = $1 AND empresa_id = $2 RETURNING id, patente, gps_unidad_id, gps_nombre`,
    [v.id, req.empresaId, unidad, unidad ? String(req.body.nombre || '').slice(0, 120) || null : null]);
  await registrar(req, unidad ? 'gps_unidad_vinculada' : 'gps_unidad_desvinculada', 'vehiculo', v.id, { unidad_id: unidad, anterior: v.gps_unidad_id });
  res.json(f);
});

// ── Inmovilización remota ──
r.get('/gps/inmovilizaciones', requiere('gps'), async (req, res) => {
  res.json(await listar(req.empresaId, { vehiculoId: req.query.vehiculo_id ? Number(req.query.vehiculo_id) : null }));
});
r.post('/gps/inmovilizaciones', requiere('inmovilizar', 'editar'), async (req, res) => {
  res.status(201).json(await solicitar(req, req.body || {}));
});
r.post('/gps/inmovilizaciones/:id/confirmar', requiere('inmovilizar', 'editar'), async (req, res) => {
  res.json(await confirmar(req, req.params.id, req.body || {}));
});
r.post('/gps/inmovilizaciones/:id/reintentar', requiere('inmovilizar', 'editar'), async (req, res) => {
  res.json(await reintentar(req, req.params.id));
});
r.post('/gps/inmovilizaciones/:id/cancelar', requiere('inmovilizar', 'editar'), async (req, res) => {
  res.json(await cancelar(req, req.params.id, req.body?.motivo));
});

// ── Recorrido del contrato (lo usan entrega, devolución y liquidación) ──
r.get('/gps/reservas/:id/recorrido', requiere('gps'), async (req, res) => {
  const rec = await recorridoReserva(req.empresaId, req.params.id);
  if (!rec) throw new ErrorHttp(404, 'Reserva no encontrada');
  res.json(rec);
});

export default r;
