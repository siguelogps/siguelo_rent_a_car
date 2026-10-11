import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';
import { calcularLineas, diasAtraso, resumir, fusionar, valorDia } from '../src/liquidacion/calculo.js';

let t, admin, E;
before(async () => {
  t = await levantar();
  admin = await t.como('demo@siguelogps.cl');
  E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
});
after(async () => { await t.cerrar(); });

const AJ = { tolerancia_min: 59, precio_litro: 1390, cargo_servicio_combustible: 5000, lavado: 15000, triangulo: 12000 };
const linea = (ls, c) => ls.find((l) => l.codigo === c);

test('cálculo: atraso, km extra, combustible, lavado y triángulo (maqueta 05)', () => {
  const fin = '2026-10-16T15:00:00Z'; // 12:00 en Chile
  const ls = calcularLineas({
    reserva: { fin, devolucion_real: '2026-10-16T16:44:00Z', km_incluidos: 1250, precio_km_extra: 180, deducible: 395120 },
    ajustes: AJ, vehiculo: { capacidad_estanque: 45 }, tarifaDia: 32990,
    entrega: { km: 40000, km_gps: 40000, combustible: 8, combustible_gps: 8, checklist: { triangulos: 2, limpieza: 'ok' } },
    devolucion: { km: 41554, km_gps: 41554, combustible: 5, combustible_gps: 5, checklist: { triangulos: 1, limpieza: 'sucio' } },
    tags: [{ id: 1, monto: 10000, autopista: 'Autopista Central' }, { id: 2, monto: 8640, autopista: 'Costanera Norte' }],
    incidentes: [{ id: 7, folio: 'INC-0087', descripcion: 'abolladura', presupuesto: 280000, taller: 'Desabolladuría Sur', deducible: 395120 }]
  });
  assert.equal(linea(ls, 'atraso').monto, 32990);
  assert.match(linea(ls, 'atraso').calculo, /Devolvió 13:44, pactado 12:00 \(tolerancia 59 min\) · 1 día × \$32\.990/);
  assert.equal(linea(ls, 'km_extra').monto, 54720);
  assert.equal(linea(ls, 'km_extra').origen, 'Plataforma GPS');
  assert.match(linea(ls, 'km_extra').calculo, /1\.554 km recorridos − 1\.250 incluidos = 304 km × \$180/);
  assert.equal(linea(ls, 'combustible').monto, 28630); // 3/8 de 45 L ≈ 17 L × 1.390 + 5.000
  assert.equal(linea(ls, 'tag').monto, 18640);
  assert.equal(linea(ls, 'multas').monto, 0);
  assert.equal(linea(ls, 'multas').incluir, false);
  assert.equal(linea(ls, 'dano:7').monto, 280000); // el menor entre presupuesto y deducible
  assert.equal(linea(ls, 'faltante:triangulos').monto, 12000);
  assert.equal(linea(ls, 'lavado').monto, 15000);
  assert.equal(resumir(ls, 500000).total_cargos, 441980);
  assert.deepEqual(resumir(ls, 500000), { total_cargos: 441980, garantia: 500000, captura: 441980, libera: 58020, saldo: 0 });
});

test('cálculo: tolerancia, km libre, sin faltante y presupuesto pendiente', () => {
  assert.equal(diasAtraso('2026-10-16T15:00:00Z', '2026-10-16T15:59:00Z', 59), 0);
  assert.equal(diasAtraso('2026-10-16T15:00:00Z', '2026-10-17T15:30:00Z', 59), 1);
  assert.equal(diasAtraso('2026-10-16T15:00:00Z', '2026-10-17T16:30:00Z', 59), 2);
  const ls = calcularLineas({
    reserva: { fin: '2026-10-16T15:00:00Z', devolucion_real: '2026-10-16T15:20:00Z', km_incluidos: null, precio_km_extra: 0, deducible: 450000 },
    ajustes: AJ, tarifaDia: 30000,
    entrega: { km: 100, combustible: 6, checklist: {} }, devolucion: { km: 900, combustible: 6, checklist: { limpieza: 'ok' } },
    incidentes: [{ id: 3, folio: 'INC-0003', descripcion: 'raya', presupuesto: null }]
  });
  assert.equal(linea(ls, 'atraso').monto, 0);
  assert.match(linea(ls, 'km_extra').calculo, /Kilometraje libre · 800 km/);
  assert.equal(linea(ls, 'combustible').monto, 0);
  assert.equal(linea(ls, 'dano:3').monto, 0);
  assert.equal(linea(ls, 'dano:3').aviso, 'Presupuesto pendiente');
  assert.equal(linea(ls, 'lavado'), undefined);
  assert.equal(valorDia({ dias: 5, lineas: [{ codigo: 'arriendo', monto: 164950 }] }, 1), 32990);
  // Recalcular conserva lo editado y los cargos manuales
  const prev = [{ ...linea(ls, 'atraso'), monto: 5000, incluir: true, editado: true, motivo: 'x' }, { codigo: 'manual:a', concepto: 'Peaje', monto: 2000, incluir: true, editado: true }];
  const f = fusionar(ls, prev);
  assert.equal(linea(f, 'atraso').monto, 5000);
  assert.ok(linea(f, 'manual:a'));
});

// Reserva devuelta nueva con inspecciones insertadas a mano
async function reservaDevuelta({ garantia = 300000, kmExtra = 200, combDev = 6, limpieza = 'sucio' } = {}) {
  const v = await t.db.uno(`SELECT v.id, v.categoria_id, v.sucursal_id FROM vehiculos v WHERE v.empresa_id = $1 AND v.patente = 'SGFT35'`, [E]);
  const c = await t.db.uno(`SELECT id FROM clientes WHERE empresa_id = $1 AND documento = '17935221-4'`, [E]);
  const n = (await t.db.uno('SELECT count(*)::int AS n FROM reservas')).n;
  const fin = new Date(Date.now() - 3 * 3600e3);
  const inicio = new Date(fin.getTime() - 3 * 864e5);
  const [r] = await t.db.q(`INSERT INTO reservas (empresa_id, folio, estado, cliente_id, vehiculo_id, categoria_id, sucursal_retiro_id, sucursal_devolucion_id, inicio, fin, cotizacion, total, km_incluidos, precio_km_extra, garantia, deducible, retiro_real, devolucion_real)
     VALUES ($1,$2,'devuelta',$3,$4,$5,$6,$6,$7,$8,$9,99000,750,150,$10,450000,$7,$11) RETURNING *`,
    [E, `R-T${n}`, c.id, v.id, v.categoria_id, v.sucursal_id, inicio, fin, JSON.stringify({ dias: 3, lineas: [{ codigo: 'arriendo', monto: 99000 }] }), garantia, new Date(fin.getTime() + 2 * 3600e3)]);
  for (const [tipo, km, comb, chk] of [['entrega', 10000, 8, { triangulos: 2, limpieza: 'ok' }], ['devolucion', 10750 + kmExtra, combDev, { triangulos: 2, limpieza }]]) {
    await t.db.q(`INSERT INTO inspecciones (empresa_id, reserva_id, vehiculo_id, tipo, estado, km, combustible, checklist, completado_en) VALUES ($1,$2,$3,$4,'completa',$5,$6,$7, now())`,
      [E, r.id, v.id, tipo, km, comb, JSON.stringify(chk)]);
  }
  return r;
}

test('liquidación por API: cálculo, condonar con motivo, aprobar captura y libera (marcha blanca → simulado)', async () => {
  const r = await reservaDevuelta();
  // garantía retenida en marcha blanca (simulada)
  const { iniciarCobro } = await import('../src/pagos/index.js');
  const g = await iniciarCobro({ empresaId: E, reservaId: r.id, concepto: 'garantia', monto: 300000, proveedor: 'webpay' });
  assert.equal(g.simulado, true);
  const v = await admin.get(`/api/liquidaciones/${r.id}`);
  assert.equal(v.estado, 200);
  const ls = v.datos.liquidacion.lineas;
  assert.equal(linea(ls, 'atraso').monto, 33000);        // 2 h tarde → 1 día × 99.000/3
  assert.equal(linea(ls, 'km_extra').monto, 30000);      // 200 km × 150
  assert.equal(linea(ls, 'km_extra').origen, 'Check-in');
  assert.equal(linea(ls, 'combustible').monto, 2 * 1390 * 0 + Math.round(2 * 45 / 8) * 1390 + 5000); // 2/8 de 45 L (SGFT35 es Sedán, 45 L)
  assert.equal(linea(ls, 'lavado').monto, 15000);
  assert.equal(v.datos.resumen.garantia, 300000);

  // condonar sin motivo → 400; con motivo → queda excluido y en la bitácora
  const sin = await admin.patch(`/api/liquidaciones/${r.id}/lineas/lavado`, { incluir: false });
  assert.equal(sin.estado, 400);
  const con = await admin.patch(`/api/liquidaciones/${r.id}/lineas/lavado`, { incluir: false, motivo: 'Cliente frecuente' });
  assert.equal(con.estado, 200);
  assert.equal(linea(con.datos.liquidacion.lineas, 'lavado').incluir, false);
  const b = await t.db.uno(`SELECT * FROM bitacora WHERE accion = 'liquidacion_cargo_condonado' ORDER BY id DESC LIMIT 1`);
  assert.equal(b.detalle.motivo, 'Cliente frecuente');
  const add = await admin.post(`/api/liquidaciones/${r.id}/lineas`, { concepto: 'Estacionamiento', monto: 3000, motivo: 'ticket' });
  assert.equal(add.estado, 200);
  const total = add.datos.resumen.total_cargos;
  assert.equal(total, 33000 + 30000 + linea(ls, 'combustible').monto + 3000);

  const ap = await admin.post(`/api/liquidaciones/${r.id}/aprobar`, { documento: 'boleta' });
  assert.equal(ap.estado, 200, JSON.stringify(ap.datos));
  assert.equal(ap.datos.capturado, total);
  assert.equal(ap.datos.liberado, 300000 - total);
  assert.equal(ap.datos.saldo, 0);
  assert.equal(ap.datos.simulado, true);
  assert.equal(ap.datos.dte.estado, 'retenido');
  assert.equal(ap.datos.liquidacion.estado, 'cobrada');
  const pg = await t.db.uno('SELECT * FROM pagos WHERE id = $1', [g.pagoId]);
  assert.equal(pg.estado, 'capturado');
  assert.equal(pg.monto_capturado, total);
  assert.equal(pg.detalle.simulado, true);
  assert.equal((await t.db.uno('SELECT estado FROM reservas WHERE id = $1', [r.id])).estado, 'cerrada');
  assert.ok(ap.datos.liquidacion.pdf_archivo_id);
  const sal = await t.db.q(`SELECT * FROM salidas WHERE entidad = 'liquidacion' AND entidad_id = $1`, [ap.datos.liquidacion.id]);
  assert.ok(sal.length >= 1 && sal.every((s) => s.estado === 'retenida'));
  assert.equal(sal.find((s) => s.canal === 'correo').adjuntos[0].archivo_id, ap.datos.liquidacion.pdf_archivo_id);
  // ya aprobada: no se puede editar
  assert.equal((await admin.patch(`/api/liquidaciones/${r.id}/lineas/atraso`, { incluir: false, motivo: 'x' })).estado, 409);
  const pdf = await admin.get(`/api/liquidaciones/${r.id}/pdf`);
  assert.equal(pdf.datos.subarray(0, 4).toString(), '%PDF');
});

test('cargos mayores que la garantía: se captura todo y queda saldo con enlace de pago', async () => {
  const r = await reservaDevuelta({ kmExtra: 2000, limpieza: 'ok', combDev: 8 });
  const { registrarManual } = await import('../src/pagos/index.js');
  await registrarManual({ empresaId: E, reservaId: r.id, concepto: 'garantia', metodo: 'pos', monto: 100000 });
  const v = await admin.get(`/api/liquidaciones/${r.id}`);
  const total = v.datos.resumen.total_cargos;
  assert.ok(total > 100000);
  assert.equal(v.datos.resumen.saldo, total - 100000);
  const ap = await admin.post(`/api/liquidaciones/${r.id}/aprobar`, { documento: 'ninguno', avisar_whatsapp: false });
  assert.equal(ap.estado, 200, JSON.stringify(ap.datos));
  assert.equal(ap.datos.capturado, 100000);
  assert.equal(ap.datos.saldo, total - 100000);
  assert.match(ap.datos.link, /\/api\/pagos\/link\//);
  assert.equal(ap.datos.liquidacion.estado, 'aprobada');
  const saldo = await t.db.uno('SELECT * FROM pagos WHERE id = $1', [ap.datos.liquidacion.pago_saldo_id]);
  assert.equal(saldo.concepto, 'liquidacion');
  assert.equal(saldo.estado, 'pendiente');
  // el cliente abre el enlace en marcha blanca → simulado → la liquidación queda cobrada
  const token = ap.datos.link.split('/').pop();
  const r2 = await fetch(`${t.base}/api/pagos/link/${token}`, { redirect: 'manual' });
  assert.equal(r2.status, 303);
  assert.match(r2.headers.get('location'), /^\/pago-resultado\?pago=\d+&t=/);
  const v2 = await admin.get(`/api/liquidaciones/${r.id}`);
  assert.equal(v2.datos.liquidacion.estado, 'cobrada');
});

test('permisos: counter ve pero no aprueba liquidaciones', async () => {
  const counter = await t.como('counter@siguelogps.cl');
  assert.equal((await counter.get('/api/liquidaciones')).estado, 200);
  const r = await t.db.uno(`SELECT id FROM reservas WHERE estado = 'devuelta' AND empresa_id = $1 LIMIT 1`, [E]);
  assert.equal((await counter.post(`/api/liquidaciones/${r.id}/aprobar`, {})).estado, 403);
  assert.equal((await (await t.como('patio@siguelogps.cl')).get('/api/liquidaciones')).estado, 403);
});
