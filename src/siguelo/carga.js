// Enlace de carga de un solo uso para el certificado digital y los CAF del SII (22-oct, espec. Backoffice).
// Son del cliente y no deben viajar por correo: Síguelo le manda un enlace que vence en 72 h y sirve una vez. Los archivos
// quedan cifrados (guardarArchivo con cifrado) y se enganchan a la facturación del cliente; el backoffice los ve como
// «recibidos», nunca su contenido. La clave del certificado, si se pide, queda cifrada como un secreto más.
import { q, uno } from '../db.js';
import { hashSha256, tokenAleatorio } from '../cifrado.js';
import { config } from '../config.js';
import { guardarArchivo } from '../almacenamiento/index.js';
import { guardar } from '../integraciones/index.js';
import { leerCaf } from '../facturacion/calculo.js';
import { enviarCorreoSiguelo } from './correo.js';
import { leerGeneral } from './conexiones.js';
import { ErrorHttp } from '../auth.js';

export const PIEZAS = {
  certificado: { nombre: 'Certificado digital (.pfx o .p12)', campo: 'certificado_archivo_id' },
  caf_39: { nombre: 'CAF de boletas (39)', campo: 'caf_boleta_archivo_id', td: 39 },
  caf_33: { nombre: 'CAF de facturas (33)', campo: 'caf_factura_archivo_id', td: 33 },
  caf_61: { nombre: 'CAF de notas de crédito (61)', campo: 'caf_nota_credito_archivo_id', td: 61 }
};
const HORAS = 72;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function crearEnlace({ empresaId, piezas, correo, usuarioId }) {
  const lista = [...new Set((piezas || []).filter((p) => PIEZAS[p]))];
  if (!lista.length) throw new ErrorHttp(400, 'Elige qué archivos pedir');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(correo || ''))) throw new ErrorHttp(400, 'El correo no es válido', { campo: 'correo' });
  const e = await uno('SELECT nombre FROM empresas WHERE id = $1', [empresaId]);
  // Un enlace nuevo anula los anteriores que no se usaron.
  await q('UPDATE enlaces_carga SET anulado_en = now() WHERE empresa_id = $1 AND usado_en IS NULL AND anulado_en IS NULL', [empresaId]);
  const token = tokenAleatorio(32);
  const [f] = await q(`INSERT INTO enlaces_carga (empresa_id, token_hash, piezas, correo, vence_en, creado_por) VALUES ($1,$2,$3,$4, now() + interval '${HORAS} hours',$5) RETURNING id, vence_en`,
    [empresaId, hashSha256(token), lista, String(correo).trim().toLowerCase(), usuarioId]);
  const enlace = `${config.urlBase}/carga/${token}`;
  const r = await enviarCorreoSiguelo({
    para: correo, asunto: `Síguelo GPS · sube tu certificado y folios del SII · ${e?.nombre || ''}`.trim(),
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#15181D">
      <p>Hola:</p><p>Para emitir boletas y facturas electrónicas de <b>${esc(e?.nombre)}</b> desde Síguelo On Rent necesitamos:</p>
      <ul>${lista.map((p) => `<li>${esc(PIEZAS[p].nombre)}</li>`).join('')}</ul>
      <p>Súbelos en este enlace seguro. Vence en ${HORAS} horas y sirve una sola vez; los archivos quedan cifrados.</p>
      <p><a href="${enlace}" style="background:#FFD500;color:#15181D;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Subir archivos</a></p>
      <p style="color:#5B6370;font-size:12px">No respondas este correo con los archivos adjuntos.</p></div>`
  });
  return { id: f.id, vence_en: f.vence_en, piezas: lista, enviado: r.ok, ...(r.ok ? {} : { motivo: r.motivo, enlace }) };
}

const vigente = (token) => uno(`SELECT c.*, e.nombre AS empresa, e.rut FROM enlaces_carga c JOIN empresas e ON e.id = c.empresa_id
  WHERE c.token_hash = $1 AND c.usado_en IS NULL AND c.anulado_en IS NULL AND c.vence_en > now()`, [hashSha256(String(token || ''))]);

export async function leerEnlace(token) {
  const c = await vigente(token);
  if (!c) return null;
  return { empresa: c.empresa, vence_en: c.vence_en, piezas: c.piezas.map((p) => ({ clave: p, nombre: PIEZAS[p].nombre })), pide_clave: c.piezas.includes('certificado') };
}

// archivos: { certificado: { nombre, base64 }, caf_33: { nombre, base64 }, … }
export async function recibirCarga(token, { archivos = {}, rut_certificado = '', clave_certificado = '' } = {}) {
  const c = await vigente(token);
  if (!c) throw new ErrorHttp(410, 'Este enlace ya se usó o venció. Pide uno nuevo a Síguelo GPS.');
  // Se valida todo antes de guardar nada: o llega completo, o no se gasta el enlace.
  const listos = [];
  for (const p of c.piezas) {
    const a = archivos[p];
    if (!a?.base64) throw new ErrorHttp(400, `Falta: ${PIEZAS[p].nombre}`, { campo: p });
    const datos = Buffer.from(String(a.base64), 'base64');
    if (!datos.length || datos.length > 2 * 1024 * 1024) throw new ErrorHttp(400, `${PIEZAS[p].nombre}: el archivo está vacío o pesa más de 2 MB`, { campo: p });
    let detalle = {};
    if (PIEZAS[p].td) {
      const caf = leerCaf(datos.toString('latin1'));
      if (caf.tipo !== PIEZAS[p].td) throw new ErrorHttp(400, `${PIEZAS[p].nombre}: el archivo es un CAF de tipo ${caf.tipo}`, { campo: p });
      detalle = { desde: caf.desde, hasta: caf.hasta, ambiente: caf.ambiente };
    } else if (!/\.(pfx|p12)$/i.test(String(a.nombre || ''))) throw new ErrorHttp(400, 'El certificado debe ser un archivo .pfx o .p12', { campo: p });
    listos.push({ p, datos, nombre: String(a.nombre || p).slice(0, 120), detalle });
  }
  if (c.piezas.includes('certificado') && !String(clave_certificado || '')) throw new ErrorHttp(400, 'Escribe la clave del certificado', { campo: 'clave_certificado' });
  const [tomado] = await q('UPDATE enlaces_carga SET usado_en = now() WHERE id = $1 AND usado_en IS NULL RETURNING id', [c.id]);
  if (!tomado) throw new ErrorHttp(410, 'Este enlace ya se usó.');
  const cambios = {}, recibidos = {};
  for (const x of listos) {
    const f = await guardarArchivo({ empresaId: c.empresa_id, entidad: 'integracion', tipo: x.p, nombre: x.nombre, mime: x.p === 'certificado' ? 'application/x-pkcs12' : 'application/xml', datos: x.datos, cifrado: true, meta: { via: 'enlace_carga', enlace: c.id } });
    cambios[PIEZAS[x.p].campo] = String(f.id);
    recibidos[x.p] = { archivo_id: f.id, nombre: x.nombre, ...x.detalle };
  }
  if (c.piezas.includes('certificado')) { cambios.clave_certificado = String(clave_certificado); if (rut_certificado) cambios.rut_certificado = String(rut_certificado).slice(0, 15); }
  await guardar(c.empresa_id, 'simpleapi', cambios, null);
  await q('UPDATE enlaces_carga SET recibidos = $2 WHERE id = $1', [c.id, JSON.stringify(recibidos)]);
  await q(`INSERT INTO bitacora (empresa_id, accion, entidad, entidad_id, detalle) VALUES ($1, 'carga_dte_recibida', 'enlace_carga', $2, $3)`, [c.empresa_id, c.id, JSON.stringify({ piezas: Object.keys(recibidos) })]);
  const aviso = (await leerGeneral('correo_siguelo')).config.aviso_equipo;
  if (aviso) await enviarCorreoSiguelo({ para: aviso, asunto: `On Rent · ${c.empresa} subió sus archivos del SII`, texto: `${c.empresa} subió: ${Object.keys(recibidos).map((p) => PIEZAS[p].nombre).join(', ')}.\nRevisa la ficha del cliente en el backoffice (Integraciones › Facturación electrónica).` });
  return { ok: true, recibidos: Object.keys(recibidos) };
}

export async function enlacesDe(empresaId) {
  const filas = await q('SELECT id, piezas, correo, vence_en, usado_en, anulado_en, recibidos, creado_en FROM enlaces_carga WHERE empresa_id = $1 ORDER BY id DESC LIMIT 10', [empresaId]);
  return filas.map((f) => ({ ...f, estado: f.usado_en ? 'recibido' : f.anulado_en ? 'anulado' : new Date(f.vence_en) < new Date() ? 'vencido' : 'esperando' }));
}
