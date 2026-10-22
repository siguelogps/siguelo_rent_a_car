#!/usr/bin/env bash
# Avisos push: escribe android/app/google-services.json desde el secreto GOOGLE_SERVICES_JSON, solo si trae el paquete
# de la app que se compila (si no, el plugin de Google falla). Sin el secreto, la app compila sin avisos push.
#   .github/scripts/google-services.sh <paquete>
set -euo pipefail
PAQUETE="$1"
DESTINO="android/app/google-services.json"
rm -f "$DESTINO"
if [ -z "${GOOGLE_SERVICES_JSON:-}" ]; then
  echo "::notice title=Sin avisos push::No está el secreto GOOGLE_SERVICES_JSON: $PAQUETE se compila sin avisos push (lo demás funciona igual)."
  exit 0
fi
printf '%s' "$GOOGLE_SERVICES_JSON" > "$DESTINO"
if ! node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.exit((j.client||[]).some(c=>c.client_info?.android_client_info?.package_name===process.argv[2])?0:1)" "$DESTINO" "$PAQUETE"; then
  rm -f "$DESTINO"
  echo "::warning title=Avisos push::google-services.json no trae la app $PAQUETE: se compila sin avisos push. En Firebase agrega una app Android con ese paquete y vuelve a copiar el archivo al secreto."
  exit 0
fi
echo "google-services.json listo para $PAQUETE: avisos push activados"
