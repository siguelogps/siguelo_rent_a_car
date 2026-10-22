// Entrada desde el menú Apps de la plataforma de rastreo (Síguelo Pro / Síguelo Lite), con el mismo estándar que
// Síguelo OS (siguelo-dashboard: services/appWialon.js y docs/plan-wialon-app-202.md). Este archivo es igual en todas
// las herramientas de la familia; lo propio de cada una (qué empresa, qué usuario, qué sesión) va en su ruta.
//
// La plataforma abre la URL registrada en una pestaña nueva con ?authHash=…&baseUrl=…&lang=…&user=…
// La página de entrada (public/app-plataforma.html) limpia la barra de direcciones al tiro y manda authHash + baseUrl
// por POST. Acá:
//
//   1. `baseUrl` NO se usa para llamar a nadie. Viene en la URL y cualquiera la puede cambiar: si la usáramos, el
//      servidor llamaría a donde le digan (SSRF). Solo se compara con la lista cerrada de cuentas que conocemos, y el
//      canje va a NUESTRA dirección de la API. Si no calza: 400.
//   2. Nunca `sid`: con sid la sesión del cliente viaja en la URL (historial, registros, Referer). El authHash sirve
//      una sola vez y se canjea en el momento con core/use_auth_hash.
//   3. Quién es el cliente lo dice la plataforma al canjear (usuario, id y cuenta `bact`), nunca un parámetro de la
//      URL: `user` y `lang` solo se muestran mientras carga.
//   4. La sesión del hash se cierra siempre (core/logout), salga bien o mal. El hash y esa sesión no se guardan en
//      ninguna parte ni se escriben en los registros.
//
// En pantalla nunca se nombra al proveedor: «plataforma de rastreo».
import crypto from 'node:crypto';

/** La API a la que llamamos. Síguelo Pro y Síguelo Lite comparten la misma. */
export const API_PLATAFORMA = 'https://hst-api.wialon.com/wialon/ajax.html';

/**
 * Las cuentas conocidas: con qué hosts puede llegar `baseUrl` y adónde vuelve el cliente al cerrar sesión.
 * `hst-api.wialon.com` es de las dos (comparten la API): ahí la cuenta real la dice la empresa encontrada.
 */
export const CUENTAS = {
  pro: { id: 'pro', nombre: 'Síguelo Pro', hosts: ['hst-api.wialon.com', 'plataforma.siguelogps.com', 'hosting.wialon.com'], volver: 'https://plataforma.siguelogps.com' },
  lite: { id: 'lite', nombre: 'Síguelo Lite', hosts: ['lite.wialon.com', 'lite.siguelogps.com'], volver: 'https://lite.wialon.com' },
};
const HOST_COMPARTIDO = 'hst-api.wialon.com';
/** Adónde se puede volver al cerrar sesión: solo estas direcciones. */
export const VOLVER_PERMITIDOS = Object.values(CUENTAS).map((c) => c.volver);

const TIEMPO_ESPERA_MS = 15_000;

export class ErrorApp extends Error {
  constructor(motivo, mensaje, status) { super(mensaje); this.motivo = motivo; this.status = status; }
}

/** Los mensajes que ve el cliente. Sin códigos y sin nombrar al proveedor. */
export function mensajes(herramienta) {
  return {
    parametros: `El enlace llegó incompleto. Vuelve a abrir ${herramienta} desde el menú Apps de tu plataforma de rastreo.`,
    entrada_desconocida: `No pudimos confirmar desde dónde llegaste. Vuelve a abrir ${herramienta} desde el menú Apps de tu plataforma de rastreo.`,
    acceso_vencido: `El acceso venció (dura unos minutos y sirve una sola vez). Vuelve a abrir ${herramienta} desde el menú Apps de tu plataforma de rastreo.`,
    sin_acceso: 'Esta herramienta aún no está activa para tu cuenta. Habla con tu ejecutivo de Síguelo.',
    no_vinculado: `Es la primera vez que entras desde tu plataforma de rastreo. Entra una vez con tu correo y clave de ${herramienta}: tu usuario quedará vinculado y desde la próxima vez entrarás directo.`,
    suspendida: `Tu acceso a ${herramienta} está pausado. Habla con tu ejecutivo de Síguelo para reactivarlo.`,
    red: 'No pudimos comunicarnos en este momento. Reintenta en unos segundos.',
  };
}

/** El host (minúsculas, sin puerto 443) de una dirección; null si no es https o trae usuario/clave/puerto raro. */
export function hostDe(url) {
  const s = String(url ?? '').trim();
  if (!s || s.length > 300) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  return u.hostname.toLowerCase();
}

/**
 * La cuenta que corresponde a un `baseUrl`, o null. Comparación EXACTA de host contra la lista cerrada: sin comodines
 * (un «*.dominio» deja entrar cualquier subdominio, incluidos los que no controlamos).
 * @returns {{id: string, nombre: string, volver: string, compartido: boolean}|null}
 */
export function cuentaPorBaseUrl(baseUrl) {
  const h = hostDe(baseUrl);
  if (!h) return null;
  for (const c of Object.values(CUENTAS)) {
    if (c.hosts.includes(h)) return { id: c.id, nombre: c.nombre, volver: c.volver, compartido: h === HOST_COMPARTIDO };
  }
  return null;
}

/** Un hash con forma de hash: letras, números, guion y guion bajo, largo razonable. */
export const hashValido = (h) => typeof h === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(h);

/** Una llamada a la API de la plataforma (POST, la sesión en el cuerpo: nunca en una URL). */
export async function llamarPlataforma(svc, params, sid = null, f = globalThis.fetch) {
  const body = new URLSearchParams({ svc, params: JSON.stringify(params || {}) });
  if (sid) body.set('sid', sid);
  const r = await f(API_PLATAFORMA, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(TIEMPO_ESPERA_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const esError = (d) => !d || (typeof d === 'object' && !Array.isArray(d) && d.error !== undefined && d.error !== 0);

/**
 * Canjea el authHash y devuelve quién es, según la plataforma:
 *   { id, nombre, cuentaId, cuentaNombre, creador, cuenta: 'pro'|'lite', volverA, compartido }
 * `conSesion(sid, quien)` (opcional) corre con la sesión del hash abierta, ANTES de cerrarla (p. ej. para crear un
 * token si la herramienta lo necesitara). Lanza ErrorApp con un motivo para la pantalla.
 */
export async function canjear({ authHash, baseUrl }, { herramienta = 'la herramienta', fetch: f = globalThis.fetch, llamar = (svc, p, sid) => llamarPlataforma(svc, p, sid, f), conSesion = null, log = console } = {}) {
  const M = mensajes(herramienta);
  if (!hashValido(authHash) || typeof baseUrl !== 'string' || !baseUrl || baseUrl.length > 300) throw new ErrorApp('parametros', M.parametros, 400);
  const cuenta = cuentaPorBaseUrl(baseUrl);
  if (!cuenta) {
    log.warn?.(`[app-plataforma] Se rechazó una entrada con una dirección desconocida: ${String(baseUrl).replace(/[^\w.:/-]/g, '').slice(0, 80)}`);
    throw new ErrorApp('entrada_desconocida', M.entrada_desconocida, 400);
  }
  let uso;
  try { uso = await llamar('core/use_auth_hash', { authHash }); } catch { throw new ErrorApp('red', M.red, 502); }
  if (esError(uso) || !uso.eid || !uso.user || uso.user.id == null) {
    log.warn?.(`[app-plataforma] Canje rechazado (código ${uso?.error ?? '—'}).`);
    throw new ErrorApp('acceso_vencido', M.acceso_vencido, 401);
  }
  const sid = uso.eid;
  try {
    let cuentaId = uso.user.bact ?? null;
    if (cuentaId == null) {
      // Algunas respuestas no traen la cuenta: se pide el usuario con sus datos de facturación (0x4).
      const it = await llamar('core/search_item', { id: uso.user.id, flags: 0x1 | 0x4 }, sid).catch(() => null);
      cuentaId = it?.item?.bact ?? null;
    }
    const quien = {
      id: String(uso.user.id),
      nombre: String(uso.user.nm ?? '').slice(0, 120),
      cuentaId: cuentaId != null ? String(cuentaId) : null,
      cuentaNombre: uso.au ? String(uso.au).slice(0, 120) : null,
      creador: uso.user.crt != null ? String(uso.user.crt) : null,
      cuenta: cuenta.id, volverA: cuenta.volver, compartido: cuenta.compartido,
    };
    if (conSesion) await conSesion(sid, quien);
    return quien;
  } finally {
    // La sesión del hash ya cumplió: se cierra siempre.
    Promise.resolve().then(() => llamar('core/logout', {}, sid)).catch(() => {});
  }
}

/** Adónde volver al cerrar sesión: la de la cuenta de la empresa si se sabe (host compartido), si no la del baseUrl. */
export function volverPara(quien, cuentaEmpresa = null) {
  const c = String(cuentaEmpresa || '').toLowerCase();
  const id = quien.compartido && (c === 'lite' || c === 'pro' || c === 'hosting') ? (c === 'lite' ? 'lite' : 'pro') : quien.cuenta;
  return (CUENTAS[id] || CUENTAS.pro).volver;
}

// ── Cookies ──
// `volver_plataforma`: marca que la sesión se abrió desde el menú Apps (la franja y el «cerrar sesión» la leen). No es
// secreta: lleva una de las direcciones de VOLVER_PERMITIDOS y nada más.
// `vinculo_plataforma`: el usuario de la plataforma que todavía no está vinculado a un usuario de la herramienta. Firmada
// (HMAC) y HttpOnly, dura 15 minutos: si en ese rato la persona entra con su correo y clave, en SU empresa, se vinculan.
export const COOKIE_VOLVER = 'volver_plataforma';
export const COOKIE_VINCULO = 'vinculo_plataforma';
const VINCULO_S = 15 * 60;

export function cookieVolver(url, { seguro = true, maxAge = 30 * 24 * 3600 } = {}) {
  if (!VOLVER_PERMITIDOS.includes(url)) return cookieBorrar(COOKIE_VOLVER, { seguro, httpOnly: false });
  return `${COOKIE_VOLVER}=${encodeURIComponent(url)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${seguro ? '; Secure' : ''}`;
}
export function cookieBorrar(nombre, { seguro = true, httpOnly = nombre === COOKIE_VINCULO } = {}) {
  return `${nombre}=; Path=/; SameSite=Lax; Max-Age=0${httpOnly ? '; HttpOnly' : ''}${seguro ? '; Secure' : ''}`;
}

const firmar = (texto, secreto) => crypto.createHmac('sha256', String(secreto)).update(texto).digest('base64url');

/** Cookie firmada con el usuario de la plataforma por vincular. `datos`: { empresa, gpsId, nombre, volver }. */
export function cookieVinculo(datos, secreto, { seguro = true, ahora = Date.now() } = {}) {
  const v = VOLVER_PERMITIDOS.includes(datos.volver) ? datos.volver : null;
  const cuerpo = Buffer.from(JSON.stringify({ e: String(datos.empresa), g: String(datos.gpsId), n: String(datos.nombre || '').slice(0, 80), v, x: Math.floor(ahora / 1000) + VINCULO_S })).toString('base64url');
  return `${COOKIE_VINCULO}=${cuerpo}.${firmar(cuerpo, secreto)}; Path=/; SameSite=Lax; HttpOnly; Max-Age=${VINCULO_S}${seguro ? '; Secure' : ''}`;
}

/** Lee la cookie de vínculo: { empresa, gpsId, nombre, volver } si la firma calza y no venció; si no, null. */
export function leerVinculo(valor, secreto, ahora = Date.now()) {
  const [cuerpo, firma] = String(valor || '').split('.');
  if (!cuerpo || !firma) return null;
  const esperada = firmar(cuerpo, secreto);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const d = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    if (!d || typeof d.x !== 'number' || d.x * 1000 < ahora) return null;
    return { empresa: String(d.e), gpsId: String(d.g), nombre: String(d.n || ''), volver: VOLVER_PERMITIDOS.includes(d.v) ? d.v : null };
  } catch { return null; }
}

/** Lee una cookie de la cabecera Cookie. */
export function leerCookie(req, nombre) {
  for (const c of String(req.headers?.cookie || '').split(';')) {
    const i = c.indexOf('=');
    if (i > 0 && c.slice(0, i).trim() === nombre) { try { return decodeURIComponent(c.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}

/** Las direcciones donde la plataforma busca el ícono: le pega «/app/logo.png» a la URL registrada tal cual. */
export function rutasIcono(paginas) {
  const r = new Set(['/app/logo.png']);
  for (const p of paginas) {
    const limpia = `/${String(p).replace(/^\/+|\/+$/g, '')}`;
    r.add(`${limpia}/app/logo.png`);
    if (limpia.endsWith('.html')) r.add(`${limpia.slice(0, -5)}/app/logo.png`);
  }
  return [...r];
}
/** Cabeceras del ícono: se muestra desde el dominio de la plataforma, así que va con CORP cross-origin. */
export const CABECERAS_ICONO = { 'Content-Type': 'image/png', 'Cross-Origin-Resource-Policy': 'cross-origin', 'Cache-Control': 'public, max-age=86400' };
