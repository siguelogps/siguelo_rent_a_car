import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { levantar } from './ayuda.js';
import { leerArchivo, analizar, filaARegistro, parsearFecha, parsearHora, parsearMonto, detectarSeparador } from '../src/tagmultas/archivo.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
let t, admin, db;
before(async () => { t = await levantar(); admin = await t.como('demo@siguelogps.cl'); db = t.db; });
after(async () => { await t.cerrar(); });

const enChile = (d) => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const b64 = (txt, enc = 'utf8') => Buffer.from(txt, enc).toString('base64');
// dd-mm-aaaa y HH:MM en Chile de un instante
const partes = (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value])); return { f: `${p.day}-${p.month}-${p.year}`, h: `${p.hour}:${p.minute}`, iso: `${p.year}-${p.month}-${p.day}` }; };

test('CSV de concesionaria: Latin-1, separador «;», títulos arriba y detección de columnas', async () => {
  const buf = fs.readFileSync(path.join(DIR, 'fixtures/transitos_autopista_central.csv'));
  const a = await leerArchivo(buf, 'transitos.csv');
  assert.equal(a.formato, 'csv');
  assert.equal(a.codificacion, 'latin-1');
  assert.equal(a.separador, ';');
  const an = analizar(a.filas, 'tag');
  assert.equal(an.fila_encabezados, 2);
  assert.equal(an.encabezados[3], 'Pórtico');
  assert.deepEqual(an.mapeo, { patente: 0, fecha_hora: null, fecha: 1, hora: 2, portico: 3, autopista: 4, monto: 5 });
  const regs = an.datos.map((f) => filaARegistro(f, an.mapeo, 'tag'));
  assert.equal(regs[0].patente, 'SXLR27');
  assert.equal(regs[0].monto, 1180);
  assert.equal(enChile(regs[0].fecha_hora), '09-10-2026, 14:35');
  assert.equal(regs[1].patente, 'SXLR27');
  assert.equal(regs[2].fecha_hora.toISOString(), '2026-10-07T10:15:00.000Z'); // aaaa-mm-dd en hora de Chile (UTC−3 en octubre)
  assert.equal(regs[3].monto, 1020);
  assert.match(regs[4].error, /Fecha no reconocida/);
});

test('CSV con coma, BOM UTF-8 y fecha y hora en una sola columna', async () => {
  const txt = '﻿Placa,Fecha y hora,Punto de cobro,Autopista,Valor\n"PBVX-61","05/10/2026 08:30","PS5, La Florida",Vespucio Sur,"1.320"\n';
  const a = await leerArchivo(Buffer.from(txt, 'utf8'), 'x.csv');
  assert.equal(a.codificacion, 'utf-8');
  assert.equal(a.separador, ',');
  const an = analizar(a.filas, 'tag');
  assert.equal(an.mapeo.fecha_hora, 1);
  assert.equal(an.mapeo.portico, 2);
  const r = filaARegistro(an.datos[0], an.mapeo, 'tag');
  assert.equal(r.portico, 'PS5, La Florida');
  assert.equal(r.monto, 1320);
  assert.equal(enChile(r.fecha_hora), '05-10-2026, 08:30');
  assert.equal(detectarSeparador('a\tb\tc\n1\t2\t3'), '\t');
});

test('Excel .xlsx con fechas como celdas de fecha', async () => {
  const wb = new ExcelJS.Workbook();
  const h = wb.addWorksheet('Multas');
  h.addRow(['Patente', 'Fecha infracción', 'Hora', 'Infracción', 'Juzgado', 'Rol', 'Monto']);
  h.addRow(['PKHG24', new Date(Date.UTC(2026, 9, 3)), '17:45', 'Exceso de velocidad', '1° JPL Calama', '1234-2026', 69542]);
  h.addRow(['SGFT35', new Date(Date.UTC(2026, 9, 4)), '', 'Luz roja', 'JPL Providencia', '', '$104.313']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const a = await leerArchivo(buf, 'multas.xlsx');
  assert.equal(a.formato, 'excel');
  const an = analizar(a.filas, 'multas');
  assert.equal(an.mapeo.fecha, 1);
  assert.equal(an.mapeo.motivo, 3);
  assert.equal(an.mapeo.rol_causa, 5);
  const [m1, m2] = an.datos.map((f) => filaARegistro(f, an.mapeo, 'multas'));
  assert.equal(m1.hora_conocida, true);
  assert.equal(enChile(m1.fecha_infraccion), '03-10-2026, 17:45');
  assert.equal(m2.hora_conocida, false);
  assert.equal(m2.monto, 104313);
});

test('fechas, horas y montos chilenos', () => {
  assert.deepEqual(parsearFecha('11-10-2026'), { fecha: '2026-10-11', hora: null });
  assert.deepEqual(parsearFecha('2026-10-11 07:05'), { fecha: '2026-10-11', hora: '07:05:00' });
  assert.deepEqual(parsearFecha('1/2/26'), { fecha: '2026-02-01', hora: null });
  assert.equal(parsearFecha('31-13-2026'), null);
  assert.equal(parsearHora('7:05 pm'), '19:05:00');
  assert.equal(parsearHora(0.5), '12:00:00');
  assert.equal(parsearMonto('$1.234'), 1234);
  assert.equal(parsearMonto('1.234,60'), 1235);
  assert.equal(parsearMonto('CLP 980'), 980);
  assert.equal(parsearMonto(''), null);
});

test('importación por la API: vista previa, asignación automática y sin duplicados', async () => {
  const camila = await db.uno(`SELECT r.id, r.retiro_real FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE v.patente = 'SXLR27' AND r.estado = 'en_curso'`);
  const dentro = partes(new Date(new Date(camila.retiro_real).getTime() + 3 * 3600e3));
  const antes = partes(new Date(Date.now() - 40 * 864e5));
  const csv = `Patente;Fecha;Hora;Pórtico;Autopista;Monto\nSXLR27;${dentro.f};${dentro.h};P7 Prueba;Costanera Norte;2.100\nSXLR27;${antes.f};${antes.h};P8 Prueba;Costanera Norte;700\n`;
  const previa = await admin.post('/api/tag-multas/importar/previa', { tipo: 'tag', nombre: 'prueba.csv', datos: b64(csv, 'latin1') });
  assert.equal(previa.estado, 200);
  assert.equal(previa.datos.total, 2);
  assert.equal(previa.datos.mapeo.portico, 3);
  const imp = await admin.post('/api/tag-multas/importar', { tipo: 'tag', nombre: 'prueba.csv', datos: b64(csv, 'latin1'), mapeo: previa.datos.mapeo });
  assert.equal(imp.estado, 200);
  assert.equal(imp.datos.nuevas, 2);
  assert.equal(imp.datos.asignadas, 1);
  assert.equal(imp.datos.sin_contrato, 1);
  const t1 = await db.uno(`SELECT * FROM tag_transitos WHERE portico = 'P7 Prueba'`);
  assert.equal(t1.estado, 'asignado');
  assert.equal(t1.reserva_id, camila.id);
  const otra = await admin.post('/api/tag-multas/importar', { tipo: 'tag', nombre: 'prueba.csv', datos: b64(csv, 'latin1'), mapeo: previa.datos.mapeo });
  assert.equal(otra.datos.nuevas, 0);
  assert.equal(otra.datos.duplicadas, 2);
  const sinPat = await admin.post('/api/tag-multas/importar', { tipo: 'tag', nombre: 'x.csv', datos: b64(csv), mapeo: { ...previa.datos.mapeo, patente: null } });
  assert.equal(sinPat.estado, 400);
});

test('reglas de asignación de multas: hora exacta, solo fecha, día compartido («revisar») y sin contrato', async () => {
  const { decidirMulta } = await import('../src/tagmultas/asignar.js');
  const E = (await db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
  const sx = await db.uno(`SELECT id FROM vehiculos WHERE patente = 'SXLR27'`);
  const camila = await db.uno(`SELECT id, cliente_id, retiro_real FROM reservas WHERE vehiculo_id = $1 AND estado = 'en_curso'`, [sx.id]);
  const anterior = await db.uno(`SELECT id, devolucion_real FROM reservas WHERE vehiculo_id = $1 AND estado = 'cerrada'`, [sx.id]);
  // la demo deja un contrato que terminó el mismo día en que retiró Camila
  assert.equal(partes(new Date(anterior.devolucion_real)).iso, partes(new Date(camila.retiro_real)).iso);
  const dia = new Date(camila.retiro_real);
  const conHora = await decidirMulta(E, sx.id, new Date(dia.getTime() + 3600e3), true);
  assert.equal(conHora.estado, 'asignada');
  assert.equal(conHora.reserva.id, camila.id);
  const soloFecha = await decidirMulta(E, sx.id, dia, false);
  assert.equal(soloFecha.estado, 'revisar');
  assert.deepEqual(soloFecha.candidatos.map((c) => c.reserva_id).sort(), [anterior.id, camila.id].sort());
  const otroDia = await decidirMulta(E, sx.id, new Date(dia.getTime() + 864e5), false);
  assert.equal(otroDia.estado, 'asignada');
  const nada = await decidirMulta(E, sx.id, new Date(Date.now() - 60 * 864e5), false);
  assert.equal(nada.estado, 'sin_contrato');
  // las de la demo pasaron por la asignación real
  const demo = await db.q(`SELECT patente, estado, cliente_id FROM multas WHERE origen = 'dashboard' ORDER BY patente`);
  assert.deepEqual(demo.map((m) => [m.patente, m.estado]), [['PKHG24', 'asignada'], ['SGFT35', 'sin_contrato'], ['SXLR27', 'revisar']]);
  assert.ok(demo[0].cliente_id);
});

test('elegir candidata, notificar al cliente (retenido en marcha blanca) y cobros posteriores', async () => {
  const m = await db.uno(`SELECT id, candidatos FROM multas WHERE estado = 'revisar' LIMIT 1`);
  const elegida = m.candidatos[1].reserva_id;
  const r = await admin.post(`/api/tag-multas/multas/${m.id}/asignar`, { reserva_id: elegida });
  assert.equal(r.estado, 200);
  assert.equal(r.datos.estado, 'asignada');
  const pend = await admin.get('/api/tag-multas/por-notificar');
  const grupo = pend.datos.find((g) => g.reserva_id === elegida);
  assert.ok(grupo.n_multas >= 1);
  const n = await admin.post(`/api/tag-multas/reservas/${elegida}/notificar`, {});
  assert.equal(n.estado, 200);
  assert.ok(n.datos.salidas.length >= 1);
  assert.ok(n.datos.salidas.every((s) => s.estado === 'retenida'));
  const sal = await db.uno(`SELECT cuerpo FROM salidas WHERE id = $1`, [n.datos.salidas.find((s) => s.canal === 'correo').id]);
  assert.match(sal.cuerpo, /Multa: Estacionar en lugar prohibido/);
  assert.equal((await db.uno('SELECT estado FROM multas WHERE id = $1', [m.id])).estado, 'notificada');
  assert.equal((await admin.post(`/api/tag-multas/reservas/${elegida}/notificar`, {})).estado, 409);
  // TAG del contrato ya cerrado (demo) → cobros posteriores por cliente
  const post = await admin.get('/api/tag-multas/cobros-posteriores');
  assert.ok(post.datos.some((g) => g.cliente.startsWith('Valentina') && g.total > 0));
});

test('condonar exige motivo y queda en bitácora; permisos por rol', async () => {
  const tg = await db.uno(`SELECT id FROM tag_transitos WHERE estado = 'sin_contrato' LIMIT 1`);
  assert.equal((await admin.post(`/api/tag-multas/tag/${tg.id}/condonar`, {})).estado, 400);
  const ok = await admin.post(`/api/tag-multas/tag/${tg.id}/condonar`, { motivo: 'Pórtico mal leído' });
  assert.equal(ok.datos.estado, 'condonado');
  assert.ok(await db.uno(`SELECT id FROM bitacora WHERE accion = 'tag_condonado' AND entidad_id = $1`, [tg.id]));
  const counter = await t.como('counter@siguelogps.cl');
  assert.equal((await counter.get('/api/tag-multas/tag')).estado, 200);
  assert.equal((await counter.post('/api/tag-multas/importar', { tipo: 'tag', nombre: 'x.csv', datos: b64('a') })).estado, 403);
  const patio = await t.como('patio@siguelogps.cl');
  assert.equal((await patio.get('/api/tag-multas/tag')).estado, 403);
});

test('conector del dashboard Síguelo (fetch simulado): tramos de 7 días, X-Api-Key, huellas, sin valorizar y errores', async () => {
  const dash = await import('../src/tagmultas/dashboard.js');
  const llamadas = [];
  const pk = await db.uno(`SELECT r.retiro_real FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE v.patente = 'PKHG24' AND r.estado = 'en_curso'`);
  const enContrato = new Date(new Date(pk.retiro_real).getTime() + 2 * 864e5).toISOString().replace('Z', '-00:00');
  let fallarTag = false;
  dash._usarFetch(async (url, op) => {
    const u = new URL(url);
    llamadas.push({ ruta: u.pathname, q: Object.fromEntries(u.searchParams), clave: op.headers['X-Api-Key'] });
    const json = (status, cuerpo) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname.endsWith('/salud')) return json(200, { ok: true, cliente: 'andesrent', clave: 'rentacar-andes', permisos: ['tag', 'multas'], vehiculos: 12 });
    if (u.pathname.endsWith('/tag/pasadas')) {
      if (fallarTag) return json(502, { ok: false, error: 'Falló la consulta a la plataforma GPS' });
      return json(200, { ok: true, desde: u.searchParams.get('desde'), hasta: u.searchParams.get('hasta'), pasadas: u.searchParams.get('desde') === llamadas.find((l) => l.ruta.endsWith('/tag/pasadas')).q.desde
        ? [{ id: 'p-1', patente: 'PKHG24', fecha_hora: enContrato, portico: 'Tramo AVO: P1 a P3', autopista: 'avo', monto: 2250, monto_neto: 1891 }, { id: 'p-2', patente: 'XXXX99', fecha_hora: enContrato, portico: 'P1', autopista: 'Ruta 68', monto: 100 }]
        : [], errores: [{ patente: 'RFDL49', motivo: 'la plataforma GPS no respondió', codigo: 'CONSULTA_FALLIDA' }] });
    }
    if (u.pathname.endsWith('/multas')) return json(200, { ok: true, utm: 69542, multas: u.searchParams.get('desde') === llamadas.find((l) => l.ruta.endsWith('/multas')).q.desde
      ? [{ id: 'm-1', patente: 'PKHG24', fecha: enContrato.slice(0, 10), motivo: 'Exceso de velocidad', lugar: 'Calama', juzgado: 'JPL Calama', tipo: 'grave', monto: null, vigente: true },
        { id: 'm-2', patente: 'PKHG24', fecha: enContrato.slice(0, 10), motivo: 'Pagada', monto: 1000, vigente: false }] : [],
    cobertura: [{ patente: 'PKHG24', estado: 'revisada', revisado_en: new Date().toISOString() }, { patente: 'RFDL49', estado: 'fallida', revisado_en: null }], errores: [] });
    return json(404, { ok: false });
  });
  try {
    assert.equal((await admin.post('/api/tag-multas/dashboard/sincronizar', {})).estado, 400); // sin configurar
    assert.equal((await admin.put('/api/integraciones/dashboard_siguelo', { url: 'https://dash.prueba.cl/', cliente: 'andesrent', api_key: 'clave-secreta' })).estado, 200);
    const prueba = await admin.post('/api/integraciones/dashboard_siguelo/probar', {});
    assert.equal(prueba.datos.ok, true);
    assert.match(prueba.datos.mensaje, /^Conectado: andesrent · 12 vehículos/);
    const r = await admin.post('/api/tag-multas/dashboard/sincronizar', {});
    assert.equal(r.estado, 200);
    const tags = llamadas.filter((l) => l.ruta === '/api/integracion/v1/tag/pasadas');
    assert.ok(tags.length >= 5); // 30 días en tramos de 7
    for (const l of tags) {
      assert.equal(l.clave, 'clave-secreta');
      assert.ok((Date.parse(l.q.hasta) - Date.parse(l.q.desde)) / 864e5 <= 6);
      assert.ok(l.q.patentes.split(',').includes('PKHG24'));
    }
    assert.equal(r.datos.nuevas_tag, 1); // la patente ajena se ignora
    assert.equal(r.datos.estado, 'ok');
    const p = await db.uno(`SELECT * FROM tag_transitos WHERE huella = 'dash:p-1'`);
    assert.equal(p.estado, 'asignado');
    assert.equal(p.autopista, 'AVO (Américo Vespucio Oriente)');
    assert.equal(p.monto_neto, 1891);
    const m = await db.uno(`SELECT * FROM multas WHERE huella = 'dash:m-1'`);
    assert.equal(m.hora_conocida, false);
    assert.equal(m.monto, 0);
    assert.equal(m.sin_valorizar, true);
    assert.equal(m.estado, 'asignada');
    assert.equal(await db.uno(`SELECT id FROM multas WHERE huella = 'dash:m-2'`), null); // no vigente
    const imp = await db.uno(`SELECT errores FROM importaciones WHERE origen = 'dashboard' AND tipo = 'tag' ORDER BY id DESC LIMIT 1`);
    assert.ok(imp.errores.some((e) => /RFDL49: la plataforma GPS no respondió \(consulta fallida\)/.test(e.error)));
    const est = await admin.get('/api/tag-multas/dashboard');
    assert.equal(est.datos.cobertura.revisadas, 1);
    assert.equal(est.datos.cobertura.fallidas, 1);
    // 502: nunca se toma como «sin datos»
    fallarTag = true;
    const r2 = await admin.post('/api/tag-multas/dashboard/sincronizar', {});
    assert.equal(r2.datos.estado, 'parcial');
    assert.ok(r2.datos.errores.some((e) => /HTTP 502/.test(e)));
    // la siguiente pide desde la última sincronización completa − 2 días
    assert.equal(r2.datos.desde, new Date(Date.parse(`${r.datos.hasta}T12:00:00Z`) - 2 * 864e5).toISOString().slice(0, 10));
  } finally { dash._usarFetch(null); }
});
