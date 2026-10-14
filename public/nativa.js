// Puente con la app Síguelo On Rent (Android / iOS, apps/movil). En el navegador no hace nada salvo registrar
// el service worker de la PWA. Dentro de la app:
//  · botón «atrás» de Android: cierra el modal o el menú abierto, vuelve atrás o deja la app en segundo plano;
//  · archivos (PDF, Excel, documentos): se guardan en el teléfono y se abre el menú de compartir/abrir con
//    (los WebView no muestran PDF ni descargan blobs); las fotos se ven en un visor dentro de la app;
//  · enlaces externos (WhatsApp, sitio web) salen al navegador o la app correspondiente;
//  · márgenes seguros en iOS (notch, barra de inicio).
const C = window.Capacitor;
export const esNativa = () => !!C?.isNativePlatform?.();
export const plataforma = () => (esNativa() ? C.getPlatform() : 'web');
const plugin = (n) => C?.Plugins?.[n] || C?.registerPlugin?.(n);

const RUTA_ARCHIVO = /^\/api\/archivos\/\d+$|\/pdf$|\.pdf$/;

export async function guardarYCompartir(blob, nombre) {
  const Filesystem = plugin('Filesystem'), Share = plugin('Share');
  const data = await new Promise((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => mal(r.error);
    r.readAsDataURL(blob);
  });
  const limpio = String(nombre || 'archivo').replace(/[\\/:*?"<>|]+/g, '-');
  const { uri } = await Filesystem.writeFile({ path: `descargas/${limpio}`, data, directory: 'CACHE', recursive: true });
  try { await Share.share({ title: limpio, files: [uri], dialogTitle: 'Abrir o guardar' }); }
  catch (e) { if (!/cancel/i.test(e?.message || '')) throw e; } // cerrar el menú de compartir no es un error
}

function nombreDe(resp, url) {
  const cd = resp.headers.get('content-disposition') || '';
  const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
  if (m) return decodeURIComponent(m[1]);
  const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[(resp.headers.get('content-type') || '').split(';')[0]];
  const base = new URL(url, location.href).pathname.split('/').filter(Boolean).slice(-2).join('-') || 'archivo';
  return ext && !base.endsWith(`.${ext}`) ? `${base}.${ext}` : base;
}

function visor(src) {
  const f = document.createElement('div');
  f.className = 'rc-visor';
  f.innerHTML = `<button type="button" class="rc-visor-cerrar" aria-label="Cerrar">✕</button><img alt="">`;
  f.querySelector('img').src = src;
  f.addEventListener('click', () => { URL.revokeObjectURL(src); f.remove(); });
  document.body.appendChild(f);
}

// Abre un archivo del sistema dentro de la app: foto → visor; cualquier otro → compartir/abrir con.
export async function abrirArchivo(url, nombre = null) {
  if (!esNativa()) { window.open(url, '_blank', 'noopener'); return; }
  try {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(r.status === 404 ? 'No encontramos el archivo.' : `No se pudo abrir el archivo (error ${r.status}).`);
    const blob = await r.blob();
    if (/^image\//.test(blob.type)) return visor(URL.createObjectURL(blob));
    await guardarYCompartir(blob, nombre || nombreDe(r, url));
  } catch (e) {
    const { toast } = await import('/comun.js');
    toast(e.message || String(e), 'error');
  }
}

function alPresionarAtras({ canGoBack }) {
  const v = document.querySelector('.rc-visor');
  if (v) return v.click();
  const modales = document.querySelectorAll('.modal-fondo');
  if (modales.length) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const ultimo = modales[modales.length - 1];
    if (ultimo.isConnected) ultimo.querySelector('[data-cerrar]')?.click();
    return;
  }
  const app = document.querySelector('.app.menu-abierto');
  if (app) return app.classList.remove('menu-abierto');
  if (canGoBack) history.back(); else plugin('App').minimizeApp();
}

function interceptarEnlaces() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return; // tel:, mailto:, whatsapp: los maneja el sistema
    if (u.origin !== location.origin) { e.preventDefault(); location.href = u.href; return; } // la app lo abre afuera
    if (RUTA_ARCHIVO.test(u.pathname) || a.hasAttribute('download') || u.searchParams.has('descargar')) {
      e.preventDefault(); abrirArchivo(u.href, a.getAttribute('download') || null); return;
    }
    if (a.target === '_blank') { e.preventDefault(); location.href = u.href; } // sin pestañas: misma vista (atrás vuelve)
  }, true);
}

function iniciar() {
  if (!esNativa()) {
    if ('serviceWorker' in navigator && document.querySelector('link[rel="manifest"]')) {
      addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }
    return;
  }
  const raiz = document.documentElement;
  raiz.classList.add('nativa', `nativa-${plataforma()}`);
  if (plataforma() === 'ios') {
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp && !/viewport-fit/.test(vp.content)) vp.content += ', viewport-fit=cover';
  }
  interceptarEnlaces();
  plugin('App').addListener('backButton', alPresionarAtras);
  // window.open no existe en la app: los archivos van al visor/compartir y lo demás a la misma vista.
  const abrirOriginal = window.open;
  window.open = (url, destino, ...resto) => {
    if (!url) return null;
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) { location.href = u.href; return null; }
    if (RUTA_ARCHIVO.test(u.pathname)) { abrirArchivo(u.href); return null; }
    if (destino === '_self') return abrirOriginal.call(window, url, destino, ...resto);
    location.href = u.href; return null;
  };
}

iniciar();
