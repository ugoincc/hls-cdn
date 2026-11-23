#!/usr/bin/env bash
# Religa um edge (volta com cache vazio). Uso: start-edge.sh [edge2]
source "$(dirname "$0")/_lib.sh"
EDGE=${1:-edge2}
mark edge_start "$EDGE"
docker start "$EDGE" >/dev/null
