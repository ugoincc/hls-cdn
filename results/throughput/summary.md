# Experimento: vazão e latência

| cenário | clientes | req/s | Mbps | p50 (ms) | p95 (ms) | p99 (ms) | hit ratio | erros |
|---|---|---|---|---|---|---|---|---|
| origem-direta | 1 | 17.4 | 93.5 | 57.1 | 61.9 | 65 | 0 | 0 |
| cdn-cache-frio | 1 | 116.9 | 627.9 | 5 | 60.8 | 69.7 | 0.949 | 0 |
| cdn-cache-quente | 1 | 184.1 | 988.7 | 5 | 8.4 | 11.8 | 1 | 0 |
| origem-direta | 5 | 89.5 | 480.5 | 55.4 | 60.4 | 65.2 | 0 | 0 |
| cdn-cache-frio | 5 | 256 | 1374.7 | 16.2 | 61.2 | 73 | 0.946 | 0 |
| cdn-cache-quente | 5 | 265.8 | 1427.5 | 17.8 | 29.5 | 35.5 | 1 | 0 |
| origem-direta | 10 | 178.9 | 961 | 55 | 61.6 | 66 | 0 | 0 |
| cdn-cache-frio | 10 | 275.3 | 1478.3 | 33.7 | 58.4 | 89.6 | 0.96 | 0 |
| cdn-cache-quente | 10 | 317.2 | 1703.6 | 30.6 | 44.2 | 52.5 | 1 | 0 |
| origem-direta | 20 | 360.1 | 1934 | 54 | 62.9 | 72.3 | 0 | 0 |
| cdn-cache-frio | 20 | 300.1 | 1611.6 | 62.9 | 96.4 | 135.7 | 0.977 | 0 |
| cdn-cache-quente | 20 | 315.6 | 1694.6 | 60.5 | 88.7 | 109.5 | 1 | 0 |

## Latência por resultado de cache (todas as execuções via router)

| cache | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| HIT | 29957 | 29.6 | 76.1 | 95.6 | 189.2 |
| MISS | 568 | 72.7 | 144.5 | 216.3 | 246.3 |
