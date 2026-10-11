// Formato chileno: CLP con punto de miles, fechas dd-mm-aaaa, hora en America/Santiago.
export const ZONA = 'America/Santiago';

export const clp = (n) => (n == null || n === '' ? '' : `${Number(n) < 0 ? '−' : ''}$${Math.abs(Math.round(Number(n))).toLocaleString('es-CL')}`);
export const miles = (n) => (n == null || n === '' ? '' : Math.round(Number(n)).toLocaleString('es-CL'));

function partes(d, zona = ZONA) {
  const f = new Intl.DateTimeFormat('es-CL', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return Object.fromEntries(f.formatToParts(d instanceof Date ? d : new Date(d)).map((p) => [p.type, p.value]));
}

// '2026-10-11' (DATE) o Date/ISO → '11-10-2026'
export function fecha(v, zona = ZONA) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [a, m, d] = v.split('-'); return `${d}-${m}-${a}`; }
  const p = partes(v, zona);
  return `${p.day}-${p.month}-${p.year}`;
}
export const hora = (v, zona = ZONA) => { if (!v) return ''; const p = partes(v, zona); return `${p.hour}:${p.minute}`; };
export const fechaHora = (v, zona = ZONA) => (v ? `${fecha(v, zona)} ${hora(v, zona)}` : '');

// 'dd-mm-aaaa' o 'dd/mm/aaaa' o 'aaaa-mm-dd' → 'aaaa-mm-dd'
export function aIsoFecha(txt) {
  const s = String(txt || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}

// Fecha y hora locales de Chile ('aaaa-mm-dd', 'HH:MM') → Date (instante UTC correcto, con horario de verano)
export function desdeLocal(fechaIso, horaTxt = '00:00', zona = ZONA) {
  const [a, mo, d] = fechaIso.split('-').map(Number);
  const [h, mi = 0, s = 0] = String(horaTxt).split(':').map(Number);
  const supuesto = Date.UTC(a, mo - 1, d, h, mi, s);
  const p = partes(new Date(supuesto), zona);
  const comoLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(supuesto - (comoLocal - supuesto));
}

// Días de arriendo: bloques de 24 h; lo que exceda la tolerancia (minutos) suma un día.
export function diasArriendo(inicio, fin, toleranciaMin = 59) {
  const ms = new Date(fin) - new Date(inicio);
  if (ms <= 0) return 1;
  const dias = Math.floor(ms / 864e5);
  const resto = ms - dias * 864e5;
  return Math.max(1, dias + (resto > toleranciaMin * 6e4 ? 1 : 0));
}
