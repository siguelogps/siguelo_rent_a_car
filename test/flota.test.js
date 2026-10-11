import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { levantar } from './ayuda.js';

let t, admin;
before(async () => { t = await levantar(); admin = await t.como('demo@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

test('listado de flota con vencimientos y mantención', async () => {
  const r = await admin.get('/api/vehiculos');
  assert.equal(r.estado, 200);
  assert.ok(r.datos.length >= 12);
  const rkds = r.datos.find((v) => v.patente === 'RKDS90');
  assert.ok(rkds.vencimientos.find((x) => x.campo === 'venc_revision_tecnica').dias < 0);
  assert.equal(rkds.patente_fmt, 'RKDS-90');
  const tfzb = r.datos.find((v) => v.patente === 'TFZB73');
  assert.equal(tfzb.mantencion.proxima_km, 20000);
  assert.ok(tfzb.mantencion.por_km);
  const sypc = r.datos.find((v) => v.patente === 'SYPC11');
  assert.ok(sypc.ot_folio, 'muestra la OT en taller');
});

test('crear vehículo: valida patente y rechaza duplicada con 409', async () => {
  const cats = (await admin.get('/api/categorias')).datos;
  const malo = await admin.post('/api/vehiculos', { patente: 'XX-1', marca: 'Kia' });
  assert.equal(malo.estado, 400);
  assert.equal(malo.datos.campo, 'patente');
  const r = await admin.post('/api/vehiculos', { patente: 'hk-ty 55', marca: 'Kia', modelo: 'Soluto', anio: 2025, categoria_id: cats[0].id, km: '1.250', venc_revision_tecnica: '15-03-2027' });
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.patente, 'HKTY55');
  assert.equal(r.datos.km, 1250);
  assert.equal(r.datos.venc_revision_tecnica, '2027-03-15');
  const dup = await admin.post('/api/vehiculos', { patente: 'HKTY-55', marca: 'Otro' });
  assert.equal(dup.estado, 409);
  assert.match(dup.datos.error, /HKTY-55/);
  // edición a una patente existente también es 409
  const ed = await admin.put(`/api/vehiculos/${r.datos.id}`, { patente: 'SXLR27' });
  assert.equal(ed.estado, 409);
  // counter solo ve
  const counter = await t.como('counter@siguelogps.cl');
  assert.equal((await counter.post('/api/vehiculos', { patente: 'JJKK11' })).estado, 403);
  assert.equal((await counter.get('/api/vehiculos')).estado, 200);
});

test('cambio de estado manual exige motivo y queda en la bitácora', async () => {
  const v = (await admin.get('/api/vehiculos')).datos.find((x) => x.patente === 'SGFT35');
  assert.equal((await admin.post(`/api/vehiculos/${v.id}/estado`, { estado: 'fuera_servicio' })).estado, 400);
  assert.equal((await admin.post(`/api/vehiculos/${v.id}/estado`, { estado: 'fuera_servicio', motivo: 'Choque leve' })).estado, 200);
  const f = await admin.get(`/api/vehiculos/${v.id}`);
  assert.equal(f.datos.vehiculo.estado, 'fuera_servicio');
  assert.ok(f.datos.bitacora.some((b) => b.accion === 'vehiculo_estado' && b.detalle.motivo === 'Choque leve'));
  await admin.post(`/api/vehiculos/${v.id}/estado`, { estado: 'disponible', motivo: 'Reparado' });
});

test('ficha del vehículo trae reservas, órdenes, ingresos y GPS', async () => {
  const v = (await admin.get('/api/vehiculos')).datos.find((x) => x.patente === 'PBVX61');
  const f = await admin.get(`/api/vehiculos/${v.id}`);
  assert.equal(f.estado, 200);
  assert.ok(f.datos.proximas.length >= 1);
  assert.ok(f.datos.historial.some((r) => r.estado === 'devuelta'));
  assert.ok(f.datos.ingresos.total > 0);
  assert.ok(f.datos.ordenes.some((o) => o.estado === 'terminada'));
  assert.equal(f.datos.gps.origen, 'plataforma_gps');
  assert.equal((await admin.get('/api/vehiculos/999999')).estado, 404);
});

test('exportar e importar Excel', async () => {
  const r = await admin.get('/api/vehiculos/exportar');
  assert.equal(r.estado, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.datos);
  const h = wb.worksheets[0];
  assert.equal(h.getRow(1).getCell(1).value, 'Patente');
  assert.ok(String(h.getRow(2).getCell(1).value).includes('-'));
  // nueva fila, una con patente inválida y una actualización parcial
  const nuevo = new ExcelJS.Workbook();
  const hn = nuevo.addWorksheet('Flota');
  hn.addRow(['Patente', 'Marca', 'Modelo', 'Año', 'Categoría', 'Km', 'Revisión técnica (vence)']);
  hn.addRow(['LLPP-12', 'Peugeot', '208', 2024, 'Citycar', 5000, '20-05-2027']);
  hn.addRow(['MALA', 'X', 'Y', 2024, 'Citycar', 1, '']);
  hn.addRow(['SXLR-27', '', '', '', '', 21900, '']);
  const buf = Buffer.from(await nuevo.xlsx.writeBuffer());
  const imp = await admin.post('/api/vehiculos/importar', { archivo: buf.toString('base64') });
  assert.equal(imp.estado, 200, JSON.stringify(imp.datos));
  assert.equal(imp.datos.nuevas, 1);
  assert.equal(imp.datos.actualizadas, 1);
  assert.equal(imp.datos.errores.length, 1);
  const lista = (await admin.get('/api/vehiculos')).datos;
  const llpp = lista.find((v) => v.patente === 'LLPP12');
  assert.equal(llpp.venc_revision_tecnica, '2027-05-20');
  assert.equal(llpp.categoria, 'Citycar');
  assert.equal(lista.find((v) => v.patente === 'SXLR27').marca, 'Kia', 'las celdas vacías no borran datos');
});

test('categorías y propietarios con liquidación al inversionista', async () => {
  const c = await admin.post('/api/categorias', { nombre: 'Eléctrico', pasajeros: 5 });
  assert.equal(c.estado, 201);
  assert.equal((await admin.del(`/api/categorias/${c.datos.id}`)).datos.eliminada, true);
  assert.equal((await admin.post('/api/propietarios', { nombre: 'Juan Pérez', rut: '11.111.111-2' })).estado, 400);
  const p = await admin.post('/api/propietarios', { nombre: 'Juan Pérez', rut: '11.111.111-1', porcentaje: 50 });
  assert.equal(p.estado, 201);
  assert.equal(p.datos.rut, '11111111-1');
  const props = (await admin.get('/api/propietarios')).datos;
  const inv = props.find((x) => x.nombre.startsWith('Inversiones'));
  assert.equal(inv.vehiculos, 2);
  const mes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date()).slice(0, 7);
  const l = await admin.get(`/api/propietarios/${inv.id}/liquidacion?mes=${mes}`);
  assert.equal(l.estado, 200);
  assert.equal(l.datos.vehiculos.length, 2);
  assert.equal(l.datos.participacion, Math.round(l.datos.ingresos * 0.6));
  assert.equal(l.datos.a_pagar, l.datos.participacion - l.datos.costos);
  const todos = await admin.get(`/api/propietarios/liquidacion?mes=${mes}`);
  assert.ok(todos.datos.propietarios.length >= 2);
});
