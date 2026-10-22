// Ticket en Síguelo Gestión (CRM) para cada «Solicitar a Síguelo». Contrato acordado (espec. Backoffice, 22-oct):
//   POST <CRM>/api/integracion/solicitudes
//   Cabeceras: X-Siguelo-Herramienta: onrent · X-Siguelo-Firma: sha256=<HMAC-SHA256 del cuerpo tal cual, en hex>
//   Cuerpo: { id, herramienta, empresa: { id, nombre, rut }, tipo, detalle, solicitante: { nombre, correo }, url_backoffice }
// El CRM busca al cliente por RUT (si no está, queda «sin vincular») y es idempotente por (herramienta, id): reintentar el
// mismo pedido no duplica el ticket. El secreto se genera en el CRM y se pega en Conexiones generales (cifrado).
import crypto from 'node:crypto';
import { leerGeneral } from './conexiones.js';

export const HERRAMIENTA = 'onrent';
let fetchCrm = (...a) => globalThis.fetch(...a);
/** Solo para las pruebas: reemplaza fetch (CRM simulado). */
export const _usarFetchCrm = (f) => { fetchCrm = f || ((...a) => globalThis.fetch(...a)); };

export const firmar = (secreto, cuerpo) => `sha256=${crypto.createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;

// → { ok, ticket, estado, motivo }
export async function enviarAlCrm(datos) {
  const { config: c, lista } = await leerGeneral('crm');
  if (!lista) return { ok: false, motivo: 'El CRM no está configurado (Conexiones generales)' };
  const cuerpo = JSON.stringify({ ...datos, herramienta: HERRAMIENTA });
  try {
    const r = await fetchCrm(`${String(c.url).replace(/\/+$/, '')}/api/integracion/solicitudes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Siguelo-Herramienta': HERRAMIENTA, 'X-Siguelo-Firma': firmar(c.secreto, cuerpo) },
      body: cuerpo, signal: AbortSignal.timeout(15000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, motivo: `El CRM respondió ${r.status}${j?.error ? `: ${String(j.error).slice(0, 200)}` : ''}` };
    return { ok: true, ticket: j.ticket != null ? String(j.ticket) : null, estado: j.estado || null };
  } catch (e) {
    return { ok: false, motivo: `No se pudo llegar al CRM: ${String(e.message || e).slice(0, 200)}` };
  }
}
