# Mini-CDN com streaming adaptativo (HLS)

Trabalho 6 de Sistemas Distribuídos. Uma CDN em miniatura com cinco processos em contêineres
separados que se comunicam por HTTP: uma **origem** com vídeo HLS em 3 qualidades, três
**edges** com cache LRU e um **router** com hashing consistente, health check e failover. Um
**player** hls.js no navegador escolhe a qualidade conforme a banda (ABR) e mostra, em tempo
real, qual edge serviu cada segmento.

Os cenários de falha (queda de edge, partição, latência/perda, banda limitada, origem fora do
ar) são injetados por scripts e medidos por experimentos reprodutíveis.

```
                 ┌──────────────┐
                 │   origin     │  HLS gerado por ffmpeg no build
                 │  :8080       │  360p / 720p / 1080p, segmentos de 2 s
                 └──────┬───────┘
         ┌──────────────┼──────────────┐
     ┌───▼────┐     ┌───▼────┐     ┌───▼────┐
     │ edge1  │     │ edge2  │     │ edge3  │  cache LRU em memória
     │ :8081  │     │ :8082  │     │ :8083  │  busca na origem no MISS
     └───▲────┘     └───▲────┘     └───▲────┘
         └──────────────┼──────────────┘
                 ┌──────┴───────┐
                 │   router     │  hashing consistente + health check + failover
                 │  :8000       │  serve o player (/) e recebe métricas (/events)
                 └──────▲───────┘
                        │
          navegador: player hls.js (ABR) + painel de métricas
```

## Pré-requisitos

- **Docker** com o plugin **Compose v2** (`docker compose version`). Testado com Docker 29 no Linux.
- **Linux** para os cenários com `tc netem`: os contêineres usam `cap_add: [NET_ADMIN]`.
  O resto funciona em qualquer sistema com Docker.
- Para os experimentos: **Node.js 22+**, `bash` e `curl` no host. Não há `npm install`; o
  `loadgen` e o `analyze` usam só a biblioteca padrão.
- Portas livres: 8000 (router), 8080 (origem), 8081–8083 (edges).
- Nenhum acesso à internet durante a execução: o vídeo é sintético e o hls.js vem do npm no build.

## Como executar

```bash
docker compose up --build
```

O primeiro build leva ~2 min, a maior parte no encode do vídeo. Depois abra
**http://localhost:8000** e clique em ▶.

Para parar e remover os contêineres:

```bash
docker compose down
```

### Endereços úteis

| URL | O quê |
|---|---|
| `http://localhost:8000/` | player + painel de métricas |
| `http://localhost:8000/?buffer=10` | player com buffer de 10 s, que deixa as falhas mais visíveis (padrão: 30 s) |
| `http://localhost:8000/status` | estado do anel e dos edges (JSON) |
| `http://localhost:808{1,2,3}/stats` | estatísticas de cada edge: hits, misses, hit ratio, bytes |
| `http://localhost:8080/hls/master.m3u8` | master playlist direto da origem |

Parâmetros do player: `session=<nome>` agrupa os eventos enviados ao router, `buffer=<s>` define
o buffer à frente e `src=<url>` usa outra playlist.

## Componentes

| serviço | código | papel |
|---|---|---|
| `origin` | [services/origin](services/origin) | Gera o HLS no build (`ffmpeg`, `testsrc2` + `sine`; o rótulo da qualidade e um relógio ficam queimados na imagem) e serve os arquivos. `ORIGIN_DELAY_MS` simula uma origem distante. |
| `edge1..3` | [services/edge](services/edge) | Proxy com cache LRU limitado em bytes e coalescência de MISS. Responde com `X-Edge-Id` e `X-Cache: HIT/MISS` e tem um disjuntor para quando a origem está fora. |
| `router` | [services/router](services/router) | Mapeia cada segmento a um edge num anel de hashing consistente (100 nós virtuais) e faz proxy. Se o edge falhar, tenta o próximo do anel **na mesma requisição**. Detecta falhas de forma passiva (requisição que falha → `SUSPECT`) e ativa (`/health` a cada 1 s, 2 falhas → `DOWN`). |
| player | [services/router/public](services/router/public) | Mostra qualidade, banda estimada, buffer, stalls, o edge e o HIT/MISS de cada segmento e o estado dos edges. Envia eventos a `POST /events`. |

As decisões de projeto (o quê, alternativas e por quê) estão em
[docs/DECISOES.md](docs/DECISOES.md).

## Roteiro da demo (≈8 min)

Pré-condição: `docker compose up --build` já rodou. Abra `http://localhost:8000/?buffer=10` e dê
play. Deixe um terminal na raiz do repositório.

1. **Visão normal (1 min).** O painel mostra a qualidade (1080p), os segmentos coloridos pelo edge
   que os serviu (cada edge tem uma cor) e o HIT/MISS: os primeiros segmentos são MISS e, ao
   rever um trecho, viram HIT. Cada segmento tem um dono fixo no anel.

2. **Queda de um edge (2 min).**
   ```bash
   scripts/chaos/kill-edge.sh edge2
   ```
   No painel, o edge2 vai para `SUSPECT` na primeira requisição que falha (~100 ms) e para `DOWN`
   no health check (~2 s). Os segmentos que eram do edge2 passam a sair do edge1/edge3, como MISS,
   porque o substituto está com o cache frio. **O vídeo não trava.**
   ```bash
   scripts/chaos/start-edge.sh edge2
   ```
   O edge2 volta a `UP` em 1–3 s (o tempo de o contêiner subir) e retoma as suas chaves com o cache vazio.

3. **Banda limitada no cliente → ABR (3 min).**
   ```bash
   SPORT=8000 scripts/chaos/netem.sh router rate 1500kbit delay 100ms
   ```
   Em ~25 s a qualidade cai de 1080p para 720p e depois para 360p (o rótulo na imagem muda), sem
   stall. Remova a limitação e a qualidade volta a subir em ~35 s:
   ```bash
   scripts/chaos/netem.sh router clear
   ```

4. **Origem fora do ar (1 min, opcional).**
   ```bash
   scripts/chaos/origin-down.sh down
   ```
   Segmentos que já estão em cache continuam saindo como HIT; os demais devolvem 502. Mostra que
   o cache é o que sustenta o serviço. Para religar:
   ```bash
   scripts/chaos/origin-down.sh up
   ```

5. **Restaurar tudo.**
   ```bash
   scripts/chaos/reset.sh
   ```

## Cenários de falha

Todos os scripts ficam em `scripts/chaos/`. Cada um grava o instante da injeção em
`results/chaos-events.jsonl`, que é o `t0` usado nas métricas de detecção e recuperação.

| script | efeito |
|---|---|
| `kill-edge.sh [edge2] [kill\|stop]` | derruba um edge (`kill` = SIGKILL, queda abrupta; `stop` = SIGTERM) |
| `start-edge.sh [edge2]` | religa o edge (volta com cache vazio) |
| `partition.sh [edge3] [on\|off]` | desconecta o edge da rede da CDN; o processo continua vivo |
| `netem.sh <contêiner> <regras>` | `tc netem` no contêiner, ex.: `netem.sh edge1 delay 300ms loss 5%` |
| `SPORT=8000 netem.sh router <regras>` | aplica a regra **só** às respostas do router ao cliente (ver D10) |
| `netem.sh <contêiner> clear` | remove a regra |
| `origin-down.sh [down\|up]` | derruba ou religa a origem |
| `reset.sh` | religa todos os contêineres, reconecta as redes e remove todas as regras `tc` |

## Experimentos e métricas

Os scripts ficam em `scripts/experiments/` e rodam com a stack de pé. Cada um grava em
`results/<experimento>/` o JSONL bruto (não versionado), CSVs e um `summary.md` gerado por
`scripts/analyze.js`. Os detalhes de cada um estão em [docs/EXPERIMENTOS.md](docs/EXPERIMENTOS.md).

| experimento | comando | duração | resultado principal (nesta máquina) |
|---|---|---|---|
| E1. vazão e latência | `scripts/experiments/throughput.sh` | ~3 min | com 1 cliente, o cache reduz o p50 de 57 ms para 5 ms; a CDN satura em ~300 req/s (gargalo: o router) |
| E2. queda de edge | `scripts/experiments/failover.sh kill on` e `… kill off` | ~1,5 min cada | com failover: detecção em 104 ms, recuperação em 132 ms, **0 erros**; sem failover: 31% de erro |
| E3. ABR | abra `/?session=abr&buffer=10`, dê play e rode `scripts/experiments/abr.sh` | ~2 min | 1080p → 360p sob 1,5 Mbps com **0 stalls** |
| E4. origem fora | manual (ver EXPERIMENTOS.md) | ~1 min | em cache: 200 em 8 ms; fora do cache: 502 |

O `failover.sh` também aceita `stop` e `partition` no lugar de `kill`. Para gerar carga avulsa:

```bash
node scripts/loadgen.js --clients 10 --duration 30 --level 720p --paced
```

Para reanalisar um resultado (os modos são `load`, `failover` e `player`):

```bash
node scripts/analyze.js failover results/failover-kill-on
```

## Configuração

Toda a configuração é feita por variáveis de ambiente, sem endereço fixo no código. As que o
`docker-compose.yml` repassa podem ser definidas na linha de comando:

| variável | padrão | onde | efeito |
|---|---|---|---|
| `VIDEO_DURATION` | 180 | origin (build) | duração do vídeo em segundos |
| `ORIGIN_DELAY_MS` | 0 | origin | atraso artificial em cada resposta |
| `CACHE_MAX_MB` | 256 | edges | tamanho do cache de cada edge |
| `ORIGIN_TIMEOUT_MS` / `ORIGIN_BREAKER_MS` | 2000 / 3000 | edges | timeout da origem e janela do disjuntor (ver D11) |
| `EDGES` | `edge1=http://edge1:8081,…` | router | lista de edges `id=url` |
| `HEALTH_INTERVAL_MS` / `HEALTH_FAILS` | 1000 / 2 | router | período do health check e falhas seguidas até `DOWN` |
| `EDGE_TIMEOUT_MS` | 4000 | router | timeout de cada tentativa num edge |
| `FAILOVER` | on | router | `off` usa só o dono do segmento (grupo de controle do E2) |

Exemplo:

```bash
ORIGIN_DELAY_MS=50 CACHE_MAX_MB=32 docker compose up -d
```

## Estrutura

```
docker-compose.yml       modo padrão: tudo em uma máquina
services/origin|edge|router
scripts/chaos/           injeção de falhas
scripts/experiments/     um script por experimento
scripts/loadgen.js       clientes HLS headless concorrentes
scripts/analyze.js       JSONL → CSV + summary.md
results/                 saída dos experimentos (resumos versionados)
docs/DECISOES.md         decisões de projeto
docs/EXPERIMENTOS.md     metodologia e resultados
```

## Limitações

- O router é centralizado: é o gargalo de vazão e um ponto único de falha (CDNs reais usam DNS
  ou anycast para o cliente falar direto com o edge).
- O cache fica só em memória e não há replicação entre edges. Com a origem fora, os segmentos
  que não estão em cache ficam indisponíveis.
- Tudo roda numa única máquina: a latência de rede é artificial (`ORIGIN_DELAY_MS`, `tc netem`) e
  os processos competem pela mesma CPU.
- O modo com duas máquinas, previsto no planejamento, não foi implementado.

Mais detalhes em [docs/DECISOES.md](docs/DECISOES.md#limitações-conhecidas).
