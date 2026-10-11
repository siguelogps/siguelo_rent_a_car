/* Síguelo Rentacar · motor de reservas para el sitio web del rentacar.
   Uso (pegar donde quieras que aparezca el buscador):
     <script src="https://<servidor>/embed.js" data-rentacar="andes-rent"></script>
   Opcionales: data-codigo="PRIMAVERA10" (código de descuento precargado), data-alto-minimo="520".
   Crea un iframe responsivo hacia /embed/<rentacar> que ajusta su alto solo (postMessage). */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var slug = s.getAttribute('data-rentacar');
  if (!slug) { console.error('Síguelo Rentacar: falta el atributo data-rentacar en el script de reservas'); return; }
  var origen = new URL(s.src, location.href).origin;
  var codigo = s.getAttribute('data-codigo');
  var minimo = parseInt(s.getAttribute('data-alto-minimo') || '520', 10);
  var f = document.createElement('iframe');
  f.src = origen + '/embed/' + encodeURIComponent(slug) + (codigo ? '?codigo=' + encodeURIComponent(codigo) : '');
  f.title = 'Reserva tu vehículo';
  f.setAttribute('allow', 'payment');
  f.setAttribute('loading', 'lazy');
  f.style.cssText = 'display:block;width:100%;max-width:100%;border:0;overflow:hidden;min-height:' + minimo + 'px;height:' + minimo + 'px;background:transparent';
  f.setAttribute('scrolling', 'no');
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== origen || e.source !== f.contentWindow || !e.data) return;
    if (e.data.tipo === 'siguelo-rentacar-altura' && e.data.altura > 0) f.style.height = Math.max(minimo, Math.ceil(e.data.altura)) + 'px';
    if (e.data.tipo === 'siguelo-rentacar-arriba') {
      var r = f.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight) window.scrollTo({ top: window.pageYOffset + r.top - 16, behavior: 'smooth' });
    }
  });
})();
