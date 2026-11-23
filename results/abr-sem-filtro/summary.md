# Experimento: player (abr-sem-filtro)

| métrica | valor |
|---|---|
| segmentos carregados | 57 |
| trocas de qualidade | 3 |
| stalls | 0 |
| tempo total travado | 0 ms |
| tempo de carga do segmento p50 / p95 (ms) | 24 / 2086 |
| tempo até baixar a qualidade após limitar a banda | 24.0 s (→ 360p) |
| tempo até subir a qualidade após liberar a banda | 35.9 s (→ 720p) |
| mudanças de estado de edges no router (falsos positivos) | 6 |

## Linha do tempo (t=0 na 1ª injeção)

| t (s) | origem | evento |
|---|---|---|
| -18 | player | qualidade → 1080p (banda est. 610371 kbps) |
| 0 | caos | netem router rate 1500kbit delay 100ms |
| 6.7 | router | edge1: UP → DOWN (health_fail x2: TimeoutError) |
| 6.7 | router | edge3: UP → DOWN (health_fail x2: TimeoutError) |
| 7.7 | router | edge2: UP → DOWN (health_fail x2: TimeoutError) |
| 11.7 | router | edge1: DOWN → UP (health_ok) |
| 11.7 | router | edge2: DOWN → UP (health_ok) |
| 11.7 | router | edge3: DOWN → UP (health_ok) |
| 12.7 | player | erro aborted |
| 24 | player | qualidade → 360p (banda est. 1445 kbps) |
| 40.1 | caos | netem_clear router  |
| 76 | player | qualidade → 720p (banda est. 10801 kbps) |
