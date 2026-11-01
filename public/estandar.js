// Estándar Síguelo · fase 2 (maqueta aprobada por Pablo el 1-nov-2026, `estandar-siguelo.html`): lo que se repite igual en
// todas las herramientas (menú por grupos, botón «?» de ayuda, pestañas base de Configuración, menú y franjas del
// backoffice). Es un módulo puro, sin DOM al importarlo, para que las pruebas lo carguen en Node (como paginador.js).
// comun.js lo importa y arma la pantalla con esto; las páginas no tienen que saber que existe.

// Menú del cliente: [grupo, [[módulo/permiso, nombre, href]]]. Los grupos van en MAYÚSCULA pequeña (los pinta el CSS) y
// «Configuración» siempre es la última entrada. Los nombres de grupo son los mismos en toda la familia Síguelo cuando el
// concepto es el mismo (Operación · Flota · Finanzas · Gestión); las entradas son las del rubro de On Rent.
export const MENU = [
  ['Operación', [['inicio', 'Inicio', '/inicio'], ['reservas', 'Reservas', '/reservas'], ['patio', 'Entregas y devoluciones', '/patio'], ['contratos', 'Contratos', '/contratos'], ['clientes', 'Clientes', '/clientes']]],
  ['Flota', [['flota', 'Vehículos', '/vehiculos'], ['mantencion', 'Mantención', '/mantencion'], ['gps', 'Plataforma GPS', '/gps']]],
  ['Finanzas', [['pagos', 'Pagos y garantías', '/pagos'], ['liquidaciones', 'Liquidaciones', '/liquidaciones'], ['facturacion', 'Facturación', '/facturacion'], ['incidentes', 'Incidentes y daños', '/incidentes'], ['tag_multas', 'TAG y multas', '/tag-multas']]],
  ['Gestión', [['reportes', 'Reportes', '/reportes'], ['tarifas', 'Tarifas', '/tarifas'], ['apps', 'Apps', '/apps'], ['configuracion', 'Configuración', '/configuracion']]]
];

// Menú del backoffice Síguelo (menú oscuro con el sello «BACKOFFICE SÍGUELO»): tres grupos iguales en todas las
// herramientas. [módulo, nombre, href, clave del contador en /api/backoffice/resumen]. Las rutas son las que ya usa el
// repo (/empresas, /planes…): el estándar permite conservarlas para no romper enlaces.
export const BACKOFFICE_MENU = [
  ['Clientes', [['empresas', 'Clientes', '/empresas', 'clientes'], ['empresa-nueva', 'Nuevo cliente', '/empresa-nueva'], ['solicitudes', 'Solicitudes', '/solicitudes', 'solicitudes']]],
  ['Catálogo', [['planes', 'Planes y módulos', '/planes'], ['apps-marca', 'Apps con marca', '/apps-marca'], ['conexiones', 'Conexiones generales', '/conexiones']]],
  ['Control', [['bitacora-global', 'Bitácora global', '/bitacora-global'], ['equipo', 'Equipo Síguelo', '/equipo']]]
];

// Manuales por pantalla (clave = `activo` de iniciarPagina). El botón «?» de la barra abre el manual de esa pantalla;
// donde no hay manual todavía, el botón NO se muestra (regla de la maqueta). On Rent aún no tiene manuales escritos:
// cuando exista uno, se agrega aquí (por ejemplo `reservas: '/ayuda/reservas.html'`) y aparece solo.
export const MANUALES = {};
export const manualDe = (activo, manual = null) => manual || MANUALES[activo] || null;
export function botonAyuda(manual) {
  if (!manual) return '';
  const h = String(manual).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<a class="btn-ayuda" href="${h}" target="_blank" rel="noopener" title="Manual de esta pantalla" aria-label="Abrir el manual de esta pantalla">?</a>`;
}

// Configuración del cliente: las mismas cinco pestañas base, en este orden, en todas las herramientas; después van las
// propias de cada producto en el orden en que la pantalla las declare.
export const PESTANAS_BASE = ['empresa', 'usuarios', 'conexiones', 'salidas', 'bitacora'];
export function ordenarPestanas(tabs) {
  const clave = (t) => (Array.isArray(t) ? t[0] : t.clave);
  const base = PESTANAS_BASE.map((k) => tabs.find((t) => clave(t) === k)).filter(Boolean);
  return [...base, ...tabs.filter((t) => !PESTANAS_BASE.includes(clave(t)))];
}

// Franja superior del equipo Síguelo. El color dice de un vistazo si lo que hagas tiene efecto:
//   · negra en el backoffice (con «Entraste desde Síguelo On Board · Volver a On Board» solo cuando se entró desde allá);
//   · azul en «Ver como» (solo lectura);
//   · negra también al «Operar» (fase 2: antes era amarilla; el amarillo queda para la marcha blanca).
// Recibe lo que necesita (sesión, escapador, formato de hora, íconos) para poder probarse sin DOM.
export function htmlFranja(yo, { esc, hora, iconos = {}, desdeOnBoard = false, onBoard = 'https://admin.siguelogps.com', producto = 'On Rent' }) {
  if (yo.modo === 'backoffice') {
    const der = desdeOnBoard ? `<span class="bo-pase">Entraste desde Síguelo On Board${yo.siguelo_nivel ? ` <i>${esc(yo.siguelo_nivel)}</i>` : ''} · <a href="${onBoard}">Volver a On Board</a></span>` : '';
    return `<div class="bo-franja" role="note">${iconos.persona || ''}<span><b>Equipo Síguelo · ${esc(producto)}</b> · backoffice de clientes</span>${der}</div>`;
  }
  if (!yo.siguelo_modo) return '';
  const nombre = esc(yo.empresa?.nombre || '');
  if (yo.siguelo_modo === 'ver') return `<div class="bo-franja ver" role="status">${iconos.ojo || ''}<span><b>Viendo como ${nombre}</b> · solo lectura, no puedes cambiar nada</span><button type="button" class="btn" id="bo-volver">← Volver al backoffice</button></div>`;
  return `<div class="bo-franja operar" role="status">${iconos.persona || ''}<span><b>Operando como Síguelo en ${nombre}</b> · cada cambio queda en la bitácora del cliente con tu nombre</span><span class="bo-pase">${yo.siguelo_desde ? `Desde ${hora(yo.siguelo_desde)} · ` : ''}motivo: ${esc(yo.siguelo_motivo || '—')}</span><button type="button" class="btn" id="bo-volver">← Volver al backoffice</button></div>`;
}

// Cookie que deja la entrada desde Síguelo On Board (src/api/09-acceso-admin.js): no es secreta, solo dice de dónde se
// vino para que la franja negra ofrezca «Volver a On Board». El ingreso con clave la borra.
export const COOKIE_ONBOARD = 'desde_onboard';
export const vieneDeOnBoard = (cookie = '') => new RegExp(`(?:^|;\\s*)${COOKIE_ONBOARD}=1(?:;|$)`).test(String(cookie || ''));
