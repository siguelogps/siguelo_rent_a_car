// Comparación entrega ↔ devolución (maqueta 04): diferencias, fotos lado a lado, esquemas y checklist.
import { api, esc, pat, miles, fecha, hora, fechaHora, puede } from '/comun.js';
import { CHECKLIST, TIPOS_DANO } from './patio-comun.js';
import { svgEsquema } from '/esquema.js';

const duracion = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`);
const sello = (f) => `<div class="sello" style="font-size:10px;padding:5px 8px">${fecha(f.tomada_en)} ${hora(f.tomada_en)}${f.lat != null ? ` · ${Number(f.lat).toFixed(4)}, ${Number(f.lng).toFixed(4)}` : ''}</div>`;
const CORTO = { gata: 'gata', extintor: 'extintor', documentos: 'documentos', tag: 'TAG', repuesto: 'repuesto' };
const GRUPOS = [['exterior', 'Exterior'], ['esquinas', 'Esquinas'], ['interior', 'Interior y tablero']];

export async function montarComparacion(main, reservaId) {
  const C = await api(`patio/reservas/${reservaId}/comparacion`);
  const R = C.reserva;
  let grupo = 'exterior';
  const nuevos = C.danos_nuevos;
  const antes = C.danos.filter((d) => !d.nuevo);
  const dE = C.entrega, dD = C.devolucion;

  // Tarjetas de diferencias
  const kmGps = dD && dD.km_gps != null && dD.km_gps === dD.km;
  const difKm = C.km_recorridos == null ? '<em>Sin datos de la devolución</em>'
    : C.km_libre ? `<em class="bien">+${miles(C.km_recorridos)} km · kilometraje libre</em>`
      : C.km_extra > 0 ? `<em class="mal">+${miles(C.km_recorridos)} km · ${miles(C.km_extra)} km sobre los ${miles(C.km_incluidos)} incluidos</em>`
        : `<em class="bien">+${miles(C.km_recorridos)} km · dentro de los ${miles(C.km_incluidos)} incluidos</em>`;
  const difComb = C.combustible_devolucion == null ? '<em>Sin datos de la devolución</em>'
    : C.octavos_faltantes > 0 ? `<em class="mal">Faltan ${C.octavos_faltantes}/8${C.litros_faltantes != null ? ` · aprox. ${String(Math.round(C.litros_faltantes)).replace('.', ',')} litros` : ''}</em>` : '<em class="bien">Sin diferencia</em>';
  const difHora = !C.hora_devolucion ? '<em>Aún no se recibe</em>'
    : C.atraso_minutos > C.tolerancia_min ? `<em class="mal">${duracion(C.atraso_minutos)} de atraso · tolerancia ${C.tolerancia_min} min${C.dias_extra > 1 ? ` · ${C.dias_extra} días extra` : ''}</em>`
      : C.atraso_minutos > 0 ? `<em class="bien">${duracion(C.atraso_minutos)} · dentro de la tolerancia</em>` : '<em class="bien">A tiempo</em>';
  const folios = nuevos.map((d) => d.incidente_folio).filter(Boolean);
  const difDanos = nuevos.length ? `<em class="mal">${nuevos.length} daño${nuevos.length > 1 ? 's' : ''} nuevo${nuevos.length > 1 ? 's' : ''} → ${folios.length ? `incidente ${folios.join(', ')}` : 'genera incidente'}</em>` : '<em class="bien">Sin daños nuevos</em>';
  const mismoDia = C.hora_devolucion && fecha(C.hora_pactada) === fecha(C.hora_devolucion);

  const estadoChip = !C.completa ? '<span class="chip st-confirmada">Check-in en curso</span>' : R.estado === 'devuelta' ? '<span class="chip st-devuelta">Check-in en revisión</span>' : `<span class="chip st-${esc(R.estado)}">${R.estado === 'cerrada' ? 'Liquidada' : esc(R.estado)}</span>`;
  const acciones = [
    R.contrato ? `<a class="btn" href="/contratos/${R.contrato.id}">Ver contrato ${esc(R.contrato.folio)}</a>` : `<a class="btn" href="/reservas/${R.id}">Ver reserva ${esc(R.folio)}</a>`,
    !C.completa && puede('patio', 'editar') ? `<a class="btn" href="/patio/${R.id}">Continuar check-in</a>` : '',
    C.completa ? `<a class="btn primario" href="${esc(C.liquidacion_url)}">${R.estado === 'cerrada' ? 'Ver liquidación' : 'Confirmar y pasar a liquidación'}</a>` : ''
  ].join('');

  const filaFotos = (f) => {
    const n = f.danos_nuevos, p = f.danos_previos;
    const txt = n.length ? '<span style="color:var(--red)">Daño nuevo detectado</span>'
      : p.length ? `${p.map((d) => `${TIPOS_DANO[d.tipo]} preexistente (${d.n})`).join(', ')} · sin cambios` : 'Sin diferencias marcadas';
    const img = (x, suc, nuevo) => (x
      ? `<a class="rc-foto${nuevo ? ' nuevo' : ''}" href="/api/archivos/${x.archivo_id}" target="_blank" rel="noopener"><img src="/api/archivos/${x.archivo_id}" alt="" loading="lazy">${x.tomada_en ? sello(x) : ''}${nuevo ? n.map((d, i) => `<span class="rc-circulo-et" style="top:${8 + i * 22}px">${d.n} · ${esc(TIPOS_DANO[d.tipo].toLowerCase())}</span>`).join('') : ''}</a>`
      : '<div class="rc-foto vacia">Sin foto</div>');
    return `<div class="lado">${esc(f.nombre.replace('Costado izq.', 'Costado izquierdo').replace('Costado der.', 'Costado derecho'))}<small>${txt}</small></div>${img(f.entrega, dE?.sucursal)}${img(f.devolucion, dD?.sucursal, n.length > 0)}`;
  };

  const ch = C.checklist;
  const marca = (v, it) => (it.tipo === 'si' ? (v === false ? '✕' : '✓') : it.tipo === 'n' ? String(v ?? '—') : v === 'sucio' ? 'Sucio' : 'Limpio');
  const filasChecklist = () => {
    if (!ch.devolucion) return '<tr><td colspan="3" class="muted">La devolución aún no registra checklist.</td></tr>';
    const e = ch.entrega, d = ch.devolucion;
    const simples = CHECKLIST.filter((it) => it.tipo === 'si');
    const iguales = simples.filter((it) => (e[it.clave] !== false) === (d[it.clave] !== false) && !e.notas?.[it.clave] && !d.notas?.[it.clave]);
    const rows = [];
    const repuesto = simples[0];
    if (iguales.includes(repuesto)) rows.push(`<tr><td>${repuesto.nombre}</td><td>${marca(e.repuesto, repuesto)}</td><td>${marca(d.repuesto, repuesto)}</td></tr>`);
    for (const it of simples.filter((x) => !iguales.includes(x))) {
      const falta = e[it.clave] !== false && d[it.clave] === false;
      rows.push(`<tr><td>${it.nombre}</td><td>${marca(e[it.clave], it)}${e.notas?.[it.clave] ? ` <small class="muted">${esc(e.notas[it.clave])}</small>` : ''}</td><td>${falta ? '<b class="mal">✕ · falta</b>' : marca(d[it.clave], it)}${d.notas?.[it.clave] ? ` <small class="muted">${esc(d.notas[it.clave])}</small>` : ''}</td></tr>`);
    }
    const tri = CHECKLIST.find((x) => x.tipo === 'n');
    rows.push(`<tr><td>${tri.nombre}</td><td>${e.triangulos}</td><td>${ch.triangulos_faltantes ? `<b class="mal">${d.triangulos} · ${ch.triangulos_faltantes === 1 ? 'falta uno' : `faltan ${ch.triangulos_faltantes}`}</b>` : d.triangulos}</td></tr>`);
    const resto = iguales.filter((x) => x !== repuesto);
    if (resto.length) rows.push(`<tr><td>${resto.map((x) => CORTO[x.clave] || x.nombre).join(', ').replace(/^./, (c) => c.toUpperCase())}</td><td>✓</td><td>✓</td></tr>`);
    rows.push(`<tr><td>Limpieza</td><td>${esc(e.notas?.limpieza || (e.limpieza === 'sucio' ? 'Sucio' : 'Limpio'))}</td><td>${d.limpieza === 'sucio' ? `<b class="mal">${esc(d.notas?.limpieza || 'Requiere lavado')}</b>` : esc(d.notas?.limpieza || 'Limpio')}</td></tr>`);
    return rows.join('');
  };
  const nDif = ch.diferencias.length;

  const filaDano = (d) => (d.nuevo
    ? `<div class="rc-dano" style="border-color:#F2C9C4;background:#FFF8F7"><span class="n ${d.tipo} nuevo">${d.n}</span><div><b>${esc(d.titulo)}</b><small>Nuevo${d.zona ? ` · ${esc(d.zona)}` : ''}${dD?.realizado_por ? ` · marcado por ${esc(dD.realizado_por)}` : ''}</small></div>${d.incidente_id ? `<a class="chip error" href="/incidentes/${d.incidente_id}">${esc(d.incidente_folio)}</a>` : '<span class="chip error">Nuevo</span>'}</div>`
    : `<div class="rc-dano"><span class="n ${d.tipo}">${d.n}</span><div><b>${esc(d.titulo)}</b><small>Sin cambios respecto de la entrega</small></div><span class="chip">Igual</span></div>`);

  const recibido = dD ? `${dD.realizado_por ? `recibido por ${esc(dD.realizado_por)} (patio)` : 'recibido'} en sucursal ${esc(dD.sucursal || R.sucursal_devolucion || '')}` : 'devolución pendiente';
  const avisoTxt = nuevos.length
    ? (folios.length
      ? `<b>Se creó el incidente ${nuevos.map((d) => `<a href="/incidentes/${d.incidente_id}">${esc(d.incidente_folio)}</a>`).join(', ')}</b> (${nuevos.map((d) => esc(TIPOS_DANO[d.tipo].toLowerCase())).join(', ')}) ligado ${R.contrato ? `al contrato ${esc(R.contrato.folio)}` : `a la reserva ${esc(R.folio)}`}, con las fotos de entrega y devolución, y pasa a la liquidación con el deducible del cliente.`
      : `<b>Al recibir se crea un incidente por cada daño nuevo</b> ligado ${R.contrato ? `al contrato ${esc(R.contrato.folio)}` : `a la reserva ${esc(R.folio)}`}, con las fotos de entrega y devolución, y pasa a la liquidación con el deducible del cliente.`)
    : 'Sin daños nuevos: la liquidación considera kilometraje, combustible, atraso y checklist.';

  main.innerHTML = `
    <a href="/patio?tab=recientes" class="pt-comp-volver">‹ Entregas y devoluciones de hoy</a>
    <div class="pagina-cab">
      <div>
        <div class="rc-fila"><h1>Devolución · <span class="mono">${esc(R.folio)}</span></h1>${pat(R.vehiculo.patente, true).replace('class="pat grande"', 'class="pat grande" style="font-size:18px"')}${estadoChip}</div>
        <p>${esc(R.cliente.nombre || '')} · ${esc([R.vehiculo.marca, R.vehiculo.modelo, R.vehiculo.anio].filter(Boolean).join(' '))} · ${recibido}</p>
      </div>
      <div class="acciones">${acciones}</div>
    </div>
    <div class="rc-difs">
      <div class="rc-dif"><span>Kilometraje${kmGps ? ' (plataforma GPS)' : ''}</span><div class="par"><s>${miles(C.km_entrega) || '—'}</s>→<b>${miles(C.km_devolucion) || '—'}</b></div>${difKm}</div>
      <div class="rc-dif"><span>Combustible${dD && dD.combustible_gps != null && dD.combustible_gps === dD.combustible ? ' (plataforma GPS)' : ''}</span><div class="par"><s>${C.combustible_entrega ?? '—'}/8</s>→<b>${C.combustible_devolucion ?? '—'}/8</b></div>${difComb}</div>
      <div class="rc-dif"><span>Hora de devolución${mismoDia || !C.hora_devolucion ? '' : ` · pactada ${fecha(C.hora_pactada)}`}</span><div class="par"><s>${hora(C.hora_pactada)}</s>→<b>${C.hora_devolucion ? hora(C.hora_devolucion) : '—'}</b></div>${difHora}</div>
      <div class="rc-dif"><span>Daños</span><div class="par"><s>${C.danos_antes}</s>→<b>${C.danos_despues}</b></div>${difDanos}</div>
    </div>
    <div class="columnas pt-comp-grid" style="grid-template-columns:minmax(0,1fr) 430px">
      <div class="tarjeta bloque">
        <h2>Fotos lado a lado <div class="segmentado" id="grupos">${GRUPOS.map(([k, t]) => `<button type="button" data-g="${k}" aria-pressed="${k === grupo}">${t}</button>`).join('')}</div></h2>
        <div class="rc-comp" id="comp"></div>
      </div>
      <div class="pt-comp-col">
        <div class="tarjeta bloque">
          <h2>Esquema de daños</h2>
          <div class="columnas-2" style="gap:10px;grid-template-columns:repeat(2,minmax(0,1fr))">
            <div><div class="peq muted" style="margin-bottom:4px">Entrega · ${dE?.completado_en ? fecha(dE.completado_en).slice(0, 5) : '—'}</div><div class="rc-esquema">${svgEsquema(antes, { etiquetas: false })}</div></div>
            <div><div class="peq b" style="margin-bottom:4px">Devolución · ${dD?.completado_en ? fecha(dD.completado_en).slice(0, 5) : 'en curso'}</div><div class="rc-esquema" style="border-color:var(--marca-ambar)">${svgEsquema(C.danos, { etiquetas: false })}</div></div>
          </div>
          <div class="rc-danos">${nuevos.map(filaDano).join('')}${antes.map(filaDano).join('')}${!C.danos.length ? '<div class="peq muted">Sin daños registrados.</div>' : ''}</div>
        </div>
        <div class="tarjeta bloque">
          <h2>Checklist ${nDif ? `<span class="chip aviso">${nDif} diferencia${nDif > 1 ? 's' : ''}</span>` : '<span class="chip ok">Sin diferencias</span>'}</h2>
          <table class="tabla"><tr><th>Elemento</th><th>Entrega</th><th>Devolución</th></tr>${filasChecklist()}</table>
          ${dD?.observaciones ? `<p class="peq"><b>Observaciones:</b> ${esc(dD.observaciones)}</p>` : ''}
        </div>
        <div class="aviso ${nuevos.length ? 'info' : 'neutro'}">${avisoTxt}</div>
      </div>
    </div>`;

  const pintarFotos = () => {
    const filas = C.fotos.filter((f) => f.grupo === grupo);
    main.querySelector('#comp').innerHTML = `<div></div>
      <div class="rc-comp-cab">Entrega · ${dE?.completado_en ? `${fechaHora(dE.completado_en)} · ${esc(dE.sucursal || '')}` : 'sin registro'}</div>
      <div class="rc-comp-cab" style="color:var(--ink)">Devolución · ${dD?.completado_en ? `${fechaHora(dD.completado_en)} · ${esc(dD.sucursal || '')}` : 'en curso'}</div>
      ${filas.map(filaFotos).join('')}`;
  };
  main.querySelector('#grupos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    grupo = b.dataset.g;
    main.querySelectorAll('#grupos button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    pintarFotos();
  });
  pintarFotos();
  document.title = `Devolución ${R.folio} · Entregas y devoluciones`;
}
