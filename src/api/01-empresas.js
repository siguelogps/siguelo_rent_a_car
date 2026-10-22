// Empresas (cada rentacar es un cliente de Síguelo). El superadmin las crea; el administrador edita la suya.
import express from 'express';
import { q, uno, transaccion } from '../db.js';
import { requiere, soloSiguelo, hashClave, ErrorHttp } from '../auth.js';
import { esSiguelo } from '../permisos.js';
import { registrar } from '../bitacora.js';
import { normalizarRut, validarRut } from '../util/rut.js';
import { guardarArchivo, desdeDataUrl } from '../almacenamiento/index.js';
import { plantillasPorDefecto } from '../plantillas-defecto.js';

const r = express.Router();
const slugDe = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

r.get('/empresas', requiere(null, 'ver', { sinEmpresa: true }), soloSiguelo, async (_req, res) => {
  res.json(await q(`SELECT e.*, (SELECT count(*)::int FROM vehiculos v WHERE v.empresa_id = e.id AND v.activo) AS vehiculos,
                           (SELECT count(*)::int FROM usuarios u WHERE u.empresa_id = e.id AND u.activo) AS usuarios,
                           (SELECT count(*)::int FROM sucursales s WHERE s.empresa_id = e.id AND s.activa) AS sucursales,
                           p.nombre AS plan_nombre, p.max_vehiculos, p.max_usuarios, p.max_sucursales, p.precio_uf, p.modulos AS plan_modulos
                      FROM empresas e LEFT JOIN planes p ON p.codigo = e.plan ORDER BY e.nombre`));
});

// El alta de un cliente nuevo va por el asistente del backoffice (POST /api/backoffice/clientes, 16-backoffice-clientes.js):
// el primer administrador recibe una invitación para crear su clave; Síguelo no la escribe ni la ve (22-oct).

export async function crearEmpresa(b) {
  return transaccion(async (tx) => {
    let slug = slugDe(b.slug || b.nombre);
    if ((await tx.query('SELECT 1 FROM empresas WHERE slug = $1', [slug])).length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const [e] = await tx.query(
      `INSERT INTO empresas (nombre, slug, rut, razon_social, giro, direccion, comuna, ciudad, telefono, correo, ajustes, plan)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE((SELECT codigo FROM planes WHERE codigo = $12), 'pro')) RETURNING *`,
      [b.nombre, slug, b.rut || null, b.razon_social || b.nombre, b.giro || 'Arriendo de vehículos', b.direccion || null, b.comuna || null, b.ciudad || null, b.telefono || null, b.correo || null,
        JSON.stringify({ tolerancia_min: 59, precio_litro: 1390, cargo_servicio_combustible: 5000, lavado: 15000, triangulo: 12000, garantia_dias_retencion: 30, edad_minima: 21, hora_corte_atraso: true, ...(b.ajustes || {}) }), b.plan || null]);
    const [s] = await tx.query('INSERT INTO sucursales (empresa_id, nombre, direccion, comuna, ciudad) VALUES ($1,$2,$3,$4,$5) RETURNING id', [e.id, b.sucursal || 'Casa matriz', b.direccion || null, b.comuna || null, b.ciudad || null]);
    // Sin admin_clave el administrador queda sin clave hasta que acepte su invitación (alta desde el backoffice).
    const [adm] = await tx.query('INSERT INTO usuarios (empresa_id, nombre, correo, clave_hash, rol, sucursal_id, telefono) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [e.id, b.admin_nombre || 'Administrador', String(b.admin_correo).toLowerCase(), b.admin_clave ? hashClave(b.admin_clave) : null, 'administrador', s.id, b.admin_telefono || null]);
    e.admin_id = adm.id;
    for (const p of plantillasPorDefecto()) {
      await tx.query('INSERT INTO plantillas (empresa_id, tipo, clave, nombre, asunto, cuerpo) VALUES ($1,$2,$3,$4,$5,$6)', [e.id, p.tipo, p.clave, p.nombre, p.asunto || null, p.cuerpo]);
    }
    return e;
  });
}

r.get('/empresa', requiere('configuracion', 'ver'), async (req, res) => {
  res.json(await uno('SELECT * FROM empresas WHERE id = $1', [req.empresaId]));
});

r.patch('/empresa', requiere('configuracion', 'editar'), async (req, res) => {
  const b = req.body;
  const campos = ['nombre', 'rut', 'razon_social', 'giro', 'acteco', 'direccion', 'comuna', 'ciudad', 'telefono', 'correo', 'sitio_web', 'color'];
  if (b.rut && !validarRut(b.rut)) throw new ErrorHttp(400, 'El RUT no es válido', { campo: 'rut' });
  const sets = [], vals = [];
  for (const c of campos) if (c in b) { vals.push(c === 'rut' && b.rut ? normalizarRut(b.rut) : b[c]); sets.push(`${c} = $${vals.length}`); }
  if (b.ajustes && typeof b.ajustes === 'object') { vals.push(JSON.stringify(b.ajustes)); sets.push(`ajustes = ajustes || $${vals.length}::jsonb`); }
  if ('marcha_blanca' in b) {
    // 22-oct (Pablo): la marcha blanca la cambia solo el equipo Síguelo (backoffice, o «Operar» con motivo).
    if (!esSiguelo(req.usuario.rol)) throw new ErrorHttp(403, 'La marcha blanca la cambia el equipo Síguelo GPS. Pídelo con «Solicitar a Síguelo».');
    vals.push(!!b.marcha_blanca); sets.push(`marcha_blanca = $${vals.length}`);
    await registrar(req, b.marcha_blanca ? 'marcha_blanca_activada' : 'marcha_blanca_desactivada', 'empresa', req.empresaId);
  }
  if (b.logo) {
    const { mime, datos } = desdeDataUrl(b.logo);
    const a = await guardarArchivo({ empresaId: req.empresaId, entidad: 'empresa', entidadId: req.empresaId, tipo: 'logo', nombre: 'logo', mime, datos, usuarioId: req.usuario.id });
    vals.push(String(a.id)); sets.push(`logo_clave = $${vals.length}`);
  }
  if (!sets.length) return res.json(await uno('SELECT * FROM empresas WHERE id = $1', [req.empresaId]));
  vals.push(req.empresaId);
  const [e] = await q(`UPDATE empresas SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  await registrar(req, 'empresa_editada', 'empresa', req.empresaId, { campos: Object.keys(b).filter((k) => k !== 'logo') });
  res.json(e);
});

export default r;
