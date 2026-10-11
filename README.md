# Síguelo Rent a Car

Sistema de administración de rentacar (arriendo de vehículos), producto de **Síguelo GPS** para empresas de rentacar en Chile.
Multi-empresa: cada rentacar es un cliente de Síguelo, con sus propios datos, usuarios y logo en sus documentos.

## Módulos
| # | Módulo | Pantallas |
|---|---|---|
| 1 | Flota y vencimientos (revisión técnica, permiso de circulación, SOAP, seguro, mantención por km o fecha) | `/vehiculos`, `/vehiculos/:id` |
| 2 | Tarifas (categoría × temporada; día, semana y mes; km libre o con tope; extras; recargos; descuentos) | `/tarifas` |
| 3 | Reservas con calendario Gantt, arrastrar y soltar y control de disponibilidad | `/reservas`, `/reservas/:id` |
| 4 | Clientes (RUT/pasaporte, licencia, documentos, conductores, lista negra) | `/clientes`, `/clientes/:id` |
| 5 | Contrato digital con firma en pantalla y validación QR | `/contratos`, `/firmar/:token`, `/verificar/:codigo` |
| 6 | Entrega y devolución en celular (fotos guiadas estampadas, esquema de daños, checklist, km y combustible de la plataforma GPS, firma, comparación) | `/patio`, `/patio/:id` |
| 7 | Pagos y garantía (Webpay Plus captura diferida, Mercado Pago, efectivo, transferencia) y liquidación automática | `/pagos`, `/liquidaciones/:id` |
| 8 | Boleta y factura electrónica vía SimpleAPI | `/facturacion` |
| 9 | Incidentes y daños con trazabilidad hasta el pago | `/incidentes` |
| 10 | TAG y multas (importación CSV/Excel y conexión con el dashboard Síguelo; asignación automática al contrato) | `/tag-multas` |
| 11 | Plataforma GPS (posición en vivo, km y combustible reales, geocercas, alertas, inmovilización con doble validación) | `/gps` |
| 12 | Portal de reservas para el cliente final, incrustable | `/reservar/:empresa`, `/portal/:token` |
| 13 | Mantención (órdenes de trabajo por km real o fecha; bloqueo en el calendario) | `/mantencion` |
| 14 | Reportes con exportación a Excel | `/reportes` |
| 15 | Configuración (empresa, sucursales, usuarios y roles, plantillas, integraciones, bandeja de salida, bitácora) | `/configuracion` |

**Marcha blanca:** cada empresa parte con correos, WhatsApp, cobros, documentos tributarios e inmovilización detenidos.
Todo se registra (bandeja de salida, pagos «simulados») para probar el flujo completo; se desactiva desde Configuración.

## Desarrollo
```bash
npm install
npm run dev          # http://localhost:3000 con PGlite (Postgres embebido) y datos de prueba
npm test
```
Usuarios de prueba (clave `demo1234`): `demo@siguelogps.cl` (administrador), `counter@`, `patio@`, `finanzas@` y `soporte@siguelogps.cl` (superadmin Síguelo).

## Despliegue
- **Render:** «New › Blueprint» con este repositorio (`render.yaml`): crea el servicio web (Docker) y PostgreSQL. Las migraciones se aplican solas al arrancar.
- **Otro cloud:** la misma imagen (`Dockerfile`) con `DATABASE_URL` (PostgreSQL 14+) y `APP_SECRET`. Sin disco persistente: fotos y documentos van a un bucket S3 compatible (Cloudflare R2, AWS S3, B2, GCS), configurado por empresa en pantalla.
- Variables de entorno: ver `.env.example`. Todas las integraciones (plataforma GPS, Webpay, Mercado Pago, SimpleAPI, WhatsApp, SMTP, almacenamiento, TAG y multas) se cargan desde **Configuración › Integraciones**, cifradas con `APP_SECRET`.

## Maquetas
`mockups/` contiene las maquetas aprobadas (Etapa 0) y `npm run capturas` las exporta a PNG.
