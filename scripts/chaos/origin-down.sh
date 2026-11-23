#!/usr/bin/env bash
# Derruba (ou religa) a origem. Uso: origin-down.sh [down|up]
source "$(dirname "$0")/_lib.sh"
if [ "${1:-down}" = down ]; then mark origin_down origin; docker stop -t 1 origin >/dev/null
else mark origin_up origin; docker start origin >/dev/null; fi
