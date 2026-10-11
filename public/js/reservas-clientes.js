// Formulario de cliente (persona o empresa; RUT con dígito verificador, pasaporte o DNI) reutilizado en
// Clientes y en «Nueva reserva» (alta en línea).
import { api, esc, modal, toast, leerForm, validarRut, rut } from '/comun.js';

const v = (c, k) => esc(c?.[k] ?? '');
const opt = (val, txt, sel) => `<option value="${val}"${String(sel) === String(val) ? ' selected' : ''}>${txt}</option>`;

export function htmlFormCliente(c = {}, { compacto = false } = {}) {
  const tipo = c.tipo || 'persona', dt = c.documento_tipo || 'rut';
  return `<div class="rs-form-cliente" data-tipo="${tipo}">
    <div class="campos">
      <label>Tipo<select class="campo" name="tipo">${opt('persona', 'Persona', tipo)}${opt('empresa', 'Empresa (factura)', tipo)}</select></label>
      <label>Documento<select class="campo" name="documento_tipo">${opt('rut', 'RUT', dt)}${opt('pasaporte', 'Pasaporte (extranjero)', dt)}${opt('dni', 'DNI (Argentina u otro)', dt)}</select></label>
      <label style="flex:1 1 170px">Número<input class="campo mono" name="documento" value="${dt === 'rut' && c.documento ? rut(c.documento) : v(c, 'documento')}" placeholder="12.345.678-9" autocomplete="off" required><small class="rs-doc-ayuda"></small></label>
    </div>
    <div class="campos">
      <label style="flex:1 1 200px"><span class="rs-et-nombre">${tipo === 'empresa' ? 'Razón social o nombre de fantasía' : 'Nombre'}</span><input class="campo" name="nombre" value="${v(c, 'nombre')}" required></label>
      <label style="flex:1 1 200px" class="rs-persona">Apellidos<input class="campo" name="apellidos" value="${v(c, 'apellidos')}"></label>
    </div>
    <div class="campos">
      <label style="flex:1 1 200px">Correo<input class="campo" type="email" name="correo" value="${v(c, 'correo')}"></label>
      <label style="flex:1 1 160px">Teléfono (WhatsApp)<input class="campo" type="tel" name="telefono" value="${v(c, 'telefono')}" placeholder="+56 9 1234 5678"></label>
      <label class="rs-persona" style="flex:0 1 160px">Fecha de nacimiento<input class="campo" type="date" name="fecha_nacimiento" value="${v(c, 'fecha_nacimiento')}"></label>
      <label class="rs-persona" style="flex:0 1 150px">Nacionalidad<input class="campo" name="nacionalidad" value="${esc(c.nacionalidad || 'Chile')}"></label>
    </div>
    <div class="campos rs-persona">
      <label style="flex:1 1 150px">Licencia N°<input class="campo mono" name="licencia_numero" value="${v(c, 'licencia_numero')}"></label>
      <label style="flex:0 1 110px">Clase<input class="campo" name="licencia_clase" value="${esc(c.licencia_clase || 'B')}"></label>
      <label style="flex:0 1 160px">Vence<input class="campo" type="date" name="licencia_vence" value="${v(c, 'licencia_vence')}"></label>
      <label style="flex:0 1 150px">País de emisión<input class="campo" name="licencia_pais" value="${esc(c.licencia_pais || 'Chile')}"></label>
    </div>
    ${compacto ? '' : `<div class="campos">
      <label style="flex:2 1 240px">Dirección<input class="campo" name="direccion" value="${v(c, 'direccion')}"></label>
      <label style="flex:1 1 140px">Comuna<input class="campo" name="comuna" value="${v(c, 'comuna')}"></label>
      <label style="flex:1 1 140px">Ciudad<input class="campo" name="ciudad" value="${v(c, 'ciudad')}"></label>
      <label style="flex:1 1 120px">País<input class="campo" name="pais" value="${esc(c.pais || 'Chile')}"></label>
    </div>
    <div class="campos rs-empresa">
      <label style="flex:1 1 220px">Razón social (factura)<input class="campo" name="razon_social" value="${v(c, 'razon_social')}"></label>
      <label style="flex:1 1 220px">Giro<input class="campo" name="giro" value="${v(c, 'giro')}"></label>
    </div>
    <label class="etiqueta">Notas internas<textarea class="campo" name="notas" rows="2">${v(c, 'notas')}</textarea></label>`}
  </div>`;
}

export function activarFormCliente(el) {
  const caja = el.querySelector('.rs-form-cliente');
  const tipo = caja.querySelector('[name=tipo]'), dt = caja.querySelector('[name=documento_tipo]'), doc = caja.querySelector('[name=documento]'), ayuda = caja.querySelector('.rs-doc-ayuda');
  const validar = () => {
    if (dt.value !== 'rut' || !doc.value.trim()) { ayuda.textContent = ''; doc.classList.remove('rs-mal'); return true; }
    const ok = validarRut(doc.value);
    ayuda.textContent = ok ? '✓ RUT válido' : 'RUT inválido: revisa el dígito verificador';
    ayuda.className = `rs-doc-ayuda ${ok ? 'rs-bien' : 'rs-mal-txt'}`;
    doc.classList.toggle('rs-mal', !ok);
    return ok;
  };
  const pintar = () => {
    caja.dataset.tipo = tipo.value;
    caja.querySelector('.rs-et-nombre').textContent = tipo.value === 'empresa' ? 'Razón social o nombre de fantasía' : 'Nombre';
    doc.placeholder = dt.value === 'rut' ? '12.345.678-9' : dt.value === 'pasaporte' ? 'N° de pasaporte' : 'N° de DNI';
    validar();
  };
  tipo.onchange = pintar; dt.onchange = pintar;
  doc.addEventListener('input', validar);
  doc.addEventListener('blur', () => { if (dt.value === 'rut' && validarRut(doc.value)) doc.value = rut(doc.value); });
  pintar();
  return { validar };
}

export function leerFormCliente(el) {
  const caja = el.querySelector('.rs-form-cliente');
  const d = leerForm(caja);
  if (d.tipo === 'empresa') d.apellidos = '';
  if (!d.documento) throw new Error('Falta el número de documento');
  if (d.documento_tipo === 'rut' && !validarRut(d.documento)) throw new Error('El RUT no es válido: revisa el dígito verificador');
  if (!d.nombre) throw new Error('Falta el nombre');
  return d;
}

/** Modal de alta o edición de cliente → cliente guardado (o null). */
export function abrirFormCliente(cliente = null) {
  return modal({
    titulo: cliente?.id ? 'Editar cliente' : 'Nuevo cliente', ancho: true, html: htmlFormCliente(cliente || {}),
    alAbrir: (cuerpo) => { activarFormCliente(cuerpo); },
    botones: [{ texto: 'Cancelar' }, {
      texto: cliente?.id ? 'Guardar cambios' : 'Crear cliente', clase: 'primario', accion: async (cuerpo) => {
        const d = leerFormCliente(cuerpo);
        const r = cliente?.id ? await api(`clientes/${cliente.id}`, { method: 'PATCH', body: d }) : await api('clientes', { body: d });
        toast(cliente?.id ? 'Cliente actualizado' : 'Cliente creado', 'ok');
        return r;
      }
    }]
  });
}
