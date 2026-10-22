// Idempotencia para la cola de la app nativa: cada envío lleva «Idempotency-Key» (un UUID que la app crea una sola vez
// por daño, incidente o inspección). Si el teléfono pierde la señal justo después de que el servidor guardó, la app
// reintenta con la misma clave y recibe la misma respuesta, sin crear un daño o un incidente duplicado.
//   · Solo con sesión (la clave es por usuario) y solo en POST, PUT, PATCH y DELETE.
//   · Se guarda la respuesta 2xx. Si la respuesta fue un error, se olvida la clave para que el reintento vuelva a probar.
//   · Mientras la primera llamada sigue en curso, un reintento recibe 409 y la cola vuelve a intentar más tarde.
import { q, uno } from '../db.js';

const METODOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VALIDA = /^[\w-]{8,100}$/;
let ultimaLimpieza = 0;

export async function idempotencia(req, res, next) {
  const clave = req.headers['idempotency-key'];
  if (!clave || !req.usuario || !METODOS.has(req.method)) return next();
  if (!VALIDA.test(String(clave))) return res.status(400).json({ error: 'Idempotency-Key no válida' });
  const ruta = req.originalUrl.split('?')[0];
  if (Date.now() - ultimaLimpieza > 3600e3) {
    ultimaLimpieza = Date.now();
    q(`DELETE FROM idempotencia WHERE creado_en < now() - interval '14 days'`).catch(() => {});
  }
  const previa = await uno('SELECT metodo, ruta, estado, respuesta FROM idempotencia WHERE usuario_id = $1 AND clave = $2', [req.usuario.id, clave]);
  if (previa) {
    if (previa.metodo !== req.method || previa.ruta !== ruta) return res.status(422).json({ error: 'Esa Idempotency-Key ya se usó para otra acción.' });
    if (previa.estado == null) return res.status(409).json({ error: 'Este envío todavía se está procesando. Se reintentará.', en_proceso: true });
    res.setHeader('Idempotent-Replayed', 'true');
    return res.status(previa.estado).json(previa.respuesta);
  }
  const [nueva] = await q(`INSERT INTO idempotencia (usuario_id, clave, empresa_id, metodo, ruta) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (usuario_id, clave) DO NOTHING RETURNING clave`, [req.usuario.id, clave, req.empresaId || null, req.method, ruta]);
  if (!nueva) return res.status(409).json({ error: 'Este envío todavía se está procesando. Se reintentará.', en_proceso: true });
  const json = res.json.bind(res);
  res.json = (cuerpo) => {
    const estado = res.statusCode;
    const guardar = estado >= 200 && estado < 300
      ? q('UPDATE idempotencia SET estado = $3, respuesta = $4 WHERE usuario_id = $1 AND clave = $2', [req.usuario.id, clave, estado, JSON.stringify(cuerpo ?? null)])
      : q('DELETE FROM idempotencia WHERE usuario_id = $1 AND clave = $2', [req.usuario.id, clave]);
    guardar.catch((e) => console.warn('[idempotencia]', e.message)).finally(() => json(cuerpo));
    return res;
  };
  // Si la ruta termina sin res.json (archivo, error no capturado), la clave no queda tomada para siempre.
  res.on('finish', () => {
    if (res.statusCode >= 300) q('DELETE FROM idempotencia WHERE usuario_id = $1 AND clave = $2 AND estado IS NULL', [req.usuario.id, clave]).catch(() => {});
  });
  next();
}
