// Cuenta de revisión de las tiendas (Google Play y App Store) · 9-nov.
//
// Google y Apple piden un usuario y una clave para revisar la app, que no tiene registro público. Pablo no quiere
// claves en el código, en los commits ni en la ficha, así que la cuenta se crea desde el backoffice (solo superadmin):
//   · una empresa de demostración propia, «Rentacar Demo Revisión», con los mismos datos de src/demo.js + demo-extra
//     (vehículos, clientes, reservas, contratos, incidentes), aislada por empresa_id como cualquier cliente;
//   · en marcha blanca y sin conexiones: no sale ningún correo, WhatsApp, cobro, DTE ni inmovilización;
//   · un usuario administrador con correo @demo.siguelogps.cl y una clave al azar que se muestra UNA vez en pantalla
//     (aquí solo se guarda su hash, como cualquier clave). «Reiniciar» genera otra y cierra las sesiones abiertas.
//   · la agenda del teléfono nunca queda vacía: al crear, al reiniciar y una vez por hora (registrarTarea en
//     src/api/16-backoffice-clientes.js) las reservas se corren a «hoy» y, si el revisor ya hizo las entregas o
//     devoluciones del día, se agregan otras.
// La empresa se reconoce por ajustes.cuenta_revision (no por el nombre, que se puede cambiar en Configuración).
import crypto from 'node:crypto';
import { q, uno, transaccion, siguienteFolio } from '../db.js';
import { hashClave } from '../auth.js';
import { cotizar } from '../cotizador.js';
import { conflictos, vehiculosDisponibles } from '../disponibilidad.js';
import { desdeLocal } from '../util/formato.js';
import { tokenAleatorio } from '../cifrado.js';
import { limpiarCachePlanes } from '../planes.js';
import { limpiarCache } from '../integraciones/index.js';

export const NOMBRE_REVISION = 'Rentacar Demo Revisión';
export const CORREO_REVISOR = 'revision-tiendas@demo.siguelogps.cl';
// Los demás usuarios de la demo existen solo como autores de los datos: sin clave, no pueden ingresar.
const CORREOS = {
  administrador: 'administracion.revision@demo.siguelogps.cl', counter: 'counter.revision@demo.siguelogps.cl',
  patio: 'patio.revision@demo.siguelogps.cl', finanzas: 'finanzas.revision@demo.siguelogps.cl'
};
// Lo que recorre la app (agenda, entrega y devolución, vehículos, reservas, contratos, incidentes), aunque alguien
// cambie el plan «pro»: van como módulos extra de la empresa.
const MODULOS_APP = ['reservas', 'patio', 'contratos', 'clientes', 'flota', 'incidentes', 'gps'];
export const MIN_ENTREGAS = 3;
export const MIN_DEVOLUCIONES = 2;

const DIA = 864e5;
const ZONA = 'America/Santiago';
const fechaChile = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d);
const masDias = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);

// Clave fuerte y fácil de dictar o copiar: 4 grupos de 4 (letras y números sin los que se confunden: 0/O, 1/l/I).
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function claveAleatoria() {
  const b = crypto.randomBytes(16);
  const s = [...b].map((x) => ALFABETO[x % ALFABETO.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

export async function empresaRevision() {
  return uno(`SELECT * FROM empresas WHERE ajustes->'cuenta_revision' IS NOT NULL AND ajustes->'cuenta_revision' <> 'false'::jsonb ORDER BY id LIMIT 1`);
}

// Estado para la pantalla del backoffice (sin clave: la clave no se guarda y no se puede volver a mostrar).
export async function estadoCuentaRevision() {
  const e = await empresaRevision();
  if (!e) return { existe: false, correo: CORREO_REVISOR };
  const u = await uno('SELECT id, activo, ultimo_acceso FROM usuarios WHERE empresa_id = $1 AND lower(correo) = $2', [e.id, CORREO_REVISOR]);
  return { existe: true, empresa: { id: e.id, nombre: e.nombre, marcha_blanca: e.marcha_blanca, estado: e.estado }, correo: CORREO_REVISOR, usuario_activo: !!u?.activo, ultimo_acceso: u?.ultimo_acceso || null, reiniciada_en: e.ajustes?.cuenta_revision?.reiniciada_en || null };
}

// Crea la cuenta (o la reinicia si ya existe) y devuelve la clave nueva: el que llama la muestra una sola vez.
export async function prepararCuentaRevision({ ahora = new Date() } = {}) {
  let e = await empresaRevision();
  const creada = !e;
  if (!e) {
    const otro = await uno('SELECT empresa_id FROM usuarios WHERE lower(correo) = ANY($1)', [[CORREO_REVISOR, ...Object.values(CORREOS)]]);
    if (otro) throw new Error('Los correos de la cuenta de revisión ya están en uso por otra empresa');
    const { sembrarDemo } = await import('../demo.js');
    e = await sembrarDemo({
      clave: null, superadminDemo: false, correos: CORREOS,
      empresa: { nombre: NOMBRE_REVISION, slug: 'rentacar-demo-revision', razon_social: `${NOMBRE_REVISION} (cuenta de demostración)`, rut: null,
        correo: 'reservas.revision@demo.siguelogps.cl', telefono: null, admin_nombre: 'Administración demo',
        ajustes: { cuenta_revision: { creada_en: ahora.toISOString() } } } // marcada desde el principio: si algo falla a medias, «Reiniciar» la completa
    });
  }
  const E = e.id;
  // Nada sale de esta empresa: marcha blanca encendida, activa y sin conexiones encendidas.
  await q(`UPDATE empresas SET marcha_blanca = true, estado = 'activo', estado_motivo = NULL, plan = COALESCE((SELECT codigo FROM planes WHERE codigo = 'pro'), plan),
             modulos_extra = (SELECT array_agg(DISTINCT m) FROM unnest(COALESCE(modulos_extra, '{}'::text[]) || $2::text[]) AS m),
             ajustes = jsonb_set(ajustes, '{cuenta_revision}', COALESCE(ajustes->'cuenta_revision', '{}'::jsonb) || jsonb_build_object('reiniciada_en', $3::text))
           WHERE id = $1`, [E, MODULOS_APP, ahora.toISOString()]);
  await q('UPDATE integraciones SET activa = false WHERE empresa_id = $1', [E]);
  limpiarCachePlanes(); limpiarCache();
  await flotaAgenda(E);

  // El usuario del revisor: si lo eliminó desde la app («Eliminar mi cuenta» le cambia el correo), se crea otro.
  const clave = claveAleatoria();
  const suc = await uno('SELECT id FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id LIMIT 1', [E]);
  const u = await uno('SELECT id, empresa_id FROM usuarios WHERE lower(correo) = $1', [CORREO_REVISOR]);
  if (u && Number(u.empresa_id) !== Number(E)) throw new Error('El correo de la cuenta de revisión pertenece a otra empresa');
  let usuarioId;
  if (u) {
    await q(`UPDATE usuarios SET clave_hash = $2, activo = true, rol = 'administrador', nombre = 'Revisión de tiendas', invitacion_hash = NULL WHERE id = $1`, [u.id, hashClave(clave)]);
    await q('DELETE FROM sesiones WHERE usuario_id = $1', [u.id]); // la clave anterior deja de servir también en los teléfonos
    usuarioId = u.id;
  } else {
    const [n] = await q(`INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol, sucursal_id) VALUES ($1, 'Revisión de tiendas', $2, $3, 'administrador', $4) RETURNING id`,
      [E, CORREO_REVISOR, hashClave(clave), suc?.id ?? null]);
    usuarioId = n.id;
  }
  const agenda = await renovarAgenda(E, ahora);
  return { creada, empresa: { id: E, nombre: e.nombre || NOMBRE_REVISION }, usuario_id: usuarioId, correo: CORREO_REVISOR, clave, agenda };
}

// La flota de la demo está casi toda ocupada (arriendos en curso y reservas de los próximos días): sin autos libres la
// agenda no se podría llenar. La cuenta de revisión suma unos autos más, disponibles. Idempotente (por patente).
const AUTOS_AGENDA = [
  ['LKRD34', 'Kia', 'Soluto', 'Citycar', 'Blanco'], ['PFHT52', 'Chevrolet', 'Onix', 'Sedán', 'Gris'], ['RWKS83', 'Hyundai', 'Creta', 'SUV', 'Azul'],
  ['SDLP26', 'Suzuki', 'Baleno', 'Citycar', 'Rojo'], ['TGHB47', 'Toyota', 'Corolla', 'Sedán', 'Negro'], ['JXRV19', 'Nissan', 'Kicks', 'SUV', 'Plata']
];
async function flotaAgenda(E) {
  const suc = await uno('SELECT id, lat, lng FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id LIMIT 1', [E]);
  const anio = new Date().getFullYear();
  for (const [i, [pat, marca, modelo, cat, color]] of AUTOS_AGENDA.entries()) {
    if (await uno('SELECT 1 AS ok FROM vehiculos WHERE empresa_id = $1 AND patente = $2', [E, pat])) continue;
    const c = await uno('SELECT id FROM categorias WHERE empresa_id = $1 AND nombre = $2', [E, cat]);
    const km = 15000 + i * 7350;
    await q(`INSERT INTO vehiculos (empresa_id, patente, marca, modelo, anio, categoria_id, color, km, combustible_nivel, sucursal_id, venc_revision_tecnica, venc_permiso_circulacion, venc_soap,
        estado, gps_unidad_id, gps_nombre, gps_lat, gps_lng, gps_km, gps_combustible, gps_actualizado_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,8,$9,$10,$11,$11,'disponible',$12,$2,$13,$14,$8,8, now() - interval '3 minutes')`,
    [E, pat, marca, modelo, anio - (i % 3), c?.id ?? null, color, km, suc?.id ?? null, `${anio + 1}-0${(i % 6) + 3}-15`, `${anio + 1}-03-31`, `rev-${E}-${i}`, suc?.lat ?? null, suc?.lng ?? null]);
  }
}

// Hora de una tarea de la agenda: la siguiente media hora con al menos una hora de margen, separadas entre sí.
// Las entregas que ya no caben hoy van mañana en la mañana (la agenda muestra hoy y mañana); las devoluciones solo se
// ven si vencen hoy, así que no pasan de las 23:30.
function horaAgenda(ahora, i, tipo) {
  const hoy = fechaChile(ahora);
  const base = Math.ceil((ahora.getTime() + 60 * 60e3) / (30 * 60e3)) * 30 * 60e3 + i * 90 * 60e3;
  const t = new Date(base);
  if (fechaChile(t) === hoy && t <= desdeLocal(hoy, '23:30')) return t;
  if (tipo === 'entrega') return new Date(desdeLocal(masDias(hoy, 1), '09:30').getTime() + i * 90 * 60e3);
  const tope = desdeLocal(hoy, '23:30');
  return tope > ahora ? tope : null;
}

async function nuevaReserva(E, { estado, inicio, fin, excluirClientes = [] }) {
  const libres = (await vehiculosDisponibles(E, { inicio, fin })).filter((v) => !['mantencion', 'fuera_servicio'].includes(v.estado));
  const v = libres.find((x) => x.estado === 'disponible') || libres[0];
  if (!v) return null;
  const c = await uno(`SELECT id FROM clientes WHERE empresa_id = $1 AND NOT lista_negra AND NOT (id = ANY($2::bigint[])) ORDER BY random() LIMIT 1`, [E, excluirClientes])
    || await uno('SELECT id FROM clientes WHERE empresa_id = $1 AND NOT lista_negra ORDER BY id LIMIT 1', [E]);
  const suc = v.sucursal_id || (await uno('SELECT id FROM sucursales WHERE empresa_id = $1 ORDER BY id LIMIT 1', [E]))?.id;
  const cot = await cotizar({ empresaId: E, categoriaId: v.categoria_id, inicio, fin, sucursalRetiroId: suc, sucursalDevolucionId: suc, extras: [], codigoDescuento: null });
  return transaccion(async (tx) => {
    const folio = await siguienteFolio(E, 'R', tx);
    const [r] = await tx.query(`INSERT INTO reservas (empresa_id, folio, estado, cliente_id, vehiculo_id, categoria_id, sucursal_retiro_id, sucursal_devolucion_id, inicio, fin, cotizacion, total,
        km_incluidos, precio_km_extra, garantia, deducible, origen, token_portal, retiro_real)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,'counter',$16,$17) RETURNING id, folio`,
    [E, folio, estado, c?.id ?? null, v.id, v.categoria_id, suc, inicio, fin, JSON.stringify(cot), cot.total, cot.km_incluidos, cot.precio_km_extra, cot.garantia, cot.deducible,
      tokenAleatorio(18), estado === 'en_curso' ? inicio : null]);
    if (estado === 'en_curso') await tx.query(`UPDATE vehiculos SET estado = 'arrendado' WHERE id = $1 AND empresa_id = $2`, [v.id, E]);
    return r;
  });
}

// Deja la agenda del teléfono con trabajo para hoy. Idempotente: llamarla de nuevo el mismo día no agrega nada si
// ya hay suficientes entregas y devoluciones pendientes.
export async function renovarAgenda(E, ahora = new Date()) {
  const hoy = fechaChile(ahora);
  const e = await uno('SELECT ajustes FROM empresas WHERE id = $1', [E]);
  const cr = e?.ajustes?.cuenta_revision || {};
  const out = { dias_corridos: 0, entregas_movidas: 0, entregas_nuevas: 0, devoluciones_movidas: 0, devoluciones_nuevas: 0 };

  // 1. Todo el calendario avanza los días que pasaron desde la última vez: lo pendiente sigue «alrededor de hoy».
  //    Lo terminado (devuelta, cerrada, cancelada, no se presentó) es historia y no se mueve.
  const d = cr.dia ? diasEntre(cr.dia, hoy) : 0;
  if (d > 0) {
    const iv = `${d} days`;
    await q(`UPDATE reservas SET inicio = inicio + $2::interval, fin = fin + $2::interval WHERE empresa_id = $1 AND estado IN ('cotizacion','confirmada')`, [E, iv]);
    await q(`UPDATE reservas SET fin = fin + $2::interval WHERE empresa_id = $1 AND estado = 'en_curso'`, [E, iv]);
    await q(`UPDATE bloqueos SET inicio = inicio + $2::interval, fin = fin + $2::interval WHERE empresa_id = $1`, [E, iv]);
    out.dias_corridos = d;
  }
  if (cr.dia !== hoy) await q(`UPDATE empresas SET ajustes = jsonb_set(ajustes, '{cuenta_revision}', COALESCE(ajustes->'cuenta_revision', '{}'::jsonb) || jsonb_build_object('dia', $2::text)) WHERE id = $1`, [E, hoy]);

  // 2. Entregas cuya hora ya pasó: se corren a una hora próxima (si el auto sigue libre) para que no queden «atrasadas».
  const vencidas = await q(`SELECT id, vehiculo_id, inicio, fin FROM reservas WHERE empresa_id = $1 AND estado = 'confirmada' AND inicio < $2 ORDER BY inicio`, [E, ahora]);
  let slot = 0;
  for (const r of vencidas) {
    const inicio = horaAgenda(ahora, slot, 'entrega');
    const fin = new Date(inicio.getTime() + Math.max(new Date(r.fin) - new Date(r.inicio), 2 * DIA));
    if ((await conflictos(E, r.vehiculo_id, inicio, fin, { excluirReservaId: r.id })).length) {
      await q(`UPDATE reservas SET estado = 'cancelada', motivo_cancelacion = 'Cuenta de demostración: se liberó para la agenda de hoy' WHERE id = $1 AND empresa_id = $2`, [r.id, E]);
      continue;
    }
    await q('UPDATE reservas SET inicio = $3, fin = $4 WHERE id = $1 AND empresa_id = $2', [r.id, E, inicio, fin]);
    out.entregas_movidas++; slot++;
  }
  // 3. Al menos MIN_ENTREGAS entregas pendientes para hoy o mañana.
  const [{ n: entregas }] = await q(`SELECT count(*)::int AS n FROM reservas WHERE empresa_id = $1 AND estado = 'confirmada' AND inicio >= $2 AND (inicio AT TIME ZONE '${ZONA}')::date <= $3::date + 1`, [E, ahora, hoy]);
  for (let i = entregas; i < MIN_ENTREGAS; i++) {
    const inicio = horaAgenda(ahora, slot++, 'entrega');
    if (await nuevaReserva(E, { estado: 'confirmada', inicio, fin: new Date(inicio.getTime() + 3 * DIA) })) out.entregas_nuevas++;
  }

  // 4. Al menos MIN_DEVOLUCIONES devoluciones que vencen hoy (más tarde que ahora). Primero se adelantan arriendos en
  //    curso que vencen otro día (acortar nunca choca con otra reserva); si no alcanzan, se crean arriendos en curso.
  const pendientesHoy = async () => (await q(`SELECT count(*)::int AS n FROM reservas WHERE empresa_id = $1 AND estado = 'en_curso' AND fin > $2 AND (fin AT TIME ZONE '${ZONA}')::date = $3::date`, [E, ahora, hoy]))[0].n;
  let devoluciones = await pendientesHoy(), dslot = 0;
  if (devoluciones < MIN_DEVOLUCIONES) {
    const futuras = await q(`SELECT id, coalesce(retiro_real, inicio) AS desde FROM reservas WHERE empresa_id = $1 AND estado = 'en_curso' AND (fin AT TIME ZONE '${ZONA}')::date > $2::date ORDER BY fin LIMIT $3`, [E, hoy, MIN_DEVOLUCIONES - devoluciones]);
    for (const r of futuras) {
      const fin = horaAgenda(ahora, dslot++, 'devolucion');
      if (!fin || fin <= new Date(r.desde)) break;
      await q('UPDATE reservas SET fin = $3 WHERE id = $1 AND empresa_id = $2', [r.id, E, fin]);
      out.devoluciones_movidas++; devoluciones++;
    }
  }
  for (let i = devoluciones; i < MIN_DEVOLUCIONES; i++) {
    const fin = horaAgenda(ahora, dslot++, 'devolucion');
    if (!fin) break;
    if (await nuevaReserva(E, { estado: 'en_curso', inicio: new Date(fin.getTime() - 3 * DIA), fin })) out.devoluciones_nuevas++;
  }
  return out;
}

// Para la tarea programada: no hace nada si la cuenta no existe.
export async function renovarAgendaRevision() {
  const e = await empresaRevision();
  return e ? renovarAgenda(e.id) : null;
}
