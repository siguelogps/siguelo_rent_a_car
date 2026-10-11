// Esquema del auto para marcar daños (componente compartido: patio, ficha del vehículo, liquidación, incidentes).
// SVG de 360×470 con cinco vistas: frente (arriba), atrás (abajo), izquierdo, derecho y superior (techo, al centro).
// Los daños se guardan en la tabla danos como { vista, x, y } en coordenadas de este SVG.
//
//   import { dibujarEsquema, svgEsquema } from '/esquema.js';
//   svgEsquema([{ x, y, n, tipo, nuevo }])                         → string <svg>
//   const e = dibujarEsquema(div, { danos, editable: true, alMarcar(x, y, vista) {}, alTocar(dano) {} });
//   e.actualizar(nuevosDanos);
//
// Este archivo no usa el DOM salvo dentro de dibujarEsquema (el servidor también puede importar svgEsquema).

export const COLOR_DANO = { raya: '#1E3A8A', abolladura: '#581C87', trizadura: '#B42318', otro: '#475467' };
export const NOMBRE_TIPO_DANO = { raya: 'Raya', abolladura: 'Abolladura', trizadura: 'Trizadura', otro: 'Otro' };

const LATERAL = {
  cuerpo: 'M0,-14 Q0,-30 14,-33 L70,-38 L100,-62 Q106,-68 116,-68 L196,-68 Q206,-68 214,-60 L250,-38 L288,-34 Q300,-32 300,-18 L300,-12 L0,-12 Z',
  vidrios: 'M78,-40 L102,-62 L150,-62 L150,-40 Z M156,-62 L196,-62 Q204,-62 210,-56 L236,-40 L156,-40 Z'
};

// Vista del esquema según el punto tocado
export function vistaDe(x, y) {
  if (y < 64) return 'frente';
  if (y > 398) return 'atras';
  if (x < 100) return 'izquierdo';
  if (x > 260) return 'derecho';
  return 'superior';
}

// Zona legible del daño («Puerta delantera der.») a partir de la vista y el punto
export function zonaDano(vista, x, y) {
  if (vista === 'frente') return y < 34 ? 'Parabrisas (vista frontal)' : 'Parachoques delantero';
  if (vista === 'atras') return y < 424 ? 'Luneta trasera' : 'Parachoques trasero';
  if (vista === 'izquierdo' || vista === 'derecho') {
    const lado = vista === 'izquierdo' ? 'izq.' : 'der.';
    const l = y - 92; // 0 = frente, 300 = cola
    if (l < 70) return `Guardabarros delantero ${lado}`;
    if (l < 150) return `Puerta delantera ${lado}`;
    if (l < 236) return `Puerta trasera ${lado}`;
    return `Guardabarros trasero ${lado}`;
  }
  if (y < 166) return 'Capó';
  if (y < 206) return 'Parabrisas';
  if (y < 308) return 'Techo';
  if (y < 346) return 'Luneta';
  return 'Tapa del maletero';
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// danos: [{ x, y, n, tipo, nuevo, id }]
export function svgEsquema(danos = [], { etiquetas = true } = {}) {
  const lado = (t) => `<g transform="${t}">
    <path d="${LATERAL.cuerpo}" fill="#fff" stroke="#3A414C" stroke-width="1.6"/>
    <path d="${LATERAL.vidrios}" fill="#EEF0F3" stroke="#3A414C" stroke-width="1.1"/>
    <path d="M150,-40 L150,-12" stroke="#3A414C" stroke-width="1"/>
    ${[55, 245].map((cx) => `<circle cx="${cx}" cy="-14" r="14" fill="#fff" stroke="#3A414C" stroke-width="1.6"/><circle cx="${cx}" cy="-14" r="6" fill="none" stroke="#3A414C"/>`).join('')}
  </g>`;
  const frente = (y, atras) => `<g transform="translate(130 ${y}) scale(.3125)">
    <path d="M70,178 L70,142 Q72,126 90,121 L110,90 Q114,84 122,84 L198,84 Q206,84 210,90 L230,121 Q248,126 250,142 L250,178 Z" fill="#fff" stroke="#3A414C" stroke-width="4"/>
    <path d="M116,119 L127,93 L193,93 L204,119 Z" fill="#EEF0F3" stroke="#3A414C" stroke-width="3"/>
    <ellipse cx="96" cy="140" rx="15" ry="8" fill="none" stroke="#3A414C" stroke-width="3"/><ellipse cx="224" cy="140" rx="15" ry="8" fill="none" stroke="#3A414C" stroke-width="3"/>
    ${atras ? '' : '<rect x="126" y="134" width="68" height="16" rx="4" fill="none" stroke="#3A414C" stroke-width="3"/>'}
  </g>`;
  const txt = (x, y, t) => (etiquetas ? `<text x="${x}" y="${y}" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="10" font-weight="600" fill="#5B6370">${t}</text>` : '');
  return `<svg viewBox="0 0 360 470" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Esquema del vehículo con ${danos.length} daño(s)">
    <rect width="360" height="470" fill="transparent"/>
    ${txt(180, 12, 'FRENTE')}${frente(-10, false)}
    ${txt(180, 462, 'ATRÁS')}${frente(392, true)}
    ${txt(52, 76, 'IZQUIERDO')}${lado('translate(22 92) rotate(90)')}
    ${txt(308, 76, 'DERECHO')}${lado('translate(338 392) rotate(-90) translate(300 0) scale(-1 1)')}
    <g>
      ${[[112, 128], [240, 128], [112, 312], [240, 312]].map(([x, y]) => `<rect x="${x}" y="${y}" width="8" height="36" rx="3" fill="#3A414C"/>`).join('')}
      <path d="M140,96 Q180,78 220,96 L236,132 L238,348 Q236,380 220,386 L140,386 Q124,380 122,348 L124,132 Z" fill="#fff" stroke="#3A414C" stroke-width="1.6"/>
      <path d="M136,168 Q180,153 224,168 L217,204 L143,204 Z" fill="#EEF0F3" stroke="#3A414C" stroke-width="1.1"/>
      <rect x="144" y="210" width="72" height="96" rx="8" fill="#fff" stroke="#3A414C" stroke-width="1.1"/>
      <path d="M143,312 L217,312 L223,342 Q180,352 137,342 Z" fill="#EEF0F3" stroke="#3A414C" stroke-width="1.1"/>
      <path d="M150,104 Q180,96 210,104" fill="none" stroke="#3A414C" stroke-width="1"/>
      <rect x="114" y="170" width="10" height="7" rx="2" fill="#fff" stroke="#3A414C"/><rect x="236" y="170" width="10" height="7" rx="2" fill="#fff" stroke="#3A414C"/>
      ${txt(180, 262, 'TECHO')}
    </g>
    ${danos.map((d, i) => {
      const n = d.n ?? i + 1;
      return `<g class="rc-marca-dano" data-i="${i}"${d.id ? ` data-id="${esc(d.id)}"` : ''}>${d.nuevo ? `<circle cx="${d.x}" cy="${d.y}" r="15" fill="#FFD500" opacity=".9"/>` : ''}<circle cx="${d.x}" cy="${d.y}" r="10.5" fill="${COLOR_DANO[d.tipo] || COLOR_DANO.otro}" stroke="#fff" stroke-width="2"${d.reparado ? ' opacity=".35"' : ''}/><text x="${d.x}" y="${Number(d.y) + 3.8}" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="600" font-size="11" fill="#fff">${esc(n)}</text></g>`;
    }).join('')}
  </svg>`;
}

// Dibuja el esquema dentro de `contenedor`. Si editable, un toque fuera de una marca llama alMarcar(x, y, vista).
export function dibujarEsquema(contenedor, { danos = [], editable = false, etiquetas = true, alMarcar = null, alTocar = null } = {}) {
  let actuales = danos;
  const pintar = () => {
    contenedor.innerHTML = svgEsquema(actuales, { etiquetas });
    const svg = contenedor.querySelector('svg');
    if (editable) svg.style.cursor = 'crosshair';
    svg.addEventListener('click', (ev) => {
      const marca = ev.target.closest('.rc-marca-dano');
      if (marca) { alTocar?.(actuales[Number(marca.dataset.i)], ev); return; }
      if (!editable || !alMarcar) return;
      const p = svg.createSVGPoint();
      p.x = ev.clientX; p.y = ev.clientY;
      const m = svg.getScreenCTM();
      if (!m) return;
      const { x, y } = p.matrixTransform(m.inverse());
      const xr = Math.round(Math.max(8, Math.min(352, x)) * 10) / 10, yr = Math.round(Math.max(8, Math.min(462, y)) * 10) / 10;
      alMarcar(xr, yr, vistaDe(xr, yr));
    });
  };
  pintar();
  return { actualizar(nuevos) { actuales = nuevos; pintar(); }, get danos() { return actuales; } };
}
