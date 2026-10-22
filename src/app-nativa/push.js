// Avisos push a la app nativa Síguelo On Rent (Firebase Cloud Messaging, API HTTP v1). Opcional: sin la cuenta de
// servicio no se manda nada y todo lo demás funciona igual (la app consulta al abrirse).
//   · Es una sola cuenta para todas las empresas (la app es una sola en Play). La pega un superadmin en
//     Backoffice › Apps con marca › «App Síguelo On Rent». Se guarda cifrada (tabla sistema) y nunca vuelve al navegador.
//   · El permiso de Google se pide con un JWT RS256 firmado aquí (sin bibliotecas) y se guarda en memoria una hora.
//   · Los tokens que Firebase ya no reconoce se borran de la tabla dispositivos.
// Mismo método que siguelo-checklist (src/push.js).
import crypto from 'node:crypto';
import { q, uno } from '../db.js';
import { cifrar, descifrar } from '../cifrado.js';
import { puede } from '../permisos.js';

const CLAVE = 'app_push_cuenta';
const ALCANCE = 'https://www.googleapis.com/auth/firebase.messaging';
const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
let acceso = null; // { token, vence }
let fetchPush = (...a) => globalThis.fetch(...a);
/** Solo para las pruebas: reemplaza fetch para no llamar a Google. */
export const _usarFetch = (f) => { fetchPush = f; acceso = null; };

const err = (m, estado = 400) => Object.assign(new Error(m), { estado });

async function cuenta() {
  const f = await uno('SELECT valor FROM sistema WHERE clave = $1', [CLAVE]);
  if (!f?.valor) return null;
  try { return descifrar(f.valor); } catch { return null; }
}

/** Lo que ve el backoffice: si está y de qué proyecto. Nunca la clave. */
export async function configuracionPush() {
  const c = await cuenta();
  return c ? { configurado: true, proyecto: c.project_id, cuenta: c.client_email } : { configurado: false };
}

export async function guardarCuentaPush(texto) {
  let c;
  try { c = typeof texto === 'string' ? JSON.parse(texto) : texto; } catch { throw err('Pega el contenido completo del archivo .json de la cuenta de servicio'); }
  if (c?.type !== 'service_account' || !c.project_id || !c.client_email || !String(c.private_key || '').includes('PRIVATE KEY')) throw err('Ese archivo no es una cuenta de servicio de Firebase (falta project_id, client_email o private_key)');
  try { crypto.createPrivateKey(c.private_key); } catch { throw err('La clave privada de la cuenta de servicio no es válida'); }
  const guardar = { type: c.type, project_id: c.project_id, client_email: c.client_email, private_key: c.private_key, token_uri: c.token_uri || 'https://oauth2.googleapis.com/token' };
  await q(`INSERT INTO sistema (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [CLAVE, cifrar(guardar)]);
  acceso = null;
  return configuracionPush();
}

export async function quitarCuentaPush() {
  await q('DELETE FROM sistema WHERE clave = $1', [CLAVE]);
  acceso = null;
  return configuracionPush();
}

async function tokenDeAcceso(c) {
  const t = Math.floor(Date.now() / 1000);
  if (acceso && acceso.vence > t + 60) return acceso.token;
  const cabecera = b64u({ alg: 'RS256', typ: 'JWT' });
  const cuerpo = b64u({ iss: c.client_email, scope: ALCANCE, aud: c.token_uri, iat: t, exp: t + 3600 });
  const firma = crypto.sign('RSA-SHA256', Buffer.from(`${cabecera}.${cuerpo}`), c.private_key).toString('base64url');
  const r = await fetchPush(c.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cabecera}.${cuerpo}.${firma}` }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw err(`Google no entregó el permiso para avisos push (${r.status})`, 502);
  acceso = { token: j.access_token, vence: t + Number(j.expires_in || 3600) };
  return acceso.token;
}

/** Manda un aviso a cada token. Devuelve { enviados, invalidos, configurado }. Los inválidos se borran. */
export async function enviarPush(tokens, { titulo, cuerpo, datos = {} }) {
  const c = await cuenta();
  const lista = [...new Set((tokens || []).filter(Boolean))];
  if (!c || !lista.length) return { enviados: 0, invalidos: [], configurado: !!c };
  const acc = await tokenDeAcceso(c);
  let enviados = 0;
  const invalidos = [];
  for (const token of lista) {
    const r = await fetchPush(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(c.project_id)}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${acc}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: titulo, body: cuerpo }, data: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, String(v)])), android: { priority: 'high' } } })
    }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    if (r.ok) { enviados++; continue; }
    const j = await r.json().catch(() => ({}));
    const codigo = j?.error?.details?.find?.((d) => d.errorCode)?.errorCode || j?.error?.status;
    if (r.status === 404 || codigo === 'UNREGISTERED' || codigo === 'INVALID_ARGUMENT') invalidos.push(token);
    else console.warn(`[push] no se pudo enviar (${r.status}): ${j?.error?.message || ''}`);
  }
  if (invalidos.length) await q('DELETE FROM dispositivos WHERE token = ANY($1::text[])', [invalidos]);
  return { enviados, invalidos, configurado: true };
}

/**
 * Aviso de reserva nueva a los teléfonos de la empresa cuyo rol ve Reservas. Nunca rompe la reserva: si algo falla,
 * solo queda en el registro. Es un aviso interno (al personal), no una comunicación al cliente final.
 */
export async function avisarReservaNueva(empresaId, reserva, { origen = 'counter', excluirUsuario = null } = {}) {
  try {
    const filas = await q(`SELECT d.token, u.rol FROM dispositivos d JOIN usuarios u ON u.id = d.usuario_id
       WHERE d.empresa_id = $1 AND u.activo AND ($2::bigint IS NULL OR u.id <> $2)`, [empresaId, excluirUsuario]);
    const tokens = filas.filter((f) => puede(f.rol, 'reservas', 'ver')).map((f) => f.token);
    if (!tokens.length) return { enviados: 0 };
    const d = await uno(`SELECT r.folio, r.inicio, trim(c.nombre || ' ' || coalesce(c.apellidos, '')) AS cliente, s.nombre AS sucursal
        FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN sucursales s ON s.id = r.sucursal_retiro_id WHERE r.id = $1 AND r.empresa_id = $2`, [reserva.id, empresaId]);
    if (!d) return { enviados: 0 };
    const cuando = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(d.inicio)).replace(/\//g, '-').replace(',', '');
    return await enviarPush(tokens, {
      titulo: origen === 'portal' ? `Reserva nueva del portal · ${d.folio}` : `Reserva nueva · ${d.folio}`,
      cuerpo: `${d.cliente || 'Cliente'} · retiro ${cuando}${d.sucursal ? ` en ${d.sucursal}` : ''}`,
      datos: { tipo: 'reserva', reserva_id: reserva.id }
    });
  } catch (e) {
    console.warn('[push] aviso de reserva nueva:', e.message);
    return { enviados: 0, error: e.message };
  }
}
