// Maquetas: «fotos» dibujadas en SVG (en el sistema real son las fotos tomadas por el personal de patio)
// y el esquema del auto (vista superior, costados, frente y atrás) para marcar daños.

const fondo = `<defs>
  <linearGradient id="cielo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C9D3DF"/><stop offset="1" stop-color="#E8ECF1"/></linearGradient>
  <linearGradient id="suelo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9AA1AB"/><stop offset="1" stop-color="#6E7580"/></linearGradient>
</defs>
<rect width="320" height="240" fill="url(#cielo)"/>
<rect y="150" width="320" height="90" fill="url(#suelo)"/>
<path d="M0 150h320" stroke="#B9C0C9" stroke-width="2"/>
<path d="M40 240l30-90M280 240l-30-90" stroke="#E9EDF1" stroke-width="3" opacity=".7"/>`;

// Silueta lateral en coordenadas locales: largo 300, frente en x=0, suelo en y=0
const LATERAL = {
  cuerpo: 'M0,-14 Q0,-30 14,-33 L70,-38 L100,-62 Q106,-68 116,-68 L196,-68 Q206,-68 214,-60 L250,-38 L288,-34 Q300,-32 300,-18 L300,-12 L0,-12 Z',
  vidrios: 'M78,-40 L102,-62 L150,-62 L150,-40 Z M156,-62 L196,-62 Q204,-62 210,-56 L236,-40 L156,-40 Z',
  linea: 'M20,-26 L290,-26'
};

function ladoSVG(color, { espejo = false, x = 10, y = 192, escala = 1, sesgo = 0 } = {}) {
  const t = `translate(${x} ${y}) ${espejo ? 'translate(300 0) scale(-1 1)' : ''} matrix(${escala} ${sesgo} 0 ${escala} 0 0)`;
  return `<g transform="${t}">
    <ellipse cx="150" cy="2" rx="160" ry="7" fill="#000" opacity=".25"/>
    <path d="${LATERAL.cuerpo}" fill="${color}" stroke="#1F242B" stroke-width="1.6"/>
    <path d="${LATERAL.vidrios}" fill="#2B3440" opacity=".88"/>
    <path d="${LATERAL.linea}" stroke="#000" opacity=".18" stroke-width="1.4"/>
    <path d="M150,-40 L150,-12 M100,-26 h12 M190,-26 h12" stroke="#1F242B" stroke-width="1.2" opacity=".5"/>
    <rect x="2" y="-28" width="10" height="6" rx="2" fill="#FFF6C8"/>
    <rect x="290" y="-30" width="9" height="6" rx="2" fill="#C8102E"/>
    ${[55, 245].map((cx) => `<circle cx="${cx}" cy="-14" r="15" fill="#1A1D22"/><circle cx="${cx}" cy="-14" r="7.5" fill="#A7AEB8"/><circle cx="${cx}" cy="-14" r="2.5" fill="#5B6370"/>`).join('')}
  </g>`;
}

function frenteSVG(color, atras = false) {
  const luz = atras ? '#C8102E' : '#FFF6C8';
  return `<g>
    <ellipse cx="160" cy="194" rx="100" ry="7" fill="#000" opacity=".25"/>
    ${[78, 220].map((x) => `<rect x="${x}" y="168" width="22" height="26" rx="5" fill="#1A1D22"/>`).join('')}
    <path d="M70,178 L70,142 Q72,126 90,121 L110,90 Q114,84 122,84 L198,84 Q206,84 210,90 L230,121 Q248,126 250,142 L250,178 Z" fill="${color}" stroke="#1F242B" stroke-width="1.6"/>
    <path d="M116,119 L127,93 L193,93 L204,119 Z" fill="#2B3440" opacity=".9"/>
    <ellipse cx="96" cy="140" rx="15" ry="8" fill="${luz}" stroke="#1F242B"/>
    <ellipse cx="224" cy="140" rx="15" ry="8" fill="${luz}" stroke="#1F242B"/>
    ${atras ? '<rect x="120" y="134" width="80" height="18" rx="3" fill="#000" opacity=".12"/>' : '<rect x="126" y="134" width="68" height="16" rx="4" fill="#23272E"/><path d="M130 142h60" stroke="#59606B" stroke-width="2"/>'}
    <rect x="138" y="157" width="44" height="13" rx="2" fill="#fff" stroke="#1F242B"/>
    <text x="160" y="167" text-anchor="middle" font-family="IBM Plex Mono" font-weight="600" font-size="9" fill="#15181D">PBVX·61</text>
    <rect x="58" y="113" width="12" height="9" rx="3" fill="${color}" stroke="#1F242B"/><rect x="250" y="113" width="12" height="9" rx="3" fill="${color}" stroke="#1F242B"/>
  </g>`;
}

function interiorSVG() {
  return `<rect width="320" height="240" fill="#2A2E35"/>
  <rect y="0" width="320" height="80" fill="#9FB3C8" opacity=".55"/>
  <path d="M0,80 Q160,60 320,80 L320,150 L0,150 Z" fill="#1C1F24"/>
  <rect x="140" y="92" width="74" height="44" rx="5" fill="#0E1116" stroke="#555"/><rect x="146" y="98" width="62" height="32" rx="3" fill="#24476B"/>
  <circle cx="86" cy="150" r="58" fill="none" stroke="#111" stroke-width="13"/><circle cx="86" cy="150" r="15" fill="#111"/>
  <path d="M28,150 h116 M86,150 v58" stroke="#111" stroke-width="11"/>
  <rect x="0" y="198" width="320" height="42" fill="#3A3F47"/>
  <rect x="220" y="160" width="80" height="80" rx="10" fill="#4A5059"/><rect x="230" y="170" width="60" height="18" rx="4" fill="#5E6570"/>`;
}

function odometroSVG(km) {
  return `<rect width="320" height="240" fill="#0B0D10"/>
  <circle cx="90" cy="120" r="70" fill="#14181D" stroke="#2C323A" stroke-width="3"/>
  <circle cx="230" cy="120" r="70" fill="#14181D" stroke="#2C323A" stroke-width="3"/>
  <path d="M90,120 L55,80" stroke="#E4002B" stroke-width="3"/><path d="M230,120 L210,74" stroke="#E4002B" stroke-width="3"/>
  ${Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (0.8 + i * 0.175); return `<path d="M${90 + Math.cos(a) * 60},${120 + Math.sin(a) * 60} L${90 + Math.cos(a) * 52},${120 + Math.sin(a) * 52}" stroke="#ccc" stroke-width="2"/><path d="M${230 + Math.cos(a) * 60},${120 + Math.sin(a) * 60} L${230 + Math.cos(a) * 52},${120 + Math.sin(a) * 52}" stroke="#ccc" stroke-width="2"/>`; }).join('')}
  <rect x="108" y="168" width="104" height="30" rx="4" fill="#1C2B1F" stroke="#3A5"/>
  <text x="160" y="189" text-anchor="middle" font-family="IBM Plex Mono" font-weight="600" font-size="17" fill="#8CF5A0">${km}</text>
  <text x="160" y="214" text-anchor="middle" font-family="IBM Plex Sans" font-size="10" fill="#8B93A0">ODO km</text>`;
}

function combustibleSVG(nivel) {
  const a = Math.PI * (1 + nivel);
  return `<rect width="320" height="240" fill="#0B0D10"/>
  <path d="M70,170 A90,90 0 0 1 250,170" fill="none" stroke="#2C323A" stroke-width="14"/>
  <path d="M70,170 A90,90 0 0 1 ${160 + Math.cos(a) * 90},${170 + Math.sin(a) * 90}" fill="none" stroke="#FFBF00" stroke-width="14"/>
  <path d="M160,170 L${160 + Math.cos(a) * 78},${170 + Math.sin(a) * 78}" stroke="#E4002B" stroke-width="4" stroke-linecap="round"/>
  <circle cx="160" cy="170" r="9" fill="#333"/>
  <text x="58" y="198" font-family="IBM Plex Mono" font-weight="600" font-size="18" fill="#ddd">E</text>
  <text x="248" y="198" font-family="IBM Plex Mono" font-weight="600" font-size="18" fill="#ddd">F</text>
  <text x="160" y="222" text-anchor="middle" font-family="IBM Plex Sans" font-size="11" fill="#8B93A0">COMBUSTIBLE</text>`;
}

export function foto(tipo, { color = '#B9C1CB', km = '048.320', nivel = 0.875, dano = null } = {}) {
  let cuerpo = '';
  if (tipo === 'izquierdo') cuerpo = fondo + ladoSVG(color);
  else if (tipo === 'derecho') cuerpo = fondo + ladoSVG(color, { espejo: true });
  else if (tipo === 'frente') cuerpo = fondo + frenteSVG(color);
  else if (tipo === 'atras') cuerpo = fondo + frenteSVG(color, true);
  else if (tipo === 'esq-fi') cuerpo = fondo + ladoSVG(color, { x: 40, y: 200, escala: 0.82, sesgo: 0.1 });
  else if (tipo === 'esq-fd') cuerpo = fondo + ladoSVG(color, { espejo: true, x: 20, y: 172, escala: 0.82, sesgo: -0.1 });
  else if (tipo === 'esq-ti') cuerpo = fondo + ladoSVG(color, { espejo: true, x: 40, y: 200, escala: 0.82, sesgo: 0.1 });
  else if (tipo === 'esq-td') cuerpo = fondo + ladoSVG(color, { x: 20, y: 172, escala: 0.82, sesgo: -0.1 });
  else if (tipo === 'interior') cuerpo = interiorSVG();
  else if (tipo === 'odometro') cuerpo = odometroSVG(km);
  else if (tipo === 'combustible') cuerpo = combustibleSVG(nivel);
  else if (tipo === 'detalle') cuerpo = `<rect width="320" height="240" fill="${color}"/><path d="M0,60 Q160,40 320,70 L320,90 Q160,62 0,82Z" fill="#fff" opacity=".35"/><rect y="180" width="320" height="60" fill="#000" opacity=".08"/>`;
  if (dano === 'raya') cuerpo += '<path d="M120,150 L196,138 M126,155 L188,145" stroke="#F4F6F8" stroke-width="2.4" stroke-linecap="round" opacity=".95"/><path d="M122,152 L194,140" stroke="#5B6370" stroke-width="1" opacity=".6"/>';
  if (dano === 'abolladura') cuerpo += '<ellipse cx="176" cy="160" rx="28" ry="14" fill="#000" opacity=".22"/><ellipse cx="170" cy="156" rx="18" ry="8" fill="#fff" opacity=".25"/>';
  return `<svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${cuerpo}</svg>`;
}

// Esquema para marcar daños. danos: [{ x, y, n, tipo: 'raya'|'abolladura'|'trizadura', nuevo }]
const COLOR_DANO = { raya: '#1E3A8A', abolladura: '#581C87', trizadura: '#B42318' };
export function esquema(danos = [], { etiquetas = true } = {}) {
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
  const txt = (x, y, t) => etiquetas ? `<text x="${x}" y="${y}" text-anchor="middle" font-family="IBM Plex Sans" font-size="10" font-weight="600" fill="#5B6370">${t}</text>` : '';
  return `<svg viewBox="0 0 360 470" xmlns="http://www.w3.org/2000/svg">
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
    ${danos.map((d) => `<g class="rc-marca-dano">${d.nuevo ? `<circle cx="${d.x}" cy="${d.y}" r="15" fill="#FFD500" opacity=".9"/>` : ''}<circle cx="${d.x}" cy="${d.y}" r="10.5" fill="${COLOR_DANO[d.tipo]}" stroke="#fff" stroke-width="2"/><text x="${d.x}" y="${d.y + 3.8}" text-anchor="middle" font-family="IBM Plex Mono" font-weight="600" font-size="11" fill="#fff">${d.n}</text></g>`).join('')}
  </svg>`;
}
