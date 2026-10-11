// Imágenes PNG generadas sin dependencias (solo para datos de prueba): una firma manuscrita y tarjetas de documento.
import zlib from 'node:zlib';

const TABLA = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = TABLA[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const bloque = (tipo, datos) => {
  const t = Buffer.from(tipo, 'ascii'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(datos.length); crc.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([len, t, datos, crc]);
};

function png(ancho, alto, pix) { // pix: Uint8Array RGBA
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const filas = Buffer.alloc((ancho * 4 + 1) * alto);
  for (let y = 0; y < alto; y++) { filas[y * (ancho * 4 + 1)] = 0; Buffer.from(pix.buffer, y * ancho * 4, ancho * 4).copy(filas, y * (ancho * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), bloque('IHDR', ihdr), bloque('IDAT', zlib.deflateSync(filas)), bloque('IEND', Buffer.alloc(0))]);
}

function lienzo(ancho, alto, fondo = [0, 0, 0, 0]) {
  const pix = new Uint8Array(ancho * alto * 4);
  for (let i = 0; i < ancho * alto; i++) pix.set(fondo, i * 4);
  const punto = (x, y, r, color) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= ancho || py >= alto || dx * dx + dy * dy > r * r) continue;
      pix.set(color, (py * ancho + px) * 4);
    }
  };
  const rect = (x0, y0, w, h, color) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < ancho && y < alto) pix.set(color, (y * ancho + x) * 4); };
  return { pix, punto, rect, png: () => png(ancho, alto, pix) };
}

/** Firma manuscrita de ejemplo (PNG con fondo transparente). */
export function firmaDemo(semilla = 1) {
  const W = 480, H = 150, l = lienzo(W, H), tinta = [21, 24, 29, 255];
  let px = null;
  for (let t = 0; t <= 1; t += 0.0008) {
    const x = 30 + t * 400, y = 80 + Math.sin(t * 22 + semilla) * 28 * Math.sin(t * 3.1) + Math.cos(t * 51) * 9 - t * 15;
    if (px) for (let k = 0; k <= 1; k += 0.25) l.punto(px[0] + (x - px[0]) * k, px[1] + (y - px[1]) * k, 2, tinta);
    px = [x, y];
  }
  for (let x = 60; x < 330; x++) l.punto(x, 120 + Math.sin(x / 40) * 3, 1, tinta); // rúbrica
  return l.png();
}

/** Tarjeta tipo documento (cédula o licencia) para mostrar miniaturas en la demo. */
export function documentoDemo(tipo = 'cedula_frente') {
  const W = 640, H = 404, azul = tipo.startsWith('licencia') ? [222, 243, 240, 255] : [220, 230, 246, 255];
  const l = lienzo(W, H, azul);
  const oscuro = [58, 65, 76, 255], medio = [150, 162, 180, 255], claro = [190, 200, 214, 255];
  l.rect(0, 0, W, 54, tipo.startsWith('licencia') ? [15, 95, 88, 255] : [30, 58, 138, 255]);
  if (tipo.endsWith('reverso')) {
    l.rect(0, 80, W, 60, oscuro);
    for (let i = 0; i < 3; i++) l.rect(40, 200 + i * 44, 560, 18, claro);
  } else {
    l.rect(36, 90, 170, 220, medio);
    l.punto(121, 160, 40, claro); l.rect(66, 215, 110, 95, claro);
    for (let i = 0; i < 5; i++) l.rect(236, 100 + i * 46, i % 2 ? 260 : 340, 16, i === 0 ? oscuro : claro);
    l.rect(36, 340, 570, 14, claro);
  }
  return l.png();
}
