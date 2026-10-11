// Cada módulo registra cómo probar su conexión: registrarProbador('gps', async (config) => 'Conectado: 18 unidades').
// La función lanza un error con un mensaje claro si falla.
const probadores = new Map();
export const registrarProbador = (tipo, fn) => probadores.set(tipo, fn);
export const probador = (tipo) => probadores.get(tipo);
