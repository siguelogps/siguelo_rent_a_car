// Componente de firma manuscrita reutilizable (contrato, entrega y devolución en patio).
// Uso:  import { crearFirma } from '/firma.js';
//       const f = crearFirma(document.getElementById('firma'), { alCambiar: () => … });
//       f.vacia() → true/false · f.dataUrl() → 'data:image/png;base64,…' (fondo transparente) · f.limpiar()
// Funciona con mouse, lápiz y dedo (pointer events), respeta la densidad de pantalla y se adapta al ancho.
export function crearFirma(contenedor, { alto = 180, alCambiar = null, texto = 'Firma aquí con el dedo o el mouse' } = {}) {
  contenedor.classList.add('firma-caja');
  if (!contenedor.style.position) contenedor.style.position = 'relative';
  contenedor.innerHTML = `<canvas class="firma-canvas" style="height:${alto}px;display:block" aria-label="Recuadro para firmar"></canvas>
    <span class="firma-guia" style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:#9AA1AD;font-size:14px;pointer-events:none">${texto}</span>
    <span style="position:absolute;left:16px;right:16px;bottom:34px;border-bottom:1px solid #D0D5DD;pointer-events:none"></span>
    <button type="button" class="btn peq firma-limpiar" style="position:absolute;right:8px;top:8px">Borrar</button>`;
  const canvas = contenedor.querySelector('canvas'), guia = contenedor.querySelector('.firma-guia');
  const ctx = canvas.getContext('2d');
  let trazos = [], actual = null, dpr = 1;

  function ajustar() {
    dpr = Math.max(1, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    redibujar();
  }
  function trazar(t) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#15181D';
    for (let i = 1; i < t.length; i++) {
      const a = t[i - 1], b = t[i];
      const dist = Math.hypot((b.x - a.x) * canvas.width, (b.y - a.y) * canvas.height) / dpr;
      ctx.lineWidth = Math.max(1.4, 3.2 - Math.min(1.8, dist / 12)) * dpr * (b.p || 1);
      ctx.beginPath(); ctx.moveTo(a.x * canvas.width, a.y * canvas.height); ctx.lineTo(b.x * canvas.width, b.y * canvas.height); ctx.stroke();
    }
    if (t.length === 1) { ctx.fillStyle = '#15181D'; ctx.beginPath(); ctx.arc(t[0].x * canvas.width, t[0].y * canvas.height, 1.6 * dpr, 0, 7); ctx.fill(); }
  }
  function redibujar() { ctx.clearRect(0, 0, canvas.width, canvas.height); trazos.forEach(trazar); guia.hidden = trazos.length > 0; }
  // Coordenadas relativas (0–1): la firma sobrevive a un cambio de tamaño (girar la tablet)
  const punto = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, p: e.pointerType === 'pen' && e.pressure ? 0.6 + e.pressure * 0.8 : 1 }; };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    actual = [punto(e)]; trazos.push(actual); guia.hidden = true; trazar(actual);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!actual) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const desde = actual.length - 1;
    for (const ev of evs.length ? evs : [e]) actual.push(punto(ev));
    trazar(actual.slice(Math.max(0, desde)));
  });
  const terminar = () => { if (actual) { actual = null; alCambiar?.(); } };
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);
  contenedor.querySelector('.firma-limpiar').addEventListener('click', () => api.limpiar());
  new ResizeObserver(ajustar).observe(canvas);
  ajustar();

  const api = {
    vacia: () => trazos.reduce((n, t) => n + t.length, 0) < 8,
    limpiar: () => { trazos = []; actual = null; redibujar(); alCambiar?.(); },
    dataUrl: () => {
      // Se exporta recortada al área firmada, con margen, para que se vea bien en el PDF
      if (api.vacia()) return null;
      const pts = trazos.flat();
      const xs = pts.map((p) => p.x * canvas.width), ys = pts.map((p) => p.y * canvas.height);
      const m = 12 * dpr, x0 = Math.max(0, Math.min(...xs) - m), y0 = Math.max(0, Math.min(...ys) - m);
      const x1 = Math.min(canvas.width, Math.max(...xs) + m), y1 = Math.min(canvas.height, Math.max(...ys) + m);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(x1 - x0)); out.height = Math.max(1, Math.round(y1 - y0));
      out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    }
  };
  return api;
}
