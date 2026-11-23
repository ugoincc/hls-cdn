#!/usr/bin/env node
// Análise dos experimentos: JSONL bruto → CSV + summary.md
// Uso: node scripts/analyze.js <tipo> <dir>
//   tipo: load (vazão/latência) | failover (queda e volta de edge) | player (eventos do navegador)
import fs from 'node:fs';
import path from 'node:path';

const [kind, dir] = process.argv.slice(2);
if (!kind || !dir) {
  console.error('uso: analyze.js <load|failover|player> <dir>');
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export const readJsonl = (f) =>
  fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const latStats = (rs) => {
  const l = rs.map((r) => r.ms);
  return { n: rs.length, p50: r1(pct(l, 50)), p95: r1(pct(l, 95)), p99: r1(pct(l, 99)), max: r1(Math.max(...l, 0)) };
};
const toCsv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n') + '\n';
};
const mdTable = (rows) => {
  if (!rows.length) return '_sem dados_\n';
  const cols = Object.keys(rows[0]);
  return `| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n` + rows.map((r) => `| ${cols.map((c) => r[c] ?? '–').join(' | ')} |`).join('\n') + '\n';
};
const write = (name, content) => {
  fs.writeFileSync(path.join(dir, name), content);
  console.log(`→ ${path.join(dir, name)}`);
};

// série temporal por segundo, relativa a t0
function timeline(reqs, t0) {
  const buckets = new Map();
  for (const r of reqs) {
    const s = Math.floor((r.ts + r.ms - t0) / 1000);
    if (!buckets.has(s)) buckets.set(s, []);
    buckets.get(s).push(r);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((s) => {
      const b = buckets.get(s);
      const ok = b.filter((r) => r.status === 200);
      const row = { t: s, requests: b.length, errors: b.length - ok.length, failovers: ok.filter((r) => r.failover).length };
      row.hitRatio = ok.length ? +(ok.filter((r) => r.cache === 'HIT').length / ok.length).toFixed(3) : '';
      row.p50 = r1(pct(ok.map((r) => r.ms), 50));
      row.p95 = r1(pct(ok.map((r) => r.ms), 95));
      for (const e of ['edge1', 'edge2', 'edge3']) row[e] = ok.filter((r) => r.edge === e).length;
      return row;
    });
}

// ---------------------------------------------------------------------------
if (kind === 'load') {
  // dir contém runs/*.jsonl (um por configuração) + runs.jsonl com o resumo do loadgen
  const runs = readJsonl(path.join(dir, 'runs.jsonl'));
  const rows = runs.map((r) => ({
    cenário: r.label, clientes: r.clients, 'req/s': r.reqPerSec, Mbps: r.mbps, 'p50 (ms)': r.p50, 'p95 (ms)': r.p95, 'p99 (ms)': r.p99,
    'hit ratio': r.hitRatio ?? '–', erros: r.errors,
  }));
  write('summary.csv', toCsv(rows));
  // HIT vs MISS: latência separada
  const all = fs.readdirSync(path.join(dir, 'runs')).flatMap((f) => readJsonl(path.join(dir, 'runs', f)).filter((r) => r.status === 200));
  const hm = ['HIT', 'MISS'].map((c) => ({ cache: c, ...latStats(all.filter((r) => r.cache === c)) }));
  write('summary.md', `# Experimento: vazão e latência\n\n${mdTable(rows)}\n## Latência por resultado de cache (todas as execuções via router)\n\n${mdTable(hm)}`);
}

// ---------------------------------------------------------------------------
if (kind === 'failover') {
  const reqs = readJsonl(path.join(dir, 'requests.jsonl'));
  const chaos = readJsonl(path.join(dir, 'chaos-events.jsonl'));
  const tStart = Math.min(...reqs.map((r) => r.ts));
  const tEnd = Math.max(...reqs.map((r) => r.ts + r.ms));
  const routerEv = readJsonl(path.join(ROOT, 'results', 'router-events.jsonl')).filter((e) => e.ts >= tStart - 1000 && e.ts <= tEnd + 5000);
  write('router-events.jsonl', routerEv.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const kill = chaos.find((c) => /^edge_(kill|stop)$|^partition_on$/.test(c.action));
  const revive = chaos.find((c) => /^edge_start$|^partition_off$/.test(c.action) && c.ts > (kill?.ts ?? 0));
  const target = kill?.target;
  const lines = [`# Experimento: ${kill?.action ?? '?'} de ${target ?? '?'}\n`];

  if (kill) {
    const t0 = kill.ts;
    const ev = routerEv.filter((e) => e.edge === target && e.ts >= t0);
    const firstDetect = ev.find((e) => e.to === 'SUSPECT' || e.to === 'DOWN');
    const down = ev.find((e) => e.to === 'DOWN');
    const after = reqs.filter((r) => r.ts + r.ms >= t0 && (!revive || r.ts < revive.ts));
    const firstFo = after.filter((r) => r.status === 200 && r.failover).sort((a, b) => a.ts + a.ms - (b.ts + b.ms))[0];
    const affected = after.filter((r) => r.failover || r.status !== 200);
    const errs = after.filter((r) => r.status !== 200);
    const before = reqs.filter((r) => r.ts + r.ms < t0 && r.status === 200);
    const hr = (rs) => (rs.length ? +(rs.filter((r) => r.cache === 'HIT').length / rs.length).toFixed(3) : null);

    const m = [
      { métrica: 'detecção (1ª suspeita/queda no router)', valor: firstDetect ? `${firstDetect.ts - t0} ms (${firstDetect.to}, ${firstDetect.reason})` : '–' },
      { métrica: 'confirmação DOWN (health check)', valor: down ? `${down.ts - t0} ms` : '–' },
      { métrica: 'recuperação (1º segmento OK via failover)', valor: firstFo ? `${Math.round(firstFo.ts + firstFo.ms - t0)} ms` : '–' },
      { métrica: 'requisições com erro durante a falha', valor: `${errs.length} de ${after.length}` },
      { métrica: 'requisições afetadas (failover ou erro)', valor: affected.length },
      { métrica: 'latência das afetadas p50 / p95 / máx (ms)', valor: affected.length ? `${latStats(affected).p50} / ${latStats(affected).p95} / ${latStats(affected).max}` : '–' },
      { métrica: 'latência normal antes da falha p50 / p95 (ms)', valor: `${latStats(before).p50} / ${latStats(before).p95}` },
      { métrica: 'hit ratio antes → durante a falha', valor: `${hr(before)} → ${hr(after.filter((r) => r.status === 200))}` },
    ];
    if (revive) {
      const up = routerEv.find((e) => e.edge === target && e.to === 'UP' && e.ts >= revive.ts);
      m.push({ métrica: `volta: ${target} UP no router após religar`, valor: up ? `${up.ts - revive.ts} ms` : '–' });
      const back = reqs.filter((r) => r.edge === target && r.ts >= revive.ts && r.status === 200).sort((a, b) => a.ts - b.ts)[0];
      m.push({ métrica: `volta: 1º segmento servido de novo por ${target}`, valor: back ? `${Math.round(back.ts + back.ms - revive.ts)} ms (${back.cache})` : '–' });
    }
    lines.push(mdTable(m));
    const tl = timeline(reqs, t0);
    write('timeline.csv', toCsv(tl));
    lines.push(`\nInjeção em t=0${revive ? `; religado em t=${((revive.ts - t0) / 1000).toFixed(1)} s` : ''}. Série por segundo em \`timeline.csv\`.\n`);
    lines.push(`\n## Eventos de estado no router\n\n${mdTable(routerEv.filter((e) => e.event === 'edge_state').map((e) => ({ 't (ms)': e.ts - t0, edge: e.edge, de: e.from, para: e.to, motivo: e.reason })))}`);
  }
  write('summary.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
if (kind === 'player') {
  const evs = readJsonl(path.join(dir, 'player-events.jsonl'));
  const chaos = readJsonl(path.join(dir, 'chaos-events.jsonl'));
  const inj = chaos.find((c) => c.action !== 'reset') ?? chaos[0];
  const t0 = inj?.ts ?? Math.min(...evs.map((e) => e.ts));
  const rel = (ts) => +((ts - t0) / 1000).toFixed(1);
  const tMin = Math.min(...evs.map((e) => e.ts)), tMax = Math.max(...evs.map((e) => e.ts));
  const routerEv = readJsonl(path.join(ROOT, 'results', 'router-events.jsonl')).filter((e) => e.event === 'edge_state' && e.ts >= tMin && e.ts <= tMax);
  write('router-events.jsonl', routerEv.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const rows = [];
  for (const c of chaos) if (c.action !== 'reset') rows.push({ 't (s)': rel(c.ts), origem: 'caos', evento: `${c.action} ${c.target} ${c.detail}` });
  for (const e of routerEv) rows.push({ 't (s)': rel(e.ts), origem: 'router', evento: `${e.edge}: ${e.from} → ${e.to} (${e.reason})` });
  const clear = chaos.find((c) => c.action === 'netem_clear');
  const firstSwitchAfter = (ts) => evs.find((e) => e.type === 'level_switched' && e.ts > ts);
  for (const e of evs) {
    if (e.type === 'level_switched') rows.push({ 't (s)': rel(e.ts), origem: 'player', evento: `qualidade → ${e.height}p (banda est. ${Math.round(e.bwEstimate / 1000)} kbps)` });
    if (e.type === 'stall_start') rows.push({ 't (s)': rel(e.ts), origem: 'player', evento: 'STALL início' });
    if (e.type === 'stall_end') rows.push({ 't (s)': rel(e.ts), origem: 'player', evento: `STALL fim (${e.durationMs} ms)` });
    if (e.type === 'frag_loaded' && e.failover) rows.push({ 't (s)': rel(e.ts), origem: 'player', evento: `seg ${e.sn} via failover → ${e.edge}` });
    if (e.type === 'error') rows.push({ 't (s)': rel(e.ts), origem: 'player', evento: `erro ${e.details}${e.fatal ? ' FATAL' : ''}` });
  }
  rows.sort((a, b) => a['t (s)'] - b['t (s)']);
  const frags = evs.filter((e) => e.type === 'frag_loaded');
  const stalls = evs.filter((e) => e.type === 'stall_end');
  write('frags.csv', toCsv(frags.map((f) => ({ t: rel(f.ts), sn: f.sn, height: f.height, edge: f.edge, cache: f.cache, failover: f.failover, loadMs: f.loadMs, ttfbMs: f.ttfbMs, bytes: f.bytes, bwEstimate: f.bwEstimate }))));
  write('samples.csv', toCsv(evs.filter((e) => e.type === 'sample').map((s) => ({ t: rel(s.ts), buffer: s.buffer, bwEstimate: s.bwEstimate, level: s.level, stalled: s.stalled }))));
  const summary = [
    { métrica: 'segmentos carregados', valor: frags.length },
    { métrica: 'trocas de qualidade', valor: evs.filter((e) => e.type === 'level_switched').length },
    { métrica: 'stalls', valor: stalls.length },
    { métrica: 'tempo total travado', valor: `${stalls.reduce((a, s) => a + s.durationMs, 0)} ms` },
    { métrica: 'tempo de carga do segmento p50 / p95 (ms)', valor: `${pct(frags.map((f) => f.loadMs), 50)} / ${pct(frags.map((f) => f.loadMs), 95)}` },
  ];
  if (inj?.action === 'netem') {
    const down = firstSwitchAfter(inj.ts);
    summary.push({ métrica: 'tempo até baixar a qualidade após limitar a banda', valor: down ? `${((down.ts - inj.ts) / 1000).toFixed(1)} s (→ ${down.height}p)` : '–' });
    if (clear) {
      const up = firstSwitchAfter(clear.ts);
      summary.push({ métrica: 'tempo até subir a qualidade após liberar a banda', valor: up ? `${((up.ts - clear.ts) / 1000).toFixed(1)} s (→ ${up.height}p)` : '–' });
    }
    summary.push({ métrica: 'mudanças de estado de edges no router (falsos positivos)', valor: routerEv.length });
  }
  write('summary.md', `# Experimento: player (${path.basename(dir)})\n\n${mdTable(summary)}\n## Linha do tempo (t=0 na 1ª injeção)\n\n${mdTable(rows)}`);
}
