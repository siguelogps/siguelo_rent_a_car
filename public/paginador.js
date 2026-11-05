// Paginación de TODAS las listas (fase 1 de estandarización Síguelo, 1-nov-2026; regla de Pablo del 21-oct en Síguelo
// Gestión: «aplicar paginación a todos los listados que existan, dejarlo como regla a futuro»). Copiado del CRM y
// adaptado a On Rent.
// 5-nov (revisión exhaustiva, RNT-11): se trae del CRM el selector «Filas por página» 10 · 25 · 50 · 100 (regla del
// 2-nov), recordado por lista en el navegador, para que la familia quede igual. Lo propio de On Rent se conserva:
// textoPagina() y las filas de «Cargando…» / «No hay …» con td.rc-vacio y .rc-cargando no cuentan.
//
// Cómo funciona: comun.js › iniciarPagina() lo instala una vez por pantalla. Mira el documento y, a cada tabla de lista
// (`table.tabla`) o lista marcada con `data-paginar` que pase de 10 filas (la opción más chica, para poder elegir aunque
// quepa en una página), le pone «Anterior · Página X de Y · desde–hasta de total · Siguiente · Filas por página» debajo y
// muestra solo esa página. Las filas no se borran: solo se ocultan (clase .pg-fuera), así que los filtros, la selección y
// los botones de cada fila siguen funcionando igual.
//   · Una tabla nueva (otra pantalla, otra pestaña o un modal) parte en la página 1.
//   · Si la lista se vuelve a dibujar con OTRA cantidad de filas (un filtro, una búsqueda) vuelve a la página 1; si es el
//     refresco automático con la misma cantidad, se queda en la página en la que estaba.
//   · Al cambiar las filas por página, vuelve a la página 1.
//   · Las filas ocultas por la propia pantalla (atributo hidden o display:none) no cuentan, ni la fila única de
//     «Cargando…» / «No hay …» (td.vacio, .rc-vacio, .rc-cargando).
//   · Tamaño por omisión: 50, o el que la lista declare con `data-por-pagina="25"`.
//   · Excepciones: una lista que ya pagina por su cuenta (en el servidor, de a 50: las bitácoras) o que no es una lista
//     (una matriz de permisos, una grilla de tarifas) lleva `data-sin-paginar`. Si pagina por su cuenta, puede armar el
//     mismo nav con htmlPaginacion() y atenderlo con enlazarPaginacion().
// Se recuerda la elección por lista, en localStorage (clave `pg-por:<lista>`), con try/catch: sin memoria del navegador
// (modo privado, bloqueada) cada lista parte en su valor por omisión. La lista se identifica por la página y sus
// encabezados (o su id, o `data-pg-clave`), que no cambian al volver a dibujarla.
// Regla para lo nuevo (CLAUDE.md): toda lista que pueda crecer se pide por partes al servidor (src/paginacion.js) y en
// pantalla usa `table.tabla` (o `data-paginar`), que este módulo pagina solo.

export const POR_PAGINA = 50;
export const OPCIONES_POR_PAGINA = [10, 25, 50, 100];
// Con más filas que la opción más chica aparece el nav, aunque quepan en una página: así se puede elegir 10.
export const MINIMO_CON_NAV = OPCIONES_POR_PAGINA[0];

// Página válida (1…paginas) y el tramo de filas que se ve. Pura: se prueba sin navegador.
export function calcularPagina(total, pagina = 1, por = POR_PAGINA) {
  por = Math.max(1, Math.floor(Number(por) || POR_PAGINA));
  const paginas = Math.max(1, Math.ceil(Math.max(0, total) / por));
  const p = Math.min(Math.max(1, Math.floor(Number(pagina) || 1)), paginas);
  const desde = (p - 1) * por;
  return { pagina: p, paginas, desde, hasta: Math.min(total, desde + por), por };
}

// Lo mismo para una lista paginada en el servidor, que sabe su `desde` (la fila donde parte) y no su página.
export const calcularTramo = (total, desde = 0, por = POR_PAGINA) => calcularPagina(total, Math.floor(Math.max(0, Number(desde) || 0) / Math.max(1, por)) + 1, por);

// Texto de la barra: «Página 2 de 7 · 51–100 de 324»
export const textoPagina = (c, total) => `Página ${c.pagina} de ${c.paginas} · ${(c.desde + 1).toLocaleString('es-CL')}–${c.hasta.toLocaleString('es-CL')} de ${total.toLocaleString('es-CL')}`;

// Al volver a dibujar la lista: misma cantidad de filas = refresco (se queda en su página); otra cantidad = página 1.
export const paginaTrasCambio = ({ pagina = 1, total: antes = null }, totalNuevo) => (antes != null && antes === totalNuevo ? pagina : 1);

// Un valor de filas por página válido: una de las opciones, o el valor por omisión de la lista (si no, 50).
export function normalizarPorPagina(v, porDefecto = POR_PAGINA) {
  const n = Number(v);
  if (OPCIONES_POR_PAGINA.includes(n)) return n;
  const d = Number(porDefecto);
  return OPCIONES_POR_PAGINA.includes(d) ? d : POR_PAGINA;
}

const PREFIJO = 'pg-por:';
export function leerPorPagina(clave, porDefecto = POR_PAGINA) {
  try {
    const v = clave ? globalThis.localStorage?.getItem(PREFIJO + clave) : null;
    if (v != null) return normalizarPorPagina(v, porDefecto);
  } catch { /* sin memoria del navegador: el valor por omisión */ }
  return normalizarPorPagina(porDefecto);
}
export function guardarPorPagina(clave, n) {
  try { if (clave) globalThis.localStorage?.setItem(PREFIJO + clave, String(normalizarPorPagina(n))); } catch { /* sin memoria del navegador */ }
}

// El selector «Filas por página». Tiene 4 opciones (el selector buscable no aplica) y lleva data-sin-buscar por si acaso.
export const selectorPorPagina = (actual = POR_PAGINA) => `<label class="pg-por">Filas por página <select class="campo" data-pg-por data-sin-buscar aria-label="Filas por página">${OPCIONES_POR_PAGINA.map((n) => `<option value="${n}"${n === Number(actual) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;

const miles = (n) => Number(n || 0).toLocaleString('es-CL');

// El nav completo, igual en todas las listas: «Anterior · Página X de Y · desde–hasta de total · Siguiente · Filas por
// página». `lista` lo identifica para enlazarPaginacion(); `unidad` es la palabra después del total («unidades»).
// Con 10 filas o menos no hay nav (devuelve ''): todo cabe en la página más chica.
export function htmlPaginacion({ total, desde = 0, por = POR_PAGINA, lista = '', etiqueta = 'Páginas de la lista', unidad = '', clase = '' } = {}) {
  if (!(total > MINIMO_CON_NAV)) return '';
  const c = calcularTramo(total, desde, por);
  return `<nav class="paginacion pg-nav${clase ? ` ${clase}` : ''}" aria-label="${etiqueta}"${lista ? ` data-pg-lista="${lista}"` : ''}>`
    + `<button type="button" class="btn peq" data-pg-mover="-1"${c.pagina > 1 ? '' : ' disabled'}>Anterior</button>`
    + `<span>Página ${c.pagina} de ${c.paginas} · ${miles(c.desde + 1)}–${miles(c.hasta)} de ${miles(total)}${unidad ? ` ${unidad}` : ''}</span>`
    + `<button type="button" class="btn peq" data-pg-mover="1"${c.pagina < c.paginas ? '' : ' disabled'}>Siguiente</button>`
    + `${selectorPorPagina(c.por)}</nav>`;
}

// Lo mismo para una lista paginada por cursor (no sabe su total, solo si hay más: el Historial de cambios). Botones con su
// propio texto («Más recientes» / «Anteriores», porque van por fecha) y el mismo selector.
export function htmlPaginacionCursor({ pagina = 1, hayMas = false, texto = '', por = POR_PAGINA, lista = '', etiqueta = 'Páginas de la lista', antes = 'Anterior', despues = 'Siguiente' } = {}) {
  return `<nav class="paginacion pg-nav" aria-label="${etiqueta}"${lista ? ` data-pg-lista="${lista}"` : ''}>`
    + `<button type="button" class="btn peq" data-pg-mover="-1"${pagina > 1 ? '' : ' disabled'}>${antes}</button>`
    + `<span>Página ${miles(pagina)}${texto ? ` · ${texto}` : ''}</span>`
    + `<button type="button" class="btn peq" data-pg-mover="1"${hayMas ? '' : ' disabled'}>${despues}</button>`
    + `${selectorPorPagina(por)}</nav>`;
}

// Atiende el nav de una lista que pagina por su cuenta: `mover(delta)` con -1 / 1 y `cambiarPor(n)` (ya guardado en el
// navegador con `clave`). Se llama una vez, sobre un contenedor que no se reemplaza (los clics y cambios suben hasta él).
export function enlazarPaginacion(raiz, lista, { clave = lista, mover, cambiarPor } = {}) {
  if (!raiz) return;
  const deLaLista = (e) => e.target.closest?.(`nav[data-pg-lista="${lista}"]`);
  raiz.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-pg-mover]');
    if (!b || b.disabled || !deLaLista(e)) return;
    e.preventDefault();
    mover?.(Number(b.dataset.pgMover));
  });
  raiz.addEventListener('change', (e) => {
    if (!e.target.matches?.('select[data-pg-por]') || !deLaLista(e)) return;
    e.stopPropagation(); // que el filtro de la pantalla que escucha «change» en el mismo contenedor no lo tome por suyo
    const n = normalizarPorPagina(e.target.value);
    guardarPorPagina(clave, n);
    cambiarPor?.(n);
  });
}

const SELECTOR = 'table.tabla:not([data-sin-paginar]), [data-paginar]';
const estado = new WeakMap(); // lista → { pagina, total, nav, por, clave }

function filasDe(lista) {
  const cuerpo = lista.tagName === 'TABLE' ? lista.tBodies[0] : lista;
  if (!cuerpo) return [];
  return [...cuerpo.children].filter((f) => (lista.tagName === 'TABLE' ? f.tagName === 'TR' : true)
    && !f.hasAttribute('data-pg-fija') && !f.hidden && f.style.display !== 'none'
    && !(f.children.length === 1 && f.firstElementChild.matches('td[colspan], td.vacio, td.rc-vacio, td.rc-cargando, .rc-cargando')));
}

// Clave con que se recuerda el tamaño de una lista automática: la página + data-pg-clave, el id o los encabezados.
export function claveDeLista({ ruta = '', pgClave = '', id = '', encabezados = [], paginar = '', clase = '' } = {}) {
  const propia = pgClave || id || encabezados.map((t) => String(t).trim()).filter(Boolean).join('|') || paginar || clase || 'lista';
  return `${ruta}:${propia}`.slice(0, 200);
}
const claveAuto = (lista) => claveDeLista({
  ruta: location.pathname, pgClave: lista.dataset.pgClave, id: lista.id, paginar: lista.dataset.paginar, clase: lista.className,
  encabezados: lista.tagName === 'TABLE' ? [...(lista.tHead?.rows[0]?.cells || [])].map((c) => c.textContent) : [],
});

function navDe(lista, st) {
  if (st.nav?.isConnected) return st.nav;
  const nav = document.createElement('nav');
  nav.className = 'paginacion pg-nav';
  nav.setAttribute('aria-label', 'Páginas de la lista');
  const ancla = lista.closest('.tabla-env') || lista;
  ancla.after(nav);
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pg-mover]');
    if (!b) return;
    st.pagina += Number(b.dataset.pgMover);
    aplicar(lista, { forzar: true });
    (lista.closest('.tabla-env') || lista).scrollIntoView?.({ block: 'nearest' });
  });
  nav.addEventListener('change', (e) => {
    if (!e.target.matches('select[data-pg-por]')) return;
    e.stopPropagation();
    st.por = normalizarPorPagina(e.target.value);
    guardarPorPagina(st.clave, st.por);
    st.pagina = 1;
    aplicar(lista, { forzar: true });
  });
  st.nav = nav;
  st.html = '';
  return nav;
}

function aplicar(lista, { forzar = false } = {}) {
  let st = estado.get(lista);
  if (!st) {
    const clave = claveAuto(lista);
    st = { pagina: 1, total: null, nav: null, clave, por: leerPorPagina(clave, lista.dataset.porPagina || POR_PAGINA) };
    estado.set(lista, st);
  }
  const todas = filasDe(lista); // las que ocultó el paginador sí cuentan: .pg-fuera es una clase, no hidden ni display en línea
  const total = todas.length;
  if (!forzar) st.pagina = paginaTrasCambio(st, total);
  st.total = total;
  if (total <= MINIMO_CON_NAV) {
    for (const f of todas) f.classList.remove('pg-fuera');
    st.nav?.remove(); st.nav = null;
    return;
  }
  const c = calcularPagina(total, st.pagina, st.por);
  st.pagina = c.pagina;
  todas.forEach((f, i) => f.classList.toggle('pg-fuera', i < c.desde || i >= c.hasta));
  const nav = navDe(lista, st);
  const html = htmlPaginacion({ total, desde: c.desde, por: c.por });
  // Solo el contenido del nav (sin el <nav> de afuera, que ya existe y tiene sus escuchas).
  const dentro = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</nav>'));
  if (st.html !== dentro) { nav.innerHTML = dentro; st.html = dentro; }
}

let instalado = false;
export function instalarPaginador(raiz = document.body) {
  if (instalado || typeof MutationObserver === 'undefined' || !raiz) return;
  instalado = true;
  let pendiente = false;
  const revisar = () => {
    pendiente = false;
    for (const lista of raiz.querySelectorAll(SELECTOR)) aplicar(lista);
  };
  const programar = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(revisar); } };
  // Solo cambios de contenido (filas nuevas, listas nuevas): los cambios de clase del propio paginador no vuelven a entrar.
  new MutationObserver((cambios) => { if (cambios.some((m) => m.type === 'childList' && !m.target.closest?.('.pg-nav'))) programar(); })
    .observe(raiz, { childList: true, subtree: true });
  programar();
}
