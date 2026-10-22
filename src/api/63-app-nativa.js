// App nativa Síguelo On Rent (Android): versión mínima, teléfonos para avisos push y sus ajustes en el backoffice.
//   GET    /api/app/version-minima      público: la app lo consulta al abrirse (sin sesión).
//   POST   /api/app/dispositivo         con sesión: registra el token de Firebase del teléfono.
//   DELETE /api/app/dispositivo         con sesión: lo borra (al salir).
//   GET/PUT /api/backoffice/app-movil   superadmin: versión mínima y cuenta de servicio de Firebase (cifrada).
// La empresa y el usuario del teléfono salen siempre de la sesión, nunca del cuerpo del pedido.
import express from 'express';
import { q, uno } from '../db.js';
import { requiere, soloSuperadmin, soloSiguelo, ErrorHttp } from '../auth.js';
import { registrar } from '../bitacora.js';
import { configuracionPush, guardarCuentaPush, quitarCuentaPush, enviarPush } from '../app-nativa/push.js';

const r = express.Router();
const CLAVE_VERSION = 'app_version_minima';
const VERSION = /^\d{1,4}(\.\d{1,6}){0,3}$/;

export async function versionMinima() {
  const f = await uno('SELECT valor FROM sistema WHERE clave = $1', [CLAVE_VERSION]);
  let v = {};
  try { v = f?.valor ? JSON.parse(f.valor) : {}; } catch { v = {}; }
  return { android: { minima: v.minima || null, mensaje: v.mensaje || null } };
}

r.get('/app/version-minima', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await versionMinima());
});

r.post('/app/dispositivo', requiere(null, 'ver', { sinEmpresa: true }), async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (token.length < 20 || token.length > 4096) throw new ErrorHttp(400, 'Token del teléfono no válido');
  const version = String(req.body?.version_app || '').slice(0, 40) || null;
  const plataforma = req.body?.plataforma === 'ios' ? 'ios' : 'android';
  // Un mismo teléfono que cambia de usuario o de empresa queda con el último que ingresó.
  await q(`INSERT INTO dispositivos (empresa_id, usuario_id, token, plataforma, version_app) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (token) DO UPDATE SET empresa_id = EXCLUDED.empresa_id, usuario_id = EXCLUDED.usuario_id, plataforma = EXCLUDED.plataforma,
       version_app = EXCLUDED.version_app, actualizado_en = now()`, [req.empresaId || null, req.usuario.id, token, plataforma, version]);
  res.json({ ok: true });
});

r.delete('/app/dispositivo', requiere(null, 'ver', { sinEmpresa: true }), async (req, res) => {
  const token = String(req.body?.token || req.query?.token || '').trim();
  if (token) await q('DELETE FROM dispositivos WHERE token = $1 AND usuario_id = $2', [token, req.usuario.id]);
  res.json({ ok: true });
});

// ── Backoffice ──
const bo = [requiere(null, 'ver', { sinEmpresa: true }), soloSiguelo];

r.get('/backoffice/app-movil', ...bo, async (_req, res) => {
  const [v, push, n] = await Promise.all([versionMinima(), configuracionPush(), uno('SELECT count(*)::int AS n FROM dispositivos')]);
  res.json({ version: v.android, push, dispositivos: n.n });
});

r.put('/backoffice/app-movil', ...bo, soloSuperadmin, async (req, res) => {
  const b = req.body || {};
  if ('minima' in b || 'mensaje' in b) {
    const minima = String(b.minima ?? '').trim();
    if (minima && !VERSION.test(minima)) throw new ErrorHttp(400, 'La versión va como números separados por punto, por ejemplo 1.0.42', { campo: 'minima' });
    const mensaje = String(b.mensaje ?? '').trim().slice(0, 200) || null;
    await q(`INSERT INTO sistema (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
      [CLAVE_VERSION, JSON.stringify({ minima: minima || null, mensaje })]);
    await registrar(req, 'app_version_minima', 'sistema', null, { minima: minima || null });
  }
  if ('cuenta_push' in b) {
    if (b.cuenta_push === null || b.cuenta_push === '') await quitarCuentaPush();
    else { try { await guardarCuentaPush(b.cuenta_push); } catch (e) { throw new ErrorHttp(e.estado || 400, e.message, { campo: 'cuenta_push' }); } }
    await registrar(req, 'app_push_cuenta', 'sistema', null, { configurada: b.cuenta_push !== null && b.cuenta_push !== '' });
  }
  const [v, push] = await Promise.all([versionMinima(), configuracionPush()]);
  res.json({ version: v.android, push });
});

// Aviso de prueba al teléfono de quien lo pide (para revisar que Firebase quedó bien configurado).
r.post('/backoffice/app-movil/probar-push', ...bo, async (req, res) => {
  const tokens = (await q('SELECT token FROM dispositivos WHERE usuario_id = $1', [req.usuario.id])).map((f) => f.token);
  if (!tokens.length) throw new ErrorHttp(400, 'Tu usuario no tiene la app instalada con avisos activos. Ingresa en la app del teléfono y vuelve a probar.');
  const out = await enviarPush(tokens, { titulo: 'Síguelo On Rent', cuerpo: 'Aviso de prueba: los avisos push funcionan.', datos: { tipo: 'prueba' } });
  if (!out.configurado) throw new ErrorHttp(400, 'Falta la cuenta de servicio de Firebase.');
  res.json(out);
});

export default r;
