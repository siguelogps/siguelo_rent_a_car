// Común a las pantallas de pagos, liquidaciones y facturación: textos, chips y selector de reserva.
import { api, esc, clp, pat, fecha } from '/comun.js';

export const CONCEPTOS = { arriendo: 'Arriendo', garantia: 'Garantía', liquidacion: 'Liquidación', reembolso: 'Reembolso', multa: 'Multa', tag: 'TAG', incidente: 'Incidente' };
export const METODOS = { webpay: 'Webpay Plus', mercadopago: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', pos: 'POS', otro: 'Otro' };
const ESTADOS = {
  pendiente: ['Pendiente', 'aviso'], autorizado: ['Autorizado', 'info'], retenido: ['Retenida', 'teal'], capturado: ['Capturada', 'des'], liberado: ['Liberada', 'ok'],
  pagado: ['Pagado', 'ok'], rechazado: ['Rechazado', 'error'], anulado: ['Anulado', 'sin'], reembolsado: ['Reembolsado', 'des'], simulado: ['Simulado', 'pg-sim']
};
export const ETAPAS = ['solicitada', 'retenida', 'capturada', 'liberada'];
export const ETAPA_TXT = { solicitada: 'Solicitada', retenida: 'Retenida', capturada: 'Captura parcial', liberada: 'Saldo liberado' };

export const metodo = (m) => `<span class="pg-metodo ${esc(m)}"><i></i>${esc(METODOS[m] || m)}</span>`;
export function chipPago(p) {
  if (p.concepto === 'garantia' && p.etapa) {
    const e = { solicitada: ['Solicitada', 'aviso'], retenida: ['Retenida', 'teal'], capturada: [p.monto_capturado < p.monto ? 'Capturada parcial' : 'Capturada', 'des'], liberada: ['Liberada', 'ok'] }[p.etapa] || ESTADOS[p.estado] || [p.estado, ''];
    return `<span class="chip ${e[1]}">${esc(e[0])}</span>${p.simulado ? ' <span class="chip pg-sim" title="Marcha blanca: no se llamó al proveedor">Simulado</span>' : ''}`;
  }
  if (p.estado === 'simulado') return '<span class="chip pg-sim" title="Marcha blanca: no se llamó al proveedor">Simulado</span>';
  const [t, c] = ESTADOS[p.estado] || [p.estado, ''];
  return `<span class="chip ${c}">${esc(t)}</span>`;
}

// Barra de etapas de la garantía (tarjeta oscura rc-gar)
export function barraGarantia(etapa) {
  const k = ETAPAS.indexOf(etapa);
  return `<div class="rc-gar-barra">${ETAPAS.map((_, i) => `<i class="${i <= k ? 'on' : ''}"></i>`).join('')}</div>
    <div class="rc-gar-pasos">${ETAPAS.map((e, i) => (i === k ? `<b>${ETAPA_TXT[e]}</b>` : `<span>${ETAPA_TXT[e]}</span>`)).join('')}</div>`;
}
export const proveedor = (m) => (m === 'mercadopago' ? '<span class="rc-proveedor"><i style="background:#00B1EA"></i>Mercado Pago</span>'
  : m === 'webpay' ? '<span class="rc-proveedor"><i style="background:#E4002B"></i>Webpay Plus</span>' : `<span class="rc-proveedor"><i style="background:#9AA1AD"></i>${esc(METODOS[m] || m)}</span>`);

export function diasRestantes(vence) {
  if (!vence) return null;
  return Math.ceil((new Date(vence) - Date.now()) / 864e5);
}

// Selector de reserva con búsqueda. alElegir(reserva) recibe { id, folio, cliente, total, pagado, saldo, garantia, ... }
export function selectorReserva(cont, { alElegir, ruta = 'pagos/reservas', inicial = null, etiqueta = 'pagado', saldoTxt = 'Saldo', listoTxt = 'Pagado' } = {}) {
  cont.innerHTML = `<label class="pg-selector">Reserva<input class="campo" type="search" placeholder="Folio, cliente, RUT o patente…" autocomplete="off"><div class="pg-res" hidden></div></label><div class="pg-elegida" hidden></div>`;
  const inp = cont.querySelector('input'), res = cont.querySelector('.pg-res'), eleg = cont.querySelector('.pg-elegida');
  let t = null, lista = [];
  const mostrar = (r) => {
    eleg.hidden = false;
    eleg.innerHTML = `<b>${esc(r.folio)} · ${esc(r.cliente || '')}</b><button type="button" class="btn peq">Cambiar</button>
      <span>${r.patente ? pat(r.patente) : ''} ${fecha(r.inicio)} al ${fecha(r.fin)}</span><span></span>
      ${r.total != null ? `<span>Total ${clp(r.total)} · ${etiqueta} ${clp(r.pagado || 0)}</span><b class="monto">${(r.saldo ?? r.total - (r.pagado || 0)) > 0 ? `${saldoTxt} ${clp(r.saldo ?? r.total - (r.pagado || 0))}` : listoTxt}</b>` : ''}`;
    eleg.querySelector('button').onclick = () => { eleg.hidden = true; inp.closest('label').hidden = false; inp.value = ''; inp.focus(); alElegir?.(null); };
    inp.closest('label').hidden = true;
    alElegir?.(r);
  };
  const buscar = async () => {
    lista = await api(`${ruta}?q=${encodeURIComponent(inp.value.trim())}`);
    res.innerHTML = lista.map((r, i) => `<button type="button" data-k="${i}"><span><b>${esc(r.folio)}</b> · ${esc(r.cliente || '')}<small>${r.patente ? esc(r.patente) : ''} · ${fecha(r.inicio)} al ${fecha(r.fin)} · ${esc(r.estado)}</small></span><span class="monto">${clp(r.total)}</span></button>`).join('') || '<button type="button" disabled>Sin resultados</button>';
    res.hidden = false;
  };
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 200); });
  inp.addEventListener('focus', () => { if (!res.innerHTML) buscar(); else res.hidden = false; });
  inp.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 200));
  res.addEventListener('click', (e) => { const b = e.target.closest("[data-k]"); if (b) { res.hidden = true; mostrar(lista[Number(b.dataset.k)]); } });
  if (inicial) mostrar(inicial);
}
