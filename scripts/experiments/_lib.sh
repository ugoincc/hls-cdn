#!/usr/bin/env bash
# Funções comuns dos experimentos.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
ROUTER=${ROUTER_URL:-http://localhost:8000}
EDGE_PORTS=${EDGE_PORTS:-"8081 8082 8083"}
log() { echo "[$(date +%T)] $*"; }
clear_caches() { for p in $EDGE_PORTS; do curl -fsS -XPOST "localhost:$p/cache/clear" >/dev/null; done; log "caches zerados"; }
# espera até o router ver todos os edges UP
wait_all_up() {
  for _ in $(seq 60); do
    if curl -fsS "$ROUTER/status" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.exit(JSON.parse(s).edges.every(e=>e.state==="UP")?0:1))'; then log "todos os edges UP"; return 0; fi
    sleep 0.5
  done
  echo "timeout esperando edges UP" >&2; return 1
}
wait_http() { for _ in $(seq 60); do curl -fsS "$1" >/dev/null 2>&1 && return 0; sleep 0.5; done; echo "timeout: $1" >&2; return 1; }
# aquece o cache: baixa todos os segmentos de uma qualidade uma vez via router
warm_cache() { node scripts/loadgen.js --url "$ROUTER" --clients 1 --duration "${1:-4}" --start zero --level "${2:-720p}" >/dev/null; log "cache aquecido (${2:-720p})"; }
