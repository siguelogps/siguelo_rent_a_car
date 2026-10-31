// Límite liviano de solicitudes para las rutas públicas del portal (sin dependencias): ventana fija por clave.
// limitar({ nombre, max, ventanaMs, clave(req) }) → middleware Express que responde 429 al pasarse.
import { ErrorHttp } from '../auth.js';

const cubetas = new Map(); // `${nombre}|${clave}` → { n, hasta }

const limpieza = setInterval(() => {
  const ahora = Date.now();
  for (const [k, v] of cubetas) if (v.hasta < ahora) cubetas.delete(k);
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

export const reiniciarLimites = () => cubetas.clear();
