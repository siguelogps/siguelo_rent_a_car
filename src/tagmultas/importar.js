// Importación de TAG y multas (desde archivo o desde el dashboard Síguelo): sin duplicados (huella) y con asignación automática.
import crypto from 'node:crypto';
import { q } from '../db.js';
import { asignarTag, asignarMultas } from './asignar.js';
import { leerArchivo, analizar, filaARegistro, CAMPOS } from './archivo.js';

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
export const huellaTag = (r) => sha1(`${r.patente}|${new Date(r.fecha_hora).toISOString()}|${r.portico || ''}|${r.monto}`);
export const huellaMulta = (r) => sha1(`multa|${r.patente}|${new Date(r.fecha_infraccion).toISOString()}|${r.rol_causa || ''}|${r.motivo || ''}|${r.monto}`);

// registros: ya normalizados ({ patente, fecha_hora, portico, autopista, monto } o { patente, fecha_infraccion, hora_conocida, … })
export async function importarRegistros(empresaId, tipo, registros, { origen, nombreArchivo = null, usuarioId = null, errores = [], filas = null } = {}) {
  const [imp] = await q(`INSERT INTO importaciones (empresa_id, tipo, origen, nombre_archivo, filas, usuario_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [empresaId, tipo, origen, nombreArchivo, filas ?? registros.length + errores.length, usuarioId]);
  const nuevos = [];
  for (const r of registros) {
    const patente = String(r.patente).toUpperCase().replace(/[^A-Z0-9]/g, '');
    let f;
    if (tipo === 'tag') {
      [f] = await q(`INSERT INTO tag_transitos (empresa_id, patente, fecha_hora, portico, autopista, concesionaria, monto, monto_neto, origen, huella, importacion_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (empresa_id, huella) DO NOTHING RETURNING id`,
      [empresaId, patente, r.fecha_hora, r.portico || null, r.autopista || null, r.concesionaria || r.autopista || null, Math.round(Number(r.monto) || 0), r.monto_neto ?? null, origen, r.huella || huellaTag({ ...r, patente }), imp.id]);
    } else {
      [f] = await q(`INSERT INTO multas (empresa_id, patente, fecha_infraccion, hora_conocida, motivo, lugar, juzgado, rol_causa, tipo, monto, origen, huella, importacion_id, sin_valorizar)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (empresa_id, huella) DO NOTHING RETURNING id`,
      [empresaId, patente, r.fecha_infraccion, !!r.hora_conocida, r.motivo || null, r.lugar || null, r.juzgado || null, r.rol_causa || null, r.tipo || null, Math.round(Number(r.monto) || 0), origen, r.huella || huellaMulta({ ...r, patente }), imp.id, !!r.sin_valorizar]);
    }
    if (f) nuevos.push(f.id);
  }
  let asig = { asignados: 0, asignadas: 0, sin_contrato: 0, revisar: 0 };
  if (nuevos.length) asig = { ...asig, ...(tipo === 'tag' ? await asignarTag(empresaId, nuevos) : await asignarMultas(empresaId, nuevos)) };
  const asignadas = asig.asignados + asig.asignadas;
  const [fila] = await q(`UPDATE importaciones SET nuevas = $2, duplicadas = $3, asignadas = $4, sin_contrato = $5, errores = $6 WHERE id = $1 RETURNING *`,
    [imp.id, nuevos.length, registros.length - nuevos.length, asignadas, asig.sin_contrato, JSON.stringify(errores.slice(0, 200))]);
  return { ...fila, revisar: asig.revisar, total_errores: errores.length };
}

// Paso 1 del asistente: leer el archivo y proponer el mapeo de columnas.
export async function previsualizar(buf, nombre, tipo, { mapeo = null, filaEncabezados = null } = {}) {
  const arch = await leerArchivo(buf, nombre);
  if (!arch.filas.length) throw new Error('El archivo está vacío');
  const a = analizar(arch.filas, tipo);
  if (filaEncabezados != null && arch.filas[filaEncabezados]) {
    a.fila_encabezados = Number(filaEncabezados);
    a.encabezados = arch.filas[a.fila_encabezados].map((x, i) => String(x ?? '').trim() || `Columna ${i + 1}`);
    a.datos = arch.filas.slice(a.fila_encabezados + 1);
  }
  if (mapeo) a.mapeo = mapeo;
  const muestra = a.datos.slice(0, 8).map((f) => f.map((x) => (x instanceof Date ? x.toISOString().replace('T', ' ').slice(0, 19).replace(' 00:00:00', '') : x)));
  // vista previa de cómo quedarían las primeras filas
  const interpretadas = a.datos.slice(0, 8).map((f) => { const r = filaARegistro(f, a.mapeo, tipo); return r.error ? { error: r.error } : r; });
  return { formato: arch.formato, codificacion: arch.codificacion || null, separador: arch.separador || null, fila_encabezados: a.fila_encabezados, encabezados: a.encabezados, mapeo: a.mapeo, campos: CAMPOS[tipo], muestra, interpretadas, total: a.datos.length };
}

// Paso 2: importar con el mapeo confirmado por el usuario.
export async function importarArchivo(empresaId, buf, nombre, tipo, { mapeo = null, filaEncabezados = null, usuarioId = null } = {}) {
  const arch = await leerArchivo(buf, nombre);
  const a = analizar(arch.filas, tipo);
  const datos = filaEncabezados != null ? arch.filas.slice(Number(filaEncabezados) + 1) : a.datos;
  const m = mapeo || a.mapeo;
  const faltan = CAMPOS[tipo].filter((c) => c.requerido && m[c.clave] == null && !(c.clave === 'fecha' && m.fecha_hora != null));
  if (faltan.length) throw Object.assign(new Error(`Falta indicar la columna de: ${faltan.map((c) => c.etiqueta).join(', ')}`), { estado: 400 });
  if (tipo === 'tag' && m.fecha_hora == null && m.fecha == null) throw Object.assign(new Error('Falta indicar la columna de fecha'), { estado: 400 });
  const registros = [], errores = [];
  datos.forEach((f, i) => {
    const r = filaARegistro(f, m, tipo);
    if (r.error) errores.push({ fila: i + 2 + (filaEncabezados ?? a.fila_encabezados), error: r.error });
    else registros.push(r);
  });
  return importarRegistros(empresaId, tipo, registros, { origen: arch.formato, nombreArchivo: nombre, usuarioId, errores, filas: datos.length });
}
