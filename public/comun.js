// Común a todas las páginas internas: estructura (menú lateral + barra), llamadas a la API, formato chileno,
// avisos (toast), modales y chips de estado. Mismo estilo que el CRM Síguelo Gestión.
// Uso en cada página:  import { iniciarPagina, api, clp } from '/comun.js';
//                      const yo = await iniciarPagina({ activo: 'reservas', titulo: 'Reservas' });
import { esNativa, guardarYCompartir, abrirArchivo } from '/nativa.js';

export { esNativa, abrirArchivo };

const I = (d, extra = '') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
export const ICONOS = {
  inicio: I('<path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z"/>'),
  reservas: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/><path d="M7 14h6M10 17h7"/>'),
  patio: I('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><path d="M10 9l1.5 1.5L14 8"/>'),
  contratos: I('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 17c1.5-2 2.5-2 3 0s1.5 1 3-1"/>'),
  clientes: I('<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 6 5"/>'),
  flota: I('<path d="M5 17h14M3 13l2-6h14l2 6v4H3z"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>'),
  mantencion: I('<path d="M14.7 6.3a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.7-6.7z"/><path d="M4 20l5-5"/>'),
  gps: I('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  pagos: I('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>'),
  liquidaciones: I('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  facturacion: I('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>'),
  incidentes: I('<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>'),
  tag_multas: I('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
  reportes: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  tarifas: I('<path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  configuracion: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  empresas: I('<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/><path d="M9 11h2M13 11h2"/>'),
  apps: I('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><path d="M3 8h2M3 12h2M19 8h2M19 12h2"/>'),
  'apps-marca': I('<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><path d="M10 7l2-2 2 2M12 5v6"/>'),
  planes: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 13h3M8 16h6"/>'),
  equipo: I('<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 6 5"/>'),
  ojo: I('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', ' width="18" height="18"'),
  plegar: I('<path d="M15 6l-6 6 6 6"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  buscar: I('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>', ' width="16" height="16"'),
  campana: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>', ' width="16" height="16"'),
  ok: I('<path d="M5 12l4 4L19 7"/>', ' width="16" height="16"'),
  mas: I('<path d="M12 5v14M5 12h14"/>', ' width="16" height="16"'),
  salir: I('<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M9 12h9"/>', ' width="18" height="18"'),
  camara: I('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>')
};

// Menú: [grupo, [[módulo/permiso, nombre, href]]]
const MENU = [
  ['Operación', [['inicio', 'Inicio', '/inicio'], ['reservas', 'Reservas', '/reservas'], ['patio', 'Entregas y devoluciones', '/patio'], ['contratos', 'Contratos', '/contratos'], ['clientes', 'Clientes', '/clientes']]],
  ['Flota', [['flota', 'Vehículos', '/vehiculos'], ['mantencion', 'Mantención', '/mantencion'], ['gps', 'Plataforma GPS', '/gps']]],
  ['Finanzas', [['pagos', 'Pagos y garantías', '/pagos'], ['liquidaciones', 'Liquidaciones', '/liquidaciones'], ['facturacion', 'Facturación', '/facturacion'], ['incidentes', 'Incidentes y daños', '/incidentes'], ['tag_multas', 'TAG y multas', '/tag-multas']]],
  ['Gestión', [['reportes', 'Reportes', '/reportes'], ['tarifas', 'Tarifas', '/tarifas'], ['apps', 'Apps', '/apps'], ['configuracion', 'Configuración', '/configuracion']]]
];

// ── API ──
export async function api(ruta, { method, body, crudo = false } = {}) {
  const r = await fetch(ruta.startsWith('/') ? ruta : `/api/${ruta}`, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin'
  });
  if (r.status === 401 && !location.pathname.startsWith('/ingresar')) { location.href = `/ingresar?volver=${encodeURIComponent(location.pathname + location.search)}`; throw new Error('Sesión terminada'); }
  if (crudo) return r;
  const j = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error(j?.error || `Error ${r.status}`), { estado: r.status, campo: j?.campo });
  return j;
}

// ── Formato chileno ──
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clp = (n) => (n == null || n === '' ? '' : `${Number(n) < 0 ? '−' : ''}$${Math.abs(Math.round(Number(n))).toLocaleString('es-CL')}`);
export const miles = (n) => (n == null || n === '' ? '' : Math.round(Number(n)).toLocaleString('es-CL'));
const partes = (d) => Object.fromEntries(new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d)).map((p) => [p.type, p.value]));
export function fecha(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [a, m, d] = v.split('-'); return `${d}-${m}-${a}`; }
  const p = partes(v); return `${p.day}-${p.month}-${p.year}`;
}
export const hora = (v) => { if (!v) return ''; const p = partes(v); return `${p.hour}:${p.minute}`; };
export const fechaHora = (v) => (v ? `${fecha(v)} ${hora(v)}` : '');
// Para <input type="date"> y <input type="time"> en hora de Chile
export const isoLocal = (v) => { const p = partes(v); return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }; };
export const diasHasta = (fechaIso) => { if (!fechaIso) return null; const hoy = isoLocal(new Date()).fecha; return Math.round((Date.parse(fechaIso) - Date.parse(hoy)) / 864e5); };
export function rut(r) {
  const l = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (l.length < 2) return r || '';
  return `${l.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${l.slice(-1)}`;
}
export function validarRut(r) {
  const l = String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (l.length < 2 || !/^\d{6,9}$/.test(l.slice(0, -1))) return false;
  let s = 0, m = 2;
  for (const d of l.slice(0, -1).split('').reverse()) { s += Number(d) * m; m = m === 7 ? 2 : m + 1; }
  const res = 11 - (s % 11);
  return (res === 11 ? '0' : res === 10 ? 'K' : String(res)) === l.slice(-1);
}
export function patente(p) {
  const n = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{4}\d{2}$/.test(n) || /^[A-Z]{2}\d{4}$/.test(n)) return `${n.slice(0, 4)}-${n.slice(4)}`;
  return n;
}
export const pat = (p, grande = false) => `<span class="pat${grande ? ' grande' : ''}">${esc(patente(p))}</span>`;
export const documento = (tipo, doc) => (tipo === 'rut' ? rut(doc) : `${tipo === 'pasaporte' ? 'Pasaporte' : 'DNI'} ${esc(doc)}`);

// ── Estados (chips) ──
export const ESTADOS_RESERVA = { cotizacion: 'Cotización', confirmada: 'Confirmada', en_curso: 'En curso', devuelta: 'Devuelta', cerrada: 'Cerrada', cancelada: 'Cancelada', no_show: 'No se presentó' };
export const ESTADOS_VEHICULO = { disponible: 'Disponible', arrendado: 'Arrendado', reservado: 'Reservado', mantencion: 'En mantención', fuera_servicio: 'Fuera de servicio' };
const CLASE = { cotizacion: 'st-cotizacion', confirmada: 'st-confirmada', en_curso: 'st-en_curso', devuelta: 'st-devuelta', cerrada: 'st-cerrada', cancelada: 'st-cancelada', no_show: 'st-noshow',
  disponible: 'st-disponible', arrendado: 'st-arrendado', reservado: 'st-reservado', mantencion: 'st-mantencion', fuera_servicio: 'st-fuera', atrasada: 'st-atrasada' };
export const chipEstado = (estado, texto = null) => `<span class="chip ${CLASE[estado] || ''}">${esc(texto || ESTADOS_RESERVA[estado] || ESTADOS_VEHICULO[estado] || estado)}</span>`;

// ── Avisos y modales ──
export function toast(msg, tipo = '') {
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), tipo === 'error' ? 6000 : 3500);
}
export const toastError = (e) => toast(e?.message || String(e), 'error');

// modal({ titulo, html, botones: [{ texto, clase, accion(cuerpo) → false para no cerrar }], ancho })
export function modal({ titulo, html = '', botones = [{ texto: 'Cerrar' }], ancho = false, alAbrir = null }) {
  return new Promise((resolve) => {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.innerHTML = `<div class="modal${ancho ? ' ancho' : ''}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="modal-cab"><h2>${esc(titulo)}</h2><button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">${ICONOS.x}</button></div>
      <div class="modal-cuerpo">${html}</div>
      <div class="modal-pie">${botones.map((b, i) => `<button type="button" class="btn ${b.clase || ''}" data-i="${i}">${esc(b.texto)}</button>`).join('')}</div></div>`;
    const cerrar = (v) => { fondo.remove(); document.removeEventListener('keydown', tecla); resolve(v); };
    const tecla = (e) => { if (e.key === 'Escape') cerrar(null); };
    document.addEventListener('keydown', tecla);
    fondo.addEventListener('click', async (e) => {
      if (e.target === fondo || e.target.closest('[data-cerrar]')) return cerrar(null);
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const def = botones[Number(b.dataset.i)];
      if (def.accion) {
        b.disabled = true;
        try { const r = await def.accion(fondo.querySelector('.modal-cuerpo')); if (r === false) { b.disabled = false; return; } cerrar(r ?? true); }
        catch (err) { b.disabled = false; toastError(err); }
      } else cerrar(def.valor ?? null);
    });
    document.body.appendChild(fondo);
    alAbrir?.(fondo.querySelector('.modal-cuerpo'));
    fondo.querySelector('input, select, textarea')?.focus();
  });
}
export const confirmar = (titulo, texto, { boton = 'Confirmar', peligro = false } = {}) =>
  modal({ titulo, html: `<p>${texto}</p>`, botones: [{ texto: 'Cancelar', valor: false }, { texto: boton, clase: peligro ? 'peligro' : 'primario', valor: true }] }).then((v) => v === true);

// Lee los campos [name] de un contenedor → objeto
export function leerForm(el) {
  const o = {};
  el.querySelectorAll('[name]').forEach((c) => {
    if (c.type === 'checkbox') o[c.name] = c.checked;
    else if (c.type === 'radio') { if (c.checked) o[c.name] = c.value; }
    else o[c.name] = c.value.trim();
  });
  return o;
}

// Imagen (File) → data URL JPEG reducida (fotos de celular de 4000 px pesan mucho)
export function reducirImagen(archivo, maxLado = 1600, calidad = 0.82) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL('image/jpeg', calidad));
    };
    img.onerror = mal;
    img.src = URL.createObjectURL(archivo);
  });
}

// Descarga una respuesta binaria (Excel, PDF)
export async function descargar(ruta, nombre) {
  const r = await api(ruta, { crudo: true });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Error ${r.status}`); }
  if (esNativa()) return guardarYCompartir(await r.blob(), nombre); // en la app: guardar en el teléfono y compartir/abrir
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Estructura de la página ──
let YO = null;
export const yo = () => YO;
export const puede = (modulo, accion = 'ver') => { const n = YO?.permisos?.[modulo]; return accion === 'ver' ? !!n : n === 'editar'; };

// Páginas del backoffice Síguelo (sin empresa). Cualquier otra página exige estar dentro de una empresa.
const BACKOFFICE = [['empresas', 'Empresas', '/empresas'], ['planes', 'Planes', '/planes'], ['apps-marca', 'Apps con marca', '/apps-marca'], ['equipo', 'Equipo Síguelo', '/equipo']];

export async function iniciarPagina({ activo, titulo = '' } = {}) {
  YO = await api('yo');
  // Franja «Abierto desde tu plataforma de rastreo» (solo si la sesión vino del menú Apps; ver franja-plataforma.js).
  if (!document.getElementById('rc-franja-plataforma')) { const s = document.createElement('script'); s.id = 'rc-franja-plataforma'; s.src = '/franja-plataforma.js'; document.head.appendChild(s); }
  const enBackoffice = BACKOFFICE.some(([m]) => m === activo);
  if (YO.modo === 'backoffice' && !enBackoffice) { location.replace('/empresas'); await new Promise(() => {}); }
  if (YO.modo === 'cliente' && !YO.siguelo && enBackoffice) { location.replace('/inicio'); await new Promise(() => {}); }
  const main = document.querySelector('main') || document.body;
  const iniciales = YO.usuario.nombre.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const e = YO.empresa;
  const plegada = (() => { try { return localStorage.getItem('rc_menu_plegado') === '1'; } catch { return false; } })();
  const app = document.createElement('div');
  app.className = `app${plegada ? ' plegada' : ''}`;
  app.innerHTML = `
  <nav class="menu" aria-label="Menú principal">
    <div class="menu-marca"><img class="logo" src="/img/logo-siguelo.png" alt="Síguelo GPS"><img class="marca-pin" src="/img/logo-pin.png" alt=""><button type="button" class="btn-plegar" aria-label="Plegar menú">${ICONOS.plegar}</button></div>
    ${e ? `<div class="rc-empresa" title="${esc(e.nombre)}">${e.logo_clave ? `<img class="rc-empresa-logo" src="/api/logo/${esc(e.slug)}" alt="">` : `<span class="rc-empresa-logo" style="background:${esc(e.color || '#0F5F58')}">${esc(e.nombre.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase())}</span>`}<div><b>${esc(e.nombre)}</b><span>On Rent · Plan ${esc(YO.plan?.nombre || (e.plan || 'pro').replace(/^./, (c) => c.toUpperCase()))}</span></div></div>` : ''}
    ${YO.modo === 'backoffice' ? `<div class="menu-grupo">Backoffice Síguelo</div>${BACKOFFICE.filter(([m]) => m !== 'equipo' || YO.usuario.rol === 'superadmin').map(([m, n, href]) => `<a class="item" href="${href}" title="${n}"${m === activo ? ' aria-current="page"' : ''}>${ICONOS[m]}<span>${n}</span></a>`).join('')}`
    : MENU.map(([g, items]) => {
      const vis = items.filter(([m]) => YO.permisos[m] || (m === 'apps' && YO.permisos.configuracion));
      return vis.length ? `<div class="menu-grupo">${g}</div>${vis.map(([m, n, href]) => `<a class="item" href="${href}" title="${n}"${m === activo ? ' aria-current="page"' : ''}>${ICONOS[m]}<span>${n}</span></a>`).join('')}` : '';
    }).join('')}
    <div class="menu-pie">
      <button type="button" class="menu-usuario" id="rc-usuario"><span class="avatar">${esc(iniciales)}</span><div><b>${esc(YO.usuario.nombre)}</b><span>${esc(YO.usuario.rol_nombre)}</span></div></button>
    </div>
  </nav>
  <div class="principal">
    <header class="barra">
      <button type="button" class="btn-icono btn-menu-movil" aria-label="Abrir menú">${ICONOS.menu}</button>
      <span class="titulo">${esc(titulo)}</span>
      ${YO.modo === 'backoffice' ? '<span class="chip marca">Backoffice Síguelo</span>' : `<div class="buscar">${ICONOS.buscar}<input id="rc-buscar" placeholder="Buscar patente, RUT, cliente o folio…" autocomplete="off"><div class="buscar-res" id="rc-buscar-res" hidden></div></div>`}
      <div class="acciones">
        <span id="rc-tema"></span>
        ${e?.marcha_blanca ? '<a class="chip rc-marcha" href="/configuracion#integraciones" title="Correos, WhatsApp, cobros y documentos tributarios detenidos hasta desactivarla">● Marcha blanca</a>' : ''}
      </div>
    </header>
    ${YO.ver_como ? `<div class="rc-ver-como" role="status">${ICONOS.ojo}<span>Estás viendo la cuenta de <b>${esc(e?.nombre || '')}</b> como equipo Síguelo. Lo que hagas queda registrado a tu nombre en su bitácora.</span><button type="button" class="btn peq" id="rc-salir-ver-como">Volver al backoffice</button></div>` : ''}
  </div>`;
  main.classList.add('contenido');
  app.querySelector('.principal').appendChild(main);
  document.body.prepend(app);
  document.title = `${titulo ? `${titulo} · ` : ''}${e?.nombre || 'Síguelo On Rent'}`;

  app.querySelector('.btn-plegar').onclick = () => { app.classList.toggle('plegada'); try { localStorage.setItem('rc_menu_plegado', app.classList.contains('plegada') ? '1' : '0'); } catch { /* sin almacenamiento */ } };
  app.querySelector('.btn-menu-movil').onclick = () => app.classList.toggle('menu-abierto');
  app.querySelector('#rc-usuario').onclick = abrirMiCuenta;
  // Tema Automático / Claro / Oscuro (lo maneja /tema.js, cargado en el <head>).
  if (window.SigueloTema) app.querySelector('#rc-tema').replaceWith(window.SigueloTema.boton());
  else app.querySelector('#rc-tema').remove();
  app.querySelector('#rc-salir-ver-como')?.addEventListener('click', async () => { const r = await api('empresa-activa', { body: { empresa_id: null } }); location.href = r.destino || '/empresas'; });
  if (YO.modo !== 'backoffice') activarBuscador(app);
  return YO;
}

// «Mi cuenta» (igual que en los demás sistemas Síguelo): cambiar la clave y salir.
const OJO = I('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', ' width="18" height="18"');
function abrirMiCuenta() {
  const campo = (name, etiqueta, ac) => `<label class="etiqueta">${etiqueta}<span class="rc-clave"><input class="campo" type="password" name="${name}" autocomplete="${ac}"><button type="button" class="rc-ojo" aria-label="Mostrar u ocultar la clave" tabindex="-1">${OJO}</button></span></label>`;
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `<form class="modal" style="width:min(720px,100%)" role="dialog" aria-modal="true" aria-label="Mi cuenta">
    <div class="modal-cab"><h2>Mi cuenta</h2><button type="button" class="btn-icono" data-cerrar aria-label="Cerrar">${ICONOS.x}</button></div>
    <div class="modal-cuerpo">
      <p class="peq muted">${esc(YO.usuario.nombre)} · ${esc(YO.usuario.correo)}</p>
      ${campo('actual', 'Clave actual', 'current-password')}
      ${campo('nueva', 'Clave nueva (mínimo 10 caracteres)', 'new-password')}
      ${campo('repite', 'Repite la clave nueva', 'new-password')}
      <div class="aviso error" data-err hidden></div>
      ${YO.usuario.rol === 'superadmin' ? '' : `<details class="rc-eliminar-cuenta"><summary>Eliminar mi cuenta</summary>
        <p class="peq muted">Se borran tu nombre, correo, teléfono y clave, y se cierran tus sesiones en todos los equipos. No se puede deshacer. Los contratos, inspecciones y movimientos que hiciste quedan en la empresa a nombre de «Usuario eliminado».</p>
        <label class="etiqueta">Escribe tu clave para confirmar<input class="campo" type="password" name="clave_eliminar" autocomplete="current-password"></label>
        <button type="button" class="btn peligro" data-eliminar>Eliminar mi cuenta definitivamente</button></details>`}
    </div>
    <div class="modal-pie rc-pie-cuenta"><button type="button" class="btn" data-salir>${ICONOS.salir} Salir</button><button type="submit" class="btn primario">${ICONOS.ok} Cambiar clave</button></div></form>`;
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', tecla);
  fondo.addEventListener('click', async (e) => {
    if (e.target === fondo || e.target.closest('[data-cerrar]')) return cerrar();
    const ojo = e.target.closest('.rc-ojo');
    if (ojo) { const inp = ojo.previousElementSibling; inp.type = inp.type === 'password' ? 'text' : 'password'; return; }
    // Si la sesión se abrió desde el menú Apps de la plataforma GPS, «Salir» vuelve allá (franja-plataforma.js).
    if (e.target.closest('[data-salir]')) { await api('salir', { body: {} }).catch(() => {}); location.href = (window.salidaPlataforma && window.salidaPlataforma()) || '/ingresar'; }
    if (e.target.closest('[data-eliminar]')) {
      err.hidden = true;
      const clave = f.clave_eliminar.value;
      if (!clave) { err.textContent = 'Escribe tu clave para confirmar.'; err.hidden = false; return; }
      if (!await confirmar('Eliminar mi cuenta', 'Tu cuenta se elimina ahora y no podrás volver a ingresar con ella. ¿Continuar?', { boton: 'Eliminar', peligro: true })) return;
      try { await api('configuracion/eliminar-mi-cuenta', { body: { clave } }); location.href = '/ingresar?cuenta=eliminada'; }
      catch (e2) { err.textContent = e2.message; err.hidden = false; }
    }
  });
  const f = fondo.querySelector('form'), err = fondo.querySelector('[data-err]');
  f.onsubmit = async (e) => {
    e.preventDefault(); err.hidden = true;
    const actual = f.actual.value, nueva = f.nueva.value;
    const mal = !actual ? 'Escribe tu clave actual.' : nueva.length < 10 ? 'La clave nueva debe tener al menos 10 caracteres.' : nueva !== f.repite.value ? 'Las claves nuevas no coinciden.' : null;
    if (mal) { err.textContent = mal; err.hidden = false; return; }
    try { await api('configuracion/mi-clave', { body: { actual, nueva } }); cerrar(); toast('Clave cambiada', 'ok'); }
    catch (e2) { err.textContent = e2.message; err.hidden = false; }
  };
  document.body.appendChild(fondo);
  f.actual.focus();
}

function activarBuscador(app) {
  const inp = app.querySelector('#rc-buscar'), res = app.querySelector('#rc-buscar-res');
  let t = null;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    const v = inp.value.trim();
    if (v.length < 2) { res.hidden = true; return; }
    t = setTimeout(async () => {
      try {
        const r = await api(`buscar?q=${encodeURIComponent(v)}`);
        res.innerHTML = r.length ? r.map((x) => `<a href="${x.href}"><span class="tipo">${esc(x.tipo)}</span><b>${esc(x.titulo)}</b><small>${esc(x.detalle || '')}</small></a>`).join('') : '<a><small>Sin resultados</small></a>';
        res.hidden = false;
      } catch { res.hidden = true; }
    }, 220);
  });
  inp.addEventListener('blur', () => setTimeout(() => { res.hidden = true; }, 200));
}
