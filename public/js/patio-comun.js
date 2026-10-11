// Entrega y devolución: definiciones comunes al navegador y al servidor (sin DOM).
// El servidor las importa desde public/js para que las posiciones de fotos y el checklist sean una sola fuente.

// 11 fotos obligatorias (orden guiado) — inspeccion_fotos.posicion
export const POSICIONES = [
  { clave: 'frente', nombre: 'Frente', guia: 'Encuadra el frente completo con la patente' },
  { clave: 'atras', nombre: 'Atrás', guia: 'Encuadra la parte trasera completa con la patente' },
  { clave: 'izquierdo', nombre: 'Costado izq.', guia: 'Encuadra el costado izquierdo completo' },
  { clave: 'derecho', nombre: 'Costado der.', guia: 'Encuadra el costado derecho completo' },
  { clave: 'esq_fi', nombre: 'Esq. del. izq.', guia: 'Encuadra la esquina delantera izquierda' },
  { clave: 'esq_fd', nombre: 'Esq. del. der.', guia: 'Encuadra la esquina delantera derecha' },
  { clave: 'esq_ti', nombre: 'Esq. tras. izq.', guia: 'Encuadra la esquina trasera izquierda' },
  { clave: 'esq_td', nombre: 'Esq. tras. der.', guia: 'Encuadra la esquina trasera derecha' },
  { clave: 'interior', nombre: 'Interior', guia: 'Toma el interior desde la puerta del conductor' },
  { clave: 'odometro', nombre: 'Odómetro', guia: 'Acércate al tablero: el kilometraje debe leerse' },
  { clave: 'combustible', nombre: 'Combustible', guia: 'Acércate al indicador de combustible' }
];
export const OBLIGATORIAS = POSICIONES.map((p) => p.clave);
export const NOMBRE_POSICION = Object.fromEntries(POSICIONES.map((p) => [p.clave, p.nombre]));
export const nombrePosicion = (c) => NOMBRE_POSICION[c] || (String(c).startsWith('extra') ? `Extra ${String(c).split('_')[1] || ''}`.trim() : c);

// Checklist de accesorios. tipo: 'si' (sí/no), 'n' (cantidad), 'limpieza' (ok/sucio)
export const CHECKLIST = [
  { clave: 'repuesto', nombre: 'Neumático de repuesto', tipo: 'si' },
  { clave: 'gata', nombre: 'Gata y llave de ruedas', tipo: 'si' },
  { clave: 'triangulos', nombre: 'Triángulos', tipo: 'n' },
  { clave: 'extintor', nombre: 'Extintor', tipo: 'si' },
  { clave: 'documentos', nombre: 'Documentos (padrón, SOAP, permiso)', tipo: 'si' },
  { clave: 'tag', nombre: 'TAG instalado', tipo: 'si' },
  { clave: 'limpieza', nombre: 'Limpieza interior y exterior', tipo: 'limpieza' }
];
export const CHECKLIST_DEFECTO = { repuesto: true, gata: true, triangulos: 2, extintor: true, documentos: true, tag: true, limpieza: 'ok', notas: {} };

// ¿El elemento está en orden? (para contar observaciones)
export function itemOk(item, valor, base = CHECKLIST_DEFECTO) {
  if (item.tipo === 'si') return valor !== false;
  if (item.tipo === 'n') return Number(valor ?? 0) >= Number(base[item.clave] ?? 2);
  return valor !== 'sucio';
}
export function contarChecklist(ch = {}) {
  const ok = CHECKLIST.filter((i) => itemOk(i, ch[i.clave])).length;
  return { ok, total: CHECKLIST.length, observaciones: CHECKLIST.length - ok };
}

// Fotos de la comparación según la vista del esquema donde está un daño
export const FOTO_DE_VISTA = { frente: 'frente', atras: 'atras', izquierdo: 'izquierdo', derecho: 'derecho', superior: 'frente' };

export const TIPOS_DANO = { raya: 'Raya', abolladura: 'Abolladura', trizadura: 'Trizadura', otro: 'Otro' };

export const ESTADOS_INCIDENTE = { reportado: 'Reportado', presupuestado: 'Presupuestado', cobrado_cliente: 'Cobrado al cliente', en_seguro: 'En seguro', pagado: 'Pagado', cerrado: 'Cerrado', anulado: 'Anulado' };
export const ORDEN_INCIDENTE = ['reportado', 'presupuestado', 'cobrado_cliente', 'en_seguro', 'pagado', 'cerrado'];
export const TIPOS_INCIDENTE = { dano: 'Daño', accidente: 'Accidente', robo: 'Robo', mecanico: 'Falla mecánica', otro: 'Otro' };
