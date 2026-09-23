// Relationship gamification: health-based levels (up & down), streaks, XP, daily
// strategy quests, and achievements. Pure local computation from analytics.

export const LEVELS = [
  { min: 0,  name: '风暴期',   icon: '⛈️', tip: '先把凌晨的火降下来' },
  { min: 20, name: '磨合期',   icon: '🌧️', tip: '一次只解决一件事，不翻旧账' },
  { min: 40, name: '回暖期',   icon: '⛅', tip: '道歉开始带上具体行动' },
  { min: 60, name: '稳定期',   icon: '🌤️', tip: '把主动做在对方开口之前' },
  { min: 78, name: '默契期',   icon: '☀️', tip: '保持——你们已经很好了' },
  { min: 90, name: '灵魂伴侣', icon: '🌈', tip: '这就是你们想要的样子' },
];

// daily strategy quests (from the relationship analysis). auto = derivable from messages.
export const QUESTS = [
  { id: 'night',   icon: '🌙', text: '凌晨 1 点后不处理矛盾', xp: 15, auto: true },
  { id: 'noold',   icon: '🔁', text: '今天不翻旧账', xp: 15, auto: true },
  { id: 'love',    icon: '💗', text: '主动表达一次在意/爱意', xp: 10, auto: true },
  { id: 'promise', icon: '✅', text: '兑现一个之前的承诺', xp: 20, auto: false },
  { id: 'change',  icon: '💬', text: '道歉时附上一个具体改变', xp: 15, auto: false },
  { id: 'hold',    icon: '🫂', text: '对方情绪来时，先接住再讲道理', xp: 15, auto: false },
];

function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function levelFor(h) { let L = LEVELS[0], i = 0; for (let k = 0; k < LEVELS.length; k++) if (h >= LEVELS[k].min) { L = LEVELS[k]; i = k; } return { ...L, index: i }; }

// daily settlement points from that day's conflict intensity
function daySettle(conflict) {
  if (conflict === 0) return 20;
  if (conflict < 15) return 12;
  if (conflict < 35) return 0;
  if (conflict < 75) return -20;
  return -45;
}

export function computeGame(analytics, messages, gameState, now = Date.now()) {
  const conf = analytics.conflictScore || {};
  const daily = analytics.daily || {};
  const todayK = dayKey(now);

  // rolling 30-day average conflict -> health (0-100), so it levels up in calm
  // stretches and de-levels during conflict spikes.
  const days = [];
  for (let i = 0; i < 30; i++) { const d = new Date(now - i * 86400000); days.push(dayKey(d)); }
  const active = days.filter((d) => daily[d] !== undefined);
  const avgConf = active.length ? active.reduce((s, d) => s + (conf[d] || 0), 0) / active.length : 0;
  let health = Math.round(Math.max(0, Math.min(100, 100 - avgConf * 1.4)));

  // recent care event is a hard hit
  let careHit = false;
  for (const m of messages) if (m._tag?.care && m.ts >= now - 3 * 86400000) careHit = true;
  if (careHit) health = Math.min(health, 30);

  const level = levelFor(health);
  const next = LEVELS[level.index + 1];
  const prevMin = level.min, span = (next ? next.min : 100) - prevMin;
  const progress = span > 0 ? Math.round((health - prevMin) / span * 100) : 100;

  // streak: consecutive recent days with conflict < 20 (that had messages)
  let streak = 0;
  for (let i = 0; i < 120; i++) {
    const d = dayKey(new Date(now - i * 86400000));
    if (daily[d] === undefined) { if (i === 0) continue; else break; }
    if ((conf[d] || 0) < 20) streak++; else break;
  }

  // health a week ago (trend)
  const daysAgo = (n) => { const arr = []; for (let i = n; i < n + 30; i++) arr.push(dayKey(new Date(now - i * 86400000))); const a = arr.filter((d) => daily[d] !== undefined); const av = a.length ? a.reduce((s, d) => s + (conf[d] || 0), 0) / a.length : 0; return Math.round(Math.max(0, Math.min(100, 100 - av * 1.4))); };
  const trend = health - daysAgo(7);

  // weekly XP from settlements
  let weeklyXP = 0;
  for (let i = 0; i < 7; i++) { const d = dayKey(new Date(now - i * 86400000)); if (daily[d] !== undefined) weeklyXP += daySettle(conf[d] || 0); }
  const todaySettle = daily[todayK] !== undefined ? daySettle(conf[todayK] || 0) : 0;

  // quests: auto-evaluate where possible from today's messages
  const todayMsgs = messages.filter((m) => dayKey(m.ts) === todayK);
  const auto = {
    night: !todayMsgs.some((m) => { const h = new Date(m.ts).getHours(); return h >= 1 && h < 6 && (m._tag?.conflict || 0) > 0; }),
    noold: !todayMsgs.some((m) => m._tag?.testE && /上次|每次|之前|以前|又/.test(m.content)),
    love: todayMsgs.some((m) => m._tag?.love && m.isSend),
  };
  const doneMap = (gameState.questDone && gameState.questDone[todayK]) || {};
  const quests = QUESTS.map((q) => {
    const done = q.auto ? (auto[q.id] ?? false) : Boolean(doneMap[q.id]);
    return { ...q, done, manual: !q.auto };
  });
  const questXP = quests.filter((q) => q.done).reduce((s, q) => s + q.xp, 0);

  const badges = computeBadges({ streak, health, analytics, conf, daily, now });

  return {
    health, level, next: next || null, progress,
    streak, trend, weeklyXP, todaySettle, questXP,
    quests, badges,
    calmToday: (conf[todayK] || 0),
    updatedAt: now,
  };
}

function computeBadges({ streak, health, conf, daily, now }) {
  const b = [];
  if (streak >= 3) b.push({ icon: '🕊️', name: `${streak} 天平静`, got: true });
  if (streak >= 7) b.push({ icon: '🏅', name: '一周无大冲突', got: true });
  if (health >= 78) b.push({ icon: '💞', name: '默契达成', got: true });
  // "深夜降温": a day where conflict started high but ended (heuristic placeholder)
  let calmDays30 = 0; for (let i = 0; i < 30; i++) { const d = new Date(now - i * 86400000); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (daily[k] !== undefined && (conf[k] || 0) < 15) calmDays30++; }
  if (calmDays30 >= 15) b.push({ icon: '🌿', name: '近月过半平静', got: true });
  // aspirational (not yet)
  if (streak < 7) b.push({ icon: '🔒', name: '目标：连续 7 天平静', got: false });
  if (health < 78) b.push({ icon: '🔒', name: '目标：升到默契期', got: false });
  return b;
}
