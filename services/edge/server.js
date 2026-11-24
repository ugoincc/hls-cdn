// edge: proxy reverso com cache LRU em memória. HIT → responde da memória;
// MISS → busca na origem, guarda e responde. Requisições simultâneas ao mesmo
// objeto ausente são coalescidas (uma única busca na origem).
import http from 'node:http';
import { LRUCache } from './lru.js';

const PORT = Number(process.env.PORT ?? 8081);
const EDGE_ID = process.env.EDGE_ID ?? `edge-${PORT}`;
const ORIGIN_URL = (process.env.ORIGIN_URL ?? 'http://origin:8080').replace(/\/$/, '');
const CACHE_MAX_MB = Number(process.env.CACHE_MAX_MB ?? 256);
// Deve ser MENOR que o EDGE_TIMEOUT_MS do router (4000): senão o router desiste antes e culpa o
// edge (saudável) por uma falha que é da origem.
const ORIGIN_TIMEOUT_MS = Number(process.env.ORIGIN_TIMEOUT_MS ?? 2000);
// Disjuntor: após uma falha de rede na origem, os MISS falham na hora por este tempo
// (em vez de cada um esperar o timeout). A 1ª requisição depois do intervalo testa a origem.
const ORIGIN_BREAKER_MS = Number(process.env.ORIGIN_BREAKER_MS ?? 3000);
let originDownUntil = 0;

const cache = new LRUCache(CACHE_MAX_MB * 1024 * 1024);
const inflight = new Map(); // key -> Promise<entry>
const stats = { hits: 0, misses: 0, coalesced: 0, originErrors: 0, bytesServed: 0, bytesFromOrigin: 0 };
const startedAt = Date.now();

const log = (o) => process.stdout.write(JSON.stringify({ ts: Date.now(), service: 'edge', edge: EDGE_ID, ...o }) + '\n');

async function fetchFromOrigin(key) {
  if (Date.now() < originDownUntil) throw new Error('origin unavailable (breaker open)');
  const t0 = performance.now();
  let r;
  try {
    r = await fetch(ORIGIN_URL + key, { signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS) });
  } catch (err) {
    originDownUntil = Date.now() + ORIGIN_BREAKER_MS; // erro de rede/timeout → abre o disjuntor
    throw err;
  }
  originDownUntil = 0;
  if (!r.ok) {
    const err = new Error(`origin status ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const body = Buffer.from(await r.arrayBuffer());
  stats.bytesFromOrigin += body.length;
  return {
    body,
    contentType: r.headers.get('content-type') ?? 'application/octet-stream',
    originMs: +(performance.now() - t0).toFixed(1),
  };
}

function getOrFetch(key) {
  let p = inflight.get(key);
  if (p) {
    stats.coalesced++;
    return p;
  }
  p = fetchFromOrigin(key)
    .then((entry) => {
      cache.set(key, entry);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'x-edge-id': EDGE_ID });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const t0 = performance.now();
  const key = new URL(req.url, 'http://x').pathname;

  if (key === '/health') return json(res, 200, { ok: true, edge: EDGE_ID, uptimeMs: Date.now() - startedAt });
  if (key === '/stats') {
    const total = stats.hits + stats.misses;
    return json(res, 200, {
      edge: EDGE_ID,
      ...stats,
      hitRatio: total ? +(stats.hits / total).toFixed(4) : null,
      cacheItems: cache.size,
      cacheBytes: cache.bytes,
      cacheMaxBytes: cache.maxBytes,
      evictions: cache.evictions,
      uptimeMs: Date.now() - startedAt,
    });
  }
  if (key === '/cache/clear' && req.method === 'POST') {
    cache.clear();
    for (const k of Object.keys(stats)) stats[k] = 0;
    log({ event: 'cache_cleared' });
    return json(res, 200, { ok: true });
  }
  if (!key.startsWith('/hls/')) return json(res, 404, { error: 'not found' });

  let entry = cache.get(key);
  let cacheStatus = 'HIT';
  let status = 200;
  let originMs;

  if (entry) {
    stats.hits++;
  } else {
    cacheStatus = 'MISS';
    stats.misses++;
    try {
      entry = await getOrFetch(key);
      originMs = entry.originMs;
    } catch (err) {
      stats.originErrors++;
      // 404 da origem é repassado; qualquer outra falha (queda, timeout) vira 502.
      status = err.status === 404 ? 404 : 502;
      res.writeHead(status, { 'x-edge-id': EDGE_ID, 'x-cache': 'MISS', 'content-type': 'text/plain' });
      res.end(`origin error: ${err.message}`);
      log({ path: key, cache: cacheStatus, status, bytes: 0, ms: +(performance.now() - t0).toFixed(1), error: err.message });
      return;
    }
  }

  stats.bytesServed += entry.body.length;
  res.writeHead(status, {
    'content-type': entry.contentType,
    'content-length': entry.body.length,
    'x-edge-id': EDGE_ID,
    'x-cache': cacheStatus,
  });
  res.end(entry.body);
  log({ path: key, cache: cacheStatus, status, bytes: entry.body.length, ms: +(performance.now() - t0).toFixed(1), originMs });
});

server.listen(PORT, () => log({ event: 'listening', port: PORT, origin: ORIGIN_URL, cacheMaxMB: CACHE_MAX_MB }));
