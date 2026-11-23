// origin: servidor de arquivos estáticos HLS. É a "fonte da verdade" do conteúdo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = path.resolve(process.env.CONTENT_DIR ?? '/srv/hls');
const DELAY_MS = Number(process.env.ORIGIN_DELAY_MS ?? 0); // atraso artificial (evidencia o ganho do cache)
const SERVICE = process.env.SERVICE_NAME ?? 'origin';

const TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

const log = (o) => process.stdout.write(JSON.stringify({ ts: Date.now(), service: SERVICE, ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  const t0 = performance.now();
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: SERVICE }));
  }

  // Conteúdo fica em /hls/...; impede path traversal resolvendo e conferindo o prefixo.
  if (!url.pathname.startsWith('/hls/')) {
    res.writeHead(404);
    return res.end();
  }
  const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname.slice(4)));
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end();
  }

  if (DELAY_MS > 0) await sleep(DELAY_MS);

  fs.readFile(file, (err, data) => {
    const status = err ? 404 : 200;
    if (err) {
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'content-length': data.length,
        'cache-control': 'public, max-age=3600',
      });
      res.end(data);
    }
    log({ path: url.pathname, status, bytes: data?.length ?? 0, ms: +(performance.now() - t0).toFixed(1) });
  });
});

server.listen(PORT, () => log({ event: 'listening', port: PORT, root: ROOT, delayMs: DELAY_MS }));
