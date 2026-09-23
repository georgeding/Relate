// Relationship analytics over the space's messages: daily volume + conflict, and per-month
// who-sends / apologies / affection / late-night share. Pure local computation, no AI.
import { tagMessage } from './relationship.js';
import { ME, THEM } from './domain/names.js';

function dk(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// Compact behavioral snapshot — the real signals attachment style / health are read from.
// Returns a short human-readable block to feed the advisor (not for display).
export function behaviorSnapshot(analytics, target, messages) {
  const sum = (a) => (a || []).reduce((x, y) => x + (y || 0), 0);
  const g = sum(analytics.mG), e = sum(analytics.mE);
  const sg = sum(analytics.sG), se = sum(analytics.sE);
  const lg = sum(analytics.lG), le = sum(analytics.lE);
  const tot = g + e || 1;
  const pct = (x, d) => Math.round((x / (d || 1)) * 100);
  // recent conflict trend: last 14 days vs prior 14
  const cs = analytics.conflictScore || {};
  const days = Object.keys(cs).sort();
  const last14 = days.slice(-14).reduce((a, k) => a + (cs[k] || 0), 0);
  const prev14 = days.slice(-28, -14).reduce((a, k) => a + (cs[k] || 0), 0);
  const trend = last14 > prev14 * 1.3 ? '升温' : last14 < prev14 * 0.7 ? '降温' : '平稳';
  // together-day count
  let dayN = null;
  if (target?.togetherDate) {
    const t0 = new Date(target.togetherDate + 'T00:00:00');
    dayN = Math.floor((Date.now() - t0.getTime()) / 86400000) + 1;
  }
  // late-night pursuit (0-6am share), avg of live months
  const night = analytics.night && analytics.night.length ? Math.round(sum(analytics.night) / analytics.night.length) : null;
  const lines = [];
  if (dayN != null) lines.push(`在一起第 ${dayN} 天`);
  lines.push(`发消息占比：${ME} ${pct(g, tot)}% / ${THEM} ${pct(e, tot)}%（谁更主动发起）`);
  lines.push(`道歉/修复次数：${ME} ${sg} / ${THEM} ${se}（谁更常低头修复）`);
  lines.push(`表达爱意次数：${ME} ${lg} / ${THEM} ${le}`);
  if (night != null) lines.push(`深夜(0-6点)消息占比约 ${night}%（越高常关联焦虑型依恋的夜间追逐）`);
  lines.push(`近14天冲突强度 ${last14}（前14天 ${prev14}），趋势：${trend}`);
  return { text: lines.join('\n'), dayN, gPct: pct(g, tot), ePct: pct(e, tot), sorryG: sg, sorryE: se, loveG: lg, loveE: le, conflictTrend: trend, last14, prev14 };
}
function mk(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

export function computeAnalytics(messages) {
  const daily = {}, conflictScore = {}, month = {};
  for (const m of messages) {
    const day = dk(m.ts);
    const tag = m._tag || tagMessage(m);
    daily[day] = (daily[day] || 0) + 1;
    conflictScore[day] = (conflictScore[day] || 0) + (tag.conflict || 0);
    const k = mk(m.ts);
    const b = month[k] || (month[k] = { g: 0, e: 0, sg: 0, se: 0, lg: 0, le: 0, night: 0, total: 0 });
    b.total++;
    if (tag.dir === 'G') b.g++; else b.e++;
    if (tag.sorry) { if (tag.dir === 'G') b.sg++; else b.se++; }
    if (tag.love) { if (tag.dir === 'G') b.lg++; else b.le++; }
    if (new Date(m.ts).getHours() < 6) b.night++;
  }
  const months = Object.keys(month).sort();
  return {
    daily, conflictScore,
    labels: months.map((k) => `${+k.slice(5)}月`),
    monthKeys: months,
    mG: months.map((k) => month[k].g), mE: months.map((k) => month[k].e),
    sG: months.map((k) => month[k].sg), sE: months.map((k) => month[k].se),
    lG: months.map((k) => month[k].lg), lE: months.map((k) => month[k].le),
    night: months.map((k) => (month[k].total ? +(month[k].night / month[k].total * 100).toFixed(1) : 0)),
    updatedAt: Date.now(),
    totalMsgs: messages.length,
  };
}
