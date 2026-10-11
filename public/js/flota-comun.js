// Común a Flota, ficha del vehículo y Mantención: celdas de vencimientos, combustible, mantención por km,
// ubicación, formulario de vehículo y cambio de estado.
import { api, esc, fecha, miles, modal, toast, leerForm, patente, chipEstado, ESTADOS_VEHICULO } from '/comun.js';

export const TIPOS_OT = { preventiva: 'Preventiva', correctiva: 'Correctiva', revision_tecnica: 'Revisión técnica', neumaticos: 'Neumáticos', otro: 'Otro' };
export const ESTADOS_OT = { programada: 'Programada', en_taller: 'En taller', terminada: 'Terminada', anulada: 'Anulada' };
export const chipOt = (e) => `<span class="chip ${{ programada: 'info', en_taller: 'st-mantencion', terminada: 'ok', anulada: 'st-cerrada' }[e] || ''}">${esc(ESTADOS_OT[e] || e)}</span>`;

const FORMATOS = [/^[A-Z]{4}\d{2}$/, /^[A-Z]{2}\d{4}$/, /^[A-Z]{3}\d{2}$/, /^[A-Z]{2}\d{3}$/];
export const patenteValida = (p) => FORMATOS.some((re) => re.test(String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')));

// Vencimiento: fecha + «vigente» / «en N días» / «vencida hace N días»
export function venc(f, dias) {
  if (!f) return '<span class="rc-venc"><span class="f muted">—</span><small class="muted" style="font-weight:400">sin fecha</small></span>';
  const c = dias < 0 ? 'vencido' : dias <= 30 ? 'pronto' : 'ok';
  const t = dias < 0 ? `vencida hace ${-dias} ${-dias === 1 ? 'día' : 'días'}` : dias === 0 ? 'vence hoy' : dias <= 30 ? `en ${dias} ${dias === 1 ? 'día' : 'días'}` : 'vigente';
  return `<span class="rc-venc ${c}"><span class="f">${fecha(f)}</span><small>${t}</small></span>`;
}
export const comb = (n) => `<span class="rc-comb" title="${n ?? 0}/8">${Array.from({ length: 8 }, (_, i) => `<i class="${i < (n ?? 0) ? 'on' : ''}"></i>`).join('')}</span>`;

// Próxima mantención por km (barra de avance desde la última)
export function mantKm(v) {
  const m = v.mantencion;
  if (!m?.proxima_km) return '<span class="peq muted">sin plan por km</span>';
  const cada = v.mant_cada_km || 1;
  const pct = Math.max(4, Math.min(100, 100 - (m.faltan_km / cada) * 100));
  const c = m.faltan_km <= 0 ? 'vencido' : m.faltan_km < 1000 ? 'pronto' : '';
  const txt = m.faltan_km <= 0 ? `pasada por ${miles(-m.faltan_km)} km` : `faltan ${miles(m.faltan_km)} km`;
  return `<div class="rc-km"><span class="peq">${miles(m.proxima_km)} km${v.ot_folio ? ` · ${esc(v.ot_folio)}` : ''}</span><div class="rc-km-barra ${c}"><i style="width:${pct}%"></i></div><small class="peq fl-km-txt ${c}">${txt}</small></div>`;
}

export function chipVehiculo(v) {
  if (v.estado === 'arrendado' && v.atrasado) return chipEstado('atrasada', 'Arrendado · atrasado');
  return chipEstado(v.estado, ESTADOS_VEHICULO[v.estado]);
}

const sinSenalDias = (v) => (v.gps_actualizado_en ? Math.floor((Date.now() - Date.parse(v.gps_actualizado_en)) / 864e5) : null);
export function ubicacion(v) {
  const d = sinSenalDias(v);
  const conGps = d != null && d < 1;
  let txt;
  if (v.estado === 'mantencion' && v.ot_taller) txt = esc(v.ot_taller);
  else if (v.estado === 'arrendado' || v.reserva_id) txt = `En ruta${v.gps_direccion ? ` · ${esc(v.gps_direccion)}` : v.gps_velocidad ? ` · ${v.gps_velocidad} km/h` : ''}`;
  else txt = esc(v.sucursal || 'Sin sucursal');
  if (d != null && d >= 1) txt += ` · sin señal ${d} ${d === 1 ? 'día' : 'días'}`;
  if (!v.gps_unidad_id) txt += ' · sin GPS';
  return `<span class="rc-fila fl-ubic"><span class="rc-gps-punto ${conGps ? '' : 'off'}"></span><span class="peq">${txt}</span></span>`;
}

// Catálogo para el formulario (se carga una vez)
let CAT = null;
export async function catalogoFlota() {
  if (!CAT) {
    const [categorias, catalogo, propietarios] = await Promise.all([api('categorias'), api('catalogo'), api('propietarios').catch(() => [])]);
    CAT = { categorias, sucursales: catalogo.sucursales, propietarios };
  }
  return CAT;
}

const opciones = (lista, sel, vacio) => `${vacio ? `<option value="">${esc(vacio)}</option>` : ''}${lista.map((x) => `<option value="${x.id}"${String(x.id) === String(sel ?? '') ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}`;
const campo = (nombre, etiqueta, v, { tipo = 'text', clase = '', extra = '' } = {}) =>
  `<label class="etiqueta ${clase}">${etiqueta}<input class="campo" name="${nombre}" type="${tipo}" value="${esc(v ?? '')}" ${extra}></label>`;

// Abre el formulario de vehículo (nuevo o edición). Devuelve el vehículo guardado o null.
export async function formVehiculo(v = null, { foco = null } = {}) {
  const c = await catalogoFlota();
  const x = v || { combustible_tipo: 'bencina', mant_cada_km: 10000, mant_cada_meses: 12, combustible_nivel: 8, km: 0, mant_ultima_km: 0 };
  const sel = (n, et, html, clase = '') => `<label class="etiqueta ${clase}">${et}<select class="campo" name="${n}">${html}</select></label>`;
  const opt = (vals, actual) => vals.map(([k, t]) => `<option value="${k}"${k === (actual ?? '') ? ' selected' : ''}>${t}</option>`).join('');
  const html = `
    <h3 class="fl-form-tit">Identificación</h3>
    <div class="fl-form">
      ${campo('patente', 'Patente *', x.patente ? patente(x.patente) : '', { clase: 'fl-pat', extra: 'placeholder="SXLR-27" autocomplete="off" required' })}
      ${campo('marca', 'Marca', x.marca, { extra: 'placeholder="Kia"' })}
      ${campo('modelo', 'Modelo', x.modelo, { extra: 'placeholder="Morning"' })}
      ${campo('anio', 'Año', x.anio, { tipo: 'number', extra: 'min="1980" max="2100"' })}
      ${sel('categoria_id', 'Categoría', opciones(c.categorias.filter((k) => k.activa || k.id === x.categoria_id), x.categoria_id, 'Sin categoría'))}
      ${campo('color', 'Color', x.color)}
      ${sel('transmision', 'Transmisión', opt([['', '—'], ['Manual', 'Manual'], ['Automático', 'Automático']], x.transmision))}
      ${sel('combustible_tipo', 'Combustible', opt([['bencina', 'Bencina'], ['diesel', 'Diésel'], ['hibrido', 'Híbrido'], ['electrico', 'Eléctrico'], ['gas', 'Gas']], x.combustible_tipo))}
      ${campo('vin', 'VIN (chasis)', x.vin, { clase: 'doble' })}
      ${campo('motor', 'N° de motor', x.motor)}
      ${campo('capacidad_estanque', 'Estanque (litros)', x.capacidad_estanque, { tipo: 'number', extra: 'min="0"' })}
    </div>
    <h3 class="fl-form-tit">Operación</h3>
    <div class="fl-form">
      ${sel('sucursal_id', 'Sucursal', opciones(c.sucursales, x.sucursal_id, 'Sin sucursal'))}
      ${sel('propietario_id', 'Propietario / inversionista', opciones(c.propietarios.filter((p) => p.activo || p.id === x.propietario_id), x.propietario_id, 'Propio de la empresa'))}
      ${campo('km', 'Kilometraje', x.km, { tipo: 'number', extra: 'min="0"' })}
      ${sel('combustible_nivel', 'Combustible (octavos)', opt([...Array(9)].map((_, i) => [String(i), `${i}/8`]), String(x.combustible_nivel ?? 8)))}
      ${campo('tag_numero', 'N° de TAG', x.tag_numero)}
      ${campo('gps_unidad_id', 'ID unidad en plataforma GPS', x.gps_unidad_id)}
    </div>
    <h3 class="fl-form-tit">Documentos y vencimientos</h3>
    <div class="fl-form">
      ${campo('venc_revision_tecnica', 'Revisión técnica vence', x.venc_revision_tecnica, { tipo: 'date' })}
      ${campo('venc_permiso_circulacion', 'Permiso de circulación vence', x.venc_permiso_circulacion, { tipo: 'date' })}
      ${campo('venc_soap', 'SOAP vence', x.venc_soap, { tipo: 'date' })}
      ${campo('venc_seguro', 'Seguro vence', x.venc_seguro, { tipo: 'date' })}
      ${campo('seguro_compania', 'Compañía de seguro', x.seguro_compania, { clase: 'doble' })}
      ${campo('seguro_poliza', 'N° de póliza', x.seguro_poliza, { clase: 'doble' })}
    </div>
    <h3 class="fl-form-tit">Plan de mantención</h3>
    <div class="fl-form">
      ${campo('mant_cada_km', 'Cada (km)', x.mant_cada_km, { tipo: 'number', extra: 'min="0" step="1000"' })}
      ${campo('mant_ultima_km', 'Última a los (km)', x.mant_ultima_km, { tipo: 'number', extra: 'min="0"' })}
      ${campo('mant_cada_meses', 'O cada (meses)', x.mant_cada_meses, { tipo: 'number', extra: 'min="0"' })}
      ${campo('mant_ultima_fecha', 'Última mantención (fecha)', x.mant_ultima_fecha, { tipo: 'date' })}
    </div>
    <label class="etiqueta">Notas<textarea class="campo" name="notas" rows="2">${esc(x.notas || '')}</textarea></label>`;
  return modal({
    titulo: v ? `Editar ${patente(v.patente)}` : 'Agregar vehículo', html, ancho: true,
    botones: [{ texto: 'Cancelar' }, {
      texto: v ? 'Guardar cambios' : 'Agregar vehículo', clase: 'primario', accion: async (cuerpo) => {
        cuerpo.querySelectorAll('.fl-error').forEach((e) => e.classList.remove('fl-error'));
        const d = leerForm(cuerpo);
        if (!patenteValida(d.patente)) return marcarError(cuerpo, 'patente', 'La patente no tiene un formato chileno válido (ej.: SXLR-27 o AB-1234).');
        try {
          const r = await api(v ? `vehiculos/${v.id}` : 'vehiculos', { method: v ? 'PUT' : 'POST', body: d });
          toast(v ? 'Vehículo actualizado' : `Vehículo ${patente(r.patente)} agregado`, 'ok');
          return r;
        } catch (e) { return marcarError(cuerpo, e.campo, e.message); }
      }
    }],
    alAbrir: (cuerpo) => {
      const p = cuerpo.querySelector('[name=patente]');
      p.addEventListener('blur', () => { p.value = patente(p.value); p.closest('label').classList.toggle('fl-error', !!p.value && !patenteValida(p.value)); });
      if (foco) setTimeout(() => { const f = cuerpo.querySelector(`[name=${foco}]`); f?.focus(); f?.scrollIntoView({ block: 'center' }); }, 30);
    }
  });
}

export function marcarError(cuerpo, campoNombre, msg) {
  const c = campoNombre && cuerpo.querySelector(`[name="${campoNombre}"]`);
  if (c) { c.closest('label')?.classList.add('fl-error'); c.focus(); }
  toast(msg, 'error');
  return false;
}

// Cambio manual de estado con motivo
export async function cambiarEstado(v) {
  const html = `<p class="muted peq">El estado <b>arrendado</b> y <b>reservado</b> lo manejan las reservas, y <b>en mantención</b> las órdenes de trabajo. Úsalo para correcciones o para sacar un vehículo de servicio.</p>
    <div class="fl-estados">${Object.entries(ESTADOS_VEHICULO).map(([k, t]) => `<label class="fl-estado-op"><input type="radio" name="estado" value="${k}"${k === v.estado ? ' checked' : ''}> ${chipEstado(k, t)}</label>`).join('')}</div>
    <label class="etiqueta">Motivo (queda en la bitácora del vehículo)<textarea class="campo" name="motivo" rows="2" placeholder="Ej.: falla de embrague, espera repuesto"></textarea></label>`;
  return modal({
    titulo: `Cambiar estado de ${patente(v.patente)}`, html,
    botones: [{ texto: 'Cancelar' }, { texto: 'Cambiar estado', clase: 'primario', accion: async (c) => {
      const d = leerForm(c);
      if (d.estado === v.estado) { toast('Elige un estado distinto', 'error'); return false; }
      try { await api(`vehiculos/${v.id}/estado`, { body: d }); toast('Estado actualizado', 'ok'); return true; } catch (e) { return marcarError(c, e.campo, e.message); }
    } }]
  });
}
