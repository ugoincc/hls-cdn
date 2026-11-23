#!/usr/bin/env node
// Gerador de carga: N clientes HLS headless concorrentes.
// Cada cliente lê a playlist de uma qualidade e baixa os segmentos em sequência.
//   --paced  → no ritmo do vídeo (1 segmento a cada EXTINF s), como um player real
//   (padrão) → o mais rápido possível, para medir vazão máxima
// Uso: node scripts/loadgen.js --clients 10 --duration 30 --level 720p --out results/x/requests.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8000' },
    clients: { type: 'string', default: '5' },
    duration: { type: 'string', default: '30' },
    level: { type: 'string', default: '720p' },
    start: { type: 'string', default: 'random' }, // random | zero (todos no mesmo trecho = conteúdo "quente")
    paced: { type: 'boolean', default: false },
    out: { type: 'string' },
    timeout: { type: 'string', default: '10000' },
    label: { type: 'string', default: '' },
  },
});
const N = Number(o.clients), DUR = Number(o.duration) * 1000, TIMEOUT = Number(o.timeout);
const base = o.url.replace(/\/$/, '');

let out = null;
if (o.out) {
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  out = fs.createWriteStream(o.out, { flags: 'a' });
}

async function getPlaylist() {
  const txt = await (await fetch(`${base}/hls/${o.level}/index.m3u8`)).text();
  const segs = [];
  let dur = 2;
  for (const line of txt.split('\n')) {
    if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
    else if (line && !line.startsWith('#')) segs.push({ uri: `/hls/${o.level}/${line.trim()}`, dur });
  }
  return segs;
}

const records = [];
async function client(id, segs, endAt) {
  let i = o.start === 'zero' ? 0 : Math.floor(Math.random() * segs.length);
  while (Date.now() < endAt) {
    const seg = segs[i % segs.length];
    const t0 = performance.now();
    const ts = Date.now();
    const rec = { ts, client: id, path: seg.uri };
    try {
      const r = await fetch(base + seg.uri, { signal: AbortSignal.timeout(TIMEOUT) });
      rec.ttfbMs = +(performance.now() - t0).toFixed(1);
      const body = await r.arrayBuffer();
      Object.assign(rec, {
        status: r.status,
        bytes: body.byteLength,
        edge: r.headers.get('x-edge-id'),
        cache: r.headers.get('x-cache'),
        attempts: Number(r.headers.get('x-router-attempts') ?? 1),
        failover: r.headers.get('x-failover') === '1',
      });
    } catch (err) {
      Object.assign(rec, { status: 0, bytes: 0, error: err.cause?.code ?? err.name });
    }
    rec.ms = +(performance.now() - t0).toFixed(1);
    records.push(rec);
    out?.write(JSON.stringify(rec) + '\n');
    i++;
    if (o.paced) {
      const wait = seg.dur * 1000 - rec.ms;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const segs = await getPlaylist();
const t0 = Date.now();
const endAt = t0 + DUR;
await Promise.all(Array.from({ length: N }, (_, k) => client(k, segs, endAt)));
const elapsed = (Date.now() - t0) / 1000;
out?.end();

const ok = records.filter((r) => r.status === 200);
const lat = ok.map((r) => r.ms);
const bytes = ok.reduce((a, r) => a + r.bytes, 0);
const hits = ok.filter((r) => r.cache === 'HIT').length;
const byEdge = {};
for (const r of ok) byEdge[r.edge] = (byEdge[r.edge] ?? 0) + 1;
const summary = {
  label: o.label,
  clients: N, level: o.level, paced: o.paced, seconds: +elapsed.toFixed(1),
  requests: records.length, ok: ok.length, errors: records.length - ok.length,
  reqPerSec: +(records.length / elapsed).toFixed(1),
  mbps: +((bytes * 8) / elapsed / 1e6).toFixed(1),
  p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99),
  hitRatio: ok.length ? +(hits / ok.length).toFixed(3) : null,
  failovers: ok.filter((r) => r.failover).length,
  byEdge,
};
console.log(JSON.stringify(summary));
