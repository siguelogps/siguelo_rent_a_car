// Motor de precios: tarifa por categoría y temporada (día, semana, mes), km libre o con tope, extras,
// recargo por devolver en otra sucursal, conductor joven y códigos de descuento. Lo usan reservas, portal y liquidación.
import { q, uno } from './db.js';
import { diasArriendo, clp } from './util/formato.js';

const fechaSantiago = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(d)); // aaaa-mm-dd

export async function temporadaPara(empresaId, inicio, cx = null) {
  const ej = cx || { query: q };
  const [t] = await ej.query('SELECT * FROM temporadas WHERE empresa_id = $1 AND $2::date BETWEEN desde AND hasta ORDER BY prioridad DESC, id DESC LIMIT 1', [empresaId, fechaSantiago(inicio)]);
  return t || null;
}

export async function tarifaPara(empresaId, categoriaId, inicio, cx = null) {
  const ej = cx || { query: q };
  const temporada = await temporadaPara(empresaId, inicio, cx);
  let tarifa = null;
  if (temporada) [tarifa] = await ej.query('SELECT * FROM tarifas WHERE empresa_id = $1 AND categoria_id = $2 AND temporada_id = $3', [empresaId, categoriaId, temporada.id]);
  if (!tarifa) [tarifa] = await ej.query('SELECT * FROM tarifas WHERE empresa_id = $1 AND categoria_id = $2 AND temporada_id IS NULL', [empresaId, categoriaId]);
  return { tarifa: tarifa || null, temporada: tarifa?.temporada_id ? temporada : null };
}

// Precio del arriendo por días combinando mes (30), semana (7) y día; se elige la combinación más barata.
export function precioArriendo(dias, t) {
  const opciones = [dias * t.precio_dia];
  if (t.precio_semana) {
    const s = Math.floor(dias / 7);
    opciones.push(s * t.precio_semana + (dias - s * 7) * t.precio_dia, Math.ceil(dias / 7) * t.precio_semana);
  }
  if (t.precio_mes) {
    const m = Math.floor(dias / 30), resto = dias - m * 30;
    const restoSem = t.precio_semana ? Math.floor(resto / 7) * t.precio_semana + (resto % 7) * t.precio_dia : resto * t.precio_dia;
    opciones.push(m * t.precio_mes + Math.min(resto * t.precio_dia, restoSem), Math.ceil(dias / 30) * t.precio_mes);
  }
  const total = Math.min(...opciones);
  let detalle = `${dias} ${dias === 1 ? 'día' : 'días'} × ${clp(t.precio_dia)}`;
  if (total < dias * t.precio_dia) detalle = `${dias} días · tarifa ${dias >= 30 ? 'mensual' : 'semanal'} aplicada`;
  return { total, detalle };
}

const edad = (nac, enFecha) => {
  if (!nac) return null;
  const n = new Date(nac), f = new Date(enFecha);
  let e = f.getFullYear() - n.getFullYear();
  if (f.getMonth() < n.getMonth() || (f.getMonth() === n.getMonth() && f.getDate() < n.getDate())) e--;
  return e;
};

/**
 * cotizar({ empresaId, categoriaId, inicio, fin, sucursalRetiroId, sucursalDevolucionId, extras: [{codigo, cantidad}],
 *           codigoDescuento, fechaNacimiento, conductoresAdicionales }) →
 * { dias, temporada, lineas:[{codigo, concepto, detalle, monto}], subtotal, descuento, total, km_incluidos, precio_km_extra, garantia, deducible, avisos:[] }
 */
export async function cotizar({ empresaId, categoriaId, inicio, fin, sucursalRetiroId = null, sucursalDevolucionId = null, extras = [], codigoDescuento = null, fechaNacimiento = null, conductoresAdicionales = 0 }, cx = null) {
  const ej = cx || { query: q };
  const [empresa] = await ej.query('SELECT ajustes FROM empresas WHERE id = $1', [empresaId]);
  const aj = empresa?.ajustes || {};
  const dias = diasArriendo(inicio, fin, aj.tolerancia_min ?? 59);
  const { tarifa, temporada } = await tarifaPara(empresaId, categoriaId, inicio, cx);
  if (!tarifa) throw Object.assign(new Error('No hay tarifa para esta categoría. Créala en Tarifas.'), { estado: 400 });
  const [cat] = await ej.query('SELECT nombre FROM categorias WHERE id = $1', [categoriaId]);
  const avisos = [];
  const lineas = [];
  const arr = precioArriendo(dias, tarifa);
  lineas.push({ codigo: 'arriendo', concepto: `Arriendo ${cat?.nombre || ''}`.trim(), detalle: arr.detalle, monto: arr.total });

  // Extras (conductor adicional, silla de niño, cadenas, cruce a Argentina…)
  const catalogo = await ej.query('SELECT * FROM extras WHERE empresa_id = $1 AND activo', [empresaId]);
  const pedidos = [...extras];
  if (conductoresAdicionales > 0 && !pedidos.some((e) => e.codigo === 'conductor_adicional')) pedidos.push({ codigo: 'conductor_adicional', cantidad: conductoresAdicionales });
  for (const p of pedidos) {
    const x = catalogo.find((c) => c.codigo === p.codigo);
    if (!x) continue;
    const cant = Math.max(1, Number(p.cantidad) || 1);
    let monto = x.cobro === 'dia' ? x.precio * dias * cant : x.precio * cant;
    if (x.tope) monto = Math.min(monto, x.tope * cant);
    lineas.push({ codigo: `extra:${x.codigo}`, concepto: x.nombre + (cant > 1 ? ` (${cant})` : ''), detalle: x.cobro === 'dia' ? `${dias} días × ${clp(x.precio)}${cant > 1 ? ` × ${cant}` : ''}${x.tope && monto === x.tope * cant ? ' · tope' : ''}` : 'cargo único', monto });
  }

  // Recargo por devolver en otra sucursal
  if (sucursalRetiroId && sucursalDevolucionId && Number(sucursalRetiroId) !== Number(sucursalDevolucionId)) {
    const recs = await ej.query(`SELECT r.*, so.nombre AS origen, sd.nombre AS destino FROM recargos r
      LEFT JOIN sucursales so ON so.id = $2 LEFT JOIN sucursales sd ON sd.id = $3
      WHERE r.empresa_id = $1 AND r.tipo = 'otra_sucursal' AND r.activo
        AND (r.sucursal_origen_id IS NULL OR r.sucursal_origen_id = $2) AND (r.sucursal_destino_id IS NULL OR r.sucursal_destino_id = $3)
      ORDER BY (r.sucursal_origen_id IS NOT NULL)::int + (r.sucursal_destino_id IS NOT NULL)::int DESC LIMIT 1`, [empresaId, sucursalRetiroId, sucursalDevolucionId]);
    if (recs[0]) lineas.push({ codigo: 'recargo:otra_sucursal', concepto: 'Devolución en otra sucursal', detalle: `${recs[0].origen || ''} → ${recs[0].destino || ''}`, monto: recs[0].cobro === 'dia' ? recs[0].monto * dias : recs[0].monto });
  }

  // Conductor joven
  const e = edad(fechaNacimiento, inicio);
  if (e != null) {
    if (aj.edad_minima && e < aj.edad_minima) avisos.push(`El conductor tiene ${e} años; la edad mínima es ${aj.edad_minima}.`);
    const [rj] = await ej.query(`SELECT * FROM recargos WHERE empresa_id = $1 AND tipo = 'conductor_joven' AND activo AND edad_max > $2 ORDER BY monto DESC LIMIT 1`, [empresaId, e]);
    if (rj) lineas.push({ codigo: 'recargo:conductor_joven', concepto: 'Conductor joven', detalle: `menor de ${rj.edad_max} años${rj.cobro === 'dia' ? ` · ${dias} días × ${clp(rj.monto)}` : ''}`, monto: rj.cobro === 'dia' ? rj.monto * dias : rj.monto });
  }

  const subtotal = lineas.reduce((s, l) => s + l.monto, 0);
  // Código de descuento (sobre el arriendo)
  let descuento = 0;
  if (codigoDescuento) {
    const [d] = await ej.query(`SELECT * FROM descuentos WHERE empresa_id = $1 AND upper(codigo) = upper($2) AND activo
      AND (desde IS NULL OR desde <= $3::date) AND (hasta IS NULL OR hasta >= $3::date) AND (usos_max IS NULL OR usos < usos_max)`, [empresaId, codigoDescuento, fechaSantiago(inicio)]);
    if (!d) avisos.push(`El código «${codigoDescuento}» no es válido o venció.`);
    else {
      descuento = d.tipo === 'porcentaje' ? Math.round(arr.total * d.valor / 100) : Math.min(d.valor, arr.total);
      lineas.push({ codigo: `descuento:${d.codigo}`, concepto: `Código ${d.codigo.toUpperCase()}`, detalle: d.tipo === 'porcentaje' ? `${d.valor} % sobre el arriendo` : 'descuento fijo', monto: -descuento });
    }
  }
  const kmIncluidos = tarifa.km_libre ? null : (tarifa.km_dia_incluidos || 0) * dias;
  return {
    dias, categoria: cat?.nombre, temporada: temporada?.nombre || 'Base', lineas, subtotal, descuento, total: subtotal - descuento,
    km_libre: tarifa.km_libre, km_incluidos: kmIncluidos, precio_km_extra: tarifa.km_libre ? 0 : tarifa.precio_km_extra,
    garantia: tarifa.garantia, deducible: tarifa.deducible, avisos
  };
}
