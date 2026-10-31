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
  // El motor de reservas que los clientes incrustan en su sitio sigue sin X-Frame-Options
  const embed = await fetch(`${t.base}/embed/andes`);
  assert.equal(embed.headers.get('x-frame-options'), null);
  assert.equal(embed.headers.get('content-security-policy'), null);
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

// 31-oct (pendientes de seguridad): CSP en modo informe, su endpoint y los límites del cuerpo JSON.
test('CSP en modo informe en las páginas (no en la API), sin bloquear nada', async () => {
  const pagina = await fetch(`${t.base}/ingresar`);
  const csp = pagina.headers.get('content-security-policy-report-only');
  assert.ok(csp, 'las páginas llevan la política en modo informe');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /img-src [^;]*tile\.openstreetmap\.org/);
  assert.match(csp, /report-uri \/api\/csp-informe/);
  assert.equal(pagina.headers.get('content-security-policy'), null, 'nada se bloquea todavía');
  assert.equal((await fetch(`${t.base}/api/yo`)).headers.get('content-security-policy-report-only'), null);
});

test('POST /api/csp-informe: sin sesión, acepta el formato del navegador, responde 204 y se acota por IP', async () => {
  const avisos = [];
  const original = console.warn;
  console.warn = (m) => avisos.push(String(m));
  try {
    const informe = { 'csp-report': { 'document-uri': `${t.base}/ingresar`, 'violated-directive': 'script-src-elem', 'blocked-uri': 'inline', 'source-file': `${t.base}/ingresar`, 'line-number': 14 } };
    const r = await fetch(`${t.base}/api/csp-informe`, { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: JSON.stringify(informe) });
    assert.equal(r.status, 204);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /^\[CSP\] script-src-elem · bloqueado: inline · en .*\/ingresar \(.*\/ingresar:14\)$/);
    // Lo que llega es texto ajeno: se recorta y se le quitan los saltos de línea para que no falsee el registro
    const sucio = { 'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'x'.repeat(1000) + '\n[CSP] falso' } };
    await fetch(`${t.base}/api/csp-informe`, { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: JSON.stringify(sucio) });
    assert.equal(avisos.length, 2);
    assert.ok(avisos[1].length < 400 && !avisos[1].includes('\n'));
    // También la Reporting API (lista de informes) y un cuerpo sin forma conocida (204, sin anotar nada)
    const lista = [{ type: 'csp-violation', body: { documentURL: `${t.base}/inicio`, effectiveDirective: 'font-src', blockedURL: 'https://ajeno.example' } }];
    assert.equal((await fetch(`${t.base}/api/csp-informe`, { method: 'POST', headers: { 'Content-Type': 'application/reports+json' }, body: JSON.stringify(lista) })).status, 204);
    assert.match(avisos[2], /font-src · bloqueado: https:\/\/ajeno\.example/);
    assert.equal((await fetch(`${t.base}/api/csp-informe`, { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: '"hola"' })).status, 204);
    assert.equal(avisos.length, 3);
    // Tope por IP: 20 por minuto, después 429
    let ultimo = 0;
    for (let i = 0; i < 20; i++) ultimo = (await fetch(`${t.base}/api/csp-informe`, { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: JSON.stringify(informe) })).status;
    assert.equal(ultimo, 429);
    assert.ok(avisos.length <= 20, 'después del tope no se anota más');
  } finally { console.warn = original; }
});

test('cuerpo JSON: 2 MB en las rutas comunes (413 en español) y 25 MB solo donde llegan fotos o documentos', async () => {
  const admin = await t.como('demo@siguelogps.cl');
  const grande = 'a'.repeat(3 * 1024 * 1024);
  const comun = await admin.post('/api/reservas', { notas: grande });
  assert.equal(comun.estado, 413);
  assert.match(comun.datos.error, /demasiado grande/);
  assert.equal((await admin.put('/api/vehiculos/1', { notas: grande })).estado, 413);
  // Una foto de 3 MB sí entra por la subida de archivos
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(3 * 1024 * 1024, 7)]).toString('base64');
  const foto = await admin.post('/api/archivos', { entidad: 'prueba', nombre: 'grande.png', dataUrl: `data:image/png;base64,${png}` });
  assert.equal(foto.estado, 200, JSON.stringify(foto.datos));
  // Cada ruta que recibe archivos como data URL está en la lista (si se agrega una y se olvida, cae con 413)
  const { recibeArchivos } = await import('../src/cabeceras.js');
  for (const [method, path] of [['POST', '/api/archivos'], ['PATCH', '/api/empresa'], ['POST', '/api/clientes/3/documentos'], ['POST', '/api/patio/inspecciones/7/fotos'],
    ['POST', '/api/patio/7/fotos'], ['POST', '/api/patio/inspecciones/7/danos'], ['PATCH', '/api/patio/danos/9'], ['POST', '/api/patio/inspecciones/7/completar'],
    ['POST', '/api/incidentes'], ['POST', '/api/incidentes/4/nota'], ['POST', '/api/portal/r/tok-abc_123/documentos'], ['POST', '/api/firmar/tok-abc_123'], ['POST', '/api/apps/solicitud/firmar']]) {
    assert.ok(recibeArchivos({ method, path }), `${method} ${path}`);
  }
  for (const [method, path] of [['GET', '/api/archivos'], ['POST', '/api/reservas'], ['POST', '/api/clientes'], ['PUT', '/api/vehiculos/1'], ['POST', '/api/incidentes/4/estado'], ['POST', '/api/ingresar']]) {
    assert.equal(recibeArchivos({ method, path }), false, `${method} ${path}`);
  }
});
