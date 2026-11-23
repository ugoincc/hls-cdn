#!/usr/bin/env bash
# Aplica tc netem na interface de um contêiner.
# Uso: netem.sh <contêiner> <regras netem...>     ex.: netem.sh edge1 delay 300ms loss 5%
#      netem.sh <contêiner> clear
#
# SPORT=<porta>: aplica a regra SÓ aos pacotes com essa porta de origem (filtro u32),
# deixando o resto da interface livre. Ex.: SPORT=8000 netem.sh router rate 1500kbit delay 100ms
# limita apenas as respostas do router ao cliente (o "último quilômetro"). Sem o filtro, o
# health check router→edges entra na mesma fila do vídeo e sofre bufferbloat (segundos de
# espera), e o router passa a marcar edges saudáveis como DOWN.
source "$(dirname "$0")/_lib.sh"
C=${1:?contêiner}; shift
docker exec "$C" tc qdisc del dev eth0 root 2>/dev/null || true
if [ "${1:-}" = clear ]; then
  mark netem_clear "$C"
elif [ -n "${SPORT:-}" ]; then
  mark netem "$C" "sport=$SPORT $*"
  # prio: tráfego comum cai na banda 1:2 (sem regra); filtro manda sport=$SPORT para 1:3 (netem)
  docker exec "$C" tc qdisc add dev eth0 root handle 1: prio
  docker exec "$C" tc qdisc add dev eth0 parent 1:3 handle 30: netem "$@"
  docker exec "$C" tc filter add dev eth0 protocol ip parent 1:0 prio 1 u32 match ip sport "$SPORT" 0xffff flowid 1:3
else
  mark netem "$C" "$*"
  docker exec "$C" tc qdisc add dev eth0 root netem "$@"
fi
docker exec "$C" tc qdisc show dev eth0
