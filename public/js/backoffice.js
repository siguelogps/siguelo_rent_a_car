// Backoffice Síguelo: piezas compartidas entre Empresas y Planes.
import { esc } from '/comun.js';

export const precio = (p) => (p.precio_uf != null ? `${Number(p.precio_uf).toLocaleString('es-CL')} UF / mes` : 'Precio por definir');
// Singular y plural de cada límite del plan: «1 sucursal», no «1 sucursales».
const NOMBRES = { vehiculos: ['vehículo', 'vehículos'], usuarios: ['usuario', 'usuarios'], sucursales: ['sucursal', 'sucursales'] };
const nombre = (rec, n) => NOMBRES[rec][Number(n) === 1 ? 0 : 1];

// En «n / max» el sustantivo concuerda con el máximo; sin límite, con lo que hay.
export const uso = (n, max, rec) => `<div class="bo-uso${max != null && n >= max ? ' lleno' : ''}"><span class="mono">${n}${max != null ? ` / ${max}` : ''}</span> ${nombre(rec, max ?? n)}${max == null ? ' <small class="muted">sin límite</small>' : ''}</div>`;
export const usos = (e, p) => uso(e.vehiculos, p.max_vehiculos, 'vehiculos') + uso(e.usuarios, p.max_usuarios, 'usuarios') + uso(e.sucursales, p.max_sucursales, 'sucursales');

// Detalle de un plan: lo que incluye y, si se pasa la empresa, cuánto está usando de cada límite.
export function detallePlan(p, modulos, e = null) {
  const lim = (n, rec) => `<div class="bo-uso"><span class="mono">${n ?? '∞'}</span> ${nombre(rec, n)}</div>`;
  return `${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}
    <div class="bo-plan-precio">${precio(p)}</div>
    <div class="bo-limites">${e
    ? usos(e, p)
    : lim(p.max_vehiculos, 'vehiculos') + lim(p.max_usuarios, 'usuarios') + lim(p.max_sucursales, 'sucursales')}</div>
    <h3 class="bo-h3">Módulos</h3>
    <ul class="bo-modulos">${Object.entries(modulos).map(([k, n]) => `<li class="${p.modulos.includes(k) ? 'si' : 'no'}">${p.modulos.includes(k) ? '✓' : '—'} ${esc(n)}</li>`).join('')}</ul>
    <p class="peq muted">Incluido siempre: inicio, configuración, integraciones y usuarios.</p>`;
}
