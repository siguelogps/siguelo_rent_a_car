// Incidentes y daños: trazabilidad completa desde el reporte hasta el pago (presupuesto, cobro al cliente, seguro, cierre).
import express from 'express';
import { q, uno, transaccion, siguienteFolio } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { guardarArchivo, desdeDataUrl } from '../almacenamiento/index.js';
import { crearIncidente, evento } from '../patio/incidentes.js';
import { inspeccionDe, fotosDe, numerar } from '../patio/servicio.js';
import { ESTADOS_INCIDENTE, ORDEN_INCIDENTE, TIPOS_INCIDENTE, FOTO_DE_VISTA, nombrePosicion } from '../../public/js/patio-comun.js';

const r = express.Router();
const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new ErrorHttp(400, 'Identificador inválido'); return n; };
const monto = (v, campo) => {
  if (v === '' || v == null) return null;
  const n = Math.round(Number(String(v).replace(/[^\d-]/g, '')));
  if (!Number.isFinite(n) || n < 0) throw new ErrorHttp(400, 'Monto inválido', { campo });
  return n;
};

const SELECT = `SELECT i.*, v.patente, v.marca, v.modelo, v.anio, c.nombre || ' ' || COALESCE(c.apellidos, '') AS cliente_nombre, c.documento_tipo, c.documento, c.telefono, c.correo,
    r.folio AS reserva_folio, r.inicio AS reserva_inicio, r.fin AS reserva_fin, r.estado AS reserva_estado, ct.folio AS contrato_folio, u.nombre AS creado_por_nombre
  FROM incidentes i
  JOIN vehiculos v ON v.id = i.vehiculo_id
  LEFT JOIN clientes c ON c.id = i.cliente_id
  LEFT JOIN reservas r ON r.id = i.reserva_id
  LEFT JOIN contratos ct ON ct.id = i.contrato_id
  LEFT JOIN usuarios u ON u.id = i.creado_por`;

async function cargar(E, incId) {
  const i = await uno(`${SELECT} WHERE i.id = $1 AND i.empresa_id = $2`, [incId, E]);
  if (!i) throw new ErrorHttp(404, 'Incidente no encontrado');
  i.cliente_nombre = i.cliente_nombre?.trim() || null;
  return i;
}

r.get('/incidentes', requiere('incidentes'), async (req, res) => {
  const E = req.empresaId;
  const params = [E];
  let filtro = '';
  if (req.query.estado === 'abiertos') filtro += ` AND i.estado NOT IN ('cerrado','anulado')`;
  else if (ESTADOS_INCIDENTE[req.query.estado]) { params.push(req.query.estado); filtro += ` AND i.estado = $${params.length}`; }
  if (TIPOS_INCIDENTE[req.query.tipo]) { params.push(req.query.tipo); filtro += ` AND i.tipo = $${params.length}`; }
  if (req.query.vehiculo_id) { params.push(Number(req.query.vehiculo_id)); filtro += ` AND i.vehiculo_id = $${params.length}`; }
  if (req.query.reserva_id) { params.push(Number(req.query.reserva_id)); filtro += ` AND i.reserva_id = $${params.length}`; }
  const txt = String(req.query.q || '').trim();
  if (txt) {
    params.push(`%${txt}%`, `%${txt.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`);
    filtro += ` AND (i.folio ILIKE $${params.length - 1} OR v.patente ILIKE $${params.length} OR (c.nombre || ' ' || COALESCE(c.apellidos, '')) ILIKE $${params.length - 1} OR r.folio ILIKE $${params.length - 1} OR i.descripcion ILIKE $${params.length - 1})`;
  }
  const filas = await q(`${SELECT} WHERE i.empresa_id = $1${filtro} ORDER BY i.creado_en DESC, i.id DESC LIMIT 300`, params);
  for (const f of filas) f.cliente_nombre = f.cliente_nombre?.trim() || null;
  const conteo = await q('SELECT estado, count(*)::int AS n FROM incidentes WHERE empresa_id = $1 GROUP BY estado', [E]);
  const totales = await uno(`SELECT COALESCE(sum(presupuesto) FILTER (WHERE estado NOT IN ('anulado')), 0)::bigint AS presupuestado,
      COALESCE(sum(monto_cliente) FILTER (WHERE estado NOT IN ('anulado','cerrado','pagado')), 0)::bigint AS por_cobrar,
      COALESCE(sum(cobrado_cliente), 0)::bigint AS cobrado, COALESCE(sum(recupero_seguro), 0)::bigint AS recupero
    FROM incidentes WHERE empresa_id = $1`, [E]);
  res.json({ incidentes: filas, conteo: Object.fromEntries(conteo.map((c) => [c.estado, c.n])), totales });
});

r.get('/incidentes/:id', requiere('incidentes'), async (req, res) => {
  const E = req.empresaId;
  const i = await cargar(E, id(req.params.id));
  const [eventos, danosRaw, ots] = await Promise.all([
    q(`SELECT e.*, u.nombre AS usuario FROM incidente_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE e.empresa_id = $1 AND e.incidente_id = $2 ORDER BY e.creado_en, e.id`, [E, i.id]),
    q(`SELECT d.*, ins.tipo AS inspeccion_tipo FROM danos d LEFT JOIN inspecciones ins ON ins.id = d.inspeccion_id WHERE d.empresa_id = $1 AND d.incidente_id = $2 ORDER BY d.id`, [E, i.id]),
    q(`SELECT id, folio, tipo, motivo, estado, taller, costo, creado_en FROM ordenes_trabajo WHERE empresa_id = $1 AND incidente_id = $2 ORDER BY id`, [E, i.id])
  ]);
  // Fotos: entrega vs devolución de la posición del daño + foto del daño
  const danos = numerar(danosRaw);
  const fotos = [];
  if (i.reserva_id) {
    const [ie, idv] = await Promise.all([inspeccionDe(E, i.reserva_id, 'entrega'), inspeccionDe(E, i.reserva_id, 'devolucion')]);
    const [fe, fd] = await Promise.all([ie ? fotosDe(E, ie.id) : [], idv ? fotosDe(E, idv.id) : []]);
    const posiciones = [...new Set(danos.map((d) => FOTO_DE_VISTA[d.vista]).filter(Boolean))];
    if (!posiciones.length && (fe.length || fd.length)) posiciones.push('frente');
    for (const p of posiciones) {
      fotos.push({ posicion: p, nombre: nombrePosicion(p), entrega: fe.find((f) => f.posicion === p) || null, devolucion: fd.find((f) => f.posicion === p) || null,
        danos: danos.filter((d) => FOTO_DE_VISTA[d.vista] === p).map((d) => ({ n: d.n, tipo: d.tipo })) });
    }
    i.entrega = ie ? { id: ie.id, completado_en: ie.completado_en, km: ie.km } : null;
    i.devolucion = idv ? { id: idv.id, completado_en: idv.completado_en, km: idv.km } : null;
  }
  const adjuntos = await q(`SELECT id, tipo, nombre, mime, creado_en FROM archivos WHERE empresa_id = $1 AND entidad = 'incidente' AND entidad_id = $2 ORDER BY id`, [E, i.id]);
  res.json({ ...i, eventos, danos, fotos, ordenes: ots, adjuntos });
});

// Alta manual (accidente, robo, falla mecánica, daño fuera de la devolución…)
r.post('/incidentes', requiere('incidentes', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const b = req.body || {};
  if (!TIPOS_INCIDENTE[b.tipo]) throw new ErrorHttp(400, 'Tipo de incidente inválido', { campo: 'tipo' });
  let vehiculoId = b.vehiculo_id ? Number(b.vehiculo_id) : null;
  let reservaId = b.reserva_id ? Number(b.reserva_id) : null;
  if (!reservaId && b.reserva_folio) reservaId = (await uno('SELECT id FROM reservas WHERE empresa_id = $1 AND upper(folio) = upper($2)', [E, String(b.reserva_folio).trim()]))?.id || null;
  if (reservaId) {
    const rv = await uno('SELECT id, vehiculo_id FROM reservas WHERE id = $1 AND empresa_id = $2', [reservaId, E]);
    if (!rv) throw new ErrorHttp(404, 'Reserva no encontrada', { campo: 'reserva_folio' });
    vehiculoId = vehiculoId || rv.vehiculo_id;
  }
  if (!vehiculoId && b.patente) vehiculoId = (await uno('SELECT id FROM vehiculos WHERE empresa_id = $1 AND patente = $2', [E, String(b.patente).toUpperCase().replace(/[^A-Z0-9]/g, '')]))?.id || null;
  if (!vehiculoId) throw new ErrorHttp(400, 'Indica el vehículo (patente) o la reserva', { campo: 'patente' });
  const v = await uno('SELECT id FROM vehiculos WHERE id = $1 AND empresa_id = $2', [vehiculoId, E]);
  if (!v) throw new ErrorHttp(404, 'Vehículo no encontrado', { campo: 'patente' });
  const descripcion = String(b.descripcion || '').trim().slice(0, 2000);
  if (!descripcion) throw new ErrorHttp(400, 'Describe lo ocurrido', { campo: 'descripcion' });
  // Una foto (dataUrl, la web) o varias (fotos: [dataUrl], la app nativa; hasta 8). Se revisan antes de crear el
  // incidente: así una foto mala no deja un incidente a medias que el reintento duplicaría.
  const fotos = [...(b.dataUrl ? [b.dataUrl] : []), ...(Array.isArray(b.fotos) ? b.fotos : [])].slice(0, 8).map((f) => {
    let x;
    try { x = desdeDataUrl(f); } catch { throw new ErrorHttp(400, 'Una de las fotos no se pudo leer', { campo: 'fotos' }); }
    if (!x.mime.startsWith('image/')) throw new ErrorHttp(400, 'Las fotos deben ser imágenes', { campo: 'fotos' });
    return x;
  });
  const inc = await transaccion((tx) => crearIncidente(tx, { empresaId: E, tipo: b.tipo, reservaId, vehiculoId, descripcion, deducible: monto(b.deducible, 'deducible'), usuarioId: req.usuario.id,
    detalleReporte: `${TIPOS_INCIDENTE[b.tipo]} reportado por ${req.usuario.nombre}: ${descripcion}` }));
  for (const [k, { mime, datos }] of fotos.entries()) {
    await guardarArchivo({ empresaId: E, entidad: 'incidente', entidadId: inc.id, tipo: 'foto', nombre: fotos.length > 1 ? `${inc.folio}-${k + 1}.jpg` : `${inc.folio}.jpg`, mime, datos, usuarioId: req.usuario.id });
  }
  await registrar(req, 'incidente_creado', 'incidente', inc.id, { folio: inc.folio, tipo: b.tipo, origen: 'manual' });
  res.json(inc);
});

// Presupuesto de reparación → monto al cliente = menor entre presupuesto y deducible (editable con motivo)
r.post('/incidentes/:id/presupuesto', requiere('incidentes', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const i = await cargar(E, id(req.params.id));
  if (['cerrado', 'anulado'].includes(i.estado)) throw new ErrorHttp(409, 'El incidente está cerrado.');
  const b = req.body || {};
  const presupuesto = monto(b.presupuesto, 'presupuesto');
  if (presupuesto == null) throw new ErrorHttp(400, 'Indica el monto del presupuesto', { campo: 'presupuesto' });
  const deducible = 'deducible' in b ? monto(b.deducible, 'deducible') : i.deducible;
  const sugerido = deducible != null ? Math.min(presupuesto, deducible) : presupuesto;
  let mc = 'monto_cliente' in b && b.monto_cliente !== '' && b.monto_cliente != null ? monto(b.monto_cliente, 'monto_cliente') : sugerido;
  const motivo = String(b.motivo || '').trim();
  if (mc !== sugerido && !motivo) throw new ErrorHttp(400, 'Indica el motivo para cambiar el monto a cobrar al cliente', { campo: 'motivo' });
  const taller = String(b.taller || '').trim().slice(0, 160) || null;
  await transaccion(async (tx) => {
    await tx.query(`UPDATE incidentes SET presupuesto = $3, taller = $4, deducible = $5, monto_cliente = $6, estado = CASE WHEN estado = 'reportado' THEN 'presupuestado' ELSE estado END
      WHERE id = $1 AND empresa_id = $2`, [i.id, E, presupuesto, taller, deducible, mc]);
    await evento(tx, { empresaId: E, incidenteId: i.id, tipo: 'presupuesto', monto: presupuesto, usuarioId: req.usuario.id,
      detalle: `Presupuesto${taller ? ` de ${taller}` : ''}. Monto al cliente: $${mc.toLocaleString('es-CL')}${mc !== sugerido ? ` (ajustado: ${motivo})` : deducible != null ? ' (menor entre presupuesto y deducible)' : ''}` });
  });
  await registrar(req, 'incidente_presupuesto', 'incidente', i.id, { presupuesto, monto_cliente: mc, motivo: motivo || null });
  res.json(await cargar(E, i.id));
});

// Cambio de estado con sus datos: cobrado_cliente {cobrado}, en_seguro {numero_siniestro, compania_seguro}, pagado {recupero_seguro}, cerrado {costo_real}, anulado {motivo}
r.post('/incidentes/:id/estado', requiere('incidentes', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const i = await cargar(E, id(req.params.id));
  const b = req.body || {};
  const nuevo = b.estado;
  if (!ESTADOS_INCIDENTE[nuevo]) throw new ErrorHttp(400, 'Estado inválido');
  if (['cerrado', 'anulado'].includes(i.estado)) throw new ErrorHttp(409, 'El incidente ya está cerrado.');
  if (nuevo !== 'anulado' && ORDEN_INCIDENTE.indexOf(nuevo) < ORDEN_INCIDENTE.indexOf(i.estado)) throw new ErrorHttp(409, `No se puede volver de «${ESTADOS_INCIDENTE[i.estado]}» a «${ESTADOS_INCIDENTE[nuevo]}».`);
  const sets = ['estado = $3'], vals = [nuevo];
  const set = (c, v) => { vals.push(v); sets.push(`${c} = $${vals.length + 2}`); };
  let tipoEv = 'nota', det = String(b.detalle || '').trim(), mEv = null;
  if (nuevo === 'presupuestado' && i.presupuesto == null) throw new ErrorHttp(400, 'Registra primero el presupuesto de reparación.');
  if (nuevo === 'cobrado_cliente') {
    const c = monto(b.cobrado ?? i.monto_cliente, 'cobrado');
    if (c == null) throw new ErrorHttp(400, 'Indica el monto cobrado al cliente', { campo: 'cobrado' });
    set('cobrado_cliente', c); tipoEv = 'cobro'; mEv = c; det = det || `Cobrado al cliente${i.reserva_folio ? ` (reserva ${i.reserva_folio})` : ''}`;
  }
  if (nuevo === 'en_seguro') {
    const ns = String(b.numero_siniestro || '').trim(), cia = String(b.compania_seguro || '').trim();
    if (!ns) throw new ErrorHttp(400, 'Indica el número de siniestro', { campo: 'numero_siniestro' });
    set('numero_siniestro', ns.slice(0, 80)); set('compania_seguro', cia.slice(0, 120) || null);
    tipoEv = 'seguro'; det = det || `Denunciado al seguro${cia ? ` ${cia}` : ''} · siniestro ${ns}`;
  }
  if (nuevo === 'pagado') {
    const rec = monto(b.recupero_seguro, 'recupero_seguro');
    if (rec != null) set('recupero_seguro', rec);
    tipoEv = 'pago'; mEv = rec; det = det || (rec != null ? 'Pago recibido del seguro' : 'Pago registrado');
  }
  if (nuevo === 'cerrado') {
    const cr = monto(b.costo_real, 'costo_real');
    if (cr != null) set('costo_real', cr);
    sets.push('cerrado_en = now()');
    tipoEv = 'cierre'; mEv = cr; det = det || 'Incidente cerrado: daño reparado';
  }
  if (nuevo === 'anulado') {
    if (!det) throw new ErrorHttp(400, 'Indica el motivo de la anulación', { campo: 'detalle' });
    sets.push('cerrado_en = now()'); tipoEv = 'anulacion';
  }
  await transaccion(async (tx) => {
    await tx.query(`UPDATE incidentes SET ${sets.join(', ')} WHERE id = $1 AND empresa_id = $2`, [i.id, E, ...vals]);
    if (nuevo === 'cerrado') await tx.query(`UPDATE danos SET estado = 'reparado', reparado_en = now() WHERE empresa_id = $1 AND incidente_id = $2 AND estado = 'activo'`, [E, i.id]);
    await evento(tx, { empresaId: E, incidenteId: i.id, tipo: tipoEv, detalle: det, monto: mEv, usuarioId: req.usuario.id });
  });
  await registrar(req, `incidente_${nuevo}`, 'incidente', i.id, { folio: i.folio, de: i.estado, a: nuevo });
  res.json(await cargar(E, i.id));
});

// Ajustes sin cambio de estado (descripción, costo real, monto al cliente con motivo)
r.put('/incidentes/:id', requiere('incidentes', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const i = await cargar(E, id(req.params.id));
  const b = req.body || {};
  const cambios = [];
  await transaccion(async (tx) => {
    if ('descripcion' in b) { await tx.query('UPDATE incidentes SET descripcion = $3 WHERE id = $1 AND empresa_id = $2', [i.id, E, String(b.descripcion || '').slice(0, 2000)]); cambios.push('descripción'); }
    if ('costo_real' in b) { await tx.query('UPDATE incidentes SET costo_real = $3 WHERE id = $1 AND empresa_id = $2', [i.id, E, monto(b.costo_real, 'costo_real')]); cambios.push('costo real'); }
    if ('monto_cliente' in b) {
      const mc = monto(b.monto_cliente, 'monto_cliente');
      if (mc !== i.monto_cliente && !String(b.motivo || '').trim()) throw new ErrorHttp(400, 'Indica el motivo del cambio', { campo: 'motivo' });
      await tx.query('UPDATE incidentes SET monto_cliente = $3 WHERE id = $1 AND empresa_id = $2', [i.id, E, mc]);
      await evento(tx, { empresaId: E, incidenteId: i.id, tipo: 'nota', monto: mc, usuarioId: req.usuario.id, detalle: `Monto al cliente ajustado a $${(mc ?? 0).toLocaleString('es-CL')}: ${String(b.motivo).trim()}` });
      cambios.push('monto al cliente');
    }
  });
  if (cambios.length) await registrar(req, 'incidente_editado', 'incidente', i.id, { cambios });
  res.json(await cargar(E, i.id));
});

r.post('/incidentes/:id/nota', requiere('incidentes', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const i = await cargar(E, id(req.params.id));
  const det = String(req.body?.detalle || '').trim().slice(0, 2000);
  if (!det && !req.body?.dataUrl) throw new ErrorHttp(400, 'Escribe la nota', { campo: 'detalle' });
  if (req.body?.dataUrl) {
    const { mime, datos } = desdeDataUrl(req.body.dataUrl);
    await guardarArchivo({ empresaId: E, entidad: 'incidente', entidadId: i.id, tipo: 'adjunto', nombre: String(req.body.nombre || 'adjunto').slice(0, 120), mime, datos, usuarioId: req.usuario.id });
  }
  await evento({ query: q }, { empresaId: E, incidenteId: i.id, tipo: 'nota', detalle: det || 'Adjunto agregado', usuarioId: req.usuario.id });
  res.json({ ok: true });
});

// Crea una OT correctiva en mantención ligada al incidente
r.post('/incidentes/:id/ot', requiere('incidentes', 'editar'), async (req, res) => {
  const E = req.empresaId;
  const i = await cargar(E, id(req.params.id));
  if (i.estado === 'anulado') throw new ErrorHttp(409, 'El incidente está anulado.');
  const b = req.body || {};
  const ot = await transaccion(async (tx) => {
    const folio = await siguienteFolio(E, 'OT', tx);
    const [o] = await tx.query(`INSERT INTO ordenes_trabajo (empresa_id, folio, vehiculo_id, tipo, motivo, taller, costo, estado, incidente_id, notas, creado_por, fecha_programada)
      VALUES ($1,$2,$3,'correctiva',$4,$5,$6,'programada',$7,$8,$9,$10) RETURNING *`,
      [E, folio, i.vehiculo_id, String(b.motivo || `Reparación ${i.folio}: ${i.descripcion || TIPOS_INCIDENTE[i.tipo]}`).slice(0, 300), String(b.taller || i.taller || '').slice(0, 160) || null,
        monto(b.costo, 'costo') ?? i.presupuesto ?? 0, i.id, `Generada desde el incidente ${i.folio}`, req.usuario.id, b.fecha || null]);
    await evento(tx, { empresaId: E, incidenteId: i.id, tipo: 'nota', detalle: `Orden de trabajo correctiva ${folio} creada en mantención`, usuarioId: req.usuario.id });
    return o;
  });
  await registrar(req, 'ot_desde_incidente', 'orden_trabajo', ot.id, { folio: ot.folio, incidente: i.folio });
  res.json(ot);
});

export default r;
