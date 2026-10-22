// Tema claro u oscuro, igual en todos los sistemas Síguelo. Se carga SIN «defer» en el <head> de cada página, antes de
// las hojas de estilo, para que la página no parpadee en claro antes de pasar a oscuro. Es un archivo (no un <script> en
// línea) para respetar la CSP estricta.
// Tres estados: «auto» (sigue al sistema operativo, lo normal), «claro» y «oscuro». Lo elegido a mano queda en este
// navegador (localStorage); si el almacenamiento está bloqueado (modo privado, política), se sigue al sistema y la
// elección dura lo que dure la página. La raíz queda con data-theme="claro" | "oscuro" (el efectivo) y data-tema-pref
// con la preferencia. Los colores oscuros son los mismos tokens del CRM redefinidos bajo :root[data-theme="oscuro"].
// Al imprimir se vuelve a claro: los informes impresos y los PDF siempre son claros.
(function () {
  var CLAVE = 'onrent-tema';
  var raiz = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var memoria = null; // respaldo si localStorage no está disponible
  var forzado = null;
  try { var q = new URLSearchParams(location.search).get('tema'); if (q === 'claro' || q === 'oscuro') forzado = q; } catch (e) { /* sin URLSearchParams */ }

  // El formulario de reservas incrustado en la web del rentacar (/embed/…) queda siempre claro, como esa web.
  if (/^\/embed\//.test(location.pathname)) forzado = 'claro';

  function preferencia() {
    var v = memoria;
    try { v = localStorage.getItem(CLAVE) || memoria; } catch (e) { /* almacenamiento bloqueado */ }
    return v === 'claro' || v === 'oscuro' ? v : 'auto';
  }
  function efectivo(pref) {
    if (forzado) return forzado;
    if (pref === 'claro' || pref === 'oscuro') return pref;
    return mq && mq.matches ? 'oscuro' : 'claro';
  }
  function aplicar() {
    var pref = preferencia();
    raiz.setAttribute('data-theme', efectivo(pref));
    raiz.setAttribute('data-tema-pref', pref);
    try { window.dispatchEvent(new CustomEvent('tema', { detail: { tema: raiz.getAttribute('data-theme'), preferencia: pref } })); } catch (e) { /* navegador antiguo */ }
  }
  function elegir(pref) {
    if (pref !== 'claro' && pref !== 'oscuro') pref = 'auto';
    memoria = pref;
    forzado = null;
    try { if (pref === 'auto') localStorage.removeItem(CLAVE); else localStorage.setItem(CLAVE, pref); } catch (e) { /* queda en memoria */ }
    aplicar();
    actualizarBotones();
  }

  var NOMBRES = { auto: 'Automático', claro: 'Claro', oscuro: 'Oscuro' };
  var SIGUIENTE = { auto: 'claro', claro: 'oscuro', oscuro: 'auto' };
  var svg = function (d) { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  var ICONOS = {
    auto: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M12 7v6" opacity=".5"/>'),
    claro: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    oscuro: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>')
  };
  var botones = [];
  function pintar(b) {
    var pref = preferencia();
    b.innerHTML = ICONOS[pref];
    var txt = 'Tema: ' + NOMBRES[pref] + (pref === 'auto' ? ' (sigue al sistema)' : '') + '. Cambiar a ' + NOMBRES[SIGUIENTE[pref]];
    b.title = txt;
    b.setAttribute('aria-label', txt);
    b.setAttribute('data-tema', pref);
  }
  function actualizarBotones() { for (var i = 0; i < botones.length; i++) pintar(botones[i]); }
  // Botón de la barra superior: cada clic pasa Automático → Claro → Oscuro → Automático.
  function boton(clase) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = clase || 'tema-btn';
    b.addEventListener('click', function () { elegir(SIGUIENTE[preferencia()]); });
    botones.push(b);
    pintar(b);
    return b;
  }

  aplicar();
  // En «Automático», si el sistema cambia de claro a oscuro (al anochecer, por ejemplo), la página lo sigue al tiro.
  var alCambiarSistema = function () { if (preferencia() === 'auto') aplicar(); };
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', alCambiarSistema); else if (mq.addListener) mq.addListener(alCambiarSistema); }
  // Otra pestaña del mismo sistema cambió el tema: se sigue.
  window.addEventListener('storage', function (e) { if (e.key === CLAVE) { aplicar(); actualizarBotones(); } });
  // Lo impreso siempre en claro.
  var antes = null;
  window.addEventListener('beforeprint', function () { antes = raiz.getAttribute('data-theme'); raiz.setAttribute('data-theme', 'claro'); });
  window.addEventListener('afterprint', function () { if (antes) raiz.setAttribute('data-theme', antes); antes = null; });

  window.SigueloTema = { preferencia: preferencia, elegir: elegir, boton: boton, actual: function () { return raiz.getAttribute('data-theme'); } };
})();
