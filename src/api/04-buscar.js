// Buscador global de la barra superior: patentes, clientes (nombre, RUT, pasaporte) y folios.
import express from 'express';
import { q } from '../db.js';
import { requiere } from '../auth.js';
import { formatearPatente, normalizarPatente } from '../util/patente.js';
import { limpiarRut } from '../util/rut.js';

const r = express.Router();
r.get('/buscar', requiere(), async (req, res) => {
  const t = String(req.query.q || '').trim();
  if (t.length < 2) return res.json([]);
  const E = req.empresaId, like = `%${t}%`, pat = `%${normalizarPatente(t)}%`, doc = `%${limpiarRut(t)}%`;
  const out = [];
  if (req.usuario.permisos.flota) for (const v of await q(`SELECT id, patente, marca, modelo, estado FROM vehiculos WHERE empresa_id = $1 AND patente ILIKE $2 LIMIT 5`, [E, pat]))
    out.push({ tipo: 'Vehículo', titulo: formatearPatente(v.patente), detalle: `${v.marca} ${v.modelo}`, href: `/vehiculos/${v.id}` });
  if (req.usuario.permisos.reservas) for (const x of await q(`SELECT r.id, r.folio, r.estado, c.nombre, c.apellidos, v.patente FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
        WHERE r.empresa_id = $1 AND (r.folio ILIKE $2 OR v.patente ILIKE $3) ORDER BY r.inicio DESC LIMIT 6`, [E, like, pat]))
    out.push({ tipo: 'Reserva', titulo: x.folio, detalle: `${x.nombre} ${x.apellidos || ''} · ${x.patente ? formatearPatente(x.patente) : ''} · ${x.estado}`, href: `/reservas/${x.id}` });
  if (req.usuario.permisos.clientes) for (const c of await q(`SELECT id, nombre, apellidos, documento_tipo, documento, lista_negra FROM clientes WHERE empresa_id = $1
        AND (nombre || ' ' || coalesce(apellidos,'') ILIKE $2 OR replace(replace(documento,'-',''),'.','') ILIKE $3 OR correo ILIKE $2) LIMIT 6`, [E, like, doc.length > 3 ? doc : '%__NADA__%']))
    out.push({ tipo: c.lista_negra ? 'Cliente · lista negra' : 'Cliente', titulo: `${c.nombre} ${c.apellidos || ''}`.trim(), detalle: c.documento, href: `/clientes/${c.id}` });
  res.json(out.slice(0, 15));
});
export default r;
