// Desplegables con buscador («selector buscable») · 1-nov-2026, maqueta aprobada por Pablo. Copiado del CRM Síguelo
// Gestión y adaptado a On Rent (misma conducta en toda la familia Síguelo).
//
// Qué hace: todo <select> con UMBRAL (8) opciones o más pasa a ser un cuadro donde se escribe y una lista que se filtra
// por palabras, en cualquier orden y sin importar mayúsculas ni tildes (la misma regla `calzaPalabras` de todas las
// listas). El <select> nativo se queda por debajo, oculto, y SIGUE SIENDO LA FUENTE DEL VALOR: `form.elements.x.value`,
// `leerForm()`, `required`/`data-obligatorio`, el evento «change» y las pruebas leen lo mismo de siempre. Por eso una
// pantalla no tiene que saber que el control existe: comun.js › iniciarPagina() lo instala una vez por página (igual que
// el paginador) y un observador convierte también lo que aparece después (modales, pestañas, listas que se vuelven a
// llenar con la respuesta de la API).
//   · `data-sin-buscar` lo excluye; `data-buscar` fuerza uno corto; `data-buscar-nombre="vehículos"` cambia el
//     sustantivo del pie («3 de 41 vehículos»). Un <select multiple>, uno con `size` o uno `hidden` no se tocan.
//   · El texto secundario de una opción (p. ej. la categoría de un vehículo) va en `data-secundario` y se ve en gris al
//     lado del nombre; también cuenta para la búsqueda.
//   · Teclado: ↑ ↓ recorren, Enter elige, Esc cierra sin cambiar, Tab sale. Con el cuadro vacío y foco se ve la lista
//     completa, acotada a las primeras TOPE (200) con «escribe para ver más» si son muchas.
//   · Sin resultados: «Ninguna opción calza con «…»» y NO se inventa un valor (regla «no inventar datos»). La ✕ vuelve
//     a la opción vacía, si existe.
//   · Si las opciones del <select> cambian por programa (se vuelve a llenar con innerHTML), el control se entera por el
//     observador y conserva el valor si sigue existiendo. Si el <select> se reemplaza entero (outerHTML), el envoltorio
//     viejo se deshace solo y el nuevo <select> se convierte de nuevo.
//   · Accesible: role=combobox, aria-expanded, aria-activedescendant, etiqueta asociada (la del <select>). En teléfono
//     (≤ 560 px) la lista va dentro del flujo, sin 100vw/100vh. Dentro de un modal (que recorta con overflow) la lista
//     se posiciona fija para que no quede cortada.
//   · Enter y Esc con la lista abierta no salen del control (stopPropagation): así Enter no «guarda» el modal ni Esc lo
//     cierra mientras se está eligiendo.
// Sin librerías externas. No importa comun.js (que carga rutas absolutas del navegador) para poder probarse en Node;
// por eso `sinTildes` y `calzaPalabras` viven aquí y comun.js los reexporta: es una sola definición para todo el repo.

export const UMBRAL = 8; // opciones desde las que un <select> se convierte solo
export const TOPE = 200; // opciones que se dibujan como máximo de una vez (la búsqueda acota el resto)

// Búsqueda por palabras (fase 1 de estandarización): minúsculas, sin tildes, espacios normalizados. Cada palabra escrita
// tiene que aparecer, en cualquier orden: «juan perez» encuentra a «Juan Carlos Pérez González».
const MARCAS = /[̀-ͯ]/g;
export const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(MARCAS, '').replace(/\s+/g, ' ').trim();
export const palabrasDe = (q) => sinTildes(q).split(' ').filter(Boolean);
export const calzaPalabras = (texto, q) => { const t = sinTildes(texto); return palabrasDe(q).every((p) => t.includes(p)); };
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Opciones que calzan con lo buscado (regla `calzaPalabras` sobre el texto y el secundario). Un valor pegado entero
 *  (patente, RUT) se busca entero, nunca por el inicio. El orden original se respeta (los grupos siguen juntos).
 *  Pura: se prueba sin navegador. */
export function filtrarOpciones(opciones, q) {
  if (!palabrasDe(q).length) return opciones.slice();
  return opciones.filter((o) => calzaPalabras(`${o.t ?? ''} ${o.s ?? ''}`, q));
}

/** Texto con las palabras buscadas resaltadas (<mark>), ya escapado. Trabaja sobre el texto sin tildes y traslada las
 *  posiciones al original, así «perez» resalta «Pérez». */
export function resaltar(texto, palabras) {
  const s = String(texto ?? '');
  const ps = Array.isArray(palabras) ? palabras : palabrasDe(palabras);
  if (!ps.length || !s) return escH(s);
  // Mapa: posición en el texto normalizado → posición en el original (un carácter puede normalizar a 0, 1 o más).
  let norm = ''; const origen = [];
  for (let i = 0; i < s.length; i++) {
    const n = s[i].toLowerCase().normalize('NFD').replace(MARCAS, '');
    for (let k = 0; k < n.length; k++) { norm += n[k]; origen.push(i); }
  }
  const marcado = new Array(s.length).fill(false);
  for (const p of ps) {
    let desde = 0;
    while (desde <= norm.length - p.length) {
      const j = norm.indexOf(p, desde);
      if (j < 0) break;
      for (let k = j; k < j + p.length; k++) marcado[origen[k]] = true;
      desde = j + p.length;
    }
  }
  let html = ''; let abierto = false;
  for (let i = 0; i < s.length; i++) {
    if (marcado[i] && !abierto) { html += '<mark>'; abierto = true; }
    if (!marcado[i] && abierto) { html += '</mark>'; abierto = false; }
    html += escH(s[i]);
  }
  return abierto ? `${html}</mark>` : html;
}

/** Las opciones de un <select> como datos planos: {i, v, t, s, g, dis}. */
export function opcionesDe(sel) {
  return [...sel.options].map((o, i) => ({ i, v: o.value, t: o.textContent.trim(), s: o.dataset?.secundario || '', g: o.parentElement?.tagName === 'OPTGROUP' ? (o.parentElement.label || '') : '', dis: o.disabled || o.parentElement?.disabled === true }));
}

/** ¿Este <select> se convierte? (regla de UMBRAL y de las excepciones). Pura sobre el elemento. */
export function debeConvertir(sel) {
  if (!sel || sel.tagName !== 'SELECT' || sel.multiple || sel.hidden || sel.hasAttribute('size') && Number(sel.getAttribute('size')) > 1) return false;
  if (sel.hasAttribute('data-sin-buscar') || sel.dataset.sbListo) return false;
  return sel.hasAttribute('data-buscar') || sel.options.length >= UMBRAL;
}

const ESTRECHO = 560; // px: desde aquí la lista va dentro del flujo (teléfono)
let secuencia = 0;
let abierto = null; // el control abierto (uno a la vez)
const controles = new Map(); // select → control

function textoDe(o) { return o ? o.textContent.trim() : ''; }
function etiquetaDe(sel) {
  const ids = [...(sel.labels || [])].map((l) => { if (!l.id) l.id = `sb-etq${++secuencia}`; return l.id; });
  return { ids, texto: sel.getAttribute('aria-label') || sel.title || sel.getAttribute('name') || 'Opciones' };
}
function recorta(el) { // ¿algún ancestro recorta (overflow ≠ visible)? Entonces la lista va fija.
  for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const ov = getComputedStyle(e).overflow; if (ov && ov !== 'visible') return true;
  }
  return false;
}

/** Convierte un <select> en selector buscable (si no lo era). Devuelve el control o null. */
export function convertirSelect(sel) {
  if (!sel || sel.dataset.sbListo || sel.tagName !== 'SELECT' || !sel.parentNode) return null;
  sel.dataset.sbListo = '1';
  const id = `sb${++secuencia}`;
  const nombre = sel.dataset.buscarNombre || 'opciones';
  const raiz = document.createElement('div');
  raiz.className = `sb ${sel.className}`.trim();
  raiz.dataset.sb = '';
  // Un <select> de ancho propio (en una barra de filtros) mantiene ese ancho; uno que llenaba su columna lo deja al CSS.
  if (sel.offsetWidth && sel.parentElement) {
    const p = sel.parentElement; const cs = getComputedStyle(p);
    const contenido = p.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    if (sel.offsetWidth < contenido - 2) raiz.style.width = `${sel.offsetWidth}px`;
  }
  // La etiqueta se lee ANTES de sacar el <select> del documento: desconectado, sel.labels queda vacío y el combobox
  // perdería su nombre accesible.
  const { ids, texto } = etiquetaDe(sel);
  sel.replaceWith(raiz);
  raiz.innerHTML = `<span class="sb-lupa" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span>
    <input class="sb-in" type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="${id}-l" autocomplete="off" autocapitalize="off" spellcheck="false"${ids.length ? ` aria-labelledby="${ids.join(' ')}"` : ` aria-label="${escH(texto)}"`}${sel.required ? ' aria-required="true"' : ''}>
    <button type="button" class="sb-x" aria-label="Limpiar" tabindex="-1" hidden>&#x2715;</button>
    <div class="sb-lista" id="${id}-l" hidden><div class="sb-ops" role="listbox" aria-label="${escH(texto)}"></div><div class="sb-pie" aria-live="polite"></div></div>`;
  raiz.appendChild(sel);
  sel.classList.add('sb-nativo');
  sel.setAttribute('tabindex', '-1');
  sel.setAttribute('aria-hidden', 'true');
  const inp = raiz.querySelector('.sb-in'); const x = raiz.querySelector('.sb-x');
  const lista = raiz.querySelector('.sb-lista'); const ops = raiz.querySelector('.sb-ops'); const pie = raiz.querySelector('.sb-pie');

  let filtradas = []; let activa = -1; let palabras = []; let ultimoValor = sel.value;
  const vacia = () => [...sel.options].find((o) => o.value === '');
  const marcador = () => textoDe(vacia()) || 'Buscar…';

  // Cuadro cerrado: muestra la opción elegida; vacío (con el texto de la opción «—») si no hay nada elegido.
  const pintar = () => {
    const o = sel.selectedOptions[0];
    const elegido = o && o.value !== '' ? textoDe(o) : '';
    if (document.activeElement !== inp || lista.hidden) { inp.value = elegido; inp.placeholder = elegido ? '' : marcador(); }
    x.hidden = !(elegido && vacia() && !sel.disabled);
    inp.disabled = sel.disabled; raiz.classList.toggle('sb-desact', sel.disabled);
    inp.title = elegido;
    if (o && o.value !== '') ultimoValor = o.value;
  };
  const dibujar = (q) => {
    const todas = opcionesDe(sel);
    palabras = palabrasDe(q);
    filtradas = filtrarOpciones(todas, q);
    const visibles = filtradas.slice(0, TOPE);
    let grupo = null; const filas = [];
    for (const o of visibles) {
      if (o.g !== grupo) { grupo = o.g; if (o.g) filas.push(`<div class="sb-grupo" role="presentation">${escH(o.g)}</div>`); }
      filas.push(`<div class="sb-op${o.dis ? ' sb-dis' : ''}" role="option" id="${id}-o${o.i}" data-i="${o.i}" aria-selected="${o.v === sel.value && o.v !== ''}"${o.dis ? ' aria-disabled="true"' : ''}><span class="sb-txt">${resaltar(o.t, palabras) || '&nbsp;'}</span>${o.s ? `<small class="sb-sec">· ${resaltar(o.s, palabras)}</small>` : ''}</div>`);
    }
    ops.innerHTML = filas.join('') || `<div class="sb-vacio" role="presentation">Ninguna opción calza con «${escH(String(q).trim())}».</div>`;
    pie.textContent = `${visibles.length} de ${todas.length} ${nombre}${filtradas.length > TOPE ? ' · escribe para ver más' : ''}`;
    // Activa: la elegida si se ve; si no, la primera que se pueda elegir.
    const sinDis = visibles.filter((o) => !o.dis);
    const elegida = sinDis.find((o) => o.v === sel.value && o.v !== '');
    activa = elegida ? elegida.i : (sinDis[0]?.i ?? -1);
    marcarActiva();
  };
  const marcarActiva = () => {
    let el = null;
    for (const li of ops.querySelectorAll('[role=option]')) { const on = Number(li.dataset.i) === activa; li.classList.toggle('sb-act', on); if (on) el = li; }
    if (el) {
      inp.setAttribute('aria-activedescendant', el.id);
      const arriba = el.offsetTop; const abajo = arriba + el.offsetHeight; // solo se mueve la lista, no la página
      if (arriba < ops.scrollTop) ops.scrollTop = arriba; else if (abajo > ops.scrollTop + ops.clientHeight) ops.scrollTop = abajo - ops.clientHeight;
    } else inp.removeAttribute('aria-activedescendant');
  };
  const mover = (paso) => {
    const sinDis = filtradas.slice(0, TOPE).filter((o) => !o.dis); if (!sinDis.length) return;
    const k = sinDis.findIndex((o) => o.i === activa);
    const n = k < 0 ? (paso > 0 ? 0 : sinDis.length - 1) : Math.min(sinDis.length - 1, Math.max(0, k + paso));
    activa = sinDis[n].i; marcarActiva();
  };
  const ubicar = () => { // posición de la lista: fija si un ancestro recorta (modal), absoluta si no, en el flujo en teléfono
    lista.style.cssText = '';
    if (window.innerWidth <= ESTRECHO) { raiz.classList.add('sb-flujo'); return; }
    raiz.classList.remove('sb-flujo');
    if (!recorta(raiz)) return;
    const r = raiz.getBoundingClientRect(); const alto = Math.min(lista.offsetHeight || 320, 320);
    const abajo = window.innerHeight - r.bottom - 8; const arriba = r.top - 8;
    const haciaArriba = abajo < alto && arriba > abajo;
    lista.style.position = 'fixed'; lista.style.left = `${r.left}px`; lista.style.width = `${r.width}px`; lista.style.right = 'auto';
    if (haciaArriba) { lista.style.top = 'auto'; lista.style.bottom = `${window.innerHeight - r.top + 4}px`; lista.style.maxHeight = `${Math.max(120, arriba)}px`; }
    else { lista.style.top = `${r.bottom + 4}px`; lista.style.bottom = 'auto'; lista.style.maxHeight = `${Math.max(120, abajo)}px`; }
  };
  const abrir = (conservar = false) => { // conservar: se abrió porque se escribió algo; lo escrito se queda
    if (sel.disabled || !lista.hidden) return;
    if (abierto && abierto !== control) abierto.cerrar();
    abierto = control;
    inp.placeholder = textoDe(sel.selectedOptions[0]) || marcador(); if (!conservar) inp.value = '';
    lista.hidden = false; inp.setAttribute('aria-expanded', 'true'); raiz.classList.add('sb-abierto');
    dibujar(conservar ? inp.value : '');
    ubicar();
    window.addEventListener('scroll', ubicar, true); window.addEventListener('resize', ubicar);
  };
  const cerrar = () => { // cierra sin cambiar el valor
    if (lista.hidden) return;
    lista.hidden = true; inp.setAttribute('aria-expanded', 'false'); raiz.classList.remove('sb-abierto'); inp.removeAttribute('aria-activedescendant');
    window.removeEventListener('scroll', ubicar, true); window.removeEventListener('resize', ubicar);
    if (abierto === control) abierto = null;
    inp.value = ''; pintar();
  };
  const elegir = (i) => {
    const o = sel.options[i];
    if (!o || o.disabled) return;
    const cambia = sel.value !== o.value || sel.selectedIndex !== i;
    if (cambia) sel.selectedIndex = i;
    cerrar();
    if (cambia) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  const limpiar = () => {
    const v = vacia(); if (!v) return;
    elegir([...sel.options].indexOf(v));
    inp.focus();
  };

  inp.addEventListener('focus', () => { if (lista.hidden) abrir(); });
  inp.addEventListener('click', () => { if (lista.hidden) abrir(); }); // clic en el cuadro ya enfocado (después de elegir): vuelve a abrir
  inp.addEventListener('input', (e) => {
    if (!lista.hidden) return dibujar(inp.value);
    // Cuadro cerrado con lo elegido escrito: lo que se teclea reemplaza ese texto (no se le pega al final).
    const etiqueta = textoDe(sel.selectedOptions[0]);
    if (e.data && etiqueta && inp.value === etiqueta + e.data) inp.value = e.data;
    abrir(true);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (lista.hidden) abrir(); else mover(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Home' || e.key === 'End') { if (!lista.hidden) { e.preventDefault(); mover(e.key === 'Home' ? -1e9 : 1e9); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (lista.hidden) abrir(); else { e.stopPropagation(); if (activa >= 0) elegir(activa); } } // stopPropagation: Enter dentro del modal no «guarda»
    else if (e.key === 'Escape') { if (!lista.hidden) { e.preventDefault(); e.stopPropagation(); cerrar(); } } // Esc con la lista abierta no cierra el modal (comun.js › modal escucha en document)
    else if (e.key === 'Tab') cerrar();
  });
  raiz.addEventListener('focusout', (e) => { if (!raiz.contains(e.relatedTarget)) cerrar(); });
  ops.addEventListener('mousedown', (e) => { const li = e.target.closest('[role=option]'); if (li) { e.preventDefault(); elegir(Number(li.dataset.i)); } });
  ops.addEventListener('mousemove', (e) => { const li = e.target.closest('[role=option]:not(.sb-dis)'); if (li && Number(li.dataset.i) !== activa) { activa = Number(li.dataset.i); marcarActiva(); } });
  raiz.querySelector('.sb-lupa').addEventListener('mousedown', (e) => { e.preventDefault(); inp.focus(); });
  x.addEventListener('mousedown', (e) => e.preventDefault());
  x.addEventListener('click', limpiar);
  // Lo que le pase al <select> por debajo se refleja arriba: un cambio por programa, un foco que le mandó la etiqueta o
  // el modal, un «required» sin cumplir al enviar el formulario.
  sel.addEventListener('focus', () => inp.focus());
  sel.addEventListener('change', pintar);
  sel.addEventListener('invalid', (e) => { e.preventDefault(); raiz.classList.add('sb-invalido'); inp.title = sel.validationMessage; inp.focus(); });
  sel.form?.addEventListener('reset', () => setTimeout(pintar, 0));
  for (const prop of ['value', 'selectedIndex']) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    if (d?.set) Object.defineProperty(sel, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); pintar(); } });
  }
  const control = {
    raiz, sel, inp, cerrar, abrir, pintar,
    // Las opciones se volvieron a llenar por programa: si el valor que había sigue existiendo y el nuevo HTML no eligió
    // otra cosa a propósito, se conserva.
    opcionesCambiaron() {
      const conSelected = [...sel.options].some((o) => o.hasAttribute('selected') && o.value !== '');
      if (!conSelected && ultimoValor && (sel.value === '' || sel.selectedIndex <= 0) && [...sel.options].some((o) => o.value === ultimoValor)) sel.value = ultimoValor;
      if (!lista.hidden) dibujar(inp.value);
      pintar();
    },
    deshacer() { // el <select> se fue (lo reemplazaron con outerHTML): el envoltorio se deshace y deja lo nuevo en su lugar
      cerrar();
      for (const h of [...raiz.children]) if (!h.classList.contains('sb-lupa') && !h.classList.contains('sb-in') && !h.classList.contains('sb-x') && !h.classList.contains('sb-lista') && h !== sel) raiz.before(h);
      raiz.remove();
      controles.delete(sel);
    }
  };
  controles.set(sel, control);
  pintar();
  return control;
}

/** Revisa la página: convierte lo que toque, refresca lo que cambió y deshace lo que quedó huérfano. */
export function revisarSelectores(raiz = document.body, cambiados = null) {
  for (const [sel, c] of controles) {
    if (!sel.isConnected || sel.parentElement !== c.raiz) c.deshacer();
    else if (cambiados?.has(sel)) c.opcionesCambiaron();
    else c.pintar();
  }
  for (const sel of raiz.querySelectorAll('select')) {
    // Un <select> que trae las marcas de otro (lo clonaron o lo reescribieron con su propio outerHTML) se limpia y se mira de nuevo.
    if (sel.dataset.sbListo && !controles.has(sel)) { delete sel.dataset.sbListo; sel.classList.remove('sb-nativo'); sel.removeAttribute('aria-hidden'); if (sel.getAttribute('tabindex') === '-1') sel.removeAttribute('tabindex'); }
    if (debeConvertir(sel)) convertirSelect(sel);
  }
}

let instalado = false;
export function instalarSelectorBuscable(raiz = document.body) {
  if (instalado || typeof MutationObserver === 'undefined' || !raiz) return;
  instalado = true;
  let pendiente = false; let cambiados = new Set();
  const revisar = () => { pendiente = false; const c = cambiados; cambiados = new Set(); revisarSelectores(raiz, c); };
  const programar = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(revisar); } };
  new MutationObserver((ms) => {
    let hay = false;
    for (const m of ms) {
      const t = m.target;
      if (t.closest?.('.sb-lista')) continue; // lo que dibuja el propio control no vuelve a entrar
      const sel = t.tagName === 'SELECT' ? t : t.tagName === 'OPTGROUP' || t.tagName === 'OPTION' ? t.closest('select') : null;
      if (sel && controles.has(sel)) cambiados.add(sel);
      hay = true;
    }
    if (hay) programar();
  }).observe(raiz, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'selected', 'data-sin-buscar', 'data-buscar', 'required'] });
  programar();
}
