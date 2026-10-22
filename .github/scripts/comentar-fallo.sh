#!/usr/bin/env bash
# Si una compilación falla, deja las últimas 150 líneas del registro de Gradle como comentario en el pull request de
# la rama (con GITHUB_TOKEN). Sirve para ver el error sin entrar a GitHub Actions.
#   .github/scripts/comentar-fallo.sh <archivo.log> "<título>"
set -uo pipefail
LOG="$1"; TITULO="$2"
[ -f "$LOG" ] || { echo "No hay registro en $LOG"; exit 0; }
RAMA="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
PR="${PR_NUMERO:-}"
if [ -z "$PR" ] && [ -n "$RAMA" ]; then
  PR=$(gh api "repos/$GITHUB_REPOSITORY/pulls?head=${GITHUB_REPOSITORY_OWNER}:${RAMA}&state=open" --jq '.[0].number // empty' 2>/dev/null || true)
fi
[ -n "$PR" ] || { echo "La rama $RAMA no tiene un pull request abierto: no se comenta."; exit 0; }
CUERPO=$(mktemp)
{
  echo "### ❌ $TITULO"
  echo "Compilación [#${GITHUB_RUN_NUMBER}](${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}) · \`${GITHUB_SHA::7}\`"
  echo
  # Primero los errores del compilador y de Gradle (suelen quedar lejos del final, tapados por la traza).
  echo '**Errores:**'
  echo '```'
  grep -E "^e: |^w: .*error|What went wrong|^> |FAILED|Exception:|AssertionError|error:" "$LOG" | grep -v "^> Task" | head -n 60 | cut -c1-400
  echo '```'
  echo '**Final del registro:**'
  echo '```'
  grep -v "JAVA_TOOL_OPTIONS" "$LOG" | grep -v "^\s*at " | tail -n 150 | cut -c1-400
  echo '```'
} > "$CUERPO"
gh api "repos/$GITHUB_REPOSITORY/issues/$PR/comments" -F body=@"$CUERPO" > /dev/null && echo "Comentado en el PR #$PR"
