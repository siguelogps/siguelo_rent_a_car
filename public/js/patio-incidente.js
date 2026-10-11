// /incidentes/:id: ficha del incidente con trazabilidad completa (datos, fotos entrega vs devolución, línea de tiempo,
// presupuesto → monto al cliente, cobro, seguro, pago, cierre, OT correctiva).
import { iniciarPagina, api, esc, pat, clp, fecha, fechaHora, documento, modal, toast, toastError, puede, reducirImagen } from '/comun.js';
import { ESTADOS_INCIDENTE, ORDEN_INCIDENTE, TIPOS_INCIDENTE, TIPOS_DANO } from './patio-comun.js';
import { svgEsquema } from '/esquema.js';

await iniciarPagina({ activo: 'incidentes', titulo: 'Incidentes y daños' });
const main = document.getElementById('principal');
const id = Number(location.pathname.split('/')[2]);
const editar = puede('incidentes', 'editar');
const chip = (e) => `<span class="chip inc-${esc(e)}">${esc(ESTADOS_INCIDENTE[e] || e)}</span>`;
const EVENTO = { reporte: 'Reporte', presupuesto: 'Presupuesto', cobro: 'Cobro al cliente', seguro: 'Seguro', pago: 'Pago', cierre: 'Cierre', anulacion: 'Anulación', nota: 'Nota' };
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/\D/g, '')));

async function pintar() {
  const I = await api(`incidentes/${id}`);
  document.title = `${I.folio} · Incidentes y daños`;
  const abierto = !['cerrado', 'anulado'].includes(I.estado);
  const idx = ORDEN_INCIDENTE.indexOf(I.estado);
  const neto = (I.cobrado_cliente || 0) + (I.recupero_seguro || 0) - (I.costo_real ?? I.presupuesto ?? 0);

  const fotos = I.fotos.map((f) => `
    <div class="pt-fotos-inc">
      <figure><figcaption>Entrega · ${esc(f.nombre)}${I.entrega?.completado_en ? ` · ${fecha(I.entrega.completado_en)}` : ''}</figcaption>${f.entrega ? `<a class="rc-foto" href="/api/archivos/${f.entrega.archivo_id}" target="_blank" rel="noopener"><img src="/api/archivos/${f.entrega.archivo_id}" alt=""></a>` : '<div class="rc-foto rc-vacio peq">Sin foto</div>'}</figure>
      <figure><figcaption>Devolución · ${esc(f.nombre)}${I.devolucion?.completado_en ? ` · ${fecha(I.devolucion.completado_en)}` : ''}</figcaption>${f.devolucion ? `<a class="rc-foto nuevo" href="/api/archivos/${f.devolucion.archivo_id}" target="_blank" rel="noopener"><img src="/api/archivos/${f.devolucion.archivo_id}" alt="">${f.danos.map((d, k) => `<span class="rc-circulo-et" style="right:8px;top:${8 + k * 22}px">${d.n} · ${esc(TIPOS_DANO[d.tipo].toLowerCase())}</span>`).join('')}</a>` : '<div class="rc-foto rc-vacio peq">Sin foto</div>'}</figure>
      ${I.danos.filter((d) => d.archivo_id).slice(0, 1).map((d) => `<figure><figcaption>Foto del daño ${d.n}</figcaption><a class="rc-foto" href="/api/archivos/${d.archivo_id}" target="_blank" rel="noopener"><img src="/api/archivos/${d.archivo_id}" alt=""></a></figure>`).join('') || '<figure><figcaption>Foto del daño</figcaption><div class="rc-foto rc-vacio peq">Sin foto</div></figure>'}
    </div>`).join('');

  const adjuntos = I.adjuntos.filter((a) => (a.mime || '').startsWith('image/'));

  main.innerHTML = `
    <a href="/incidentes" class="pt-comp-volver">‹ Incidentes y daños</a>
    <div class="pagina-cab">
      <div>
        <div class="rc-fila"><h1>Incidente · <span class="mono">${esc(I.folio)}</span></h1>${pat(I.patente, true).replace('class="pat grande"', 'class="pat grande" style="font-size:18px"')}${chip(I.estado)}<span class="chip">${esc(TIPOS_INCIDENTE[I.tipo])}</span></div>
        <p>${esc(I.descripcion || '')}</p>
      </div>
      <div class="acciones">
        ${I.reserva_id ? `<a class="btn" href="/patio/${I.reserva_id}?vista=comparacion">Ver comparación de la devolución</a>` : ''}
        ${I.reserva_id ? `<a class="btn" href="/liquidaciones/${I.reserva_id}">Liquidación</a>` : ''}
      </div>
    </div>
    ${I.estado === 'anulado' ? '<div class="aviso neutro">Incidente anulado.</div>' : `<div class="tarjeta bloque"><div class="pt-estados">${ORDEN_INCIDENTE.map((e, k) => `<div class="${k < idx ? 'hecho' : k === idx ? 'actual' : ''}"><i>${k < idx ? '✓' : k + 1}</i>${esc(ESTADOS_INCIDENTE[e])}</div>`).join('')}</div></div>`}
    <div class="columnas">
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <div class="tarjeta bloque">
          <h2>Datos</h2>
          <dl class="rc-datos">
            <div><dt>Vehículo</dt><dd><a href="/vehiculos/${I.vehiculo_id}">${esc([I.marca, I.modelo, I.anio].filter(Boolean).join(' '))}</a></dd></div>
            <div><dt>Cliente</dt><dd>${I.cliente_id ? `<a href="/clientes/${I.cliente_id}">${esc(I.cliente_nombre)}</a><br><small class="muted">${documento(I.documento_tipo, I.documento)}</small>` : '—'}</dd></div>
            <div><dt>Reserva</dt><dd>${I.reserva_id ? `<a class="mono" href="/reservas/${I.reserva_id}">${esc(I.reserva_folio)}</a><br><small class="muted">${fecha(I.reserva_inicio)} → ${fecha(I.reserva_fin)}</small>` : '—'}</dd></div>
            <div><dt>Contrato</dt><dd>${I.contrato_id ? `<a class="mono" href="/contratos/${I.contrato_id}">${esc(I.contrato_folio)}</a>` : '—'}</dd></div>
            <div><dt>Reportado</dt><dd>${fechaHora(I.creado_en)}<br><small class="muted">${esc(I.creado_por_nombre || '')}</small></dd></div>
            ${I.numero_siniestro ? `<div><dt>Seguro</dt><dd>${esc(I.compania_seguro || '')}<br><small class="mono">Siniestro ${esc(I.numero_siniestro)}</small></dd></div>` : ''}
          </dl>
        </div>
        ${I.fotos.length ? `<div class="tarjeta bloque"><h2>Fotos: entrega vs devolución</h2>${fotos}</div>` : ''}
        ${I.danos.length ? `<div class="tarjeta bloque"><h2>Daños ligados</h2>
          <div class="columnas-2" style="grid-template-columns:200px minmax(0,1fr);align-items:start">
            <div class="rc-esquema">${svgEsquema(I.danos.map((d) => ({ ...d, nuevo: true, reparado: d.estado === 'reparado' })), { etiquetas: false })}</div>
            <div class="rc-danos">${I.danos.map((d) => `<div class="rc-dano"><span class="n ${d.tipo}">${d.n}</span><div><b>${esc(d.titulo)}</b><small>${d.inspeccion_tipo === 'devolucion' ? 'Detectado en la devolución' : 'Registrado'} · ${fecha(d.creado_en)}${d.estado === 'reparado' ? ` · reparado ${fecha(d.reparado_en)}` : ''}</small></div><span class="chip ${d.estado === 'reparado' ? 'ok' : 'error'}">${d.estado === 'reparado' ? 'Reparado' : 'Activo'}</span></div>`).join('')}</div>
          </div></div>` : ''}
        ${adjuntos.length ? `<div class="tarjeta bloque"><h2>Adjuntos</h2><div class="pt-fotos-inc">${adjuntos.map((a) => `<figure><figcaption>${esc(a.nombre || 'Adjunto')} · ${fecha(a.creado_en)}</figcaption><a class="rc-foto" href="/api/archivos/${a.id}" target="_blank" rel="noopener"><img src="/api/archivos/${a.id}" alt=""></a></figure>`).join('')}</div></div>` : ''}
        <div class="tarjeta bloque">
          <h2>Línea de tiempo</h2>
          <div class="rc-timeline">${I.eventos.map((e) => `<div><span><b>${esc(EVENTO[e.tipo] || e.tipo)}</b>${e.monto != null ? ` · <span class="monto">${clp(e.monto)}</span>` : ''}<br>${esc(e.detalle || '')}<small>${fechaHora(e.creado_en)}${e.usuario ? ` · ${esc(e.usuario)}` : ''}</small></span></div>`).join('')}
          ${abierto ? `<div class="pend"><span class="muted">${esc(siguientePaso(I))}</span></div>` : ''}</div>
          ${editar ? `<div class="rc-fila"><input class="campo" id="nota" placeholder="Agregar una nota (llamada al cliente, envío de fotos al taller…)" style="flex:1;min-width:200px"><button type="button" class="btn" id="btn-adj">Adjuntar foto</button><button type="button" class="btn oscuro" id="btn-nota">Agregar nota</button></div>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <div class="tarjeta bloque">
          <h2>Montos ${editar && abierto ? '<button type="button" class="btn peq" id="btn-pres">Presupuesto</button>' : ''}</h2>
          <div class="pt-montos">
            <span>Presupuesto de reparación${I.taller ? `<br><small>${esc(I.taller)}</small>` : ''}</span><b class="monto">${I.presupuesto != null ? clp(I.presupuesto) : '—'}</b>
            <span>Deducible del cliente</span><b class="monto">${I.deducible != null ? clp(I.deducible) : '—'}</b>
            <span>Monto al cliente<br><small>menor entre presupuesto y deducible</small></span><b class="monto">${I.monto_cliente != null ? clp(I.monto_cliente) : '—'}</b>
            <span>Cobrado al cliente</span><b class="monto">${clp(I.cobrado_cliente || 0)}</b>
            <span>Recupero del seguro</span><b class="monto">${I.recupero_seguro != null ? clp(I.recupero_seguro) : '—'}</b>
            <span>Costo real de reparación</span><b class="monto">${I.costo_real != null ? clp(I.costo_real) : '—'}</b>
            <span class="total">${I.estado === 'cerrado' ? 'Resultado para la empresa' : 'Resultado estimado'}</span><b class="monto total" style="color:${neto < 0 ? 'var(--red)' : 'var(--green)'}">${clp(neto)}</b>
          </div>
        </div>
        ${editar && abierto ? `<div class="tarjeta bloque"><h2>Siguiente paso</h2><div style="display:flex;flex-direction:column;gap:8px">${botones(I)}</div></div>` : ''}
        <div class="tarjeta bloque">
          <h2>Mantención ${editar && I.estado !== 'anulado' ? '<button type="button" class="btn peq" id="btn-ot">Crear OT correctiva</button>' : ''}</h2>
          ${I.ordenes.length ? `<div class="rc-danos">${I.ordenes.map((o) => `<a class="rc-doc" href="/mantencion?ot=${o.id}" style="text-decoration:none"><span class="mini"></span><div><b class="mono">${esc(o.folio)}</b><small>${esc(o.motivo)}${o.taller ? ` · ${esc(o.taller)}` : ''}</small></div><span class="chip">${esc(o.estado.replace('_', ' '))}</span></a>`).join('')}</div>` : '<p class="peq muted">Sin órdenes de trabajo. Crea una OT correctiva para programar la reparación en mantención.</p>'}
        </div>
      </div>
    </div>`;
  eventos(I);
}

function siguientePaso(I) {
  return { reportado: 'Pendiente: registrar el presupuesto de reparación', presupuestado: 'Pendiente: cobrar al cliente o denunciar al seguro', cobrado_cliente: 'Pendiente: seguro, pago o cierre', en_seguro: 'Pendiente: pago del seguro', pagado: 'Pendiente: cerrar con el costo real' }[I.estado] || '';
}

function botones(I) {
  const b = [];
  if (I.estado === 'reportado') b.push('<button type="button" class="btn primario" data-acc="presupuesto">Registrar presupuesto</button>');
  if (['presupuestado'].includes(I.estado)) b.push('<button type="button" class="btn primario" data-acc="cobrado_cliente">Registrar cobro al cliente</button>');
  if (['presupuestado', 'cobrado_cliente'].includes(I.estado)) b.push('<button type="button" class="btn" data-acc="en_seguro">Denunciar al seguro</button>');
  if (['presupuestado', 'cobrado_cliente', 'en_seguro'].includes(I.estado)) b.push(`<button type="button" class="btn${I.estado === 'en_seguro' ? ' primario' : ''}" data-acc="pagado">${I.estado === 'en_seguro' ? 'Registrar pago del seguro' : 'Marcar como pagado'}</button>`);
  b.push(`<button type="button" class="btn${I.estado === 'pagado' ? ' primario' : ''}" data-acc="cerrado">Cerrar incidente (daño reparado)</button>`);
  b.push('<button type="button" class="btn peligro" data-acc="anulado">Anular</button>');
  return b.join('');
}

async function presupuesto(I) {
  const sug = (p, d) => (p == null ? null : d != null ? Math.min(p, d) : p);
  await modal({
    titulo: 'Presupuesto de reparación',
    html: `<div class="campos" style="grid-template-columns:1fr 1fr">
      <label class="ancho">Taller<input class="campo" name="taller" value="${esc(I.taller || '')}" placeholder="Ej: Desabolladura y Pintura Los Andes"></label>
      <label>Presupuesto<input class="campo mono" name="presupuesto" inputmode="numeric" value="${I.presupuesto ?? ''}"></label>
      <label>Deducible del cliente<input class="campo mono" name="deducible" inputmode="numeric" value="${I.deducible ?? ''}"></label>
      <label>Monto al cliente<input class="campo mono" name="monto_cliente" inputmode="numeric" value="${I.monto_cliente ?? ''}"></label>
      <label>Motivo del ajuste<input class="campo" name="motivo" placeholder="Solo si cambias el monto sugerido"></label>
      <p class="peq muted ancho" id="sug"></p>
    </div>`,
    alAbrir: (c) => {
      const f = (n) => c.querySelector(`[name=${n}]`);
      let tocado = I.monto_cliente != null && I.monto_cliente !== sug(I.presupuesto, I.deducible);
      const act = () => {
        const s = sug(num(f('presupuesto').value), num(f('deducible').value));
        if (!tocado && s != null) f('monto_cliente').value = s;
        c.querySelector('#sug').textContent = s != null ? `Sugerido: ${clp(s)} (menor entre presupuesto y deducible).` : '';
      };
      f('monto_cliente').addEventListener('input', () => { tocado = true; });
      f('presupuesto').addEventListener('input', act); f('deducible').addEventListener('input', act); act();
    },
    botones: [{ texto: 'Cancelar' }, { texto: 'Guardar presupuesto', clase: 'primario', accion: async (c) => {
      const v = (n) => c.querySelector(`[name=${n}]`).value;
      await api(`incidentes/${I.id}/presupuesto`, { body: { taller: v('taller'), presupuesto: num(v('presupuesto')), deducible: num(v('deducible')), monto_cliente: num(v('monto_cliente')), motivo: v('motivo') } });
      toast('Presupuesto registrado', 'ok');
    } }]
  });
  await pintar();
}

async function cambiarEstado(I, estado) {
  const campos = {
    cobrado_cliente: `<label>Monto cobrado<input class="campo mono" name="cobrado" inputmode="numeric" value="${I.monto_cliente ?? ''}"></label><label class="ancho">Detalle<input class="campo" name="detalle" placeholder="Ej: descontado de la garantía en la liquidación"></label>`,
    en_seguro: `<label>Compañía<input class="campo" name="compania_seguro" value="${esc(I.compania_seguro || 'HDI Seguros')}"></label><label>Número de siniestro<input class="campo mono" name="numero_siniestro" value="${esc(I.numero_siniestro || '')}"></label><label class="ancho">Detalle<input class="campo" name="detalle"></label>`,
    pagado: `<label>Recupero del seguro<input class="campo mono" name="recupero_seguro" inputmode="numeric" value="${I.recupero_seguro ?? ''}" placeholder="0 si no aplica"></label><label class="ancho">Detalle<input class="campo" name="detalle"></label>`,
    cerrado: `<label>Costo real de la reparación<input class="campo mono" name="costo_real" inputmode="numeric" value="${I.costo_real ?? I.presupuesto ?? ''}"></label><p class="peq muted ancho">Al cerrar, los daños ligados quedan marcados como reparados en el vehículo.</p>`,
    anulado: '<label class="ancho">Motivo de la anulación<input class="campo" name="detalle"></label>'
  }[estado];
  await modal({
    titulo: { cobrado_cliente: 'Cobro al cliente', en_seguro: 'Denuncia al seguro', pagado: 'Pago', cerrado: 'Cerrar incidente', anulado: 'Anular incidente' }[estado],
    html: `<div class="campos" style="grid-template-columns:1fr 1fr">${campos}</div>`,
    botones: [{ texto: 'Cancelar' }, { texto: 'Confirmar', clase: estado === 'anulado' ? 'peligro' : 'primario', accion: async (c) => {
      const body = { estado };
      c.querySelectorAll('[name]').forEach((x) => { body[x.name] = ['cobrado', 'recupero_seguro', 'costo_real'].includes(x.name) ? num(x.value) : x.value.trim(); });
      await api(`incidentes/${I.id}/estado`, { body });
      toast(`Incidente: ${ESTADOS_INCIDENTE[estado].toLowerCase()}`, 'ok');
    } }]
  });
  await pintar();
}

function eventos(I) {
  main.querySelector('#btn-pres')?.addEventListener('click', () => presupuesto(I));
  main.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => (b.dataset.acc === 'presupuesto' ? presupuesto(I) : cambiarEstado(I, b.dataset.acc))));
  main.querySelector('#btn-nota')?.addEventListener('click', async () => {
    const v = main.querySelector('#nota').value.trim();
    if (!v) return;
    try { await api(`incidentes/${I.id}/nota`, { body: { detalle: v } }); await pintar(); } catch (e) { toastError(e); }
  });
  main.querySelector('#btn-adj')?.addEventListener('click', () => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try { await api(`incidentes/${I.id}/nota`, { body: { detalle: main.querySelector('#nota').value.trim() || `Foto adjunta: ${f.name}`, dataUrl: await reducirImagen(f), nombre: f.name } }); await pintar(); } catch (e) { toastError(e); }
    };
    inp.click();
  });
  main.querySelector('#btn-ot')?.addEventListener('click', async () => {
    try { const o = await api(`incidentes/${I.id}/ot`, { body: {} }); toast(`OT ${o.folio} creada en mantención`, 'ok'); await pintar(); } catch (e) { toastError(e); }
  });
}

try { await pintar(); } catch (e) { toastError(e); main.innerHTML = `<div class="tarjeta rc-vacio">${esc(e.message)}</div>`; }
