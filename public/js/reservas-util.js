// Utilidades compartidas por las páginas de reservas, clientes y contratos (hora de Chile, estados, documentos).
import { esc, rut, fecha, hora, isoLocal } from '/comun.js';

const ZONA = 'America/Santiago';
const partes = (d) => Object.fromEntries(new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(new Date(d)).map((p) => [p.type, p.value]));

/** Fecha y hora locales de Chile ('aaaa-mm-dd', 'HH:MM') → Date (instante correcto, con horario de verano). */
export function desdeLocal(fechaIso, horaTxt = '00:00') {
  const [a, mo, d] = fechaIso.split('-').map(Number);
  const [h, mi = 0] = String(horaTxt || '00:00').split(':').map(Number);
  const supuesto = Date.UTC(a, mo - 1, d, h, mi);
  const p = partes(supuesto);
  const comoLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(supuesto - (comoLocal - supuesto));
}
export const aIso = (fechaIso, horaTxt) => desdeLocal(fechaIso, horaTxt).toISOString();

/** Suma días a una fecha 'aaaa-mm-dd' (calendario, sin zona). */
export const sumarDias = (fechaIso, n) => { const d = new Date(`${fechaIso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const hoyChile = () => isoLocal(new Date()).fecha;
export const diaSemana = (fechaIso) => new Intl.DateTimeFormat('es-CL', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${fechaIso}T12:00:00Z`)).replace('.', '');
export const mesCorto = (fechaIso) => new Intl.DateTimeFormat('es-CL', { month: 'short', timeZone: 'UTC' }).format(new Date(`${fechaIso}T12:00:00Z`)).replace('.', '');
export const ddmm = (v) => fecha(v).slice(0, 5);
export const fechaHoraTxt = (v) => (v ? `${fecha(v)} · ${hora(v)}` : '');

/** Días de arriendo (bloques de 24 h con tolerancia), igual que el servidor. */
export function diasArriendo(inicio, fin, tol = 59) {
  const ms = new Date(fin) - new Date(inicio);
  if (ms <= 0) return 1;
  const d = Math.floor(ms / 864e5), resto = ms - d * 864e5;
  return Math.max(1, d + (resto > tol * 6e4 ? 1 : 0));
}

/** Clase visual de una reserva (atrasada = en curso con devolución vencida). */
export const claseReserva = (r) => (r.estado === 'en_curso' && new Date(r.fin) < new Date() ? 'atrasada' : r.estado);
export const NOMBRE_DOC = { rut: 'RUT', pasaporte: 'Pasaporte', dni: 'DNI' };
export const docTxt = (tipo, doc) => (tipo === 'rut' ? rut(doc) : esc(doc || ''));
export const docEtiqueta = (tipo, doc) => `${NOMBRE_DOC[tipo] || ''} ${docTxt(tipo, doc)}`.trim();
export const TIPOS_DOC = { cedula_frente: 'Cédula (frente)', cedula_reverso: 'Cédula (reverso)', licencia: 'Licencia de conducir', licencia_reverso: 'Licencia (reverso)', pasaporte: 'Pasaporte', otro: 'Otro documento' };
export const ORIGEN = { counter: 'counter', portal: 'portal web', agencia: 'agencia', telefono: 'teléfono' };

/** Horas de atraso legibles: «5 h de atraso», «2 días de atraso». */
export function atrasoTxt(fin) {
  const h = Math.floor((Date.now() - new Date(fin)) / 36e5);
  if (h < 1) return 'menos de 1 h de atraso';
  return h < 48 ? `${h} h de atraso` : `${Math.floor(h / 24)} días de atraso`;
}

export const combustible = (n) => `<span class="rc-comb">${Array.from({ length: 8 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span> ${n}/8`;

/** Licencia vencida o que vence antes de una fecha. */
export function estadoLicencia(vence, antesDe = null) {
  if (!vence) return { clase: 'aviso', txt: 'sin licencia registrada', mal: true };
  const v = new Date(`${vence}T23:59:59`);
  if (v < new Date()) return { clase: 'error', txt: `licencia vencida el ${fecha(vence)}`, mal: true };
  if (antesDe && v < new Date(antesDe)) return { clase: 'aviso', txt: `licencia vence el ${fecha(vence)}, antes de la devolución`, mal: true };
  return { clase: 'ok', txt: `vigente hasta ${fecha(vence)}`, mal: false };
}

export const copiar = async (txt) => { try { await navigator.clipboard.writeText(txt); return true; } catch { return false; } };
