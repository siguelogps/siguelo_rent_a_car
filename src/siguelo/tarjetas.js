// Estado de las conexiones de un cliente, sin secretos: lo usan la vista del cliente (Configuración › Conexiones, tarjetas
// de solo lectura «Gestionado por Síguelo GPS») y el backoffice (salud de cada integración en la lista y en la ficha).
// Regla de la casa: lo que no se sabe va como «—», nunca como cero.
import { q, uno } from '../db.js';
import { TIPOS, leer, tiposDe } from '../integraciones/index.js';
import { configuracionPush } from '../app-nativa/push.js';
import { incluye } from '../planes.js';

const CUENTA = { hosting: 'Síguelo Pro', lite: 'Síguelo Lite' };
const SIN = '—';

const configurada = (tipo, c) => {
  if (tipo === 'dashboard_siguelo') return !!c.url && !!(c.api_key || c.token_plataforma);
  if (tipo === 'correo' && c.modo === 'siguelo') return true;
  if (tipo === 'correo') return !!(c.host && c.clave);
  return TIPOS[tipo].campos.filter((f) => f.secreto && !f.opcional).every((f) => c[f.clave]);
};

// Salud para el backoffice: ok (funciona) · mal (última prueba con error) · esp (en preparación) · no (no contratada)
export function salud(tipo, v) {
  const datos = configurada(tipo, v.config);
  if (!v.activa) return datos ? 'esp' : 'no';
  if (!datos) return 'esp';
  if (String(v.estado_prueba || '').startsWith('error')) return 'mal';
  return 'ok';
}

// Estado que ve el cliente (22-oct, Pablo): activo · en preparación (encendida por Síguelo pero sin configurar: «Síguelo
// GPS la está dejando lista», sin «Solicitar») · no contratado. Una apagada con datos guardados no está «en preparación»:
// Síguelo la apagó, así que para el cliente no está contratada (antes salía «En preparación» con «Solicitar un cambio»).
const estadoCliente = (tipo, v) => (!v.activa ? 'no_contratado' : configurada(tipo, v.config) ? 'activo' : 'en_preparacion');

async function datosDe(empresaId, tipo, v) {
  const c = v.config;
  if (tipo === 'gps') {
    const n = await uno(`SELECT count(*) FILTER (WHERE gps_unidad_id IS NOT NULL)::int AS con, count(*)::int AS total FROM vehiculos WHERE empresa_id = $1 AND activo`, [empresaId]);
    return [['Cuenta', c.token ? CUENTA[c.cuenta] || CUENTA.hosting : SIN], ['Usuario conectado', c.token && c.usuario ? c.usuario : SIN, true], ['Unidades vinculadas', c.token ? `${n.con} de ${n.total}` : SIN, true]];
  }
  if (tipo === 'simpleapi') {
    let folios = SIN;
    try {
      const { resumenFolios } = await import('../facturacion/index.js');
      const r = await resumenFolios(empresaId);
      const conDato = r.folios.filter((f) => f.quedan != null);
      if (conDato.length) folios = `${conDato.reduce((s, f) => s + f.quedan, 0).toLocaleString('es-CL')} disponibles`;
    } catch { /* sin dato: se muestra «—» */ }
    return [['Certificado digital', c.certificado_archivo_id ? 'recibido' : 'sin recibir'], ['Folios', folios, true], ['Ambiente', c.ambiente === 'produccion' ? 'producción' : 'certificación']];
  }
  if (tipo === 'correo') {
    return c.modo === 'smtp'
      ? [['Sale por', 'servidor propio'], ['Remitente', String(c.remitente || c.usuario || SIN).replace(/<.*>/, '').trim() || SIN]]
      : [['Remitente visible', c.remitente_nombre || (await uno('SELECT nombre FROM empresas WHERE id = $1', [empresaId]))?.nombre || SIN], ['Responder a', c.responder_a || SIN, true]];
  }
  if (tipo === 'whatsapp') return v.activa ? [['Plantilla', c.plantilla || SIN, true], ['Idioma', c.idioma || SIN]] : [['Qué incluye', 'Plantillas aprobadas, envío desde tu número o el de Síguelo. Tiene costo por mensaje.']];
  if (tipo === 'dashboard_siguelo') {
    const s = await uno(`SELECT creado_en, estado FROM dashboard_sincronizaciones WHERE empresa_id = $1 ORDER BY creado_en DESC LIMIT 1`, [empresaId]).catch(() => null);
    return [['Última sincronización', s ? { fecha: s.creado_en } : SIN, true], ['Datos', 'TAG · multas']];
  }
  return [];
}

// 22-oct (Pablo): la plataforma GPS la conecta el propio cliente (su administrador, o Síguelo con «Operar»), con el
// ingreso con usuario y clave. Antes la tarjeta salía «No contratado · Solicitar a Síguelo» y no dejaba conectar nada.
// Estados de la tarjeta GPS:
//   · no_contratado: el plan no trae la plataforma GPS, o Síguelo la apagó a propósito → «Solicitar a Síguelo».
//   · por_conectar: se puede conectar y aún no tiene cuenta → selector Síguelo Pro / Síguelo Lite + «Ingresar…».
//   · activo: conectada y encendida → cuenta, usuario, unidades y «Cambiar de cuenta».
//   · en_preparacion: tiene cuenta, pero Síguelo aún no la enciende (la conectó desde el backoffice).
// puedeConectar lo decide la ruta (administrador del cliente o Síguelo en «Operar»; «Ver como» no) y el servidor lo vuelve
// a exigir al conectar: la pantalla solo esconde el botón.
async function tarjetaGps(empresaId, v, { puedeConectar }) {
  const enPlan = await incluye(empresaId, 'gps');
  const conectable = enPlan && !v.apagada_por_siguelo;
  const estado = !conectable ? 'no_contratado' : !v.config.token ? 'por_conectar' : v.activa ? 'activo' : 'en_preparacion';
  return {
    tipo: 'gps', nombre: TIPOS.gps.nombreCliente || TIPOS.gps.nombre, descripcion: TIPOS.gps.descripcionCliente || TIPOS.gps.descripcion,
    estado, datos: estado === 'por_conectar' || estado === 'no_contratado' ? [] : await datosDe(empresaId, 'gps', v),
    conexion: { la_conecta: 'cliente', conectable, puede_conectar: conectable && !!puedeConectar, cuenta: v.config.cuenta === 'lite' ? 'lite' : 'hosting',
      motivo: !enPlan ? 'plan' : v.apagada_por_siguelo ? 'apagada' : null }
  };
}

// Lista para la vista del cliente: una tarjeta por conexión gestionada por Síguelo + los avisos push (servicio general).
// Las demás (facturación, correo, WhatsApp, Síguelo OS) solo las activa Síguelo: activo · en preparación (encendida por
// Síguelo pero sin configurar) · no contratado.
export async function tarjetasCliente(empresaId, { puedeConectar = false } = {}) {
  const out = [];
  for (const tipo of tiposDe('siguelo')) {
    const v = await leer(empresaId, tipo);
    if (tipo === 'gps') { out.push(await tarjetaGps(empresaId, v, { puedeConectar })); continue; }
    out.push({ tipo, nombre: TIPOS[tipo].nombreCliente || TIPOS[tipo].nombre, descripcion: TIPOS[tipo].descripcionCliente || TIPOS[tipo].descripcion, estado: estadoCliente(tipo, v), datos: await datosDe(empresaId, tipo, v) });
  }
  const push = await configuracionPush().catch(() => ({ configurado: false }));
  const disp = await uno('SELECT count(*)::int AS n FROM dispositivos WHERE empresa_id = $1', [empresaId]).catch(() => null);
  out.push({ tipo: 'push', nombre: 'Avisos a la app', descripcion: 'Notificaciones en la app Síguelo On Rent del equipo.', estado: push.configurado ? 'activo' : 'no_contratado', general: true,
    datos: [['Servicio', 'general de Síguelo'], ['Teléfonos', disp ? String(disp.n) : SIN, true]] });
  return out;
}

// Salud de todas las integraciones de todos los clientes, en una sola consulta (lista del backoffice).
export async function saludDeTodos() {
  const filas = await q(`SELECT empresa_id, tipo FROM integraciones WHERE tipo <> 'almacenamiento'`);
  const mapa = new Map();
  for (const f of filas) {
    const v = await leer(f.empresa_id, f.tipo).catch(() => null);
    if (!v || !TIPOS[f.tipo]) continue;
    if (!mapa.has(f.empresa_id)) mapa.set(f.empresa_id, {});
    mapa.get(f.empresa_id)[f.tipo] = salud(f.tipo, v);
  }
  return mapa;
}
