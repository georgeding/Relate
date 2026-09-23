// Live dashboard client. Consumes /stream SSE and renders everything.
const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let state = null;

// ---- KPI tiles ----
const KPI = [
  { k: 'total', l: 'Total Messages', s: (d) => `${fmt(d.kpi.sent)} sent · ${fmt(d.kpi.recv)} recv` },
  { k: 'perMin', l: 'Msgs / min', s: (d) => `${d.kpi.lastMin} in last min`, v: (d) => d.kpi.perMin },
  { k: 'sessionsActive', l: 'Active Chats (1h)', s: (d) => `${d.kpi.sessions} total` },
  { k: 'last5min', l: 'Last 5 min', s: () => 'live velocity' },
  { k: 'analyzed', l: 'AI Analyzed', s: (d) => `${d.kpi.total ? Math.round(d.kpi.analyzed / d.kpi.total * 100) : 0}% coverage` },
  { k: 'avgScore', l: 'Mood Score', s: (d) => d.kpi.avgScore > .15 ? '↑ positive' : d.kpi.avgScore < -.15 ? '↓ negative' : '→ neutral', color: (d) => d.kpi.avgScore > .15 ? css('--pos') : d.kpi.avgScore < -.15 ? css('--neg') : css('--neu') },
];
function renderKpis(d) {
  $('kpis').innerHTML = KPI.map((x) => {
    const val = x.v ? x.v(d) : d.kpi[x.k];
    const col = x.color ? `style="color:${x.color(d)}"` : '';
    return `<div class="card kpi"><div class="n" ${col}>${typeof val === 'number' ? fmt(val) : val}</div><div class="l">${x.l}</div><div class="s">${x.s(d)}</div></div>`;
  }).join('');
}

// ---- sentiment donut ----
function donut(d) {
  const c = $('donut'), g = c.getContext('2d'), S = d.sentiment;
  const tot = Math.max(1, S.pos + S.neu + S.neg);
  const segs = [[S.pos, css('--pos')], [S.neu, css('--neu')], [S.neg, css('--neg')]];
  g.clearRect(0, 0, 120, 120); let a = -Math.PI / 2;
  for (const [v, col] of segs) {
    const ang = v / tot * Math.PI * 2;
    g.beginPath(); g.arc(60, 60, 52, a, a + ang); g.lineWidth = 15; g.strokeStyle = col; g.stroke(); a += ang;
  }
  $('avgScore').textContent = (d.kpi.avgScore > 0 ? '+' : '') + d.kpi.avgScore;
  $('sPos').textContent = S.pos; $('sNeu').textContent = S.neu; $('sNeg').textContent = S.neg;
  const em = d.emotions || [];
  const mx = Math.max(1, ...em.map((e) => e.value));
  $('emotions').innerHTML = em.length ? em.map((e) =>
    `<div class="bar"><div class="lab">${esc(e.label)}</div><div class="track"><div class="fill" style="width:${e.value / mx * 100}%;background:var(--c4)"></div></div><div class="val">${e.value}</div></div>`
  ).join('') : '<div class="empty">analyzing…</div>';
}

// ---- bar chart on canvas (timeline) ----
function bars(id, data, color, opts = {}) {
  const c = $(id), g = c.getContext('2d');
  const w = c.clientWidth, h = c.height; c.width = w;
  g.clearRect(0, 0, w, h);
  const mx = Math.max(1, ...data);
  const n = data.length, bw = w / n;
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const bh = data[i] / mx * (h - 18);
    g.globalAlpha = data[i] ? 1 : .25;
    g.fillRect(i * bw + 1, h - bh - 14, Math.max(1, bw - 2), bh || 1);
  }
  g.globalAlpha = 1; g.fillStyle = css('--dim'); g.font = '10px sans-serif';
  if (opts.labels) opts.labels.forEach((t, i) => { g.fillText(t, i * (w / opts.labels.length) + 2, h - 2); });
  g.textAlign = 'right'; g.fillText('max ' + mx, w - 2, 10); g.textAlign = 'left';
}

// ---- heatmap ----
function heatmap(d) {
  const c = $('heat'), g = c.getContext('2d');
  const w = c.clientWidth; c.width = w; const h = c.height;
  g.clearRect(0, 0, w, h);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const padL = 34, padT = 4, padB = 14;
  const cw = (w - padL) / 24, ch = (h - padT - padB) / 7;
  let mx = 1; d.heatmap.forEach((r) => r.forEach((v) => mx = Math.max(mx, v)));
  for (let dy = 0; dy < 7; dy++) {
    g.fillStyle = css('--mut'); g.font = '10px sans-serif'; g.fillText(days[dy], 2, padT + dy * ch + ch / 2 + 3);
    for (let hr = 0; hr < 24; hr++) {
      const v = d.heatmap[dy][hr]; const t = v / mx;
      g.fillStyle = v ? `rgba(91,140,255,${.15 + t * .85})` : css('--panel2');
      g.fillRect(padL + hr * cw + 1, padT + dy * ch + 1, cw - 2, ch - 2);
    }
  }
  g.fillStyle = css('--dim'); g.font = '9px sans-serif';
  for (let hr = 0; hr < 24; hr += 3) g.fillText(hr, padL + hr * cw, h - 3);
}

// ---- top sessions ----
function topSessions(d) {
  const list = d.topSessions || [];
  const mx = Math.max(1, ...list.map((s) => s.count));
  $('topSessions').innerHTML = list.length ? list.map((s) => {
    const sw = s.sent / mx * 100, rw = s.recv / mx * 100;
    return `<div class="bar"><div class="lab" title="${esc(s.name)}">${esc(s.name)}</div>
      <div class="track"><div class="fill" style="width:${sw}%"></div><div class="fill recv" style="width:${rw}%"></div></div>
      <div class="val">${s.count}</div></div>`;
  }).join('') : '<div class="empty">—</div>';
}

// ---- topics / keywords ----
function topics(d) {
  const t = d.topics || [];
  $('topics').innerHTML = t.length ? t.map((x) => `<span class="chip">${esc(x.label)} <b style="color:var(--acc)">${x.value}</b></span>`).join('') : '<span class="empty">analyzing…</span>';
  $('keywords').innerHTML = (d.keywords || []).map((x) => `<span>${esc(x.label)}</span>`).join('');
}

// ---- AI briefing ----
function renderBrief(ins, at) {
  if (!ins) return;
  const alerts = (ins.alerts || []).filter(Boolean);
  $('brief').innerHTML =
    `<div class="hl">${esc(ins.headline || '')}</div>
     <div class="sum">${esc(ins.summary || '')}</div>
     ${ins.mood ? `<span class="mood">mood · ${esc(ins.mood)}</span>` : ''}
     <div class="chips">${(ins.activeTopics || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
     ${alerts.length ? `<div class="alerts">${alerts.map((a) => `<div class="alert">⚠ ${esc(a)}</div>`).join('')}</div>` : ''}`;
  if (at) $('briefAge').textContent = 'updated ' + ago(at);
}

// ---- reminders ----
function renderReminders(r) {
  const open = r.open || [], done = r.done || [];
  $('remCnt').textContent = r.counts ? r.counts.open : open.length;
  const item = (x) => `<div class="rem ${x.status === 'done' ? 'done' : ''}" data-id="${encodeURIComponent(x.id)}">
      <div class="chk"></div>
      <div class="txt"><div>${esc(x.text)}</div>
        <div class="meta"><span class="tag ${x.kind}">${x.kind}</span>
          <span class="u-${x.urgency}">${x.who === 'me' ? '➡ you owe' : '⬅ owed to you'}${x.urgency === 'high' ? ' · urgent' : ''}</span>
          ${x.session ? `<span>· ${esc(x.session)}</span>` : ''}${x.due ? `<span>· ⏱ ${esc(x.due)}</span>` : ''}</div>
      </div></div>`;
  const html = open.map(item).join('') + done.map(item).join('');
  $('reminders').innerHTML = html || '<div class="empty">No open promises or requests detected yet.</div>';
  document.querySelectorAll('.rem .chk').forEach((el) => el.onclick = () => {
    const id = el.parentElement.dataset.id;
    fetch(`/api/reminders/${id}/toggle`, { method: 'POST' });
  });
}
$('clearDone').onclick = (e) => { e.preventDefault(); fetch('/api/reminders/clear-done', { method: 'POST' }); };

// ---- live feed ----
function pushFeed(m, prepend = true) {
  const f = $('feed');
  const el = document.createElement('div');
  el.className = 'msg' + (m.isSend ? ' me' : '');
  const col = m.analysis ? (m.analysis.sentiment === 'positive' ? css('--pos') : m.analysis.sentiment === 'negative' ? css('--neg') : css('--neu')) : css('--dim');
  el.innerHTML = `<div class="h"><span class="sent-dot" style="background:${col}"></span>
     <span class="who">${esc(m.sessionName || '')}</span><span>${m.isSend ? 'you' : esc(m.senderName || 'them')}</span>
     <span style="margin-left:auto">${time(m.ts)}</span></div>
     <div class="b">${esc(m.content)}</div>`;
  if (prepend) f.insertBefore(el, f.firstChild); else f.appendChild(el);
  while (f.children.length > 60) f.removeChild(f.lastChild);
}

// ---- full render ----
function render(d) {
  state = d;
  renderKpis(d); donut(d); topSessions(d); topics(d); heatmap(d);
  bars('timeline', d.timeline.minute, css('--c1'));
  bars('day', d.timeline.hour24, css('--c6'), { labels: ['-24h', '-18h', '-12h', '-6h', 'now'] });
  $('tlNow').textContent = d.kpi.lastMin + '/min';
  $('feedCnt').textContent = fmt(d.kpi.total);
  if (d.ai && d.ai.insight) renderBrief(d.ai.insight, d.ai.insightAt);
  updateStatus(d.push);
  $('uptime').textContent = 'uptime ' + dur(d.uptimeSec);
  if (!$('feed').children.length && d.recent) d.recent.slice().reverse().forEach((m) => pushFeed(m, false));
}

function updateStatus(p) {
  if (!p) return;
  $('pushDot').className = 'dot' + (p.connected ? ' on' : '');
  $('pushTxt').textContent = p.connected ? `live · ${p.events} events` : `reconnecting (${p.info || ''})`.slice(0, 40);
}

// ---- SSE wiring ----
function connect() {
  const es = new EventSource('/stream');
  es.addEventListener('stats', (e) => render(JSON.parse(e.data)));
  es.addEventListener('message', (e) => { const m = JSON.parse(e.data); pushFeed(m); if (state) { state.kpi.total++; $('feedCnt').textContent = fmt(state.kpi.total); } });
  es.addEventListener('insight', (e) => { const d = JSON.parse(e.data); renderBrief(d.insight, d.at); });
  es.addEventListener('reminders', (e) => renderReminders(JSON.parse(e.data)));
  es.addEventListener('status', (e) => updateStatus(JSON.parse(e.data)));
  es.onerror = () => { $('pushTxt').textContent = 'stream lost — retrying'; };
}
connect();

fetch('/api/ai').then((r) => r.json()).then((a) => {
  $('aiTxt').textContent = a.enabled ? a.model : 'AI off';
}).catch(() => {});
setInterval(() => {
  fetch('/api/ai').then((r) => r.json()).then((a) => {
    $('aiUsage').textContent = `AI: ${a.calls} calls · ${fmt(a.tokensIn + a.tokensOut)} tokens${a.errors ? ` · ${a.errors} errors` : ''}`;
  }).catch(() => {});
}, 5000);

// ---- clock ----
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString(); }, 1000);
window.addEventListener('resize', () => state && render(state));

// ---- time helpers ----
function time(ts) { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
function p2(n) { return String(n).padStart(2, '0'); }
function dur(s) { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; }
function ago(t) { const s = Math.floor((Date.now() - t) / 1000); return s < 60 ? s + 's ago' : Math.floor(s / 60) + 'm ago'; }
