# E4 — Origem fora do ar

Cache aquecido com os 10 primeiros segmentos 720p; `scripts/chaos/origin-down.sh down`; sondagem
com `curl` via router (`probe.txt`); `origin-down.sh up`.

| requisição | status | servido por | tempo |
|---|---|---|---|
| segmento em cache (seg_003, seg_007) | 200 HIT | edge1 / edge3 | 8–9 ms |
| segmento fora do cache (seg_020…052) | 502 | – (3 tentativas) | 2,0–6,0 s |
| playlist fora do cache | 502 | – (3 tentativas) | 2,0 s |
| após religar a origem (seg_050) | 200 MISS | edge3 | 27 ms |

Mudanças de estado falsas de edges no router durante a queda: **0** (antes da correção D11: um
`SUSPECT` por requisição, e 502 só após 8–12 s).
