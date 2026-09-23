// Per-person sentiment/engagement for a multi-chat space — how each contact is trending toward you:
// their mood (from message sentiment), how
// active they are, and whether they've gone quiet. Powers a "联系人情绪" card + advisor awareness.
const WEEK = 7 * 86400000;

export function bizTrends(messages, sessions, nowMs, weeks = 4) {
  const now = nowMs, start = now - weeks * WEEK;
  const per = new Map();
  for (const [sid, meta] of sessions) per.set(sid, { name: meta.name, kind: meta.kind || 'dm', wk: Array.from({ length: weeks }, () => ({ sSum: 0, sN: 0, msgs: 0 })), lastActive: 0, theirTotal: 0 });
  for (const m of messages) {
    const p = per.get(m.session); if (!p) continue;
    if (m.ts > p.lastActive) p.lastActive = m.ts;
    if (m.isSend) continue;                                    // only THEIR messages (their sentiment toward you)
    p.theirTotal++;
    const i = Math.floor((m.ts - start) / WEEK); if (i < 0 || i >= weeks) continue;
    const b = p.wk[i]; b.msgs++;
    const sc = m.analysis && typeof m.analysis.score === 'number' ? m.analysis.score : null;
    if (sc != null) { b.sSum += sc; b.sN += 1; }
  }
  const out = [];
  for (const p of per.values()) {
    if (!p.lastActive) continue;                               // never seen — skip
    const sent = p.wk.map((b) => (b.sN ? Math.round((b.sSum / b.sN) * 100) / 100 : null));
    const msgs = p.wk.map((b) => b.msgs);
    const known = sent.filter((x) => x != null);
    out.push({
      name: p.name, kind: p.kind, sent, msgs,
      latestSent: known.length ? known[known.length - 1] : null,
      trend: known.length >= 2 ? (known[known.length - 1] > known[0] + 0.15 ? 'up' : known[known.length - 1] < known[0] - 0.15 ? 'down' : 'flat') : '',
      lastActive: p.lastActive, quietDays: Math.floor((now - p.lastActive) / 86400000),
    });
  }
  return out.sort((a, b) => b.lastActive - a.lastActive);
}

const arrow = (series) => { const v = series.filter((x) => x != null); if (v.length < 2) return ''; const a = v[v.length - 2], b = v[v.length - 1]; return b > a + 0.12 ? '↑' : b < a - 0.12 ? '↓' : '→'; };
const moodOf = (s) => (s == null ? '—' : s > 0.25 ? '偏正面' : s < -0.25 ? '偏负面' : '中性');

// OVERALL team mood + synergy + who needs attention — from all contacts' messages (not per-person list)
export function bizMood(messages, sessions, nowMs, weeks = 4) {
  const per = bizTrends(messages, sessions, nowMs, weeks);
  const start = nowMs - weeks * WEEK;
  const wk = Array.from({ length: weeks }, () => ({ sSum: 0, sN: 0 }));
  for (const m of messages) {
    if (!sessions.has(m.session) || m.isSend) continue;
    const i = Math.floor((m.ts - start) / WEEK); if (i < 0 || i >= weeks) continue;
    const sc = m.analysis && typeof m.analysis.score === 'number' ? m.analysis.score : null;
    if (sc != null) { wk[i].sSum += sc; wk[i].sN += 1; }
  }
  const overall = wk.map((b) => (b.sN ? Math.round((b.sSum / b.sN) * 100) / 100 : null));
  const known = overall.filter((x) => x != null);
  const contacts = per.filter((c) => c.kind !== 'group');
  const active = contacts.filter((c) => c.quietDays < 3);
  const positive = active.filter((c) => c.latestSent == null || c.latestSent >= -0.15);
  const synergy = active.length ? Math.round((100 * positive.length) / active.length) : null;  // % of active team that's non-negative
  const concerns = contacts
    .filter((c) => (c.latestSent != null && c.latestSent < -0.2) || (c.quietDays >= 4 && c.trend === 'down') || c.quietDays >= 7)
    .map((c) => ({ name: c.name, why: c.latestSent != null && c.latestSent < -0.2 ? '情绪偏负' : c.quietDays >= 7 ? `静默${c.quietDays}天` : '走低/静默' }))
    .slice(0, 5);
  return { overall, arrow: arrow(overall), latest: known.length ? known[known.length - 1] : null, synergy, active: active.length, quiet: contacts.length - active.length, concerns };
}

// compact block for the advisor — overall vibe, not a roster
export function bizMoodText(mood) {
  const lbl = mood.latest == null ? '数据积累中' : mood.latest > 0.2 ? '正面' : mood.latest < -0.2 ? '偏负' : '中性';
  const lines = [`【团队氛围】整体情绪：${lbl}${mood.arrow ? ' ' + mood.arrow : ''} · 协作指数：${mood.synergy == null ? '—' : mood.synergy + '%'} · 活跃 ${mood.active} 人${mood.quiet ? ` / 静默 ${mood.quiet}` : ''}`];
  if (mood.concerns.length) lines.push('需要关注：' + mood.concerns.map((c) => `${c.name}(${c.why})`).join('、'));
  return lines.join('\n');
}

// compact block for the advisor so it knows who's frustrated / disengaging / happy
export function bizContactText(list) {
  const lines = list.filter((c) => c.kind !== 'group').slice(0, 10).map((c) => {
    const tr = c.trend === 'up' ? '↑转好' : c.trend === 'down' ? '↓走低' : '';
    const act = c.quietDays >= 3 ? `已静默${c.quietDays}天` : '活跃';
    return `· ${c.name}：情绪${moodOf(c.latestSent)}${tr ? ' ' + tr : ''} · ${act}`;
  });
  return lines.length ? '【联系人近况（各人近期对你的情绪与活跃度；有人走低或静默要留意）】\n' + lines.join('\n') : '';
}
