// Datos de prueba de Flota y Mantención: historial de órdenes de trabajo terminadas (con costos) y una programada.
// (La demo base ya crea vehículos, tarifas y la OT en taller de SYPC-11.)
import { q, siguienteFolio } from '../db.js';

const DIA = 864e5;

export async function sembrar(empresaId) {
  const E = empresaId;
  const veh = Object.fromEntries((await q('SELECT id, patente FROM vehiculos WHERE empresa_id = $1', [E])).map((v) => [v.patente, v.id]));
  const hace = (dias) => new Date(Date.now() - dias * DIA);
  const ots = [
    ['SXLR27', 'preventiva', 'Mantención 20.000 km', 20000, 'Kia Servicio Pudahuel', 168000, 125, 1, 20040],
    ['PBVX61', 'preventiva', 'Mantención 40.000 km', 40000, 'Taller Automotriz Lyon', 214500, 118, 2, 40110],
    ['PKHG24', 'neumaticos', 'Cambio de 4 neumáticos all terrain', null, 'Neumáticos Vespucio', 612000, 64, 1, 58900],
    ['RKDS90', 'correctiva', 'Cambio de pastillas y discos delanteros', null, 'Taller Automotriz Lyon', 189900, 41, 1, 29200],
    ['TFZB73', 'preventiva', 'Mantención 10.000 km', 10000, 'Toyota Kaufmann Vitacura', 245000, 150, 1, 10080],
    ['RFDL49', 'correctiva', 'Reparación de alternador', null, 'Electricidad Automotriz Ñuñoa', 285000, 22, 3, 88100],
    ['RVLW56', 'preventiva', 'Mantención 20.000 km', 20000, 'Chery Servicio Santiago', 198000, 9, 1, 20030]
  ];
  for (const [pat, tipo, motivo, kmProg, taller, costo, diasAtras, duracion, kmIngreso] of ots) {
    if (!veh[pat]) continue;
    const folio = await siguienteFolio(E, 'OT');
    const ini = hace(diasAtras), fin = new Date(ini.getTime() + duracion * DIA);
    await q(`INSERT INTO ordenes_trabajo (empresa_id, folio, vehiculo_id, tipo, motivo, km_programado, taller, costo, estado, inicio, fin, km_al_ingreso, creado_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'terminada',$9,$10,$11,$9)`, [E, folio, veh[pat], tipo, motivo, kmProg, taller, costo, ini, fin, kmIngreso]);
  }
  // Programada: la próxima de RTKP-42 (le faltan menos de 1.000 km), queda para la semana siguiente
  if (veh.RTKP42) {
    const folio = await siguienteFolio(E, 'OT');
    const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(Date.now() + 9 * DIA));
    await q(`INSERT INTO ordenes_trabajo (empresa_id, folio, vehiculo_id, tipo, motivo, km_programado, fecha_programada, taller, costo, estado, notas)
      VALUES ($1,$2,$3,'preventiva','Mantención 40.000 km',40000,$4,'Suzuki Servicio Maipú',175000,'programada','Cambio de aceite, filtros y revisión de frenos')`, [E, folio, veh.RTKP42, fecha]);
  }
}
