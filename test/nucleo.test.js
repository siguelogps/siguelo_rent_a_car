import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';
import { validarRut, formatearRut } from '../src/util/rut.js';
import { diasArriendo, clp, fecha, desdeLocal } from '../src/util/formato.js';
import { cifrar, descifrar } from '../src/cifrado.js';

let t;
before(async () => { t = await levantar(); });
after(async () => { await t.cerrar(); });

test('RUT con dígito verificador', () => {
  assert.equal(validarRut('16.482.903-0'), true);
  assert.equal(validarRut('16.482.903-1'), false);
  assert.equal(validarRut('12.345.670-K'), true);
  assert.equal(formatearRut('164829030'), '16.482.903-0');
});

test('formato chileno', () => {
  assert.equal(clp(238455), '$238.455');
  assert.equal(fecha('2026-10-11'), '11-10-2026');
  assert.equal(diasArriendo('2026-10-11T14:00:00Z', '2026-10-16T14:30:00Z'), 5);
  assert.equal(diasArriendo('2026-10-11T14:00:00Z', '2026-10-16T15:30:00Z'), 6);
});

// 5-nov (revisión exhaustiva, RNT-01): los días se cuentan en hora de reloj de Santiago. En abril el reloj se atrasa una
// hora (el arriendo dura 73 h reales) y en septiembre se adelanta (71 h): los dos son 3 días, no 4 ni 2.
test('días de arriendo a través de los cambios de hora de abril y septiembre', () => {
  const L = (f, h) => desdeLocal(f, h);
  assert.equal(diasArriendo(L('2027-04-02', '10:00'), L('2027-04-05', '10:00'), 59), 3, 'abril: 73 h reales = 3 días de reloj');
  assert.equal(diasArriendo(L('2027-04-02', '10:00'), L('2027-04-05', '10:59'), 59), 3, 'abril: dentro de la tolerancia');
  assert.equal(diasArriendo(L('2027-04-02', '10:00'), L('2027-04-05', '11:00'), 59), 4, 'abril: pasada la tolerancia');
  assert.equal(diasArriendo(L('2027-09-03', '10:00'), L('2027-09-06', '10:00'), 59), 3, 'septiembre: 71 h reales = 3 días de reloj');
  assert.equal(diasArriendo(L('2027-09-03', '10:00'), L('2027-09-06', '11:00'), 59), 4, 'septiembre: una hora de atraso sí se cobra');
});

test('cifrado de credenciales', () => {
  assert.deepEqual(descifrar(cifrar({ token: 'abc' })), { token: 'abc' });
});

test('ingreso y permisos por rol', async () => {
  const admin = await t.como('demo@siguelogps.cl');
  const yo = await admin.get('/api/yo');
  assert.equal(yo.estado, 200);
  assert.equal(yo.datos.empresa.marcha_blanca, true);
  const patio = await t.como('patio@siguelogps.cl');
  assert.equal((await patio.get('/api/integraciones')).estado, 403);
  assert.equal((await admin.get('/api/integraciones')).estado, 200);
});

// 22-oct (espec. Backoffice): WhatsApp pasó a ser gestionado por Síguelo; el ejemplo de integración del cliente es Mercado Pago.
test('solo administradores activan integraciones', async () => {
  const counter = await t.como('counter@siguelogps.cl');
  assert.equal((await counter.post('/api/integraciones/mercadopago/activar', { activa: true })).estado, 403);
  const admin = await t.como('demo@siguelogps.cl');
  assert.equal((await admin.put('/api/integraciones/whatsapp', { phone_id: '123', token: 'secreto' })).estado, 403, 'WhatsApp lo configura Síguelo');
  const r = await admin.put('/api/integraciones/mercadopago', { public_key: 'pk', access_token: 'secreto' });
  assert.equal(r.datos.config.access_token, '••••••••');
});
