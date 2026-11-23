# Experimento: player (abr)

| métrica | valor |
|---|---|
| segmentos carregados | 53 |
| trocas de qualidade | 4 |
| stalls | 0 |
| tempo total travado | 0 ms |
| tempo de carga do segmento p50 / p95 (ms) | 19 / 4208 |
| tempo até baixar a qualidade após limitar a banda | 25.7 s (→ 720p) |
| tempo até subir a qualidade após liberar a banda | 37.3 s (→ 720p) |
| mudanças de estado de edges no router (falsos positivos) | 0 |

## Linha do tempo (t=0 na 1ª injeção)

| t (s) | origem | evento |
|---|---|---|
| -22.3 | player | qualidade → 1080p (banda est. 642731 kbps) |
| 0 | caos | netem router sport=8000 rate 1500kbit delay 100ms |
| 25.7 | player | qualidade → 720p (banda est. 1625 kbps) |
| 27.7 | player | qualidade → 360p (banda est. 1562 kbps) |
| 40.4 | caos | netem_clear router  |
| 77.7 | player | qualidade → 720p (banda est. 8465 kbps) |
