# CLAUDE.md — Trabalho 6 de Sistemas Distribuídos

> Este arquivo dá contexto ao Claude Code. O planejamento, o documento técnico,
> o relatório e os slides são feitos no Claude Project **"SD"** (claude.ai); a
> implementação, os experimentos e o repositório são feitos aqui.
> Mantenha este arquivo atualizado quando uma decisão mudar.

## Contexto

- Disciplina: Sistemas Distribuídos — Trabalhos 5 e 6 (ano letivo 2026).
- **Prazo: 23/11/2026** (adiado de 17/11). Trabalho individual.
- Linguagem: **Node.js** (22+, ESM, JavaScript puro — sem TypeScript para ganhar tempo).
- Tema escolhido: **Sistemas multimídia distribuídos — mini-CDN com streaming
  adaptativo (HLS)**. WebRTC e DASH entram só no documento técnico, não na implementação.
- Tema ainda precisa ser validado com o professor.

### O que o enunciado exige (resumo)

1. Documento técnico do tema (conceitos, aplicações, limitações, problemas em aberto,
   estado da arte, referências acadêmicas/documentação oficial). → feito no Project.
2. Levantamento de ferramentas com plataformas suportadas. → feito no Project.
3. **Implementação** (este repositório):
   - mínimo de **3 nós/processos comunicando-se via rede** (contêineres valem);
   - pelo menos **um cenário de falha demonstrado** (queda de nó, partição, latência,
     mensagem perdida) e o comportamento do sistema diante dele;
   - repositório com **README** e execução reprodutível com **`docker compose up`**.
4. Relatório técnico: arquitetura, decisões de projeto, experimentos, **métricas
   (latência, vazão, tempo de recuperação)**, limitações. → escrito no Project a partir
   de `docs/DECISOES.md` e `results/`.
5. Seminário de 20–25 min com **demo ao vivo de 5–10 min** (apresentação online, do laptop Linux).

## Arquitetura

```
                 ┌──────────────┐
                 │   origin     │  HLS pré-codificado (ffmpeg no build)
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

### Componentes

**origin** (`services/origin`)
- Serve arquivos estáticos HLS (master playlist + 3 renditions).
- Vídeo gerado **no build da imagem** com `ffmpeg` a partir de fonte sintética
  (`testsrc2` + `sine`), sem download → reprodutível. Cada rendition tem **o rótulo da
  qualidade (ex.: "720p") e um relógio queimados na imagem**, para a plateia ver a troca
  de qualidade e o avanço do vídeo.
- Ladder sugerido: 360p ~800 kbps, 720p ~2,5 Mbps, 1080p ~5 Mbps; segmentos de 2 s;
  duração ~3 min.
- `ORIGIN_DELAY_MS` (opcional): atraso artificial para evidenciar o ganho do cache.
- `GET /health`.

**edge** (`services/edge`, mesma imagem para edge1..3)
- Proxy com cache LRU em memória (`CACHE_MAX_MB`). MISS → busca em `ORIGIN_URL`.
- Headers de resposta: `X-Edge-Id`, `X-Cache: HIT|MISS`.
- Log JSON por requisição (stdout): `{ts, edge, path, cache, status, bytes, ms}`.
- `GET /health`, `GET /stats` (hits, misses, bytes, tamanho do cache).
- Imagem inclui `iproute2` e o serviço roda com `cap_add: [NET_ADMIN]` (para `tc netem`).

**router** (`services/router`)
- **Hashing consistente** (anel com nós virtuais) mapeando o caminho do segmento → edge.
- **Modo proxy** (padrão): o router busca no edge escolhido e repassa ao cliente.
  Se o edge falhar (erro/timeout), marca como suspeito e **tenta o próximo do anel na
  mesma requisição** (failover transparente ao cliente).
- Health check ativo: `GET /health` em cada edge a cada `HEALTH_INTERVAL_MS` (padrão 1000);
  `HEALTH_FAILS` falhas seguidas (padrão 2) → DOWN; volta UP após 1 sucesso.
- Repassa `X-Edge-Id` e `X-Cache` ao cliente. Loga eventos de mudança de estado de edge
  com timestamp (necessário para medir tempo de recuperação).
- Serve o player estático em `/` e recebe eventos do player em `POST /events`
  (grava em `results/` via volume, JSONL).
- `GET /status`: estado do anel e dos edges (o painel do player consome).
- Configuração por env: `EDGES=edge1=http://edge1:8081,edge2=...` — **nenhum endereço
  fixo no código**, para permitir o modo com duas máquinas.

**player** (`services/router/public`)
- Página única com **hls.js vendorizado** (via npm, copiado para `public/`, sem CDN externa).
- Painel: qualidade atual, banda estimada, buffer, número e duração de travamentos (stalls),
  qual edge serviu o último segmento (`data.networkDetails.getResponseHeader('X-Edge-Id')`
  no evento `FRAG_LOADED`), HIT/MISS, estado dos edges (de `/status`).
- Envia eventos (`LEVEL_SWITCHED`, `FRAG_LOADED` com tempos, stalls/`BUFFER_STALLED_ERROR`,
  erros) para `POST /events`.

## Estrutura de diretórios (proposta)

```
trabalho-6/
├── CLAUDE.md
├── README.md
├── docker-compose.yml          # modo padrão: tudo em uma máquina
├── compose.laptop.yml          # modo 2 máquinas: router + edge1 + edge2
├── compose.mac.yml             # modo 2 máquinas: origin + edge3
├── services/
│   ├── origin/   (Dockerfile, server.js, encode.sh)
│   ├── edge/     (Dockerfile, server.js, lru.js)
│   └── router/   (Dockerfile, server.js, hashring.js, public/)
├── scripts/
│   ├── chaos/    (kill-edge.sh, netem.sh, partition.sh, origin-down.sh, reset.sh)
│   ├── loadgen.js              # clientes headless concorrentes → latência/vazão
│   ├── experiments/            # um script por experimento, gera results/<exp>/
│   └── analyze.js              # JSONL → CSV + resumo (p50/p95, hit ratio, recuperação)
├── results/                    # saída dos experimentos (versionar os resumos)
└── docs/
    ├── DECISOES.md             # decisões de projeto e por quê (alimenta o relatório)
    └── EXPERIMENTOS.md         # como cada experimento foi rodado + resultados
```

## Modos de execução

### 1. Uma máquina (padrão, obrigatório, usado na demo ao vivo)
`docker compose up --build` → abrir `http://localhost:8000`.

### 2. Duas máquinas (bônus, depois do modo 1 estar pronto)
- **Mac Studio** (rede interna da empresa, acesso por **VPN + SSH**, Docker via **Colima**):
  `origin` + `edge3` (`compose.mac.yml`).
- **Laptop Linux**: `router` + `edge1` + `edge2` (`compose.laptop.yml`).
- **Restrição:** a VPN provavelmente só permite conexões **laptop → Mac**. Toda conexão
  deve partir do laptop. Por isso a origem fica no Mac (edge1/edge2 buscam lá; edge3 busca
  localmente no Mac) e o router alcança edge3 no Mac.
- **Conectividade via túnel SSH** (Colima publica portas no localhost do Mac):
  `ssh -N -L <bind>:18080:localhost:8080 -L <bind>:18083:localhost:8083 mac`
  Os contêineres do laptop alcançam o túnel via `host.docker.internal`
  (`extra_hosts: ["host.docker.internal:host-gateway"]`); o `<bind>` precisa ser
  acessível pela bridge do Docker (ex.: IP da `docker0`), não só 127.0.0.1.
- Deploy no Mac pode ser feito daqui por SSH:
  `ssh mac 'cd ~/trabalho-6 && docker compose -f compose.mac.yml up -d --build'`.
- Verificar no Colima: `tc netem` disponível na VM (`sch_netem`) se for usar netem no Mac.
- Partição real: derrubar o túnel SSH ou bloquear o IP do Mac com `iptables` no laptop.
- Documentar que o túnel adiciona overhead (relevante para as métricas).

## Cenários de falha (scripts em `scripts/chaos/`)

| Cenário | Como injetar | O que se espera / mede |
|---|---|---|
| Queda de edge | `docker stop edge2` (ou `kill -9`) | Router detecta (passivo na 1ª falha, ativo em ≤ ~2 s), segmentos do edge2 vão para o próximo do anel; player sem stall ou stall curto. Medir **tempo de detecção**, **tempo de recuperação** (1º segmento OK de outro edge), stalls, queda de hit ratio (cache frio no novo edge). |
| Volta do edge | `docker start edge2` | Edge volta ao anel com cache vazio; MISSes temporários. |
| Banda limitada / latência no cliente | `tc netem` no **router** (link do cliente): ex. `rate 1500kbit delay 100ms` | **ABR** do hls.js baixa a qualidade sem travar. Medir tempo até a troca de nível e stalls. Remover a limitação → qualidade sobe. |
| Latência / perda em um edge | `tc netem` em um edge: `delay 300ms loss 5%` | Latência p50/p95 por edge; efeito nos segmentos mapeados para ele. |
| Partição de um edge | `docker network disconnect <rede> edge3` | Igual à queda, mas o processo continua vivo (health check falha por timeout). |
| Origem fora do ar | `docker stop origin` | Edges continuam servindo o que já está em cache; MISS → erro 502. Mostrar a importância do cache. |

`scripts/chaos/reset.sh` remove todas as regras de `tc` e religa tudo.

## Métricas (para o relatório)

- **Latência por segmento**: no edge (origem/cache), no router (fim a fim no servidor), no
  player (`stats.loading` do hls.js). Reportar p50/p95/p99.
- **Vazão**: `scripts/loadgen.js` com N clientes concorrentes (ex.: 1, 5, 10, 20) baixando
  segmentos → requisições/s e Mbps; comparar com e sem cache, 1 vs 3 edges.
- **Hit ratio do cache** por edge e global.
- **Tempo de detecção e de recuperação** após queda de edge (timestamps dos logs do router
  vs instante da injeção registrado pelo script de experimento).
- **Player**: número e duração de stalls, trocas de qualidade, tempo até a troca após netem.
- Modo 2 máquinas: latência laptop↔Mac (via VPN/túnel) vs local.

Cada experimento grava em `results/<experimento>/` (JSONL bruto + CSV + `summary.md`) e é
descrito em `docs/EXPERIMENTOS.md`. Esses arquivos voltam para o Project para virar o relatório.

## Plano por etapas

- [x] 1. Esqueleto: estrutura, `docker-compose.yml`, `origin` com encode ffmpeg funcionando
      (abrir a master playlist no navegador/`ffplay`).
- [x] 2. `edge` com cache LRU + headers + logs; `router` com anel de hashing consistente em
      modo proxy (sem failover ainda). Vídeo tocando via `http://localhost:8000`.
- [x] 3. Player com painel de métricas + `POST /events`.
- [x] 4. Health check + failover no router; testar `docker stop edge2` com vídeo tocando.
- [x] 5. Scripts de caos (`kill-edge`, `netem`, `partition`, `origin-down`, `reset`).
- [x] 6. `loadgen.js` + scripts de experimento + `analyze.js`; rodar experimentos e gerar
      `results/` e `docs/EXPERIMENTOS.md`.
- [x] 7. README completo (pré-requisitos, `docker compose up`, roteiro da demo, como rodar
      cada experimento) + `docs/DECISOES.md`.
- [ ] 8. (Bônus) Modo 2 máquinas com o Mac Studio via VPN + túnel SSH; experimento de latência
      e partição real.
- [x] 9. Ensaio do roteiro da demo (5–10 min) no modo 1.

Cronograma: dia 21 → etapas 1–5; dia 22 → 6–7 (manhã), 8 se sobrar tempo, documento,
relatório e slides no Project (tarde); dia 23 → revisão e entrega.

## Convenções

- Node 22+, ESM (`"type": "module"`), `fetch` nativo. Dependências mínimas
  (permitido: `express` ou `node:http` puro; `hls.js` só no front; `undici` no router
  apenas para o `lookup` DNS customizado — ver D7 em `docs/DECISOES.md`).
- Uma imagem por serviço, base `node:22-alpine` (origin adiciona `ffmpeg`; edge/router
  adicionam `iproute2`).
- Toda configuração por variável de ambiente com padrão sensato; nada de IP/host fixo no código.
- Logs em JSON Lines no stdout, sempre com `ts` (epoch ms) e `service`.
- README e documentação em **português**. Nomes no código em inglês.
- Commits pequenos por etapa. Não versionar segmentos de vídeo gerados (são gerados no build).
- Ao tomar uma decisão de projeto relevante, registrar em `docs/DECISOES.md`
  (o quê, alternativas, por quê) — isso vira a seção de decisões do relatório.
- O Mac Studio é uma máquina da empresa: não expor portas publicamente; usar só túnel SSH via VPN.
