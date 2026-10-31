// Límites de solicitudes e intentos fallidos, sin dependencias y en memoria (por proceso).
//
//   limitar({ nombre, max, ventanaMs, clave(req) }) → middleware Express: ventana fija por clave, 429 al pasarse.
//     Para las rutas públicas (portal, firma, verificación, invitaciones), donde el enlace es la credencial.
//
//   intentosFallidos({ nombre, max, ventanaMs, bloqueoMs, maxBloqueoMs }) → { revisar(clave), fallo(clave), exito(clave) }
//     Para fuerza bruta de claves (ingreso, «Mi clave», eliminar cuenta, invitaciones): tras `max` fallos en la ventana se
//     bloquea `bloqueoMs`, y cada bloqueo seguido dura el doble (hasta maxBloqueoMs). Un acierto limpia la cuenta.
//     revisar() lanza 429 con Retry-After; no cuenta como intento.
//
// 31-oct (revisión de seguridad): antes el ingreso guardaba los fallos en un Map que nunca se vaciaba (crecía con cada
// correo e IP distintos) y, pasado el bloqueo, volvía a cero sin endurecerse. Ahora todo se limpia solo y escala.
import { ErrorHttp } from './auth.js';

const cubetas = new Map(); // `${nombre}|${clave}` → { n, hasta }
const fallos = new Map();  // `${nombre}|${clave}` → { n, ventanaHasta, bloqueos, bloqueadoHasta, tocado }

const limpieza = setInterval(() => {
  const ahora = Date.now();
  for (const [k, v] of cubetas) if (v.hasta < ahora) cubetas.delete(k);
  for (const [k, v] of fallos) if (v.bloqueadoHasta < ahora && v.ventanaHasta < ahora && ahora - v.tocado > 3600e3) fallos.delete(k);
}, 60e3);
limpieza.unref?.();

export function limitar({ nombre, max, ventanaMs, clave = (req) => req.ip }) {
  return (req, _res, next) => {
    if (process.env.PORTAL_SIN_LIMITE === '1') return next();
    const k = `${nombre}|${clave(req)}`;
    const ahora = Date.now();
    let c = cubetas.get(k);
    if (!c || c.hasta < ahora) { c = { n: 0, hasta: ahora + ventanaMs }; cubetas.set(k, c); }
    c.n += 1;
    if (c.n > max) throw new ErrorHttp(429, 'Hiciste demasiadas solicitudes seguidas. Espera un momento e inténtalo de nuevo.');
    next();
  };
}

const segundos = (ms) => Math.max(1, Math.ceil(ms / 1000));
const espera = (ms) => (ms >= 3600e3 ? `${Math.ceil(ms / 3600e3)} h` : `${Math.max(1, Math.ceil(ms / 60e3))} min`);

export function intentosFallidos({ nombre, max = 10, ventanaMs = 15 * 60e3, bloqueoMs = 10 * 60e3, maxBloqueoMs = 4 * 3600e3, mensaje = null }) {
  const leer = (clave) => {
    const k = `${nombre}|${clave}`;
    let f = fallos.get(k);
    if (!f) { f = { n: 0, ventanaHasta: 0, bloqueos: 0, bloqueadoHasta: 0, tocado: 0 }; fallos.set(k, f); }
    return f;
  };
  return {
    // Lanza 429 si la clave está bloqueada. Llamar antes de verificar la clave.
    revisar(clave) {
      const f = leer(clave);
      const resta = f.bloqueadoHasta - Date.now();
      if (resta > 0) throw new ErrorHttp(429, mensaje || `Demasiados intentos. Espera ${espera(resta)} y vuelve a intentarlo.`, { reintentar_en: segundos(resta), retryAfter: segundos(resta) });
    },
    // Anota un fallo; al llegar a `max` dentro de la ventana, bloquea (cada vez por más tiempo).
    fallo(clave) {
      const f = leer(clave);
      const ahora = Date.now();
      if (f.ventanaHasta < ahora) { f.n = 0; f.ventanaHasta = ahora + ventanaMs; }
      f.n += 1; f.tocado = ahora;
      if (f.n >= max) {
        f.bloqueos += 1; f.n = 0;
        f.bloqueadoHasta = ahora + Math.min(maxBloqueoMs, bloqueoMs * 2 ** (f.bloqueos - 1));
      }
    },
    exito(clave) { fallos.delete(`${nombre}|${clave}`); },
    bloqueado(clave) { return leer(clave).bloqueadoHasta > Date.now(); }
  };
}

export const reiniciarLimites = () => { cubetas.clear(); fallos.clear(); };
