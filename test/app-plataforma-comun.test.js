// Entrada desde el menú Apps de la plataforma de rastreo: la parte común (igual en todas las herramientas).
// Lo mismo que prueban test-app-wialon.js y verificar-app-wialon.js en Síguelo OS: SSRF, hash vencido o reusado,
// la cuenta sale de la respuesta de la plataforma, la sesión del hash se cierra siempre, la URL se limpia antes de
// pedir nada y `user` nunca se pinta como HTML. Sin red: la plataforma y el navegador se suplantan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as AP from '../src/app-plataforma.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

/** Plataforma de mentira: guarda a qué dirección se llamó y con qué servicio. */
function plataformaFalsa(respuestas = {}) {
  const llamadas = [];
  const fetch = async (url, o) => {
    const p = new URLSearchParams(o.body);
    const svc = p.get('svc');
    llamadas.push({ url, svc, params: JSON.parse(p.get('params')), sid: p.get('sid') });
    const r = typeof respuestas[svc] === 'function' ? respuestas[svc]() : respuestas[svc];
    return { ok: true, json: async () => r ?? {} };
  };
  return { fetch, llamadas };
}
const USO = { eid: 'sid-del-hash-123', au: 'transportes_andes', user: { id: 777, nm: 'despacho.andes', bact: 4242, crt: 4241 } };

test('🔥 SSRF: baseUrl ajena se rechaza con 400 y no se llama a nadie', async () => {
  for (const malo of ['https://evil.example.com', 'https://hst-api.wialon.com.evil.com', 'http://hst-api.wialon.com', 'https://x.wialon.com',
    'https://a@hst-api.wialon.com', 'https://hst-api.wialon.com:8443', 'https://127.0.0.1', 'https://metadata.google.internal', 'javascript:alert(1)']) {
    const { fetch, llamadas } = plataformaFalsa({ 'core/use_auth_hash': USO });
    await assert.rejects(AP.canjear({ authHash: HASH, baseUrl: malo }, { fetch, log: {} }), (e) => e.motivo === 'entrada_desconocida' && e.status === 400, malo);
    assert.equal(llamadas.length, 0, `no debe llamar a nadie con ${malo}`);
  }
});

test('🔥 una baseUrl conocida elige la cuenta, pero el canje va SIEMPRE a nuestra API', async () => {
  for (const [base, cuenta] of [['https://plataforma.siguelogps.com', 'pro'], ['https://hst-api.wialon.com', 'pro'], ['https://lite.wialon.com/', 'lite'], ['hst-api.wialon.com', 'pro']]) {
    const { fetch, llamadas } = plataformaFalsa({ 'core/use_auth_hash': USO });
    const q = await AP.canjear({ authHash: HASH, baseUrl: base }, { fetch });
    assert.equal(q.cuenta, cuenta);
    await new Promise((r) => setImmediate(r));
    assert.ok(llamadas.every((l) => l.url === AP.API_PLATAFORMA), JSON.stringify(llamadas.map((l) => l.url)));
  }
});

test('🔥 la empresa sale de la respuesta de la plataforma (usuario, id, cuenta), no de la URL', async () => {
  const { fetch, llamadas } = plataformaFalsa({ 'core/use_auth_hash': USO });
  const q = await AP.canjear({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com', user: 'otro_cliente', cuentaId: '1' }, { fetch });
  assert.deepEqual([q.id, q.nombre, q.cuentaId, q.cuentaNombre], ['777', 'despacho.andes', '4242', 'transportes_andes']);
  assert.deepEqual(llamadas[0].params, { authHash: HASH }, 'al canje solo va el hash: nada de operateAs con el user de la URL');
});

test('sin bact en la respuesta, la cuenta se pide a la plataforma con la sesión del hash', async () => {
  const { fetch, llamadas } = plataformaFalsa({ 'core/use_auth_hash': { ...USO, user: { id: 777, nm: 'x' } }, 'core/search_item': { item: { id: 777, bact: 99 } } });
  const q = await AP.canjear({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' }, { fetch });
  assert.equal(q.cuentaId, '99');
  assert.equal(llamadas[1].sid, USO.eid);
});

test('🔥 hash vencido o ya usado → «el acceso venció» (401), sin datos', async () => {
  let usos = 0;
  const { fetch } = plataformaFalsa({ 'core/use_auth_hash': () => (usos++ === 0 ? USO : { error: 8 }) });
  await AP.canjear({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' }, { fetch });
  await assert.rejects(AP.canjear({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' }, { fetch, log: {} }), (e) => e.motivo === 'acceso_vencido' && e.status === 401 && !/8|wialon/i.test(e.message));
});

test('hash con forma rara o sin baseUrl → «el enlace llegó incompleto» (400)', async () => {
  for (const [authHash, baseUrl] of [['', 'https://hst-api.wialon.com'], ['corto', 'https://hst-api.wialon.com'], ['<script>alert(1)</script>xxxxxxxx', 'https://hst-api.wialon.com'], [HASH, ''], [HASH, null]]) {
    await assert.rejects(AP.canjear({ authHash, baseUrl }, { fetch: async () => assert.fail('no debe llamar') }), (e) => e.motivo === 'parametros' && e.status === 400);
  }
});

test('🔥 la sesión del hash se cierra siempre, también si la herramienta rechaza la entrada', async () => {
  const { fetch, llamadas } = plataformaFalsa({ 'core/use_auth_hash': USO });
  await assert.rejects(AP.canjear({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' }, { fetch, conSesion: async () => { throw new AP.ErrorApp('sin_acceso', 'x', 403); } }));
  await new Promise((r) => setImmediate(r));
  assert.ok(llamadas.some((l) => l.svc === 'core/logout' && l.sid === USO.eid));
});

test('la plataforma no responde → «reintenta» (502), sin nombrar al proveedor', async () => {
  await assert.rejects(AP.canjear({ authHash: HASH, baseUrl: 'https://hst-api.wialon.com' }, { fetch: async () => { throw new Error('ECONNRESET hst-api.wialon.com'); } }),
    (e) => e.motivo === 'red' && e.status === 502 && !/wialon|ECONN/i.test(e.message));
});

test('ningún mensaje para el cliente nombra al proveedor', () => {
  for (const m of Object.values(AP.mensajes('Síguelo X'))) assert.doesNotMatch(m, /wialon|gurtam|flespi/i);
  assert.match(AP.mensajes('X').sin_acceso, /Esta herramienta aún no está activa para tu cuenta\. Habla con tu ejecutivo de Síguelo/);
});

test('volver al cerrar sesión: solo direcciones conocidas; en la API compartida manda la cuenta de la empresa', () => {
  assert.equal(AP.volverPara({ cuenta: 'pro', compartido: true }, 'lite'), 'https://lite.wialon.com');
  assert.equal(AP.volverPara({ cuenta: 'pro', compartido: true }, null), 'https://plataforma.siguelogps.com');
  assert.equal(AP.volverPara({ cuenta: 'lite', compartido: false }, 'pro'), 'https://lite.wialon.com');
  assert.match(AP.cookieVolver('https://evil.example.com'), /Max-Age=0/);
  assert.match(AP.cookieVolver('https://plataforma.siguelogps.com'), /^volver_plataforma=https%3A%2F%2Fplataforma\.siguelogps\.com;/);
});

test('cookie de vínculo: firmada, vence y no se puede editar', () => {
  const c = AP.cookieVinculo({ empresa: 5, gpsId: 777, nombre: 'ana', volver: 'https://lite.wialon.com' }, 'secreto', { ahora: 1_000_000 });
  assert.match(c, /HttpOnly/);
  const valor = c.split(';')[0].split('=')[1];
  assert.deepEqual(AP.leerVinculo(valor, 'secreto', 1_000_000), { empresa: '5', gpsId: '777', nombre: 'ana', volver: 'https://lite.wialon.com' });
  assert.equal(AP.leerVinculo(valor, 'otro', 1_000_000), null);
  assert.equal(AP.leerVinculo(valor, 'secreto', 1_000_000 + 16 * 60_000), null, 'vence a los 15 minutos');
  const [cuerpo, firma] = valor.split('.');
  const otro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo, 'base64url')), e: '6' })).toString('base64url');
  assert.equal(AP.leerVinculo(`${otro}.${firma}`, 'secreto', 1_000_000), null, 'cambiar la empresa rompe la firma');
});

test('ícono: la plataforma le pega /app/logo.png a la URL registrada tal cual', () => {
  assert.deepEqual(AP.rutasIcono(['/app-plataforma.html']).sort(), ['/app-plataforma.html/app/logo.png', '/app-plataforma/app/logo.png', '/app/logo.png'].sort());
  assert.equal(AP.CABECERAS_ICONO['Cross-Origin-Resource-Policy'], 'cross-origin');
});

// ── La página de entrada, en un navegador suplantado (vm) ──
function abrirEntrada(query, respuesta, { status = 200 } = {}) {
  const html = fs.readFileSync(path.join(RAIZ, 'public', 'app-plataforma.html'), 'utf8');
  const codigo = fs.readFileSync(path.join(RAIZ, 'public', 'app-plataforma-entrada.js'), 'utf8');
  const datos = Object.fromEntries([...html.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v.replace(/&quot;/g, '"')]));
  const orden = [];
  const nodos = {};
  const nodo = (id) => (nodos[id] ||= { id, textContent: '', hidden: /error|como/.test(id), className: '', hijos: [], appendChild(n) { this.hijos.push(n); }, set innerHTML(v) { orden.push(`innerHTML:${id}`); this._html = v; } });
  const pedidos = [];
  let destino = null;
  const ventana = {
    location: { search: query, pathname: '/app-plataforma.html', href: `https://h.siguelogps.com/app-plataforma.html${query}`, replace: (u) => { destino = u; } },
    history: { replaceState: (_a, _b, u) => { orden.push('limpiar'); ventana.location.search = ''; ventana.location.href = `https://h.siguelogps.com${u}`; } },
    fetch: async (url, o) => { orden.push('pedir'); pedidos.push({ url, ...o, cuerpo: JSON.parse(o.body) }); return { ok: status < 400, json: async () => respuesta }; },
  };
  const documento = { body: { dataset: { herramienta: datos.herramienta, api: datos.api, ingreso: datos.ingreso, correo: datos.correo, telefono: datos.telefono, encabezados: datos.encabezados } }, getElementById: nodo, createElement: () => ({ className: '', textContent: '', href: '', setAttribute() {} }) };
  const ctx = vm.createContext({ window: ventana, document: documento, history: ventana.history, fetch: ventana.fetch, URLSearchParams, JSON, String, setTimeout });
  vm.runInContext(codigo, ctx);
  return { orden, pedidos, nodos, ventana, destino: () => destino, datos };
}
const esperar = () => new Promise((r) => setTimeout(r, 20));

test('🔥 la página limpia la URL ANTES de pedir nada, y al servidor solo van authHash y baseUrl', async () => {
  const p = abrirEntrada(`?authHash=${HASH}&baseUrl=https%3A%2F%2Fhst-api.wialon.com&lang=es&user=ana`, { ok: true, ir: '/inicio', nombre: 'ana' });
  await esperar();
  assert.deepEqual(p.orden.slice(0, 2), ['limpiar', 'pedir']);
  assert.doesNotMatch(p.ventana.location.href, /authHash|baseUrl|user=/);
  assert.equal(p.pedidos.length, 1);
  assert.deepEqual(Object.keys(p.pedidos[0].cuerpo).sort(), ['authHash', 'baseUrl']);
  assert.equal(p.pedidos[0].method, 'POST');
  assert.equal(p.pedidos[0].url, p.datos.api);
  assert.equal(p.destino(), '/inicio');
});

test('🔥 XSS en `user`: se muestra como texto, nunca como HTML', async () => {
  const malo = '<img src=x onerror="window.__xss=1">';
  const p = abrirEntrada(`?authHash=${HASH}&baseUrl=x&user=${encodeURIComponent(malo)}`, { motivo: 'acceso_vencido', error: 'El acceso venció' }, { status: 401 });
  await esperar();
  assert.equal(p.nodos['ap-usuario'].textContent, malo.slice(0, 80));
  assert.ok(!p.orden.some((o) => o.startsWith('innerHTML')), 'nada se pinta con innerHTML');
  assert.doesNotMatch(codigoEntrada(), /innerHTML|insertAdjacentHTML|document\.write/);
});

test('cliente desconocido → pantalla «aún no está activa» con el contacto de soporte, sin datos', async () => {
  const p = abrirEntrada(`?authHash=${HASH}&baseUrl=https%3A%2F%2Fhst-api.wialon.com`, { motivo: 'sin_acceso', error: AP.mensajes('X').sin_acceso }, { status: 403 });
  await esperar();
  assert.equal(p.nodos['ap-error'].hidden, false);
  assert.equal(p.nodos['ap-error-titulo'].textContent, 'Esta herramienta aún no está activa para tu cuenta');
  assert.match(p.nodos['ap-error-texto'].textContent, /Habla con tu ejecutivo de Síguelo/);
  assert.ok(p.nodos['ap-botones'].hijos.some((b) => /^mailto:|^tel:|wa\.me/.test(b.href)), 'muestra cómo contactar a soporte');
  assert.equal(p.destino(), null);
});

test('sin hash: no pide nada y explica cómo volver a abrirla', async () => {
  const p = abrirEntrada('', {});
  await esperar();
  assert.equal(p.pedidos.length, 0);
  assert.equal(p.nodos['ap-error-titulo'].textContent, 'El enlace llegó incompleto');
});

test('un «ir» que no es de este sitio no se sigue', async () => {
  const p = abrirEntrada(`?authHash=${HASH}&baseUrl=https%3A%2F%2Fhst-api.wialon.com`, { ok: true, ir: '//evil.example.com/' });
  await esperar();
  assert.equal(p.destino(), '/');
});

test('la página no deja salir el hash: referrer apagado y guion en archivo aparte', () => {
  const html = fs.readFileSync(path.join(RAIZ, 'public', 'app-plataforma.html'), 'utf8');
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(html.replace(/<script src="[^"]+"><\/script>/g, ''), /<script/);
  assert.doesNotMatch(html, /wialon/i);
});
function codigoEntrada() { return fs.readFileSync(path.join(RAIZ, 'public', 'app-plataforma-entrada.js'), 'utf8'); }
