// Relationship trend/trajectory layer — weekly series computed from per-message tags (conflict/love/
// sorry/direction) + timestamps, so the advisor and dashboard can see DIRECTION and CHANGE, not just
// a static state. No fabrication: everything here is derived from real tagged messages.
import { domain } from './domain/index.js';
import { THEM } from './domain/names.js';

const WEEK = 7 * 86400000;
const tagOf = (m) => m._tag || domain.tagMessage(m);
const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const arrow = (series) => {                       // trajectory of the last few points
  const v = series.filter((x) => x != null); if (v.length < 2) return '';
  const a = v[v.length - 2], b = v[v.length - 1];
  if (b > a * 1.25) return '↑'; if (b < a * 0.75) return '↓'; return '→';
};

export function relTrends(messages, nowMs, weeks = 6) {
  const now = nowMs;
  const start = now - weeks * WEEK;
  const START_GAP = 2 * 3600000;   // a message after a >2h gap = a fresh conversation start
  const B = Array.from({ length: weeks }, () => ({
    msgs: 0, her: 0, mine: 0, conflict: 0, sorryG: 0, love: 0, night: 0,
    yourLat: [], herLat: [], herStart: 0, myStart: 0, sentSum: 0, sentN: 0,
  }));
  const idxOf = (ts) => { const i = Math.floor((ts - start) / WEEK); return i >= 0 && i < weeks ? i : -1; };
  let lastThem = null, lastMe = null, prevTs = null;
  for (const m of messages) {
    const t = tagOf(m);
    // reply latencies (each direction, only if the reply is within 12h)
    if (t.dir === 'E') { if (lastMe && m.ts - lastMe < 12 * 3600000) { const i = idxOf(m.ts); if (i >= 0) B[i].herLat.push((m.ts - lastMe) / 60000); lastMe = null; } lastThem = m.ts; }
    else if (t.dir === 'G') { if (lastThem && m.ts - lastThem < 12 * 3600000) { const i = idxOf(m.ts); if (i >= 0) B[i].yourLat.push((m.ts - lastThem) / 60000); lastThem = null; } lastMe = m.ts; }
    const i = idxOf(m.ts); if (i < 0) { prevTs = m.ts; continue; }
    const b = B[i]; b.msgs++;
    if (t.dir === 'E') b.her++; else b.mine++;
    b.conflict += t.conflict || 0; if (t.sorry && t.dir === 'G') b.sorryG++; if (t.love) b.love++;
    if (new Date(m.ts).getHours() < 6) b.night++;
    if (prevTs == null || m.ts - prevTs > START_GAP) { if (t.dir === 'E') b.herStart++; else b.myStart++; }   // who opened the thread
    const sc = m.analysis && typeof m.analysis.score === 'number' ? m.analysis.score : null;                  // real sentiment (if analyzed)
    if (t.dir === 'E' && sc != null) { b.sentSum += sc; b.sentN++; }                                          // HER mood
    prevTs = m.ts;
  }
  const weeksArr = B.map((b) => ({
    msgs: b.msgs, her: b.her, mine: b.mine, conflict: b.conflict, sorryG: b.sorryG, love: b.love,
    latMin: med(b.yourLat), herLatMin: med(b.herLat),
    nightPct: b.msgs ? Math.round((b.night / b.msgs) * 100) : null,
    herInitPct: (b.herStart + b.myStart) ? Math.round((b.herStart / (b.herStart + b.myStart)) * 100) : null,
    sweet: (b.love + b.conflict) ? Math.round((b.love / (b.love + b.conflict)) * 100) : null,
    herSent: b.sentN ? Math.round((b.sentSum / b.sentN) * 100) / 100 : null,
  }));
  const col = (k) => weeksArr.map((w) => w[k]);
  const keys = ['conflict', 'msgs', 'love', 'sorryG', 'latMin', 'herLatMin', 'nightPct', 'herInitPct', 'sweet', 'herSent'];
  const series = {}, arrows = {};
  for (const k of keys) { series[k] = col(k); arrows[k] = arrow(col(k)); }
  return { weeks: weeksArr, series, arrows };
}

// compact block for the advisor context
export function trendText(t) {
  if (!t || !t.weeks || t.weeks.length < 2) return '';
  const row = (label, arr, arw, fmt = (x) => x) => `${label}: ${arr.slice(-5).map((x) => (x == null ? '—' : fmt(x))).join(' → ')} ${arw || ''}`;
  const s = t.series, a = t.arrows;
  const rnd = (x) => Math.round(x);
  const lines = [
    row(`${THEM}的情绪(-1~1)`, s.herSent, a.herSent),
    row(`${THEM}主动发起%`, s.herInitPct, a.herInitPct),
    row('冲突强度', s.conflict, a.conflict),
    row('甜度指数%', s.sweet, a.sweet),
    row('消息量', s.msgs, a.msgs),
    row('深夜占比%', s.nightPct, a.nightPct),
    row('你回复中位(分)', s.latMin, a.latMin, rnd),
    row(`${THEM}回复中位(分)`, s.herLatMin, a.herLatMin, rnd),
    row('你道歉次数', s.sorryG, a.sorryG),
    row('示爱次数', s.love, a.love),
  ];
  // "what changed" — last 2 weeks vs prior 2 weeks
  const wk = t.weeks; const recent = wk.slice(-2), prior = wk.slice(-4, -2);
  const avg = (arr, k) => { const v = arr.map((w) => w[k]).filter((x) => x != null); return v.length ? v.reduce((a2, b2) => a2 + b2, 0) / v.length : null; };
  const changes = [];
  const chk = (k, label, up = '↑', down = '↓', badUp = true) => {
    const r = avg(recent, k), p = avg(prior, k); if (r == null || p == null || p === 0) return;
    if (r > p * 1.3) changes.push(`${label}${up}${badUp ? '（留意）' : ''}`); else if (r < p * 0.7) changes.push(`${label}${down}${!badUp ? '（留意）' : ''}`);
  };
  chk('herSent', `${THEM}情绪`, '转好', '走低', false);
  chk('herInitPct', `${THEM}主动发起`, '增多', '减少', false);
  chk('conflict', '冲突', '升温', '降温', true);
  chk('nightPct', '深夜消息', '增多', '减少', true);
  chk('love', '示爱', '增多', '减少', false);
  chk('latMin', '你回复变', '慢', '快', true);
  chk('herLatMin', `${THEM}回复变`, '慢', '快', true);
  chk('msgs', '互动', '变多', '变少', false);
  chk('sorryG', '你道歉', '增多', '减少', true);
  return '【近况趋势（每列=一周，最右=本周）】\n' + lines.join('\n') + (changes.length ? '\n【最近两周的变化】' + changes.join(' · ') : '');
}
