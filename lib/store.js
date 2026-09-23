// In-memory analytics store: ring buffer of messages + derived aggregates.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CFG, ROOT, DATA_DIR, CONTEXT_TYPE, IS_BIZLIKE } from './config.js';
import { relationshipStats } from './relationship.js';
import { domain } from './domain/index.js';

const JSONL = join(DATA_DIR, 'messages.jsonl');

export const store = {
  messages: [],                 // ring buffer {key,ts,session,sessionName,sender,content,isSend,analysis}
  byKey: new Map(),             // key -> message ref
  sigs: new Set(),              // content signatures for cross-source dedup
  nameMap: new Map(),           // username -> display name
  sessionMeta: new Map(),       // username -> {type,sessionType}
  startedAt: Date.now(),
  push: { connected: false, info: 'init', events: 0, lastEventAt: 0 },
  ai: { insight: null, insightAt: 0 },
  otherFeed: [],                // secondary-chat feed (unused by connectors; kept for the snapshot shape)
  otherChats: new Map(),        // sid -> {session,name,kind,count,sent,recv,last}
  otherKeys: new Set(),         // dedup keys for other messages
  roomSenders: new Map(),       // room -> Set(senderName) for group-size heuristic
  blockedRooms: new Set(),
};

// lightweight entry for a secondary chat + per-chat tally
export function addOther(m) {
  if (m.key && store.otherKeys.has(m.key)) return null;
  if (m.key) store.otherKeys.add(m.key);
  const e = {
    key: m.key, ts: m.ts, session: m.session, sessionName: m.sessionName,
    senderName: m.senderName, isSend: m.isSend ? 1 : 0, content: String(m.content ?? ''),
    kind: m.kind || 'private',
  };
  store.otherFeed.push(e);
  store.otherFeed.sort((a, b) => a.ts - b.ts);
  if (store.otherFeed.length > 1200) store.otherFeed.splice(0, store.otherFeed.length - 1200);
  const c = store.otherChats.get(e.session) || { session: e.session, name: e.sessionName, kind: e.kind, count: 0, sent: 0, recv: 0, last: 0 };
  c.count++; if (e.isSend) c.sent++; else c.recv++; c.last = Math.max(c.last, e.ts); c.name = e.sessionName || c.name;
  store.otherChats.set(e.session, c);
  return e;
}

export function othersSnapshot() {
  const now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const chats = [...store.otherChats.values()].sort((a, b) => b.last - a.last);
  const feed = store.otherFeed;
  const min60 = now - 3600000;
  const todayMs = today.getTime();
  return {
    now,
    kpi: {
      chats: chats.length,
      total: feed.length,
      today: feed.filter((m) => m.ts >= todayMs).length,
      active1h: chats.filter((c) => c.last >= min60).length,
      groups: chats.filter((c) => c.kind === 'group').length,
      privates: chats.filter((c) => c.kind === 'private').length,
    },
    topChats: chats.slice(0, 14),
    recent: feed.slice(-60).reverse(),
    push: store.push,
  };
}

export function setNameMap(sessions, contacts) {
  for (const s of sessions || []) {
    if (s.username) {
      store.nameMap.set(s.username, s.displayName || s.username);
      store.sessionMeta.set(s.username, { type: s.type, sessionType: s.sessionType });
    }
  }
  for (const c of contacts || []) {
    if (c.username && !store.nameMap.has(c.username)) {
      store.nameMap.set(c.username, c.remark || c.nickname || c.displayName || c.username);
    }
  }
}

export function nameFor(username) {
  return store.nameMap.get(username) || username;
}

function makeKey(m) {
  return String(m.key || m.rawid || m.serverId || `${m.session}:${m.ts}:${String(m.content).slice(0, 24)}`);
}

// add a normalized message; returns the stored ref or null if duplicate
export function addMessage(m, { persist = true } = {}) {
  const norm = {
    key: makeKey(m),
    ts: m.ts,
    session: m.session,
    sessionName: m.sessionName || nameFor(m.session),
    sender: m.sender || m.session,
    senderName: m.senderName || nameFor(m.sender || m.session),
    isSend: m.isSend ? 1 : 0,
    content: String(m.content ?? ''),
    type: m.type ?? 1,
    analysis: m.analysis || null,
    voice: m.voice || false,
    source: m.source || 'live',
  };
  norm._tag = domain.tagMessage(norm);
  // dedup by key AND by content-signature (same msg can arrive via SSE push + weflow poll
  // with different key schemes — same sender+second+text collapses them)
  norm._sig = `${norm.isSend}|${Math.floor(norm.ts / 1000)}|${norm.content.slice(0, 48)}`;
  if (store.byKey.has(norm.key) || store.sigs.has(norm._sig)) return null;
  store.messages.push(norm);
  store.byKey.set(norm.key, norm);
  store.sigs.add(norm._sig);
  if (store.messages.length > CFG.ringBufferSize) {
    const dropped = store.messages.splice(0, store.messages.length - CFG.ringBufferSize);
    for (const d of dropped) { store.byKey.delete(d.key); store.sigs.delete(d._sig); }
  }
  if (persist && norm.source === 'live') {
    try { appendFileSync(JSONL, JSON.stringify(norm) + '\n'); } catch {}
  }
  return norm;
}

export function loadPersisted() {
  if (!existsSync(JSONL)) return 0;
  let n = 0;
  try {
    const lines = readFileSync(JSONL, 'utf8').split('\n').filter(Boolean);
    for (const l of lines.slice(-CFG.ringBufferSize)) {
      try { const m = JSON.parse(l); m.source = 'persist'; if (addMessage(m, { persist: false })) n++; } catch {}
    }
  } catch {}
  store.messages.sort((a, b) => a.ts - b.ts);
  return n;
}

// messages still needing AI analysis
export function pendingAnalysis(limit) {
  const out = [];
  for (let i = store.messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = store.messages[i];
    if (!m.analysis && m.content && m.type === 1 && m.content.length > 1) out.push(m);
  }
  return out.reverse();
}

const STOP = new Set(('the a an and or but is are was were be to of in on at it this that i you he she we they me my your our for with as so no not do did just get got has have had can will would 了 的 是 我 你 他 她 们 就 都 也 在 和 与 吧 啊 呢 吗 呀 嗯 哦 哈 那 这 有 没 不 一个 一 个 好 说 会 要 给 到 里 上 下 去 来 什么 怎么 这个 那个 现在').split(/\s+/));

// compute the full aggregate snapshot for the dashboard
export function snapshot() {
  const msgs = store.messages;
  const now = Date.now();
  const total = msgs.length;
  let sent = 0, recv = 0, pos = 0, neu = 0, neg = 0, analyzed = 0;
  let scoreSum = 0;
  const perSession = new Map();
  const emotions = new Map();
  const topics = new Map();
  const langs = new Map();
  const words = new Map();
  const minute = new Array(60).fill(0);   // last 60 minutes
  const hour24 = new Array(24).fill(0);    // last 24 hours
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0)); // weekday x hour

  const minStart = now - 60 * 60000;
  const dayStart = now - 24 * 3600000;

  for (const m of msgs) {
    if (m.isSend) sent++; else recv++;
    const ps = perSession.get(m.session) || { session: m.session, name: m.sessionName, count: 0, sent: 0, recv: 0, last: 0, score: 0, scored: 0 };
    ps.count++; if (m.isSend) ps.sent++; else ps.recv++; ps.last = Math.max(ps.last, m.ts);
    perSession.set(m.session, ps);

    const d = new Date(m.ts);
    heat[d.getDay()][d.getHours()]++;
    if (m.ts >= minStart) { const idx = 59 - Math.floor((now - m.ts) / 60000); if (idx >= 0 && idx < 60) minute[idx]++; }
    if (m.ts >= dayStart) { const idx = 23 - Math.floor((now - m.ts) / 3600000); if (idx >= 0 && idx < 24) hour24[idx]++; }

    if (m.analysis) {
      analyzed++;
      const a = m.analysis;
      if (a.sentiment === 'positive') pos++; else if (a.sentiment === 'negative') neg++; else neu++;
      scoreSum += a.score || 0; ps.score += a.score || 0; ps.scored++;
      if (a.emotion) emotions.set(a.emotion, (emotions.get(a.emotion) || 0) + 1);
      for (const t of a.topics || []) topics.set(t, (topics.get(t) || 0) + 1);
      if (a.lang) langs.set(a.lang, (langs.get(a.lang) || 0) + 1);
    }
    // lightweight keyword freq (EN words + CN bigrams)
    for (const w of String(m.content).toLowerCase().match(/[a-z]{3,}/g) || []) {
      if (!STOP.has(w)) words.set(w, (words.get(w) || 0) + 1);
    }
    const cn = String(m.content).replace(/[^一-龥]/g, '');
    for (let i = 0; i < cn.length - 1; i++) {
      const bg = cn.slice(i, i + 2);
      if (!STOP.has(bg)) words.set(bg, (words.get(bg) || 0) + 1);
    }
  }

  const topSessions = [...perSession.values()]
    .map((s) => ({ ...s, avgScore: s.scored ? s.score / s.scored : null }))
    .sort((a, b) => b.count - a.count).slice(0, 12);

  const activeCut = now - 60 * 60000;
  const sessionsActive = [...perSession.values()].filter((s) => s.last * 1 >= activeCut / 1).length;

  const lastMin = msgs.filter((m) => m.ts >= now - 60000).length;
  const last5 = msgs.filter((m) => m.ts >= now - 300000).length;
  const spanMin = total ? Math.max(1, (now - msgs[0].ts) / 60000) : 1;

  return {
    now,
    contextType: CONTEXT_TYPE,
    uptimeSec: Math.floor((now - store.startedAt) / 1000),
    kpi: {
      total, sent, recv,
      sessions: perSession.size,
      sessionsActive,
      lastMin,
      last5min: last5,
      perMin: +(total / spanMin).toFixed(2),
      analyzed,
      avgScore: analyzed ? +(scoreSum / analyzed).toFixed(2) : 0,
    },
    sentiment: { pos, neu, neg, analyzed },
    emotions: topN(emotions, 8),
    topics: topN(topics, 18),
    langs: topN(langs, 6),
    keywords: topN(words, 30),
    topSessions,
    timeline: { minute, hour24 },
    heatmap: heat,
    push: store.push,
    ai: store.ai,
    rel: IS_BIZLIKE ? null : relationshipStats(msgs),
    recent: [...msgs].sort((a, b) => b.ts - a.ts).slice(0, 60),
    other: {
      recent: store.otherFeed.slice(-30).reverse(),
      count: store.otherFeed.length,
      chats: [...new Set(store.otherFeed.map((o) => o.sessionName))].length,
    },
    target: CFG.target,
  };
}

function topN(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value]) => ({ label, value }));
}

export function saveSnapshotFile() {
  try { writeFileSync(join(DATA_DIR, 'state.json'), JSON.stringify(snapshot())); } catch {}
}
