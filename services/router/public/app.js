// Player hls.js + painel de métricas. Envia eventos para POST /events (JSONL em results/).
const params = new URLSearchParams(location.search);
const SESSION = params.get('session') ?? Math.random().toString(36).slice(2, 8);
const SRC = params.get('src') ?? '/hls/master.m3u8';
const MAX_BUFFER = Number(params.get('buffer') ?? 30); // segundos de buffer à frente (?buffer=10 deixa falhas mais visíveis)

const $ = (id) => document.getElementById(id);
const video = $('video');
$('session').textContent = `sessão ${SESSION}`;

// ---------- envio de eventos (em lote) ----------
let queue = [];
function emit(type, data = {}) {
  queue.push({ ts: Date.now(), session: SESSION, type, ...data });
}
function flush() {
  if (!queue.length) return;
  const body = JSON.stringify(queue);
  queue = [];
  fetch('/events', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
}
setInterval(flush, 2000);
addEventListener('pagehide', flush);

// ---------- log visual ----------
function ui(msg, cls = '') {
  const li = document.createElement('li');
  li.className = cls;
  li.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $('log').prepend(li);
  while ($('log').children.length > 60) $('log').lastChild.remove();
}

const edgeColor = (id) => (id ? `var(--${id}, var(--none))` : 'var(--none)');
const fmtBps = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(2)} Mbps` : `${Math.round(b / 1e3)} kbps`);

if (!Hls.isSupported()) {
  ui('hls.js não suportado neste navegador', 'err');
  throw new Error('hls.js unsupported');
}

const hls = new Hls({ maxBufferLength: MAX_BUFFER, maxMaxBufferLength: MAX_BUFFER * 2 });
hls.loadSource(SRC);
hls.attachMedia(video);

// ---------- seleção de qualidade (auto = ABR) ----------
function renderLevels() {
  const box = $('levels');
  box.innerHTML = '';
  const mk = (label, idx) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = hls.autoLevelEnabled ? (idx === -1 ? 'active' : '') : hls.nextLoadLevel === idx || hls.currentLevel === idx ? 'active' : '';
    b.onclick = () => {
      hls.currentLevel = idx; // -1 reativa o ABR
      emit('manual_level', { level: idx });
      ui(idx === -1 ? 'ABR automático' : `nível fixo: ${hls.levels[idx].height}p`);
      setTimeout(renderLevels, 50);
    };
    box.append(b);
  };
  mk('Auto', -1);
  hls.levels.forEach((l, i) => mk(`${l.height}p`, i));
}

hls.on(Hls.Events.MANIFEST_PARSED, (_, d) => {
  renderLevels();
  emit('manifest', { levels: d.levels.map((l) => ({ height: l.height, bitrate: l.bitrate })) });
  ui(`manifest: ${d.levels.map((l) => l.height + 'p').join(', ')}`);
});

let switches = 0;
hls.on(Hls.Events.LEVEL_SWITCHED, (_, d) => {
  const l = hls.levels[d.level];
  switches++;
  $('m-level').textContent = `${l.height}p`;
  $('m-switches').textContent = switches;
  emit('level_switched', { level: d.level, height: l.height, bitrate: l.bitrate, bwEstimate: Math.round(hls.bandwidthEstimate), auto: hls.autoLevelEnabled });
  ui(`qualidade → ${l.height}p (${fmtBps(l.bitrate)})`, 'ok');
  renderLevels();
});

// ---------- segmentos: qual edge serviu, HIT/MISS, tempos ----------
const header = (nd, name) => nd?.getResponseHeader?.(name) ?? nd?.headers?.get?.(name) ?? null;
hls.on(Hls.Events.FRAG_LOADED, (_, d) => {
  const { frag, networkDetails: nd } = d;
  if (frag.type !== 'main') return;
  const s = frag.stats;
  const edge = header(nd, 'x-edge-id');
  const cache = header(nd, 'x-cache');
  const attempts = Number(header(nd, 'x-router-attempts') ?? 1);
  const failover = header(nd, 'x-failover') === '1';
  const ev = {
    sn: frag.sn,
    level: frag.level,
    height: hls.levels[frag.level]?.height,
    edge,
    cache,
    attempts,
    failover,
    bytes: s.total,
    ttfbMs: Math.round(s.loading.first - s.loading.start),
    loadMs: Math.round(s.loading.end - s.loading.start),
    bwEstimate: Math.round(hls.bandwidthEstimate),
  };
  emit('frag_loaded', ev);

  $('m-edge').textContent = edge ?? '–';
  $('m-edge').style.color = edgeColor(edge);
  $('m-cache').textContent = cache ?? '–';

  const seg = document.createElement('div');
  seg.className = `seg ${cache ?? ''} ${failover ? 'fo' : ''}`;
  seg.style.setProperty('--c', edgeColor(edge));
  seg.title = `seg ${frag.sn} · ${ev.height}p · ${edge} · ${cache} · ${ev.loadMs} ms`;
  $('strip').append(seg);
  while ($('strip').children.length > 60) $('strip').firstChild.remove();

  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${new Date().toLocaleTimeString()}</td><td>${frag.sn}</td><td>${ev.height}p</td>
    <td style="color:${edgeColor(edge)}">${edge}</td><td>${cache}</td><td class="${failover ? 'fo' : ''}">${attempts}${failover ? ' ⚠' : ''}</td>
    <td>${ev.ttfbMs} ms</td><td>${ev.loadMs} ms</td><td>${Math.round(s.total / 1024)}</td>`;
  $('frags').tBodies[0].prepend(tr);
  while ($('frags').tBodies[0].children.length > 15) $('frags').tBodies[0].lastChild.remove();

  if (failover) ui(`seg ${frag.sn}: failover → ${edge} (${attempts} tentativa(s))`, 'warn');
});

// ---------- erros ----------
hls.on(Hls.Events.ERROR, (_, d) => {
  emit('error', { errType: d.type, details: d.details, fatal: d.fatal, code: d.response?.code });
  ui(`erro ${d.details}${d.fatal ? ' (FATAL)' : ''}`, d.fatal ? 'err' : 'warn');
  if (!d.fatal) return;
  if (d.type === Hls.ErrorTypes.NETWORK_ERROR) setTimeout(() => hls.startLoad(), 1000);
  else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
});

// ---------- stalls (travamentos vistos pelo usuário) ----------
let stalls = 0, stallTotal = 0, stallStart = null, started = false;
video.addEventListener('playing', () => {
  if (!started) {
    started = true;
    emit('playback_start');
  }
  if (stallStart !== null) {
    const ms = Date.now() - stallStart;
    stallTotal += ms;
    stallStart = null;
    emit('stall_end', { durationMs: ms });
    ui(`stall terminou (${(ms / 1000).toFixed(2)} s)`, 'ok');
    $('m-stalltime').textContent = `${(stallTotal / 1000).toFixed(1)} s`;
  }
});
video.addEventListener('waiting', () => {
  if (!started || video.seeking || stallStart !== null) return;
  stallStart = Date.now();
  stalls++;
  $('m-stalls').textContent = stalls;
  emit('stall_start', { currentTime: video.currentTime, buffer: bufferAhead() });
  ui('STALL: buffer vazio', 'err');
});

function bufferAhead() {
  const t = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= t + 0.1 && t <= video.buffered.end(i)) return +(video.buffered.end(i) - t).toFixed(2);
  }
  return 0;
}

// amostra periódica (buffer e banda) → série temporal para o relatório
setInterval(() => {
  const buf = bufferAhead();
  $('m-buffer').textContent = `${buf.toFixed(1)} s`;
  if (hls.bandwidthEstimate) $('m-bw').textContent = fmtBps(hls.bandwidthEstimate);
  if (started) emit('sample', { buffer: buf, bwEstimate: Math.round(hls.bandwidthEstimate), level: hls.currentLevel, stalled: stallStart !== null });
}, 1000);

// ---------- estado dos edges ----------
async function pollStatus() {
  try {
    const st = await (await fetch('/status')).json();
    $('edges').innerHTML = st.edges
      .map((e) => {
        const s = e.stats;
        const hr = s?.hitRatio != null ? `${(s.hitRatio * 100).toFixed(0)}%` : '–';
        return `<div class="edge ${e.state}" style="--c:${edgeColor(e.id)}">
          <b>${e.id}</b><span class="state ${e.state}">${e.state}</span>
          <small>anel ${(e.ringShare * 100).toFixed(1)}% · servidos ${e.served} · health ${e.healthMs ?? '–'} ms</small>
          <small>${s ? `hit ratio ${hr} · ${s.hits} HIT / ${s.misses} MISS · cache ${(s.cacheBytes / 2 ** 20).toFixed(1)} MB (${s.cacheItems} obj)` : 'sem stats'}</small>
        </div>`;
      })
      .join('');
    for (const e of st.edges) {
      if (prevState[e.id] && prevState[e.id] !== e.state) ui(`${e.id}: ${prevState[e.id]} → ${e.state}`, e.state === 'UP' ? 'ok' : 'err');
      prevState[e.id] = e.state;
    }
  } catch {
    $('edges').innerHTML = '<div class="muted">router inacessível</div>';
  }
}
const prevState = {};
setInterval(pollStatus, 1000);
pollStatus();

$('play').onclick = () => video.play();
video.play().catch(() => ui('clique em ▶ Play para iniciar'));
