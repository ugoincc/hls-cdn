#!/usr/bin/env bash
# Partição de rede: desconecta um edge da rede da CDN (o processo continua vivo).
# Uso: partition.sh [edge3] [on|off]
source "$(dirname "$0")/_lib.sh"
EDGE=${1:-edge3}; ACTION=${2:-on}; NET=${CDN_NETWORK:-minicdn_cdn}
if [ "$ACTION" = on ]; then
  mark partition_on "$EDGE"
  docker network disconnect "$NET" "$EDGE"
else
  mark partition_off "$EDGE"
  docker network connect --alias "$EDGE" "$NET" "$EDGE"
fi
