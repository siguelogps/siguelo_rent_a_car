import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t;
before(async () => { t = await levantar(); });
after(async () => { await t.cerrar(); });

test('UF, dólar y UTM se leen de la fuente oficial (CMF con clave, si no Banco Central vía mindicador)', async () => {
  const { actualizarIndicadores, indicador, _usarFetch } = await import('../src/indicadores.js');
  const llamadas = [];
  _usarFetch(async (url) => {
    llamadas.push(url);
    if (url.includes('cmfchile')) {
      const k = url.includes('/uf?') ? 'UFs' : url.includes('/dolar?') ? 'Dolares' : 'UTMs';
      const v = { UFs: '39.612,45', Dolares: '948,12', UTMs: '69.611' }[k];
      return new Response(JSON.stringify({ [k]: [{ Valor: v, Fecha: '2026-10-10' }] }));
    }
    return new Response('{}', { status: 500 });
  });
  process.env.API_KEY_CMF = 'clave-prueba';
  const r = await actualizarIndicadores();
  assert.equal(r.uf.valor, 39612.45);
  assert.equal(r.dolar.valor, 948.12);
  assert.equal(r.utm.valor, 69611);
  assert.equal((await indicador('uf')).fuente, 'CMF Chile');
  // Sin clave: mindicador.cl primero
  delete process.env.API_KEY_CMF;
  _usarFetch(async (url) => new Response(JSON.stringify({ serie: [{ valor: url.endsWith('/uf') ? 39700.1 : url.endsWith('/dolar') ? 950.5 : 69700, fecha: new Date().toISOString() }] })));
  const r2 = await actualizarIndicadores();
  assert.equal(r2.uf.valor, 39700.1);
  assert.match(r2.uf.fuente, /Banco Central/);
  // Valor fuera de rango se rechaza
  _usarFetch(async () => new Response(JSON.stringify({ serie: [{ valor: 12, fecha: new Date().toISOString() }] })));
  const r3 = await actualizarIndicadores();
  assert.ok(r3.uf.error);
  _usarFetch(null);
  const admin = await t.como('demo@siguelogps.cl');
  const api = await admin.get('/api/indicadores');
  assert.equal(api.estado, 200);
  assert.equal(api.datos.uf.valor, 39700.1);
});
