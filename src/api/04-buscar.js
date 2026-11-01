// Buscador global de la barra superior: patentes, clientes (nombre, RUT, pasaporte) y folios.
import express from 'express';
import { q } from '../db.js';
import { requiere } from '../auth.js';
import { formatearPatente } from '../util/patente.js';
import { porPalabras } from '../busqueda.js';

const r = express.Router();
r.get('/buscar', requiere(), async (req, res) => {
  const t = String(req.query.q || '').trim();
  if (t.length < 2) return res.json([]);
  // Fase 1 (1-nov): por palabras, sin tildes ni mayúsculas («perez 1234» encuentra la reserva de Pérez con la patente
  // AB-1234). Patentes y documentos se comparan sin guiones ni puntos.
  const E = req.empresaId, out = [];
  const condicion = (columnas, params) => porPalabras(columnas, t, params) || 'FALSE';
  let p = [E];
  if (req.usuario.permisos.flota) for (const v of await q(`SELECT id, patente, marca, modelo, estado FROM vehiculos WHERE empresa_id = $1 AND ${condicion([{ col: 'patente', limpiar: true }, 'marca', 'modelo'], p)} LIMIT 5`, p))
    out.push({ tipo: 'Vehículo', titulo: formatearPatente(v.patente), detalle: `${v.marca} ${v.modelo}`, href: `/vehiculos/${v.id}` });
  p = [E];
  if (req.usuario.permisos.reservas) for (const x of await q(`SELECT r.id, r.folio, r.estado, c.nombre, c.apellidos, v.patente FROM reservas r LEFT JOIN clientes c ON c.id = r.cliente_id LEFT JOIN vehiculos v ON v.id = r.vehiculo_id
        WHERE r.empresa_id = $1 AND ${condicion([{ col: 'r.folio', limpiar: true }, { col: 'v.patente', limpiar: true }, `(c.nombre || ' ' || coalesce(c.apellidos,''))`], p)} ORDER BY r.inicio DESC LIMIT 6`, p))
    out.push({ tipo: 'Reserva', titulo: x.folio, detalle: `${x.nombre} ${x.apellidos || ''} · ${x.patente ? formatearPatente(x.patente) : ''} · ${x.estado}`, href: `/reservas/${x.id}` });
  p = [E];
  if (req.usuario.permisos.clientes) for (const c of await q(`SELECT id, nombre, apellidos, documento_tipo, documento, lista_negra FROM clientes WHERE empresa_id = $1
        AND ${condicion([`(nombre || ' ' || coalesce(apellidos,''))`, { col: 'documento', limpiar: true }, 'correo'], p)} LIMIT 6`, p))
    out.push({ tipo: c.lista_negra ? 'Cliente · lista negra' : 'Cliente', titulo: `${c.nombre} ${c.apellidos || ''}`.trim(), detalle: c.documento, href: `/clientes/${c.id}` });
  res.json(out.slice(0, 15));
});
export default r;
