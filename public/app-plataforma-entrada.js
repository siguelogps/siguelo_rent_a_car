// Página de entrada desde el menú Apps de la plataforma de rastreo (mismo estándar que Síguelo OS: app-wialon.html).
// Llega con ?authHash=…&baseUrl=…&lang=…&user=… y hace tres cosas:
//   1. Limpia la barra de direcciones AL TIRO, antes de cualquier otra cosa: el hash no queda en el historial (y el
//      meta referrer de la página evita que viaje a otro sitio).
//   2. Manda authHash + baseUrl al servidor por POST. Quién es el cliente lo dice el servidor; `user` solo se muestra
//      mientras carga, siempre como texto (nunca como HTML).
//   3. Con la sesión abierta, pasa a la herramienta. Si algo no calza, muestra una pantalla clara, sin datos de nadie.
// Archivo aparte (no en línea) para que funcione con CSP estrictas. Lo configura <body data-…> de la página.
(function () {
  var q = new URLSearchParams(window.location.search);
  var authHash = q.get('authHash') || '';
  var baseUrl = q.get('baseUrl') || '';
  var usuarioUrl = (q.get('user') || '').slice(0, 80);
  try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* sin historial: se sigue */ }

  var d = document.body.dataset;
  var herramienta = d.herramienta || 'la herramienta';
  var $ = function (id) { return document.getElementById(id); };
  var TITULOS = {
    parametros: 'El enlace llegó incompleto',
    entrada_desconocida: 'No pudimos confirmar desde dónde llegaste',
    acceso_vencido: 'El acceso venció',
    sin_acceso: 'Esta herramienta aún no está activa para tu cuenta',
    no_vinculado: 'Vincula tu usuario',
    suspendida: 'Tu acceso está pausado',
    red: 'No pudimos abrir ' + herramienta
  };

  function boton(texto, href, secundario) {
    var a = document.createElement('a');
    a.className = 'ap-btn' + (secundario ? ' sec' : '');
    a.textContent = texto;
    a.href = href;
    if (/^https?:/.test(href)) { a.target = '_top'; a.rel = 'noopener'; }
    return a;
  }
  function fallar(motivo, texto, extra) {
    extra = extra || {};
    $('ap-cargando').hidden = true;
    $('ap-error').hidden = false;
    var titulo = TITULOS[motivo] || TITULOS.red;
    texto = texto || 'Reintenta en unos segundos.';
    if (texto.indexOf(titulo) === 0) texto = texto.slice(titulo.length).replace(/^[.\s]+/, '') || texto; // sin repetir el título
    $('ap-error-titulo').textContent = titulo;
    $('ap-error-texto').textContent = texto;
    var b = $('ap-botones');
    b.textContent = '';
    if (motivo === 'no_vinculado') b.appendChild(boton('Entrar con mi correo y clave', extra.ingreso || d.ingreso || '/'));
    if (motivo === 'sin_acceso' || motivo === 'suspendida') {
      var c = extra.contacto || {};
      var correo = c.correo || d.correo;
      var telefono = c.telefono || d.telefono;
      var whatsapp = c.whatsapp || d.whatsapp;
      if (correo) b.appendChild(boton('Escribir a ' + correo, 'mailto:' + correo + '?subject=' + encodeURIComponent('Activar ' + herramienta)));
      if (whatsapp) b.appendChild(boton('WhatsApp', 'https://wa.me/' + String(whatsapp).replace(/\D/g, ''), true));
      if (telefono) b.appendChild(boton('Llamar ' + telefono, 'tel:' + String(telefono).replace(/[^\d+]/g, ''), true));
      if (extra.alta) b.appendChild(boton('Crear mi cuenta', extra.alta, true));
    }
    if (motivo !== 'no_vinculado' && d.ingreso) b.appendChild(boton('Ir a la pantalla de ingreso', d.ingreso, true));
  }

  if (usuarioUrl) { $('ap-usuario').textContent = usuarioUrl; $('ap-como').hidden = false; }
  if (!authHash || !baseUrl) {
    fallar('parametros', 'El enlace llegó incompleto. Vuelve a abrir ' + herramienta + ' desde el menú Apps de tu plataforma de rastreo.');
    return;
  }

  var encabezados = { 'Content-Type': 'application/json' };
  try { var extra = JSON.parse(d.encabezados || '{}'); for (var k in extra) encabezados[k] = extra[k]; } catch (e) { /* sin extras */ }

  fetch(d.api, { method: 'POST', credentials: 'same-origin', headers: encabezados, body: JSON.stringify({ authHash: authHash, baseUrl: baseUrl }) })
    .then(function (res) { return res.json().catch(function () { return {}; }).then(function (r) { return { ok: res.ok, r: r }; }); })
    .then(function (x) {
      if (!x.ok || !x.r.ok) { fallar(x.r.motivo || 'red', x.r.error, x.r); return; }
      $('ap-paso1').textContent = '✓ Confirmamos quién eres';
      $('ap-paso1').className = 'ok';
      if (x.r.nombre) { $('ap-usuario').textContent = x.r.nombre; $('ap-como').hidden = false; }
      $('ap-paso2').textContent = '✓ ' + (x.r.empresa ? 'Tu empresa: ' + x.r.empresa : 'Tu empresa');
      $('ap-paso2').className = 'ok';
      var ir = typeof x.r.ir === 'string' && /^\/(?!\/)/.test(x.r.ir) ? x.r.ir : '/';
      window.location.replace(ir);
    })
    .catch(function () { fallar('red', 'No pudimos comunicarnos en este momento. Vuelve a abrir ' + herramienta + ' desde el menú Apps.'); });
})();
