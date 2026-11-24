# Decisões de projeto

Cada decisão: **o quê**, **alternativas consideradas** e **por quê**. Alimenta a seção de
decisões do relatório.

## D1. Conteúdo HLS gerado no build da imagem, com fonte sintética

- **O quê:** o `origin` roda `ffmpeg` (`testsrc2` + `sine`) num estágio de build e copia só os
  `.m3u8`/`.ts` para a imagem final. Cada qualidade tem o rótulo (ex.: "720p") e um relógio
  queimados na imagem.
- **Alternativas:** baixar um vídeo aberto (Big Buck Bunny); codificar na inicialização do
  contêiner; versionar os segmentos no git.
- **Por quê:** reprodutível sem rede externa e sem arquivos grandes no repositório; o rótulo
  torna a troca de qualidade do ABR visível para a plateia. Custo: build de ~1–2 min de encode
  (mais o download do ffmpeg na primeira vez).
- **Opcional:** se existir `services/origin/input.*`, o mesmo pipeline usa esse vídeo como fonte
  (mesma ladder, CBR e GOP; redimensionado com *letterbox*; silêncio se não houver áudio). O
  sintético continua sendo o padrão, para manter o build reprodutível.

## D2. Ladder em CBR com keyframes alinhados a cada 2 s

- **O quê:** 360p/800 kbps, 720p/2,5 Mbps, 1080p/5 Mbps; `-g 48 -sc_threshold 0` a 24 fps;
  `nal-hrd=cbr` com `minrate = maxrate = b:v`.
- **Alternativas:** VBR/CRF (padrão do x264).
- **Por quê:** keyframe no início de todo segmento, nas três qualidades, permite trocar de nível
  em qualquer fronteira. O `testsrc2` comprime demais: em VBR o "1080p a 5 Mbps" sairia com uma
  fração disso e a limitação de banda não forçaria o ABR a descer. Medido: 0,91 / 2,57 / 5,0 Mbps.

## D3. Cache LRU por bytes, em memória, com coalescência de MISS

- **O quê:** `Map` do JS como lista LRU (ordem de inserção), limite em bytes (`CACHE_MAX_MB`);
  requisições simultâneas ao mesmo objeto ausente compartilham uma única busca na origem.
- **Alternativas:** limite por número de itens; cache em disco; `nginx proxy_cache`/Varnish.
- **Por quê:** segmentos variam ~6× de tamanho entre qualidades, então só o limite em bytes
  controla a memória. Coalescência evita o *thundering herd* na origem com cache frio sob carga
  (N clientes no mesmo segmento → 1 busca). Implementação própria deixa o comportamento
  observável (`/stats`, `X-Cache`) e explicável. Conteúdo VOD é imutável → sem invalidação.

## D4. Hashing consistente com nós virtuais no router

- **O quê:** anel MD5 de 32 bits, 100 nós virtuais por edge; chave = caminho do segmento;
  `lookup()` devolve a lista de preferência (dono + sucessores distintos no anel).
- **Alternativas:** `hash(chave) % N`; round-robin; rendezvous hashing (HRW).
- **Por quê:** cada segmento fica cacheado em um só edge (o cache agregado é a soma dos edges, sem
  duplicação, ao contrário do round-robin). Na queda de um edge, só as chaves **dele** mudam de
  dono (verificado: 84/270 chaves, todas do edge removido); com `% N` quase tudo remaparia e todos
  os caches esfriariam. Nós virtuais equilibram a carga (fatias 35,6 / 32,3 / 32,1%).
  O anel nunca muda: um edge fora do ar é apenas **pulado** no lookup, o que dá o mesmo efeito de
  removê-lo e torna a volta trivial.

## D5. Router em modo proxy com failover na mesma requisição

- **O quê:** o router busca o segmento inteiro no edge e repassa; se o edge falhar
  (erro de rede/timeout) tenta o próximo do anel antes de responder. 5xx de um edge vivo também
  dispara nova tentativa (outro edge pode ter o objeto em cache, p.ex. com a origem fora).
- **Alternativas:** redirecionamento HTTP 302 para o edge; roteamento por DNS; o player escolher
  o edge.
- **Por quê:** failover **transparente** ao cliente — como nada foi enviado ainda, dá para tentar
  outro edge. Também permite medir tudo num ponto só.
- **Custo (medido no experimento de vazão):** o router vira gargalo e ponto único de falha.
  Com 20 clientes, 3 edges atrás do router entregam ~300 req/s com o router a ~160% de CPU e os
  edges a ~8%; um único edge acessado direto entrega ~470 req/s. CDNs reais evitam isso com DNS
  ou anycast (o cliente fala direto com o edge). Ver Limitações.

## D6. Detecção de falha em duas camadas (passiva + ativa)

- **O quê:** *passiva* — falha numa requisição real marca o edge como `SUSPECT` (deixa de receber
  tráfego imediatamente); *ativa* — `GET /health` a cada `HEALTH_INTERVAL_MS` (1 s), timeout de
  500 ms; `HEALTH_FAILS` (2) falhas seguidas → `DOWN`; 1 sucesso → `UP`.
- **Alternativas:** só health check; heartbeat enviado pelos edges; gossip entre edges.
- **Por quê:** a passiva reage na escala do tráfego (~100 ms medidos); a ativa confirma, detecta
  falhas sem tráfego e detecta a **volta** do edge. 2 falhas seguidas evitam marcar DOWN por um
  timeout isolado; o custo é ~2 s para confirmar.
- **Observação:** contêiner morto não recusa conexão — o IP some e o SYN fica sem resposta, então
  a detecção ativa é sempre por timeout. Falhas reais tendem a ser silêncio, não erro explícito.

## D7. DNS em cache + coalescido no cliente HTTP do router (correção de falha em cascata)

- **Problema encontrado no experimento de queda:** com o edge2 morto, `dns.lookup("edge2")`
  demora ~5 s (`EAI_AGAIN`) no DNS do Docker. No Node, `dns.lookup` roda no threadpool do libuv
  (4 threads) e o `AbortSignal` do fetch **não** cancela a consulta. Cada health check deixava
  uma thread presa → threadpool esgotado → até as conexões com edge1/edge3 (saudáveis) travavam,
  davam timeout e eram marcadas `SUSPECT`. Resultado: 18 erros e p95 de 8 s nas requisições
  afetadas (`results/failover-kill-on-antes-fix-dns/`).
- **O quê:** `lookup` próprio (`dnscache.js`) injetado num `Agent` do undici: cache de 2 s e no
  máximo 1 consulta em andamento por hostname.
- **Alternativas:** aumentar `UV_THREADPOOL_SIZE` (só adia o problema); resolver para IP fixo
  (quebra quando o contêiner volta com outro IP); `dns.resolve4` (não lê `/etc/hosts`, necessário
  para `host.docker.internal` no modo 2 máquinas).
- **Por quê:** um nó morto passa a prender no máximo 1 thread. Depois da correção: 0 erros e p95
  das afetadas igual ao normal (73 ms). É um exemplo de falha parcial que se propaga por um
  recurso compartilhado oculto — o tipo de problema que só aparece com injeção de falhas.

## D8. Tudo configurável por ambiente; nenhum endereço fixo no código

- **O quê:** `EDGES`, `ORIGIN_URL`, `HEALTH_*`, `EDGE_TIMEOUT_MS`, `FAILOVER`, `CACHE_MAX_MB`,
  `ORIGIN_DELAY_MS`…
- **Por quê:** o mesmo código roda numa máquina (nomes DNS do compose) ou em duas (túnel SSH,
  `host.docker.internal`). `FAILOVER=off` permite o grupo de controle do experimento.

## D9. Métricas: logs JSONL + instante da injeção registrado pelos scripts de caos

- **O quê:** todos os serviços logam JSON Lines com `ts` (epoch ms); o router grava mudanças de
  estado em `results/router-events.jsonl`; o player envia eventos para `POST /events`; cada
  script de caos grava `t0` em `chaos-events.jsonl`. `analyze.js` cruza os três.
- **Por quê:** tempo de detecção = 1º evento de estado − t0; tempo de recuperação = 1ª resposta
  OK via failover − t0. Tudo na mesma máquina → relógios coerentes.

## D10. Injeção de banda limitada só no tráfego ao cliente (plano de controle separado)

- **Problema encontrado no experimento de ABR:** `tc netem rate 1500kbit` na interface inteira do
  router pôs os health checks na mesma fila do vídeo. A fila do netem (1000 pacotes) a 1,5 Mbps
  acumula segundos de espera (*bufferbloat*); os health checks estouraram o timeout de 500 ms e o
  router marcou edges saudáveis como DOWN 6 vezes (`results/abr-sem-filtro/`).
- **O quê:** `SPORT=8000 scripts/chaos/netem.sh router …` usa um qdisc `prio` com filtro `u32`
  que aplica o netem só aos pacotes com porta de origem 8000 (respostas do router ao cliente).
- **Alternativas:** aumentar o timeout do health check (mascara o problema e atrasa a detecção
  real); limitar a banda no host/navegador (não reprodutível por script).
- **Por quê:** simula o gargalo onde ele existe de fato (o "último quilômetro" do cliente) e
  mantém o plano de controle fora da fila do plano de dados — 0 mudanças falsas depois.

## D11. Hierarquia de timeouts + disjuntor da origem no edge

- **Problema encontrado no cenário de origem fora do ar:** o edge esperava a origem por 5 s, mas
  o router só esperava o edge por 4 s. O router desistia antes, culpava o edge (saudável) com
  `SUSPECT` e tentava o próximo, que também esperava: 502 só após 8–12 s e um falso SUSPECT por
  requisição.
- **O quê:** `ORIGIN_TIMEOUT_MS` = 2000 no edge (< `EDGE_TIMEOUT_MS` = 4000 no router); após uma
  falha de rede na origem, o edge abre um disjuntor por `ORIGIN_BREAKER_MS` (3 s) e responde 502 na
  hora aos MISS seguintes. A 1ª requisição depois do intervalo volta a testar a origem.
- **Por quê:** regra geral de sistemas em camadas — **o timeout de cada salto interno deve ser
  menor que o do externo**; caso contrário, o nível de cima não distingue "o edge morreu" de "o edge
  está esperando a origem". Com a correção, o edge devolve um 502 explícito (resposta, não
  silêncio), o router trata como 5xx de edge vivo, e não há mudanças de estado falsas.
- **Custo:** um MISS com a origem fora ainda leva 2–6 s porque o router tenta os 3 edges (algum
  pode ter o segmento em cache); o disjuntor é por edge, não compartilhado.

## D12. Abortar requisições em andamento quando um edge sai de UP

- **Problema encontrado no ensaio da demo:** um segmento que já estava sendo buscado no edge2 no
  instante do `docker kill` levou **4047 ms** (2 tentativas). O IP do contêiner morto some, sem
  RST, e a requisição ficou parada até o `EDGE_TIMEOUT_MS` (4 s), embora o router já tivesse marcado
  o edge2 como DOWN ~2 s antes. O buffer do player absorveu, mas era um atraso evitável.
- **O quê:** cada tentativa usa um `AbortController` registrado no edge (`edge.inflight`). Quando o
  edge vai para `SUSPECT` ou `DOWN`, o router aborta todas as tentativas pendentes, e elas seguem
  para o próximo do anel.
- **Alternativas:** um timeout menor por tentativa (penaliza edges só lentos, ex.: com netem);
  enviar a mesma requisição a dois edges ao mesmo tempo (*hedged requests*, que dobra a carga).
- **Por quê:** a detecção passa a servir também às requisições que já estavam em andamento. Teste:
  20 clientes a toda velocidade em 1080p com `docker kill edge2` no meio → 3852 requisições,
  **0 erros**, a requisição com failover mais lenta levou **199 ms**, e as requisições pendentes
  no edge2 foram abortadas e redirecionadas em 4–11 ms. Custo: um `SUSPECT` falso também aborta
  transferências saudáveis, que vão para outro edge (MISS).

## Limitações conhecidas

- Router centralizado: gargalo de vazão (~300 req/s nesta máquina) e ponto único de falha.
- Cache só em memória: edge reiniciado volta frio.
- Sem replicação de conteúdo entre edges: cada segmento tem um único dono no anel; na falha, o
  substituto busca na origem (MISS). Com origem também fora, os segmentos do edge caído ficam
  indisponíveis.
- Experimentos numa única máquina: loadgen, router, edges e origem competem pela mesma CPU; a
  latência de rede é artificial (`ORIGIN_DELAY_MS`, `tc netem`).
