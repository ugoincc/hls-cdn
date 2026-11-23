#!/usr/bin/env bash
# Volta tudo ao normal: remove regras tc, reconecta redes, religa contêineres.
source "$(dirname "$0")/_lib.sh"
NET=${CDN_NETWORK:-minicdn_cdn}
for c in origin edge1 edge2 edge3 router; do
  docker start "$c" >/dev/null 2>&1 || true
  docker network inspect "$NET" --format '{{range .Containers}}{{.Name}} {{end}}' | grep -qw "$c" \
    || docker network connect --alias "$c" "$NET" "$c" 2>/dev/null || true
  case $c in edge*|router) docker exec "$c" tc qdisc del dev eth0 root 2>/dev/null || true ;; esac
done
mark reset all
echo "ok: tudo religado, sem regras tc"
