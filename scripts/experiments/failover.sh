#!/usr/bin/env bash
# Experimento 2 — queda (ou partição) de um edge sob carga, com e sem failover.
# Uso: scripts/experiments/failover.sh [kill|stop|partition] [on|off]
# Env: TARGET=edge2 CLIENTS=20 T_FAIL=20 T_BACK=40 DUR=60 LEVEL=720p
source "$(dirname "$0")/_lib.sh"
MODE=${1:-kill}; FO=${2:-on}; TARGET=${TARGET:-edge2}; N=${CLIENTS:-20}
T_FAIL=${T_FAIL:-20}; T_BACK=${T_BACK:-40}; DUR=${DUR:-60}; LEVEL=${LEVEL:-720p}
export RESULTS_DIR="$ROOT/results/failover-$MODE-$FO"
rm -rf "$RESULTS_DIR"; mkdir -p "$RESULTS_DIR"

scripts/chaos/reset.sh >/dev/null
log "router com FAILOVER=$FO"
FAILOVER=$FO docker compose up -d router >/dev/null 2>&1; wait_http "$ROUTER/health"; wait_all_up
clear_caches; warm_cache 4 "$LEVEL"

log "carga: $N clientes no ritmo do vídeo por ${DUR}s; falha em t=${T_FAIL}s, volta em t=${T_BACK}s"
node scripts/loadgen.js --url "$ROUTER" --clients "$N" --duration "$DUR" --paced --level "$LEVEL" \
  --out "$RESULTS_DIR/requests.jsonl" > "$RESULTS_DIR/loadgen-summary.json" &
LG=$!
sleep "$T_FAIL"
case $MODE in
  kill|stop) scripts/chaos/kill-edge.sh "$TARGET" "$MODE" ;;
  partition) scripts/chaos/partition.sh "$TARGET" on ;;
esac
sleep $((T_BACK - T_FAIL))
case $MODE in
  kill|stop) scripts/chaos/start-edge.sh "$TARGET" ;;
  partition) scripts/chaos/partition.sh "$TARGET" off ;;
esac
wait $LG
cat "$RESULTS_DIR/loadgen-summary.json"
[ "$FO" = off ] && { FAILOVER=on docker compose up -d router >/dev/null 2>&1; log "router de volta com FAILOVER=on"; }
node scripts/analyze.js failover "$RESULTS_DIR"
