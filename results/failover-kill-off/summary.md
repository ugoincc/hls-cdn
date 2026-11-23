# Experimento: edge_kill de edge2

| métrica | valor |
|---|---|
| detecção (1ª suspeita/queda no router) | 1905 ms (DOWN, health_fail x2: TimeoutError) |
| confirmação DOWN (health check) | 1905 ms |
| recuperação (1º segmento OK via failover) | – |
| requisições com erro durante a falha | 57 de 185 |
| requisições afetadas (failover ou erro) | 57 |
| latência das afetadas p50 / p95 / máx (ms) | 3011.9 / 4013.3 / 4026.1 |
| latência normal antes da falha p50 / p95 (ms) | 45.8 / 139.8 |
| hit ratio antes → durante a falha | 1 → 1 |
| volta: edge2 UP no router após religar | 1229 ms |
| volta: 1º segmento servido de novo por edge2 | 1047 ms (MISS) |


Injeção em t=0; religado em t=20.2 s. Série por segundo em `timeline.csv`.


## Eventos de estado no router

| t (ms) | edge | de | para | motivo |
|---|---|---|---|---|
| 1905 | edge2 | UP | DOWN | health_fail x2: TimeoutError |
| 21413 | edge2 | DOWN | UP | health_ok |
