// Paginación de TODAS las listas (fase 1 de estandarización Síguelo, 1-nov-2026; regla de Pablo del 21-oct en Síguelo
// Gestión: «aplicar paginación a todos los listados que existan, dejarlo como regla a futuro»). Copiado del CRM y
// adaptado a On Rent.
//
// Cómo funciona: comun.js › iniciarPagina() lo instala una vez por pantalla. Mira el documento y, a cada tabla de lista
// (`table.tabla`) o lista marcada con `data-paginar` que pase de POR_PAGINA filas, le pone «Anterior · Página X de Y ·
// Siguiente» debajo y muestra solo esa página. Las filas no se borran: solo se ocultan (clase .pg-fuera), así que los
// filtros, la selección y los botones de cada fila siguen funcionando igual.
//   · Una tabla nueva (otra pantalla, otra pestaña o un modal) parte en la página 1.
//   · Si la lista se vuelve a dibujar con OTRA cantidad de filas (un filtro, una búsqueda) vuelve a la página 1; si es el
//     refresco automático con la misma cantidad, se queda en la página en la que estaba.
//   · Las filas ocultas por la propia pantalla (atributo hidden o display:none) no cuentan, ni la fila única de
//     «Cargando…» / «No hay …» (td.vacio, .rc-vacio, .rc-cargando).
//   · Excepciones: una lista que ya pagina por su cuenta (en el servidor, de a 50: las bitácoras) o que no es una lista
//     (una matriz de permisos, una grilla de tarifas) lleva `data-sin-paginar`.
// Regla para lo nuevo (CLAUDE.md): toda lista que pueda crecer se pide por partes al servidor (src/paginacion.js) y en
// pantalla usa `table.tabla` (o `data-paginar`), que este módulo pagina solo.

export const POR_PAGINA = 50;

// Página válida (1…paginas) y el tramo de filas que se ve. Pura: se prueba sin navegador.
export function calcularPagina(total, pagina = 1, por = POR_PAGINA) {
  const paginas = Math.max(1, Math.ceil(Math.max(0, total) / por));
  const p = Math.min(Math.max(1, Math.floor(Number(pagina) || 1)), paginas);
  const desde = (p - 1) * por;
  return { pagina: p, paginas, desde, hasta: Math.min(total, desde + por), por };
}

// Al volver a dibujar la lista: misma cantidad de filas = refresco (se queda en su página); otra cantidad = página 1.
export const paginaTrasCambio = ({ pagina = 1, total: antes = null }, totalNuevo) => (antes != null && antes === totalNuevo ? pagina : 1);

// Texto de la barra: «Página 2 de 7 · 51–100 de 324»
export const textoPagina = (c, total) => `Página ${c.pagina} de ${c.paginas} · ${(c.desde + 1).toLocaleString('es-CL')}–${c.hasta.toLocaleString('es-CL')} de ${total.toLocaleString('es-CL')}`;

const SELECTOR = 'table.tabla:not([data-sin-paginar]), [data-paginar]';
const estado = new WeakMap(); // lista → { pagina, total, nav }

function filasDe(lista) {
  const cuerpo = lista.tagName === 'TABLE' ? lista.tBodies[0] : lista;
  if (!cuerpo) return [];
  return [...cuerpo.children].filter((f) => (lista.tagName === 'TABLE' ? f.tagName === 'TR' : true)
    && !f.hasAttribute('data-pg-fija') && !f.hidden && f.style.display !== 'none'
    && !(f.children.length === 1 && f.firstElementChild.matches('td[colspan], td.vacio, td.rc-vacio, td.rc-cargando, .rc-cargando')));
}

function navDe(lista, st) {
  if (st.nav?.isConnected) return st.nav;
  const nav = document.createElement('nav');
  nav.className = 'paginacion pg-nav';
  nav.setAttribute('aria-label', 'Páginas de la lista');
  const ancla = lista.closest('.tabla-env') || lista;
  ancla.after(nav);
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pg]');
    if (!b) return;
    st.pagina += Number(b.dataset.pg);
    aplicar(lista, { forzar: true });
    (lista.closest('.tabla-env') || lista).scrollIntoView?.({ block: 'nearest' });
  });
  st.nav = nav;
  return nav;
}

function aplicar(lista, { forzar = false } = {}) {
  const st = estado.get(lista) || { pagina: 1, total: null, nav: null };
  estado.set(lista, st);
  const todas = filasDe(lista); // las que ocultó el paginador sí cuentan: .pg-fuera es una clase, no hidden ni display en línea
  const total = todas.length;
  if (!forzar) st.pagina = paginaTrasCambio(st, total);
  st.total = total;
  if (total <= POR_PAGINA) {
    for (const f of todas) f.classList.remove('pg-fuera');
    st.nav?.remove(); st.nav = null;
    return;
  }
  const c = calcularPagina(total, st.pagina);
  st.pagina = c.pagina;
  todas.forEach((f, i) => f.classList.toggle('pg-fuera', i < c.desde || i >= c.hasta));
  const nav = navDe(lista, st);
  nav.innerHTML = `<button type="button" class="btn peq" data-pg="-1"${c.pagina > 1 ? '' : ' disabled'}>Anterior</button>
    <span>${textoPagina(c, total)}</span>
    <button type="button" class="btn peq" data-pg="1"${c.pagina < c.paginas ? '' : ' disabled'}>Siguiente</button>`;
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
