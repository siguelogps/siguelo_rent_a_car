// Revisión de seguridad (31-oct): cabeceras, fuerza bruta, archivos que el navegador no debe ejecutar y límites públicos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { levantar } from './ayuda.js';

let t;
before(async () => { t = await levantar(); });
after(async () => { await t.cerrar(); });

const ingresar = (correo, clave) => fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo, clave }) });

test('cabeceras: la API no se guarda en caché, nosniff y referrer en todo, X-Frame-Options fuera del portal', async () => {
  const api = await fetch(`${t.base}/api/yo`);
  assert.equal(api.headers.get('cache-control'), 'no-store');
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(api.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(api.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  // Las rutas con caché propia (logo público) mandan la suya en vez del no-store
  const logo = await fetch(`${t.base}/api/logo/no-existe`);
  assert.equal(logo.status, 404);
  // El portal que los clientes incrustan en su sitio sigue sin X-Frame-Options
  const embed = await fetch(`${t.base}/embed/andes`);
  assert.equal(embed.headers.get('x-frame-options'), null);
  // HSTS solo en producción: aquí (pruebas) no debe salir, para no «pegar» https en localhost
  assert.equal(api.headers.get('strict-transport-security'), null);
});

test('ingreso: 8 claves malas bloquean a ese correo desde esa IP con 429 y Retry-After; la clave buena no entra mientras dure', async () => {
  const correo = 'counter@siguelogps.cl';
  for (let i = 0; i < 7; i++) assert.equal((await ingresar(correo, 'mala-' + i)).status, 401);
  const octavo = await ingresar(correo, 'mala-8');
  assert.equal(octavo.status, 401);
  const bloqueado = await ingresar(correo, 'demo1234');
  assert.equal(bloqueado.status, 429);
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0, 'avisa cuánto esperar');
  const cuerpo = await bloqueado.json();
  assert.match(cuerpo.error, /Demasiados intentos/);
  assert.ok(cuerpo.reintentar_en > 0);
  // Otro correo desde la misma IP sigue entrando (el bloqueo es por correo+IP)
  assert.equal((await ingresar('patio@siguelogps.cl', 'demo1234')).status, 200);
});

test('«Mi clave» y «Eliminar mi cuenta»: 6 claves malas seguidas bloquean 15 min para ese usuario', async () => {
  const fin = await t.como('finanzas@siguelogps.cl');
  for (let i = 0; i < 5; i++) assert.equal((await fin.post('/api/configuracion/mi-clave', { actual: 'mala', nueva: 'clave-nueva-larga-1' })).estado, 400);
  assert.equal((await fin.post('/api/configuracion/eliminar-mi-cuenta', { clave: 'mala' })).estado, 400); // sexto fallo, comparten el contador
  const r = await fin.post('/api/configuracion/mi-clave', { actual: 'demo1234', nueva: 'clave-nueva-larga-1' });
  assert.equal(r.estado, 429, 'ni con la clave correcta mientras dura el bloqueo');
  const e = await fin.post('/api/configuracion/eliminar-mi-cuenta', { clave: 'demo1234' });
  assert.equal(e.estado, 429);
  // La sesión sigue viva: el bloqueo no cierra nada, solo frena las pruebas de clave
  assert.equal((await fin.get('/api/yo')).estado, 200);
});

test('archivos: un HTML o SVG subido no se sirve como tal; solo fotos y PDF se muestran en pantalla', async () => {
  const admin = await t.como('demo@siguelogps.cl');
  const html = Buffer.from('<script>alert(1)</script>').toString('base64');
  // La subida genérica rechaza lo que no sea foto o PDF
  const sube = await admin.post('/api/archivos', { entidad: 'prueba', nombre: 'x.html', dataUrl: `data:text/html;base64,${html}` });
  assert.equal(sube.estado, 400);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.equal((await admin.post('/api/archivos', { entidad: 'prueba', dataUrl: `data:image/svg+xml;base64,${svg}` })).estado, 400);
  assert.equal((await admin.patch('/api/empresa', { logo: `data:image/svg+xml;base64,${svg}` })).estado, 400, 'el logo público tampoco acepta SVG');
  // Un PDF o una foto siguen subiendo y mostrándose en pantalla
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  const foto = await admin.post('/api/archivos', { entidad: 'prueba', nombre: 'foto.png', dataUrl: `data:image/png;base64,${png}` });
  assert.equal(foto.estado, 200);
  const g = await admin.get(`/api/archivos/${foto.datos.id}`);
  assert.equal(g.estado, 200);
  assert.equal(g.headers.get('content-type'), 'image/png');
  assert.match(g.headers.get('content-disposition'), /^inline/);
  // Un archivo que ya estuviera guardado con un tipo peligroso (datos antiguos) baja como binario, nunca como HTML
  await t.db.q(`UPDATE archivos SET mime = 'text/html' WHERE id = $1`, [foto.datos.id]);
  const viejo = await admin.get(`/api/archivos/${foto.datos.id}`);
  assert.equal(viejo.estado, 200);
  assert.equal(viejo.headers.get('content-type'), 'application/octet-stream');
  assert.match(viejo.headers.get('content-disposition'), /^attachment/);
  assert.equal(viejo.headers.get('x-content-type-options'), 'nosniff');
});

test('firma, verificación y pagos públicos: límite de solicitudes por IP (429 al pasarse)', async () => {
  let ultimo = 0;
  for (let i = 0; i < 125; i++) ultimo = (await fetch(`${t.base}/api/verificar/AAAA-BBBB-${String(i).padStart(4, '0')}`)).status;
  assert.equal(ultimo, 429);
  for (let i = 0; i < 125; i++) ultimo = (await fetch(`${t.base}/api/pagos/publico/${i}?t=x`)).status;
  assert.equal(ultimo, 429);
  for (let i = 0; i < 65; i++) ultimo = (await fetch(`${t.base}/api/invitacion/token-${i}`)).status;
  assert.equal(ultimo, 429);
});

test('multiempresa: una empresa nueva no ve ni alcanza por id los datos de la demo', async () => {
  const { crearEmpresa } = await import('../src/api/01-empresas.js');
  await crearEmpresa({ nombre: 'Otra Rent', slug: 'otra-rent', admin_correo: 'otra@ejemplo.cl', admin_clave: 'otra-clave-123' });
  const otra = await t.como('otra@ejemplo.cl', 'otra-clave-123');
  for (const u of ['/api/reservas', '/api/clientes', '/api/vehiculos', '/api/contratos', '/api/pagos', '/api/incidentes', '/api/configuracion/usuarios']) {
    const r = await otra.get(u);
    assert.equal(r.estado, 200, u);
    const lista = Array.isArray(r.datos) ? r.datos : Object.values(r.datos).find(Array.isArray) || [];
    assert.ok(lista.every((x) => !x.empresa_id || Number(x.empresa_id) !== 1), `${u} no trae filas de la demo`);
    if (u === '/api/configuracion/usuarios') assert.equal(lista.length, 1);
    else assert.equal(lista.length, 0, `${u} vacío para la empresa nueva`);
  }
  for (const u of ['/api/reservas/1', '/api/clientes/1', '/api/vehiculos/1', '/api/contratos/1', '/api/pagos/1', '/api/incidentes/1', '/api/archivos/1', '/api/ordenes-trabajo/1']) {
    assert.equal((await otra.get(u)).estado, 404, `${u} de la demo no existe para la otra empresa`);
  }
  // «Ver como» es solo del equipo Síguelo: un administrador de cliente no puede cambiar de empresa
  assert.equal((await otra.post('/api/empresa-activa', { empresa_id: 1 })).estado, 403);
  assert.equal((await otra.get('/api/empresas')).estado, 403);
});
