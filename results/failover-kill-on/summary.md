# Experimento: edge_kill de edge2

| métrica | valor |
|---|---|
| detecção (1ª suspeita/queda no router) | 104 ms (SUSPECT, request_fail: ECONNREFUSED) |
| confirmação DOWN (health check) | 2357 ms |
| recuperação (1º segmento OK via failover) | 132 ms |
| requisições com erro durante a falha | 0 de 220 |
| requisições afetadas (failover ou erro) | 69 |
| latência das afetadas p50 / p95 / máx (ms) | 41.6 / 72.8 / 87.9 |
| latência normal antes da falha p50 / p95 (ms) | 43 / 81.3 |
| hit ratio antes → durante a falha | 1 → 0.877 |
| volta: edge2 UP no router após religar | 672 ms |
| volta: 1º segmento servido de novo por edge2 | 1945 ms (MISS) |


Injeção em t=0; religado em t=20.2 s. Série por segundo em `timeline.csv`.


## Eventos de estado no router

| t (ms) | edge | de | para | motivo |
|---|---|---|---|---|
| 104 | edge2 | UP | SUSPECT | request_fail: ECONNREFUSED |
| 2357 | edge2 | SUSPECT | DOWN | health_fail x2: TimeoutError |
| 20868 | edge2 | DOWN | UP | health_ok |
