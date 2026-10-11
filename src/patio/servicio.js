// Entrega y devolución: lectura de reservas e inspecciones, daños, comparación entrega ↔ devolución y cierre de la inspección.
import { q, uno, transaccion } from '../db.js';
import { ErrorHttp } from '../auth.js';
import { lecturaActual } from '../gps/index.js';
import { guardarArchivo, desdeDataUrl } from '../almacenamiento/index.js';
import { aplicarEntrega, aplicarDevolucion } from './estado.js';
import { crearIncidente } from './incidentes.js';
import { OBLIGATORIAS, POSICIONES, CHECKLIST, CHECKLIST_DEFECTO, FOTO_DE_VISTA, TIPOS_DANO, nombrePosicion } from '../../public/js/patio-comun.js';
import { zonaDano } from '../../public/esquema.js';

export { OBLIGATORIAS, POSICIONES };

export async function cargarReserva(E, id) {
  const r = await uno(
    `SELECT r.id, r.folio, r.estado, r.inicio, r.fin, r.retiro_real, r.devolucion_real, r.km_incluidos, r.precio_km_extra, r.deducible, r.garantia,
            r.cliente_id, r.vehiculo_id, r.sucursal_retiro_id, r.sucursal_devolucion_id,
            c.nombre || ' ' || COALESCE(c.apellidos, '') AS cliente_nombre, c.documento_tipo, c.documento, c.telefono, c.correo,
            v.patente, v.marca, v.modelo, v.anio, v.color, v.capacidad_estanque, v.km AS vehiculo_km, v.combustible_nivel,
            sr.nombre AS sucursal_retiro, sd.nombre AS sucursal_devolucion, sr.lat AS retiro_lat, sr.lng AS retiro_lng, sd.lat AS devolucion_lat, sd.lng AS devolucion_lng,
            ct.id AS contrato_id, ct.folio AS contrato_folio, ct.estado AS contrato_estado
       FROM reservas r
       LEFT JOIN clientes c ON c.id = r.cliente_id
       LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
       LEFT JOIN sucursales sr ON sr.id = r.sucursal_retiro_id
       LEFT JOIN sucursales sd ON sd.id = r.sucursal_devolucion_id
       LEFT JOIN LATERAL (SELECT id, folio, estado FROM contratos WHERE empresa_id = r.empresa_id AND reserva_id = r.id AND estado <> 'anulado' ORDER BY id DESC LIMIT 1) ct ON TRUE
      WHERE r.id = $1 AND r.empresa_id = $2`, [id, E]);
  if (!r) throw new ErrorHttp(404, 'Reserva no encontrada');
  r.cliente_nombre = r.cliente_nombre?.trim() || null;
  return r;
}

export const tipoPara = (estado) => (estado === 'confirmada' ? 'entrega' : estado === 'en_curso' ? 'devolucion' : null);

export async function inspeccionDe(E, reservaId, tipo) {
  return uno(`SELECT i.*, s.nombre AS sucursal, u.nombre AS realizado_por_nombre FROM inspecciones i
      LEFT JOIN sucursales s ON s.id = i.sucursal_id LEFT JOIN usuarios u ON u.id = i.realizado_por
      WHERE i.empresa_id = $1 AND i.reserva_id = $2 AND i.tipo = $3`, [E, reservaId, tipo]);
}

export async function cargarInspeccion(E, id) {
  const i = await uno('SELECT * FROM inspecciones WHERE id = $1 AND empresa_id = $2', [id, E]);
  if (!i) throw new ErrorHttp(404, 'Inspección no encontrada');
  return i;
}

export const fotosDe = (E, inspeccionId) => q(
  'SELECT posicion, archivo_id, lat, lng, tomada_en FROM inspeccion_fotos WHERE empresa_id = $1 AND inspeccion_id = $2 ORDER BY id', [E, inspeccionId]);

const COLS_DANO = `d.id, d.vehiculo_id, d.inspeccion_id, d.vista, d.x, d.y, d.tipo, d.descripcion, d.archivo_id, d.estado, d.incidente_id, d.creado_en, d.reparado_en,
  i.tipo AS inspeccion_tipo, r.folio AS reserva_folio, inc.folio AS incidente_folio, inc.estado AS incidente_estado`;
const JOIN_DANO = `FROM danos d LEFT JOIN inspecciones i ON i.id = d.inspeccion_id LEFT JOIN reservas r ON r.id = i.reserva_id LEFT JOIN incidentes inc ON inc.id = d.incidente_id`;

// Daños activos del vehículo (opcionalmente sin los registrados en una inspección)
export async function danosActivos(E, vehiculoId, excluirInspeccion = null) {
  return q(`SELECT ${COLS_DANO} ${JOIN_DANO} WHERE d.empresa_id = $1 AND d.vehiculo_id = $2 AND d.estado = 'activo'
    AND ($3::bigint IS NULL OR d.inspeccion_id IS DISTINCT FROM $3::bigint) ORDER BY d.creado_en, d.id`, [E, vehiculoId, excluirInspeccion]);
}
export async function danosDeInspeccion(E, inspeccionId) {
  return q(`SELECT ${COLS_DANO} ${JOIN_DANO} WHERE d.empresa_id = $1 AND d.inspeccion_id = $2 ORDER BY d.creado_en, d.id`, [E, inspeccionId]);
}

const descripcionDano = (d) => d.descripcion || `${TIPOS_DANO[d.tipo] || 'Daño'} ${zonaDano(d.vista, d.x, d.y).replace(/^./, (c) => c.toLowerCase())}`;
export const numerar = (lista, desde = 1, extra = {}) => lista.map((d, k) => ({ ...d, n: desde + k, titulo: descripcionDano(d), zona: zonaDano(d.vista, d.x, d.y), ...extra }));

// Crea (o devuelve) el borrador de la inspección del tipo indicado.
export async function asegurarInspeccion(E, reserva, tipo, usuario) {
  let i = await inspeccionDe(E, reserva.id, tipo);
  if (i) return i;
  const lect = await lecturaActual(E, reserva.vehiculo_id);
  let checklist = { ...CHECKLIST_DEFECTO, notas: {} };
  if (tipo === 'devolucion') {
    const ent = await inspeccionDe(E, reserva.id, 'entrega');
    if (ent?.checklist) checklist = { ...CHECKLIST_DEFECTO, ...ent.checklist, notas: {} };
  }
  const sucursalId = tipo === 'entrega' ? reserva.sucursal_retiro_id : reserva.sucursal_devolucion_id;
  await q(`INSERT INTO inspecciones (empresa_id, reserva_id, vehiculo_id, tipo, km_gps, combustible_gps, checklist, sucursal_id, realizado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (reserva_id, tipo) DO NOTHING`,
    [E, reserva.id, reserva.vehiculo_id, tipo, lect?.origen === 'plataforma_gps' ? lect.km : null, lect?.origen === 'plataforma_gps' ? lect.combustible : null,
      JSON.stringify(checklist), sucursalId || usuario?.sucursal_id || null, usuario?.id || null]);
  i = await inspeccionDe(E, reserva.id, tipo);
  return i;
}

// Todo lo que necesita el asistente del celular para una reserva.
export async function estadoPatio(E, reservaId, { tipo = null } = {}) {
  const reserva = await cargarReserva(E, reservaId);
  const tipoAccion = tipoPara(reserva.estado);
  const t = tipo || tipoAccion || 'devolucion';
  const inspeccion = await inspeccionDe(E, reserva.id, t);
  const entrega = t === 'devolucion' ? await inspeccionDe(E, reserva.id, 'entrega') : null;
  const fotos = inspeccion ? await fotosDe(E, inspeccion.id) : [];
  const previosRaw = reserva.vehiculo_id ? await danosActivos(E, reserva.vehiculo_id, inspeccion?.id ?? null) : [];
  const nuevosRaw = inspeccion ? await danosDeInspeccion(E, inspeccion.id) : [];
  const danos_previos = numerar(previosRaw, 1, { preexistente: true });
  const danos_nuevos = numerar(nuevosRaw, danos_previos.length + 1, { preexistente: t === 'entrega' });
  const lect = reserva.vehiculo_id ? await lecturaActual(E, reserva.vehiculo_id) : null;
  const empresa = await uno('SELECT ajustes FROM empresas WHERE id = $1', [E]);
  const sucursal = t === 'entrega' ? { nombre: reserva.sucursal_retiro, lat: reserva.retiro_lat, lng: reserva.retiro_lng } : { nombre: reserva.sucursal_devolucion, lat: reserva.devolucion_lat, lng: reserva.devolucion_lng };
  return {
    reserva, tipo: t, modo: tipoAccion === t && inspeccion?.estado !== 'completa' ? t : 'lectura',
    inspeccion, fotos, obligatorias: OBLIGATORIAS,
    fotos_ok: OBLIGATORIAS.filter((p) => fotos.some((f) => f.posicion === p)).length,
    danos_previos, danos_nuevos,
    lectura: lect ? { ...lect, minutos: lect.actualizado_en ? Math.max(0, Math.round((Date.now() - new Date(lect.actualizado_en)) / 6e4)) : null } : null,
    entrega: entrega ? { id: entrega.id, estado: entrega.estado, km: entrega.km, combustible: entrega.combustible, checklist: entrega.checklist, completado_en: entrega.completado_en } : null,
    sucursal, tolerancia_min: empresa?.ajustes?.tolerancia_min ?? 59
  };
}

const ent = (v) => (v === '' || v == null ? null : Math.round(Number(v)));

// Guardado progresivo del borrador
export async function guardarBorrador(E, insp, b) {
  if (insp.estado !== 'borrador') throw new ErrorHttp(409, 'La inspección ya está completa.');
  const campos = [], vals = [];
  const set = (c, v) => { vals.push(v); campos.push(`${c} = $${vals.length + 2}`); };
  if ('km' in b) { const v = ent(b.km); if (v != null && (v < 0 || v > 2e6)) throw new ErrorHttp(400, 'Kilometraje inválido', { campo: 'km' }); set('km', v); }
  if ('combustible' in b) { const v = ent(b.combustible); if (v != null && (v < 0 || v > 8)) throw new ErrorHttp(400, 'Combustible inválido (0 a 8 octavos)', { campo: 'combustible' }); set('combustible', v); }
  if ('km_gps' in b) set('km_gps', ent(b.km_gps));
  if ('combustible_gps' in b) set('combustible_gps', ent(b.combustible_gps));
  if ('checklist' in b && b.checklist && typeof b.checklist === 'object') set('checklist', JSON.stringify(limpiarChecklist(b.checklist)));
  if ('observaciones' in b) set('observaciones', String(b.observaciones || '').slice(0, 2000) || null);
  if ('firmante_nombre' in b) set('firmante_nombre', String(b.firmante_nombre || '').slice(0, 160) || null);
  if (!campos.length) return insp;
  const [r] = await q(`UPDATE inspecciones SET ${campos.join(', ')} WHERE id = $1 AND empresa_id = $2 RETURNING *`, [insp.id, E, ...vals]);
  return r;
}

function limpiarChecklist(c) {
  const o = { notas: {} };
  for (const it of CHECKLIST) {
    const v = c[it.clave];
    if (it.tipo === 'si') o[it.clave] = v !== false;
    else if (it.tipo === 'n') o[it.clave] = Math.max(0, Math.min(9, Number(v ?? 2) || 0));
    else o[it.clave] = v === 'sucio' ? 'sucio' : 'ok';
  }
  for (const [k, v] of Object.entries(c.notas || {})) if (v && CHECKLIST.some((i) => i.clave === k)) o.notas[k] = String(v).slice(0, 300);
  if (c.mantencion) o.mantencion = true;
  return o;
}

export function validarPosicion(p) {
  return OBLIGATORIAS.includes(p) || /^extra_\d{1,2}$/.test(p);
}

// Cierra la inspección: entrega → reserva en curso; devolución → devuelta + incidentes por daños nuevos.
export async function completarInspeccion(req, insp, b) {
  const E = req.empresaId;
  if (insp.estado !== 'borrador') throw new ErrorHttp(409, 'La inspección ya está completa.');
  insp = await guardarBorrador(E, insp, b);
  const reserva = await cargarReserva(E, insp.reserva_id);
  if (tipoPara(reserva.estado) !== insp.tipo) throw new ErrorHttp(409, `La reserva está «${reserva.estado}»: no corresponde una ${insp.tipo === 'entrega' ? 'entrega' : 'devolución'}.`);
  const fotos = await fotosDe(E, insp.id);
  const faltan = OBLIGATORIAS.filter((p) => !fotos.some((f) => f.posicion === p));
  if (faltan.length) throw new ErrorHttp(400, `Faltan ${faltan.length} de ${OBLIGATORIAS.length} fotos obligatorias: ${faltan.map(nombrePosicion).join(', ')}.`, { campo: 'fotos' });
  if (insp.km == null) throw new ErrorHttp(400, 'Falta confirmar el kilometraje.', { campo: 'km' });
  if (insp.combustible == null) throw new ErrorHttp(400, 'Falta confirmar el combustible.', { campo: 'combustible' });
  if (insp.tipo === 'devolucion') {
    const e = await inspeccionDe(E, reserva.id, 'entrega');
    if (e?.km != null && insp.km < e.km) throw new ErrorHttp(400, `El kilometraje (${insp.km}) es menor que el de la entrega (${e.km}).`, { campo: 'km' });
  }
  const nombre = String(b.firmante_nombre || insp.firmante_nombre || reserva.cliente_nombre || '').trim();
  if (!b.firma) throw new ErrorHttp(400, 'Falta la firma del cliente.', { campo: 'firma' });
  const { mime, datos } = desdeDataUrl(b.firma);
  if (!mime.startsWith('image/')) throw new ErrorHttp(400, 'Firma inválida');
  const firma = await guardarArchivo({ empresaId: E, entidad: 'inspeccion', entidadId: insp.id, tipo: 'firma', nombre: `firma-${insp.tipo}-${reserva.folio}.png`, mime, datos, meta: { firmante: nombre }, usuarioId: req.usuario.id });
  const lat = b.lat != null && b.lat !== '' ? Number(b.lat) : null, lng = b.lng != null && b.lng !== '' ? Number(b.lng) : null;
  const mantencion = !!(b.mantencion ?? insp.checklist?.mantencion);
  const incidentes = await transaccion(async (tx) => {
    await tx.query(`UPDATE inspecciones SET estado = 'completa', completado_en = now(), firma_archivo_id = $3, firmante_nombre = $4, lat = COALESCE($5, lat), lng = COALESCE($6, lng), realizado_por = $7
      WHERE id = $1 AND empresa_id = $2`, [insp.id, E, firma.id, nombre || null, lat, lng, req.usuario.id]);
    const datosEstado = { empresaId: E, reservaId: reserva.id, vehiculoId: insp.vehiculo_id, km: insp.km, combustible: insp.combustible, lat, lng };
    if (insp.tipo === 'entrega') { await aplicarEntrega(tx, datosEstado); return []; }
    await aplicarDevolucion(tx, { ...datosEstado, mantencion });
    const nuevos = await tx.query(`SELECT * FROM danos WHERE empresa_id = $1 AND inspeccion_id = $2 AND incidente_id IS NULL ORDER BY creado_en, id`, [E, insp.id]);
    const creados = [];
    for (const d of nuevos) {
      const desc = descripcionDano(d);
      const inc = await crearIncidente(tx, { empresaId: E, tipo: 'dano', reservaId: reserva.id, vehiculoId: insp.vehiculo_id, descripcion: desc, usuarioId: req.usuario.id,
        detalleReporte: `Daño nuevo detectado en la devolución (${desc}) por ${req.usuario.nombre}` });
      await tx.query('UPDATE danos SET incidente_id = $1 WHERE id = $2', [inc.id, d.id]);
      creados.push({ id: inc.id, folio: inc.folio, dano_id: d.id });
    }
    return creados;
  });
  return { inspeccion: await cargarInspeccion(E, insp.id), incidentes, reserva_id: reserva.id };
}

// ── Comparación entrega ↔ devolución (también la usa la liquidación) ──
const grupoFoto = (p) => (['frente', 'atras', 'izquierdo', 'derecho'].includes(p) ? 'exterior' : p.startsWith('esq_') ? 'esquinas' : 'interior');
const verInsp = (i) => (i ? {
  id: i.id, estado: i.estado, km: i.km, km_gps: i.km_gps, combustible: i.combustible, combustible_gps: i.combustible_gps, checklist: i.checklist, observaciones: i.observaciones,
  iniciado_en: i.iniciado_en, completado_en: i.completado_en, sucursal: i.sucursal, realizado_por: i.realizado_por_nombre, firmante_nombre: i.firmante_nombre, firma_archivo_id: i.firma_archivo_id, lat: i.lat, lng: i.lng
} : null);

export async function comparacion(E, reservaId) {
  const r = await cargarReserva(E, reservaId);
  const [ie, idv, empresa] = await Promise.all([inspeccionDe(E, r.id, 'entrega'), inspeccionDe(E, r.id, 'devolucion'), uno('SELECT ajustes FROM empresas WHERE id = $1', [E])]);
  const aj = empresa?.ajustes || {};
  const tolerancia = aj.tolerancia_min ?? 59;
  const [fe, fd] = await Promise.all([ie ? fotosDe(E, ie.id) : [], idv ? fotosDe(E, idv.id) : []]);

  // Daños: los que había al entregar y los nuevos marcados en la devolución
  let antes = [];
  if (r.vehiculo_id) {
    const corte = ie?.completado_en || ie?.iniciado_en || idv?.iniciado_en || new Date();
    antes = await q(`SELECT ${COLS_DANO} ${JOIN_DANO} WHERE d.empresa_id = $1 AND d.vehiculo_id = $2 AND ($3::bigint IS NULL OR d.inspeccion_id IS DISTINCT FROM $3::bigint)
        AND (d.creado_en <= $4 OR d.inspeccion_id = $5::bigint) AND (d.reparado_en IS NULL OR d.reparado_en > $4) ORDER BY d.creado_en, d.id`,
      [E, r.vehiculo_id, idv?.id ?? null, corte, ie?.id ?? null]);
  }
  const nuevosRaw = idv ? await danosDeInspeccion(E, idv.id) : [];
  const danosAntes = numerar(antes, 1, { nuevo: false });
  const danosNuevos = numerar(nuevosRaw, danosAntes.length + 1, { nuevo: true });

  const kmE = ie?.km ?? null, kmD = idv?.km ?? null;
  const kmRec = kmE != null && kmD != null ? Math.max(0, kmD - kmE) : null;
  const kmLibre = r.km_incluidos == null;
  const kmExtra = kmRec != null && !kmLibre ? Math.max(0, kmRec - r.km_incluidos) : 0;
  const cE = ie?.combustible ?? null, cD = idv?.combustible ?? null;
  const oct = cE != null && cD != null ? Math.max(0, cE - cD) : 0;
  const litros = r.capacidad_estanque ? Math.round((oct * r.capacidad_estanque / 8) * 10) / 10 : null;
  const horaDev = r.devolucion_real || idv?.completado_en || (idv ? new Date() : null);
  const atraso = horaDev ? Math.max(0, Math.round((new Date(horaDev) - new Date(r.fin)) / 6e4)) : 0;
  const diasExtra = atraso > 0 ? Math.floor(atraso / 1440) + (atraso % 1440 > tolerancia ? 1 : 0) : 0;

  // Checklist
  const chE = { ...CHECKLIST_DEFECTO, ...(ie?.checklist || {}) }, chD = idv ? { ...CHECKLIST_DEFECTO, ...(idv.checklist || {}) } : null;
  const diferencias = [];
  const faltantes = [];
  let trianFalt = 0;
  if (chD) {
    for (const it of CHECKLIST) {
      const a = chE[it.clave], b = chD[it.clave];
      if (it.tipo === 'si' && a !== false && b === false) { faltantes.push(it.clave); diferencias.push({ clave: it.clave, nombre: it.nombre, entrega: true, devolucion: false, texto: 'Falta' }); }
      if (it.tipo === 'n' && Number(b) < Number(a)) { trianFalt = Number(a) - Number(b); diferencias.push({ clave: it.clave, nombre: it.nombre, entrega: Number(a), devolucion: Number(b), texto: trianFalt === 1 ? 'falta uno' : `faltan ${trianFalt}` }); }
      if (it.tipo === 'limpieza' && b === 'sucio') diferencias.push({ clave: it.clave, nombre: it.nombre, entrega: a, devolucion: b, texto: chD.notas?.limpieza || 'Requiere lavado' });
    }
  }

  // Fotos lado a lado
  const posiciones = [...OBLIGATORIAS, ...new Set([...fe, ...fd].map((f) => f.posicion).filter((p) => !OBLIGATORIAS.includes(p)))];
  const ver = (f) => (f ? { archivo_id: f.archivo_id, tomada_en: f.tomada_en, lat: f.lat, lng: f.lng } : null);
  const fotos = posiciones.map((p) => ({
    posicion: p, nombre: nombrePosicion(p), grupo: grupoFoto(p),
    entrega: ver(fe.find((f) => f.posicion === p)), devolucion: ver(fd.find((f) => f.posicion === p)),
    danos_nuevos: danosNuevos.filter((d) => FOTO_DE_VISTA[d.vista] === p).map((d) => ({ n: d.n, tipo: d.tipo, id: d.id })),
    danos_previos: danosAntes.filter((d) => FOTO_DE_VISTA[d.vista] === p).map((d) => ({ n: d.n, tipo: d.tipo, id: d.id }))
  }));

  const limpio = (d) => ({ id: d.id, n: d.n, tipo: d.tipo, vista: d.vista, x: d.x, y: d.y, titulo: d.titulo, zona: d.zona, descripcion: d.descripcion, archivo_id: d.archivo_id,
    estado: d.estado, nuevo: d.nuevo, reserva_folio: d.reserva_folio, inspeccion_tipo: d.inspeccion_tipo, creado_en: d.creado_en,
    incidente_id: d.incidente_id, incidente_folio: d.incidente_folio, incidente_estado: d.incidente_estado });

  return {
    reserva: {
      id: r.id, folio: r.folio, estado: r.estado, inicio: r.inicio, fin: r.fin, retiro_real: r.retiro_real, devolucion_real: r.devolucion_real,
      km_incluidos: r.km_incluidos, precio_km_extra: r.precio_km_extra, deducible: r.deducible, garantia: r.garantia,
      cliente: { id: r.cliente_id, nombre: r.cliente_nombre, documento_tipo: r.documento_tipo, documento: r.documento },
      vehiculo: { id: r.vehiculo_id, patente: r.patente, marca: r.marca, modelo: r.modelo, anio: r.anio, capacidad_estanque: r.capacidad_estanque },
      sucursal_retiro: r.sucursal_retiro, sucursal_devolucion: r.sucursal_devolucion,
      contrato: r.contrato_id ? { id: r.contrato_id, folio: r.contrato_folio, estado: r.contrato_estado } : null
    },
    entrega: verInsp(ie), devolucion: verInsp(idv),
    completa: idv?.estado === 'completa',
    km_entrega: kmE, km_devolucion: kmD, km_recorridos: kmRec, km_incluidos: r.km_incluidos, km_libre: kmLibre, km_extra: kmExtra, precio_km_extra: r.precio_km_extra || 0,
    combustible_entrega: cE, combustible_devolucion: cD, octavos_faltantes: oct, capacidad_estanque: r.capacidad_estanque, litros_faltantes: litros,
    hora_pactada: r.fin, hora_devolucion: horaDev, atraso_minutos: atraso, tolerancia_min: tolerancia, dias_extra: diasExtra,
    danos_antes: danosAntes.length, danos_despues: danosAntes.length + danosNuevos.length,
    danos: [...danosAntes, ...danosNuevos].map(limpio), danos_nuevos: danosNuevos.map(limpio),
    checklist: { entrega: chE, devolucion: chD, diferencias, faltantes, triangulos_faltantes: trianFalt, limpieza: chD?.limpieza || null, requiere_lavado: chD?.limpieza === 'sucio' },
    fotos,
    liquidacion_url: `/liquidaciones/${r.id}`
  };
}
