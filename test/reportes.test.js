import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { levantar } from './ayuda.js';
import { periodoDe } from '../src/reportes/calculo.js';

let t, rep, E, vA, vB;
const cerca = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

before(async () => {
  t = await levantar();
  // Empresa nueva con un conjunto de datos controlado (marzo 2026, sin cambio de hora)
  const { crearEmpresa } = await import('../src/api/01-empresas.js');
  const { desdeLocal } = await import('../src/util/formato.js');
  const e = await crearEmpresa({ nombre: 'Reportes Prueba', slug: 'reportes-prueba', admin_correo: 'rep@prueba.cl', admin_clave: 'clave1234' });
  E = e.id;
  const q = t.db.q;
  const [cat] = await q(`INSERT INTO categorias (empresa_id, nombre) VALUES ($1, 'Citycar') RETURNING id`, [E]);
  [vA] = await q(`INSERT INTO vehiculos (empresa_id, patente, marca, modelo, categoria_id) VALUES ($1,'AAAA11','Kia','Morning',$2) RETURNING id`, [E, cat.id]);
  [vB] = await q(`INSERT INTO vehiculos (empresa_id, patente, marca, modelo, categoria_id) VALUES ($1,'BBBB22','Kia','Rio',$2) RETURNING id`, [E, cat.id]);
  const L = (f, h = '00:00') => desdeLocal(f, h);
  const res = async (folio, estado, v, ini, fin, total, devReal = null) => q(`INSERT INTO reservas (empresa_id, folio, estado, vehiculo_id, categoria_id, inicio, fin, total, retiro_real, devolucion_real)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6,$9)`, [E, folio, estado, v.id, cat.id, ini, fin, total, devReal]);
  // A: cruza el inicio del período (27-02 12:00 → 03-03 12:00): 2,5 días dentro; devuelta 30 min tarde (a tiempo)
  await res('R-1', 'cerrada', vA, L('2026-02-27', '12:00'), L('2026-03-03', '12:00'), 100000, new Date(L('2026-03-03', '12:00').getTime() + 30 * 60e3));
  // A: cruza el fin del período (09-03 → 12-03): 2 días dentro
  await res('R-2', 'cerrada', vA, L('2026-03-09'), L('2026-03-12'), 30000, L('2026-03-12'));
  // B: 1 día, devuelta 4 h tarde (atraso ≥ 3 h)
  await res('R-3', 'devuelta', vB, L('2026-03-01'), L('2026-03-02'), 50000, new Date(L('2026-03-02').getTime() + 4 * 36e5));
  // B: cotización (no ocupa ni suma ingreso) y mantención 2 días
  await res('C-1', 'cotizacion', vB, L('2026-03-07'), L('2026-03-09'), 40000);
  await q(`INSERT INTO bloqueos (empresa_id, vehiculo_id, inicio, fin, motivo) VALUES ($1,$2,$3,$4,'Mantención')`, [E, vB.id, L('2026-03-05'), L('2026-03-07')]);
  await q(`INSERT INTO ordenes_trabajo (empresa_id, folio, vehiculo_id, motivo, costo, estado, inicio, fin) VALUES ($1,'OT-1',$2,'Mantención',120000,'terminada',$3,$4)`, [E, vB.id, L('2026-03-05'), L('2026-03-07')]);
  await q(`INSERT INTO reservas (empresa_id, folio, estado, vehiculo_id, inicio, fin, total) VALUES ($1,'R-4','no_show',$2,$3,$4,0)`, [E, vA.id, L('2026-03-04'), L('2026-03-05')]);
  const admin = await t.como('rep@prueba.cl', 'clave1234');
  rep = (await admin.get('/api/reportes?periodo=personalizado&desde=2026-03-01&hasta=2026-03-10')).datos;
});
after(async () => { await t.cerrar(); });

test('períodos: mes, semana (lunes a domingo), trimestre, año y rango', () => {
  assert.deepEqual([periodoDe({ periodo: 'mes', ref: '2026-02-10' }).desde, periodoDe({ periodo: 'mes', ref: '2026-02-10' }).hasta], ['2026-02-01', '2026-02-28']);
  const s = periodoDe({ periodo: 'semana', ref: '2026-10-11' });
  assert.deepEqual([s.desde, s.hasta], ['2026-10-05', '2026-10-11']);
  const tr = periodoDe({ periodo: 'trimestre', ref: '2026-02-15' });
  assert.deepEqual([tr.desde, tr.hasta, tr.anterior.desde, tr.anterior.hasta], ['2026-01-01', '2026-03-31', '2025-10-01', '2025-12-31']);
  assert.equal(periodoDe({ periodo: 'anio', ref: '2026-05-01' }).hasta, '2026-12-31');
  assert.equal(periodoDe({ periodo: 'mes', ref: '2026-01-20' }).anterior.desde, '2025-12-01');
  assert.throws(() => periodoDe({ periodo: 'personalizado', desde: '2026-03-10', hasta: '2026-03-01' }));
});

test('ocupación con reservas que cruzan los bordes del período, excluyendo mantención', () => {
  assert.equal(rep.dias, 10);
  assert.equal(rep.vehiculos, 2);
  const arrA = 2.5 + 0.5 / 24 + 2;   // R-1 (con los 30 min de atraso) + R-2
  const arrB = 1 + 4 / 24;           // R-3 con 4 h de atraso
  const disp = 10 + (10 - 2);        // B pierde 2 días por mantención
  cerca(rep.kpis.ocupacion, (arrA + arrB) / disp);
  assert.equal(rep.kpis.dias_disponibles, 18);
  assert.equal(rep.kpis.dias_ociosos, Math.round(disp - arrA - arrB));
  const a = rep.por_vehiculo.find((v) => v.patente === 'AAAA11'), b = rep.por_vehiculo.find((v) => v.patente === 'BBBB22');
  cerca(a.dias_arrendado, Math.round(arrA * 10) / 10);
  assert.equal(b.dias_mantencion, 2);
  assert.equal(b.mantencion_costo, 120000);
  assert.equal(rep.kpis.costo_mantencion, 120000);
  assert.equal(rep.kpis.ordenes_trabajo, 1);
  // Mapa de calor: B en mantención el 5 y 6 de marzo
  const filaB = rep.calor.filas.find((f) => f.patente === 'BBBB22');
  assert.equal(rep.calor.columnas.length, 10);
  assert.equal(filaB.celdas[4].man, 1);
  assert.equal(filaB.celdas[5].man, 1);
  assert.equal(filaB.celdas[6].arr, 0); // la cotización no ocupa
  // Categoría
  const c = rep.por_categoria[0];
  assert.equal(c.dias_vehiculo, 20);
  cerca(c.pct_mantencion, 2 / 20);
});

test('ingreso prorrateado por días dentro del período', () => {
  const esperado = Math.round(100000 * 2.5 / 4) + Math.round(30000 * 2 / 3) + 50000;
  assert.ok(Math.abs(rep.kpis.ingreso - esperado) <= 1, `${rep.kpis.ingreso} vs ${esperado}`);
  assert.equal(rep.kpis.ingreso_por_dia_disponible, Math.round(rep.kpis.ingreso / 18));
  const suma = rep.ingreso_diario.reduce((s, d) => s + d.ingreso, 0);
  assert.ok(Math.abs(suma - esperado) <= 10);
  assert.equal(rep.ingreso_diario[0].dia, '2026-03-01');
  assert.equal(rep.ingreso_diario[0].ingreso, 25000 + 50000); // R-1: 100.000/4 por día; R-3 completo
});

test('cumplimiento de devoluciones y no presentados', () => {
  const d = rep.devoluciones;
  assert.equal(d.total, 2);          // R-1 y R-3 (R-2 vence fuera del período)
  assert.equal(d.a_tiempo, 1);
  assert.equal(d.atraso_grave, 1);
  assert.equal(d.no_show, 1);
  assert.equal(rep.kpis.devoluciones_a_tiempo, 0.5);
});

test('exportación a Excel: tabla y libro completo válidos con encabezados en español', async () => {
  const admin = await t.como('rep@prueba.cl', 'clave1234');
  const r = await admin.get('/api/reportes/ingreso-vehiculo.xlsx?periodo=personalizado&desde=2026-03-01&hasta=2026-03-10');
  assert.equal(r.estado, 200);
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  assert.equal(r.datos.subarray(0, 2).toString(), 'PK');
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(r.datos);
  const ws = libro.worksheets[0];
  assert.equal(ws.getRow(1).getCell(1).value, 'Patente');
  assert.equal(ws.getRow(1).getCell(9).value, 'Ingreso');
  assert.equal(ws.rowCount, 3);
  assert.match(ws.getRow(2).getCell(9).numFmt, /\$/);
  const todo = await admin.get('/api/reportes/completo.xlsx?periodo=personalizado&desde=2026-03-01&hasta=2026-03-10');
  const l2 = new ExcelJS.Workbook();
  await l2.xlsx.load(todo.datos);
  assert.deepEqual(l2.worksheets.map((w) => w.name), ['Resumen', 'Ingreso por día', 'Ocupación por categoría', 'Ocupación por vehículo y día', 'Ingreso por vehículo', 'Daños por cliente', 'Devoluciones']);
  assert.equal((await admin.get('/api/reportes/nada.xlsx')).estado, 404);
});

test('permisos y aislamiento entre empresas', async () => {
  assert.equal((await (await t.como('patio@siguelogps.cl')).get('/api/reportes')).estado, 403);
  assert.equal((await (await t.como('counter@siguelogps.cl')).get('/api/reportes')).estado, 403);
  const fin = await (await t.como('finanzas@siguelogps.cl')).get('/api/reportes?periodo=mes');
  assert.equal(fin.estado, 200);
  assert.ok(!fin.datos.por_vehiculo.some((v) => v.patente === 'AAAA11'));
  // Con datos de prueba de Andes: hay ingresos e historial de daños por cliente
  const anio = await (await t.como('demo@siguelogps.cl')).get('/api/reportes?periodo=anio');
  assert.ok(anio.datos.kpis.ingreso > 0);
  assert.ok(anio.datos.danos_por_cliente.length > 0);
  assert.equal(anio.datos.calor.unidad, 'semana');
});
