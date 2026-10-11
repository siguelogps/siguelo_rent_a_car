// Fotos de inspección en el celular: ubicación (se pide una sola vez), sello de fecha/hora/coordenadas/sucursal
// estampado sobre la imagen y reducción a 1600 px JPEG antes de subir.

let ubicacion = null; // Promise<{ lat, lng } | null>
export function obtenerUbicacion() {
  if (ubicacion) return ubicacion;
  ubicacion = new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }),
      () => ok(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }
    );
  });
  return ubicacion;
}

// dd-mm-aaaa HH:MM:SS en hora de Chile
export function selloFecha(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}
export const textoCoordenadas = (u) => (u ? `${u.lat.toFixed(4)}, ${u.lng.toFixed(4)}` : 'sin ubicación');

function cargarImagen(archivo) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error('No se pudo leer la foto'));
    img.src = URL.createObjectURL(archivo);
  });
}

// Archivo de la cámara → { dataUrl, tomada_en, lat, lng }
export async function sellarFoto(archivo, { sucursal = '', etiqueta = '', maxLado = 1600, calidad = 0.82 } = {}) {
  const [img, u] = await Promise.all([cargarImagen(archivo), obtenerUbicacion()]);
  const ahora = new Date();
  const k = Math.min(1, maxLado / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || img.width) * k);
  c.height = Math.round((img.naturalHeight || img.height) * k);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  // Banda inferior con el sello
  const fs = Math.max(13, Math.round(c.width / 52));
  const lineas = [`${selloFecha(ahora)}${etiqueta ? `  ·  ${etiqueta}` : ''}`, `${textoCoordenadas(u)}${sucursal ? `  ·  ${sucursal}` : ''}`];
  const alto = Math.round(fs * 1.35 * lineas.length + fs * 0.9);
  const grad = g.createLinearGradient(0, c.height - alto * 1.4, 0, c.height);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.3, 'rgba(0,0,0,.55)'); grad.addColorStop(1, 'rgba(0,0,0,.75)');
  g.fillStyle = grad;
  g.fillRect(0, c.height - alto * 1.4, c.width, alto * 1.4);
  g.fillStyle = '#fff';
  g.font = `600 ${fs}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
  g.textBaseline = 'alphabetic';
  lineas.forEach((t, i) => g.fillText(t, Math.round(fs * 0.7), c.height - alto + Math.round(fs * 0.45) + fs * 1.35 * (i + 1) - fs * 0.25));
  return { dataUrl: c.toDataURL('image/jpeg', calidad), tomada_en: ahora.toISOString(), lat: u?.lat ?? null, lng: u?.lng ?? null };
}

// Abre la cámara trasera (input file con capture) y devuelve el File elegido, o null
export function abrirCamara() {
  return new Promise((ok) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    inp.setAttribute('capture', 'environment');
    inp.style.display = 'none';
    inp.addEventListener('change', () => { ok(inp.files?.[0] || null); inp.remove(); });
    inp.addEventListener('cancel', () => { ok(null); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}
