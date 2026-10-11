// Asistente de entrega (check-out) y devolución (check-in) en el celular del personal de patio.
// Pasos: 1 Km y combustible (+ checklist) · 2 Fotos guiadas · 3 Daños · 4 Checklist (observaciones) · 5 Firma.
// Todo se guarda como borrador a medida que se avanza: se puede cerrar el celular y retomar.
import { api, esc, pat, miles, fechaHora, fecha, hora, documento, modal, toast, toastError } from '/comun.js';
import { POSICIONES, OBLIGATORIAS, CHECKLIST, CHECKLIST_DEFECTO, itemOk, TIPOS_DANO, nombrePosicion } from './patio-comun.js';
import { foto as dibujo } from './patio-dibujos.js';
import { dibujarEsquema, zonaDano } from '/esquema.js';
import { sellarFoto, abrirCamara, obtenerUbicacion, selloFecha, textoCoordenadas } from './patio-fotos.js';
import { crearFirma } from './patio-firma.js';

const OK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4L19 7"/></svg>';
const OK_P = OK.replace(/13/g, '11');
const CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const CAM20 = CAM.replace('<svg', '<svg width="20" height="20"');
const PASOS = ['Km y combustible', 'Fotos', 'Daños', 'Checklist', 'Firma'];
const TITULOS = ['Km, combustible y checklist', 'Fotos obligatorias', 'Esquema de daños', 'Checklist y observaciones', 'Firma del cliente'];
const COLOR_TIPO = { raya: 'var(--blue)', abolladura: 'var(--purple)', trizadura: 'var(--red)', otro: '#475467' };
const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const minutos = (m) => (m == null ? '' : m < 1 ? 'recién' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : `hace ${Math.floor(m / 1440)} d`);
const dibujoDe = (pos) => (OBLIGATORIAS.includes(pos) ? pos : 'detalle');
const fotoSrc = (id) => `/api/archivos/${id}`;

export async function montarAsistente(main, S, { alTerminar } = {}) {
  const R = S.reserva;
  const esEntrega = S.tipo === 'entrega';
  const claveP = `pt_paso_${S.inspeccion.id}`;
  let paso = Number(leer(claveP)) || (S.inspeccion.km == null ? 1 : S.fotos_ok < OBLIGATORIAS.length ? 2 : 3);
  let fotoSel = null;
  let tipoDano = 'raya';
  let firma = null;
  let reloj = null;
  let tGuardar = null;
  let pendiente = {};

  const insp = () => S.inspeccion;
  const ch = () => ({ ...CHECKLIST_DEFECTO, ...(insp().checklist || {}), notas: { ...(insp().checklist?.notas || {}) } });
  const base = () => (S.entrega?.checklist ? { ...CHECKLIST_DEFECTO, ...S.entrega.checklist } : CHECKLIST_DEFECTO);
  const fotosPor = () => Object.fromEntries(S.fotos.map((f) => [f.posicion, f]));
  const nFotos = () => OBLIGATORIAS.filter((p) => S.fotos.some((f) => f.posicion === p)).length;
  const siguienteFoto = () => OBLIGATORIAS.find((p) => !S.fotos.some((f) => f.posicion === p)) || null;

  // ── Guardado progresivo ──
  function guardar(campos, inmediato = false) {
    Object.assign(pendiente, campos);
    Object.assign(S.inspeccion, campos);
    clearTimeout(tGuardar);
    const ir = async () => {
      const p = pendiente; pendiente = {};
      if (!Object.keys(p).length) return;
      try { const r = await api(`patio/inspecciones/${S.inspeccion.id}`, { method: 'PUT', body: p }); S.inspeccion = { ...S.inspeccion, ...r }; } catch (e) { toastError(e); }
    };
    if (inmediato) return ir();
    tGuardar = setTimeout(ir, 500);
    return null;
  }
  async function recargar() {
    const nuevo = await api(`patio/reservas/${R.id}`);
    Object.assign(S, nuevo);
  }

  function irA(n) {
    paso = Math.max(1, Math.min(5, n));
    guardarLocal(claveP, String(paso));
    pintar();
    window.scrollTo(0, 0);
  }

  // ── Cabecera ──
  const cab = () => `<div class="rc-movil-cab">
    <div class="rc-entre"><a class="volver" href="/patio">‹ ${esEntrega ? 'Entrega' : 'Devolución'} · ${esc(R.folio)}</a>${pat(R.patente)}</div>
    <h2>${TITULOS[paso - 1]}</h2>
    <div class="rc-progreso">${PASOS.map((_, i) => `<i class="${i + 1 < paso ? 'hecho' : i + 1 === paso ? 'actual' : ''}" data-ir="${i + 1}" title="${PASOS[i]}"></i>`).join('')}</div>
    <div class="rc-pasos-movil">${PASOS.map((t, i) => `<button type="button" data-ir="${i + 1}" class="${i + 1 === paso ? 'actual' : ''}">${t}</button>`).join('')}</div>
  </div>`;

  // ── Paso 1: km, combustible y checklist ──
  function paso1() {
    const L = S.lectura || {};
    const gps = L.origen === 'plataforma_gps';
    const origen = gps ? `Plataforma GPS · ${minutos(L.minutos)}` : 'Registro manual';
    const km = insp().km ?? L.km, comb = insp().combustible ?? L.combustible;
    const conf = insp().km != null && insp().combustible != null;
    const corregido = conf && gps && (insp().km !== L.km || insp().combustible !== L.combustible);
    const c = ch();
    const fila = (it) => {
      const v = c[it.clave];
      const ok = itemOk(it, v, base());
      const nota = c.notas[it.clave];
      if (it.tipo === 'si') return `<div class="rc-check" data-ck="${it.clave}" role="checkbox" aria-checked="${ok}" tabindex="0"><span class="caja ${ok ? 'si' : 'no'}">${ok ? OK : '✕'}</span><span>${esc(it.nombre)}${nota ? `<br><small>${esc(nota)}</small>` : ''}</span></div>`;
      if (it.tipo === 'n') return `<div class="rc-check"><span class="caja ${ok ? 'si' : 'no'}">${ok ? OK : '✕'}</span><span>${esc(it.nombre)} (${Number(v ?? 0)})${nota ? `<br><small>${esc(nota)}</small>` : ''}</span><span class="pt-contador"><button type="button" data-tri="-1" aria-label="Uno menos">−</button><b>${Number(v ?? 0)}</b><button type="button" data-tri="1" aria-label="Uno más">+</button></span></div>`;
      return `<div class="rc-check"><span class="caja ${ok ? 'si' : 'no'}">${ok ? OK : '✕'}</span><span>${esc(it.nombre)}${nota ? `<br><small>${esc(nota)}</small>` : ''}</span><span class="pt-limpieza"><span class="segmentado"><button type="button" data-limp="ok" aria-pressed="${v !== 'sucio'}">Limpio</button><button type="button" data-limp="sucio" aria-pressed="${v === 'sucio'}">Sucio</button></span></span></div>`;
    };
    return `<div class="rc-movil-cuerpo" style="gap:10px">
      <div class="columnas-2" style="gap:8px;grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="rc-gps-dato"><span class="origen"><span class="rc-gps-punto${gps ? '' : ' off'}"></span>${esc(origen)}</span><span class="v">${km == null ? '—' : miles(km)} <small>km</small></span><span class="peq muted">${conf ? (corregido ? `Corregido (GPS: ${miles(L.km)})` : 'Confirmado con el tablero') : 'Odómetro del tablero: confirmar'}</span></div>
        <div class="rc-gps-dato"><span class="origen"><span class="rc-gps-punto${gps ? '' : ' off'}"></span>${esc(origen)}</span><span class="v">${comb == null ? '—' : `${comb}/8`}</span><div class="rc-nivel">${Array.from({ length: 8 }, (_, i) => `<i class="${i < (comb ?? 0) ? 'on' : ''}"></i>`).join('')}</div><div class="rc-nivel-et"><span>E</span><span>F</span></div></div>
      </div>
      ${!esEntrega && S.entrega ? `<p class="pt-sub">En la entrega: <b class="mono">${miles(S.entrega.km)} km</b> · <b class="mono">${S.entrega.combustible}/8</b></p>` : ''}
      <div class="rc-fila">${conf ? `<span class="pt-confirmado${corregido ? ' corregido' : ''}" style="flex:1">${OK} ${corregido ? 'Corregido en patio' : 'Coincide con el tablero'}</span>` : `<button type="button" class="btn primario" id="coincide" style="flex:1"${km == null ? ' disabled' : ''}>✓ Coincide con el tablero</button>`}<button type="button" class="btn" id="corregir">Corregir</button></div>
      <div class="tarjeta">${CHECKLIST.map(fila).join('')}</div>
    </div>
    <div class="rc-movil-pie"><a class="btn" href="/patio">Anterior</a><button type="button" class="btn primario" data-sig>Siguiente</button></div>`;
  }

  async function corregirKm() {
    const L = S.lectura || {};
    let comb = insp().combustible ?? L.combustible ?? 8;
    await modal({
      titulo: 'Corregir km y combustible',
      html: `<div class="campos" style="grid-template-columns:1fr">
        <label>Kilometraje del tablero<input class="campo mono" name="km" inputmode="numeric" value="${insp().km ?? L.km ?? ''}"></label>
        <div class="etiqueta">Combustible (octavos)<div class="rc-nivel" id="niv" style="margin-top:6px;cursor:pointer">${Array.from({ length: 8 }, (_, i) => `<i data-n="${i + 1}" style="height:30px"></i>`).join('')}</div><div class="rc-nivel-et"><span>E</span><b id="niv-t" class="mono"></b><span>F</span></div></div>
        ${L.origen === 'plataforma_gps' ? `<p class="peq muted">Plataforma GPS: ${miles(L.km)} km · ${L.combustible}/8. Si el tablero muestra otra cosa, registra lo del tablero.</p>` : ''}
      </div>`,
      alAbrir: (c) => {
        const pinta = () => { c.querySelectorAll('#niv i').forEach((i) => i.classList.toggle('on', Number(i.dataset.n) <= comb)); c.querySelector('#niv-t').textContent = `${comb}/8`; };
        c.querySelector('#niv').addEventListener('click', (e) => { const i = e.target.closest('[data-n]'); if (!i) return; comb = Number(i.dataset.n) === comb ? comb - 1 : Number(i.dataset.n); pinta(); });
        pinta();
      },
      botones: [{ texto: 'Cancelar' }, { texto: 'Guardar', clase: 'primario', accion: async (c) => {
        const km = Number(String(c.querySelector('[name=km]').value).replace(/\D/g, ''));
        if (!km) { toast('Indica el kilometraje', 'error'); return false; }
        await guardar({ km, combustible: comb, km_gps: L.origen === 'plataforma_gps' ? L.km : null, combustible_gps: L.origen === 'plataforma_gps' ? L.combustible : null }, true);
        pintar();
        return true;
      } }]
    });
  }

  // ── Paso 2: fotos guiadas ──
  function paso2() {
    const hechas = fotosPor();
    const sig = siguienteFoto();
    const sel = fotoSel || sig || 'frente';
    const def = POSICIONES.find((p) => p.clave === sel);
    const f = hechas[sel];
    const extras = S.fotos.filter((x) => !OBLIGATORIAS.includes(x.posicion));
    const cam = f
      ? `<img class="foto" src="${fotoSrc(f.archivo_id)}" alt="Foto ${esc(nombrePosicion(sel))}"><span class="listo">✓ ${esc(nombrePosicion(sel))}</span>`
      : `<div class="guia-dibujo">${dibujo(dibujoDe(sel), { patente: String(R.patente || '').replace(/^(\w{4})(\w{2})$/, '$1·$2') })}</div><div class="guia"></div><div class="guia-txt">${esc(def?.guia || 'Foto adicional')}</div>
         <div class="sello"><span class="reloj" id="reloj">${selloFecha()}</span><br><span id="coords">${textoCoordenadas(null)}</span> · ${esc(S.sucursal?.nombre || '')}</div>`;
    const tile = (p) => {
      const x = hechas[p.clave];
      if (x) return `<button type="button" class="rc-foto${p.clave === sel ? ' sel' : ''}" data-pos="${p.clave}"><img src="${fotoSrc(x.archivo_id)}" alt="" loading="lazy"><span class="et">${esc(p.nombre)}</span><span class="ok">${OK_P}</span><div class="sello">${hora(x.tomada_en)}${x.lat != null ? ` · ${Number(x.lat).toFixed(4)}` : ''}</div></button>`;
      return `<button type="button" class="rc-foto pend${p.clave === sel ? ' siguiente' : ''}" data-pos="${p.clave}">${CAM}${esc(p.nombre)}</button>`;
    };
    const completas = nFotos() === OBLIGATORIAS.length;
    return `<div class="rc-movil-cuerpo">
      <div class="rc-camara" id="camara">${cam}</div>
      <div class="rc-entre"><b>${nFotos()} de ${OBLIGATORIAS.length} fotos</b><span class="peq muted">Fecha, hora y ubicación quedan estampadas</span></div>
      <div class="rc-fotos-guia">
        ${POSICIONES.map(tile).join('')}
        ${extras.map((x) => `<button type="button" class="rc-foto${x.posicion === sel ? ' sel' : ''}" data-pos="${x.posicion}"><img src="${fotoSrc(x.archivo_id)}" alt="" loading="lazy"><span class="et">${esc(nombrePosicion(x.posicion))}</span><div class="sello">${hora(x.tomada_en)}</div></button>`).join('')}
        <button type="button" class="rc-foto pend extra" data-pos="nueva_extra">${CAM}+ Foto extra</button>
      </div>
    </div>
    <div class="rc-movil-pie">${completas
      ? `<button type="button" class="btn" data-ant>Anterior</button><button type="button" class="btn" id="tomar" aria-label="Repetir foto" style="flex:0 0 52px;padding:0">${CAM20}</button><button type="button" class="btn primario" data-sig>Siguiente</button>`
      : `<button type="button" class="btn primario" id="tomar">${CAM20} ${f ? 'Repetir foto' : 'Tomar foto'}</button>`}</div>`;
  }

  async function tomarFoto() {
    let pos = fotoSel || siguienteFoto() || 'frente';
    if (pos === 'nueva_extra') {
      const usados = S.fotos.map((x) => x.posicion).filter((p) => p.startsWith('extra_')).map((p) => Number(p.split('_')[1]));
      pos = `extra_${(usados.length ? Math.max(...usados) : 0) + 1}`;
    }
    const archivo = await abrirCamara();
    if (!archivo) return;
    const camara = main.querySelector('#camara');
    camara?.insertAdjacentHTML('beforeend', '<div class="subiendo">Estampando y subiendo…</div>');
    try {
      const r = await sellarFoto(archivo, { sucursal: S.sucursal?.nombre || '', etiqueta: `${esEntrega ? 'Entrega' : 'Devolución'} ${R.folio} · ${nombrePosicion(pos)}` });
      const out = await api(`patio/inspecciones/${S.inspeccion.id}/fotos`, { body: { posicion: pos, ...r } });
      S.fotos = [...S.fotos.filter((x) => x.posicion !== out.foto.posicion), out.foto];
      S.fotos_ok = out.fotos_ok;
      fotoSel = OBLIGATORIAS.includes(pos) ? siguienteFoto() : null;
      if (out.fotos_ok === OBLIGATORIAS.length && OBLIGATORIAS.includes(pos)) toast('Listas las 11 fotos obligatorias', 'ok');
    } catch (e) { toastError(e); }
    pintar();
  }

  // ── Paso 3: daños ──
  const todosDanos = () => [
    ...S.danos_previos.map((d) => ({ ...d, nuevo: false })),
    ...S.danos_nuevos.map((d) => ({ ...d, nuevo: !esEntrega }))
  ];
  function filaDano(d, previo) {
    const sub = previo
      ? `Preexistente${d.reserva_folio ? ` · ${d.inspeccion_tipo === 'devolucion' ? 'devolución' : 'entrega'} ${esc(d.reserva_folio)}` : ` · registrado ${fecha(d.creado_en)}`}`
      : esEntrega ? 'Preexistente · marcado en esta entrega' : 'Nuevo · genera un incidente al recibir';
    return `<button type="button" class="rc-dano${!previo && !esEntrega ? ' nuevo-dano' : ''}" data-dano="${d.id}"><span class="n ${d.tipo}${!previo && !esEntrega ? ' nuevo' : ''}">${d.n}</span><div><b>${esc(d.titulo)}</b><small>${sub}</small></div>${d.archivo_id ? `<span class="th"><img src="${fotoSrc(d.archivo_id)}" alt="" loading="lazy"></span>` : ''}</button>`;
  }
  function paso3() {
    return `<div class="rc-movil-cuerpo" style="gap:10px">
      <div class="rc-tipos-dano">${['raya', 'abolladura', 'trizadura', 'otro'].map((t) => `<button type="button" data-tipo="${t}" aria-pressed="${t === tipoDano}"><i style="background:${COLOR_TIPO[t]}"></i>${TIPOS_DANO[t]}</button>`).join('')}</div>
      <div class="rc-esquema" id="esquema"></div>
      <p class="peq muted" style="text-align:center">Toca el auto donde está el daño y agrega foto y nota</p>
      <div class="rc-danos">
        ${S.danos_nuevos.map((d) => filaDano(d, false)).join('')}
        ${S.danos_previos.map((d) => filaDano(d, true)).join('')}
        ${!S.danos_previos.length && !S.danos_nuevos.length ? '<div class="tarjeta rc-vacio peq">Sin daños registrados en este vehículo.</div>' : ''}
      </div>
    </div>
    <div class="rc-movil-pie"><button type="button" class="btn" data-ant>Anterior</button><button type="button" class="btn primario" data-sig>Siguiente</button></div>`;
  }

  async function hojaDano({ x, y, vista, dano = null }) {
    const editar = !!dano;
    let tipo = dano?.tipo || tipoDano;
    let dataUrl = null;
    const zona = zonaDano(dano?.vista || vista, dano?.x ?? x, dano?.y ?? y);
    const r = await modal({
      titulo: editar ? `Daño ${dano.n}` : 'Nuevo daño',
      html: `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="pt-modal-zona"><span class="chip">${esc(zona)}</span><span class="peq muted">${esEntrega ? 'Queda como preexistente' : 'Daño nuevo: crea un incidente'}</span></div>
        <div class="rc-tipos-dano" id="hd-tipos">${['raya', 'abolladura', 'trizadura', 'otro'].map((t) => `<button type="button" data-t="${t}" aria-pressed="${t === tipo}"><i style="background:${COLOR_TIPO[t]}"></i>${TIPOS_DANO[t]}</button>`).join('')}</div>
        <label class="etiqueta">Nota<textarea class="campo" name="descripcion" rows="2" placeholder="Ej: 8 cm, golpe en estacionamiento">${esc(dano?.descripcion || '')}</textarea></label>
        <div class="pt-modal-foto" id="hd-foto">${dano?.archivo_id ? `<img src="${fotoSrc(dano.archivo_id)}" alt="">` : 'Sin foto del daño'}</div>
        <button type="button" class="btn" id="hd-cam">${CAM20} ${dano?.archivo_id ? 'Cambiar foto' : 'Agregar foto'}</button>
      </div>`,
      alAbrir: (c) => {
        c.querySelector('#hd-tipos').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; tipo = b.dataset.t; c.querySelectorAll('#hd-tipos button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
        c.querySelector('#hd-cam').addEventListener('click', async () => {
          const a = await abrirCamara(); if (!a) return;
          try { const s = await sellarFoto(a, { sucursal: S.sucursal?.nombre || '', etiqueta: `Daño · ${zona}` }); dataUrl = s.dataUrl; c.querySelector('#hd-foto').innerHTML = `<img src="${s.dataUrl}" alt="">`; } catch (e) { toastError(e); }
        });
      },
      botones: [
        ...(editar ? [{ texto: 'Eliminar', clase: 'peligro', accion: async () => { await api(`patio/danos/${dano.id}`, { method: 'DELETE' }); return 'borrado'; } }] : [{ texto: 'Cancelar' }]),
        { texto: editar ? 'Guardar' : 'Guardar daño', clase: 'primario', accion: async (c) => {
          const descripcion = c.querySelector('[name=descripcion]').value.trim();
          if (editar) await api(`patio/danos/${dano.id}`, { method: 'PATCH', body: { tipo, descripcion, ...(dataUrl ? { dataUrl } : {}) } });
          else await api(`patio/inspecciones/${S.inspeccion.id}/danos`, { body: { vista, x, y, tipo, descripcion, ...(dataUrl ? { dataUrl } : {}) } });
          return 'ok';
        } }
      ]
    });
    if (r === 'ok' || r === 'borrado') { await recargar(); pintar(); toast(r === 'borrado' ? 'Daño eliminado' : 'Daño registrado', 'ok'); }
  }

  function verPrevio(d) {
    modal({
      titulo: `Daño ${d.n} · preexistente`,
      html: `<div style="display:flex;flex-direction:column;gap:10px"><b>${esc(d.titulo)}</b>
        <p class="peq muted">${d.reserva_folio ? `Registrado en la ${d.inspeccion_tipo === 'devolucion' ? 'devolución' : 'entrega'} de ${esc(d.reserva_folio)}` : 'Registrado en la ficha del vehículo'} · ${fecha(d.creado_en)}${d.incidente_folio ? ` · incidente ${esc(d.incidente_folio)}` : ''}</p>
        <div class="pt-modal-foto">${d.archivo_id ? `<img src="${fotoSrc(d.archivo_id)}" alt="">` : 'Sin foto'}</div></div>`
    });
  }

  // ── Paso 4: checklist y observaciones ──
  function paso4() {
    const c = ch();
    const L = S.lectura || {};
    let difs = '';
    if (!esEntrega && S.entrega) {
      const km = insp().km ?? L.km, comb = insp().combustible ?? L.combustible;
      const rec = km != null && S.entrega.km != null ? km - S.entrega.km : null;
      const oct = comb != null && S.entrega.combustible != null ? S.entrega.combustible - comb : 0;
      const be = base();
      const nDif = CHECKLIST.filter((it) => itemOk(it, be[it.clave], CHECKLIST_DEFECTO) && !itemOk(it, c[it.clave], be)).length;
      const incl = R.km_incluidos;
      difs = `<div class="pt-dif-mini">
        <div class="rc-dif"><span>Km recorridos</span><div class="par"><b>${rec == null ? '—' : `+${miles(rec)}`}</b></div><em class="${incl != null && rec > incl ? 'mal' : 'bien'}">${incl == null ? 'Kilometraje libre' : rec > incl ? `${miles(rec - incl)} km sobre los ${miles(incl)}` : `Incluye ${miles(incl)} km`}</em></div>
        <div class="rc-dif"><span>Combustible</span><div class="par"><s>${S.entrega.combustible}/8</s>→<b>${comb ?? '—'}/8</b></div><em class="${oct > 0 ? 'mal' : 'bien'}">${oct > 0 ? `Faltan ${oct}/8` : 'Sin diferencia'}</em></div>
        <div class="rc-dif"><span>Daños</span><div class="par"><s>${S.danos_previos.length}</s>→<b>${S.danos_previos.length + S.danos_nuevos.length}</b></div><em class="${S.danos_nuevos.length ? 'mal' : 'bien'}">${S.danos_nuevos.length ? `${S.danos_nuevos.length} nuevo(s)` : 'Sin daños nuevos'}</em></div>
        <div class="rc-dif"><span>Checklist</span><div class="par"><b>${nDif}</b></div><em class="${nDif ? 'mal' : 'bien'}">${nDif ? 'diferencia(s) con la entrega' : 'Igual que en la entrega'}</em></div>
      </div>`;
    }
    const fila = (it) => {
      const v = c[it.clave];
      const ok = itemOk(it, v, base());
      const estado = it.tipo === 'si' ? (ok ? 'Sí' : 'No') : it.tipo === 'n' ? String(v) : (v === 'sucio' ? 'Sucio' : 'Limpio');
      return `<div class="rc-check pt-ck4"><span class="caja ${ok ? 'si' : 'no'}">${ok ? OK : '✕'}</span><span>${esc(it.nombre)} <small>· ${estado}</small></span>
        <input class="campo pt-nota" data-nota="${it.clave}" value="${esc(c.notas[it.clave] || '')}" placeholder="${ok ? (it.clave === 'extintor' ? 'Nota (opcional): ej. vence 08-2027' : 'Nota (opcional)') : 'Describe la observación'}"></div>`;
    };
    return `<div class="rc-movil-cuerpo" style="gap:10px">
      ${difs}
      <div class="tarjeta">${CHECKLIST.map(fila).join('')}</div>
      <label class="etiqueta">Observaciones generales<textarea class="campo" id="obs" rows="3" placeholder="Ej: cliente indica ruido en frenos">${esc(insp().observaciones || '')}</textarea></label>
      ${!esEntrega ? `<label class="tarjeta rc-entre" style="padding:12px 14px"><span><b>Enviar a mantención</b><br><small class="muted">El vehículo queda «En mantención» en vez de disponible</small></span><span class="switch"><input type="checkbox" id="mant"${c.mantencion ? ' checked' : ''}><span></span></span></label>` : ''}
    </div>
    <div class="rc-movil-pie"><button type="button" class="btn" data-ant>Anterior</button><button type="button" class="btn primario" data-sig>Siguiente</button></div>`;
  }

  // ── Paso 5: firma ──
  function paso5() {
    const c = ch();
    const cont = CHECKLIST.filter((it) => itemOk(it, c[it.clave], base())).length;
    const obs = CHECKLIST.length - cont + CHECKLIST.filter((it) => itemOk(it, c[it.clave], base()) && c.notas[it.clave]).length;
    const L = S.lectura || {};
    const km = insp().km ?? L.km, comb = insp().combustible ?? L.combustible;
    const nf = nFotos(), faltan = OBLIGATORIAS.length - nf;
    const conf = insp().km != null && insp().combustible != null;
    const contrato = R.contrato_folio ? `del contrato <b class="mono">${esc(R.contrato_folio)}</b>` : `de la reserva <b class="mono">${esc(R.folio)}</b>`;
    const falta = [faltan ? `faltan ${faltan} foto(s)` : '', conf ? '' : 'falta confirmar km y combustible'].filter(Boolean).join(' · ');
    return `<div class="rc-movil-cuerpo" style="gap:10px">
      <div class="tarjeta bloque pt-resumen">
        <div class="rc-entre"><span>${esEntrega ? 'Km de salida' : 'Km de llegada'}</span><b class="mono">${km == null ? '—' : `${miles(km)} km`}</b></div>
        <div class="rc-entre"><span>Combustible</span><b class="mono">${comb ?? '—'}/8</b></div>
        <div class="rc-entre"><span>Fotos</span><b${faltan ? ' style="color:var(--red)"' : ''}>${nf} de ${OBLIGATORIAS.length}${faltan ? '' : ' ✓'}</b></div>
        <div class="rc-entre"><span>${esEntrega ? 'Daños preexistentes' : 'Daños'}</span><b>${esEntrega ? `${S.danos_previos.length + S.danos_nuevos.length} marcados` : `${S.danos_previos.length} previos · ${S.danos_nuevos.length} nuevo(s)`}</b></div>
        <div class="rc-entre"><span>Checklist</span><b>${cont} de ${CHECKLIST.length}${obs ? ` · ${obs} observaci${obs === 1 ? 'ón' : 'ones'}` : ''}</b></div>
        <div class="rc-entre"><span>${esEntrega ? 'Devolución' : 'Devolución pactada'}</span><b class="mono">${fechaHora(R.fin)}</b></div>
      </div>
      <p class="peq" style="color:var(--ink-2)">${esEntrega
        ? `Declaro recibir el vehículo en el estado descrito, con las fotos y daños registrados, y acepto las condiciones ${contrato}.`
        : `Declaro devolver el vehículo en el estado descrito, con las fotos, daños y observaciones registradas, que se considerarán en la liquidación ${contrato}.`}</p>
      <div class="pt-firma"><div id="firma"></div><button type="button" class="btn peq" id="borrar-firma">Borrar</button></div>
      <div class="rc-entre peq"><input class="campo" id="firmante" value="${esc(insp().firmante_nombre || R.cliente_nombre || '')}" aria-label="Nombre de quien firma" style="flex:1;min-height:34px"><span class="mono">${R.documento ? documento(R.documento_tipo, R.documento) : ''}</span></div>
      <div class="aviso neutro peq">${esEntrega ? 'El contrato firmado (PDF con QR) se enviará por correo y WhatsApp al activar las comunicaciones.' : 'Al recibir, la reserva queda «Devuelta» y se abre la comparación con la entrega para pasar a liquidación.'}</div>
      ${falta ? `<p class="pt-falta">No se puede terminar: ${falta}.</p>` : ''}
    </div>
    <div class="rc-movil-pie"><button type="button" class="btn primario" id="terminar"${falta ? ' disabled' : ''}>${esEntrega ? 'Firmar y entregar llaves' : 'Firmar y recibir vehículo'}</button></div>`;
  }

  async function terminar(boton) {
    if (!firma || firma.vacia()) { toast('Falta la firma del cliente', 'error'); return; }
    const nombre = main.querySelector('#firmante').value.trim();
    if (!nombre) { toast('Indica el nombre de quien firma', 'error'); return; }
    boton.disabled = true;
    try {
      await guardar({}, true);
      const u = await obtenerUbicacion();
      const res = await api(`patio/inspecciones/${S.inspeccion.id}/completar`, { body: { firma: firma.dataUrl(), firmante_nombre: nombre, lat: u?.lat ?? null, lng: u?.lng ?? null, mantencion: !!ch().mantencion } });
      clearInterval(reloj);
      try { localStorage.removeItem(claveP); } catch { /* nada */ }
      if (esEntrega) {
        main.innerHTML = `<div class="pt-movil-env"><div class="rc-movil">${cab().replace(TITULOS[paso - 1], 'Entrega registrada')}<div class="pt-exito">
          <span class="ic">${OK.replace(/13/g, '30')}</span><h2>Vehículo entregado</h2>
          <p class="muted">${pat(R.patente)} · reserva <b class="mono">${esc(R.folio)}</b> en curso. Devolución pactada <b class="mono">${fechaHora(R.fin)}</b> en ${esc(R.sucursal_devolucion || '')}.</p>
          <a class="btn primario" href="/patio">Volver a las tareas</a><a class="btn" href="/reservas/${R.id}">Ver reserva</a></div></div></div>`;
        toast('Entrega registrada', 'ok');
      } else {
        toast(res.incidentes.length ? `Vehículo recibido · se creó ${res.incidentes.map((i) => i.folio).join(', ')}` : 'Vehículo recibido', 'ok');
      }
      await alTerminar?.(res);
    } catch (e) { boton.disabled = false; toastError(e); }
  }

  // ── Pintar y eventos ──
  function pintar() {
    clearInterval(reloj);
    const cuerpo = [paso1, paso2, paso3, paso4, paso5][paso - 1]();
    main.innerHTML = `<div class="pt-movil-env"><div class="rc-movil">${cab()}${cuerpo}</div></div>`;
    main.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => irA(Number(b.dataset.ir))));
    main.querySelector('[data-ant]')?.addEventListener('click', () => irA(paso - 1));
    main.querySelector('[data-sig]')?.addEventListener('click', () => {
      if (paso === 1 && (insp().km == null || insp().combustible == null)) { toast('Confirma el kilometraje y el combustible', 'error'); return; }
      irA(paso + 1);
    });
    if (paso === 1) eventos1();
    if (paso === 2) eventos2();
    if (paso === 3) eventos3();
    if (paso === 4) eventos4();
    if (paso === 5) eventos5();
  }

  function eventos1() {
    main.querySelector('#coincide')?.addEventListener('click', async () => {
      const L = S.lectura || {};
      await guardar({ km: L.km, combustible: L.combustible, km_gps: L.origen === 'plataforma_gps' ? L.km : null, combustible_gps: L.origen === 'plataforma_gps' ? L.combustible : null }, true);
      pintar();
    });
    main.querySelector('#corregir').addEventListener('click', corregirKm);
    const cambiar = (fn) => { const c = ch(); fn(c); guardar({ checklist: c }); pintar(); };
    main.querySelectorAll('[data-ck]').forEach((el) => {
      const t = () => cambiar((c) => { c[el.dataset.ck] = c[el.dataset.ck] === false; });
      el.addEventListener('click', t);
      el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); t(); } });
    });
    main.querySelectorAll('[data-tri]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); cambiar((c) => { c.triangulos = Math.max(0, Math.min(9, Number(c.triangulos ?? 0) + Number(b.dataset.tri))); }); }));
    main.querySelectorAll('[data-limp]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); cambiar((c) => { c.limpieza = b.dataset.limp; }); }));
  }

  function eventos2() {
    obtenerUbicacion().then((u) => { const el = main.querySelector('#coords'); if (el) el.textContent = textoCoordenadas(u); });
    reloj = setInterval(() => { const el = main.querySelector('#reloj'); if (el) el.textContent = selloFecha(); else clearInterval(reloj); }, 1000);
    main.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => {
      fotoSel = b.dataset.pos;
      if (fotoSel === 'nueva_extra' || !S.fotos.some((f) => f.posicion === fotoSel)) { pintar(); tomarFoto(); return; }
      pintar();
    }));
    main.querySelector('#tomar').addEventListener('click', tomarFoto);
  }

  function eventos3() {
    main.querySelectorAll('[data-tipo]').forEach((b) => b.addEventListener('click', () => { tipoDano = b.dataset.tipo; main.querySelectorAll('[data-tipo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    const lista = todosDanos();
    const abrir = (d) => { if (!d) return; const previo = S.danos_previos.some((p) => p.id === d.id); previo ? verPrevio(d) : hojaDano({ dano: d }); };
    dibujarEsquema(main.querySelector('#esquema'), { danos: lista, editable: true, alMarcar: (x, y, vista) => hojaDano({ x, y, vista }), alTocar: abrir });
    main.querySelectorAll('[data-dano]').forEach((b) => b.addEventListener('click', () => abrir(lista.find((d) => String(d.id) === b.dataset.dano))));
  }

  function eventos4() {
    main.querySelectorAll('[data-nota]').forEach((inp) => inp.addEventListener('input', () => { const c = ch(); c.notas[inp.dataset.nota] = inp.value; guardar({ checklist: c }); }));
    main.querySelector('#obs').addEventListener('input', (e) => guardar({ observaciones: e.target.value }));
    main.querySelector('#mant')?.addEventListener('change', (e) => { const c = ch(); c.mantencion = e.target.checked; guardar({ checklist: c }); });
  }

  function eventos5() {
    firma = crearFirma(main.querySelector('#firma'));
    window.__ptFirma = firma; // usado por las capturas automáticas
    main.querySelector('#borrar-firma').addEventListener('click', () => firma.limpiar());
    main.querySelector('#firmante').addEventListener('change', (e) => guardar({ firmante_nombre: e.target.value }));
    main.querySelector('#terminar').addEventListener('click', (e) => terminar(e.currentTarget));
  }

  pintar();
}
