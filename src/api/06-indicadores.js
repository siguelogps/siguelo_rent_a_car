// Indicadores económicos (UF, dólar observado, UTM) de fuente oficial: solo lectura para las pantallas.
import express from 'express';
import { requiere } from '../auth.js';
import { indicadores, actualizarIndicadores } from '../indicadores.js';

const r = express.Router();
r.get('/indicadores', requiere(), async (_req, res) => res.json(await indicadores()));
r.post('/indicadores/actualizar', requiere('configuracion', 'editar'), async (_req, res) => {
  const resultado = await actualizarIndicadores();
  res.json({ resultado, indicadores: await indicadores() });
});
export default r;
