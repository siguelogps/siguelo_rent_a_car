// Fase 2 de estandarización Síguelo (1-nov-2026, maqueta estandar-siguelo.html aprobada por Pablo): las cinco pantallas iguales
// en todas las herramientas. Ingreso («Ingresa a Síguelo On Rent», ojo, «Entrar», caminos alternativos), panel del cliente
// (menú por grupos con Configuración al final, «?» solo con manual, Mi cuenta con Cambiar mi clave · Tema · Cerrar sesión),
// Configuración (pestañas base primero), backoffice (sello, grupos, franjas negra/azul, «Entraste desde On Board» solo
// cuando se vino de allá) y ficha del cliente (pestañas, Zona de riesgo).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { levantar } from './ayuda.js';
import { MENU, BACKOFFICE_MENU, MANUALES, manualDe, botonAyuda, PESTANAS_BASE, ordenarPestanas, htmlFranja, vieneDeOnBoard, COOKIE_ONBOARD } from '../public/estandar.js';

let t, sop, a;
before(async () => { t = await levantar(); sop = await t.como('soporte@siguelogps.cl'); a = await t.como('demo@siguelogps.cl'); });
after(async () => { await t.cerrar(); });

const leer = (ruta) => fs.readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = () => '10:30';

// ── 1 · Ingreso ──
test('ingreso: «Ingresa a Síguelo On Rent», ojo para ver la clave, botón «Entrar» y solo los caminos alternativos que existen', () => {
  const h = leer('public/ingresar.html');
  assert.match(h, /<h1[^>]*id="titulo">Ingresa a Síguelo On Rent<\/h1>/);
  assert.match(h, /name="clave"[^>]*type="password"/);
  assert.match(h, /class="rc-ojo" id="ojo"/, 'el campo Clave tiene el «ojo»');
  assert.match(h, /<button class="btn primario grande" type="submit">Entrar<\/button>/);
  assert.doesNotMatch(h, />Ingresar<\/button>/);
  assert.match(h, /soporte@siguelogps\.cl/);
  assert.match(h, /Equipo Síguelo: entra desde <a href="https:\/\/admin\.siguelogps\.com"[^>]*>Síguelo On Board<\/a>/);
  // On Rent no tiene ingreso con RUT ni «Recordarme»: no se dibujan caminos que no existen.
  assert.doesNotMatch(h, /Entrar con RUT|Recordarme|Olvidé mi clave/);
  // Con la app de un cliente, la entrada del equipo Síguelo se quita.
  assert.match(h, /getElementById\('equipo'\)\?\.remove\(\)/);
});

// ── 2 · Panel del cliente ──
test('menú del cliente: grupos Operación · Flota · Finanzas · Gestión, «Configuración» al final y el mismo menú en comun.js', () => {
  assert.deepEqual(MENU.map(([g]) => g), ['Operación', 'Flota', 'Finanzas', 'Gestión']);
  const ultimo = MENU.at(-1)[1].at(-1);
  assert.deepEqual(ultimo, ['configuracion', 'Configuración', '/configuracion']);
  for (const [, items] of MENU) for (const it of items) assert.equal(it.length, 3, `${it[0]} tiene módulo, nombre y ruta`);
  const comun = leer('public/comun.js');
  assert.match(comun, /import \{ MENU, BACKOFFICE_MENU, [^}]*\} from '\/estandar\.js'/);
  assert.doesNotMatch(comun, /const MENU = \[/, 'el menú ya no se define dos veces');
  assert.match(comun, /<div class="menu-grupo">\$\{g\}<\/div>/, 'los grupos se pintan como títulos del menú');
});

test('botón «?»: aparece solo cuando la pantalla tiene manual; On Rent todavía no tiene manuales escritos', () => {
  assert.equal(botonAyuda(null), '');
  assert.equal(botonAyuda(''), '');
  assert.equal(manualDe('reservas'), null);
  assert.equal(Object.keys(MANUALES).length, 0, 'cuando se escriba un manual, se registra en MANUALES y el botón aparece solo');
  const b = botonAyuda('/ayuda/reservas.html');
  assert.match(b, /class="btn-ayuda" href="\/ayuda\/reservas\.html" target="_blank" rel="noopener"/);
  assert.match(b, />\?<\/a>/);
  assert.match(botonAyuda('/x?a=1&b="2"'), /href="\/x\?a=1&amp;b=&quot;2&quot;"/, 'la ruta va escapada');
  assert.equal(manualDe('reservas', '/ayuda/otro.html'), '/ayuda/otro.html');
  const comun = leer('public/comun.js');
  assert.match(comun, /iniciarPagina\(\{ activo, titulo = '', manual = null \}/);
  assert.match(comun, /\$\{botonAyuda\(manualDe\(activo, manual\)\)\}/);
});

test('barra y Mi cuenta: avatar en la barra, pie «rol · Mi cuenta», y el modal con Cambiar mi clave · Tema · Cerrar sesión', () => {
  const comun = leer('public/comun.js');
  assert.match(comun, /class="rc-avatar" id="rc-avatar" title="Mi cuenta"/);
  assert.match(comun, /· Mi cuenta<\/span><\/div><\/button>/, 'la tarjeta del pie dice que abre Mi cuenta');
  assert.match(comun, /export function abrirMiCuenta\(\)/);
  const cuenta = comun.slice(comun.indexOf('export function abrirMiCuenta()'), comun.indexOf('function activarBuscador'));
  assert.match(cuenta, /<summary class="btn">Cambiar mi clave<\/summary>/);
  assert.match(comun, /const TEMAS = \[\['claro', 'Claro'\], \['auto', 'Automático'\], \['oscuro', 'Oscuro'\]\];/);
  assert.match(cuenta, /TEMAS\.map\(/);
  assert.match(cuenta, /data-salir>\$\{ICONOS\.salir\} Cerrar sesión<\/button>/);
  assert.ok(cuenta.indexOf('Cambiar mi clave') < cuenta.indexOf('rc-cuenta-tema') && cuenta.indexOf('rc-cuenta-tema') < cuenta.indexOf('Cerrar sesión'), 'orden del estándar');
  assert.doesNotMatch(cuenta, /Salir<\/button>/);
  assert.match(cuenta, /Eliminar mi cuenta/, 'lo exigen las tiendas: se conserva');
  assert.match(cuenta, /SigueloTema\?\.elegir\(tema\.dataset\.tema\)/, 'el tema se cambia con /tema.js, el mismo de la barra');
  // El enlace antiguo «Configuración › Mi clave» (#mi-clave) abre Mi cuenta en vez de una pestaña que ya no existe.
  assert.match(comun, /location\.hash === '#mi-clave'/);
});

// ── 3 · Configuración ──
test('configuración: las cinco pestañas base primero y en el orden del estándar; después las propias; sin «Mi clave»', () => {
  assert.deepEqual(PESTANAS_BASE, ['empresa', 'usuarios', 'conexiones', 'salidas', 'bitacora']);
  const propias = [['empresa', 'Empresa'], ['sucursales', 'Sucursales'], ['usuarios', 'Usuarios'], ['plantillas', 'Plantillas'], ['conexiones', 'Conexiones'], ['salidas', 'Bandeja de salida'], ['bitacora', 'Bitácora'], ['portal', 'Portal de reservas']];
  assert.deepEqual(ordenarPestanas(propias).map(([k]) => k), ['empresa', 'usuarios', 'conexiones', 'salidas', 'bitacora', 'sucursales', 'plantillas', 'portal']);
  // Una herramienta sin alguna pestaña base no la inventa: solo se ordenan las que hay.
  assert.deepEqual(ordenarPestanas([['bitacora', 'Bitácora'], ['reglas', 'Reglas'], ['empresa', 'Empresa']]).map(([k]) => k), ['empresa', 'bitacora', 'reglas']);
  const h = leer('public/configuracion.html');
  assert.match(h, /const TABS = ordenarPestanas\(\[/);
  assert.match(h, /\['usuarios', 'Usuarios', 'usuarios'\]/);
  assert.doesNotMatch(h, /Usuarios y permisos|\['mi-clave'|'mi-clave': miClave|function miClave/);
  assert.match(h, /Pedir a Síguelo terminarla/, 'la tarjeta de marcha blanca sigue con su botón');
  // La API de la clave sigue viva (la usa Mi cuenta).
  assert.match(leer('src/api/62-configuracion.js'), /\/configuracion\/mi-clave/);
});

// ── 4 · Backoffice · lista ──
test('backoffice: sello, tres grupos con las mismas entradas que el estándar, KPI, acciones y símbolos de conexiones', () => {
  assert.deepEqual(BACKOFFICE_MENU.map(([g, items]) => [g, items.map((i) => i[1])]), [
    ['Clientes', ['Clientes', 'Nuevo cliente', 'Solicitudes']],
    ['Catálogo', ['Planes y módulos', 'Apps con marca', 'Conexiones generales']],
    ['Control', ['Bitácora global', 'Equipo Síguelo']]
  ]);
  const comun = leer('public/comun.js');
  assert.match(comun, /<span class="bo-sello">Backoffice Síguelo<\/span>/);
  assert.match(leer('public/css/backoffice.css'), /\.bo-sello \{[^}]*text-transform: uppercase/);
  const h = leer('public/empresas.html');
  for (const k of ['Activos', 'En marcha blanca', 'Suspendidos', 'Conexiones con falla', 'Solicitudes pendientes']) assert.ok(h.includes(`<span>${k}</span>`), `KPI ${k}`);
  assert.match(h, /data-ver=.*>Ver como<\/button>.*data-operar=.*>Operar<\/button>.*>Abrir<\/a>/);
  assert.match(h, /SIMBOLO_SALUD = \{ ok: '✓', esp: '…', mal: '!', no: '–' \}/);
  assert.match(h, /<table class="tabla">/, 'la tabla la pagina paginador.js de a 50 (no lleva data-sin-paginar)');
  assert.doesNotMatch(h, /franja amarilla/);
});

test('franjas: negra en el backoffice («Entraste desde On Board» solo con la cookie), azul en Ver como, negra al Operar', () => {
  const bo = { modo: 'backoffice', siguelo_nivel: 'admin' };
  const sin = htmlFranja(bo, { esc, hora });
  assert.match(sin, /^<div class="bo-franja" role="note">/);
  assert.match(sin, /<b>Equipo Síguelo · On Rent<\/b> · backoffice de clientes/);
  assert.doesNotMatch(sin, /On Board/, 'sin venir de On Board no se ofrece volver allá');
  const con = htmlFranja(bo, { esc, hora, desdeOnBoard: true });
  assert.match(con, /Entraste desde Síguelo On Board <i>admin<\/i> · <a href="https:\/\/admin\.siguelogps\.com">Volver a On Board<\/a>/);
  assert.equal(htmlFranja({ modo: 'cliente', siguelo: false }, { esc, hora }), '');
  const ver = htmlFranja({ modo: 'cliente', siguelo_modo: 'ver', empresa: { nombre: 'Andes <Rent>' } }, { esc, hora });
  assert.match(ver, /^<div class="bo-franja ver" role="status">/);
  assert.match(ver, /<b>Viendo como Andes &lt;Rent&gt;<\/b> · solo lectura/);
  assert.match(ver, /id="bo-volver">← Volver al backoffice</);
  const op = htmlFranja({ modo: 'cliente', siguelo_modo: 'operar', empresa: { nombre: 'Andes' }, siguelo_desde: '2026-11-01T13:30:00Z', siguelo_motivo: 'ticket 1187' }, { esc, hora });
  assert.match(op, /^<div class="bo-franja operar" role="status">/);
  assert.match(op, /Operando como Síguelo en Andes/);
  assert.match(op, /Desde 10:30 · motivo: ticket 1187/);
  assert.match(op, /Volver al backoffice/);
  // El color de «Operar» es negro (como Síguelo OS); el amarillo queda para la marcha blanca.
  const css = leer('public/rentacar.css');
  assert.match(css, /\.bo-franja\.operar \{ background: #15181D;/);
  assert.match(css, /\.bo-franja\.ver \{ background: #1E3A8A;/);
  // La cookie que deja la entrada desde On Board se lee tal cual; otra cookie parecida no engaña.
  assert.equal(COOKIE_ONBOARD, 'desde_onboard');
  assert.ok(vieneDeOnBoard('a=1; desde_onboard=1; b=2'));
  assert.ok(vieneDeOnBoard('desde_onboard=1'));
  assert.ok(!vieneDeOnBoard('xdesde_onboard=1') && !vieneDeOnBoard('desde_onboard=10') && !vieneDeOnBoard(''));
});

test('API: el ingreso con clave borra la marca «desde On Board» y «Ver como» da la sesión que pinta la franja azul', async () => {
  const r = await fetch(`${t.base}/api/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'soporte@siguelogps.cl', clave: 'demo1234' }) });
  assert.equal(r.status, 200);
  const cookies = r.headers.getSetCookie();
  assert.ok(cookies.some((c) => /^desde_onboard=;/.test(c) && /Max-Age=0|Expires=/.test(c)), 'se borra desde_onboard al entrar con clave');
  const yo = (await sop.get('/api/yo')).datos;
  assert.equal(yo.modo, 'backoffice');
  assert.equal(yo.siguelo_modo, null);
  const E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
  const entrar = await sop.post(`/api/backoffice/clientes/${E}/entrar`, { modo: 'ver' });
  assert.equal(entrar.estado, 200);
  const dentro = (await sop.get('/api/yo')).datos;
  assert.equal(dentro.siguelo_modo, 'ver');
  assert.equal(dentro.solo_lectura, true);
  assert.match(htmlFranja(dentro, { esc, hora }), /bo-franja ver/);
  // Vuelve al backoffice (para no dejar la sesión de las demás pruebas dentro del cliente).
  assert.equal((await sop.post('/api/empresa-activa', { empresa_id: null })).estado, 200);
  // La entrada desde On Board deja la cookie (el código la escribe en 09-acceso-admin.js).
  assert.match(leer('src/api/09-acceso-admin.js'), /res\.cookie\('desde_onboard', '1'/);
});

// ── 5 · Backoffice · ficha ──
test('ficha del cliente: pestañas Datos · Plan y módulos · Conexiones · Usuarios · Apps · Actividad y bitácora, acciones y Zona de riesgo', () => {
  const h = leer('public/empresa.html');
  assert.match(h, /const TABS = \[\['datos', 'Datos'\], \['plan', 'Plan y módulos'\], \['integraciones', 'Conexiones'\], \['usuarios', 'Usuarios'\], \['apps', 'Apps'\], \['actividad', 'Actividad y bitácora'\]\];/);
  assert.match(h, /data-entrar="ver">Ver como<\/button><button class="btn contorno" data-entrar="operar"[^>]*>Operar<\/button>.*>Editar datos<\/a>/);
  assert.match(h, /<h2 class="bo-riesgo-titulo">Zona de riesgo<\/h2>/);
  assert.match(h, /id="suspender"/);
  assert.match(h, /Para confirmar, escribe el nombre del cliente/);
  assert.match(h, /<h2 style="margin-bottom:6px">Marcha blanca<\/h2>/);
  assert.doesNotMatch(h, /franja amarilla/);
});

test('vocabulario: nunca el proveedor en pantalla; «—» para lo desconocido en la ficha', () => {
  for (const f of ['public/estandar.js', 'public/comun.js', 'public/ingresar.html', 'public/configuracion.html', 'public/empresas.html', 'public/empresa.html']) {
    assert.doesNotMatch(leer(f).replace(/\/\/[^\n]*/g, ''), /[>'"« ]Wialon[ <'"»]/, `${f} sin el nombre del proveedor en pantalla`);
  }
  assert.match(leer('public/empresa.html'), /const SIN = '—';/);
  // La API sigue entregando lo que la ficha necesita (iniciales, plan, RUT, desde, vehículos, usuarios).
  return (async () => {
    const E = (await t.db.uno(`SELECT id FROM empresas WHERE slug = 'andes-rent'`)).id;
    const d = (await sop.get(`/api/backoffice/clientes/${E}`)).datos;
    assert.ok(d.empresa.nombre && d.empresa.rut && d.empresa.creado_en && d.uso && typeof d.uso.vehiculos === 'number' && Array.isArray(d.usuarios));
    assert.equal((await a.get('/api/yo')).datos.modo, 'cliente');
  })();
});
