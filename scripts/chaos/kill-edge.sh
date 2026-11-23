#!/usr/bin/env bash
# Derruba um edge. Uso: kill-edge.sh [edge2] [stop|kill]
#   stop → SIGTERM (desligamento limpo) · kill → SIGKILL (queda abrupta, como falha de hardware)
source "$(dirname "$0")/_lib.sh"
EDGE=${1:-edge2}; MODE=${2:-kill}
mark "edge_$MODE" "$EDGE"
if [ "$MODE" = kill ]; then docker kill "$EDGE" >/dev/null; else docker stop -t 1 "$EDGE" >/dev/null; fi
