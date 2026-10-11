# Etapa 0 · Maquetas de Síguelo Rentacar

Pantallas principales para aprobar antes de programar. Usan el mismo estilo del CRM Síguelo Gestión
(`public/app.css` copiado de `siguelogps/soporte-wialon`) más `public/rentacar.css`.

| Captura | Pantalla |
|---|---|
| `capturas/01-calendario.png` | Calendario tipo Gantt por vehículo, con arrastrar y soltar y control de disponibilidad |
| `capturas/02-reserva.png` | Ficha de la reserva: etapas, tramo, vehículo, cliente y documentos, cobro, garantía y contrato |
| `capturas/03-checkout-celular.png` | Entrega en celular: km y combustible desde la plataforma GPS, checklist, fotos guiadas, esquema de daños y firma |
| `capturas/04-devolucion-comparacion.png` | Devolución: diferencias de km, combustible, hora y daños; fotos lado a lado; daño nuevo → incidente |
| `capturas/05-liquidacion.png` | Liquidación al cierre: cargos con su origen, garantía (captura parcial y saldo liberado), boleta vía SimpleAPI |
| `capturas/06-flota.png` | Flota con vencimientos chilenos (revisión técnica, permiso, SOAP, seguro) y mantención por km |
| `capturas/07-reportes.png` | Reportes: ocupación, ingreso por día y por vehículo, días ociosos, daños por cliente, devoluciones |

Las «fotos» de autos son dibujos de referencia; en el sistema real son las fotos que toma el personal de patio.

Regenerar las capturas: `npm install && npm run capturas` (usa Playwright con Chromium).
