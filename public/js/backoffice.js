// Backoffice Síguelo: piezas compartidas entre Empresas y Planes.
import { esc } from '/comun.js';

export const precio = (p) => (p.precio_uf != null ? `${Number(p.precio_uf).toLocaleString('es-CL')} UF / mes` : 'Precio por definir');
export const uso = (n, max, txt) => `<div class="bo-uso${max != null && n >= max ? ' lleno' : ''}"><span class="mono">${n}${max != null ? ` / ${max}` : ''}</span> ${txt}${max == null ? ' <small class="muted">sin límite</small>' : ''}</div>`;

// Detalle de un plan: lo que incluye y, si se pasa la empresa, cuánto está usando de cada límite.
export function detallePlan(p, modulos, e = null) {
  const lim = (n, txt) => `<div class="bo-uso"><span class="mono">${n ?? '∞'}</span> ${txt}</div>`;
  return `${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}
    <div class="bo-plan-precio">${precio(p)}</div>
    <div class="bo-limites">${e
    ? uso(e.vehiculos, p.max_vehiculos, 'vehículos') + uso(e.usuarios, p.max_usuarios, 'usuarios') + uso(e.sucursales, p.max_sucursales, 'sucursales')
    : lim(p.max_vehiculos, 'vehículos') + lim(p.max_usuarios, 'usuarios') + lim(p.max_sucursales, 'sucursales')}</div>
    <h3 class="bo-h3">Módulos</h3>
    <ul class="bo-modulos">${Object.entries(modulos).map(([k, n]) => `<li class="${p.modulos.includes(k) ? 'si' : 'no'}">${p.modulos.includes(k) ? '✓' : '—'} ${esc(n)}</li>`).join('')}</ul>
    <p class="peq muted">Incluido siempre: inicio, configuración, integraciones y usuarios.</p>`;
}
