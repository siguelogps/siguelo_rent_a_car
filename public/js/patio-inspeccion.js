// /patio/:reservaId → asistente de entrega o devolución (celular) o comparación entrega ↔ devolución (escritorio).
import { iniciarPagina, api, esc, toastError, puede } from '/comun.js';
import { montarAsistente } from './patio-asistente.js';
import { montarComparacion } from './patio-comparacion.js';

await iniciarPagina({ activo: 'patio', titulo: 'Entregas y devoluciones' });
const main = document.getElementById('principal');
const reservaId = Number(location.pathname.split('/')[2]);
const vista = new URLSearchParams(location.search).get('vista');

async function comparar() {
  document.body.classList.remove('pt-asistente');
  await montarComparacion(main, reservaId);
}

async function iniciar() {
  if (!reservaId) { main.innerHTML = '<div class="tarjeta rc-vacio">Reserva no válida.</div>'; return; }
  if (vista === 'comparacion' || !puede('patio')) return comparar();
  let S = await api(`patio/reservas/${reservaId}`);
  if (S.modo === 'lectura') {
    if (S.tipo === 'devolucion' && S.inspeccion) return comparar();
    if (S.reserva.estado === 'en_curso' || S.reserva.estado === 'confirmada') {
      // entrega ya hecha y devolución aún no empieza (o sin permiso de edición)
    } else {
      main.innerHTML = `<div class="tarjeta rc-vacio">La reserva <b class="mono">${esc(S.reserva.folio)}</b> está «${esc(S.reserva.estado)}»: no tiene entrega ni devolución pendiente. <a href="/reservas/${S.reserva.id}">Ver reserva</a></div>`;
      return;
    }
  }
  if (!puede('patio', 'editar')) return comparar();
  S = await api(`patio/reservas/${reservaId}/iniciar`, { body: {} });
  document.body.classList.add('pt-asistente');
  await montarAsistente(main, S, {
    alTerminar: async (res) => {
      if (S.tipo === 'devolucion') {
        history.replaceState(null, '', `/patio/${reservaId}?vista=comparacion`);
        await comparar();
        window.scrollTo(0, 0);
      }
      return res;
    }
  });
}

try { await iniciar(); } catch (e) { toastError(e); main.innerHTML = `<div class="tarjeta rc-vacio">${esc(e.message)}</div>`; }
