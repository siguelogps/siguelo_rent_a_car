// Firma en pantalla (respaldo propio del módulo de patio; misma API que /firma.js para unificar después).
//   const f = crearFirma(contenedor);  f.vacia() → bool · f.dataUrl() → PNG · f.limpiar()
export function crearFirma(contenedor) {
  contenedor.innerHTML = '';
  const c = document.createElement('canvas');
  c.className = 'firma-canvas';
  c.setAttribute('aria-label', 'Firma del cliente: dibuja con el dedo');
  contenedor.appendChild(c);
  const g = c.getContext('2d');
  let vacia = true, dibujando = false, ultimo = null;
  const linea = () => {
    g.save(); g.strokeStyle = '#C4C9D1'; g.setLineDash([4, 4]); g.lineWidth = 1;
    const y = c.height / (window.devicePixelRatio || 1) - 30;
    g.beginPath(); g.moveTo(20, y); g.lineTo(c.width / (window.devicePixelRatio || 1) - 20, y); g.stroke(); g.restore();
  };
  const ajustar = () => {
    const r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    if (!r.width) return;
    const previo = vacia ? null : c.toDataURL();
    c.width = Math.round(r.width * k); c.height = Math.round(r.height * k);
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#15181D';
    linea();
    if (previo) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, r.width, r.height); im.src = previo; }
  };
  const punto = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  c.addEventListener('pointerdown', (e) => { dibujando = true; ultimo = punto(e); c.setPointerCapture(e.pointerId); e.preventDefault(); });
  c.addEventListener('pointermove', (e) => {
    if (!dibujando) return;
    const p = punto(e);
    g.beginPath(); g.moveTo(ultimo.x, ultimo.y); g.lineTo(p.x, p.y); g.stroke();
    ultimo = p; vacia = false; e.preventDefault();
  });
  const fin = () => { dibujando = false; };
  c.addEventListener('pointerup', fin); c.addEventListener('pointercancel', fin);
  requestAnimationFrame(ajustar);
  window.addEventListener('resize', ajustar);
  return {
    vacia: () => vacia,
    dataUrl: () => c.toDataURL('image/png'),
    limpiar: () => { vacia = true; g.clearRect(0, 0, c.width, c.height); linea(); },
    // solo para pruebas automáticas: dibuja un trazo
    _trazo: () => { const r = c.getBoundingClientRect(); g.beginPath(); g.moveTo(30, r.height - 50); [[60, 40], [90, 90], [120, 50], [160, 100], [200, 60], [260, 80]].forEach(([x, y]) => g.lineTo(x * r.width / 330, y)); g.stroke(); vacia = false; }
  };
}
