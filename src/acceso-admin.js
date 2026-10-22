// Copia de siguelo-admin/cliente/acceso-admin.js: verifica el pase de Síguelo On Board (sin secretos compartidos).
//
// El panel manda a la herramienta un POST a su «ruta de acceso» (por defecto /acceso-admin) con el campo «pase».
// La herramienta lo verifica con esto y abre su propia sesión. No hace falta ningún secreto: la firma se comprueba
// con la clave pública del panel (https://<panel>/.well-known/siguelo-admin.json).
//
//   const verificar = crearAccesoAdmin({ panel: 'https://admin.siguelogps.cl', herramienta: 'buses' });
//   app.post('/acceso-admin', express.urlencoded({ extended: false }), async (req, res) => {
//     try { const p = await verificar(req.body.pase); /* p.email, p.nombre, p.nivel: admin|usa|ve */ … }
//     catch (e) { res.status(401).send(e.message); }
//   });
import crypto from 'node:crypto';

export function crearAccesoAdmin({ panel, herramienta, fetch: f = fetch, reloj = () => Math.floor(Date.now() / 1000) }) {
  if (!panel || !herramienta) throw new Error('crearAccesoAdmin necesita panel y herramienta');
  const url = `${String(panel).replace(/\/+$/, '')}/.well-known/siguelo-admin.json`;
  let cache = { claves: null, vence: 0 };
  const usados = new Map(); // jti → vence (un pase sirve una sola vez)
  async function claves(forzar = false) {
    if (!forzar && cache.claves && cache.vence > reloj()) return cache.claves;
    const r = await f(url);
    if (!r.ok) throw new Error(`No se pudo leer la clave del panel (HTTP ${r.status})`);
    const j = await r.json();
    cache = { claves: new Map((j.claves || []).map((k) => [k.kid, k])), vence: reloj() + 300 };
    return cache.claves;
  }
  return async function verificar(pase) {
    const partes = String(pase || '').split('.');
    if (partes.length !== 3) throw new Error('Pase no válido');
    let h; let d;
    try { h = JSON.parse(Buffer.from(partes[0], 'base64url')); d = JSON.parse(Buffer.from(partes[1], 'base64url')); } catch { throw new Error('Pase no válido'); }
    if (h.alg !== 'EdDSA') throw new Error('Pase no válido');
    let jwk = (await claves()).get(h.kid);
    if (!jwk) jwk = (await claves(true)).get(h.kid);
    if (!jwk) throw new Error('Pase firmado con una clave desconocida');
    const ok = crypto.verify(null, Buffer.from(`${partes[0]}.${partes[1]}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(partes[2], 'base64url'));
    if (!ok) throw new Error('Firma del pase no válida');
    const t = reloj();
    if (d.iss !== 'siguelo-admin' || d.aud !== herramienta) throw new Error('El pase es para otra herramienta');
    if (!(d.exp >= t) || d.iat > t + 30) throw new Error('El pase venció. Vuelve a abrir la herramienta desde el panel.');
    for (const [k, v] of usados) if (v < t) usados.delete(k);
    if (usados.has(d.jti)) throw new Error('Ese pase ya se usó');
    usados.set(d.jti, d.exp);
    return { email: d.sub, nombre: d.nombre, nivel: d.nivel };
  };
}
