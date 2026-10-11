import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { levantar } from './ayuda.js';
import { firmaDemo } from '../src/contratos/imagenes-demo.js';

let t, a;
before(async () => { t = await levantar(); a = await t.como('counter@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

const FIRMA = `data:image/png;base64,${firmaDemo(5).toString('base64')}`;
const publico = (ruta, body) => fetch(t.base + ruta, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  .then(async (r) => ({ estado: r.status, datos: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }));

test('demo: contrato firmado con PDF real y hash verificable', async () => {
  const c = await t.db.uno(`SELECT * FROM contratos WHERE estado = 'firmado' LIMIT 1`);
  assert.ok(c?.pdf_archivo_id && c.hash_sha256);
  const pdf = await a.get(`/api/contratos/${c.id}/pdf`);
  assert.equal(pdf.datos.slice(0, 4).toString(), '%PDF');
  assert.equal(crypto.createHash('sha256').update(pdf.datos).digest('hex'), c.hash_sha256);
});

test('generar, firmar en /firmar/:token y verificar en /verificar/:codigo (sin sesión)', async () => {
  const r = await t.db.uno(`SELECT r.id FROM reservas r WHERE r.estado = 'confirmada' AND NOT EXISTS (SELECT 1 FROM contratos c WHERE c.reserva_id = r.id) LIMIT 1`);
  const g = await a.post(`/api/reservas/${r.id}/contrato`, {});
  assert.equal(g.estado, 201, JSON.stringify(g.datos));
  assert.match(g.datos.folio, /^CT-\d{4}-\d{4}$/);
  const token = new URL(g.datos.url_firma).pathname.split('/').pop();
  const c0 = await t.db.uno('SELECT * FROM contratos WHERE id = $1', [g.datos.id]);
  assert.ok(!/\{\{/.test(c0.contenido), 'todas las variables reemplazadas');
  assert.match(c0.contenido, new RegExp(g.datos.folio));
  assert.match(c0.contenido, /verificar\//);

  const ver0 = await publico(`/api/firmar/${token}`);
  assert.equal(ver0.estado, 200);
  assert.equal(ver0.datos.estado, 'pendiente_firma');
  assert.equal((await publico('/api/firmar/token-que-no-existe-123456789')).estado, 404);
  // validaciones
  assert.equal((await publico(`/api/firmar/${token}`, { nombre: 'Juan Pérez', documento: '12345678-5', firma: FIRMA })).estado, 400); // sin aceptar
  assert.equal((await publico(`/api/firmar/${token}`, { nombre: 'Juan Pérez', documento: '12345678-5', acepta: true })).estado, 400); // sin firma
  const f = await publico(`/api/firmar/${token}`, { nombre: 'Juan Pérez', documento: '12.345.678-5', acepta: true, firma: FIRMA });
  assert.equal(f.estado, 200, JSON.stringify(f.datos));
  assert.equal(f.datos.estado, 'firmado');
  assert.match(f.datos.hash_sha256, /^[0-9a-f]{64}$/);
  assert.equal((await publico(`/api/firmar/${token}`, { nombre: 'Juan Pérez', documento: '12345678-5', acepta: true, firma: FIRMA })).estado, 409);
  const pdf = await publico(`/api/firmar/${token}/pdf`);
  assert.equal(crypto.createHash('sha256').update(pdf.datos).digest('hex'), f.datos.hash_sha256);

  const v = await publico(`/api/verificar/${f.datos.codigo_verificacion}`);
  assert.equal(v.estado, 200);
  assert.equal(v.datos.estado, 'vigente');
  assert.equal(v.datos.firmante, 'Juan Pérez');
  assert.ok(!v.datos.firmante_documento.startsWith('12'), 'documento enmascarado');
  assert.equal((await publico('/api/verificar/ZZZZ-ZZZZ-ZZZZ')).estado, 404);

  // aviso al cliente con el PDF adjunto (retenido por marcha blanca)
  const sal = await t.db.q(`SELECT * FROM salidas WHERE entidad = 'contrato' AND entidad_id = $1`, [g.datos.id]);
  assert.ok(sal.some((s) => s.canal === 'correo' && s.adjuntos.length === 1 && s.estado === 'retenida'));

  // no se genera otro contrato si ya hay uno firmado
  assert.equal((await a.post(`/api/reservas/${r.id}/contrato`, {})).estado, 409);

  // anular → la verificación lo muestra anulado
  assert.equal((await a.post(`/api/contratos/${g.datos.id}/anular`, {})).estado, 400);
  assert.equal((await a.post(`/api/contratos/${g.datos.id}/anular`, { motivo: 'Datos del cliente erróneos' })).estado, 200);
  assert.equal((await publico(`/api/verificar/${f.datos.codigo_verificacion}`)).datos.estado, 'anulado');
  assert.equal((await a.post(`/api/reservas/${r.id}/contrato`, {})).estado, 201);
});

test('una cotización no genera contrato y la lista filtra por estado', async () => {
  const cot = await t.db.uno(`SELECT id FROM reservas WHERE estado = 'cotizacion' LIMIT 1`);
  assert.equal((await a.post(`/api/reservas/${cot.id}/contrato`, {})).estado, 409);
  const l = await a.get('/api/contratos?estado=firmado');
  assert.ok(l.datos.contratos.length >= 1 && l.datos.contratos.every((c) => c.estado === 'firmado'));
  const patio = await t.como('patio@siguelogps.cl');
  assert.equal((await patio.post(`/api/contratos/${l.datos.contratos[0].id}/anular`, { motivo: 'xxx' })).estado, 403);
});
