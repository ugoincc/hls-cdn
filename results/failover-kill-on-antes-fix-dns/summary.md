# Experimento: edge_kill de edge2

| métrica | valor |
|---|---|
| detecção (1ª suspeita/queda no router) | 84 ms (SUSPECT, request_fail: ECONNREFUSED) |
| confirmação DOWN (health check) | 2425 ms |
| recuperação (1º segmento OK via failover) | 105 ms |
| requisições com erro durante a falha | 18 de 173 |
| requisições afetadas (failover ou erro) | 93 |
| latência das afetadas p50 / p95 / máx (ms) | 30.1 / 8004.3 / 8019.9 |
| latência normal antes da falha p50 / p95 (ms) | 29.1 / 85.3 |
| hit ratio antes → durante a falha | 1 → 0.665 |
| volta: edge2 UP no router após religar | 778 ms |
| volta: 1º segmento servido de novo por edge2 | 1766 ms (MISS) |


Injeção em t=0; religado em t=20.2 s. Série por segundo em `timeline.csv`.


## Eventos de estado no router

| t (ms) | edge | de | para | motivo |
|---|---|---|---|---|
| 84 | edge2 | UP | SUSPECT | request_fail: ECONNREFUSED |
| 2425 | edge2 | SUSPECT | DOWN | health_fail x2: TimeoutError |
| 8101 | edge1 | UP | SUSPECT | request_fail: TimeoutError |
| 8926 | edge1 | SUSPECT | UP | health_ok |
| 10099 | edge3 | UP | SUSPECT | request_fail: TimeoutError |
| 10928 | edge3 | SUSPECT | UP | health_ok |
| 12097 | edge1 | UP | SUSPECT | request_fail: TimeoutError |
| 12108 | edge3 | UP | SUSPECT | request_fail: TimeoutError |
| 12929 | edge1 | SUSPECT | UP | health_ok |
| 12931 | edge3 | SUSPECT | UP | health_ok |
| 14112 | edge1 | UP | SUSPECT | request_fail: TimeoutError |
| 14929 | edge1 | SUSPECT | UP | health_ok |
| 16109 | edge2 | DOWN | SUSPECT | request_fail: TimeoutError |
| 16110 | edge3 | UP | SUSPECT | request_fail: TimeoutError |
| 16428 | edge2 | SUSPECT | DOWN | health_fail x16: TimeoutError |
| 16930 | edge3 | SUSPECT | UP | health_ok |
| 18085 | edge3 | UP | SUSPECT | request_fail: TimeoutError |
| 18929 | edge3 | SUSPECT | UP | health_ok |
| 20115 | edge1 | UP | SUSPECT | request_fail: TimeoutError |
| 20122 | edge2 | DOWN | SUSPECT | request_fail: TimeoutError |
| 20428 | edge2 | SUSPECT | DOWN | health_fail x20: TimeoutError |
| 20929 | edge1 | SUSPECT | UP | health_ok |
| 20994 | edge2 | DOWN | UP | health_ok |
