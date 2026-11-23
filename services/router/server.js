// router: ponto de entrada dos clientes. Escolhe o edge por hashing consistente,
// faz proxy da requisição e, se o edge falhar, tenta o próximo do anel na mesma
// requisição (failover transparente). Mantém o estado dos edges com health check
// ativo + detecção passiva. Também serve o player e recebe as métricas dele.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch, Agent, setGlobalDispatcher } from 'undici';
import { HashRing } from './hashring.js';
import { cachedLookup } from './dnscache.js';

// Cliente HTTP com DNS em cache + coalescido (ver dnscache.js: evita que um edge
// morto esgote o threadpool do libuv e trave as conexões com os edges saudáveis).
setGlobalDispatcher(new Agent({ connect: { lookup: cachedLookup } }));

const PORT = Number(process.env.PORT ?? 8000);
const HEALTH_INTERVAL_MS = Number(process.env.HEALTH_INTERVAL_MS ?? 1000);
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS ?? 500);
const HEALTH_FAILS = Number(process.env.HEALTH_FAILS ?? 2);
const EDGE_TIMEOUT_MS = Number(process.env.EDGE_TIMEOUT_MS ?? 4000);
const VNODES = Number(process.env.VNODES ?? 100);
const FAILOVER = (process.env.FAILOVER ?? 'on') !== 'off'; // permite comparar com/sem failover
const RESULTS_DIR = process.env.RESULTS_DIR ?? '/results';
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// EDGES=edge1=http://edge1:8081,edge2=http://edge2:8082,...
const edges = new Map(
  (process.env.EDGES ?? 'edge1=http://edge1:8081,edge2=http://edge2:8082,edge3=http://edge3:8083')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, url] = s.split(/=(.*)/s);
      return [id, { id, url: url.replace(/\/$/, ''), state: 'UP', fails: 0, lastChange: Date.now(), healthMs: null, served: 0, failures: 0, checking: false }];
    }),
);
const ring = new HashRing([...edges.keys()], VNODES);
const ownership = ring.ownership();

fs.mkdirSync(RESULTS_DIR, { recursive: true });
const routerEventsFile = path.join(RESULTS_DIR, 'router-events.jsonl');
const playerEventsFile = path.join(RESULTS_DIR, 'player-events.jsonl');

const log = (o) => process.stdout.write(JSON.stringify({ ts: Date.now(), service: 'router', ...o }) + '\n');

// Mudanças de estado são o dado-chave para medir tempo de detecção/recuperação.
function setState(edge, to, reason) {
  if (edge.state === to) return;
  const ev = { ts: Date.now(), service: 'router', event: 'edge_state', edge: edge.id, from: edge.state, to, reason };
  edge.state = to;
  edge.lastChange = ev.ts;
  process.stdout.write(JSON.stringify(ev) + '\n');
  fs.appendFile(routerEventsFile, JSON.stringify(ev) + '\n', () => {});
}

// ---------- health check ativo ----------
async function checkEdge(edge) {
  if (edge.checking) return; // evita checagens sobrepostas se o edge estiver lento
  edge.checking = true;
  const t0 = performance.now();
  try {
    const r = await fetch(edge.url + '/health', { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    await r.arrayBuffer();
    edge.healthMs = +(performance.now() - t0).toFixed(1);
    edge.fails = 0;
    setState(edge, 'UP', 'health_ok');
  } catch (err) {
    edge.healthMs = null;
    edge.fails++;
    if (edge.fails >= HEALTH_FAILS) setState(edge, 'DOWN', `health_fail x${edge.fails}: ${err.cause?.code ?? err.name}`);
  } finally {
    edge.checking = false;
  }
}
setInterval(() => edges.forEach(checkEdge), HEALTH_INTERVAL_MS);
edges.forEach(checkEdge);

// ---------- proxy com failover ----------
async function proxy(req, res, key) {
  const t0 = performance.now();
  const preference = ring.lookup(key).map((id) => edges.get(id));
  const primary = preference[0];
  // Pula edges que não estão UP; se nenhum estiver, tenta todos (último recurso).
  let candidates = preference.filter((e) => e.state === 'UP');
  if (!candidates.length) candidates = preference;
  if (!FAILOVER) candidates = [primary];

  const tried = [];
  for (const edge of candidates) {
    const ta = performance.now();
    try {
      const r = await fetch(edge.url + key, { signal: AbortSignal.timeout(EDGE_TIMEOUT_MS) });
      const body = Buffer.from(await r.arrayBuffer());
      if (r.status >= 500) {
        // edge vivo, mas não conseguiu servir (ex.: origem fora + MISS) → outro edge pode ter em cache
        tried.push({ edge: edge.id, status: r.status, ms: +(performance.now() - ta).toFixed(1) });
        continue;
      }
      edge.served++;
      const failover = tried.length > 0 || edge !== primary;
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store', // o navegador não deve cachear: queremos ver o edge em cada pedido
        'x-edge-id': edge.id,
        'x-cache': r.headers.get('x-cache') ?? '-',
        'x-router-attempts': String(tried.length + 1),
        'x-failover': failover ? '1' : '0',
        'access-control-expose-headers': 'x-edge-id, x-cache, x-router-attempts, x-failover',
      });
      res.end(body);
      log({ path: key, edge: edge.id, primary: primary.id, cache: r.headers.get('x-cache'), status: r.status, bytes: body.length, ms: +(performance.now() - t0).toFixed(1), attempts: tried.length + 1, failover, tried: tried.length ? tried : undefined });
      return;
    } catch (err) {
      // erro de rede/timeout → suspeita passiva; o health check confirma (DOWN) ou absolve (UP)
      edge.failures++;
      if (edge.state === 'UP') setState(edge, 'SUSPECT', `request_fail: ${err.cause?.code ?? err.name}`);
      tried.push({ edge: edge.id, error: err.cause?.code ?? err.name, ms: +(performance.now() - ta).toFixed(1) });
    }
  }

  res.writeHead(502, { 'content-type': 'text/plain', 'x-router-attempts': String(tried.length) });
  res.end('all edges failed');
  log({ path: key, edge: null, primary: primary?.id, status: 502, bytes: 0, ms: +(performance.now() - t0).toFixed(1), attempts: tried.length, failover: true, tried });
}

// ---------- status (consumido pelo painel) ----------
async function status(res) {
  const list = await Promise.all(
    [...edges.values()].map(async (e) => {
      let stats = null;
      if (e.state !== 'DOWN') {
        try {
          const r = await fetch(e.url + '/stats', { signal: AbortSignal.timeout(300) });
          stats = await r.json();
        } catch {}
      }
      const { checking, ...pub } = e;
      return { ...pub, ringShare: +ownership[e.id].toFixed(4), stats };
    }),
  );
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ ts: Date.now(), vnodes: VNODES, failover: FAILOVER, healthIntervalMs: HEALTH_INTERVAL_MS, healthFails: HEALTH_FAILS, edges: list }));
}

// ---------- eventos do player ----------
function events(req, res) {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > 1_000_000) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString() || '[]');
      const arr = Array.isArray(data) ? data : [data];
      const now = Date.now();
      fs.appendFile(playerEventsFile, arr.map((e) => JSON.stringify({ tsServer: now, ...e })).join('\n') + '\n', () => {});
      res.writeHead(204);
      res.end();
    } catch {
      res.writeHead(400);
      res.end();
    }
  });
}

// ---------- arquivos estáticos do player ----------
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serveStatic(res, pathname) {
  const file = path.resolve(PUBLIC_DIR, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': STATIC_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname.startsWith('/hls/')) return proxy(req, res, pathname);
    if (pathname === '/status') return status(res);
    if (pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (pathname === '/events' && req.method === 'POST') return events(req, res);
    if (req.method === 'GET') return serveStatic(res, pathname);
    res.writeHead(405);
    res.end();
  })
  .listen(PORT, () => log({ event: 'listening', port: PORT, edges: [...edges.values()].map((e) => `${e.id}=${e.url}`), vnodes: VNODES, ownership }));
