// Datos de prueba de la plataforma GPS y de TAG y multas (módulos 10 y 11).
// Todo lo de TAG y multas pasa por las funciones reales de importación y asignación automática.
import { q, uno, siguienteFolio } from '../db.js';
import { desdeLocal } from '../util/formato.js';
import { cotizar } from '../cotizador.js';
import { importarRegistros } from '../tagmultas/importar.js';

const DIA = 864e5;
const H = 36e5;

export async function sembrar(E) {
  const hoyChile = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
  const dia = (d) => new Date(Date.parse(`${hoyChile}T12:00:00Z`) + d * DIA).toISOString().slice(0, 10);
  const at = (d, hhmm) => desdeLocal(dia(d), hhmm);
  const ahora = Date.now();

  const veh = Object.fromEntries((await q('SELECT * FROM vehiculos WHERE empresa_id = $1', [E])).map((v) => [v.patente, v]));
  const usuario = async (correo) => (await uno('SELECT id, nombre FROM usuarios WHERE correo = $1', [correo]));
  const admin = await usuario('demo@siguelogps.cl'), counter = await usuario('counter@siguelogps.cl');
  if (!veh.SXLR27 || !admin || !counter) return;

  // Contrato anterior del SXLR27 que terminó el mismo día en que lo retiró Camila: sirve para mostrar una multa «revisar».
  const valentina = await uno(`SELECT id FROM clientes WHERE empresa_id = $1 AND documento = '16482903-0'`, [E]);
  if (valentina) {
    const inicio = at(-6, '10:00'), fin = at(-2, '09:00');
    const cot = await cotizar({ empresaId: E, categoriaId: veh.SXLR27.categoria_id, inicio, fin, sucursalRetiroId: veh.SXLR27.sucursal_id, sucursalDevolucionId: veh.SXLR27.sucursal_id, extras: [], codigoDescuento: null });
    const folio = await siguienteFolio(E, 'R');
    await q(`INSERT INTO reservas (empresa_id, folio, estado, cliente_id, vehiculo_id, categoria_id, sucursal_retiro_id, sucursal_devolucion_id, inicio, fin, cotizacion, total,
        km_incluidos, precio_km_extra, garantia, deducible, origen, retiro_real, devolucion_real, creado_en)
      VALUES ($1,$2,'cerrada',$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,'portal',$7,$8, now() - interval '12 days')`,
    [E, folio, valentina.id, veh.SXLR27.id, veh.SXLR27.categoria_id, veh.SXLR27.sucursal_id, inicio, fin, JSON.stringify(cot), cot.total, cot.km_incluidos, cot.precio_km_extra, cot.garantia, cot.deducible]);
  }

  // ── Lecturas GPS de los contratos en curso (una cada 3 horas) ──
  const enCurso = await q(`SELECT r.id, r.vehiculo_id, coalesce(r.retiro_real, r.inicio) AS desde, v.patente, v.gps_km, v.km, v.gps_lat, v.gps_lng, v.gps_combustible, s.lat AS s_lat, s.lng AS s_lng
      FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id LEFT JOIN sucursales s ON s.id = r.sucursal_retiro_id WHERE r.empresa_id = $1 AND r.estado = 'en_curso'`, [E]);
  for (const r of enCurso) {
    const desde = new Date(r.desde).getTime();
    const horas = Math.max(1, (ahora - desde) / H);
    const kmHora = r.patente === 'PKHG24' ? 7 : r.patente === 'TFZB73' ? 9 : 4.5;
    const total = Math.round(horas * kmHora);
    const kmFin = r.gps_km ?? r.km, kmIni = kmFin - total;
    const combFin = r.gps_combustible ?? 4, combIni = 8;
    const n = Math.max(2, Math.floor(horas / 3));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const t = new Date(desde + f * (ahora - 10 * 60e3 - desde));
      const lat = (r.s_lat ?? r.gps_lat) + ((r.gps_lat ?? r.s_lat) - (r.s_lat ?? r.gps_lat)) * f + Math.sin(i) * 0.01 * (i && i < n ? 1 : 0);
      const lng = (r.s_lng ?? r.gps_lng) + ((r.gps_lng ?? r.s_lng) - (r.s_lng ?? r.gps_lng)) * f + Math.cos(i) * 0.01 * (i && i < n ? 1 : 0);
      await q('INSERT INTO gps_lecturas (empresa_id, vehiculo_id, reserva_id, km, combustible, lat, lng, velocidad, leido_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [E, r.vehiculo_id, r.id, Math.round(kmIni + total * f), Math.round(combIni + (combFin - combIni) * f), lat, lng, i === 0 || i === n ? 0 : 40 + (i * 17) % 60, t]);
    }
  }

  // ── Alertas ──
  const resDe = async (pat) => uno(`SELECT id FROM reservas WHERE empresa_id = $1 AND vehiculo_id = $2 AND estado = 'en_curso' LIMIT 1`, [E, veh[pat]?.id]);
  const alertas = [
    ['PKHG24', 'geocerca', 'Salida de la región permitida «Región Metropolitana y V Región»', null, -22.4558, -68.9293, new Date(ahora - 6 * DIA + 3 * H), false, null],
    ['TFZB73', 'velocidad', 'Exceso de velocidad: 134 km/h (máximo 120 km/h)', 134, -38.7397, -72.5984, new Date(ahora - 3 * H), false, null],
    ['RKDS90', 'detenido_fuera_horario', 'Detenido 3 h fuera del horario permitido (06:00–23:00)', 180, -33.4372, -70.6506, new Date(ahora - 20 * H), true, 'Cliente avisó que se alojó en Santiago centro; devuelve mañana'],
    ['RFDL49', 'sin_senal', 'Sin señal desde hace más de 6 horas', 30, -33.4206, -70.6075, new Date(ahora - 30 * H), true, 'Está en taller con la batería desconectada']
  ];
  for (const [pat, tipo, detalle, valor, lat, lng, en, atendida, nota] of alertas) {
    if (!veh[pat]) continue;
    const r = await resDe(pat);
    await q(`INSERT INTO gps_alertas (empresa_id, vehiculo_id, reserva_id, tipo, detalle, valor, lat, lng, ocurrido_en, atendida, atendida_por, atendida_en, nota, huella)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [E, veh[pat].id, r?.id || null, tipo, detalle, valor, lat, lng, en, atendida, atendida ? admin.id : null, atendida ? new Date(en.getTime() + H) : null, nota, `demo:${tipo}:${pat}`]);
  }

  // ── Bitácora de inmovilizaciones (marcha blanca: simulada; otra rechazada porque el vehículo nunca se detuvo) ──
  const ev = (en, tipo, u, detalle) => ({ en: new Date(en).toISOString(), tipo, usuario_id: u?.id ?? null, usuario: u?.nombre ?? 'Sistema', detalle });
  if (veh.RKDS90) {
    const r = await resDe('RKDS90');
    const t0 = ahora - 2 * H;
    await q(`INSERT INTO inmovilizaciones (empresa_id, vehiculo_id, reserva_id, accion, motivo, estado, solicitado_por, confirmado_por, velocidad_al_enviar, lat, lng, respuesta, creado_en, confirmado_en, ejecutado_en, eventos)
      VALUES ($1,$2,$3,'inmovilizar',$4,'simulada',$5,$6,0,-33.4372,-70.6506,$7,$8,$9,$9,$10)`,
    [E, veh.RKDS90.id, r?.id || null, 'Arriendo vencido hace más de 4 horas y el cliente no contesta', counter.id, admin.id, 'Marcha blanca: el comando «Bloquear motor» no se envió (simulado)',
      new Date(t0), new Date(t0 + 25 * 60e3), JSON.stringify([
        ev(t0, 'solicitada', counter, 'Solicitó inmovilizar RKDS-90: arriendo vencido hace más de 4 horas y el cliente no contesta'),
        ev(t0 + 25 * 60e3, 'confirmada', admin, 'Confirmó reescribiendo la patente'),
        ev(t0 + 25 * 60e3 + 3000, 'simulada', admin, 'Marcha blanca: el comando «Bloquear motor» no se envió (simulado)')])]);
  }
  if (veh.PKHG24) {
    const r = await resDe('PKHG24');
    const t0 = ahora - 6 * DIA + 4 * H;
    await q(`INSERT INTO inmovilizaciones (empresa_id, vehiculo_id, reserva_id, accion, motivo, estado, solicitado_por, confirmado_por, velocidad_al_enviar, lat, lng, respuesta, creado_en, confirmado_en, eventos)
      VALUES ($1,$2,$3,'inmovilizar',$4,'rechazada',$5,$6,62,-22.4558,-68.9293,$7,$8,$9,$10)`,
    [E, veh.PKHG24.id, r?.id || null, 'Salió de la región permitida sin autorización', counter.id, admin.id, 'Vencida: el vehículo no se detuvo',
      new Date(t0), new Date(t0 + 10 * 60e3), JSON.stringify([
        ev(t0, 'solicitada', counter, 'Solicitó inmovilizar PKHG-24: salió de la región permitida sin autorización'),
        ev(t0 + 10 * 60e3, 'confirmada', admin, 'Confirmó reescribiendo la patente'),
        ev(t0 + 10 * 60e3 + 3000, 'en_movimiento', admin, 'No se envió: 62 km/h. Se enviará cuando esté detenido.'),
        ev(t0 + 6 * H + 10 * 60e3, 'rechazada', null, 'El vehículo siguió en movimiento durante 6 horas: la orden se anuló')])]);
  }

  // ── TAG: tránsitos de las autopistas (un archivo de la concesionaria y una sincronización del dashboard) ──
  const tag = (pat, d, hhmm, autopista, portico, monto) => ({ patente: pat, fecha_hora: at(d, hhmm), autopista, portico, monto });
  const archivo = [
    tag('SXLR27', -5, '08:42', 'Autopista Central', 'P4 · Lo Espejo', 1180), tag('SXLR27', -4, '18:15', 'Costanera Norte', 'P2 · Kennedy', 2350),
    tag('RTKP42', -6, '13:20', 'Vespucio Norte', 'PA3 · Quilicura', 990), tag('RTKP42', -5, '07:55', 'Autopista Central', 'P9 · San Bernardo', 1450),
    tag('RTKP42', -2, '19:40', 'Costanera Norte', 'P7 · Lo Saldes', 2780), // después de devuelto: sin contrato
    tag('PBVX61', -4, '09:05', 'Vespucio Sur', 'PS5 · La Florida', 1320), tag('PBVX61', -2, '17:48', 'Autopista Central', 'P2 · Gran Avenida', 860),
    tag('SGFT35', -3, '11:12', 'Vespucio Norte', 'PA7 · Pudahuel', 1640) // reserva no se presentó: sin contrato
  ];
  await importarRegistros(E, 'tag', archivo, { origen: 'csv', nombreArchivo: 'transitos_autopistas_septiembre.csv', usuarioId: admin.id });
  const dash = [
    tag('SXLR27', -1, '10:24', 'Ruta 68', 'Peaje Lo Prado', 3500), tag('SXLR27', -1, '20:02', 'Ruta 68', 'Peaje Zapata', 2900), tag('SXLR27', -2, '13:30', 'Costanera Norte', 'P1 · Aeropuerto', 1890),
    tag('TJHV18', -1, '17:10', 'Autopista Central', 'P6 · Nos', 1210), tag('TJHV18', -1, '19:45', 'Ruta 5 Sur', 'Peaje Angostura', 3400),
    tag('RKDS90', -3, '08:31', 'Costanera Norte', 'P4 · Tabancura', 2410), tag('RKDS90', -2, '18:22', 'Vespucio Norte', 'PA1 · Américo Vespucio / Ruta 68', 1150), tag('RKDS90', -1, '22:05', 'Vespucio Sur', 'PS2 · Macul', 420),
    tag('TFZB73', -3, '12:40', 'Ruta 5 Sur', 'Peaje Troncal Angostura', 3400), tag('TFZB73', -2, '09:15', 'Autopista Central', 'P1 · Alameda', 1020),
    tag('RVLW56', -1, '11:50', 'Ruta 5 Norte', 'Peaje Las Vegas', 3200),
    tag('PKHG24', -9, '11:05', 'Costanera Norte', 'P1 · Aeropuerto', 1890),
    tag('SJRT80', -1, '15:33', 'Ruta 5 Sur', 'Peaje Puerto Montt', 1700) // disponible: sin contrato
  ].map((t, i) => ({ ...t, huella: `dash:demo-${i + 1}`, monto_neto: Math.round(t.monto / 1.19) }));
  await importarRegistros(E, 'tag', dash, { origen: 'dashboard', nombreArchivo: `Dashboard Síguelo ${dia(-30)} a ${dia(0)}`, usuarioId: null });

  // ── Multas (registro MTT, solo fecha): una asignada, una a revisar (día compartido) y una sin contrato ──
  const multa = (i, pat, d, motivo, lugar, juzgado, monto, tipo) => ({ huella: `dash:demo-m${i}`, patente: pat, fecha_infraccion: at(d, '00:00'), hora_conocida: false, motivo, lugar, juzgado, monto, tipo });
  await importarRegistros(E, 'multas', [
    multa(1, 'PKHG24', -5, 'Exceso de velocidad (más de 20 km/h sobre el límite)', 'Ruta 25, km 1.230, Calama', '1° Juzgado de Policía Local de Calama', 69542, 'grave'),
    multa(2, 'SXLR27', -2, 'Estacionar en lugar prohibido', 'Av. Libertad 1100, Viña del Mar', 'Juzgado de Policía Local de Viña del Mar', 34771, 'leve'),
    multa(3, 'SGFT35', -3, 'No respetar luz roja', 'Av. Providencia con Pedro de Valdivia, Providencia', 'Juzgado de Policía Local de Providencia', 104313, 'gravísima')
  ], { origen: 'dashboard', nombreArchivo: `Dashboard Síguelo ${dia(-30)} a ${dia(0)}`, usuarioId: null });

  // Última sincronización con el dashboard y cobertura de la revisión de multas
  const pats = Object.keys(veh).sort();
  const cobertura = pats.map((p) => ({ patente: p, estado: p === 'RFDL49' ? 'fallida' : p === 'SJRT80' ? 'nunca' : 'revisada', revisado_en: p === 'SJRT80' ? null : new Date(ahora - (p === 'RFDL49' ? 50 : 5) * H).toISOString() }));
  await q(`INSERT INTO dashboard_sincronizaciones (empresa_id, desde, hasta, estado, pasadas, multas, nuevas_tag, nuevas_multas, cobertura, utm, errores, creado_en)
    VALUES ($1,$2,$3,'parcial',$4,3,$4,3,$5,69542,$6, now() - interval '5 hours')`,
  [E, dia(-30), dia(0), dash.length, JSON.stringify(cobertura), JSON.stringify(['RFDL49: el registro MTT no respondió al revisar esta patente'])]);
}
