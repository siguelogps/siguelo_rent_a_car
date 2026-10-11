// Portal web de reservas para el cliente final (público, sin sesión). La empresa se resuelve por su slug.
// Búsqueda por categoría con disponibilidad real, cotización con el motor de precios, creación de la reserva en una
// transacción que vuelve a revisar la disponibilidad (vehículo bloqueado con FOR UPDATE) y cobro en línea con el
// módulo de pagos (o pago simulado en marcha blanca / mientras el módulo no esté instalado).
import { q, uno, transaccion, siguienteFolio } from '../db.js';
import { ErrorHttp } from '../auth.js';
import { cotizar } from '../cotizador.js';
import { conflictos, vehiculosDisponibles } from '../disponibilidad.js';
import { puedeActuar } from '../integraciones/index.js';
import { avisar } from '../salidas.js';
import { tokenAleatorio } from '../cifrado.js';
import { config } from '../config.js';
import { validarRut, normalizarRut } from '../util/rut.js';
import { desdeLocal, clp, fechaHora } from '../util/formato.js';

export const MODOS_PAGO = ['obligatorio', 'opcional', 'mostrador'];
export const ESTADOS_PAGADOS = ['pagado', 'capturado', 'autorizado', 'simulado'];
const ANTICIPACION_MIN_H = 2;
const MAX_DIAS = 90;

export async function empresaPorSlug(slug) {
  const e = await uno('SELECT * FROM empresas WHERE slug = $1 AND activa', [String(slug || '').toLowerCase()]);
  if (!e) throw new ErrorHttp(404, 'No encontramos este rentacar.');
  return e;
}

export const modoPago = (e) => (MODOS_PAGO.includes(e.ajustes?.portal_pago) ? e.ajustes.portal_pago : 'opcional');

// Proveedores de pago en línea a ofrecer: los activos; si no hay ninguno (marcha blanca / sin configurar) se ofrece Webpay simulado.
export async function proveedoresPago(empresaId) {
  const out = [];
  for (const p of ['webpay', 'mercadopago']) if ((await puedeActuar(empresaId, p)).ok) out.push(p);
  return { proveedores: out.length ? out : ['webpay'], simulado: !out.length };
}

// Datos públicos del rentacar para pintar el portal (sin nada interno).
export async function infoPublica(e) {
  const [sucursales, categorias, extras] = await Promise.all([
    q('SELECT id, nombre, direccion, comuna, ciudad, horario, telefono FROM sucursales WHERE empresa_id = $1 AND activa ORDER BY id', [e.id]),
    q('SELECT id, nombre, descripcion, pasajeros, maletas, transmision, ejemplo FROM categorias WHERE empresa_id = $1 AND activa ORDER BY orden, id', [e.id]),
    q('SELECT codigo, nombre, descripcion, cobro, precio, tope FROM extras WHERE empresa_id = $1 AND activo ORDER BY id', [e.id])
  ]);
  const pago = await proveedoresPago(e.id);
  return {
    nombre: e.nombre, slug: e.slug, color: e.color || '#0F5F58', logo: !!e.logo_clave, telefono: e.telefono, correo: e.correo, sitio_web: e.sitio_web,
    sucursales, categorias, extras, portal_pago: modoPago(e), ...pago,
    edad_minima: e.ajustes?.edad_minima || null, anticipacion_horas: e.ajustes?.portal_anticipacion_horas ?? ANTICIPACION_MIN_H
  };
}

const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const esHora = (s) => /^\d{2}:\d{2}$/.test(String(s || ''));

// Valida y normaliza la búsqueda (fechas y horas en hora de Chile).
export async function leerBusqueda(e, b = {}) {
  const sr = Number(b.sucursal_retiro_id), sd = Number(b.sucursal_devolucion_id || b.sucursal_retiro_id);
  const sucs = await q('SELECT id FROM sucursales WHERE empresa_id = $1 AND activa AND id = ANY($2)', [e.id, [sr, sd]]);
  if (!sr || !sucs.some((s) => s.id === sr)) throw new ErrorHttp(400, 'Elige la sucursal de retiro.', { campo: 'sucursal_retiro_id' });
  if (!sucs.some((s) => s.id === sd)) throw new ErrorHttp(400, 'Elige la sucursal de devolución.', { campo: 'sucursal_devolucion_id' });
  if (!esFecha(b.retiro_fecha) || !esHora(b.retiro_hora)) throw new ErrorHttp(400, 'Indica la fecha y hora de retiro.', { campo: 'retiro_fecha' });
  if (!esFecha(b.devolucion_fecha) || !esHora(b.devolucion_hora)) throw new ErrorHttp(400, 'Indica la fecha y hora de devolución.', { campo: 'devolucion_fecha' });
  const inicio = desdeLocal(b.retiro_fecha, b.retiro_hora), fin = desdeLocal(b.devolucion_fecha, b.devolucion_hora);
  const anticipacion = Number(e.ajustes?.portal_anticipacion_horas ?? ANTICIPACION_MIN_H);
  if (inicio.getTime() < Date.now() + anticipacion * 36e5) throw new ErrorHttp(400, `El retiro debe ser con al menos ${anticipacion} horas de anticipación.`, { campo: 'retiro_fecha' });
  if (fin.getTime() - inicio.getTime() < 2 * 36e5) throw new ErrorHttp(400, 'La devolución debe ser posterior al retiro.', { campo: 'devolucion_fecha' });
  if (fin.getTime() - inicio.getTime() > MAX_DIAS * 864e5) throw new ErrorHttp(400, `Por el portal se puede reservar hasta ${MAX_DIAS} días. Para arriendos más largos contáctanos.`, { campo: 'devolucion_fecha' });
  let categoriaId = b.categoria_id ? Number(b.categoria_id) : null;
  if (categoriaId && !(await uno('SELECT 1 FROM categorias WHERE id = $1 AND empresa_id = $2 AND activa', [categoriaId, e.id]))) categoriaId = null;
  const codigo = String(b.codigo_descuento || '').trim().slice(0, 40) || null;
  return { inicio, fin, sucursalRetiroId: sr, sucursalDevolucionId: sd, categoriaId, codigo };
}

const extrasValidos = (extras) => (Array.isArray(extras) ? extras : [])
  .filter((x) => x && typeof x.codigo === 'string')
  .slice(0, 20).map((x) => ({ codigo: x.codigo.slice(0, 60), cantidad: Math.min(5, Math.max(1, Number(x.cantidad) || 1)) }));

const publicaCot = (c) => ({ dias: c.dias, temporada: c.temporada, lineas: c.lineas, subtotal: c.subtotal, descuento: c.descuento, total: c.total,
  por_dia: Math.round(c.total / Math.max(1, c.dias)), km_libre: c.km_libre, km_incluidos: c.km_incluidos, precio_km_extra: c.precio_km_extra,
  garantia: c.garantia, deducible: c.deducible, avisos: c.avisos });

// Resultados por categoría: disponibilidad (al menos un vehículo libre) y precio total y por día.
export async function buscar(e, bq) {
  const cats = await q(`SELECT id, nombre, descripcion, pasajeros, maletas, transmision, ejemplo FROM categorias
                         WHERE empresa_id = $1 AND activa AND ($2::bigint IS NULL OR id = $2) ORDER BY orden, id`, [e.id, bq.categoriaId]);
  const resultados = [];
  for (const c of cats) {
    let cot;
    try {
      cot = await cotizar({ empresaId: e.id, categoriaId: c.id, inicio: bq.inicio, fin: bq.fin, sucursalRetiroId: bq.sucursalRetiroId, sucursalDevolucionId: bq.sucursalDevolucionId, codigoDescuento: bq.codigo });
    } catch { continue; } // sin tarifa: no se ofrece
    const libres = await vehiculosDisponibles(e.id, { inicio: bq.inicio, fin: bq.fin, categoriaId: c.id });
    resultados.push({ ...c, disponible: libres.length > 0, quedan_pocos: libres.length > 0 && libres.length <= 2, cotizacion: publicaCot(cot) });
  }
  resultados.sort((a, b) => Number(b.disponible) - Number(a.disponible));
  return { inicio: bq.inicio, fin: bq.fin, dias: resultados[0]?.cotizacion.dias ?? null, resultados };
}

export async function cotizarPortal(e, bq, { categoriaId, extras, fechaNacimiento }) {
  if (!(await uno('SELECT 1 FROM categorias WHERE id = $1 AND empresa_id = $2 AND activa', [categoriaId, e.id]))) throw new ErrorHttp(400, 'Elige una categoría.');
  const c = await cotizar({ empresaId: e.id, categoriaId, inicio: bq.inicio, fin: bq.fin, sucursalRetiroId: bq.sucursalRetiroId, sucursalDevolucionId: bq.sucursalDevolucionId,
    extras: extrasValidos(extras), codigoDescuento: bq.codigo, fechaNacimiento: esFecha(fechaNacimiento) ? fechaNacimiento : null });
  return publicaCot(c);
}

const edadEn = (nac, en) => {
  const n = new Date(`${nac}T12:00:00Z`), f = new Date(en);
  let a = f.getUTCFullYear() - n.getUTCFullYear();
  if (f.getUTCMonth() < n.getUTCMonth() || (f.getUTCMonth() === n.getUTCMonth() && f.getUTCDate() < n.getUTCDate())) a--;
  return a;
};
const correoValido = (c) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c);

// Datos del cliente que llegan del formulario (validados; nunca se confía en el navegador).
export function leerCliente(e, c = {}, inicio, fin) {
  const tipo = ['rut', 'pasaporte', 'dni'].includes(c.documento_tipo) ? c.documento_tipo : 'rut';
  let documento = String(c.documento || '').trim();
  if (tipo === 'rut') {
    if (!validarRut(documento)) throw new ErrorHttp(400, 'El RUT no es válido. Revisa el dígito verificador.', { campo: 'documento' });
    documento = normalizarRut(documento);
  } else {
    documento = documento.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (documento.length < 5 || documento.length > 20) throw new ErrorHttp(400, 'El número de documento no es válido.', { campo: 'documento' });
  }
  const nombre = String(c.nombre || '').trim().slice(0, 80), apellidos = String(c.apellidos || '').trim().slice(0, 80);
  if (nombre.length < 2) throw new ErrorHttp(400, 'Escribe tu nombre.', { campo: 'nombre' });
  if (apellidos.length < 2) throw new ErrorHttp(400, 'Escribe tus apellidos.', { campo: 'apellidos' });
  const correo = String(c.correo || '').trim().toLowerCase().slice(0, 120);
  if (!correoValido(correo)) throw new ErrorHttp(400, 'El correo no es válido.', { campo: 'correo' });
  const telefono = String(c.telefono || '').trim().slice(0, 30);
  if (telefono.replace(/\D/g, '').length < 8) throw new ErrorHttp(400, 'El teléfono no es válido.', { campo: 'telefono' });
  if (!esFecha(c.fecha_nacimiento)) throw new ErrorHttp(400, 'Indica tu fecha de nacimiento.', { campo: 'fecha_nacimiento' });
  const edad = edadEn(c.fecha_nacimiento, inicio);
  if (edad < 18 || edad > 100) throw new ErrorHttp(400, 'Revisa tu fecha de nacimiento.', { campo: 'fecha_nacimiento' });
  const minima = Number(e.ajustes?.edad_minima) || 18;
  if (edad < minima) throw new ErrorHttp(400, `La edad mínima para arrendar es ${minima} años.`, { campo: 'fecha_nacimiento' });
  const licencia_numero = String(c.licencia_numero || '').trim().slice(0, 30) || null;
  const licencia_clase = String(c.licencia_clase || '').trim().slice(0, 20) || null;
  const licencia_vence = esFecha(c.licencia_vence) ? c.licencia_vence : null;
  if (!licencia_clase) throw new ErrorHttp(400, 'Indica la clase de tu licencia de conducir.', { campo: 'licencia_clase' });
  if (licencia_vence && new Date(`${licencia_vence}T23:59:59`) < new Date(fin)) throw new ErrorHttp(400, 'Tu licencia vence antes de la devolución del vehículo.', { campo: 'licencia_vence' });
  const extranjero = tipo !== 'rut';
  return {
    documento_tipo: tipo, documento, nombre, apellidos, correo, telefono, fecha_nacimiento: c.fecha_nacimiento, licencia_numero, licencia_clase, licencia_vence,
    nacionalidad: extranjero ? String(c.nacionalidad || '').trim().slice(0, 60) || null : 'Chile',
    pais: extranjero ? String(c.pais || c.nacionalidad || '').trim().slice(0, 60) || null : 'Chile',
    licencia_pais: extranjero ? String(c.licencia_pais || c.pais || c.nacionalidad || '').trim().slice(0, 60) || null : 'Chile'
  };
}

// Toma un vehículo libre de la categoría para el período, bloqueándolo (FOR UPDATE) y revisando conflictos.
// Prefiere los vehículos que están en la sucursal de retiro. Devuelve el id o null.
export async function asignarVehiculo(tx, empresaId, { categoriaId, inicio, fin, sucursalRetiroId, excluirReservaId = null, preferido = null }) {
  const candidatos = await vehiculosDisponibles(empresaId, { inicio, fin, categoriaId, excluirReservaId, cx: tx });
  candidatos.sort((a, b) => Number(b.id === preferido) - Number(a.id === preferido) || Number(b.sucursal_id === sucursalRetiroId) - Number(a.sucursal_id === sucursalRetiroId) || a.km - b.km);
  for (const v of candidatos) {
    const [fila] = await tx.query('SELECT id FROM vehiculos WHERE id = $1 AND empresa_id = $2 AND activo AND categoria_id = $3 FOR UPDATE', [v.id, empresaId, categoriaId]);
    if (!fila) continue;
    const c = await conflictos(empresaId, v.id, inicio, fin, { excluirReservaId, cx: tx });
    if (!c.length) return v.id;
  }
  return null;
}

// Cobro en línea: usa src/pagos/index.js (otro módulo) si existe y puede cobrar; si no está, o la empresa está en marcha
// blanca / sin integración activa, registra un pago «simulado» para que el flujo funcione de punta a punta.
export async function cobrar({ empresaId, reservaId, clienteId, monto, proveedor, token, folio }) {
  const urlRetorno = `${config.urlBase}/portal/${token}?pago=1`;
  const real = (await puedeActuar(empresaId, proveedor)).ok;
  let mod = null;
  try { mod = await import('../pagos/index.js'); } catch { mod = null; }
  if (mod?.iniciarCobro) {
    try {
      const r = await mod.iniciarCobro({ empresaId, reservaId, concepto: 'arriendo', monto, proveedor, urlRetorno, diferido: false });
      if (r) return { pagoId: r.pagoId ?? null, redirigir: r.redirigir || null, simulado: !!r.simulado };
    } catch (err) {
      if (real) return { error: err.message || 'No se pudo iniciar el pago' };
    }
  } else if (real) {
    return { error: 'El pago en línea no está disponible en este momento' };
  }
  const [p] = await q(`INSERT INTO pagos (empresa_id, reserva_id, cliente_id, concepto, metodo, estado, monto, referencia, detalle)
                       VALUES ($1,$2,$3,'arriendo',$4,'simulado',$5,$6,$7) RETURNING id`,
  [empresaId, reservaId, clienteId, proveedor === 'mercadopago' ? 'mercadopago' : 'webpay', monto, `PORTAL-${folio}`,
    JSON.stringify({ origen: 'portal', motivo: 'Marcha blanca o pago en línea no configurado: pago simulado' })]);
  return { pagoId: p.id, redirigir: null, simulado: true };
}

// Datos para las plantillas de aviso (reserva_confirmada).
export async function datosAviso(empresaId, reservaId) {
  const r = await uno(`SELECT r.*, c.nombre AS c_nombre, c.apellidos AS c_apellidos, c.correo AS c_correo, c.telefono AS c_telefono,
      sr.nombre AS sr_nombre, sr.direccion AS sr_direccion, sd.nombre AS sd_nombre, sd.direccion AS sd_direccion, e.nombre AS e_nombre, e.telefono AS e_telefono,
      e.correo AS e_correo, cat.nombre AS cat_nombre
    FROM reservas r JOIN empresas e ON e.id = r.empresa_id LEFT JOIN clientes c ON c.id = r.cliente_id
    LEFT JOIN sucursales sr ON sr.id = r.sucursal_retiro_id LEFT JOIN sucursales sd ON sd.id = r.sucursal_devolucion_id
    LEFT JOIN categorias cat ON cat.id = r.categoria_id
    WHERE r.id = $1 AND r.empresa_id = $2`, [reservaId, empresaId]);
  if (!r) return null;
  return {
    fila: r,
    datos: {
      cliente: { nombre: r.c_nombre, apellidos: r.c_apellidos, nombre_completo: `${r.c_nombre} ${r.c_apellidos || ''}`.trim() },
      reserva: { folio: r.folio, inicio: fechaHora(r.inicio), fin: fechaHora(r.fin), total: clp(r.total), categoria: r.cat_nombre },
      sucursal_retiro: { nombre: r.sr_nombre, direccion: r.sr_direccion }, sucursal_devolucion: { nombre: r.sd_nombre, direccion: r.sd_direccion },
      empresa: { nombre: r.e_nombre, telefono: r.e_telefono, correo: r.e_correo },
      url_portal: `${config.urlBase}/portal/${r.token_portal}`
    }
  };
}

export async function avisarConfirmada(empresaId, reservaId, { correo = null, telefono = null } = {}) {
  const d = await datosAviso(empresaId, reservaId);
  if (!d) return [];
  return avisar({ empresaId, clave: 'reserva_confirmada', datos: d.datos, correo: correo || d.fila.c_correo, telefono: telefono || d.fila.c_telefono, entidad: 'reserva', entidadId: reservaId });
}

/**
 * Crea la reserva del portal. pago: 'online' | 'mostrador'.
 * Devuelve { reserva, cobro, mensaje }.
 */
export async function crearReservaPortal(e, { busqueda, categoriaId, extras, cliente, pago, proveedor }) {
  const bq = await leerBusqueda(e, busqueda);
  categoriaId = Number(categoriaId);
  if (!(await uno('SELECT 1 FROM categorias WHERE id = $1 AND empresa_id = $2 AND activa', [categoriaId, e.id]))) throw new ErrorHttp(400, 'Elige una categoría.');
  const cli = leerCliente(e, cliente, bq.inicio, bq.fin);
  const modo = modoPago(e);
  let enLinea = pago === 'online';
  if (modo === 'obligatorio') enLinea = true;
  if (modo === 'mostrador') enLinea = false;
  const { proveedores } = await proveedoresPago(e.id);
  const prov = proveedores.includes(proveedor) ? proveedor : proveedores[0];
  const lista = extrasValidos(extras);

  const creada = await transaccion(async (tx) => {
    const [c] = await tx.query(
      `INSERT INTO clientes (empresa_id, nombre, apellidos, documento_tipo, documento, fecha_nacimiento, correo, telefono, licencia_numero, licencia_clase, licencia_vence,
                             licencia_pais, nacionalidad, pais, origen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'portal')
       ON CONFLICT (empresa_id, documento_tipo, documento) DO UPDATE SET
         correo = COALESCE(clientes.correo, EXCLUDED.correo), telefono = COALESCE(clientes.telefono, EXCLUDED.telefono),
         fecha_nacimiento = COALESCE(clientes.fecha_nacimiento, EXCLUDED.fecha_nacimiento), licencia_numero = COALESCE(clientes.licencia_numero, EXCLUDED.licencia_numero),
         licencia_clase = COALESCE(clientes.licencia_clase, EXCLUDED.licencia_clase), licencia_vence = COALESCE(clientes.licencia_vence, EXCLUDED.licencia_vence)
       RETURNING id, lista_negra, correo, telefono`,
      [e.id, cli.nombre, cli.apellidos, cli.documento_tipo, cli.documento, cli.fecha_nacimiento, cli.correo, cli.telefono, cli.licencia_numero, cli.licencia_clase, cli.licencia_vence,
        cli.licencia_pais, cli.nacionalidad, cli.pais]);
    const cot = await cotizar({ empresaId: e.id, categoriaId, inicio: bq.inicio, fin: bq.fin, sucursalRetiroId: bq.sucursalRetiroId, sucursalDevolucionId: bq.sucursalDevolucionId,
      extras: lista, codigoDescuento: bq.codigo, fechaNacimiento: cli.fecha_nacimiento }, tx);
    const vehiculoId = await asignarVehiculo(tx, e.id, { categoriaId, inicio: bq.inicio, fin: bq.fin, sucursalRetiroId: bq.sucursalRetiroId });
    if (!vehiculoId) throw new ErrorHttp(409, 'Lo sentimos: justo se reservó el último vehículo de esta categoría para esas fechas. Elige otra categoría u otras fechas.');
    const notas = [];
    if (c.lista_negra) notas.push('Reserva del portal de un cliente en lista negra: revisar antes de confirmar.');
    // Si los datos de contacto difieren de los registrados, se dejan anotados para el counter (no se sobrescriben).
    if (c.correo && c.correo.toLowerCase() !== cli.correo) notas.push(`Correo indicado en el portal: ${cli.correo}`);
    if (c.telefono && c.telefono.replace(/\D/g, '') !== cli.telefono.replace(/\D/g, '')) notas.push(`Teléfono indicado en el portal: ${cli.telefono}`);
    const pagarAhora = enLinea && !c.lista_negra && cot.total > 0;
    if (!pagarAhora && !c.lista_negra) notas.push(enLinea ? 'Reserva del portal sin cobro en línea.' : 'Reserva del portal: paga en el mesón al retirar.');
    const estado = pagarAhora ? 'confirmada' : 'cotizacion';
    const folio = await siguienteFolio(e.id, estado === 'confirmada' ? 'R' : 'C', tx);
    const token = tokenAleatorio(18);
    const [r] = await tx.query(
      `INSERT INTO reservas (empresa_id, folio, estado, cliente_id, vehiculo_id, categoria_id, sucursal_retiro_id, sucursal_devolucion_id, inicio, fin, extras, codigo_descuento,
                             cotizacion, total, km_incluidos, precio_km_extra, garantia, deducible, origen, token_portal, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'portal',$19,$20) RETURNING *`,
      [e.id, folio, estado, c.id, vehiculoId, categoriaId, bq.sucursalRetiroId, bq.sucursalDevolucionId, bq.inicio, bq.fin, JSON.stringify(lista), cot.descuento ? bq.codigo : null,
        JSON.stringify(cot), cot.total, cot.km_incluidos, cot.precio_km_extra, cot.garantia, cot.deducible, token, notas.join('\n') || null]);
    if (cot.descuento && bq.codigo) await tx.query('UPDATE descuentos SET usos = usos + 1 WHERE empresa_id = $1 AND upper(codigo) = upper($2)', [e.id, bq.codigo]);
    await tx.query(`INSERT INTO bitacora (empresa_id, accion, entidad, entidad_id, detalle) VALUES ($1,'reserva_portal','reserva',$2,$3)`,
      [e.id, r.id, JSON.stringify({ folio, estado, total: cot.total, lista_negra: !!c.lista_negra })]);
    return { reserva: r, cliente: c, pagarAhora };
  });

  let { reserva } = creada;
  let cobro = null, mensaje;
  if (creada.pagarAhora) {
    cobro = await cobrar({ empresaId: e.id, reservaId: reserva.id, clienteId: creada.cliente.id, monto: reserva.total, proveedor: prov, token: reserva.token_portal, folio: reserva.folio });
    if (cobro.simulado) {
      mensaje = 'Tu reserva está confirmada. Te enviamos el detalle por correo.';
      await avisarConfirmada(e.id, reserva.id, { correo: cli.correo, telefono: cli.telefono }).catch(() => {});
    } else {
      // Pago real pendiente (redirección a Webpay / Mercado Pago) o error al iniciarlo: la reserva queda por confirmar.
      [reserva] = await q(`UPDATE reservas SET estado = 'cotizacion', notas = concat_ws(E'\\n', notas, $3::text), actualizado_en = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`,
        [reserva.id, e.id, cobro.error ? `No se pudo iniciar el pago en línea: ${cobro.error}` : 'Esperando confirmación del pago en línea.']);
      mensaje = cobro.error ? 'Recibimos tu reserva, pero no pudimos iniciar el pago. Puedes pagar desde tu reserva o en el mesón.' : 'Te estamos llevando al pago…';
    }
  } else {
    mensaje = 'Recibimos tu reserva. Te esperamos en el mesón para completar el pago y confirmar.';
  }
  return { reserva, cobro, mensaje };
}

// ── Área del cliente (/portal/:token) ──
export const TIPOS_DOCUMENTO = { cedula_frente: 'Cédula de identidad (frente)', cedula_reverso: 'Cédula de identidad (reverso)', licencia: 'Licencia de conducir', pasaporte: 'Pasaporte' };

export async function reservaPorToken(token) {
  const t = String(token || '');
  if (t.length < 16 || t.length > 64 || !/^[\w-]+$/.test(t)) throw new ErrorHttp(404, 'No encontramos esta reserva. Revisa el enlace.');
  const r = await uno(`SELECT r.* FROM reservas r JOIN empresas e ON e.id = r.empresa_id WHERE r.token_portal = $1 AND e.activa`, [t]);
  if (!r) throw new ErrorHttp(404, 'No encontramos esta reserva. Revisa el enlace.');
  return r;
}

export async function resumenParaCliente(r) {
  const E = r.empresa_id;
  const [e, c, sr, sd, cat, veh, pagos, docs, contrato, liq] = await Promise.all([
    uno('SELECT * FROM empresas WHERE id = $1', [E]),
    uno('SELECT nombre, apellidos, documento_tipo, documento, correo, telefono, lista_negra FROM clientes WHERE id = $1 AND empresa_id = $2', [r.cliente_id, E]),
    uno('SELECT nombre, direccion, comuna, ciudad, horario, telefono FROM sucursales WHERE id = $1 AND empresa_id = $2', [r.sucursal_retiro_id, E]),
    uno('SELECT nombre, direccion, comuna, ciudad, horario, telefono FROM sucursales WHERE id = $1 AND empresa_id = $2', [r.sucursal_devolucion_id, E]),
    uno('SELECT nombre, ejemplo, pasajeros, maletas, transmision FROM categorias WHERE id = $1 AND empresa_id = $2', [r.categoria_id, E]),
    uno('SELECT patente, marca, modelo, color FROM vehiculos WHERE id = $1 AND empresa_id = $2', [r.vehiculo_id, E]),
    q('SELECT concepto, metodo, estado, monto, creado_en FROM pagos WHERE reserva_id = $1 AND empresa_id = $2 ORDER BY id', [r.id, E]),
    r.cliente_id ? q(`SELECT tipo, max(creado_en) AS subido_en FROM archivos WHERE empresa_id = $1 AND entidad = 'cliente' AND entidad_id = $2 AND tipo = ANY($3) GROUP BY tipo`, [E, r.cliente_id, Object.keys(TIPOS_DOCUMENTO)]) : [],
    uno(`SELECT folio, estado, firmado_en, pdf_archivo_id FROM contratos WHERE reserva_id = $1 AND empresa_id = $2 AND estado <> 'anulado' ORDER BY id DESC LIMIT 1`, [r.id, E]),
    uno(`SELECT folio, estado, lineas, total_cargos, garantia_retenida, garantia_capturada, garantia_liberada, saldo_por_cobrar FROM liquidaciones WHERE reserva_id = $1 AND empresa_id = $2 AND estado IN ('aprobada','cobrada')`, [r.id, E])
  ]);
  const pagado = pagos.filter((p) => p.concepto === 'arriendo' && ESTADOS_PAGADOS.includes(p.estado)).reduce((s, p) => s + p.monto, 0);
  const activa = ['cotizacion', 'confirmada', 'en_curso'].includes(r.estado);
  const saldo = activa ? Math.max(0, r.total - pagado) : 0;
  const { proveedores, simulado } = await proveedoresPago(E);
  const extranjero = c && c.documento_tipo !== 'rut';
  return {
    empresa: { nombre: e.nombre, slug: e.slug, color: e.color || '#0F5F58', logo: !!e.logo_clave, telefono: e.telefono, correo: e.correo },
    reserva: { folio: r.folio, estado: r.estado, inicio: r.inicio, fin: r.fin, total: r.total, garantia: r.garantia, deducible: r.deducible, km_incluidos: r.km_incluidos,
      precio_km_extra: r.precio_km_extra, lineas: r.cotizacion?.lineas || [], dias: r.cotizacion?.dias || null, creado_en: r.creado_en, retiro_real: r.retiro_real, devolucion_real: r.devolucion_real },
    cliente: c ? { nombre: c.nombre, apellidos: c.apellidos, documento_tipo: c.documento_tipo, documento: c.documento, correo: c.correo } : null,
    sucursal_retiro: sr, sucursal_devolucion: sd, categoria: cat,
    vehiculo: veh && ['en_curso', 'devuelta', 'cerrada'].includes(r.estado) ? veh : null,
    pagos, pagado, saldo,
    puede_pagar: saldo > 0 && !c?.lista_negra, proveedores, pago_simulado: simulado,
    documentos: {
      requeridos: extranjero ? ['pasaporte', 'licencia'] : ['cedula_frente', 'cedula_reverso', 'licencia'],
      nombres: TIPOS_DOCUMENTO,
      subidos: Object.fromEntries(docs.map((d) => [d.tipo, d.subido_en])),
      puede_subir: activa
    },
    contrato: contrato ? { folio: contrato.folio, estado: contrato.estado, firmado_en: contrato.firmado_en, pdf: contrato.estado === 'firmado' && !!contrato.pdf_archivo_id } : null,
    liquidacion: liq ? { folio: liq.folio, estado: liq.estado, lineas: (liq.lineas || []).filter((l) => l.incluir !== false).map((l) => ({ concepto: l.concepto, calculo: l.calculo || '', monto: l.monto })),
      total_cargos: liq.total_cargos, garantia_retenida: liq.garantia_retenida, garantia_capturada: liq.garantia_capturada, garantia_liberada: liq.garantia_liberada, saldo_por_cobrar: liq.saldo_por_cobrar } : null
  };
}

// Pago de lo pendiente desde el área del cliente. Una cotización se confirma (revisando disponibilidad) si el pago se aprueba.
export async function pagarPendiente(r, proveedor) {
  const s = await resumenParaCliente(r);
  if (!s.puede_pagar) throw new ErrorHttp(400, 'Esta reserva no tiene montos pendientes de pago en línea.');
  const { proveedores } = await proveedoresPago(r.empresa_id);
  const prov = proveedores.includes(proveedor) ? proveedor : proveedores[0];
  const eraCotizacion = r.estado === 'cotizacion';
  if (eraCotizacion) {
    await transaccion(async (tx) => {
      const vehiculoId = await asignarVehiculo(tx, r.empresa_id, { categoriaId: r.categoria_id, inicio: r.inicio, fin: r.fin, sucursalRetiroId: r.sucursal_retiro_id, excluirReservaId: r.id, preferido: r.vehiculo_id });
      if (!vehiculoId) throw new ErrorHttp(409, 'Ya no quedan vehículos disponibles de esta categoría para esas fechas. Contáctanos para buscar una alternativa.');
      await tx.query(`UPDATE reservas SET estado = 'confirmada', vehiculo_id = $3, actualizado_en = now() WHERE id = $1 AND empresa_id = $2`, [r.id, r.empresa_id, vehiculoId]);
    });
  }
  const cobro = await cobrar({ empresaId: r.empresa_id, reservaId: r.id, clienteId: r.cliente_id, monto: s.saldo, proveedor: prov, token: r.token_portal, folio: r.folio });
  if (eraCotizacion && !cobro.simulado) await q(`UPDATE reservas SET estado = 'cotizacion', actualizado_en = now() WHERE id = $1 AND empresa_id = $2`, [r.id, r.empresa_id]);
  if (eraCotizacion && cobro.simulado) await avisarConfirmada(r.empresa_id, r.id).catch(() => {});
  if (cobro.error) throw new ErrorHttp(502, `No pudimos iniciar el pago: ${cobro.error}`);
  return cobro;
}
