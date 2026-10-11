// Módulo 4 · Clientes: lista con búsqueda y filtros, alta/edición (persona o empresa; RUT con DV o pasaporte/DNI),
// documentos (cédula, licencia, pasaporte) en el almacenamiento externo, conductores adicionales, historial y lista negra.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { guardarArchivo, borrarArchivo, desdeDataUrl } from '../almacenamiento/index.js';
import { validarRut, normalizarRut, limpiarRut } from '../util/rut.js';
import { aIsoFecha } from '../util/formato.js';

const r = express.Router();
const ver = requiere('clientes', 'ver'), editar = requiere('clientes', 'editar');
const idDe = (v, que = 'Cliente') => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ErrorHttp(404, `${que} no encontrado`); return n; };

export const TIPOS_DOCUMENTO_CLIENTE = { cedula_frente: 'Cédula (frente)', cedula_reverso: 'Cédula (reverso)', licencia: 'Licencia de conducir', licencia_reverso: 'Licencia (reverso)', pasaporte: 'Pasaporte', otro: 'Otro documento' };

const txt = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const fechaONull = (v, campo) => {
  if (v == null || v === '') return null;
  const f = aIsoFecha(v);
  if (!f || Number.isNaN(Date.parse(f))) throw new ErrorHttp(400, 'Fecha inválida', { campo });
  return f;
};

/** Valida y normaliza el documento: RUT con dígito verificador (12345678-K) o pasaporte/DNI (alfanumérico). */
export function normalizarDocumento(tipo, doc) {
  const t = ['rut', 'pasaporte', 'dni'].includes(tipo) ? tipo : 'rut';
  if (t === 'rut') {
    if (!validarRut(doc)) throw new ErrorHttp(400, 'El RUT no es válido: revisa el dígito verificador', { campo: 'documento' });
    return { tipo: t, documento: normalizarRut(doc) };
  }
  const d = String(doc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (d.length < 5 || d.length > 20) throw new ErrorHttp(400, `El número de ${t === 'dni' ? 'DNI' : 'pasaporte'} no es válido`, { campo: 'documento' });
  return { tipo: t, documento: d };
}

function camposCliente(b, parcial = false) {
  const o = {};
  const tiene = (k) => !parcial || k in b;
  if (tiene('tipo')) o.tipo = b.tipo === 'empresa' ? 'empresa' : 'persona';
  if (tiene('nombre')) { o.nombre = txt(b.nombre, 120); if (!o.nombre) throw new ErrorHttp(400, 'Falta el nombre', { campo: 'nombre' }); }
  for (const k of ['apellidos', 'nacionalidad', 'correo', 'telefono', 'direccion', 'comuna', 'ciudad', 'pais', 'razon_social', 'giro', 'licencia_numero', 'licencia_clase', 'licencia_pais']) if (tiene(k)) o[k] = txt(b[k]);
  if (tiene('notas')) o.notas = txt(b.notas, 2000);
  if (o.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.correo)) throw new ErrorHttp(400, 'El correo no parece válido', { campo: 'correo' });
  if (tiene('fecha_nacimiento')) o.fecha_nacimiento = fechaONull(b.fecha_nacimiento, 'fecha_nacimiento');
  if (tiene('licencia_vence')) o.licencia_vence = fechaONull(b.licencia_vence, 'licencia_vence');
  if (tiene('documento') || tiene('documento_tipo')) {
    if (!b.documento) throw new ErrorHttp(400, 'Falta el documento', { campo: 'documento' });
    const d = normalizarDocumento(b.documento_tipo || 'rut', b.documento);
    o.documento_tipo = d.tipo; o.documento = d.documento;
  }
  return o;
}

// ── Lista ──
r.get('/clientes', ver, async (req, res) => {
  const E = req.empresaId, w = ['c.empresa_id = $1'], p = [E];
  const t = String(req.query.q || '').trim();
  if (t) {
    p.push(`%${t}%`); const i = p.length;
    const doc = limpiarRut(t);
    let porDoc = `c.documento ILIKE $${i}`;
    if (doc.length >= 3) { p.push(`%${doc}%`); porDoc += ` OR replace(c.documento, '-', '') ILIKE $${p.length}`; }
    w.push(`((c.nombre || ' ' || coalesce(c.apellidos,'')) ILIKE $${i} OR c.correo ILIKE $${i} OR c.telefono ILIKE $${i} OR c.razon_social ILIKE $${i} OR ${porDoc})`);
  }
  if (req.query.lista_negra === '1') w.push('c.lista_negra');
  if (req.query.licencia_vencida === '1') w.push(`c.tipo = 'persona' AND (c.licencia_vence IS NULL OR c.licencia_vence < (now() AT TIME ZONE 'America/Santiago')::date)`);
  if (req.query.tipo === 'empresa' || req.query.tipo === 'persona') { p.push(req.query.tipo); w.push(`c.tipo = $${p.length}`); }
  const limite = Math.min(Number(req.query.limite) || 200, 1000);
  const filas = await q(`SELECT c.id, c.tipo, c.nombre, c.apellidos, c.documento_tipo, c.documento, c.correo, c.telefono, c.ciudad, c.nacionalidad, c.fecha_nacimiento,
      c.licencia_clase, c.licencia_vence, c.lista_negra, c.lista_negra_motivo, c.creado_en,
      (SELECT count(*)::int FROM reservas r WHERE r.empresa_id = c.empresa_id AND r.cliente_id = c.id AND r.estado IN ('en_curso','devuelta','cerrada')) AS arriendos,
      (SELECT max(r.inicio) FROM reservas r WHERE r.empresa_id = c.empresa_id AND r.cliente_id = c.id AND r.estado NOT IN ('cancelada','cotizacion')) AS ultimo_arriendo
    FROM clientes c WHERE ${w.join(' AND ')} ORDER BY c.lista_negra DESC, c.creado_en DESC LIMIT ${limite}`, p);
  const totales = await uno(`SELECT count(*)::int AS total, count(*) FILTER (WHERE lista_negra)::int AS lista_negra,
      count(*) FILTER (WHERE tipo = 'persona' AND (licencia_vence IS NULL OR licencia_vence < (now() AT TIME ZONE 'America/Santiago')::date))::int AS licencia_vencida
    FROM clientes WHERE empresa_id = $1`, [E]);
  res.json({ clientes: filas, totales });
});

// ── Alta ──
r.post('/clientes', editar, async (req, res) => {
  const E = req.empresaId, o = camposCliente({ documento_tipo: 'rut', ...req.body });
  const dup = await uno('SELECT id, nombre, apellidos FROM clientes WHERE empresa_id = $1 AND documento_tipo = $2 AND documento = $3', [E, o.documento_tipo, o.documento]);
  if (dup) throw new ErrorHttp(409, `Ya existe un cliente con ese documento: ${dup.nombre} ${dup.apellidos || ''}`.trim(), { campo: 'documento', cliente_id: dup.id });
  o.origen = ['counter', 'portal', 'agencia', 'telefono'].includes(req.body.origen) ? req.body.origen : 'counter';
  const ks = Object.keys(o);
  const [c] = await q(`INSERT INTO clientes (empresa_id, ${ks.join(', ')}) VALUES ($1, ${ks.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [E, ...ks.map((k) => o[k])]);
  await registrar(req, 'cliente_creado', 'cliente', c.id, { documento: c.documento });
  res.status(201).json(c);
});

// ── Ficha ──
r.get('/clientes/:id', ver, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const cliente = await uno(`SELECT c.*, u.nombre AS lista_negra_por_nombre FROM clientes c LEFT JOIN usuarios u ON u.id = c.lista_negra_por WHERE c.id = $1 AND c.empresa_id = $2`, [id, E]);
  if (!cliente) throw new ErrorHttp(404, 'Cliente no encontrado');
  const [conductores, documentos, reservas, incidentes, multas, bitacora] = await Promise.all([
    q('SELECT * FROM conductores WHERE empresa_id = $1 AND cliente_id = $2 ORDER BY id', [E, id]),
    q(`SELECT a.id, a.entidad, a.entidad_id, a.tipo, a.nombre, a.mime, a.tamano, a.creado_en, u.nombre AS subido_por_nombre FROM archivos a LEFT JOIN usuarios u ON u.id = a.subido_por
        WHERE a.empresa_id = $1 AND ((a.entidad = 'cliente' AND a.entidad_id = $2) OR (a.entidad = 'conductor' AND a.entidad_id IN (SELECT id FROM conductores WHERE empresa_id = $1 AND cliente_id = $2)))
        ORDER BY a.creado_en DESC`, [E, id]),
    q(`SELECT r.id, r.folio, r.estado, r.inicio, r.fin, r.total, v.patente, v.marca, v.modelo, (r.estado = 'en_curso' AND r.fin < now()) AS atrasada
        FROM reservas r LEFT JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.empresa_id = $1 AND r.cliente_id = $2 ORDER BY r.inicio DESC LIMIT 100`, [E, id]),
    q(`SELECT i.id, i.folio, i.tipo, i.estado, i.descripcion, i.monto_cliente, i.creado_en, v.patente FROM incidentes i LEFT JOIN vehiculos v ON v.id = i.vehiculo_id
        WHERE i.empresa_id = $1 AND i.cliente_id = $2 ORDER BY i.creado_en DESC`, [E, id]),
    q(`SELECT m.id, m.fecha_infraccion, m.motivo, m.lugar, m.monto, m.estado, m.patente, r.folio FROM multas m LEFT JOIN reservas r ON r.id = m.reserva_id
        WHERE m.empresa_id = $1 AND (m.cliente_id = $2 OR r.cliente_id = $2) ORDER BY m.fecha_infraccion DESC`, [E, id]),
    q(`SELECT b.accion, b.detalle, b.creado_en, u.nombre AS usuario FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id WHERE b.empresa_id = $1 AND b.entidad = 'cliente' AND b.entidad_id = $2 ORDER BY b.creado_en DESC LIMIT 30`, [E, id])
  ]);
  const stats = {
    arriendos: reservas.filter((x) => ['en_curso', 'devuelta', 'cerrada'].includes(x.estado)).length,
    total_facturado: reservas.filter((x) => ['en_curso', 'devuelta', 'cerrada'].includes(x.estado)).reduce((s, x) => s + Number(x.total), 0),
    incidentes: incidentes.filter((x) => x.estado !== 'anulado').length, multas: multas.length,
    proxima_fin: reservas.filter((x) => ['confirmada', 'en_curso'].includes(x.estado)).map((x) => x.fin).sort().pop() || null
  };
  res.json({ cliente, conductores, documentos, reservas, incidentes, multas, bitacora, stats });
});

// ── Edición ──
r.patch('/clientes/:id', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const act = await uno('SELECT id FROM clientes WHERE id = $1 AND empresa_id = $2', [id, E]);
  if (!act) throw new ErrorHttp(404, 'Cliente no encontrado');
  const b = { ...req.body }; delete b.lista_negra; delete b.lista_negra_motivo;
  const o = camposCliente(b, true);
  if (o.documento) {
    const dup = await uno('SELECT id FROM clientes WHERE empresa_id = $1 AND documento_tipo = $2 AND documento = $3 AND id <> $4', [E, o.documento_tipo, o.documento, id]);
    if (dup) throw new ErrorHttp(409, 'Ya existe otro cliente con ese documento', { campo: 'documento' });
  }
  const ks = Object.keys(o);
  if (!ks.length) return res.json(await uno('SELECT * FROM clientes WHERE id = $1', [id]));
  const [c] = await q(`UPDATE clientes SET ${ks.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND empresa_id = $2 RETURNING *`, [id, E, ...ks.map((k) => o[k])]);
  await registrar(req, 'cliente_editado', 'cliente', id, { campos: ks });
  res.json(c);
});

// ── Lista negra (motivo obligatorio; administrador y counter) ──
r.post('/clientes/:id/lista-negra', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  if (!['administrador', 'counter', 'superadmin', 'soporte'].includes(req.usuario.rol)) throw new ErrorHttp(403, 'Solo administradores y counter cambian la lista negra');
  const activa = !!req.body.lista_negra, motivo = txt(req.body.motivo, 1000);
  if (!motivo) throw new ErrorHttp(400, activa ? 'Indica el motivo para agregar a la lista negra' : 'Indica el motivo para sacar de la lista negra', { campo: 'motivo' });
  const [c] = await q(`UPDATE clientes SET lista_negra = $3, lista_negra_motivo = CASE WHEN $3 THEN $4 ELSE NULL END, lista_negra_en = CASE WHEN $3 THEN now() ELSE NULL END,
      lista_negra_por = CASE WHEN $3 THEN $5::bigint ELSE NULL END WHERE id = $1 AND empresa_id = $2 RETURNING *`, [id, E, activa, motivo, req.usuario.id]);
  if (!c) throw new ErrorHttp(404, 'Cliente no encontrado');
  await registrar(req, activa ? 'cliente_lista_negra_agregado' : 'cliente_lista_negra_quitado', 'cliente', id, { motivo });
  res.json(c);
});

// ── Documentos (foto desde cámara o archivo; reducida en el navegador con reducirImagen) ──
r.post('/clientes/:id/documentos', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  const { tipo, dataUrl, conductor_id = null, nombre = null } = req.body;
  if (!TIPOS_DOCUMENTO_CLIENTE[tipo]) throw new ErrorHttp(400, 'Tipo de documento desconocido');
  if (!(await uno('SELECT 1 AS ok FROM clientes WHERE id = $1 AND empresa_id = $2', [id, E]))) throw new ErrorHttp(404, 'Cliente no encontrado');
  let entidad = 'cliente', entidadId = id;
  if (conductor_id) {
    const cd = await uno('SELECT id FROM conductores WHERE id = $1 AND cliente_id = $2 AND empresa_id = $3', [Number(conductor_id), id, E]);
    if (!cd) throw new ErrorHttp(404, 'Conductor no encontrado');
    entidad = 'conductor'; entidadId = cd.id;
  }
  const { mime, datos } = desdeDataUrl(dataUrl);
  if (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(mime)) throw new ErrorHttp(400, 'Sube una foto (JPG/PNG) o un PDF');
  const a = await guardarArchivo({ empresaId: E, entidad, entidadId, tipo, nombre: nombre || `${TIPOS_DOCUMENTO_CLIENTE[tipo]}.${mime === 'application/pdf' ? 'pdf' : 'jpg'}`, mime, datos, meta: { origen: 'counter' }, usuarioId: req.usuario.id });
  await registrar(req, 'cliente_documento_subido', 'cliente', id, { tipo, archivo_id: a.id, conductor_id });
  res.status(201).json({ id: a.id, tipo: a.tipo, nombre: a.nombre, mime: a.mime, entidad: a.entidad, entidad_id: a.entidad_id, creado_en: a.creado_en });
});

r.delete('/clientes/:id/documentos/:archivoId', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id), aid = idDe(req.params.archivoId, 'Documento');
  const a = await uno(`SELECT id, tipo FROM archivos WHERE id = $1 AND empresa_id = $2 AND ((entidad = 'cliente' AND entidad_id = $3)
      OR (entidad = 'conductor' AND entidad_id IN (SELECT id FROM conductores WHERE empresa_id = $2 AND cliente_id = $3)))`, [aid, E, id]);
  if (!a) throw new ErrorHttp(404, 'Documento no encontrado');
  await borrarArchivo(E, aid);
  await registrar(req, 'cliente_documento_borrado', 'cliente', id, { tipo: a.tipo, archivo_id: aid });
  res.json({ ok: true });
});

// ── Conductores adicionales ──
function camposConductor(b) {
  const nombre = txt(b.nombre, 120);
  if (!nombre) throw new ErrorHttp(400, 'Falta el nombre del conductor', { campo: 'nombre' });
  let documento_tipo = b.documento_tipo || 'rut', documento = null;
  if (b.documento) ({ tipo: documento_tipo, documento } = normalizarDocumento(documento_tipo, b.documento));
  return { nombre, documento_tipo, documento, fecha_nacimiento: fechaONull(b.fecha_nacimiento, 'fecha_nacimiento'), licencia_numero: txt(b.licencia_numero), licencia_clase: txt(b.licencia_clase), licencia_vence: fechaONull(b.licencia_vence, 'licencia_vence') };
}

r.post('/clientes/:id/conductores', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id);
  if (!(await uno('SELECT 1 AS ok FROM clientes WHERE id = $1 AND empresa_id = $2', [id, E]))) throw new ErrorHttp(404, 'Cliente no encontrado');
  const o = camposConductor(req.body);
  const [c] = await q(`INSERT INTO conductores (empresa_id, cliente_id, nombre, documento_tipo, documento, fecha_nacimiento, licencia_numero, licencia_clase, licencia_vence)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [E, id, o.nombre, o.documento_tipo, o.documento, o.fecha_nacimiento, o.licencia_numero, o.licencia_clase, o.licencia_vence]);
  await registrar(req, 'conductor_agregado', 'cliente', id, { conductor_id: c.id, nombre: c.nombre });
  res.status(201).json(c);
});

r.patch('/clientes/:id/conductores/:cid', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id), cid = idDe(req.params.cid, 'Conductor');
  const o = camposConductor(req.body);
  const [c] = await q(`UPDATE conductores SET nombre = $4, documento_tipo = $5, documento = $6, fecha_nacimiento = $7, licencia_numero = $8, licencia_clase = $9, licencia_vence = $10
    WHERE id = $1 AND cliente_id = $2 AND empresa_id = $3 RETURNING *`, [cid, id, E, o.nombre, o.documento_tipo, o.documento, o.fecha_nacimiento, o.licencia_numero, o.licencia_clase, o.licencia_vence]);
  if (!c) throw new ErrorHttp(404, 'Conductor no encontrado');
  await registrar(req, 'conductor_editado', 'cliente', id, { conductor_id: cid });
  res.json(c);
});

r.delete('/clientes/:id/conductores/:cid', editar, async (req, res) => {
  const E = req.empresaId, id = idDe(req.params.id), cid = idDe(req.params.cid, 'Conductor');
  const usado = await uno(`SELECT folio FROM reservas WHERE empresa_id = $1 AND cliente_id = $2 AND estado IN ('confirmada','en_curso') AND conductores @> $3::jsonb LIMIT 1`, [E, id, JSON.stringify([cid])]);
  if (usado) throw new ErrorHttp(409, `El conductor está en la reserva ${usado.folio}; quítalo de la reserva primero.`);
  const [c] = await q('DELETE FROM conductores WHERE id = $1 AND cliente_id = $2 AND empresa_id = $3 RETURNING id, nombre', [cid, id, E]);
  if (!c) throw new ErrorHttp(404, 'Conductor no encontrado');
  await registrar(req, 'conductor_eliminado', 'cliente', id, { conductor_id: cid, nombre: c.nombre });
  res.json({ ok: true });
});

export default r;
