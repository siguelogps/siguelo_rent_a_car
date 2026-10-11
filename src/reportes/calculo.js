// Reportes de gestión: ocupación, ingresos, días ociosos, mantención, devoluciones y daños por cliente.
// La base es una grilla vehículo × día (en hora de Chile) calculada en SQL: fracción del día arrendado, fracción en
// mantención (bloqueos) e ingreso prorrateado. Así las reservas de varios días que cruzan el inicio o el fin del período
// solo aportan la parte que cae dentro (los días con cambio de hora duran 23 o 25 h y se miden con su largo real).
import { q } from '../db.js';
import { ErrorHttp } from '../auth.js';

const ZONA = 'America/Santiago';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ESTADOS_OCUPAN = ['confirmada', 'en_curso', 'devuelta', 'cerrada'];
const ESTADOS_INGRESO = ['en_curso', 'devuelta', 'cerrada'];

const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
const aUtc = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const sumar = (isoF, dias) => iso(new Date(aUtc(isoF).getTime() + dias * 864e5));
const dmy = (s) => { const [a, m, d] = s.split('-'); return `${d}-${m}-${a}`; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const diasEntre = (desde, hasta) => Math.round((aUtc(hasta) - aUtc(desde)) / 864e5) + 1;

// Período a partir de la consulta: periodo = semana | mes | trimestre | anio | personalizado; ref = fecha dentro del período.
export function periodoDe({ periodo = 'mes', ref, desde, hasta } = {}) {
  const valida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(aUtc(s).getTime());
  if (periodo === 'personalizado') {
    if (!valida(desde) || !valida(hasta)) throw new ErrorHttp(400, 'Indica las fechas desde y hasta.');
    if (hasta < desde) throw new ErrorHttp(400, 'La fecha «hasta» debe ser posterior a «desde».');
    const n = diasEntre(desde, hasta);
    if (n > 400) throw new ErrorHttp(400, 'El rango no puede superar los 400 días.');
    return { periodo, desde, hasta, etiqueta: `${dmy(desde)} al ${dmy(hasta)}`, anterior: { desde: sumar(desde, -n), hasta: sumar(desde, -1), etiqueta: 'el período anterior' } };
  }
  const r = valida(ref) ? ref : hoyChile();
  const d = aUtc(r), a = d.getUTCFullYear(), m = d.getUTCMonth();
  const finMes = (anio, mes) => iso(new Date(Date.UTC(anio, mes + 1, 0)));
  if (periodo === 'semana') {
    const lunes = sumar(r, -((d.getUTCDay() + 6) % 7));
    const dom = sumar(lunes, 6);
    return { periodo, desde: lunes, hasta: dom, etiqueta: `Semana del ${dmy(lunes).slice(0, 5)} al ${dmy(dom)}`, anterior: { desde: sumar(lunes, -7), hasta: sumar(lunes, -1), etiqueta: 'la semana anterior' } };
  }
  if (periodo === 'trimestre') {
    const t = Math.floor(m / 3);
    const desdeT = iso(new Date(Date.UTC(a, t * 3, 1)));
    const pa = t === 0 ? a - 1 : a, pt = t === 0 ? 3 : t - 1;
    return { periodo, desde: desdeT, hasta: finMes(a, t * 3 + 2), etiqueta: `${t + 1}.º trimestre ${a} (${MESES[t * 3].slice(0, 3)}–${MESES[t * 3 + 2].slice(0, 3)})`,
      anterior: { desde: iso(new Date(Date.UTC(pa, pt * 3, 1))), hasta: finMes(pa, pt * 3 + 2), etiqueta: 'el trimestre anterior' } };
  }
  if (periodo === 'anio') {
    return { periodo, desde: `${a}-01-01`, hasta: `${a}-12-31`, etiqueta: `Año ${a}`, anterior: { desde: `${a - 1}-01-01`, hasta: `${a - 1}-12-31`, etiqueta: String(a - 1) } };
  }
  const pa = m === 0 ? a - 1 : a, pm = m === 0 ? 11 : m - 1;
  return { periodo: 'mes', desde: iso(new Date(Date.UTC(a, m, 1))), hasta: finMes(a, m), etiqueta: `${cap(MESES[m])} ${a}`,
    anterior: { desde: iso(new Date(Date.UTC(pa, pm, 1))), hasta: finMes(pa, pm), etiqueta: MESES[pm] } };
}

// Grilla vehículo × día. Devuelve filas { vehiculo_id, dia, arr, man, ing } (arr y man en fracción de día 0..1).
async function grilla(empresaId, desde, hasta, sucursalId) {
  return q(`
    WITH dias AS (
      SELECT g::date AS dia, (g AT TIME ZONE '${ZONA}') AS ini, ((g + interval '1 day') AT TIME ZONE '${ZONA}') AS fin
        FROM generate_series($2::timestamp, $3::timestamp, interval '1 day') g
    ), veh AS (
      SELECT id FROM vehiculos WHERE empresa_id = $1 AND activo AND ($4::bigint IS NULL OR sucursal_id = $4)
    ), lim AS (SELECT min(ini) AS ini, max(fin) AS fin FROM dias),
    res AS (
      SELECT r.vehiculo_id, r.total, r.inicio, r.fin, r.estado,
             COALESCE(r.retiro_real, r.inicio) AS oi,
             CASE WHEN r.estado = 'en_curso' THEN GREATEST(r.fin, now()) ELSE COALESCE(r.devolucion_real, r.fin) END AS of
        FROM reservas r, lim
       WHERE r.empresa_id = $1 AND r.vehiculo_id IN (SELECT id FROM veh) AND r.estado = ANY($5)
         AND LEAST(r.inicio, COALESCE(r.retiro_real, r.inicio)) < lim.fin
         AND GREATEST(r.fin, COALESCE(r.devolucion_real, r.fin), CASE WHEN r.estado = 'en_curso' THEN now() ELSE r.fin END) > lim.ini
    ), blo AS (
      SELECT b.vehiculo_id, b.inicio, b.fin FROM bloqueos b, lim
       WHERE b.empresa_id = $1 AND b.vehiculo_id IN (SELECT id FROM veh) AND b.inicio < lim.fin AND b.fin > lim.ini
    )
    SELECT v.id AS vehiculo_id, to_char(d.dia, 'YYYY-MM-DD') AS dia,
      LEAST(1, COALESCE((SELECT sum(EXTRACT(epoch FROM LEAST(x.of, d.fin) - GREATEST(x.oi, d.ini))) FROM res x
                          WHERE x.vehiculo_id = v.id AND x.oi < d.fin AND x.of > d.ini), 0) / EXTRACT(epoch FROM d.fin - d.ini))::float8 AS arr,
      LEAST(1, COALESCE((SELECT sum(EXTRACT(epoch FROM LEAST(b.fin, d.fin) - GREATEST(b.inicio, d.ini))) FROM blo b
                          WHERE b.vehiculo_id = v.id AND b.inicio < d.fin AND b.fin > d.ini), 0) / EXTRACT(epoch FROM d.fin - d.ini))::float8 AS man,
      COALESCE((SELECT sum(x.total * EXTRACT(epoch FROM LEAST(x.fin, d.fin) - GREATEST(x.inicio, d.ini)) / GREATEST(1, EXTRACT(epoch FROM x.fin - x.inicio)))
                  FROM res x WHERE x.vehiculo_id = v.id AND x.estado = ANY($6) AND x.inicio < d.fin AND x.fin > d.ini), 0)::float8 AS ing
    FROM veh v CROSS JOIN dias d ORDER BY v.id, d.dia`, [empresaId, desde, hasta, sucursalId, ESTADOS_OCUPAN, ESTADOS_INGRESO]);
}

// Cargos de liquidaciones aprobadas o cobradas, imputados al día de la devolución.
async function cargosLiquidacion(empresaId, desde, hasta, sucursalId) {
  return q(`SELECT r.vehiculo_id, to_char((COALESCE(r.devolucion_real, r.fin) AT TIME ZONE '${ZONA}')::date, 'YYYY-MM-DD') AS dia, sum(l.total_cargos)::float8 AS monto
              FROM liquidaciones l JOIN reservas r ON r.id = l.reserva_id AND r.empresa_id = l.empresa_id
              JOIN vehiculos v ON v.id = r.vehiculo_id
             WHERE l.empresa_id = $1 AND l.estado IN ('aprobada','cobrada') AND v.activo AND ($4::bigint IS NULL OR v.sucursal_id = $4)
               AND (COALESCE(r.devolucion_real, r.fin) AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date
             GROUP BY 1, 2`, [empresaId, desde, hasta, sucursalId]);
}

const redondear = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// Ocupación agregada (para comparar con el período anterior sin el resto del cálculo).
async function ocupacionDe(empresaId, desde, hasta, sucursalId) {
  const g = await grilla(empresaId, desde, hasta, sucursalId);
  let disp = 0, arr = 0;
  for (const f of g) { disp += 1 - f.man; arr += Math.min(f.arr, 1 - f.man); }
  return disp > 0 ? arr / disp : null;
}

export async function calcularReporte(empresaId, consulta = {}) {
  const p = periodoDe(consulta);
  const sucursalId = consulta.sucursal_id ? Number(consulta.sucursal_id) : null;
  const n = diasEntre(p.desde, p.hasta);
  const [empresa] = await q('SELECT ajustes FROM empresas WHERE id = $1', [empresaId]);
  const tolerancia = Number(empresa?.ajustes?.tolerancia_min ?? 59);

  const [vehiculos, g, liq, ots, ocupAnterior] = await Promise.all([
    q(`SELECT v.id, v.patente, v.marca, v.modelo, v.categoria_id, c.nombre AS categoria, c.orden AS cat_orden, s.nombre AS sucursal
         FROM vehiculos v LEFT JOIN categorias c ON c.id = v.categoria_id LEFT JOIN sucursales s ON s.id = v.sucursal_id
        WHERE v.empresa_id = $1 AND v.activo AND ($2::bigint IS NULL OR v.sucursal_id = $2) ORDER BY c.orden NULLS LAST, v.patente`, [empresaId, sucursalId]),
    grilla(empresaId, p.desde, p.hasta, sucursalId),
    cargosLiquidacion(empresaId, p.desde, p.hasta, sucursalId),
    q(`SELECT o.vehiculo_id, count(*)::int AS ordenes, sum(o.costo)::float8 AS costo FROM ordenes_trabajo o JOIN vehiculos v ON v.id = o.vehiculo_id
        WHERE o.empresa_id = $1 AND o.estado = 'terminada' AND v.activo AND ($4::bigint IS NULL OR v.sucursal_id = $4)
          AND (COALESCE(o.fin, o.creado_en) AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date GROUP BY o.vehiculo_id`, [empresaId, p.desde, p.hasta, sucursalId]),
    ocupacionDe(empresaId, p.anterior.desde, p.anterior.hasta, sucursalId)
  ]);

  // Por vehículo y por día
  const porVeh = new Map(vehiculos.map((v) => [v.id, { ...v, dias: [], arrendado: 0, mantencion: 0, ingreso: 0, cargos: 0 }]));
  const fechas = Array.from({ length: n }, (_, i) => sumar(p.desde, i));
  const idxDia = new Map(fechas.map((f, i) => [f, i]));
  const porDia = fechas.map((f) => ({ dia: f, ingreso: 0, arrendado: 0, disponible: 0 }));
  for (const f of g) {
    const v = porVeh.get(f.vehiculo_id);
    if (!v) continue;
    const disp = 1 - f.man, arr = Math.min(f.arr, disp);
    v.dias.push({ arr, man: f.man });
    v.arrendado += arr; v.mantencion += f.man; v.ingreso += f.ing;
    const d = porDia[idxDia.get(f.dia)];
    if (d) { d.ingreso += f.ing; d.arrendado += arr; d.disponible += disp; }
  }
  for (const l of liq) {
    const v = porVeh.get(l.vehiculo_id);
    if (v) { v.cargos += l.monto; v.ingreso += l.monto; }
    const d = porDia[idxDia.get(l.dia)];
    if (d) d.ingreso += l.monto;
  }
  const otPorVeh = new Map(ots.map((o) => [o.vehiculo_id, o]));

  const filasVeh = [...porVeh.values()].map((v) => {
    const disponibles = n - v.mantencion;
    const ociosos = Math.max(0, disponibles - v.arrendado);
    const ot = otPorVeh.get(v.id);
    return {
      vehiculo_id: v.id, patente: v.patente, marca: v.marca, modelo: v.modelo, categoria: v.categoria || 'Sin categoría', sucursal: v.sucursal,
      dias_arrendado: redondear(v.arrendado), dias_mantencion: redondear(v.mantencion), dias_disponibles: redondear(disponibles), dias_ociosos: redondear(ociosos),
      ocupacion: disponibles > 0 ? v.arrendado / disponibles : 0,
      ingreso: Math.round(v.ingreso), cargos: Math.round(v.cargos),
      por_dia_disponible: disponibles > 0 ? Math.round(v.ingreso / disponibles) : 0,
      mantencion_costo: Math.round(ot?.costo || 0), ordenes: ot?.ordenes || 0,
      _dias: v.dias, _cat_orden: v.cat_orden
    };
  });

  const tot = filasVeh.reduce((s, v) => ({ arr: s.arr + v.dias_arrendado, disp: s.disp + v.dias_disponibles, ing: s.ing + v.ingreso, ocio: s.ocio + v.dias_ociosos, man: s.man + v.mantencion_costo, ord: s.ord + v.ordenes }),
    { arr: 0, disp: 0, ing: 0, ocio: 0, man: 0, ord: 0 });
  // (las sumas exactas, sin el redondeo de cada fila)
  const arrExacto = [...porVeh.values()].reduce((s, v) => s + v.arrendado, 0);
  const dispExacto = [...porVeh.values()].reduce((s, v) => s + (n - v.mantencion), 0);
  const peor = [...filasVeh].sort((a, b) => b.dias_ociosos - a.dias_ociosos)[0] || null;

  // Por categoría: arrendado / mantención / ocioso sobre el total de días-vehículo
  const cats = new Map();
  for (const v of filasVeh) {
    const c = cats.get(v.categoria) || { categoria: v.categoria, orden: v._cat_orden ?? 999, vehiculos: 0, total: 0, arrendado: 0, mantencion: 0 };
    c.vehiculos += 1; c.total += n; c.arrendado += v._dias.reduce((s, d) => s + d.arr, 0); c.mantencion += v._dias.reduce((s, d) => s + d.man, 0);
    cats.set(v.categoria, c);
  }
  const porCategoria = [...cats.values()].sort((a, b) => a.orden - b.orden).map((c) => ({
    categoria: c.categoria, vehiculos: c.vehiculos, dias_vehiculo: c.total,
    dias_arrendado: redondear(c.arrendado), dias_mantencion: redondear(c.mantencion), dias_ociosos: redondear(Math.max(0, c.total - c.arrendado - c.mantencion)),
    pct_arrendado: c.total ? c.arrendado / c.total : 0, pct_mantencion: c.total ? c.mantencion / c.total : 0,
    ocupacion: c.total - c.mantencion > 0 ? c.arrendado / (c.total - c.mantencion) : 0
  }));

  // Mapa de calor: por día (hasta 62 días) o por semana (períodos largos)
  const porSemana = n > 62;
  const columnas = [];
  if (!porSemana) fechas.forEach((f, i) => columnas.push({ desde: f, hasta: f, i0: i, i1: i }));
  else for (let i = 0; i < n; i += 7) columnas.push({ desde: fechas[i], hasta: fechas[Math.min(n - 1, i + 6)], i0: i, i1: Math.min(n - 1, i + 6) });
  const calor = {
    unidad: porSemana ? 'semana' : 'dia',
    columnas: columnas.map((c) => ({ desde: c.desde, hasta: c.hasta })),
    filas: filasVeh.map((v) => ({
      patente: v.patente, vehiculo_id: v.vehiculo_id,
      celdas: columnas.map((c) => {
        const ds = v._dias.slice(c.i0, c.i1 + 1);
        const largo = ds.length || 1;
        return { arr: redondear(ds.reduce((s, d) => s + d.arr, 0) / largo, 2), man: redondear(ds.reduce((s, d) => s + d.man, 0) / largo, 2) };
      })
    }))
  };

  // Devoluciones: reservas cuya devolución pactada cae en el período
  const devs = await q(`
    SELECT r.id, r.folio, r.estado, r.fin, r.devolucion_real, v.patente, c.nombre, c.apellidos,
           EXTRACT(epoch FROM (COALESCE(r.devolucion_real, now()) - r.fin)) / 60 AS atraso_min
      FROM reservas r LEFT JOIN vehiculos v ON v.id = r.vehiculo_id LEFT JOIN clientes c ON c.id = r.cliente_id
     WHERE r.empresa_id = $1 AND ($4::bigint IS NULL OR r.sucursal_devolucion_id = $4)
       AND (r.fin AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date
       AND (r.estado IN ('devuelta','cerrada') OR (r.estado = 'en_curso' AND r.fin < now()))
     ORDER BY r.fin`, [empresaId, p.desde, p.hasta, sucursalId]);
  const noShows = await q(`
    SELECT r.id, r.folio, r.inicio, v.patente, c.nombre, c.apellidos FROM reservas r LEFT JOIN vehiculos v ON v.id = r.vehiculo_id LEFT JOIN clientes c ON c.id = r.cliente_id
     WHERE r.empresa_id = $1 AND r.estado = 'no_show' AND ($4::bigint IS NULL OR r.sucursal_retiro_id = $4)
       AND (r.inicio AT TIME ZONE '${ZONA}')::date BETWEEN $2::date AND $3::date ORDER BY r.inicio`, [empresaId, p.desde, p.hasta, sucursalId]);
  const detalleDev = devs.map((d) => {
    const atraso = Math.max(0, Math.round(Number(d.atraso_min)));
    const clase = atraso <= tolerancia ? 'a_tiempo' : atraso < 180 ? 'atraso_leve' : 'atraso_grave';
    return { folio: d.folio, estado: d.estado, patente: d.patente, cliente: `${d.nombre || ''} ${d.apellidos || ''}`.trim(), fin: d.fin, devolucion_real: d.devolucion_real,
      atraso_min: atraso, clase, pendiente: d.estado === 'en_curso' };
  });
  const cuenta = (k) => detalleDev.filter((d) => d.clase === k).length;
  const devoluciones = {
    tolerancia_min: tolerancia, total: detalleDev.length,
    a_tiempo: cuenta('a_tiempo'), atraso_leve: cuenta('atraso_leve'), atraso_grave: cuenta('atraso_grave'), no_show: noShows.length,
    pct_a_tiempo: detalleDev.length ? cuenta('a_tiempo') / detalleDev.length : null,
    detalle: detalleDev,
    no_shows: noShows.map((x) => ({ folio: x.folio, inicio: x.inicio, patente: x.patente, cliente: `${x.nombre || ''} ${x.apellidos || ''}`.trim() }))
  };

  // Daños por cliente: incidentes de los 12 meses que terminan con el período
  const danos = await q(`
    SELECT c.id, c.nombre, c.apellidos, c.documento_tipo, c.documento,
           count(*)::int AS incidentes, COALESCE(sum(i.cobrado_cliente), 0)::float8 AS cobrado, COALESCE(sum(i.monto_cliente), 0)::float8 AS por_cobrar,
           (SELECT count(*)::int FROM reservas r WHERE r.empresa_id = $1 AND r.cliente_id = c.id AND r.estado IN ('en_curso','devuelta','cerrada')
               AND r.inicio >= (($3::date + 1)::timestamp AT TIME ZONE '${ZONA}') - interval '12 months') AS arriendos
      FROM incidentes i JOIN clientes c ON c.id = i.cliente_id AND c.empresa_id = i.empresa_id
     WHERE i.empresa_id = $1 AND i.estado <> 'anulado'
       AND i.creado_en < (($3::date + 1)::timestamp AT TIME ZONE '${ZONA}') AND i.creado_en >= (($3::date + 1)::timestamp AT TIME ZONE '${ZONA}') - interval '12 months'
       AND ($2::bigint IS NULL OR EXISTS (SELECT 1 FROM vehiculos v WHERE v.id = i.vehiculo_id AND v.sucursal_id = $2))
     GROUP BY c.id ORDER BY cobrado DESC, incidentes DESC LIMIT 100`, [empresaId, sucursalId, p.hasta]);

  const ocupacion = dispExacto > 0 ? arrExacto / dispExacto : 0;
  return {
    periodo: p, sucursal_id: sucursalId, dias: n, vehiculos: vehiculos.length,
    kpis: {
      ocupacion, ocupacion_anterior: ocupAnterior, ocupacion_dif_pts: ocupAnterior == null ? null : Math.round((ocupacion - ocupAnterior) * 100), anterior_etiqueta: p.anterior.etiqueta,
      ingreso: Math.round(tot.ing), ingreso_cargos: Math.round(filasVeh.reduce((s, v) => s + v.cargos, 0)),
      dias_disponibles: Math.round(dispExacto), dias_arrendados: redondear(arrExacto),
      ingreso_por_dia_disponible: dispExacto > 0 ? Math.round(tot.ing / dispExacto) : 0,
      dias_ociosos: Math.round(Math.max(0, dispExacto - arrExacto)), peor_ocioso: peor && peor.dias_ociosos > 0 ? { patente: peor.patente, dias: Math.round(peor.dias_ociosos) } : null,
      costo_mantencion: tot.man, ordenes_trabajo: tot.ord,
      devoluciones_a_tiempo: devoluciones.pct_a_tiempo, devoluciones_total: devoluciones.total, atrasos: devoluciones.atraso_leve + devoluciones.atraso_grave, no_show: devoluciones.no_show
    },
    ingreso_diario: porDia.map((d) => ({ dia: d.dia, ingreso: Math.round(d.ingreso), ocupacion: d.disponible > 0 ? d.arrendado / d.disponible : 0 })),
    por_categoria: porCategoria,
    calor,
    por_vehiculo: filasVeh.map(({ _dias, _cat_orden, ...v }) => v).sort((a, b) => b.ingreso - a.ingreso),
    danos_por_cliente: danos.map((d) => ({ cliente_id: d.id, cliente: `${d.nombre} ${d.apellidos || ''}`.trim(), documento_tipo: d.documento_tipo, documento: d.documento,
      arriendos: d.arriendos, incidentes: d.incidentes, cobrado: Math.round(d.cobrado), por_cobrar: Math.round(d.por_cobrar) })),
    devoluciones
  };
}
