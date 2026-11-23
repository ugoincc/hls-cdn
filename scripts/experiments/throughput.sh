#!/usr/bin/env bash
# Experimento 1 — vazão e latência: origem direta × CDN (cache frio) × CDN (cache quente)
# com 1, 5, 10, 20 clientes a toda velocidade.  Uso: scripts/experiments/throughput.sh
# Env: CLIENTS="1 5 10 20"  DUR=15  ORIGIN_DELAY_MS=50  LEVEL=720p
source "$(dirname "$0")/_lib.sh"
EXP=results/throughput; CLIENTS=${CLIENTS:-"1 5 10 20"}; DUR=${DUR:-15}; DELAY=${ORIGIN_DELAY_MS:-50}; LEVEL=${LEVEL:-720p}
rm -rf "$EXP"; mkdir -p "$EXP/runs"
log "origem com atraso artificial de ${DELAY} ms (simula origem distante)"
ORIGIN_DELAY_MS=$DELAY docker compose up -d origin >/dev/null 2>&1; wait_http localhost:8080/health; wait_all_up

run() { # run <label> <url> <clientes>
  log "  $1 · $3 cliente(s) · ${DUR}s"
  node scripts/loadgen.js --label "$1" --url "$2" --clients "$3" --duration "$DUR" --level "$LEVEL" \
    --out "$EXP/runs/$1-$3.jsonl" | tee -a "$EXP/runs.jsonl"
}
for n in $CLIENTS; do
  run origem-direta http://localhost:8080 "$n"
  clear_caches; run cdn-cache-frio "$ROUTER" "$n"
  run cdn-cache-quente "$ROUTER" "$n"
done
docker compose up -d origin >/dev/null 2>&1   # volta ao atraso padrão (0)
node scripts/analyze.js load "$EXP"
