// /incidentes: lista con filtros por estado, totales y alta manual (accidente, robo, falla mecánica…).
import { iniciarPagina, api, esc, pat, clp, fecha, modal, toastError, puede, reducirImagen, leerForm } from '/comun.js';
import { ESTADOS_INCIDENTE, TIPOS_INCIDENTE } from './patio-comun.js';

await iniciarPagina({ activo: 'incidentes', titulo: 'Incidentes y daños' });
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
let estado = params.get('estado') || 'abiertos';
let t = null;

const chipIncidente = (e) => `<span class="chip inc-${esc(e)}">${esc(ESTADOS_INCIDENTE[e] || e)}</span>`;

if (puede('incidentes', 'editar')) {
  $('#acciones').innerHTML = '<button type="button" class="btn primario" id="nuevo">+ Nuevo incidente</button>';
  $('#nuevo').addEventListener('click', nuevo);
}

async function cargar() {
  const p = new URLSearchParams();
  if (estado !== 'todos') p.set('estado', estado);
  if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
  const d = await api(`incidentes?${p}`);
  const n = d.conteo;
  const abiertos = Object.entries(n).filter(([k]) => !['cerrado', 'anulado'].includes(k)).reduce((a, [, v]) => a + v, 0);
  const total = Object.values(n).reduce((a, v) => a + v, 0);
  $('#kpis').innerHTML = `
    <div class="kpi"><span>Abiertos</span><b>${abiertos}</b><small>${n.reportado || 0} sin presupuesto</small></div>
    <div class="kpi"><span>Presupuestos de reparación</span><b class="monto">${clp(d.totales.presupuestado)}</b><small>todos los incidentes vigentes</small></div>
    <div class="kpi"><span>Por cobrar a clientes</span><b class="monto">${clp(d.totales.por_cobrar)}</b><small>monto al cliente aún no pagado</small></div>
    <div class="kpi"><span>Cobrado · recupero de seguros</span><b class="monto">${clp(d.totales.cobrado)}</b><small>seguros: ${clp(d.totales.recupero)}</small></div>`;
  const filtros = [['abiertos', 'Abiertos', abiertos], ['todos', 'Todos', total], ...Object.entries(ESTADOS_INCIDENTE).map(([k, v]) => [k, v, n[k] || 0])];
  $('#filtros').innerHTML = filtros.map(([k, v, c]) => `<button type="button" class="filtro" data-e="${k}" aria-pressed="${k === estado}">${esc(v)} <span class="n">${c}</span></button>`).join('');
  $('#filtros').querySelectorAll('[data-e]').forEach((b) => b.addEventListener('click', () => { estado = b.dataset.e; history.replaceState(null, '', `?estado=${estado}`); cargar().catch(toastError); }));
  $('#tabla').innerHTML = d.incidentes.length ? `<table class="tabla"><thead><tr><th>Folio</th><th>Tipo</th><th>Vehículo</th><th>Cliente · reserva</th><th>Estado</th><th style="text-align:right">Presupuesto</th><th style="text-align:right">Al cliente</th><th>Reportado</th></tr></thead><tbody>
    ${d.incidentes.map((i) => `<tr class="clic" data-id="${i.id}">
      <td><a class="folio" href="/incidentes/${i.id}">${esc(i.folio)}</a></td>
      <td>${esc(TIPOS_INCIDENTE[i.tipo] || i.tipo)}<br><small class="muted">${esc((i.descripcion || '').slice(0, 60))}${(i.descripcion || '').length > 60 ? '…' : ''}</small></td>
      <td>${pat(i.patente)}<br><small class="muted">${esc([i.marca, i.modelo].filter(Boolean).join(' '))}</small></td>
      <td>${esc(i.cliente_nombre || '—')}${i.reserva_folio ? `<br><small class="folio">${esc(i.reserva_folio)}${i.contrato_folio ? ` · ${esc(i.contrato_folio)}` : ''}</small>` : ''}</td>
      <td>${chipIncidente(i.estado)}</td>
      <td class="monto" style="text-align:right">${i.presupuesto != null ? clp(i.presupuesto) : '—'}</td>
      <td class="monto" style="text-align:right">${i.monto_cliente != null ? clp(i.monto_cliente) : '—'}</td>
      <td>${fecha(i.creado_en)}</td></tr>`).join('')}
  </tbody></table>` : '<div class="rc-vacio">No hay incidentes con este filtro.</div>';
  $('#tabla').querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.href = `/incidentes/${tr.dataset.id}`; }));
}

async function nuevo() {
  let foto = null;
  const r = await modal({
    titulo: 'Nuevo incidente',
    html: `<div class="campos" style="grid-template-columns:1fr 1fr">
      <label>Tipo<select class="campo" name="tipo">${Object.entries(TIPOS_INCIDENTE).map(([k, v]) => `<option value="${k}"${k === 'accidente' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Patente<input class="campo mono" name="patente" placeholder="PBVX-61" autocomplete="off"></label>
      <label>Reserva (opcional)<input class="campo mono" name="reserva_folio" placeholder="R-1008" autocomplete="off"></label>
      <label>Deducible (opcional)<input class="campo mono" name="deducible" inputmode="numeric" placeholder="Se toma de la reserva"></label>
      <label class="ancho">Qué pasó<textarea class="campo" name="descripcion" rows="3" placeholder="Ej: choque por alcance en Costanera Norte, parachoques trasero"></textarea></label>
      <label class="ancho">Foto (opcional)<input class="campo" type="file" accept="image/*" name="foto_archivo"></label>
      <p class="peq muted ancho">Si indicas la reserva, el incidente queda ligado al cliente, al contrato y al deducible pactado.</p>
    </div>`,
    alAbrir: (c) => c.querySelector('[name=foto_archivo]').addEventListener('change', async (e) => { const f = e.target.files[0]; foto = f ? await reducirImagen(f) : null; }),
    botones: [{ texto: 'Cancelar' }, { texto: 'Crear incidente', clase: 'primario', accion: async (c) => {
      const b = leerForm(c);
      delete b.foto_archivo;
      return api('incidentes', { body: { ...b, deducible: b.deducible ? b.deducible.replace(/\D/g, '') : null, dataUrl: foto } });
    } }]
  });
  if (r?.id) location.href = `/incidentes/${r.id}`;
}

$('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => cargar().catch(toastError), 250); });
await cargar().catch(toastError);
