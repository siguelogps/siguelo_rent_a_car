/* Síguelo On Rent · service worker (PWA y app).
   No guarda datos del negocio en el teléfono: la API siempre va a la red.
   Solo deja a mano la página «Sin conexión» y los estilos/logos para mostrarla. */
const VERSION = 'onrent-v1';
const BASICOS = ['/sin-conexion.html', '/app.css', '/rentacar.css', '/img/logo-pin.png', '/img/logo-siguelo.png', '/img/app/icono-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Páginas: siempre desde la red; si no hay conexión, la página «Sin conexión».
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/sin-conexion.html')));
    return;
  }
  // Lo básico para pintar «Sin conexión»: red primero, copia guardada si falla.
  if (BASICOS.includes(new URL(req.url).pathname)) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
