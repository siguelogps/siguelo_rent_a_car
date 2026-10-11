// Tarifas: precios por categoría y temporada, temporadas, extras, recargos, códigos de descuento,
// el cotizador (POST /api/tarifas/cotizar, lo usan reservas, portal y otros módulos) y el catálogo para formularios.
import express from 'express';
import { q, uno, transaccion } from '../db.js';
import { requiere, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { cotizar } from '../cotizador.js';
import { limpiar, sqlInsert, sqlUpdate, deLaEmpresa, esDuplicado } from '../flota/comun.js';

const r = express.Router();
const ver = requiere('tarifas', 'ver'), editar = requiere('tarifas', 'editar');

// Todo lo que usa la pantalla de Tarifas en una sola llamada
r.get('/tarifas', ver, async (req, res) => {
  const E = req.empresaId;
  const [categorias, temporadas, tarifas, extras, recargos, descuentos, sucursales] = await Promise.all([
    q('SELECT id, nombre, ejemplo, activa, orden FROM categorias WHERE empresa_id = $1 ORDER BY orden, nombre', [E]),
    q('SELECT * FROM temporadas WHERE empresa_id = $1 ORDER BY desde', [E]),
    q('SELECT * FROM tarifas WHERE empresa_id = $1', [E]),
    q('SELECT * FROM extras WHERE empresa_id = $1 ORDER BY activo DESC, nombre', [E]),
    q(`SELECT r.*, so.nombre AS sucursal_origen, sd.nombre AS sucursal_destino FROM recargos r
       LEFT JOIN sucursales so ON so.id = r.sucursal_origen_id LEFT JOIN sucursales sd ON sd.id = r.sucursal_destino_id
       WHERE r.empresa_id = $1 ORDER BY r.tipo, r.id`, [E]),
    q('SELECT * FROM descuentos WHERE empresa_id = $1 ORDER BY activo DESC, codigo', [E]),
    q('SELECT id, nombre FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id', [E])
  ]);
  res.json({ categorias, temporadas, tarifas, extras, recargos, descuentos, sucursales });
});

// ── Tarifa por categoría y temporada (upsert) ──
const TIPOS_TARIFA = { categoria_id: 'id', temporada_id: 'id', precio_dia: 'monto', precio_semana: 'monto', precio_mes: 'monto', km_libre: 'bool', km_dia_incluidos: 'entero', precio_km_extra: 'monto', garantia: 'monto', deducible: 'monto' };
r.put('/tarifas', editar, async (req, res) => {
  const E = req.empresaId;
  const d = limpiar(req.body, TIPOS_TARIFA);
  if (!d.categoria_id) throw new ErrorHttp(400, 'Elige la categoría.');
  if (!(await deLaEmpresa('categorias', d.categoria_id, E, 'categoría'))) throw new ErrorHttp(400, 'Categoría no válida');
  if (d.temporada_id) await deLaEmpresa('temporadas', d.temporada_id, E, 'temporada');
  if (!d.precio_dia || d.precio_dia <= 0) throw new ErrorHttp(400, 'Ingresa el precio por día.', { campo: 'precio_dia' });
  const vals = [d.precio_dia, d.precio_semana ?? null, d.precio_mes ?? null, !!d.km_libre, d.km_libre ? null : (d.km_dia_incluidos ?? 250), d.km_libre ? 0 : (d.precio_km_extra ?? 0), d.garantia ?? 0, d.deducible ?? 0];
  const existe = await uno('SELECT id FROM tarifas WHERE empresa_id = $1 AND categoria_id = $2 AND temporada_id IS NOT DISTINCT FROM $3', [E, d.categoria_id, d.temporada_id ?? null]);
  let t;
  if (existe) [t] = await q(`UPDATE tarifas SET precio_dia = $1, precio_semana = $2, precio_mes = $3, km_libre = $4, km_dia_incluidos = $5, precio_km_extra = $6, garantia = $7, deducible = $8 WHERE id = $9 RETURNING *`, [...vals, existe.id]);
  else [t] = await q(`INSERT INTO tarifas (empresa_id, categoria_id, temporada_id, precio_dia, precio_semana, precio_mes, km_libre, km_dia_incluidos, precio_km_extra, garantia, deducible) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [E, d.categoria_id, d.temporada_id ?? null, ...vals]);
  await registrar(req, existe ? 'tarifa_editada' : 'tarifa_creada', 'tarifa', t.id, { categoria_id: t.categoria_id, temporada_id: t.temporada_id, precio_dia: t.precio_dia });
  res.json(t);
});
r.delete('/tarifas/:id', editar, async (req, res) => {
  const [t] = await q('DELETE FROM tarifas WHERE id = $1 AND empresa_id = $2 RETURNING id, categoria_id, temporada_id', [Number(req.params.id), req.empresaId]);
  if (!t) throw new ErrorHttp(404, 'Tarifa no encontrada');
  await registrar(req, 'tarifa_eliminada', 'tarifa', t.id, t);
  res.json({ ok: true });
});

// ── CRUD simple de temporadas, extras, recargos y descuentos ──
function crud(ruta, tabla, entidad, tipos, validar, { alBorrar = null } = {}) {
  r.post(`/${ruta}`, editar, async (req, res) => {
    const d = await validar(limpiar(req.body, tipos), req, true);
    for (const k of Object.keys(d)) if (d[k] === null) delete d[k];
    const s = sqlInsert(tabla, { empresa_id: req.empresaId, ...d });
    let f;
    try { [f] = await q(s.sql, s.params); } catch (e) { if (esDuplicado(e)) throw new ErrorHttp(409, 'Ya existe uno con ese código.', { campo: 'codigo' }); throw e; }
    await registrar(req, `${entidad}_creado`, entidad, f.id, d);
    res.status(201).json(f);
  });
  r.put(`/${ruta}/:id`, editar, async (req, res) => {
    const d = await validar(limpiar(req.body, tipos), req, false);
    const s = sqlUpdate(tabla, d, Number(req.params.id), req.empresaId);
    if (!s) throw new ErrorHttp(400, 'Sin cambios');
    let f;
    try { [f] = await q(s.sql, s.params); } catch (e) { if (esDuplicado(e)) throw new ErrorHttp(409, 'Ya existe uno con ese código.', { campo: 'codigo' }); throw e; }
    if (!f) throw new ErrorHttp(404, 'No encontrado');
    await registrar(req, `${entidad}_editado`, entidad, f.id, d);
    res.json(f);
  });
  r.delete(`/${ruta}/:id`, editar, async (req, res) => {
    const id = Number(req.params.id), E = req.empresaId;
    const f = await uno(`SELECT * FROM ${tabla} WHERE id = $1 AND empresa_id = $2`, [id, E]);
    if (!f) throw new ErrorHttp(404, 'No encontrado');
    await transaccion(async (tx) => {
      if (alBorrar) await alBorrar(tx, f, E);
      await tx.query(`DELETE FROM ${tabla} WHERE id = $1 AND empresa_id = $2`, [id, E]);
    });
    await registrar(req, `${entidad}_eliminado`, entidad, id, {});
    res.json({ ok: true });
  });
}

const req_ = (cond, msg, campo) => { if (!cond) throw new ErrorHttp(400, msg, { campo }); };
const codigoDe = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

crud('temporadas', 'temporadas', 'temporada', { nombre: 'texto', desde: 'fecha', hasta: 'fecha', prioridad: 'entero' }, (d, _req, nuevo) => {
  if (nuevo || 'nombre' in d) req_(d.nombre, 'Ingresa el nombre de la temporada.', 'nombre');
  if (nuevo) { req_(d.desde, 'Ingresa la fecha de inicio.', 'desde'); req_(d.hasta, 'Ingresa la fecha de término.', 'hasta'); }
  if (d.desde && d.hasta) req_(d.desde <= d.hasta, 'La fecha de término debe ser posterior al inicio.', 'hasta');
  return d;
}, { alBorrar: (tx, f, E) => tx.query('DELETE FROM tarifas WHERE temporada_id = $1 AND empresa_id = $2', [f.id, E]) });

crud('extras', 'extras', 'extra', { codigo: 'texto', nombre: 'texto', descripcion: 'texto', cobro: 'texto', precio: 'monto', tope: 'monto', requiere_documento: 'bool', activo: 'bool' }, (d, _req, nuevo) => {
  if (nuevo || 'nombre' in d) req_(d.nombre, 'Ingresa el nombre del extra.', 'nombre');
  if (nuevo && !d.codigo) d.codigo = codigoDe(d.nombre);
  if ('codigo' in d) { d.codigo = codigoDe(d.codigo); req_(d.codigo, 'Ingresa el código.', 'codigo'); }
  if (d.cobro != null) req_(['dia', 'fijo'].includes(d.cobro), 'El cobro debe ser por día o fijo.', 'cobro');
  if (nuevo && !('activo' in d)) d.activo = true;
  return d;
});

crud('recargos', 'recargos', 'recargo', { tipo: 'texto', nombre: 'texto', sucursal_origen_id: 'id', sucursal_destino_id: 'id', edad_max: 'entero', cobro: 'texto', monto: 'monto', activo: 'bool' }, async (d, req, nuevo) => {
  if (nuevo || 'tipo' in d) req_(['otra_sucursal', 'conductor_joven', 'fuera_horario'].includes(d.tipo), 'Tipo de recargo no válido.', 'tipo');
  if (nuevo || 'nombre' in d) req_(d.nombre, 'Ingresa el nombre del recargo.', 'nombre');
  if (d.tipo === 'conductor_joven') req_(d.edad_max > 0, 'Indica la edad (menor de…) para el recargo de conductor joven.', 'edad_max');
  if (d.cobro != null) req_(['dia', 'fijo'].includes(d.cobro), 'El cobro debe ser por día o fijo.', 'cobro');
  await deLaEmpresa('sucursales', d.sucursal_origen_id, req.empresaId, 'sucursal de origen');
  await deLaEmpresa('sucursales', d.sucursal_destino_id, req.empresaId, 'sucursal de destino');
  if (nuevo && !('activo' in d)) d.activo = true;
  return d;
});

crud('descuentos', 'descuentos', 'descuento', { codigo: 'texto', tipo: 'texto', valor: 'monto', desde: 'fecha', hasta: 'fecha', usos_max: 'entero', activo: 'bool' }, (d, _req, nuevo) => {
  if ('codigo' in d || nuevo) { d.codigo = String(d.codigo || '').toUpperCase().replace(/\s+/g, ''); req_(/^[A-Z0-9_-]{3,30}$/.test(d.codigo), 'El código debe tener entre 3 y 30 letras o números, sin espacios.', 'codigo'); }
  if (nuevo || 'tipo' in d) req_(['porcentaje', 'monto'].includes(d.tipo), 'El descuento es porcentaje o monto fijo.', 'tipo');
  if (nuevo || 'valor' in d) req_(d.valor > 0, 'Ingresa el valor del descuento.', 'valor');
  if (d.tipo === 'porcentaje' && d.valor != null) req_(d.valor <= 100, 'El porcentaje no puede superar 100.', 'valor');
  if (d.desde && d.hasta) req_(d.desde <= d.hasta, 'La vigencia termina antes de empezar.', 'hasta');
  if (nuevo && !('activo' in d)) d.activo = true;
  return d;
});

// ── Cotizador ──
// body: { categoria_id, inicio, fin (ISO), sucursal_retiro_id, sucursal_devolucion_id, extras:[{codigo,cantidad}], codigo_descuento, fecha_nacimiento, conductores_adicionales }
// respuesta: salida de cotizar() → { dias, categoria, temporada, lineas, subtotal, descuento, total, km_libre, km_incluidos, precio_km_extra, garantia, deducible, avisos }
r.post('/tarifas/cotizar', requiere(), async (req, res) => {
  const b = req.body || {};
  const E = req.empresaId;
  const categoriaId = Number(b.categoria_id);
  if (!categoriaId) throw new ErrorHttp(400, 'Elige la categoría.', { campo: 'categoria_id' });
  await deLaEmpresa('categorias', categoriaId, E, 'categoría');
  const inicio = new Date(b.inicio), fin = new Date(b.fin);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) throw new ErrorHttp(400, 'Indica la fecha y hora de retiro y devolución.', { campo: 'inicio' });
  if (fin <= inicio) throw new ErrorHttp(400, 'La devolución debe ser posterior al retiro.', { campo: 'fin' });
  const sr = Number(b.sucursal_retiro_id) || null, sd = Number(b.sucursal_devolucion_id) || null;
  await deLaEmpresa('sucursales', sr, E, 'sucursal de retiro');
  await deLaEmpresa('sucursales', sd, E, 'sucursal de devolución');
  const extras = Array.isArray(b.extras) ? b.extras.filter((x) => x?.codigo).map((x) => ({ codigo: String(x.codigo), cantidad: Math.max(1, Number(x.cantidad) || 1) })) : [];
  res.json(await cotizar({
    empresaId: E, categoriaId, inicio, fin, sucursalRetiroId: sr, sucursalDevolucionId: sd, extras,
    codigoDescuento: b.codigo_descuento ? String(b.codigo_descuento).trim() : null, fechaNacimiento: b.fecha_nacimiento || null,
    conductoresAdicionales: Number(b.conductores_adicionales) || 0
  }));
});

// Catálogo para formularios de otros módulos (reservas, portal interno, patio)
r.get('/catalogo', requiere(), async (req, res) => {
  const E = req.empresaId;
  const [categorias, sucursales, extras] = await Promise.all([
    q(`SELECT c.id, c.nombre, c.descripcion, c.pasajeros, c.maletas, c.transmision, c.ejemplo, c.imagen_clave, c.orden,
         t.precio_dia, t.garantia, t.deducible, t.km_libre, t.km_dia_incluidos
       FROM categorias c LEFT JOIN tarifas t ON t.categoria_id = c.id AND t.temporada_id IS NULL AND t.empresa_id = c.empresa_id
       WHERE c.empresa_id = $1 AND c.activa ORDER BY c.orden, c.nombre`, [E]),
    q('SELECT id, nombre, direccion, comuna, ciudad, telefono, horario, lat, lng FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id', [E]),
    q('SELECT id, codigo, nombre, descripcion, cobro, precio, tope, requiere_documento FROM extras WHERE empresa_id = $1 AND activo ORDER BY nombre', [E])
  ]);
  res.json({ categorias, sucursales, extras });
});

export default r;
