// Utilidades compartidas por Apps (cliente) y Apps con marca (backoffice).
import { esc } from '/comun.js';

export const ORDEN = ['borrador', 'enviada', 'en_revision', 'compilando', 'lista', 'publicada'];
export const CHIP = { borrador: '', enviada: 'info', en_revision: 'info', con_observaciones: 'aviso', compilando: 'marca', lista: 'ok', publicada: 'ok' };

export function pasos(estado, estados) {
  const i = ORDEN.indexOf(estado === 'con_observaciones' ? 'enviada' : estado);
  return `<div class="ap-pasos">${ORDEN.map((e, j) => `<span class="${estado === 'con_observaciones' && j === 1 ? 'obs' : j < i ? 'hecho' : j === i ? 'ahora' : ''}">${esc(e === 'enviada' && estado === 'con_observaciones' ? 'Con observaciones' : estados[e])}</span>`).join('')}</div>`;
}

export const mb = (n) => `${(Number(n || 0) / 1048576).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`;

export const aDataUrl = (blob) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(r.error); r.readAsDataURL(blob); });
