#!/usr/bin/env bash
# Experimento 3 — ABR sob banda limitada no link do cliente (tc netem no router).
# Requer o player aberto: http://localhost:8000/?session=abr&buffer=10  (dar play)
# Uso: scripts/experiments/abr.sh      Env: SPORT=8000 (vazio = interface toda) SESSION=abr RATE=1500kbit DELAY=100ms T_ON=20 T_LIMIT=40 T_AFTER=40
source "$(dirname "$0")/_lib.sh"
SESSION=${SESSION:-abr}; RATE=${RATE:-1500kbit}; DELAY=${DELAY:-100ms}
T_ON=${T_ON:-20}; T_LIMIT=${T_LIMIT:-40}; T_AFTER=${T_AFTER:-40}
export RESULTS_DIR="$ROOT/results/abr"
rm -rf "$RESULTS_DIR"; mkdir -p "$RESULTS_DIR"
scripts/chaos/reset.sh >/dev/null
START=$(date +%s%3N)
log "aguardando o player (sessão '$SESSION') carregar segmentos — abra $ROUTER/?session=$SESSION&buffer=10"
until node -e "
  const l=require('fs').readFileSync('results/player-events.jsonl','utf8').trim().split('\n').map(JSON.parse);
  process.exit(l.some(e=>e.session==='$SESSION'&&e.type==='frag_loaded'&&e.ts>=$START)?0:1)" 2>/dev/null; do sleep 1; done
log "player ativo; ${T_ON}s em condição normal"
sleep "$T_ON"
SPORT=${SPORT-8000} scripts/chaos/netem.sh router rate "$RATE" delay "$DELAY" >/dev/null
log "banda limitada: $RATE + $DELAY por ${T_LIMIT}s"
sleep "$T_LIMIT"
scripts/chaos/netem.sh router clear >/dev/null
log "limitação removida; observando ${T_AFTER}s"
sleep "$((T_AFTER + 3))"   # +3 s: o player envia eventos a cada 2 s
node -e "
  const fs=require('fs');
  const l=fs.readFileSync('results/player-events.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(e=>e.session==='$SESSION'&&e.ts>=$START);
  fs.writeFileSync('$RESULTS_DIR/player-events.jsonl', l.map(e=>JSON.stringify(e)).join('\n')+'\n');"
node scripts/analyze.js player "$RESULTS_DIR"
