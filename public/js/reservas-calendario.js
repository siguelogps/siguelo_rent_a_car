// Calendario de reservas tipo Gantt (vehículos agrupados por categoría) con arrastrar y soltar (pointer events: mouse,
// lápiz y dedo). Al arrastrar se calcula la disponibilidad con los datos cargados; al soltar el servidor la vuelve a revisar
// dentro de una transacción (PATCH /api/reservas/:id/mover) y responde 409 con el folio en conflicto si el auto está tomado.
import { api, esc, clp, pat, modal, toast, toastError, isoLocal, fecha, hora, chipEstado, patente } from '/comun.js';
import { desdeLocal, sumarDias, hoyChile, diaSemana, mesCorto, claseReserva, ddmm } from '/js/reservas-util.js';

const MARGEN_MS = 36e5; // igual que el servidor: 1 h entre devolución y siguiente retiro
const OCUPAN = ['confirmada', 'en_curso'];
const ARRASTRABLES = ['cotizacion', 'confirmada'];

/** Columnas del rango según la vista: [{ ini, fin, fecha, hora, arriba, num, abajo, finde, hoy }] */
export function columnas(vista, desde) {
  const hoy = hoyChile(), cols = [];
  if (vista === 'dia') {
    const ahora = Date.now();
    for (let h = 0; h < 24; h++) {
      const ini = desdeLocal(desde, `${h}:00`).getTime();
      const fin = h < 23 ? desdeLocal(desde, `${h + 1}:00`).getTime() : desdeLocal(sumarDias(desde, 1), '00:00').getTime();
      cols.push({ ini, fin, fecha: desde, hora: h, arriba: '', num: String(h).padStart(2, '0'), abajo: 'h', finde: false, hoy: ahora >= ini && ahora < fin });
    }
    return cols;
  }
  const n = vista === 'semana' ? 7 : vista === '2semanas' ? 14 : diasDelMes(desde);
  for (let i = 0; i < n; i++) {
    const f = sumarDias(desde, i), ds = diaSemana(f);
    cols.push({ ini: desdeLocal(f, '00:00').getTime(), fin: desdeLocal(sumarDias(f, 1), '00:00').getTime(), fecha: f, arriba: ds, num: f.slice(8), abajo: mesCorto(f), finde: /^(sáb|dom)/.test(ds), hoy: f === hoy });
  }
  return cols;
}
const diasDelMes = (f) => { const [a, m] = f.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };

/** Posición fraccional (en columnas) de un instante. */
function pos(cols, t) {
  const ms = new Date(t).getTime();
  if (ms <= cols[0].ini) return 0;
  if (ms >= cols[cols.length - 1].fin) return cols.length;
  const i = cols.findIndex((c) => ms >= c.ini && ms < c.fin);
  return i + (ms - cols[i].ini) / (cols[i].fin - cols[i].ini);
}

export function crearCalendario(raiz, { alAbrirNueva, alCambiar }) {
  let datos = null, cols = [], vista = '2semanas';

  function pintar(d, c, v) {
    datos = d; cols = c; vista = v;
    const N = cols.length;
    raiz.style.setProperty('--dias', N);
    raiz.classList.toggle('rs-vista-dia', vista === 'dia');
    raiz.classList.toggle('rs-vista-mes', vista === 'mes');
    const verAhora = Date.now() > cols[0].ini && Date.now() < cols[N - 1].fin;
    const clsCol = (x) => (x.hoy ? 'hoy' : x.finde ? 'finde' : '');
    const fondo = cols.map((x) => `<i class="${clsCol(x)}"></i>`).join('');
    const grupos = [];
    for (const veh of datos.vehiculos) {
      const nombre = veh.categoria || 'Sin categoría';
      let g = grupos.find((x) => x.nombre === nombre);
      if (!g) grupos.push(g = { nombre, autos: [] });
      g.autos.push(veh);
    }
    const barra = (r) => {
      const a = pos(cols, r.inicio), b = pos(cols, r.fin);
      if (b <= 0 || a >= N) return '';
      const t = `${r.folio} · ${r.cliente || ''}\n${fecha(r.inicio)} ${hora(r.inicio)} → ${fecha(r.fin)} ${hora(r.fin)}${r.sucursal_retiro ? `\n${r.sucursal_retiro} → ${r.sucursal_devolucion}` : ''}`;
      return `<div class="rc-barra ${claseReserva(r)}${ARRASTRABLES.includes(r.estado) && r.vehiculo_id ? ' rs-movible' : ''}" data-id="${r.id}" style="--ini:${a.toFixed(4)};--dur:${Math.max(0.15, b - a).toFixed(4)}" title="${esc(t)}" tabindex="0" role="link" aria-label="${esc(`${r.folio} ${r.cliente || ''}`)}"><b>${esc(r.cliente || 'Sin cliente')}</b><small>${esc(r.folio)}</small></div>`;
    };
    const bloqueo = (b) => {
      const a = pos(cols, b.inicio), e = pos(cols, b.fin);
      if (e <= 0 || a >= N) return '';
      return `<div class="rc-barra mantencion" style="--ini:${a.toFixed(4)};--dur:${Math.max(0.15, e - a).toFixed(4)}" title="${esc(`${b.motivo}\n${fecha(b.inicio)} → ${fecha(b.fin)}`)}"><b>${esc(b.motivo)}</b>${b.orden_folio ? `<small>${esc(b.orden_folio)}</small>` : ''}</div>`;
    };
    const lineaAhora = verAhora ? `<span class="rc-ahora" style="--x:${pos(cols, Date.now()).toFixed(4)}"></span>` : '';
    const fila = (veh) => {
      const res = datos.reservas.filter((r) => Number(r.vehiculo_id) === Number(veh.id));
      const blq = datos.bloqueos.filter((b) => Number(b.vehiculo_id) === Number(veh.id));
      const chip = (veh.atrasado ? chipEstado('atrasada', 'Atrasado') : chipEstado(veh.estado)).replace('<span class="chip', '<span style="align-self:flex-start;margin-top:2px" class="chip');
      return `<div class="rc-gantt-fila" data-vehiculo="${veh.id}"><div class="rc-gantt-izq"><a href="/vehiculos/${veh.id}" class="rs-pat-link">${pat(veh.patente)}</a><div class="t"><small>${esc(`${veh.marca || ''} ${veh.modelo || ''} ${veh.anio || ''}`.trim())}</small>${chip}</div></div>
        <div class="rc-pista" data-vehiculo="${veh.id}">${fondo}${lineaAhora}${blq.map(bloqueo).join('')}${res.map(barra).join('')}</div></div>`;
    };
    const sinVeh = datos.reservas.filter((r) => !r.vehiculo_id);
    raiz.innerHTML = `<div class="rc-gantt-cab"><div class="rc-gantt-izq">Vehículo</div><div class="rc-dias">${cols.map((x) => `<div class="rc-dia ${clsCol(x)}">${esc(x.arriba)}<b>${esc(x.num)}</b>${esc(x.abajo)}</div>`).join('')}</div></div>
      ${grupos.map((g) => `<div class="rc-gantt-grupo">${esc(g.nombre)} <span>${g.autos.length}</span></div>${g.autos.map(fila).join('')}`).join('')}
      ${sinVeh.length ? `<div class="rc-gantt-grupo">Sin vehículo asignado <span>${sinVeh.length}</span></div>${sinVeh.map((r) => `<div class="rc-gantt-fila"><div class="rc-gantt-izq"><div class="t"><b class="peq">${esc(r.categoria || '')}</b><small>asignar en la ficha</small></div></div><div class="rc-pista">${fondo}${lineaAhora}${barra(r)}</div></div>`).join('')}` : ''}
      ${!datos.vehiculos.length && !sinVeh.length ? '<p class="rc-vacio">No hay vehículos con estos filtros.</p>' : ''}`;
  }

  // ── Disponibilidad calculada en el navegador (el servidor la confirma al soltar) ──
  function conflictoLocal(vehiculoId, ini, fin, excluirId) {
    const r = datos.reservas.find((x) => Number(x.vehiculo_id) === Number(vehiculoId) && Number(x.id) !== Number(excluirId) && OCUPAN.includes(x.estado)
      && new Date(x.inicio).getTime() < fin + MARGEN_MS && new Date(x.fin).getTime() > ini - MARGEN_MS);
    if (r) return { txt: `ocupado por ${r.folio}` };
    const b = datos.bloqueos.find((x) => Number(x.vehiculo_id) === Number(vehiculoId) && new Date(x.inicio).getTime() < fin && new Date(x.fin).getTime() > ini);
    if (b) return { txt: `bloqueado: ${b.motivo}` };
    const v = datos.vehiculos.find((x) => Number(x.id) === Number(vehiculoId));
    if (v?.estado === 'fuera_servicio') return { txt: 'fuera de servicio' };
    return null;
  }

  // Desplaza un instante n columnas: días de calendario (manteniendo la hora local) u horas en la vista diaria.
  function desplazar(t, n) {
    if (!n) return new Date(t);
    if (vista === 'dia') return new Date(new Date(t).getTime() + n * 36e5);
    const l = isoLocal(t);
    return desdeLocal(sumarDias(l.fecha, n), l.hora);
  }

  // ── Arrastrar y soltar ──
  let arr = null, ultimoArrastre = 0;
  raiz.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.rc-barra[data-id]');
    if (!el || e.button > 0) return;
    const r = datos.reservas.find((x) => String(x.id) === el.dataset.id);
    if (!r) return;
    arr = { el, r, x0: e.clientX, y0: e.clientY, activo: false, pista0: el.parentElement, puede: ARRASTRABLES.includes(r.estado) && !!r.vehiculo_id, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
  });
  raiz.addEventListener('pointermove', (e) => {
    if (!arr || e.pointerId !== arr.id) return;
    const dx = e.clientX - arr.x0, dy = e.clientY - arr.y0;
    if (!arr.activo) {
      if (Math.hypot(dx, dy) < 6 || !arr.puede) return;
      arr.activo = true;
      arr.clon = arr.el.cloneNode(true);
      arr.clon.classList.add('arrastrando');
      arr.clon.removeAttribute('title');
      arr.el.classList.add('fantasma');
      arr.tip = document.createElement('div');
      arr.tip.className = 'rc-soltar';
    }
    e.preventDefault();
    const anchoCol = arr.pista0.getBoundingClientRect().width / cols.length;
    const n = Math.round(dx / anchoCol);
    const bajo = document.elementFromPoint(e.clientX, e.clientY)?.closest('.rc-pista[data-vehiculo]');
    const pista = bajo || arr.pista || arr.pista0;
    const vehId = Number(pista.dataset.vehiculo);
    const ini = desplazar(arr.r.inicio, n), fin = desplazar(arr.r.fin, n);
    const a = pos(cols, ini), b = pos(cols, fin);
    arr.clon.style.setProperty('--ini', a.toFixed(4)); arr.clon.style.setProperty('--dur', Math.max(0.15, b - a).toFixed(4));
    if (arr.clon.parentElement !== pista) pista.appendChild(arr.clon);
    arr.pista = pista; arr.destino = { vehiculo_id: vehId, inicio: ini, fin };
    const v = datos.vehiculos.find((x) => Number(x.id) === vehId);
    const conf = conflictoLocal(vehId, ini.getTime(), fin.getTime(), arr.r.id);
    const otraCat = v && Number(v.categoria_id) !== Number(arr.r.categoria_id);
    arr.libre = !conf;
    const rango = vista === 'dia' ? `${hora(ini)} a ${hora(fin)}` : `${ddmm(ini)} al ${ddmm(fin)}`;
    arr.tip.classList.toggle('rs-soltar-mal', !!conf);
    arr.tip.innerHTML = `Soltar en <b>${esc(v ? patente(v.patente) : '')}</b> · ${rango} · ${conf ? `${esc(conf.txt)} ✕` : 'disponible ✓'}${conf ? '' : otraCat ? ` · otra categoría (${esc(v.categoria)}), se recotiza` : ' · misma tarifa'}`;
    if (arr.tip.parentElement !== pista) pista.appendChild(arr.tip);
    const w = pista.getBoundingClientRect().width, x = (b / cols.length) * w + 8, tw = arr.tip.offsetWidth;
    arr.tip.style.left = `${x + tw > w ? Math.max(0, (a / cols.length) * w - tw - 8) : x}px`;
    arr.tip.style.top = '6px';
  });
  const terminar = async (e, cancelado = false) => {
    if (!arr || (e && e.pointerId !== arr.id)) return;
    const a = arr; arr = null;
    if (!a.activo) { if (!cancelado) location.href = `/reservas/${a.r.id}`; return; }
    ultimoArrastre = Date.now();
    const limpiar = () => { a.clon?.remove(); a.tip?.remove(); a.el.classList.remove('fantasma'); };
    const d = a.destino;
    const igual = !d || (Number(d.vehiculo_id) === Number(a.r.vehiculo_id) && d.inicio.getTime() === new Date(a.r.inicio).getTime());
    if (cancelado || igual) return limpiar();
    if (!a.libre) { limpiar(); return toast('Ese vehículo no está disponible en esas fechas. No se movió la reserva.', 'error'); }
    try {
      const cuerpo = { vehiculo_id: d.vehiculo_id, inicio: d.inicio.toISOString(), fin: d.fin.toISOString() };
      const sim = await api(`reservas/${a.r.id}/mover`, { method: 'PATCH', body: { ...cuerpo, simular: true } });
      if (sim.cambia_categoria || sim.diferencia !== 0) {
        const dif = sim.diferencia;
        const ok = await modal({
          titulo: `Mover ${a.r.folio}`, html: `<p>${sim.cambia_categoria ? `El vehículo ${pat(sim.patente)} es de otra categoría.` : 'Cambia la cantidad de días.'} La reserva se vuelve a cotizar:</p>
            <table class="rc-lineas"><tr><td>Total actual</td><td>${clp(sim.total_anterior)}</td></tr><tr><td>Total nuevo</td><td>${clp(sim.total_nuevo)}</td></tr>
            <tr class="total"><td>Diferencia</td><td style="color:${dif > 0 ? 'var(--red)' : 'var(--green)'}">${dif > 0 ? '+' : ''}${clp(dif)}</td></tr></table>`,
          botones: [{ texto: 'Cancelar', valor: false }, { texto: 'Mover y recotizar', clase: 'primario', valor: true }]
        });
        if (ok !== true) return limpiar();
      }
      await api(`reservas/${a.r.id}/mover`, { method: 'PATCH', body: cuerpo });
      toast(`${a.r.folio} movida a ${ddmm(d.inicio)}${vista === 'dia' ? ` ${hora(d.inicio)}` : ''}`, 'ok');
      alCambiar?.();
    } catch (err) { limpiar(); toastError(err); alCambiar?.(); }
  };
  raiz.addEventListener('pointerup', (e) => terminar(e));
  raiz.addEventListener('pointercancel', (e) => terminar(e, true));
  raiz.addEventListener('keydown', (e) => { const b = e.target.closest('.rc-barra[data-id]'); if (b && e.key === 'Enter') location.href = `/reservas/${b.dataset.id}`; });

  // Clic en una celda vacía → nueva reserva con vehículo y fecha
  raiz.addEventListener('click', (e) => {
    if (e.target.closest('.rc-barra, a, .rc-soltar') || Date.now() - ultimoArrastre < 400) return;
    const p = e.target.closest('.rc-pista[data-vehiculo]');
    if (!p) return;
    const rc = p.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rc.left) / rc.width) * cols.length);
    const c = cols[Math.max(0, Math.min(cols.length - 1, i))];
    const v = datos.vehiculos.find((x) => String(x.id) === p.dataset.vehiculo);
    if (v.estado === 'fuera_servicio') return toast('Ese vehículo está fuera de servicio', 'error');
    alAbrirNueva?.({ vehiculo_id: v.id, categoria_id: v.categoria_id, sucursal_id: v.sucursal_id, fecha: c.fecha, hora: vista === 'dia' ? `${String(c.hora).padStart(2, '0')}:00` : '10:00', dias: vista === 'dia' ? 1 : 3 });
  });

  return { pintar };
}
