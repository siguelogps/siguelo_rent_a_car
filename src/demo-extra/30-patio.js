// Datos de prueba de Entrega y devolución + Incidentes: inspecciones completas (con fotos estampadas, checklist y firma)
// para la reserva devuelta de PBVX-61 y la cerrada de RTKP-42, daños preexistentes en la flota e incidentes en distintos estados.
// Las «fotos» son dibujos SVG del vehículo (public/js/patio-dibujos.js) con el sello de fecha, hora y ubicación.
import { q, uno, transaccion } from '../db.js';
import { guardarArchivo } from '../almacenamiento/index.js';
import { foto } from '../../public/js/patio-dibujos.js';
import { OBLIGATORIAS, CHECKLIST_DEFECTO } from '../../public/js/patio-comun.js';
import { crearIncidente, evento } from '../patio/incidentes.js';

const MIN = 6e4;
const sello = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
};
const svg = (s) => Buffer.from(s, 'utf8');
const FIRMA = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 160"><rect width="330" height="160" fill="#fff"/><path d="M30,112 C45,60 60,50 66,80 C70,100 58,124 74,110 C92,92 96,62 110,70 C122,78 108,112 126,104 C146,94 150,74 166,82 C178,88 170,110 188,104 C214,94 226,70 240,86 C250,98 262,98 300,80" fill="none" stroke="#15181D" stroke-width="2.6" stroke-linecap="round"/></svg>';

async function inspeccion(E, { reserva, tipo, en, km, combustible, checklist, sucursal, usuarioId, firmante, color, patente, danosFoto = {}, observaciones = null }) {
  const [i] = await q(`INSERT INTO inspecciones (empresa_id, reserva_id, vehiculo_id, tipo, estado, km, km_gps, combustible, combustible_gps, checklist, observaciones, firmante_nombre, sucursal_id, lat, lng, realizado_por, iniciado_en, completado_en)
    VALUES ($1,$2,$3,$4,'completa',$5,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [E, reserva.id, reserva.vehiculo_id, tipo, km, combustible, JSON.stringify(checklist), observaciones, firmante, sucursal.id, sucursal.lat, sucursal.lng, usuarioId, new Date(en - 12 * MIN), en]);
  for (const [k, pos] of OBLIGATORIAS.entries()) {
    const t = new Date(en - (11 - k) * 50e3);
    const img = foto(pos, { color, patente, km: String(km).padStart(6, '0').replace(/(\d{3})$/, '.$1'), nivel: combustible / 8, dano: danosFoto[pos] || null,
      sello: [sello(t), `${sucursal.lat.toFixed(4)}, ${sucursal.lng.toFixed(4)} · ${sucursal.nombre}`] });
    const a = await guardarArchivo({ empresaId: E, entidad: 'inspeccion', entidadId: i.id, tipo: `foto_${pos}`, nombre: `${tipo}-${pos}.svg`, mime: 'image/svg+xml', datos: svg(img),
      meta: { posicion: pos, lat: sucursal.lat, lng: sucursal.lng, tomada_en: t.toISOString(), sello: true, demo: true }, usuarioId });
    await q('INSERT INTO inspeccion_fotos (empresa_id, inspeccion_id, posicion, archivo_id, lat, lng, tomada_en) VALUES ($1,$2,$3,$4,$5,$6,$7)', [E, i.id, pos, a.id, sucursal.lat, sucursal.lng, t]);
  }
  const f = await guardarArchivo({ empresaId: E, entidad: 'inspeccion', entidadId: i.id, tipo: 'firma', nombre: 'firma.svg', mime: 'image/svg+xml', datos: svg(FIRMA), meta: { firmante }, usuarioId });
  await q('UPDATE inspecciones SET firma_archivo_id = $2 WHERE id = $1', [i.id, f.id]);
  await q('INSERT INTO gps_lecturas (empresa_id, vehiculo_id, reserva_id, km, combustible, lat, lng, leido_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [E, reserva.vehiculo_id, reserva.id, km, combustible, sucursal.lat, sucursal.lng, en]);
  return i;
}

async function dano(E, { vehiculoId, inspeccionId = null, vista, x, y, tipo, descripcion, creadoEn, color = '#B9C1CB', usuarioId }) {
  const [d] = await q(`INSERT INTO danos (empresa_id, vehiculo_id, inspeccion_id, vista, x, y, tipo, descripcion, creado_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [E, vehiculoId, inspeccionId, vista, x, y, tipo, descripcion, creadoEn]);
  const img = foto('detalle', { color, dano: tipo === 'trizadura' ? null : tipo, sello: [sello(creadoEn), descripcion] });
  const a = await guardarArchivo({ empresaId: E, entidad: 'dano', entidadId: d.id, tipo: 'foto_dano', nombre: `dano-${d.id}.svg`, mime: 'image/svg+xml', datos: svg(img), meta: { demo: true }, usuarioId });
  await q('UPDATE danos SET archivo_id = $2 WHERE id = $1', [d.id, a.id]);
  return d;
}

export async function sembrar(empresaId) {
  const E = empresaId;
  const suc = Object.fromEntries((await q('SELECT id, nombre, lat, lng FROM sucursales WHERE empresa_id = $1', [E])).map((s) => [s.nombre, s]));
  const patio = await uno(`SELECT id, nombre FROM usuarios WHERE empresa_id = $1 AND rol = 'patio' ORDER BY id LIMIT 1`, [E]);
  const admin = await uno(`SELECT id FROM usuarios WHERE empresa_id = $1 AND rol = 'administrador' ORDER BY id LIMIT 1`, [E]);
  const finanzas = await uno(`SELECT id FROM usuarios WHERE empresa_id = $1 AND rol = 'finanzas' ORDER BY id LIMIT 1`, [E]);
  const uid = patio?.id ?? admin?.id ?? null;
  const veh = Object.fromEntries((await q('SELECT id, patente FROM vehiculos WHERE empresa_id = $1', [E])).map((v) => [v.patente, v.id]));
  const reservaDe = (estado, patente) => uno(`SELECT r.*, c.nombre || ' ' || COALESCE(c.apellidos, '') AS cliente FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id
      LEFT JOIN clientes c ON c.id = r.cliente_id WHERE r.empresa_id = $1 AND r.estado = $2 AND v.patente = $3 ORDER BY r.id LIMIT 1`, [E, estado, patente]);
  const scl = suc['Aeropuerto SCL'] || Object.values(suc)[0];
  const sucDe = (id) => Object.values(suc).find((s) => s.id === id) || scl;

  // ── PBVX-61 · reserva devuelta (R-1008): 3 daños preexistentes + 1 abolladura nueva en la devolución ──
  const r1 = await reservaDe('devuelta', 'PBVX61');
  if (r1) {
    const entEn = new Date(new Date(r1.inicio).getTime() + 6 * MIN);
    const devEn = new Date(new Date(r1.fin).getTime() + 104 * MIN); // 1 h 44 min de atraso
    await q('UPDATE reservas SET retiro_real = $2, devolucion_real = $3 WHERE id = $1', [r1.id, entEn, devEn]);
    const previos = [
      { vista: 'izquierdo', x: 55, y: 262, tipo: 'raya', descripcion: 'Raya puerta trasera izq.' },
      { vista: 'superior', x: 200, y: 186, tipo: 'trizadura', descripcion: 'Trizadura parabrisas, 3 cm lado copiloto' },
      { vista: 'derecho', x: 312, y: 352, tipo: 'abolladura', descripcion: 'Abolladura leve guardabarros trasero der.' }
    ];
    for (const [k, d] of previos.entries()) await dano(E, { vehiculoId: r1.vehiculo_id, ...d, creadoEn: new Date(entEn.getTime() - (40 - k) * 864e5), usuarioId: uid });
    const chE = { ...CHECKLIST_DEFECTO, notas: { extintor: 'vence 08-2027', limpieza: 'Polvo en tablero' } };
    await inspeccion(E, { reserva: r1, tipo: 'entrega', en: entEn, km: 46980, combustible: 8, checklist: chE, sucursal: sucDe(r1.sucursal_retiro_id), usuarioId: uid, firmante: r1.cliente.trim(), color: '#B9C1CB', patente: 'PBVX·61', danosFoto: { izquierdo: 'raya' } });
    const chD = { ...CHECKLIST_DEFECTO, triangulos: 1, limpieza: 'sucio', notas: { triangulos: 'Falta uno', limpieza: 'Requiere lavado: barro en pisos y tapiz' } };
    const dev = await inspeccion(E, { reserva: r1, tipo: 'devolucion', en: devEn, km: 48320, combustible: 5, checklist: chD, sucursal: sucDe(r1.sucursal_devolucion_id), usuarioId: uid, firmante: r1.cliente.trim(),
      color: '#B9C1CB', patente: 'PBVX·61', danosFoto: { izquierdo: 'raya', derecho: 'abolladura' }, observaciones: 'Cliente indica golpe en estacionamiento de supermercado.' });
    const nuevo = await dano(E, { vehiculoId: r1.vehiculo_id, inspeccionId: dev.id, vista: 'derecho', x: 300, y: 165, tipo: 'abolladura', descripcion: 'Abolladura puerta delantera der., 8 cm · «golpe en estacionamiento»', creadoEn: new Date(devEn.getTime() - 5 * MIN), usuarioId: uid });
    await transaccion(async (tx) => {
      const inc = await crearIncidente(tx, { empresaId: E, tipo: 'dano', reservaId: r1.id, vehiculoId: r1.vehiculo_id, descripcion: 'Abolladura puerta delantera der., 8 cm', usuarioId: uid, creadoEn: devEn,
        detalleReporte: `Daño nuevo detectado en la devolución por ${patio?.nombre || 'patio'}: abolladura puerta delantera der. (8 cm)` });
      await tx.query('UPDATE danos SET incidente_id = $1 WHERE id = $2', [inc.id, nuevo.id]);
      await tx.query(`UPDATE incidentes SET estado = 'presupuestado', presupuesto = 280000, taller = 'Desabolladura y Pintura Los Andes', deducible = 450000, monto_cliente = 280000 WHERE id = $1`, [inc.id]);
      await tx.query(`INSERT INTO incidente_eventos (empresa_id, incidente_id, tipo, detalle, monto, usuario_id, creado_en) VALUES ($1,$2,'presupuesto',$3,280000,$4,$5)`,
        [E, inc.id, 'Presupuesto de Desabolladura y Pintura Los Andes. Monto al cliente: $280.000 (menor entre presupuesto y deducible)', admin?.id ?? uid, new Date(devEn.getTime() + 3 * 3600e3)]);
    });
  }

  // ── RTKP-42 · reserva cerrada: raya nueva en la devolución, cobrada al cliente y denunciada al seguro ──
  const r2 = await reservaDe('cerrada', 'RTKP42');
  if (r2) {
    const entEn = new Date(new Date(r2.inicio).getTime() + 9 * MIN);
    const devEn = new Date(new Date(r2.fin).getTime() + 20 * MIN);
    await q('UPDATE reservas SET retiro_real = $2, devolucion_real = $3 WHERE id = $1', [r2.id, entEn, devEn]);
    await dano(E, { vehiculoId: r2.vehiculo_id, vista: 'frente', x: 166, y: 52, tipo: 'raya', descripcion: 'Raya parachoques delantero', creadoEn: new Date(entEn.getTime() - 60 * 864e5), color: '#E4E7EC', usuarioId: uid });
    await inspeccion(E, { reserva: r2, tipo: 'entrega', en: entEn, km: 38420, combustible: 8, checklist: { ...CHECKLIST_DEFECTO, notas: {} }, sucursal: sucDe(r2.sucursal_retiro_id), usuarioId: uid, firmante: r2.cliente.trim(), color: '#E4E7EC', patente: 'RTKP·42' });
    const dev = await inspeccion(E, { reserva: r2, tipo: 'devolucion', en: devEn, km: 39210, combustible: 8, checklist: { ...CHECKLIST_DEFECTO, notas: {} }, sucursal: sucDe(r2.sucursal_devolucion_id), usuarioId: uid, firmante: r2.cliente.trim(),
      color: '#E4E7EC', patente: 'RTKP·42', danosFoto: { izquierdo: 'raya' } });
    const nuevo = await dano(E, { vehiculoId: r2.vehiculo_id, inspeccionId: dev.id, vista: 'izquierdo', x: 52, y: 200, tipo: 'raya', descripcion: 'Raya profunda puerta delantera izq., 40 cm', creadoEn: new Date(devEn.getTime() - 4 * MIN), color: '#E4E7EC', usuarioId: uid });
    await transaccion(async (tx) => {
      const inc = await crearIncidente(tx, { empresaId: E, tipo: 'dano', reservaId: r2.id, vehiculoId: r2.vehiculo_id, descripcion: 'Raya profunda puerta delantera izq., 40 cm (cliente no informó)', usuarioId: uid, creadoEn: devEn });
      await tx.query('UPDATE danos SET incidente_id = $1 WHERE id = $2', [inc.id, nuevo.id]);
      await tx.query(`UPDATE incidentes SET estado = 'en_seguro', presupuesto = 520000, taller = 'Taller Automotriz Lyon', deducible = 350000, monto_cliente = 350000, cobrado_cliente = 350000,
          numero_siniestro = 'HDI-2026-118734', compania_seguro = 'HDI Seguros' WHERE id = $1`, [inc.id]);
      const t = (h) => new Date(devEn.getTime() + h * 3600e3);
      await evento(tx, { empresaId: E, incidenteId: inc.id, tipo: 'presupuesto', monto: 520000, usuarioId: admin?.id, detalle: 'Presupuesto de Taller Automotriz Lyon. Monto al cliente: $350.000 (menor entre presupuesto y deducible)' });
      await evento(tx, { empresaId: E, incidenteId: inc.id, tipo: 'cobro', monto: 350000, usuarioId: finanzas?.id, detalle: 'Deducible cobrado de la garantía en la liquidación' });
      await evento(tx, { empresaId: E, incidenteId: inc.id, tipo: 'seguro', usuarioId: admin?.id, detalle: 'Denunciado a HDI Seguros · siniestro HDI-2026-118734 (diferencia sobre el deducible)' });
      const evs = await tx.query('SELECT id FROM incidente_eventos WHERE incidente_id = $1 ORDER BY id', [inc.id]);
      for (const [k, e] of evs.entries()) await tx.query('UPDATE incidente_eventos SET creado_en = $2 WHERE id = $1', [e.id, t(k * 20)]);
    });
  }

  // ── Daños preexistentes en otros vehículos ──
  const otros = [
    ['SXLR27', 'frente', 182, 50, 'raya', 'Raya parachoques delantero'],
    ['SXLR27', 'derecho', 296, 226, 'abolladura', 'Abolladura leve puerta trasera der.'],
    ['TFZB73', 'superior', 168, 184, 'trizadura', 'Trizadura parabrisas, punto de impacto 1 cm'],
    ['RKDS90', 'izquierdo', 60, 380, 'raya', 'Raya guardabarros trasero izq.'],
    ['SJRT80', 'atras', 176, 436, 'abolladura', 'Abolladura parachoques trasero'],
    ['RVLW56', 'superior', 182, 340, 'otro', 'Óxido en tapa del maletero']
  ];
  for (const [k, [p, vista, x, y, tipo, descripcion]] of otros.entries()) {
    if (veh[p]) await dano(E, { vehiculoId: veh[p], vista, x, y, tipo, descripcion, creadoEn: new Date(Date.now() - (30 + k * 7) * 864e5), usuarioId: uid });
  }

  // ── Incidentes manuales: accidente en curso y falla mecánica cerrada ──
  const r3 = await reservaDe('en_curso', 'PKHG24');
  if (r3) {
    await transaccion((tx) => crearIncidente(tx, { empresaId: E, tipo: 'accidente', reservaId: r3.id, vehiculoId: r3.vehiculo_id, usuarioId: admin?.id,
      descripcion: 'Choque leve en faena (Calama): parachoques trasero y luz trasera izq. El cliente avisa por WhatsApp y envía fotos.', creadoEn: new Date(Date.now() - 20 * 3600e3) }));
  }
  if (veh.SGFT35) {
    await transaccion(async (tx) => {
      const inc = await crearIncidente(tx, { empresaId: E, tipo: 'mecanico', vehiculoId: veh.SGFT35, usuarioId: admin?.id, descripcion: 'Batería descargada: no arranca en sucursal Providencia', creadoEn: new Date(Date.now() - 12 * 864e5) });
      await tx.query(`UPDATE incidentes SET estado = 'cerrado', costo_real = 89000, presupuesto = 89000, taller = 'Baterías Express', cerrado_en = now() - interval '11 days' WHERE id = $1`, [inc.id]);
      await evento(tx, { empresaId: E, incidenteId: inc.id, tipo: 'cierre', monto: 89000, usuarioId: admin?.id, detalle: 'Batería reemplazada. Costo asumido por la empresa (sin cliente asociado).' });
    });
  }
}
