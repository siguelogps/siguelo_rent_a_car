// «Ingresar con usuario y clave» en la plataforma GPS (OAuth): la persona escribe su usuario y clave en la página oficial
// de la cuenta (Síguelo Pro por el dominio de Síguelo, Síguelo Lite por el suyo) y vuelve a /integracion-gps con un token,
// que se guarda cifrado y nunca vuelve al navegador. La clave no pasa por On Rent.
// 22-oct (Pablo): lo usan dos puertas con las mismas garantías:
//   · origen 'cliente': el administrador del cliente (o Síguelo con «Operar») en Configuración › Conexiones. La empresa es
//     la de la sesión.
//   · origen 'backoffice': el equipo Síguelo desde la ficha del cliente. La empresa es la de la ficha.
// En los dos casos la vuelta trae un «estado» de un solo uso (20 min) atado a quien lo pidió y a la puerta que lo creó:
// la empresa nunca viaja escrita en la dirección ni en el cuerpo.
import { q } from '../db.js';
import { config } from '../config.js';
import { hashSha256, tokenAleatorio } from '../cifrado.js';
import { HOST_SESION_GPS } from '../integraciones/index.js';
import { ErrorHttp } from '../auth.js';

export const cuentaValida = (c) => (c === 'lite' ? 'lite' : 'hosting');

export async function crearIngreso({ empresaId, usuarioId, cuenta, origen }) {
  cuenta = cuentaValida(cuenta);
  const estado = tokenAleatorio(18);
  await q(`DELETE FROM gps_ingresos WHERE vence_en < now()`);
  await q(`INSERT INTO gps_ingresos (estado_hash, empresa_id, usuario_id, cuenta, origen, vence_en) VALUES ($1,$2,$3,$4,$5, now() + interval '20 minutes')`,
    [hashSha256(estado), empresaId, usuarioId, cuenta, origen]);
  const vuelta = `${config.urlBase}/integracion-gps?gps=${cuenta}${origen === 'cliente' ? '&desde=cliente' : ''}&estado=${estado}`;
  const p = new URLSearchParams({ client_id: 'SigueloRentacar', access_type: '-1', activation_time: '0', duration: '0', flags: '0x1', lang: 'es', redirect_uri: vuelta });
  return { url: `${HOST_SESION_GPS[cuenta]}/login.html?${p}`, cuenta };
}

// Consume el estado (un solo uso). Devuelve { empresa_id, cuenta } o lanza 400. Con empresaId, además exige que sea esa
// empresa (la de la sesión del cliente).
export async function consumirIngreso({ estado, usuarioId, origen, empresaId = null }) {
  const [ing] = await q(`DELETE FROM gps_ingresos WHERE estado_hash = $1 AND usuario_id = $2 AND origen = $3 AND ($4::bigint IS NULL OR empresa_id = $4) AND vence_en > now() RETURNING empresa_id, cuenta`,
    [hashSha256(String(estado || '')), usuarioId, origen, empresaId]);
  if (!ing) throw new ErrorHttp(400, origen === 'cliente'
    ? 'Este ingreso venció o ya se usó. Vuelve a presionar «Ingresar con usuario y clave» en Configuración › Conexiones.'
    : 'Este ingreso venció o ya se usó. Vuelve a abrir «Ingresar con usuario y clave» desde la ficha del cliente.');
  return ing;
}

export function tokenValido(token) {
  token = String(token || '').trim();
  if (!/^[A-Za-z0-9]{20,200}$/.test(token)) throw new ErrorHttp(400, 'La plataforma GPS no devolvió un token válido. Vuelve a intentarlo.');
  return token;
}
