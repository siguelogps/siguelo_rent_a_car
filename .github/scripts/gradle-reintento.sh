#!/usr/bin/env bash
# Corre Gradle y, si el proceso de pruebas se cae por el error intermitente del dibujo nativo de Robolectric
# («JniConstants: Class not found: java/nio/FloatBuffer», el proceso aborta con 134 antes o durante las capturas),
# lo repite una vez. Cualquier otro error falla al tiro: una prueba que falla de verdad no se reintenta.
# Uso: gradle-reintento.sh <registro> <argumentos de gradlew…>
set -o pipefail
registro="$1"; shift
./gradlew "$@" 2>&1 | tee "$registro"
estado=$?
if [ $estado -ne 0 ] && grep -qE "JniConstants: Class not found|Gradle Test Executor [0-9]+. finished with non-zero exit value 134" "$registro"; then
  echo "::warning::Robolectric abortó al dibujar (error intermitente del dibujo nativo): se repite una vez"
  ./gradlew "$@" 2>&1 | tee "$registro"
  estado=$?
fi
exit $estado
