// La franja «Abierto desde tu plataforma de rastreo» y el cierre de sesión que vuelve allá (como en Síguelo OS).
// El servidor deja la cookie `volver_plataforma` al entrar desde el menú Apps (y la borra en el ingreso con clave).
// Solo se acepta una de las direcciones conocidas: nunca se vuelve a una dirección que venga de afuera.
// Uso en el «cerrar sesión» de la herramienta:  location.href = (window.salidaPlataforma && window.salidaPlataforma()) || '/entrar';
(function () {
  var PERMITIDOS = ['https://plataforma.siguelogps.com', 'https://lite.wialon.com'];
  var volver = null;
  try {
    var m = document.cookie.match(/(?:^|;\s*)volver_plataforma=([^;]+)/);
    var v = m ? decodeURIComponent(m[1]) : null;
    if (v && PERMITIDOS.indexOf(v) >= 0) volver = v;
  } catch (e) { volver = null; }

  window.salidaPlataforma = function () {
    if (!volver) return null;
    try { document.cookie = 'volver_plataforma=; Path=/; Max-Age=0; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (e) { /* nada */ }
    return volver;
  };
  if (!volver) return;

  var guion = document.currentScript && document.currentScript.src;
  function pintar() {
    if (document.getElementById('ap-franja')) return;
    try { if (sessionStorage.getItem('ap_franja_oculta') === '1') return; } catch (e) { /* sin almacenamiento: se muestra */ }
    if (guion) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = guion.replace(/franja-plataforma\.js(\?.*)?$/, 'app-plataforma.css');
      document.head.appendChild(l);
    }
    var f = document.createElement('div');
    f.id = 'ap-franja';
    f.className = 'ap-franja';
    f.setAttribute('role', 'note');
    var pin = document.createElement('span'); pin.className = 'pin';
    var t = document.createElement('span'); t.textContent = 'Abierto desde tu plataforma de rastreo';
    var a = document.createElement('a'); a.href = volver; a.target = '_top'; a.rel = 'noopener'; a.textContent = 'Volver';
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Ocultar'); x.textContent = '×';
    x.addEventListener('click', function () { f.remove(); try { sessionStorage.setItem('ap_franja_oculta', '1'); } catch (e) { /* nada */ } });
    f.appendChild(pin); f.appendChild(t); f.appendChild(a); f.appendChild(x);
    document.body.appendChild(f);
  }
  if (document.body) pintar(); else document.addEventListener('DOMContentLoaded', pintar);
})();
