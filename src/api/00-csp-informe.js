// Informes de la CSP en modo informe (ver src/cabeceras.js). El navegador manda aquí, sin sesión y sin que el usuario
// haga nada, cada recurso que la política no permitiría. Solo se anota en el registro del servidor: nada se guarda en
// la base ni se responde con datos. Lo que llega lo escribe el navegador (o cualquiera): es texto ajeno, se recorta y
// se limpia antes de escribirlo, y hay un tope por IP para que no inunde el registro.
import express from 'express';
import { limitar } from '../limite.js';

const r = express.Router();

const texto = (v, largo = 300) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, largo) || '—';

// Chrome y Firefox envían «application/csp-report» con { "csp-report": {...} }; la Reporting API, «application/reports+json»
// con una lista de informes { type: 'csp-violation', body: {...} }. Se aceptan las dos formas.
function informes(cuerpo) {
  if (Array.isArray(cuerpo)) return cuerpo.map((i) => i?.body || i).filter((i) => i && typeof i === 'object');
  if (cuerpo && typeof cuerpo === 'object') return [cuerpo['csp-report'] || cuerpo.body || cuerpo];
  return [];
}

export function resumirInforme(i) {
  const documento = texto(i['document-uri'] ?? i.documentURL);
  const directiva = texto(i['violated-directive'] ?? i['effective-directive'] ?? i.effectiveDirective, 80);
  const bloqueado = texto(i['blocked-uri'] ?? i.blockedURL);
  const archivo = texto(i['source-file'] ?? i.sourceFile, 200);
  const linea = Number(i['line-number'] ?? i.lineNumber) || null;
  return `[CSP] ${directiva} · bloqueado: ${bloqueado} · en ${documento}${archivo !== '—' ? ` (${archivo}${linea ? `:${linea}` : ''})` : ''}`;
}

r.post('/csp-informe',
  limitar({ nombre: 'csp-informe', max: 20, ventanaMs: 60e3 }),
  express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '20kb', strict: false }), // strict: false → un JSON que no sea objeto ni lista también se acepta (y se ignora) en vez de responder 400
  (req, res) => {
    for (const i of informes(req.body).slice(0, 5)) console.warn(resumirInforme(i));
    res.status(204).end();
  });

export default r;
