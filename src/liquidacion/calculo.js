// Cálculo automático de la liquidación al cierre (sin efectos): cada cargo indica cómo se calculó y de dónde sale el dato.
// Línea: { codigo, concepto, calculo, origen, monto, incluir, editado, motivo, aviso?, sub?, monto_calculado }
import { clp, miles, hora, fecha } from '../util/formato.js';

export const ORIGENES = { checkin: 'Check-in', gps: 'Plataforma GPS', tag: 'Importación TAG', multas: 'Importación multas', incidente: 'Incidente', manual: 'Manual' };
export const FALTANTES = { repuesto: 'Rueda de repuesto', gata: 'Gata', extintor: 'Extintor', documentos: 'Documentos del vehículo', tag: 'Dispositivo TAG', botiquin: 'Botiquín', chaleco: 'Chaleco reflectante', llave: 'Llave o control' };
// Montos por defecto si la empresa no los definió en ajustes.faltantes
export const PRECIOS_FALTANTES = { repuesto: 90000, gata: 25000, extintor: 18000, documentos: 15000, tag: 20000, botiquin: 10000, chaleco: 5000, llave: 120000 };

const DIA = 864e5;
const plural = (n, s, p = `${s}s`) => `${miles(n)} ${n === 1 ? s : p}`;
const octavos = (n) => (n === 8 ? 'lleno' : `${n}/8`);
const linea = (o) => ({ incluir: o.monto > 0, editado: false, motivo: null, ...o, monto: Math.max(0, Math.round(o.monto || 0)), monto_calculado: Math.max(0, Math.round(o.monto || 0)) });

// Días de atraso: bloques de 24 h desde la hora pactada; lo que exceda la tolerancia suma un día.
export function diasAtraso(finPactado, devolucion, toleranciaMin = 59) {
  const ms = new Date(devolucion) - new Date(finPactado);
  if (!(ms > toleranciaMin * 6e4)) return 0;
  const dias = Math.floor(ms / DIA);
  return dias + (ms - dias * DIA > toleranciaMin * 6e4 ? 1 : 0);
}

// Valor del día: arriendo de la cotización ÷ días; si no, la tarifa base de la categoría.
export function valorDia(cotizacion = {}, precioTarifa = 0) {
  const arr = (cotizacion.lineas || []).find((l) => l.codigo === 'arriendo');
  if (arr && cotizacion.dias > 0) return Math.round(arr.monto / cotizacion.dias);
  return Math.round(Number(precioTarifa) || 0);
}

/**
 * datos: { reserva, ajustes, vehiculo, entrega, devolucion, tags, multas, incidentes, tarifaDia }
 *   entrega/devolucion: filas de inspecciones (km, km_gps, combustible, combustible_gps, checklist, completado_en)
 */
export function calcularLineas({ reserva, ajustes = {}, vehiculo = {}, entrega = null, devolucion = null, tags = [], multas = [], incidentes = [], tarifaDia = 0 }) {
  const L = [];
  const tol = Number(ajustes.tolerancia_min ?? 59);

  // 1. Día extra por atraso
  const dev = reserva.devolucion_real || devolucion?.completado_en || null;
  if (dev) {
    const dias = diasAtraso(reserva.fin, dev, tol);
    const mismoDia = fecha(dev) === fecha(reserva.fin);
    const cuando = `Devolvió ${hora(dev)}${mismoDia ? '' : ` del ${fecha(dev)}`}, pactado ${hora(reserva.fin)}${mismoDia ? '' : ` del ${fecha(reserva.fin)}`}`;
    L.push(linea({ codigo: 'atraso', concepto: dias > 1 ? 'Días extra por atraso' : 'Día extra por atraso', origen: ORIGENES.checkin,
      calculo: dias ? `${cuando} (tolerancia ${tol} min) · ${plural(dias, 'día')} × ${clp(tarifaDia)}` : `${cuando} · dentro de la tolerancia de ${tol} min`,
      monto: dias * tarifaDia }));
  } else {
    L.push(linea({ codigo: 'atraso', concepto: 'Día extra por atraso', origen: ORIGENES.checkin, calculo: 'Sin hora de devolución registrada', monto: 0, aviso: 'Falta registrar la devolución' }));
  }

  // 2. Kilómetros extra
  const kmEnt = entrega ? entrega.km_gps ?? entrega.km : null;
  const kmDev = devolucion ? devolucion.km_gps ?? devolucion.km : null;
  const origenKm = devolucion?.km_gps != null ? ORIGENES.gps : ORIGENES.checkin;
  if (kmEnt == null || kmDev == null) {
    L.push(linea({ codigo: 'km_extra', concepto: 'Kilómetros extra', origen: origenKm, calculo: 'Falta el kilometraje de entrega o de devolución', monto: 0, aviso: 'Sin datos de kilometraje' }));
  } else {
    const rec = Math.max(0, kmDev - kmEnt);
    if (reserva.km_incluidos == null) {
      L.push(linea({ codigo: 'km_extra', concepto: 'Kilómetros extra', origen: origenKm, calculo: `Kilometraje libre · ${miles(rec)} km recorridos`, monto: 0 }));
    } else {
      const extra = Math.max(0, rec - reserva.km_incluidos);
      const precio = Number(reserva.precio_km_extra) || 0;
      L.push(linea({ codigo: 'km_extra', concepto: 'Kilómetros extra', origen: origenKm,
        calculo: extra ? `${miles(rec)} km recorridos − ${miles(reserva.km_incluidos)} incluidos = ${miles(extra)} km × ${clp(precio)}` : `${miles(rec)} km recorridos de ${miles(reserva.km_incluidos)} incluidos`,
        monto: extra * precio }));
    }
  }

  // 3. Combustible faltante (en octavos)
  const cEnt = entrega ? entrega.combustible_gps ?? entrega.combustible : null;
  const cDev = devolucion ? devolucion.combustible_gps ?? devolucion.combustible : null;
  const origenComb = devolucion?.combustible_gps != null ? ORIGENES.gps : ORIGENES.checkin;
  if (cEnt == null || cDev == null) {
    L.push(linea({ codigo: 'combustible', concepto: 'Combustible faltante', origen: origenComb, calculo: 'Falta el nivel de combustible de entrega o de devolución', monto: 0, aviso: 'Sin datos de combustible' }));
  } else if (cDev >= cEnt) {
    L.push(linea({ codigo: 'combustible', concepto: 'Combustible faltante', origen: origenComb, calculo: `Entregado ${octavos(cEnt)}, devuelto ${octavos(cDev)} · sin faltante`, monto: 0 }));
  } else {
    const faltan = cEnt - cDev;
    const cap = Number(vehiculo.capacidad_estanque) || 45;
    const litros = Math.round((faltan * cap) / 8);
    const precio = Number(ajustes.precio_litro) || 0;
    const servicio = Number(ajustes.cargo_servicio_combustible) || 0;
    L.push(linea({ codigo: 'combustible', concepto: 'Combustible faltante', origen: origenComb,
      calculo: `${faltan}/8 de ${cap} L ≈ ${litros} L × ${clp(precio)}${servicio ? ` + cargo de servicio ${clp(servicio)}` : ''}`,
      monto: litros * precio + servicio }));
  }

  // 4. TAG (tránsitos asignados a la reserva)
  const totalTag = tags.reduce((s, t) => s + Number(t.monto || 0), 0);
  const autopistas = [...new Set(tags.map((t) => t.autopista || t.concesionaria).filter(Boolean))];
  L.push(linea({ codigo: 'tag', concepto: 'TAG', origen: ORIGENES.tag,
    calculo: tags.length ? `${plural(tags.length, 'tránsito')}${autopistas.length ? ` · ${autopistas.slice(0, 4).join(', ')}${autopistas.length > 4 ? '…' : ''}` : ''}` : 'Ningún tránsito registrado a la fecha',
    monto: totalTag, ids: tags.map((t) => t.id) }));

  // 5. Multas (asignadas o notificadas)
  const totalMultas = multas.reduce((s, m) => s + Number(m.monto || 0), 0);
  L.push(linea({ codigo: 'multas', concepto: 'Multas', origen: ORIGENES.multas,
    calculo: multas.length ? multas.slice(0, 3).map((m) => `${fecha(m.fecha_infraccion)} ${m.motivo || m.tipo || 'infracción'}${m.lugar ? ` (${m.lugar})` : ''}`).join(' · ') + (multas.length > 3 ? ` y ${multas.length - 3} más` : '')
      : 'Ninguna registrada a la fecha · se pueden cargar hasta 90 días después',
    monto: totalMultas, ids: multas.map((m) => m.id) }));

  // 6. Daños (incidentes de la reserva no anulados ni cobrados)
  for (const inc of incidentes) {
    const deducible = inc.deducible ?? reserva.deducible ?? null;
    let monto = 0, calculo, aviso = null;
    if (inc.monto_cliente != null) {
      monto = Number(inc.monto_cliente);
      calculo = `Monto a cobrar definido en el incidente${inc.presupuesto ? ` · presupuesto ${clp(inc.presupuesto)}` : ''}${deducible ? ` · deducible ${clp(deducible)}` : ''}`;
    } else if (inc.presupuesto != null) {
      monto = deducible != null ? Math.min(Number(inc.presupuesto), Number(deducible)) : Number(inc.presupuesto);
      calculo = `Presupuesto${inc.taller ? ` ${inc.taller}` : ''} ${clp(inc.presupuesto)}${deducible != null ? ` · deducible pactado ${clp(deducible)} → se cobra el menor` : ''}`;
    } else {
      calculo = `Presupuesto pendiente${deducible ? ` · tope deducible ${clp(deducible)}` : ''}`;
      aviso = 'Presupuesto pendiente';
    }
    L.push(linea({ codigo: `dano:${inc.id}`, concepto: `Daño · ${String(inc.descripcion || inc.tipo || 'sin descripción').slice(0, 60)}`, sub: `Incidente ${inc.folio}`, origen: ORIGENES.incidente, calculo, monto, aviso, incidente_id: inc.id }));
  }

  // 7. Faltantes del checklist (entregado sí, devuelto no)
  const ce = entrega?.checklist || {}, cd = devolucion?.checklist || {};
  const nE = Number(ce.triangulos ?? ce.triangulo ?? NaN), nD = Number(cd.triangulos ?? cd.triangulo ?? NaN);
  if (Number.isFinite(nE) && Number.isFinite(nD) && nD < nE) {
    const precio = Number(ajustes.triangulo ?? 12000);
    const f = nE - nD;
    L.push(linea({ codigo: 'faltante:triangulos', concepto: f > 1 ? 'Triángulos faltantes' : 'Triángulo faltante', origen: ORIGENES.checkin, calculo: `Checklist: entregó ${nE}, devolvió ${nD}${f > 1 ? ` · ${f} × ${clp(precio)}` : ''}`, monto: f * precio }));
  }
  for (const [k, nombre] of Object.entries(FALTANTES)) {
    if (ce[k] === true && cd[k] === false) {
      const precio = Number(ajustes.faltantes?.[k] ?? PRECIOS_FALTANTES[k]);
      L.push(linea({ codigo: `faltante:${k}`, concepto: `${nombre} faltante`, origen: ORIGENES.checkin, calculo: 'Checklist: se entregó y no se devolvió', monto: precio }));
    }
  }

  // 8. Lavado
  if (['sucio', 'requiere_lavado', 'muy_sucio'].includes(cd.limpieza)) {
    L.push(linea({ codigo: 'lavado', concepto: 'Lavado', origen: ORIGENES.checkin, calculo: 'Limpieza: «requiere lavado» en la devolución', monto: Number(ajustes.lavado ?? 15000) }));
  }
  return L;
}

// Recalcular sin perder lo que la persona ya editó, condonó o agregó.
export function fusionar(nuevas, anteriores = []) {
  const prev = new Map(anteriores.map((l) => [l.codigo, l]));
  const out = nuevas.map((n) => {
    const p = prev.get(n.codigo);
    if (!p || !p.editado) return n;
    return { ...n, monto: p.monto, incluir: p.incluir, editado: true, motivo: p.motivo, editado_por: p.editado_por, editado_en: p.editado_en };
  });
  for (const p of anteriores) if (String(p.codigo).startsWith('manual:')) out.push(p);
  return out;
}

// Resumen: garantía retenida − cargos = se libera (o saldo por cobrar si los cargos superan la garantía).
export function resumir(lineas, garantia = 0) {
  const total = lineas.filter((l) => l.incluir).reduce((s, l) => s + Math.round(Number(l.monto) || 0), 0);
  const g = Math.max(0, Math.round(Number(garantia) || 0));
  const captura = Math.min(total, g);
  return { total_cargos: total, garantia: g, captura, libera: g - captura, saldo: Math.max(0, total - g) };
}
