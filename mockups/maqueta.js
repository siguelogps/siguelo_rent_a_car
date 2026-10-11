// Maquetas (Etapa 0): arma el menú lateral y la barra superior igual que el CRM Síguelo Gestión.
// Uso: <body data-activo="reservas" data-titulo="Reservas">  …  <main class="contenido">…</main>
const I = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
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
  liquidacion: I('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  facturacion: I('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>'),
  incidentes: I('<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>'),
  tag: I('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>'),
  reportes: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  tarifas: I('<path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  configuracion: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  plegar: I('<path d="M15 6l-6 6 6 6"/>'),
  menu: I('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  buscar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  campana: I('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>')
};

const MENU = [
  ['Operación', [['inicio', 'Inicio'], ['reservas', 'Reservas'], ['patio', 'Entregas y devoluciones'], ['contratos', 'Contratos'], ['clientes', 'Clientes']]],
  ['Flota', [['flota', 'Vehículos'], ['mantencion', 'Mantención'], ['gps', 'Plataforma GPS']]],
  ['Finanzas', [['pagos', 'Pagos y garantías'], ['liquidacion', 'Liquidaciones'], ['facturacion', 'Facturación'], ['incidentes', 'Incidentes y daños'], ['tag', 'TAG y multas']]],
  ['Gestión', [['reportes', 'Reportes'], ['tarifas', 'Tarifas'], ['configuracion', 'Configuración']]]
];

const b = document.body;
const activo = b.dataset.activo;
const contenido = b.innerHTML;
b.innerHTML = `
<div class="app">
  <nav class="menu" aria-label="Menú principal">
    <div class="menu-marca"><img class="logo" src="../public/img/logo-siguelo.png" alt="Síguelo GPS"><button class="btn-plegar" aria-label="Plegar menú">${ICONOS.plegar}</button></div>
    <div class="rc-empresa"><span class="rc-empresa-logo">AR</span><div><b>Andes Rent a Car</b><span>Rentacar · Plan Pro</span></div></div>
    ${MENU.map(([g, items]) => `<div class="menu-grupo">${g}</div>${items.map(([m, n]) => `<a class="item" href="#"${m === activo ? ' aria-current="page"' : ''}>${ICONOS[m]}<span>${n}</span></a>`).join('')}`).join('')}
    <div class="menu-pie">
      <button class="menu-usuario"><span class="avatar">MR</span><div><b>María José Rojas</b><span>Administradora</span></div></button>
    </div>
  </nav>
  <div class="principal">
    <header class="barra">
      <span class="titulo">${b.dataset.titulo || ''}</span>
      <div class="buscar">${ICONOS.buscar}<input placeholder="Buscar patente, RUT, cliente o folio…"></div>
      <div class="acciones">
        <span class="chip aviso rc-marcha" title="Correos, WhatsApp y cobros detenidos">● Marcha blanca</span>
        <select class="campo"><option>Todas las sucursales</option></select>
        <button class="btn-icono" aria-label="Avisos">${ICONOS.campana}</button>
      </div>
    </header>
    ${contenido}
  </div>
</div>`;
