// Lookup DNS com cache curto + coalescência, para o cliente HTTP do router.
//
// Por quê: no Node, dns.lookup() (getaddrinfo) roda no threadpool do libuv (4 threads).
// Quando um contêiner morre, o DNS do Docker passa a demorar ~5 s para responder
// EAI_AGAIN sobre o nome dele. O AbortSignal do fetch cancela a requisição, mas NÃO
// a consulta DNS — então cada health check deixava uma thread presa, o threadpool
// esgotava e até a resolução dos edges SAUDÁVEIS travava (falha em cascata).
// Com coalescência, no máximo 1 consulta por hostname fica em andamento.
import dns from 'node:dns';

const TTL_MS = Number(process.env.DNS_TTL_MS ?? 2000);
const cache = new Map();    // hostname -> { address, family, ts }
const inflight = new Map(); // hostname -> [callbacks]

export function cachedLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const reply = (err, entry) => {
    if (err) return callback(err);
    // undici pode pedir { all: true } → array de endereços
    if (options?.all) callback(null, [{ address: entry.address, family: entry.family }]);
    else callback(null, entry.address, entry.family);
  };

  const hit = cache.get(hostname);
  if (hit && Date.now() - hit.ts < TTL_MS) return reply(null, hit);

  if (inflight.has(hostname)) return inflight.get(hostname).push(reply);
  inflight.set(hostname, [reply]);
  dns.lookup(hostname, { family: options?.family ?? 0 }, (err, address, family) => {
    const waiters = inflight.get(hostname);
    inflight.delete(hostname);
    if (!err) cache.set(hostname, { address, family, ts: Date.now() });
    else cache.delete(hostname);
    for (const w of waiters) w(err, { address, family });
  });
}
