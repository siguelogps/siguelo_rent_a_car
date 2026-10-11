// Entrega y devolución (patio): tareas del día, asistente de inspección (km, checklist, fotos, daños, firma) y comparación.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { puede } from '../permisos.js';
import { registrar } from '../bitacora.js';
import { guardarArchivo, desdeDataUrl, borrarArchivo } from '../almacenamiento/index.js';
import {
  cargarReserva, tipoPara, asegurarInspeccion, estadoPatio, cargarInspeccion, guardarBorrador, validarPosicion,
  completarInspeccion, comparacion, danosActivos, numerar, OBLIGATORIAS
} from '../patio/servicio.js';
import { CHECKLIST } from '../../public/js/patio-comun.js';

const r = express.Router();
const TIPOS = ['raya', 'abolladura', 'trizadura', 'otro'];
const VISTAS = ['frente', 'atras', 'izquierdo', 'derecho', 'superior'];

// Ver la comparación: patio, liquidaciones o incidentes
const verComparacion = (req, _res, next) => {
  if (!req.usuario) throw new ErrorHttp(401, 'Tu sesión terminó. Vuelve a ingresar.');
  if (!['patio', 'liquidaciones', 'incidentes', 'reservas'].some((m) => puede(req.usuario.rol, m, 'ver'))) throw new ErrorHttp(403, 'Tu rol no tiene permiso para esta acción.');
  if (!req.empresaId) throw new ErrorHttp(400, 'Elige una empresa para continuar.');
  next();
};

const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ErrorHttp(400, 'Identificador inválido'); return n; };

// ── Tareas del día ──
r.get('/patio/tareas', requiere('patio'), async (req, res) => {
  const E = req.empresaId;
  const suc = req.query.sucursal_id ? Number(req.query.sucursal_id) : null;
  const txt = String(req.query.q || '').trim();
  const hoy = `(now() AT TIME ZONE 'America/Santiago')::date`;
  const local = (c) => `(${c} AT TIME ZONE 'America/Santiago')::date`;
  const params = [E, OBLIGATORIAS];
  let filtroQ = '';
  if (txt) {
    params.push(`%${txt.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`, `%${txt}%`);
    filtroQ = ` AND (v.patente ILIKE $${params.length - 1} OR replace(r.folio, '-', '') ILIKE $${params.length - 1} OR (c.nombre || ' ' || COALESCE(c.apellidos, '')) ILIKE $${params.length})`;
  }
  let fsucE = '', fsucD = '';
  if (suc) { params.push(suc); fsucE = ` AND r.sucursal_retiro_id = $${params.length}`; fsucD = ` AND r.sucursal_devolucion_id = $${params.length}`; }
  const base = (tipo) => `SELECT r.id, r.folio, r.estado, r.inicio, r.fin, r.retiro_real, r.devolucion_real, c.nombre || ' ' || COALESCE(c.apellidos, '') AS cliente, c.telefono,
      v.patente, v.marca, v.modelo, v.color, sr.nombre AS sucursal_retiro, sd.nombre AS sucursal_devolucion,
      i.id AS inspeccion_id, i.estado AS inspeccion_estado,
      (SELECT count(*)::int FROM inspeccion_fotos f WHERE f.inspeccion_id = i.id AND f.posicion = ANY($2)) AS fotos
    FROM reservas r
    JOIN vehiculos v ON v.id = r.vehiculo_id
    LEFT JOIN clientes c ON c.id = r.cliente_id
    LEFT JOIN sucursales sr ON sr.id = r.sucursal_retiro_id LEFT JOIN sucursales sd ON sd.id = r.sucursal_devolucion_id
    LEFT JOIN inspecciones i ON i.reserva_id = r.id AND i.tipo = '${tipo}'
    WHERE r.empresa_id = $1`;
  const [entregas, devoluciones, recientes] = await Promise.all([
    q(`${base('entrega')} AND r.estado = 'confirmada'${txt ? filtroQ : ` AND ${local('r.inicio')} <= ${hoy} + 1`}${fsucE} ORDER BY r.inicio LIMIT 100`, params),
    q(`${base('devolucion')} AND r.estado = 'en_curso'${txt ? filtroQ : ` AND ${local('r.fin')} <= ${hoy}`}${fsucD} ORDER BY r.fin LIMIT 100`, params),
    q(`${base('devolucion')} AND r.estado IN ('devuelta','cerrada')${txt ? filtroQ : ` AND r.estado = 'devuelta' AND r.devolucion_real > now() - interval '10 days'`}${fsucD} ORDER BY r.devolucion_real DESC NULLS LAST LIMIT 30`, params)
  ]);
  const ahora = Date.now();
  for (const x of [...entregas, ...devoluciones, ...recientes]) { x.cliente = x.cliente?.trim(); x.atrasada = x.estado === 'en_curso' && new Date(x.fin) < ahora; x.vencida = x.estado === 'confirmada' && new Date(x.inicio) < ahora; }
  res.json({ entregas, devoluciones, recientes, total_fotos: OBLIGATORIAS.length });
});

// ── Estado del asistente para una reserva ──
r.get('/patio/reservas/:id', requiere('patio'), async (req, res) => {
  res.json(await estadoPatio(req.empresaId, id(req.params.id), { tipo: ['entrega', 'devolucion'].includes(req.query.tipo) ? req.query.tipo : null }));
});

// Inicia (o retoma) el borrador de la inspección que corresponde al estado de la reserva
r.post('/patio/reservas/:id/iniciar', requiere('patio', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const reserva = await cargarReserva(E, id(req.params.id));
  const tipo = tipoPara(reserva.estado);
  if (!tipo) throw new ErrorHttp(409, `La reserva está «${reserva.estado}»: no hay entrega ni devolución pendiente.`);
  if (!reserva.vehiculo_id) throw new ErrorHttp(409, 'La reserva no tiene vehículo asignado.');
  const antes = await uno('SELECT id FROM inspecciones WHERE reserva_id = $1 AND tipo = $2 AND empresa_id = $3', [reserva.id, tipo, E]);
  const insp = await asegurarInspeccion(E, reserva, tipo, req.usuario);
  if (!antes) await registrar(req, tipo === 'entrega' ? 'inicio_entrega' : 'inicio_devolucion', 'inspeccion', insp.id, { reserva: reserva.folio });
  res.json(await estadoPatio(E, reserva.id, { tipo }));
});

r.get('/patio/reservas/:id/comparacion', verComparacion, async (req, res) => {
  res.json(await comparacion(req.empresaId, id(req.params.id)));
});

// Daños activos de un vehículo (ficha del vehículo, liquidación)
r.get('/patio/vehiculos/:id/danos', verComparacion, async (req, res) => {
  const v = await uno('SELECT id FROM vehiculos WHERE id = $1 AND empresa_id = $2', [id(req.params.id), req.empresaId]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado');
  res.json(numerar(await danosActivos(req.empresaId, v.id)));
});

// ── Borrador: km, combustible, checklist, observaciones ──
r.put('/patio/inspecciones/:id', requiere('patio', 'editar'), async (req, res) => {
  const insp = await cargarInspeccion(req.empresaId, id(req.params.id));
  res.json(await guardarBorrador(req.empresaId, insp, req.body || {}));
});

// ── Fotos (ya estampadas en el celular) ──
async function subirFoto(req, res) {
  const E = req.empresaId;
  const insp = await cargarInspeccion(E, id(req.params.id));
  if (insp.estado !== 'borrador') throw new ErrorHttp(409, 'La inspección ya está completa.');
  const { posicion, dataUrl, lat, lng, tomada_en: tomadaEn } = req.body || {};
  if (!validarPosicion(posicion)) throw new ErrorHttp(400, 'Posición de foto inválida', { campo: 'posicion' });
  const { mime, datos } = desdeDataUrl(dataUrl);
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new ErrorHttp(400, 'La foto debe ser JPEG, PNG o WebP');
  const latN = lat != null && lat !== '' && Number.isFinite(Number(lat)) ? Number(lat) : null;
  const lngN = lng != null && lng !== '' && Number.isFinite(Number(lng)) ? Number(lng) : null;
  const t = tomadaEn && !Number.isNaN(Date.parse(tomadaEn)) ? new Date(tomadaEn) : new Date();
  const a = await guardarArchivo({ empresaId: E, entidad: 'inspeccion', entidadId: insp.id, tipo: `foto_${posicion}`, nombre: `${insp.tipo}-${posicion}.jpg`, mime, datos,
    meta: { posicion, lat: latN, lng: lngN, tomada_en: t.toISOString(), sello: true }, usuarioId: req.usuario.id });
  const previa = await uno('SELECT archivo_id FROM inspeccion_fotos WHERE inspeccion_id = $1 AND posicion = $2', [insp.id, posicion]);
  const [f] = await q(`INSERT INTO inspeccion_fotos (empresa_id, inspeccion_id, posicion, archivo_id, lat, lng, tomada_en) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (inspeccion_id, posicion) DO UPDATE SET archivo_id = EXCLUDED.archivo_id, lat = EXCLUDED.lat, lng = EXCLUDED.lng, tomada_en = EXCLUDED.tomada_en
    RETURNING posicion, archivo_id, lat, lng, tomada_en`, [E, insp.id, posicion, a.id, latN, lngN, t]);
  if (previa) await borrarArchivo(E, previa.archivo_id).catch(() => {});
  if (latN != null && insp.lat == null) await q('UPDATE inspecciones SET lat = $2, lng = $3 WHERE id = $1', [insp.id, latN, lngN]);
  const n = await uno('SELECT count(*)::int AS n FROM inspeccion_fotos WHERE inspeccion_id = $1 AND posicion = ANY($2)', [insp.id, OBLIGATORIAS]);
  res.json({ foto: f, fotos_ok: n.n, total: OBLIGATORIAS.length });
}
r.post('/patio/inspecciones/:id/fotos', requiere('patio', 'editar'), subirFoto);
r.post('/patio/:id/fotos', requiere('patio', 'editar'), subirFoto); // alias corto

r.delete('/patio/inspecciones/:id/fotos/:posicion', requiere('patio', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const insp = await cargarInspeccion(E, id(req.params.id));
  if (insp.estado !== 'borrador') throw new ErrorHttp(409, 'La inspección ya está completa.');
  const [f] = await q('DELETE FROM inspeccion_fotos WHERE inspeccion_id = $1 AND posicion = $2 AND empresa_id = $3 RETURNING archivo_id', [insp.id, req.params.posicion, E]);
  if (f) await borrarArchivo(E, f.archivo_id).catch(() => {});
  res.json({ ok: true });
});

// ── Daños marcados en el esquema ──
async function guardarFotoDano(req, danoId, dataUrl) {
  const { mime, datos } = desdeDataUrl(dataUrl);
  if (!mime.startsWith('image/')) throw new ErrorHttp(400, 'La foto debe ser una imagen');
  const a = await guardarArchivo({ empresaId: req.empresaId, entidad: 'dano', entidadId: danoId, tipo: 'foto_dano', nombre: `dano-${danoId}.jpg`, mime, datos, meta: { sello: true }, usuarioId: req.usuario.id });
  await q('UPDATE danos SET archivo_id = $1 WHERE id = $2 AND empresa_id = $3', [a.id, danoId, req.empresaId]);
}

r.post('/patio/inspecciones/:id/danos', requiere('patio', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const insp = await cargarInspeccion(E, id(req.params.id));
  if (insp.estado !== 'borrador') throw new ErrorHttp(409, 'La inspección ya está completa.');
  const { vista, x, y, tipo, descripcion, dataUrl } = req.body || {};
  if (!VISTAS.includes(vista)) throw new ErrorHttp(400, 'Vista del esquema inválida');
  if (!TIPOS.includes(tipo)) throw new ErrorHttp(400, 'Tipo de daño inválido');
  const xn = Number(x), yn = Number(y);
  if (!(xn >= 0 && xn <= 360 && yn >= 0 && yn <= 470)) throw new ErrorHttp(400, 'Posición fuera del esquema');
  const [d] = await q(`INSERT INTO danos (empresa_id, vehiculo_id, inspeccion_id, vista, x, y, tipo, descripcion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [E, insp.vehiculo_id, insp.id, vista, xn, yn, tipo, String(descripcion || '').slice(0, 300) || null]);
  if (dataUrl) await guardarFotoDano(req, d.id, dataUrl);
  res.json(await uno('SELECT * FROM danos WHERE id = $1', [d.id]));
});

async function danoEditable(E, danoId) {
  const d = await uno(`SELECT d.*, i.estado AS inspeccion_estado FROM danos d LEFT JOIN inspecciones i ON i.id = d.inspeccion_id WHERE d.id = $1 AND d.empresa_id = $2`, [danoId, E]);
  if (!d) throw new ErrorHttp(404, 'Daño no encontrado');
  if (d.inspeccion_estado !== 'borrador') throw new ErrorHttp(409, 'Este daño ya quedó registrado en una inspección completa y no se puede modificar.');
  return d;
}

r.patch('/patio/danos/:id', requiere('patio', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const d = await danoEditable(E, id(req.params.id));
  const b = req.body || {};
  if (b.tipo && !TIPOS.includes(b.tipo)) throw new ErrorHttp(400, 'Tipo de daño inválido');
  await q('UPDATE danos SET tipo = COALESCE($3, tipo), descripcion = CASE WHEN $4::boolean THEN $5 ELSE descripcion END WHERE id = $1 AND empresa_id = $2',
    [d.id, E, b.tipo || null, 'descripcion' in b, String(b.descripcion || '').slice(0, 300) || null]);
  if (b.dataUrl) await guardarFotoDano(req, d.id, b.dataUrl);
  res.json(await uno('SELECT * FROM danos WHERE id = $1', [d.id]));
});

r.delete('/patio/danos/:id', requiere('patio', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const d = await danoEditable(E, id(req.params.id));
  await q('DELETE FROM danos WHERE id = $1 AND empresa_id = $2', [d.id, E]);
  if (d.archivo_id) await borrarArchivo(E, d.archivo_id).catch(() => {});
  res.json({ ok: true });
});

// ── Firma y cierre ──
r.post('/patio/inspecciones/:id/completar', requiere('patio', 'editar'), async (req, res) => {
  const insp = await cargarInspeccion(req.empresaId, id(req.params.id));
  const out = await completarInspeccion(req, insp, req.body || {});
  const reserva = await cargarReserva(req.empresaId, out.reserva_id);
  const obs = CHECKLIST.filter((i) => out.inspeccion.checklist?.notas?.[i.clave]).length;
  await registrar(req, insp.tipo === 'entrega' ? 'entrega_vehiculo' : 'devolucion_vehiculo', 'reserva', reserva.id,
    { folio: reserva.folio, patente: reserva.patente, km: out.inspeccion.km, combustible: out.inspeccion.combustible, inspeccion_id: insp.id, observaciones: obs, incidentes: out.incidentes.map((i) => i.folio) });
  for (const i of out.incidentes) await registrar(req, 'incidente_creado', 'incidente', i.id, { folio: i.folio, origen: 'devolucion', reserva: reserva.folio });
  res.json({ ...out, reserva_estado: reserva.estado });
});

export default r;
