// Datos de prueba del módulo de reportes: historial de arriendos cerrados de los últimos ~60 días (sin cruzarse con
// las reservas sembradas alrededor de hoy), con devoluciones a tiempo y atrasadas, algunos no-show, órdenes de trabajo
// terminadas con su bloqueo, incidentes cobrados y liquidaciones. Determinista (misma semilla → mismos datos).
import { q, transaccion, siguienteFolio } from '../db.js';
import { cotizar } from '../cotizador.js';
import { tokenAleatorio } from '../cifrado.js';
import { desdeLocal } from '../util/formato.js';

const DIA = 864e5;

export async function sembrar(E) {
  let semilla = 20260911;
  const azar = () => (semilla = (semilla * 9301 + 49297) % 233280) / 233280;
  const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
  const hoyChile = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const at = (dias, hh = 10, mm = 0) => desdeLocal(new Date(Date.parse(hoyChile) + dias * DIA).toISOString().slice(0, 10), `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);

  const vehiculos = await q('SELECT id, patente, categoria_id, sucursal_id FROM vehiculos WHERE empresa_id = $1 AND activo ORDER BY id', [E]);
  const clientes = await q(`SELECT id, documento FROM clientes WHERE empresa_id = $1 ORDER BY id`, [E]);
  if (!vehiculos.length || !clientes.length) return;
  const porDoc = Object.fromEntries(clientes.map((c) => [c.documento, c.id]));
  const ocupado = async (vehId, ini, fin) => {
    const m = 60 * 60e3, a = new Date(ini.getTime() - m), b = new Date(fin.getTime() + m);
    const [x] = await q(`SELECT (EXISTS (SELECT 1 FROM reservas WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado NOT IN ('cancelada','cotizacion') AND inicio < $4 AND COALESCE(devolucion_real, fin) > $3)
                          OR EXISTS (SELECT 1 FROM bloqueos WHERE empresa_id = $1 AND vehiculo_id = $2 AND inicio < $4 AND fin > $3)) AS hay`, [E, vehId, a, b]);
    return x.hay;
  };

  // Órdenes de trabajo terminadas (con su bloqueo en el calendario)
  const talleres = ['Taller Automotriz Lyon', 'Servicio Técnico Kia Vitacura', 'Neumáticos del Sur', 'Taller Mecánico Los Leones'];
  const ots = [['RFDL49', -40, 3, 'correctiva', 'Cambio de embrague y disco', 690000], ['SYPC11', -30, 1, 'preventiva', 'Mantención 10.000 km', 185000],
    ['RKDS90', -50, 1, 'preventiva', 'Mantención 30.000 km', 85000], ['PBVX61', -22, 2, 'neumaticos', 'Cambio de 4 neumáticos', 420000], ['TFZB73', -55, 1, 'revision_tecnica', 'Revisión técnica anual', 35000]];
  for (const [pat, d, dur, tipo, motivo, costo] of ots) {
    const v = vehiculos.find((x) => x.patente === pat);
    if (!v || await ocupado(v.id, at(d, 9), at(d + dur, 18))) continue;
    const folio = await siguienteFolio(E, 'OT');
    const [ot] = await q(`INSERT INTO ordenes_trabajo (empresa_id, folio, vehiculo_id, tipo, motivo, taller, costo, estado, inicio, fin, creado_en)
                          VALUES ($1,$2,$3,$4,$5,$6,$7,'terminada',$8,$9,$8) RETURNING id`, [E, folio, v.id, tipo, motivo, talleres[entre(0, talleres.length - 1)], costo, at(d, 9), at(d + dur, 18)]);
    await q(`INSERT INTO bloqueos (empresa_id, vehiculo_id, inicio, fin, motivo, orden_trabajo_id) VALUES ($1,$2,$3,$4,$5,$6)`, [E, v.id, at(d, 9), at(d + dur, 18), motivo, ot.id]);
  }

  // Clientes frecuentes (los primeros se repiten más). Se excluye a quien está en lista negra desde hace poco.
  const rotacion = ['15201788-K', '76111222-8', '16482903-0', '584392017', '17935221-4', '14562387-1', '12345670-K', '9876543-3', '76111222-8', '18664012-8', '32456789', '19234567-7', '15201788-K', '17654321-3']
    .map((d) => porDoc[d]).filter(Boolean);
  const creadas = [];
  // La van (RFDL49) casi no se arrienda; las camionetas casi siempre.
  const popularidad = { RFDL49: [3, 9], PKHG24: [0, 1], SJRT80: [0, 2], TFZB73: [0, 2], SXLR27: [0, 2] };
  let k = 0;
  for (const v of vehiculos) {
    const [gMin, gMax] = popularidad[v.patente] || [0, 2];
    let dia = -62 + entre(0, 3);
    while (true) {
      const dur = entre(1, 6);
      const hIni = entre(8, 12), hFin = Math.max(8, Math.min(20, hIni + entre(-2, 3)));
      const inicio = at(dia, hIni), fin = at(dia + dur, hFin);
      if (dia + dur > -11) break;
      if (!(await ocupado(v.id, inicio, fin))) {
        const r = azar();
        const estado = r < 0.04 ? 'no_show' : r < 0.07 ? 'cancelada' : 'cerrada';
        const clienteId = rotacion[k++ % rotacion.length];
        let devolucion = null;
        if (estado === 'cerrada') {
          const t = azar();
          const atraso = t < 0.8 ? entre(-75, 40) : t < 0.93 ? entre(70, 175) : entre(190, 420);
          devolucion = new Date(fin.getTime() + atraso * 60e3);
        }
        const extras = azar() < 0.25 ? [{ codigo: ['silla_nino', 'gps_navegador', 'conductor_adicional'][entre(0, 2)], cantidad: 1 }] : [];
        const cot = await cotizar({ empresaId: E, categoriaId: v.categoria_id, inicio, fin, sucursalRetiroId: v.sucursal_id, sucursalDevolucionId: v.sucursal_id, extras });
        const fila = await transaccion(async (tx) => {
          const folio = await siguienteFolio(E, 'R', tx);
          const [x] = await tx.query(`INSERT INTO reservas (empresa_id, folio, estado, cliente_id, vehiculo_id, categoria_id, sucursal_retiro_id, sucursal_devolucion_id, inicio, fin, extras,
                cotizacion, total, km_incluidos, precio_km_extra, garantia, deducible, origen, token_portal, retiro_real, devolucion_real, creado_en, motivo_cancelacion)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id, total, estado, cliente_id, vehiculo_id, fin, devolucion_real`,
          [E, folio, estado, clienteId, v.id, v.categoria_id, v.sucursal_id, inicio, fin, JSON.stringify(extras), JSON.stringify(cot), cot.total, cot.km_incluidos, cot.precio_km_extra,
            cot.garantia, cot.deducible, azar() < 0.35 ? 'portal' : 'counter', tokenAleatorio(18), estado === 'cerrada' ? new Date(inicio.getTime() + entre(0, 25) * 60e3) : null,
            devolucion, new Date(inicio.getTime() - entre(1, 15) * DIA), estado === 'cancelada' ? 'El cliente canceló por cambio de planes' : null]);
          if (estado === 'cerrada') {
            await tx.query(`INSERT INTO pagos (empresa_id, reserva_id, cliente_id, concepto, metodo, estado, monto, referencia, creado_en) VALUES ($1,$2,$3,'arriendo',$4,'pagado',$5,$6,$7)`,
              [E, x.id, clienteId, ['pos', 'webpay', 'transferencia'][entre(0, 2)], cot.total, `HIST-${folio}`, inicio]);
          }
          return x;
        });
        if (fila.estado === 'cerrada') creadas.push(fila);
      }
      dia += dur + entre(gMin, gMax);
    }
  }

  // Liquidaciones con cargos adicionales (combustible, lavado, km extra) en parte de los arriendos cerrados
  for (const [i, r] of creadas.entries()) {
    if (i % 3 !== 0) continue;
    const lineas = [];
    if (azar() < 0.7) lineas.push({ codigo: 'combustible', concepto: 'Combustible faltante', calculo: `${entre(1, 3)}/8 de estanque`, origen: 'gps', monto: entre(12, 35) * 1000, incluir: true });
    if (azar() < 0.35) lineas.push({ codigo: 'lavado', concepto: 'Lavado', calculo: 'interior sucio', origen: 'inspeccion', monto: 15000, incluir: true });
    if (azar() < 0.3) lineas.push({ codigo: 'km_extra', concepto: 'Kilómetros adicionales', calculo: `${entre(40, 220)} km`, origen: 'gps', monto: entre(8, 40) * 1000, incluir: true });
    if (!lineas.length) continue;
    const total = lineas.reduce((s, l) => s + l.monto, 0);
    const [res] = await q('SELECT garantia FROM reservas WHERE id = $1', [r.id]);
    const folio = await siguienteFolio(E, 'LQ');
    await q(`INSERT INTO liquidaciones (empresa_id, reserva_id, folio, estado, lineas, total_cargos, garantia_retenida, garantia_capturada, garantia_liberada, aprobado_en, creado_en)
             VALUES ($1,$2,$3,'cobrada',$4,$5,$6,$5,$7,$8,$8) ON CONFLICT (reserva_id) DO NOTHING`,
    [E, r.id, folio, JSON.stringify(lineas), total, res.garantia, Math.max(0, res.garantia - total), r.devolucion_real || r.fin]);
  }

  // Incidentes cobrados a clientes (daños por cliente)
  const conIncidente = [['15201788-K', 2, 615000], ['76111222-8', 2, 480000], ['16482903-0', 1, 280000], ['584392017', 1, 95000]];
  const descripciones = ['Raya profunda en puerta trasera derecha', 'Abolladura en parachoques delantero', 'Trizadura de parabrisas', 'Espejo lateral izquierdo quebrado', 'Llanta rayada en vereda'];
  for (const [doc, n, totalCobrado] of conIncidente) {
    const cid = porDoc[doc];
    const suyas = creadas.filter((r) => r.cliente_id === cid);
    for (let j = 0; j < n && j < suyas.length; j++) {
      const r = suyas[j];
      const monto = n === 1 ? totalCobrado : j === 0 ? Math.round(totalCobrado * 0.6 / 1000) * 1000 : totalCobrado - Math.round(totalCobrado * 0.6 / 1000) * 1000;
      const folio = await siguienteFolio(E, 'INC');
      const [inc] = await q(`INSERT INTO incidentes (empresa_id, folio, reserva_id, vehiculo_id, cliente_id, tipo, estado, descripcion, presupuesto, taller, deducible, monto_cliente, cobrado_cliente, costo_real, creado_en, cerrado_en)
                             VALUES ($1,$2,$3,$4,$5,'dano','cerrado',$6,$7,'Desabolladura y Pintura Ñuñoa',$8,$9,$9,$7,$10,$10) RETURNING id`,
      [E, folio, r.id, r.vehiculo_id, cid, descripciones[entre(0, descripciones.length - 1)], Math.round(monto * 1.15), 450000, monto, r.devolucion_real || r.fin]);
      await q(`INSERT INTO incidente_eventos (empresa_id, incidente_id, tipo, detalle, monto, creado_en) VALUES ($1,$2,'cobro','Cobrado con cargo a la garantía',$3,$4)`, [E, inc.id, monto, r.devolucion_real || r.fin]);
    }
  }
}
