// /patio: tareas del día de la sucursal (entregas, devoluciones y recibidas por liquidar). Pensado para celular.
import { iniciarPagina, api, esc, pat, fecha, hora, chipEstado, toastError } from '/comun.js';

const yo = await iniciarPagina({ activo: 'patio', titulo: 'Entregas y devoluciones' });
const $ = (s) => document.querySelector(s);
const leer = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const selSuc = $('#sucursal');
selSuc.innerHTML = `<option value="">Todas las sucursales</option>${yo.sucursales.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join('')}`;
selSuc.value = leer('pt_sucursal', yo.usuario.sucursal_id ? String(yo.usuario.sucursal_id) : '');
const tabUrl = new URLSearchParams(location.search).get('tab');
let tab = tabUrl || leer('pt_tab', 'entregas');
let datos = null, t = null;

const AYUDA = {
  entregas: 'Reservas confirmadas que se retiran hoy o mañana (y las que ya debieron salir).',
  devoluciones: 'Arriendos en curso que vuelven hoy o están atrasados.',
  recientes: 'Vehículos recibidos en los últimos 10 días: revisa la comparación y pasa a liquidación.'
};

const diaChile = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(d));
function relativo(d) {
  const dif = Math.round((Date.parse(diaChile(d)) - Date.parse(diaChile(new Date()))) / 864e5);
  return dif === 0 ? 'Hoy' : dif === 1 ? 'Mañana' : dif === -1 ? 'Ayer' : fecha(d);
}
function atraso(d) {
  const m = Math.round((Date.now() - new Date(d)) / 6e4);
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

function tarjeta(x, tipo) {
  const cuando = tipo === 'entregas' ? x.inicio : tipo === 'devoluciones' ? x.fin : x.devolucion_real;
  const borrador = x.inspeccion_estado === 'borrador';
  let estado;
  if (tipo === 'devoluciones' && x.atrasada) estado = chipEstado('atrasada', `Atrasada ${atraso(x.fin)}`);
  else if (tipo === 'entregas' && x.vencida) estado = chipEstado('atrasada', 'Debió salir');
  else if (tipo === 'recientes') estado = chipEstado(x.estado, x.estado === 'devuelta' ? 'Por liquidar' : 'Cerrada');
  else estado = chipEstado(x.estado);
  const lugar = tipo === 'entregas' ? x.sucursal_retiro : x.sucursal_devolucion;
  return `<a class="pt-tarea${x.atrasada && tipo === 'devoluciones' ? ' atrasada' : ''}${borrador ? ' borrador' : ''}" href="/patio/${x.id}${tipo === 'recientes' ? '?vista=comparacion' : ''}">
    <div class="t1">${pat(x.patente)}${estado}<span class="folio">${esc(x.folio)}</span></div>
    <div><div class="cli">${esc(x.cliente || 'Sin cliente')}</div><div class="veh">${esc([x.marca, x.modelo, x.color].filter(Boolean).join(' · '))}</div></div>
    <div class="t2"><span class="hora">${hora(cuando)}</span><span>${relativo(cuando)} · ${tipo === 'entregas' ? 'retiro' : 'devolución'} en ${esc(lugar || '—')}</span></div>
    ${borrador ? `<div class="pt-avance"><i><b style="width:${Math.round((x.fotos / datos.total_fotos) * 100)}%"></b></i>${tipo === 'entregas' ? 'Entrega' : 'Devolución'} empezada · ${x.fotos}/${datos.total_fotos} fotos · Retomar</div>` : ''}
    <span class="ir" aria-hidden="true">›</span>
  </a>`;
}

function pintar() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  $('#ayuda').textContent = $('#q').value.trim() ? 'Resultados de la búsqueda (todas las fechas).' : AYUDA[tab];
  if (!datos) return;
  for (const k of ['entregas', 'devoluciones', 'recientes']) $(`#n-${k}`).textContent = datos[k].length;
  const filas = datos[tab];
  $('#lista').innerHTML = filas.length ? filas.map((x) => tarjeta(x, tab)).join('')
    : `<div class="tarjeta rc-vacio">${tab === 'entregas' ? 'No hay entregas pendientes' : tab === 'devoluciones' ? 'No hay devoluciones pendientes' : 'No hay vehículos recibidos recientemente'}${selSuc.value ? ' en esta sucursal' : ''}.</div>`;
}

async function cargar() {
  const p = new URLSearchParams();
  if (selSuc.value) p.set('sucursal_id', selSuc.value);
  if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
  try { datos = await api(`patio/tareas?${p}`); pintar(); } catch (e) { toastError(e); }
}

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; guardar('pt_tab', tab); pintar(); }));
selSuc.addEventListener('change', () => { guardar('pt_sucursal', selSuc.value); cargar(); });
$('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(cargar, 250); });
await cargar();
