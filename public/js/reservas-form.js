// «Nueva reserva» / «Editar reserva»: cliente (búsqueda o alta en línea, bloqueo por lista negra), sucursales, fechas
// en hora de Chile, categoría, vehículo disponible, extras, conductores adicionales, código de descuento y cotización en vivo.
import { api, esc, clp, modal, toast, pat, isoLocal } from '/comun.js';
import { aIso, sumarDias, hoyChile, docEtiqueta, estadoLicencia, diasArriendo } from '/js/reservas-util.js';
import { htmlFormCliente, activarFormCliente, leerFormCliente } from '/js/reservas-clientes.js';

let OPC = null;
const opciones = async () => (OPC ||= await api('reservas/opciones'));

/**
 * abrirFormReserva({ prefill: { vehiculo_id, categoria_id, sucursal_id, fecha, hora, dias, cliente_id }, reserva }) → reserva guardada o null
 * Con «reserva» (fila completa de la ficha) edita; sin ella crea.
 */
export async function abrirFormReserva({ prefill = {}, reserva = null } = {}) {
  const o = await opciones();
  const ed = !!reserva;
  const ini = reserva ? isoLocal(reserva.inicio) : { fecha: prefill.fecha || hoyChile(), hora: prefill.hora || '10:00' };
  const fin = reserva ? isoLocal(reserva.fin) : { fecha: sumarDias(ini.fecha, prefill.dias || 3), hora: ini.hora };
  const st = {
    cliente: null, conductoresCliente: [], vehiculoId: reserva?.vehiculo_id || prefill.vehiculo_id || null,
    extras: Object.fromEntries((reserva?.extras || []).map((x) => [x.codigo, x.cantidad || 1])),
    conductores: new Set((reserva?.conductores || []).map(Number)), cot: null, seq: 0, primera: true
  };
  const sucDef = reserva?.sucursal_retiro_id || prefill.sucursal_id || o.sucursales[0]?.id;
  const catDef = reserva?.categoria_id || prefill.categoria_id || o.categorias[0]?.id;
  const optS = (sel) => o.sucursales.map((s) => `<option value="${s.id}"${Number(s.id) === Number(sel) ? ' selected' : ''}>${esc(s.nombre)}</option>`).join('');
  const html = `<div class="rs-nueva">
    <div class="rs-nueva-izq">
      <section class="rs-sec"><h3><span class="num">1</span>Cliente</h3>
        <div id="rs-cli-sel"></div>
        <div id="rs-cli-buscar" class="rs-buscar-cli">
          <input class="campo" id="rs-cli-q" placeholder="Busca por nombre, RUT, pasaporte, correo o teléfono…" autocomplete="off">
          <div class="rs-cli-res" id="rs-cli-res" hidden></div>
          <button type="button" class="btn peq" id="rs-cli-nuevo">+ Cliente nuevo</button>
        </div>
        <div id="rs-cli-form" class="rs-cli-form" hidden>${htmlFormCliente({}, { compacto: true })}
          <div class="rc-fila"><button type="button" class="btn oscuro peq" id="rs-cli-crear">Crear cliente</button><button type="button" class="btn peq" id="rs-cli-cancelar">Cancelar</button></div></div>
      </section>
      <section class="rs-sec"><h3><span class="num">2</span>Retiro y devolución</h3>
        <div class="rs-tramo-form">
          <div><b>Retiro</b><select class="campo" name="sucursal_retiro_id" aria-label="Sucursal de retiro">${optS(sucDef)}</select>
            <div class="rc-fila"><input class="campo" type="date" name="f_ini" value="${ini.fecha}" required aria-label="Fecha de retiro"><input class="campo" type="time" name="h_ini" value="${ini.hora}" step="900" required aria-label="Hora de retiro"></div></div>
          <div><b>Devolución</b><select class="campo" name="sucursal_devolucion_id" aria-label="Sucursal de devolución">${optS(reserva?.sucursal_devolucion_id || sucDef)}</select>
            <div class="rc-fila"><input class="campo" type="date" name="f_fin" value="${fin.fecha}" required aria-label="Fecha de devolución"><input class="campo" type="time" name="h_fin" value="${fin.hora}" step="900" required aria-label="Hora de devolución"></div></div>
        </div>
        <small class="muted" id="rs-dias"></small>
      </section>
      <section class="rs-sec"><h3><span class="num">3</span>Categoría y vehículo</h3>
        <select class="campo" name="categoria_id" aria-label="Categoría">${o.categorias.map((c) => `<option value="${c.id}"${Number(c.id) === Number(catDef) ? ' selected' : ''}>${esc(c.nombre)}${c.ejemplo ? ` · ${esc(c.ejemplo)}` : ''}</option>`).join('')}</select>
        <div id="rs-vehiculos" class="rs-vehiculos"></div>
      </section>
      <section class="rs-sec"><h3><span class="num">4</span>Extras y conductores adicionales</h3>
        <div class="rs-extras">${o.extras.filter((x) => x.codigo !== 'conductor_adicional').map((x) => `<label class="rs-extra"><input type="checkbox" data-extra="${esc(x.codigo)}"${st.extras[x.codigo] ? ' checked' : ''}>
          <span><b>${esc(x.nombre)}</b><small>${clp(x.precio)} ${x.cobro === 'dia' ? 'por día' : 'cargo único'}${x.tope ? ` · tope ${clp(x.tope)}` : ''}</small></span>
          ${x.cobro === 'dia' && /silla|alzador/.test(x.codigo) ? `<input class="campo rs-cant" type="number" min="1" max="4" value="${st.extras[x.codigo] || 1}" data-cant="${esc(x.codigo)}" aria-label="Cantidad">` : ''}</label>`).join('')}</div>
        <div id="rs-conductores"></div>
        <div class="campos"><label style="flex:0 1 220px">Código de descuento<input class="campo mono" name="codigo_descuento" value="${esc(reserva?.codigo_descuento || '')}" placeholder="PRIMAVERA10" autocomplete="off"></label>
          <label style="flex:1 1 260px">Notas internas<input class="campo" name="notas" value="${esc(reserva?.notas || '')}"></label></div>
      </section>
    </div>
    <aside class="rs-nueva-der"><h3>Cotización</h3><div id="rs-cot"><p class="muted peq">Completa las fechas y la categoría.</p></div><div id="rs-avisos" class="rs-avisos"></div></aside>
  </div>`;

  let cu = null;
  const leer = () => {
    const g = (n) => cu.querySelector(`[name=${n}]`)?.value;
    const extras = [...cu.querySelectorAll('[data-extra]:checked')].map((x) => ({ codigo: x.dataset.extra, cantidad: Number(cu.querySelector(`[data-cant="${x.dataset.extra}"]`)?.value) || 1 }));
    let inicio = null, finI = null;
    try { inicio = aIso(g('f_ini'), g('h_ini')); finI = aIso(g('f_fin'), g('h_fin')); } catch { /* fechas incompletas */ }
    return { cliente_id: st.cliente?.id || null, categoria_id: Number(g('categoria_id')), vehiculo_id: st.vehiculoId, sucursal_retiro_id: Number(g('sucursal_retiro_id')),
      sucursal_devolucion_id: Number(g('sucursal_devolucion_id')), inicio, fin: finI, extras, conductores: [...st.conductores], codigo_descuento: g('codigo_descuento'), notas: g('notas') };
  };

  // ── Cliente ──
  function pintarCliente(c) {
    const sel = cu.querySelector('#rs-cli-sel');
    cu.querySelector('#rs-cli-buscar').hidden = !!c;
    cu.querySelector('#rs-cli-form').hidden = true;
    if (!c) { sel.innerHTML = ''; pintarConductores(); return; }
    const d = leer();
    const lic = c.tipo === 'empresa' ? null : estadoLicencia(c.licencia_vence, d.fin);
    sel.innerHTML = `<div class="rs-cli-card${c.lista_negra ? ' negra' : ''}">
      <div><b>${esc(`${c.nombre} ${c.apellidos || ''}`)}</b><small class="mono">${docEtiqueta(c.documento_tipo, c.documento)}</small>
        <small>${esc([c.telefono, c.correo].filter(Boolean).join(' · '))}</small></div>
      <div class="rs-cli-chips">${c.lista_negra ? '<span class="chip error">Lista negra</span>' : ''}${lic ? `<span class="chip ${lic.clase}">${esc(lic.txt)}</span>` : '<span class="chip">Empresa</span>'}</div>
      <button type="button" class="btn peq" id="rs-cli-cambiar">Cambiar</button>
      ${c.lista_negra ? `<div class="aviso error" style="grid-column:1/-1"><b>No se puede reservar:</b> ${esc(c.lista_negra_motivo || 'cliente en lista negra')}</div>` : ''}
    </div>`;
    sel.querySelector('#rs-cli-cambiar').onclick = () => { st.cliente = null; st.conductoresCliente = []; st.conductores.clear(); pintarCliente(null); cotizar(); cu.querySelector('#rs-cli-q').focus(); };
    pintarConductores();
  }
  async function elegirCliente(id) {
    const f = await api(`clientes/${id}`);
    st.cliente = f.cliente; st.conductoresCliente = f.conductores;
    for (const cid of [...st.conductores]) if (!f.conductores.some((x) => Number(x.id) === cid)) st.conductores.delete(cid);
    pintarCliente(f.cliente); cotizar();
  }
  function pintarConductores() {
    const el = cu.querySelector('#rs-conductores');
    if (!st.cliente) { el.innerHTML = ''; return; }
    const d = leer();
    el.innerHTML = st.conductoresCliente.length ? `<div class="rs-conds"><span class="muted peq">Conductores adicionales registrados (se cobra el extra «Conductor adicional»)</span>${st.conductoresCliente.map((x) => {
      const lic = estadoLicencia(x.licencia_vence, d.fin);
      return `<label class="rs-extra"><input type="checkbox" data-cond="${x.id}"${st.conductores.has(Number(x.id)) ? ' checked' : ''}><span><b>${esc(x.nombre)}</b><small class="mono">${x.documento ? docEtiqueta(x.documento_tipo, x.documento) : 'sin documento'} · clase ${esc(x.licencia_clase || '—')}</small></span><span class="chip ${lic.clase}">${esc(lic.txt)}</span></label>`;
    }).join('')}</div>` : '<p class="muted peq">El cliente no tiene conductores adicionales. Se agregan en su ficha de cliente.</p>';
    el.querySelectorAll('[data-cond]').forEach((cb) => { cb.onchange = () => { cb.checked ? st.conductores.add(Number(cb.dataset.cond)) : st.conductores.delete(Number(cb.dataset.cond)); cotizar(); }; });
  }

  // ── Vehículos disponibles ──
  async function cargarVehiculos() {
    const d = leer(), el = cu.querySelector('#rs-vehiculos');
    if (!d.inicio || !d.fin || new Date(d.fin) <= new Date(d.inicio)) { el.innerHTML = '<p class="muted peq">Indica fechas válidas para ver los vehículos disponibles.</p>'; return; }
    const n = ++st.seq;
    const lista = await api(`reservas/disponibles?inicio=${encodeURIComponent(d.inicio)}&fin=${encodeURIComponent(d.fin)}&categoria_id=${d.categoria_id}${ed ? `&excluir=${reserva.id}` : ''}`).catch(() => []);
    if (n !== st.seq) return;
    if (st.vehiculoId && !lista.some((v) => Number(v.id) === Number(st.vehiculoId))) {
      toast(st.primera ? 'Ese vehículo no está disponible en esas fechas: elige otro o cambia las fechas.' : 'El vehículo elegido ya no está disponible con estas fechas o categoría.', 'error');
      st.vehiculoId = null;
    }
    st.primera = false;
    const suc = Object.fromEntries(o.sucursales.map((s) => [s.id, s.nombre]));
    el.innerHTML = (lista.length ? lista.map((v) => `<label class="rs-veh${Number(v.id) === Number(st.vehiculoId) ? ' sel' : ''}"><input type="radio" name="rs-veh" value="${v.id}"${Number(v.id) === Number(st.vehiculoId) ? ' checked' : ''}>
        ${pat(v.patente)}<span><b>${esc(v.marca)} ${esc(v.modelo)} ${v.anio || ''}</b><small>${esc(v.color || '')} · ${Number(v.km).toLocaleString('es-CL')} km · ${esc(suc[v.sucursal_id] || '')}</small></span></label>`).join('')
      : '<p class="aviso info">No hay vehículos de esta categoría disponibles en esas fechas. Puedes guardar la cotización sin vehículo.</p>')
      + `<label class="rs-veh sinveh${!st.vehiculoId ? ' sel' : ''}"><input type="radio" name="rs-veh" value=""${!st.vehiculoId ? ' checked' : ''}><span><b>Sin asignar</b><small>solo para cotización</small></span></label>`;
    el.querySelectorAll('[name=rs-veh]').forEach((r) => { r.onchange = () => { st.vehiculoId = r.value ? Number(r.value) : null; el.querySelectorAll('.rs-veh').forEach((x) => x.classList.toggle('sel', x.contains(r))); }; });
  }

  // ── Cotización en vivo ──
  let tCot = null;
  function cotizar() { clearTimeout(tCot); tCot = setTimeout(cotizarYa, 250); }
  async function cotizarYa() {
    const d = leer(), el = cu.querySelector('#rs-cot'), av = cu.querySelector('#rs-avisos');
    const tol = o.ajustes?.tolerancia_min ?? 59;
    const valido = d.inicio && d.fin && new Date(d.fin) > new Date(d.inicio);
    const dias = valido ? diasArriendo(d.inicio, d.fin, tol) : null;
    cu.querySelector('#rs-dias').textContent = valido ? `${dias} ${dias === 1 ? 'día' : 'días'} de arriendo (tolerancia de ${tol} min en la devolución)` : 'La devolución debe ser posterior al retiro';
    if (!valido) { el.innerHTML = '<p class="muted peq">Completa las fechas.</p>'; st.cot = null; return; }
    try {
      const c = await api('reservas/cotizar', { body: d });
      st.cot = c;
      el.innerHTML = `<div class="rc-entre"><span class="chip">${esc(c.temporada === 'Base' ? 'Tarifa base' : c.temporada)}</span><span class="muted peq">${c.dias} ${c.dias === 1 ? 'día' : 'días'}</span></div>
        <table class="rc-lineas">${c.lineas.map((l) => `<tr class="${l.monto < 0 ? 'desc' : ''}"><td>${esc(l.concepto)}<small>${esc(l.detalle || '')}</small></td><td>${clp(l.monto)}</td></tr>`).join('')}
        <tr class="total"><td>Total <small>IVA incluido</small></td><td>${clp(c.total)}</td></tr></table>
        <dl class="rs-mini-datos"><div><dt>Garantía</dt><dd class="mono">${clp(c.garantia)}</dd></div><div><dt>Deducible</dt><dd class="mono">${clp(c.deducible)}</dd></div>
        <div><dt>Kilometraje</dt><dd>${c.km_libre ? 'libre' : `${Number(c.km_incluidos).toLocaleString('es-CL')} km · extra ${clp(c.precio_km_extra)}/km`}</dd></div></dl>`;
      av.innerHTML = c.avisos.map((a) => `<div class="aviso ${/lista negra/i.test(a) ? 'error' : 'info'}">${esc(a)}</div>`).join('');
    } catch (e) { el.innerHTML = `<div class="aviso error">${esc(e.message)}</div>`; av.innerHTML = ''; st.cot = null; }
  }

  async function guardar(estado) {
    const d = leer();
    if (!st.cliente) throw new Error('Elige o crea el cliente');
    if (st.cliente.lista_negra) throw new Error(`Cliente en lista negra: ${st.cliente.lista_negra_motivo || ''}`);
    if (!d.inicio || !d.fin) throw new Error('Completa las fechas y horas');
    if (estado === 'confirmada' && !d.vehiculo_id) throw new Error('Elige un vehículo para confirmar');
    const r = ed ? await api(`reservas/${reserva.id}`, { method: 'PATCH', body: d }) : await api('reservas', { body: { ...d, estado } });
    toast(ed ? 'Reserva actualizada' : estado === 'confirmada' ? `Reserva ${r.folio} confirmada` : `Cotización ${r.folio} guardada`, 'ok');
    return r;
  }

  return modal({
    titulo: ed ? `Editar reserva ${reserva.folio}` : 'Nueva reserva', ancho: true, html,
    botones: ed ? [{ texto: 'Cancelar' }, { texto: 'Guardar cambios', clase: 'primario', accion: () => guardar(reserva.estado) }]
      : [{ texto: 'Cancelar' }, { texto: 'Guardar como cotización', accion: () => guardar('cotizacion') }, { texto: 'Confirmar reserva', clase: 'primario', accion: () => guardar('confirmada') }],
    alAbrir: (cuerpo) => {
      cu = cuerpo;
      cuerpo.closest('.modal').classList.add('rs-modal-reserva');
      const q = cuerpo.querySelector('#rs-cli-q'), res = cuerpo.querySelector('#rs-cli-res');
      let tq = null;
      q.addEventListener('input', () => {
        clearTimeout(tq);
        const t = q.value.trim();
        if (t.length < 2) { res.hidden = true; return; }
        tq = setTimeout(async () => {
          const r = await api(`clientes?q=${encodeURIComponent(t)}&limite=8`).catch(() => ({ clientes: [] }));
          res.innerHTML = r.clientes.length ? r.clientes.map((c) => `<button type="button" class="rs-cli-op" data-id="${c.id}"><b>${esc(`${c.nombre} ${c.apellidos || ''}`)}</b><small class="mono">${docEtiqueta(c.documento_tipo, c.documento)}</small>${c.lista_negra ? '<span class="chip error">Lista negra</span>' : ''}</button>`).join('')
            : '<p class="muted peq" style="padding:10px">Sin resultados. Crea el cliente con «+ Cliente nuevo».</p>';
          res.hidden = false;
          res.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => { res.hidden = true; q.value = ''; elegirCliente(b.dataset.id); }; });
        }, 220);
      });
      const fc = cuerpo.querySelector('#rs-cli-form');
      let ctl = null;
      cuerpo.querySelector('#rs-cli-nuevo').onclick = () => {
        fc.hidden = false; cuerpo.querySelector('#rs-cli-buscar').hidden = true;
        ctl ||= activarFormCliente(fc);
        const t = q.value.trim();
        if (t) { if (/\d/.test(t)) fc.querySelector('[name=documento]').value = t; else fc.querySelector('[name=nombre]').value = t; ctl.validar(); }
        fc.querySelector('[name=documento]').focus();
      };
      cuerpo.querySelector('#rs-cli-cancelar').onclick = () => { fc.hidden = true; cuerpo.querySelector('#rs-cli-buscar').hidden = false; };
      cuerpo.querySelector('#rs-cli-crear').onclick = async (ev) => {
        ev.target.disabled = true;
        try {
          const c = await api('clientes', { body: leerFormCliente(fc) });
          toast('Cliente creado', 'ok');
          await elegirCliente(c.id);
        } catch (e) { toast(e.estado === 409 ? `${e.message}. Búscalo por su documento.` : e.message, 'error'); }
        finally { ev.target.disabled = false; }
      };
      cuerpo.querySelectorAll('[name=f_ini],[name=h_ini],[name=f_fin],[name=h_fin],[name=categoria_id]').forEach((x) => x.addEventListener('change', () => {
        if (x.name === 'f_ini') { const ff = cuerpo.querySelector('[name=f_fin]'); if (ff.value <= x.value) ff.value = sumarDias(x.value, 1); }
        cargarVehiculos(); cotizar(); if (st.cliente) pintarCliente(st.cliente);
      }));
      cuerpo.querySelectorAll('[name=sucursal_retiro_id],[name=sucursal_devolucion_id],[data-extra],[data-cant]').forEach((x) => x.addEventListener('change', cotizar));
      cuerpo.querySelector('[name=codigo_descuento]').addEventListener('input', cotizar);
      const cid = reserva?.cliente_id || prefill.cliente_id;
      if (cid) elegirCliente(cid).catch(() => pintarCliente(null)); else pintarCliente(null);
      cargarVehiculos(); cotizar();
      if (!cid) setTimeout(() => q.focus(), 50);
    }
  });
}
