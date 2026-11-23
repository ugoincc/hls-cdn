#!/usr/bin/env bash
# Aplica tc netem na interface de um contêiner.
# Uso: netem.sh <contêiner> <regras netem...>     ex.: netem.sh router rate 1500kbit delay 100ms
#      netem.sh <contêiner> clear
# No router, a regra afeta o tráfego de saída → o link router→cliente (o "último quilômetro").
source "$(dirname "$0")/_lib.sh"
C=${1:?contêiner}; shift
if [ "${1:-}" = clear ]; then
  mark netem_clear "$C"
  docker exec "$C" tc qdisc del dev eth0 root 2>/dev/null || true
else
  mark netem "$C" "$*"
  docker exec "$C" tc qdisc replace dev eth0 root netem "$@"
fi
docker exec "$C" tc qdisc show dev eth0
