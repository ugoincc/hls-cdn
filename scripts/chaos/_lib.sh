#!/usr/bin/env bash
# Funções comuns dos scripts de caos.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESULTS="${RESULTS_DIR:-$ROOT/results}"
mkdir -p "$RESULTS"
now_ms() { date +%s%3N; }
# mark <ação> <alvo> [detalhe] → grava o instante da injeção (t0) para medir detecção/recuperação
mark() {
  local ts; ts=$(now_ms)
  printf '{"ts":%s,"service":"chaos","action":"%s","target":"%s","detail":"%s"}\n' "$ts" "$1" "$2" "${3:-}" >> "$RESULTS/chaos-events.jsonl"
  echo "[$(date +%T.%3N)] chaos: $1 $2 ${3:-}"
}
