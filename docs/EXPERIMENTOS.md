# Experimentos

Todos rodam no **modo 1 máquina** (`docker compose up --build`). Cada experimento grava em
`results/<experimento>/` o JSONL bruto, CSVs e um `summary.md` gerado por `scripts/analyze.js`.

**Ambiente da execução registrada:** laptop Linux, 16 threads de CPU, Docker 29.8, Node 22.
loadgen, router, edges e origem compartilham a mesma CPU; a latência de rede é artificial
(`ORIGIN_DELAY_MS`, `tc netem`). Os números absolutos valem para esta máquina; o que importa
são as comparações.

---

## E1. Vazão e latência: origem direta × CDN (cache frio) × CDN (cache quente)

**Como rodar:** `scripts/experiments/throughput.sh` (≈3 min) → `results/throughput/`

**Configuração:** N ∈ {1, 5, 10, 20} clientes baixando segmentos de 720p (~650 KB) em sequência,
o mais rápido possível, por 15 s cada. A origem recebe `ORIGIN_DELAY_MS=50` para simular uma
origem distante (sem isso, origem e edges leem do mesmo disco local e o cache não teria o que
mostrar). "Cache frio" = `POST /cache/clear` em todos os edges antes da rodada; "quente" = rodada
seguinte, sem limpar.

| cenário | clientes | req/s | Mbps | p50 (ms) | p95 (ms) | p99 (ms) | hit ratio |
|---|---|---|---|---|---|---|---|
| origem direta | 1 | 17,4 | 93 | 57,1 | 61,9 | 65,0 | – |
| CDN, cache frio | 1 | 116,9 | 628 | 5,0 | 60,8 | 69,7 | 0,949 |
| CDN, cache quente | 1 | 184,1 | 989 | 5,0 | 8,4 | 11,8 | 1 |
| origem direta | 5 | 89,5 | 481 | 55,4 | 60,4 | 65,2 | – |
| CDN, cache frio | 5 | 256,0 | 1375 | 16,2 | 61,2 | 73,0 | 0,946 |
| CDN, cache quente | 5 | 265,8 | 1428 | 17,8 | 29,5 | 35,5 | 1 |
| origem direta | 10 | 178,9 | 961 | 55,0 | 61,6 | 66,0 | – |
| CDN, cache frio | 10 | 275,3 | 1478 | 33,7 | 58,4 | 89,6 | 0,960 |
| CDN, cache quente | 10 | 317,2 | 1704 | 30,6 | 44,2 | 52,5 | 1 |
| origem direta | 20 | 360,1 | 1934 | 54,0 | 62,9 | 72,3 | – |
| CDN, cache frio | 20 | 300,1 | 1612 | 62,9 | 96,4 | 135,7 | 0,977 |
| CDN, cache quente | 20 | 315,6 | 1695 | 60,5 | 88,7 | 109,5 | 1 |

**Leitura:**
- Com poucos clientes o cache domina: com 1 cliente, p50 cai de 57 ms para 5 ms (11×) e a vazão
  sobe ~10×. HIT tem p50 de 30 ms e MISS de 73 ms no agregado das rodadas.
- A CDN **satura em ~300 req/s (~1,7 Gbps)** a partir de 10 clientes, enquanto a origem direta
  escala linearmente (o atraso dela é só um `sleep`, não consome CPU) e ultrapassa a CDN com 20
  clientes.
- **O gargalo é o router.** Medição extra (`results/throughput/extra/`), 20 clientes, cache
  quente: via router → 290 req/s, router a **159% de CPU**, edges a 6–10%; **um único edge
  acessado direto → 471 req/s**. O modo proxy com buffer completo (necessário para o failover
  transparente, ver D5 em `DECISOES.md`) concentra todo o tráfego num processo Node.

---

## E2. Queda de edge sob carga, com e sem failover

**Como rodar:** `scripts/experiments/failover.sh kill on` e `scripts/experiments/failover.sh kill off`
(≈1,5 min cada) → `results/failover-kill-on/`, `results/failover-kill-off/`.
Também aceita `stop` (SIGTERM) e `partition` (`docker network disconnect`).

**Configuração:** cache aquecido (todos os segmentos 720p); 20 clientes no ritmo do vídeo
(1 segmento a cada 2 s → ~10 req/s); `docker kill edge2` em t=20 s; `docker start edge2` em
t=40 s; fim em t=60 s. `FAILOVER=off` faz o router usar só o dono do segmento no anel
(controle: hashing estático ingênuo, sem redirecionamento).

| métrica (t0 = instante do `docker kill`) | com failover | sem failover |
|---|---|---|
| detecção (1º evento de estado no router) | **104 ms** (SUSPECT, passiva: `ECONNREFUSED`) | 1905 ms (DOWN, health check) |
| confirmação DOWN (health check, 2 falhas) | 2357 ms | 1905 ms |
| **recuperação** (1º segmento OK do edge2 servido por outro edge) | **132 ms** | – (só quando o edge2 volta) |
| requisições com erro durante a falha (20 s) | **0 de 220** | **57 de 185 (31%)** |
| latência das requisições afetadas p50 / p95 / máx | 41,6 / 72,8 / 87,9 ms | 3012 / 4013 / 4026 ms |
| latência normal antes da falha p50 / p95 | 43,0 / 81,3 ms | 45,8 / 139,8 ms |
| hit ratio antes → durante a falha | 1,000 → 0,877 | 1,000 → 1,000 (erros não contam) |
| edge2 UP no router após `docker start` | 672 ms | 1229 ms |
| 1º segmento servido de novo pelo edge2 | 1945 ms (MISS: volta com cache vazio) | 1047 ms (MISS) |

**Leitura:**
- Com failover, a falha é **invisível para o cliente**: zero erros, latência das requisições
  afetadas igual à normal. A detecção passiva reage em ~100 ms (a primeira requisição que falha
  já é redirecionada); o health check confirma em ~2,4 s.
- Sem failover, ~31% das requisições falham durante toda a queda — exatamente a fatia do anel do
  edge2 (32,3%). Detectar não basta: é o redirecionamento ao sucessor no anel que mantém o serviço.
- O custo do failover é o cache frio: as chaves do edge2 viram MISS no sucessor (hit ratio
  1 → 0,88) — e **só** elas, graças ao hashing consistente. Ao voltar, o edge2 retoma suas chaves
  com cache vazio (MISS de novo).

### E2a. Falha em cascata encontrada (antes da correção D7)

A primeira execução com failover (`results/failover-kill-on-antes-fix-dns/`) teve **18 erros, p95
de 8 s nas requisições afetadas, e edge1/edge3 (saudáveis) marcados SUSPECT 13 vezes**. Causa:
`dns.lookup("edge2")` demorando ~5 s após a morte do contêiner e esgotando o threadpool do libuv,
o que travou também as conexões com os edges saudáveis. Correção e discussão em `DECISOES.md` (D7).

---

## E3. ABR sob banda limitada no link do cliente

**Como rodar:** abrir `http://localhost:8000/?session=abr&buffer=10`, dar play e rodar
`scripts/experiments/abr.sh` (≈2 min) → `results/abr/`

**Configuração:** player hls.js real (navegador), buffer máximo de 10 s; 20 s normal; então
`tc netem rate 1500kbit delay 100ms` nas respostas do router ao cliente (`SPORT=8000`) por 40 s;
então remoção e 40 s de observação.

| métrica | só tráfego ao cliente (`results/abr/`) | interface inteira (`results/abr-sem-filtro/`) |
|---|---|---|
| stalls | **0** | 0 |
| tempo até baixar a qualidade após limitar | 25,7 s (1080p → 720p; → 360p em 27,7 s) | 24,0 s (1080p → 360p) |
| banda estimada pelo player sob limitação | 1,56–1,63 Mbps | 1,45 Mbps |
| tempo até subir após liberar | 37,3 s (→ 720p) | 35,9 s (→ 720p) |
| carga de segmento p50 / p95 | 19 / 4208 ms | 24 / 2086 ms |
| mudanças de estado falsas de edges no router | **0** | **6** |

**Leitura:**
- O ABR evitou travamentos: a qualidade caiu para caber em 1,5 Mbps (360p ≈ 0,9 Mbps) sem stall.
- A descida leva ~25 s: um segmento 1080p (~1,3 MB) leva ~7 s para baixar a 1,5 Mbps, a fila do
  netem soma alguns segundos (bufferbloat no caminho de dados), e o hls.js só atualiza a
  estimativa de banda ao fim de cada download, suavizada por média móvel exponencial. Com 10 s
  de buffer, o player aguenta essa espera sem travar — é o que torna o ABR "reativo e seguro".
- A subida é deliberadamente mais lenta (~37 s, e só até 720p na janela observada): o hls.js
  exige folga (`abrBandWidthUpFactor` = 0,7) e, com o buffer cheio, baixa pouco e mede pouco.
  Subir rápido demais causaria oscilação de qualidade.

### E3a. Bufferbloat no plano de controle (execução sem filtro)

Na primeira execução (`results/abr-sem-filtro/`) o netem foi aplicado na interface inteira do
router. O ABR funcionou (1080p → 360p em 24,0 s, 0 stalls), mas os **health checks do router
para os edges entraram na mesma fila do vídeo**: a fila do netem (1000 pacotes ≈ 12 Mbit) a
1,5 Mbps acumula segundos de espera, os health checks estouraram o timeout de 500 ms e o router
registrou **6 mudanças de estado falsas** (edges saudáveis marcados DOWN). Lição: o plano de
controle não pode dividir a fila com o plano de dados; corrigido limitando só o tráfego com
porta de origem 8000 (`SPORT` em `scripts/chaos/netem.sh`).

---

## E4. Origem fora do ar

**Como rodar (manual, ≈1 min):** com o cache aquecido, `scripts/chaos/origin-down.sh down`,
pedir segmentos via router (`curl -sI localhost:8000/hls/720p/seg_003.ts`), depois
`scripts/chaos/origin-down.sh up`. Resultado em `results/origin-down/`.

| requisição durante a queda | resultado |
|---|---|
| segmento já em cache | **200 HIT em 8–9 ms**, como se nada tivesse acontecido |
| segmento fora do cache / playlist | 502 após 2–6 s (router tenta os 3 edges) |
| primeiro pedido após religar a origem | 200 MISS em 27 ms |
| mudanças de estado falsas de edges no router | **0** (eram 1 por requisição antes de D11) |

**Leitura:** o cache é o que mantém o serviço com a origem fora: o conteúdo popular (já
aquecido) continua sendo entregue; o resto falha. O teste revelou uma **inversão de timeouts**
(edge esperava a origem mais tempo que o router esperava o edge), corrigida em D11.
