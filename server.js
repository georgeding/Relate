// Relate space worker: one space = one process. Connectors → store → Living State / todos / RAG / MCP /
// dashboard. The hub (hub.js) writes this space's config and starts it with RELATE_CONFIG=<runtime.json>.
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { CFG, ROOT, DATA_DIR, CONTEXT_TYPE, IS_BIZLIKE } from './lib/config.js';
import { createSources } from './lib/sources.js';
import { activatePlugins, pluginConnectorTypes } from './lib/plugins.js';
import * as S from './lib/store.js';
import { analyzeBatch, extractTodos, reconcileTodos, dedupeTodos, draftReply, askAssistant, askAssistantStream, askWithData, censusAnalyze, chatTitle, relationshipCheckup, regenerateArchive, regeneratePerspectives, observeLiving, groundLiving, groundBusiness, aiStats, aiBudget, aiDaily } from './lib/ai.js';
import { detectCensus, collectCensus } from './lib/census.js';
import * as chats from './lib/chats.js';
import { listNotes, addNote, deleteNote, notesText, extractRemember } from './lib/notes.js';
import { registerTool, executeTool, hasTool } from './lib/tools.js';
import { setExecutor, listApprovals, pendingApprovals, pendingCount, approveAction, rejectAction, addApproval } from './lib/approvals.js';
import { living, loadLiving, saveLiving, dismissLiving, activeMemory, dismissedList } from './lib/living.js';
import { sendPush } from './lib/notify.js';
import { vapidPublic, addSub, subCount } from './lib/webpush.js';
import * as auth from './lib/auth.js';
import { reminders, loadReminders, mergeExtracted, applyReconcile, collapseDuplicates, mergeAway, retireSensitive, markDone, clearDone, listReminders } from './lib/reminders.js';
import { windowDocsFrom } from './lib/windows.js';
import { Corpus } from './lib/rag.js';
import { initMcp, handleMcp } from './lib/mcp.js';
import { computeAnalytics, behaviorSnapshot } from './lib/analytics.js';
import { relTrends, trendText } from './lib/reltrends.js';
import { bizTrends, bizMood, bizMoodText } from './lib/biztrends.js';
import { computeGame } from './lib/game.js';

const PUB = join(ROOT, 'public');
const clients = new Set();
let sources = null;                                                   // connector runtime (lib/sources.js)
let plugins = { route: () => null, contextText: () => '', names: [] };   // lib/plugins.js runtime
let corpus = new Corpus();
const readData = (f, dflt = null) => { try { return JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')); } catch { return dflt; } };
const writeData = (f, v) => { try { writeFileSync(join(DATA_DIR, f), JSON.stringify(v)); } catch {} };
let gameState = readData('game.json', { questDone: {} });
let narrative = readData('narrative.json');
let regen = readData('regen.json');
let checkup = readData('checkup.json');

// the space's chat allowlist (the hub writes each entry's store session id) + a name map for labeling
const SESSIONS = new Map();   // sid -> {name, kind}
const NAMES = {};
for (const c of CFG.chats || []) { const sid = c.session || c.chatId; SESSIONS.set(sid, { name: c.name || sid, kind: c.kind || 'dm' }); if (c.name) NAMES[sid] = c.name; }

let groundTimer = null;
function bumpGroundSoon() { if (groundTimer) return; groundTimer = setTimeout(() => { groundTimer = null; groundBizTick(); }, 90000); }

// a "deep" question gets more retrieved windows + a longer memory slice
const DEEP_RE = /深入|详细|彻底|全面|系统|完整|仔细|好好|认真|所有|每一|每个|逐条|统计|挨个|分析一下|深挖|deep|thorough|detailed|comprehensive|in depth/i;
const isDeep = (q) => DEEP_RE.test(String(q || '')) || String(q || '').length > 40;

// Assemble the grounding context the advisor/checkup reasons from: Living State + real stats.
function assembleCtx() {
  let snapshot = null;
  // behavioral snapshot uses the relationship baseline — skip it for multi-chat spaces
  if (!IS_BIZLIKE) { try { snapshot = behaviorSnapshot(computeAnalytics(S.store.messages), CFG.target, S.store.messages); } catch {} }
  // the actual latest messages, verbatim, so "right now" questions see the real exchange (not just a summary)
  const recent = S.store.messages.slice(-60)
    .filter((m) => String(m.content || '').trim())
    .slice(-30)
    .map((m) => ({
      who: m.isSend ? CFG.me.name : (m.senderName || CFG.target?.name || '对方'),
      text: (m.kind && m.sessionName ? `[${m.sessionName}] ` : '') + String(m.content).slice(0, 200),
      ts: m.ts,
    }));
  const fin = finishedItems();
  const done = fin.length ? '【最近已完成/已处理（别再当作待办、承诺、未完成或重复提醒）】\n' + fin.map((t) => '· ' + t).join('\n') : null;
  let trends = null, contacts = null;
  if (!IS_BIZLIKE) { try { trends = trendText(relTrends(S.store.messages, Date.now())) || null; } catch {} }
  else { try { contacts = bizMoodText(bizMood(S.store.messages, SESSIONS, Date.now())) || null; } catch {} }
  return { memory: living.memory, narrative: (narrative?.narrative || living.narrative), observation: living.observation, snapshot, recent, self: CFG.me.about || null, metrics: plugins.contextText() || null, notes: notesText() || null, done, trends, contacts };
}

// recently finished work — ticked-off Living-State lines + completed todos — so the AI treats them as done
function finishedItems() {
  const dismissed = dismissedList().map((d) => d.text);
  let doneTodos = [];
  try { doneTodos = (listReminders().done || []).slice(0, 12).map((r) => r.text); } catch {}
  return [...new Set([...dismissed, ...doneTodos])].filter(Boolean).slice(0, 20);
}

let voiceChatId = null;   // persistent chat for the voice endpoint (continuous conversation)
// flatten markdown to plain text so a voice assistant reads it naturally (no "asterisk asterisk", pipes, headers…)
function stripMarkdown(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, '').replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*[-:|\s]{3,}\s*$/gm, '').replace(/\|/g, ' ')
    .replace(/\[(\d+)\]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }
function broadcast(event, data) {
  const p = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(p); } catch {} }
}

function buildCorpus() {
  const docs = windowDocsFrom(S.store.messages);
  corpus = new Corpus();
  for (const d of docs) corpus.add(d);
  sources?.reindexEpisodes(corpus);
  corpus.finalize();
  log(`RAG corpus ${corpus.size} conversation windows · ${S.store.messages.length} total messages`);
}

// ---- AI loops (low frequency, hourly-capped) ----
let busy = { an: false, sum: false, rem: false };
async function analysisTick() {
  if (busy.an || !CFG.ai.enabled || noViewer()) return; busy.an = true;   // pause when nobody's watching (cost)
  try {
    const batch = S.pendingAnalysis(CFG.ai.batchSize);
    if (batch.length) {
      const r = await analyzeBatch(batch);
      let k = 0; r.forEach((x, i) => { if (x) { batch[i].analysis = x; k++; } });
      if (k) broadcast('stats', S.snapshot());
    }
  } catch (e) { log('analysis err', e.message); } finally { busy.an = false; }
}
// one-shot burst: analyze recent unanalyzed messages fast (fills the sentiment trend now instead of
// waiting for the slow loop). Newest-first, bounded by weeks + a batch cap.
let backfilling = false;
async function backfillAnalysis(weeks = 8, maxBatches = 600) {
  if (backfilling || !CFG.ai.enabled) return { ok: false };
  backfilling = true; let done = 0;
  const cutoff = Date.now() - weeks * 7 * 86400000;
  try {
    for (let n = 0; n < maxBatches; n++) {
      const batch = S.pendingAnalysis(CFG.ai.batchSize).filter((m) => m.ts >= cutoff);
      if (!batch.length) break;
      const r = await analyzeBatch(batch);
      let k = 0; r.forEach((x, i) => { if (x) { batch[i].analysis = x; k++; } });
      if (!k) break;                                  // rate-limited / failing — stop rather than spin
      done += k; if (n % 8 === 0) broadcast('stats', S.snapshot());
    }
  } finally { backfilling = false; }
  broadcast('stats', S.snapshot());
  log(`backfill analysis: +${done} msgs (${weeks}w window)`);
  return { ok: true, analyzed: done };
}
// pause the expensive AI loops when nobody is viewing the dashboard (huge idle-cost saver)
const noViewer = () => CFG.ai.pauseWhenNoViewer && clients.size === 0;
let sumMark = -1, remMark = -1;
async function summaryTick() {
  if (busy.sum || !CFG.ai.enabled) return;
  // seed the Living State once on boot even with no viewer (so the board/observation isn't empty);
  // after that, pause when nobody's watching to save cost. Multi-chat spaces use groundBizTick instead.
  const seedOnce = !living.at && !IS_BIZLIKE;
  if (!seedOnce && noViewer()) return;
  if (S.store.messages.length === sumMark) return;   // idle-skip: nothing new
  sumMark = S.store.messages.length; busy.sum = true;
  try {
    // incremental: fold recent messages into the Living State memory + produce 实时观察.
    // multi-chat spaces need a wider recent window than a 1:1 relationship.
    const tail = S.store.messages.slice(IS_BIZLIKE ? -60 : -20);
    const r = await observeLiving(living.memory, tail);
    if (r) {
      living.memory = r.memory; living.at = Date.now();
      if (r.observation) { living.observation = r.observation; saveLiving(); S.store.ai.insight = r.observation; S.store.ai.insightAt = Date.now(); broadcast('insight', { insight: r.observation, at: S.store.ai.insightAt }); }
      else saveLiving();
    } else log('observe: null (parse/empty/rate-limited)');
  } catch (e) { log('observe err', e.message); } finally { busy.sum = false; }
}

// adaptive 实时观察 cadence: calm ~5min, warming ~2min, heat/crisis ~30s (near real-time)
let summaryTimer = null, summaryFireAt = 0;
function recentHeat() {
  const now = Date.now(); let h = 0, care = false;
  for (const m of S.store.messages) if (m.ts >= now - 8 * 60000) { h += (m._tag?.conflict || 0); if (m._tag?.care) care = true; }
  return { h, care };
}
function summaryDelay() {
  const { h, care } = recentHeat();
  if (care || h >= 15) return CFG.ai.summaryHeatMs || 30000;   // 激烈/危机 → 近实时
  if (h >= 5) return 120000;                                    // 升温 → 2分钟
  return CFG.ai.summaryCalmMs || 300000;                        // 平静 → 5分钟
}
function armSummary(delay) {
  if (summaryTimer) clearTimeout(summaryTimer);
  summaryFireAt = Date.now() + delay;
  summaryTimer = setTimeout(async () => { await summaryTick(); armSummary(summaryDelay()); }, delay);
}
// event-driven: a conflict/care message just arrived → pull the next observation in soon
function bumpSummaryOnHeat(tag) {
  if (!tag || !(tag.conflict > 0 || tag.care)) return;
  const soon = Date.now() + (CFG.ai.summaryHeatMs || 30000);
  if (soon < summaryFireAt) armSummary(CFG.ai.summaryHeatMs || 30000);
}

async function reminderTick() {
  if (busy.rem || !CFG.ai.enabled) return;
  const seedOnce = remMark === -1 && !reminders.size;   // seed todos once on boot even w/o viewer
  if (!seedOnce && noViewer()) return;
  if (S.store.messages.length === remMark) return;   // idle-skip: nothing new
  remMark = S.store.messages.length; busy.rem = true;
  try {
    const label = CFG.target.name || CFG.name || '';
    const items = await extractTodos(S.store.messages, label, !IS_BIZLIKE);
    const added = items.length ? mergeExtracted(items, Date.now(), 'main', label) : 0;
    if (added) log(`+${added} todos`);
    broadcast('reminders', listReminders());
  } catch (e) { log('reminder err', e.message); } finally { busy.rem = false; }
}
// daily re-grounding: rebuild Living State memory from raw + refresh 近期动态 (1 AI call)
let busyNar = false;
async function narrativeTick() {
  if (busyNar || !CFG.ai.enabled) return; busyNar = true;
  log('ground/narrative run');
  try {
    const recent = S.store.messages.filter((m) => m.ts >= Date.now() - 7 * 86400000);
    const r = await groundLiving(recent.length >= 5 ? recent : S.store.messages);
    if (!r) { log('ground: null (parse/empty)'); return; }
    living.memory = r.memory; living.narrative = r.narrative; living.groundedAt = Date.now(); saveLiving();
    narrative = r.narrative;
    writeData('narrative.json', r.narrative);
    broadcast('narrative', r.narrative);
    log('living re-grounded + narrative refreshed');
  } catch (e) { log('ground err', e.message); } finally { busyNar = false; }
}
// FULL regeneration of 档案 + 视角 (2 AI calls). Runs on boot if stale + daily at 20:00.
let busyRegen = false;
async function regenTick() {
  if (busyRegen || !CFG.ai.enabled) return; busyRegen = true;
  log('regenTick: regenerating 档案 + 视角');
  try {
    const recent = S.store.messages.filter((m) => m.ts >= Date.now() - 30 * 86400000);
    const [archive, perspectives] = await Promise.all([regenerateArchive(recent), regeneratePerspectives(recent)]);
    regen = { archive: archive || regen?.archive || null, perspectives: perspectives || regen?.perspectives || null, at: Date.now() };
    writeData('regen.json', regen);
    broadcast('regen', regen);
    log(`regen done: ${archive?.episodes?.length || 0} episodes, perspectives ${perspectives ? 'ok' : 'fail'}`);
  } catch (e) { log('regen err', e.message); } finally { busyRegen = false; }
}
let busyCheckup = false;
async function checkupTick() {
  if (busyCheckup || !CFG.ai.enabled) return; busyCheckup = true;
  log('checkupTick: generating 关系体检');
  try {
    // sample broadly: recent windows + conflict/care-heavy windows for evidence
    const windows = corpus ? corpus.search('吵架 冲突 生气 难过 开心 想你 道歉 在乎 期待 未来', 12) : [];
    const r = await relationshipCheckup(assembleCtx(), windows);
    if (r && r.report) {
      checkup = r;
      writeData('checkup.json', checkup);
      broadcast('checkup', checkup);
      log('checkup done');
    }
  } catch (e) { log('checkup err', e.message); } finally { busyCheckup = false; }
}
function msUntil(hour) {
  const now = new Date(); const t = new Date(now); t.setHours(hour, 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t - now;
}

// reconcile open todos against your subsequent replies — auto-stash addressed/stale (1 call)
let busyRec = false, recMark = -1;
async function reconcileTick() {
  if (busyRec || !CFG.ai.enabled) return;
  const collapsed = collapseDuplicates(Date.now());  // local, no AI — drain reworded duplicates
  if (collapsed) { log(`collapsed ${collapsed} duplicate todos`); broadcast('reminders', listReminders()); }
  const seedOnce = recMark === -1;                   // run once on boot even with no viewer (clean the seed)
  if (!seedOnce && noViewer()) return;               // otherwise pause when nobody's watching
  // AI dedupe: merge semantically-duplicate todos the bigram heuristic misses (keep highest-scored per group)
  try {
    const openNow = listReminders().open.slice(0, 40);
    if (openNow.length >= 3) {
      const groups = await dedupeTodos(openNow.map((r, i) => ({ i, text: r.text })));
      let dm = 0;
      for (const g of groups) {
        const items = g.map((idx) => openNow[idx]).filter(Boolean);
        if (items.length < 2) continue;
        items.sort((a, b) => (b.score || 0) - (a.score || 0));   // keep the best-scored, stale the rest
        dm += mergeAway(items.slice(1).map((r) => r.id), Date.now());
      }
      if (dm) { log(`AI-merged ${dm} duplicate todos`); broadcast('reminders', listReminders()); }
    }
  } catch (e) { log('dedupe err', e.message); }
  if (S.store.messages.length === recMark) return;   // idle-skip the AI pass
  // reconcile the RESOLVABLE ones first: reply/discuss (answered?) > promise (done?) > sensitive
  const pri = { reply: 0, discuss: 1, promise: 2, sensitive: 3 };
  const open = listReminders().open
    .sort((a, b) => (pri[a.kind] - pri[b.kind]) || ((b.lastSeen || 0) - (a.lastSeen || 0))).slice(0, 20);
  if (open.length < 2) return;
  recMark = S.store.messages.length; busyRec = true;
  try {
    const todos = open.map((r, i) => ({ i, kind: r.kind, text: r.text, id: r.id }));
    const idByIndex = Object.fromEntries(todos.map((t) => [t.i, t.id]));
    // RAG: pull corpus-wide evidence for each todo so completion isn't limited to the recent tail
    const evidence = {};
    if (corpus) for (const t of todos) { const h = corpus.search(t.text, 4); if (h.length) evidence[t.i] = h.map((x) => String(x.text).replace(/\s+/g, ' ').slice(0, 140)).join(' ／ '); }
    const verdicts = await reconcileTodos(todos, S.store.messages, evidence);
    log(`reconcile verdict: addressed=${JSON.stringify(verdicts.addressed)} stale=${JSON.stringify(verdicts.stale)} (of ${todos.length})`);
    const changed = applyReconcile(verdicts, idByIndex, Date.now());
    if (changed) { log(`reconciled ${changed} todos (addressed/stale)`); broadcast('reminders', listReminders()); }
  } catch (e) { log('reconcile err', e.message); } finally { busyRec = false; }
}

// multi-chat grounding: build the full per-chat state (feeds the 概览 board). boot + daily.
let busyGround = false;
async function groundBizTick() {
  if (busyGround || !CFG.ai.enabled) return; busyGround = true;
  try {
    const r = await groundBusiness(S.store.messages, finishedItems());
    if (r && (r.memory || r.narrative)) {
      if (r.memory) { living.memory = r.memory; living.at = Date.now(); }
      if (r.narrative) { living.narrative = r.narrative; narrative = { narrative: r.narrative, at: Date.now() }; broadcast('narrative', narrative); }
      const obs = { headline: String(r.memory?.focus || '当前状态').slice(0, 20), summary: r.narrative || '', mood: '', activeTopics: [], alerts: (r.memory?.watchNow || []).slice(0, 3) };
      living.observation = obs; S.store.ai.insight = obs; S.store.ai.insightAt = Date.now();
      saveLiving();
      broadcast('insight', { insight: obs, at: S.store.ai.insightAt });
      log('ground: multi-chat state grounded');
    }
  } catch (e) { log('ground err', e.message); } finally { busyGround = false; }
}

// ---- HTTP ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serveFile(res, full) {
  const ext = extname(full);
  // live dashboard: HTML/JS/CSS must always revalidate so UI updates aren't stuck on stale cache.
  const noCache = ext === '.html' || ext === '.js' || ext === '.css';
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': noCache ? 'no-cache, must-revalidate' : 'public, max-age=86400',
  });
  res.end(readFileSync(full));
}
function json(res, obj, code = 200) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); }); }

// a request straight from this computer: loopback socket, loopback Host, and no proxy/tunnel headers
function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || '';
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  const proxied = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'tailscale-user-login'].some((h) => req.headers[h]);
  return /^(127\.|::1$|::ffff:127\.)/.test(ip) && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(host) && !proxied;
}
const NEEDS_PASSWORD_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relate</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#faf8f5;font:15px/1.7 -apple-system,"PingFang SC",sans-serif;color:#2d2a26}div{max-width:420px;padding:24px}</style></head>
<body><div><h2>先设置看板密码</h2><p>这个空间还没有密码，所以只能在运行 Relate 的电脑上打开。请在控制台（hub）→ 空间 → <b>访问</b> 里设置看板密码，保存并重启空间后再从手机访问。</p>
<p style="color:#7a746c">Set a dashboard password first: this space has none, so it only opens on the computer running Relate. Hub → Space → <b>Access</b> → set a password, save and restart the space.</p></div></body></html>`;

// public, non-secret description of this space for the dashboard (names, template, enabled plugins)
function spaceInfo() {
  const t = CFG.target || {};
  return {
    id: CFG.id || '', name: CFG.name || '', template: CONTEXT_TYPE,
    me: { name: CFG.me.name && CFG.me.name !== 'me' ? CFG.me.name : '' },
    target: { name: t.name || '', pronoun: t.pronoun || '', togetherDate: t.togetherDate || '', firstContactDate: t.firstContactDate || '' },
    org: { name: CFG.org?.name || '' },
    plugins: plugins.names,
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  // ---- ingest: bridges push canonical messages/episodes with the connector's bearer token ----
  if (req.method === 'POST' && (p === '/api/ingest' || p.startsWith('/api/ingest/'))) {
    const want = decodeURIComponent(p.slice('/api/ingest/'.length) || '');
    const c = want ? sources?.get(want) : sources?.firstOfType('ingest');
    if (!c || c.type !== 'ingest') return json(res, { ok: false, error: 'no ingest connector' + (want ? ` "${want}"` : '') }, 404);
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!c.checkToken(bearer)) return json(res, { ok: false, error: 'bad or missing ingest token' }, 401);
    const r = c.accept(await body(req));
    if (r.added) broadcast('stats', S.snapshot());
    return json(res, r, r.ok ? 200 : 400);
  }

  // ---- no password = this computer only: a tunnel, proxy or LAN visitor never sees an unprotected space ----
  if (!auth.authEnabled() && !isLocalRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(NEEDS_PASSWORD_HTML);
  }

  // ---- auth gate ----
  if (p === '/login') {
    if (req.method === 'POST') {
      let pw = ''; try { pw = JSON.parse(await auth.readBody(req)).password; } catch {}
      if (auth.checkPassword(pw)) { auth.setAuthCookie(res); return json(res, { ok: true }); }
      return json(res, { ok: false }, 401);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(auth.LOGIN_HTML);
  }
  if (auth.authEnabled() && !auth.isPublicPath(p) && !auth.isAuthed(req)) {
    if (p.startsWith('/api/') || p === '/stream' || p === '/mcp' || req.method !== 'GET') return json(res, { error: 'unauthorized' }, 401);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(auth.LOGIN_HTML);
  }

  // MCP service: every chat + the board, read-only, for Claude Code / Desktop / scripts (Bearer apiToken)
  if (p === '/mcp') { try { await handleMcp(req, res, req.method === 'POST' ? await body(req) : undefined); } catch (e) { log('mcp err', e.message); if (!res.headersSent) json(res, { error: 'mcp failure' }, 500); } return; }

  if (p === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('retry: 3000\n\n');
    res.write(`event: stats\ndata: ${JSON.stringify(S.snapshot())}\n\n`);
    res.write(`event: reminders\ndata: ${JSON.stringify(listReminders())}\n\n`);
    const wasEmpty = clients.size === 0;
    clients.add(res);
    // first viewer arrived → refresh soon so the dashboard isn't stale when you open it
    if (wasEmpty && CFG.ai.enabled) { armSummary(2000); setTimeout(reminderTick, 5000); setTimeout(reconcileTick, 9000); }
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  { const h = plugins.route(req.method, p); if (h) { try { return await h(req, res); } catch (e) { log('plugin route err', e.message); return json(res, { error: e.message }, 500); } } }
  if (p === '/api/space') return json(res, spaceInfo());
  if (p === '/api/state') return json(res, S.snapshot());
  // ---- connectors, send, episodes ----
  if (p === '/api/connectors') return json(res, sources ? sources.describe() : []);
  if (sources && p.startsWith('/api/connectors/')) {
    const [, , , cid, action] = p.split('/');
    const c = sources.get(decodeURIComponent(cid));
    if (!c) return json(res, { ok: false, error: 'unknown connector' }, 404);
    if (action === 'test' && req.method === 'POST') return json(res, c.test ? await c.test().catch((e) => ({ ok: false, error: e.message })) : { ok: true, info: 'no test available' });
    if (action === 'chats') return json(res, c.listChats ? await c.listChats().catch(() => []) : []);
    return json(res, { error: 'not found' }, 404);
  }
  if (p === '/api/send' && req.method === 'POST') {
    if (!sources) return json(res, { ok: false, error: 'connectors not started' }, 503);
    const b = await body(req);
    return json(res, await sources.send({ chatId: b.chatId, text: b.text, connector: b.connector }).catch((e) => ({ ok: false, error: e.message })));
  }
  if (p === '/api/episodes') return json(res, sources ? sources.listEpisodes(Number(u.searchParams.get('limit')) || 50) : []);
  if (p === '/api/analytics') return json(res, { ...computeAnalytics(S.store.messages), target: spaceInfo().target });
  if (p === '/api/trends') return json(res, !IS_BIZLIKE ? relTrends(S.store.messages, Date.now()) : {});
  if (p === '/api/contacts') return json(res, IS_BIZLIKE ? { contacts: bizTrends(S.store.messages, SESSIONS, Date.now()) } : { contacts: [] });
  if (p === '/api/mood') return json(res, IS_BIZLIKE ? bizMood(S.store.messages, SESSIONS, Date.now()) : {});
  if (p === '/api/analyze/backfill' && req.method === 'POST') { const b = await body(req); backfillAnalysis(b.weeks || 8).catch((e) => log('backfill err', e.message)); return json(res, { ok: true, note: '已开始补分析（后台进行，情绪趋势会陆续填充）' }); }
  if (p === '/api/game') return json(res, computeGame(computeAnalytics(S.store.messages), S.store.messages, gameState));
  if (p === '/api/narrative') return json(res, narrative || living.narrative || {});
  if (p === '/api/living') return json(res, { memory: activeMemory(), at: living.at, groundedAt: living.groundedAt });
  if (p === '/api/living/dismiss' && req.method === 'POST') { const b = await body(req); const ok = dismissLiving(b.text); if (ok) broadcast('insight', { insight: living.observation, at: S.store.ai.insightAt }); return json(res, { ok }); }
  if (p === '/api/notify/test') { const r = await sendPush('Relate', '✅ 测试通知：推送已连通', { click: CFG.notify?.dashboardUrl }); return json(res, r); }
  if (p === '/api/push/vapid') return json(res, { key: vapidPublic(), subs: subCount() });
  if (p === '/api/push/subscribe' && req.method === 'POST') { const b = await body(req); const n = addSub(b.subscription || b); log(`push subscription added (${n} total)`); return json(res, { ok: true, subs: n }); }
  if (p === '/api/regen') return json(res, regen || {});
  if (p === '/api/regen/run' && req.method === 'POST') { regenTick(); return json(res, { ok: true, note: '已触发重新生成' }); }
  if (p === '/api/notes' && req.method === 'GET') return json(res, { notes: listNotes() });
  if (p === '/api/notes' && req.method === 'POST') { const b = await body(req); const n = addNote(b.text); return json(res, n ? { ok: true, note: n } : { ok: false }, n ? 200 : 400); }
  if (p.startsWith('/api/notes/') && req.method === 'DELETE') { const ok = deleteNote(decodeURIComponent(p.slice('/api/notes/'.length))); return json(res, { ok }); }
  // approval queue: proposed side-effectful actions await your ✓ here before executing
  if (p === '/api/approvals') return json(res, { pending: pendingApprovals(), recent: listApprovals(30) });
  if (p.startsWith('/api/approvals/') && p.endsWith('/approve') && req.method === 'POST') {
    const r = await approveAction(decodeURIComponent(p.slice('/api/approvals/'.length, -'/approve'.length)));
    broadcast('approvals', { pending: pendingCount() }); return json(res, r);
  }
  if (p.startsWith('/api/approvals/') && p.endsWith('/reject') && req.method === 'POST') {
    const r = rejectAction(decodeURIComponent(p.slice('/api/approvals/'.length, -'/reject'.length)));
    broadcast('approvals', { pending: pendingCount() }); return json(res, r);
  }
  if (p === '/api/checkup') return json(res, checkup || { report: '', at: null });
  if (p === '/api/checkup/run' && req.method === 'POST') { checkupTick(); return json(res, { ok: true, note: '正在生成关系体检…' }); }
  if (p.startsWith('/api/game/quest/') && p.endsWith('/toggle') && req.method === 'POST') {
    const id = decodeURIComponent(p.slice('/api/game/quest/'.length, -'/toggle'.length));
    const tk = new Date().toISOString().slice(0, 10);
    gameState.questDone = gameState.questDone || {};
    gameState.questDone[tk] = gameState.questDone[tk] || {};
    gameState.questDone[tk][id] = !gameState.questDone[tk][id];
    writeData('game.json', gameState);
    return json(res, { ok: true });
  }
  if (p === '/api/reminders') return json(res, listReminders());
  if (p === '/api/ai') return json(res, { ...aiStats, ...aiBudget(), daily: aiDaily(), enabled: CFG.ai.enabled, model: CFG.ai.model, corpus: corpus.size });

  // ---- multi-chat: list / open / create / delete persistent 问它 conversations ----
  if (p === '/api/chats' && req.method === 'GET') return json(res, { chats: chats.listChats() });
  if (p === '/api/chats' && req.method === 'POST') { const c = chats.createChat(); return json(res, { id: c.id, title: c.title, messages: [] }); }
  if (p.startsWith('/api/chats/') && req.method === 'GET') {
    const id = decodeURIComponent(p.slice('/api/chats/'.length));
    const c = chats.getChat(id); if (!c) return json(res, { error: 'not found' }, 404);
    return json(res, { id: c.id, title: c.title, messages: c.messages });
  }
  if (p.startsWith('/api/chats/') && req.method === 'DELETE') {
    chats.deleteChat(decodeURIComponent(p.slice('/api/chats/'.length))); return json(res, { ok: true });
  }

  // append the finished exchange to a chat + auto-title on first exchange
  async function persistExchange(cid, q, answer, hits, cited) {
    if (!cid) return;
    chats.appendMessage(cid, { role: 'user', content: q });
    chats.appendMessage(cid, { role: 'assistant', content: answer, hits: hits || null, cited: cited || null });
    const c = chats.getChat(cid);
    // title in the BACKGROUND — never block the reply on it
    if (c && !c.title) { chatTitle(q, answer).then((t) => { if (t) chats.setTitle(cid, t); }).catch(() => {}); }
  }
  // data mode = the assistant may call tools to fetch numbers (e.g. the sql-readonly plugin's run_sql)
  const dataMode = () => IS_BIZLIKE && hasTool('run_sql');

  if (p === '/api/ask') {
    let q = (u.searchParams.get('q') || '').trim(), history = [];
    let chatId = null;
    if (req.method === 'POST') { const b = await body(req); q = String(b.q || '').trim(); chatId = b.chatId || null; }
    if (!q) return json(res, { error: 'empty' }, 400);
    // resolve/create chat + server-authoritative history (consistent with the streaming endpoint)
    const cid = (chatId && chats.getChat(chatId)) ? chatId : chats.createChat().id;
    // "记住 X" → save a background fact instead of asking
    { const fact = extractRemember(q); if (fact) { const n = addNote(fact); const ans = n ? `✅ 记住了：${fact}\n\n（以后回答都会考虑这条。可在设置里查看/删除。）` : '这条太短，没记下来。'; await persistExchange(cid, q, ans, [], []); return json(res, { answer: ans, cited: [], hits: [], chatId: cid, remembered: !!n }); } }
    history = chats.historyFor(cid);
    // non-streaming fallback also handles census (returns the final report, no live progress)
    const census0 = detectCensus(q);
    if (census0) {
      try { const { report } = await censusAnalyze(census0, collectCensus(S.store.messages, census0), assembleCtx(), {}); await persistExchange(cid, q, report, [], []); return json(res, { answer: report, cited: [], hits: [], chatId: cid }); }
      catch (e) { return json(res, { answer: '(分析失败) ' + e.message, hits: [] }, 500); }
    }
    // retrieve on the last couple of turns + current q so follow-ups ("那怎么办") still find context
    const retrievalQ = [...history.filter((h) => h.role === 'user').slice(-2).map((h) => h.content), q].join(' ');
    const deep = isDeep(q);
    const hits = corpus.search(retrievalQ, deep ? 16 : 12);
    const hitMeta = hits.map((h, i) => ({ i, date: h.meta.date, dateEnd: h.meta.dateEnd, text: h.text.slice(0, 240), score: h.score }));
    try {
      const { answer, cited } = dataMode()
        ? await askWithData(q, hits, assembleCtx(), history, { deep })
        : await askAssistant(q, hits, assembleCtx(), history, deep);
      await persistExchange(cid, q, answer, hitMeta, cited);
      return json(res, { answer, cited, hits: hitMeta, chatId: cid });
    } catch (e) { return json(res, { answer: '(AI 调用失败) ' + e.message, hits: hitMeta }, 500); }
  }

  // voice endpoint (e.g. an iOS Shortcut): one persistent "voice" chat, concise no-markdown answers
  // for text-to-speech. Auth via cookie OR Bearer token. Returns { answer } as plain spoken text.
  if (p === '/api/voice' && (req.method === 'POST' || req.method === 'GET')) {
    let raw = ''; if (req.method === 'POST') { try { raw = await auth.readBody(req); } catch {} }
    let q = '', reset = false;
    try { const j = JSON.parse(raw); if (j && j.q != null) q = String(j.q); if (j && j.reset) reset = true; } catch {}   // JSON body {q}
    if (!q && raw && !raw.trim().startsWith('{')) q = raw;                                                                // plain-text body
    if (!q) q = u.searchParams.get('q') || '';                                                                            // ?q= (also works for GET)
    q = q.trim();
    if (reset) { voiceChatId = null; if (!q) return json(res, { answer: 'OK, starting fresh.' }); }
    if (!q) return json(res, { answer: "I didn't catch a question — say it again." });   // friendly, so the voice assistant speaks something
    if (!voiceChatId || !chats.getChat(voiceChatId)) voiceChatId = chats.createChat('🎙️ 语音').id;
    const cid = voiceChatId;
    { const fact = extractRemember(q); if (fact) { const n = addNote(fact); const ans = n ? `Got it — I'll remember that: ${fact}` : 'That was too short to save.'; await persistExchange(cid, q, ans, [], []); return json(res, { answer: ans, chatId: cid }); } }
    const history = chats.historyFor(cid);
    const retrievalQ = [...history.filter((h) => h.role === 'user').slice(-2).map((h) => h.content), q].join(' ');
    const hits = corpus.search(retrievalQ, 12);
    try {
      const vq = q + '\n\n[Answer in spoken English only — brief, no symbols. This is read aloud.]';
      const { answer } = dataMode()
        ? await askWithData(vq, hits, assembleCtx(), history, { voice: true, fast: true })
        : await askAssistant(vq, hits, assembleCtx(), history, false, true);
      const spoken = stripMarkdown(answer);
      await persistExchange(cid, q, spoken, [], []);
      return json(res, { answer: spoken, chatId: cid });
    } catch (e) { return json(res, { answer: '出错了：' + e.message }, 500); }
  }

  // streaming ask: NDJSON — {type:'meta'|'token'|'progress'|'done'|'error'}. Headers flush immediately so
  // proxy timeouts never trigger and tokens render live in the browser.
  if (p === '/api/ask/stream' && req.method === 'POST') {
    const b = await body(req);
    const q = String(b.q || '').trim();
    if (!q) return json(res, { error: 'empty' }, 400);
    // resolve/create the chat; history comes from the store (server-authoritative)
    const cid = (b.chatId && chats.getChat(b.chatId)) ? b.chatId : chats.createChat().id;
    const history = chats.historyFor(cid);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive' });
    const send = (o) => { try { res.write(JSON.stringify(o) + '\n'); } catch {} };
    // "记住 X" → save a background fact, no AI call
    { const fact = extractRemember(q); if (fact) { const n = addNote(fact); const ans = n ? `✅ 记住了：${fact}\n\n（以后回答都会考虑这条。）` : '这条太短，没记下来。'; send({ type: 'meta', hits: [], chatId: cid }); send({ type: 'token', t: ans }); await persistExchange(cid, q, ans, [], []); send({ type: 'done', cited: [], chatId: cid }); return res.end(); } }
    // aggregation/census question ("analyze ALL apologies") → exhaustive enumeration, not top-k RAG
    const census = detectCensus(q);
    if (census) {
      send({ type: 'meta', hits: [], chatId: cid });
      const collected = collectCensus(S.store.messages, census);
      try {
        const r = await censusAnalyze(census, collected, assembleCtx(), { onProgress: (msg) => send({ type: 'progress', msg }), onToken: (t) => send({ type: 'token', t }) });
        await persistExchange(cid, q, r.report, [], []);
        send({ type: 'done', cited: [], chatId: cid });
      } catch (e) { send({ type: 'error', message: String(e.message || e) }); }
      return res.end();
    }
    const retrievalQ = [...history.filter((h) => h.role === 'user').slice(-2).map((h) => h.content), q].join(' ');
    const deep = isDeep(q);
    const hits = corpus.search(retrievalQ, deep ? 16 : 12);
    const hitMeta = hits.map((h, i) => ({ i, date: h.meta.date, dateEnd: h.meta.dateEnd, text: h.text.slice(0, 240), score: h.score }));
    send({ type: 'meta', hits: hitMeta, chatId: cid });
    try {
      const { answer, cited } = dataMode()
        ? await askWithData(q, hits, assembleCtx(), history, { onToken: (t) => send({ type: 'token', t }), onProgress: (msg) => send({ type: 'progress', msg }), deep })
        : await askAssistantStream(q, hits, assembleCtx(), history, (t) => send({ type: 'token', t }), deep);
      await persistExchange(cid, q, answer, hitMeta, cited);
      send({ type: 'done', cited, chatId: cid });
    } catch (e) { send({ type: 'error', message: String(e.message || e) }); }
    return res.end();
  }

  // draft a reply: scope=main → the space's main conversation; scope=other&chat=<name> → that chat only
  if (p === '/api/reply-preview') {
    const scope = u.searchParams.get('scope') || 'main';
    const chat = u.searchParams.get('chat') || '';
    const isMain = scope === 'main';
    const pool = isMain ? S.store.messages : S.store.messages.filter((m) => !chat || m.sessionName === chat);
    const tail = pool.slice(-16);
    const label = isMain ? (CFG.target.name || CFG.name || '对方') : (chat || '对方');
    if (!tail.length) return json(res, { error: '没有可参考的对话' }, 400);
    const q = tail.slice(-6).map((m) => m.content).join(' ');
    const ragSnippets = isMain ? corpus.search(q, 6) : [];
    try {
      const d = await draftReply({ label, isMain, tail, ragSnippets });
      return json(res, { ...d, basedOn: ragSnippets.map((s) => ({ date: s.meta.date, who: s.meta.who, text: s.text.slice(0, 120) })) });
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  if (p.startsWith('/api/reminders/') && p.endsWith('/toggle') && req.method === 'POST') {
    markDone(decodeURIComponent(p.slice('/api/reminders/'.length, -'/toggle'.length)), Date.now());
    broadcast('reminders', listReminders()); return json(res, { ok: true });
  }
  if (p === '/api/reminders/clear-done' && req.method === 'POST') { clearDone(); broadcast('reminders', listReminders()); return json(res, { ok: true }); }

  const file = p === '/' ? '/index.html' : p;
  const full = join(PUB, file.replace(/\.\./g, ''));
  if (!full.startsWith(PUB) || full.startsWith(join(PUB, 'hub'))) { res.writeHead(404); return res.end('not found'); }
  if (existsSync(full) && extname(full)) return serveFile(res, full);
  res.writeHead(404); res.end('not found');
});

// ---- boot ----
async function main() {
  loadReminders();
  const retired = retireSensitive(Date.now());        // 敏感点 now live in the Living State memory
  if (retired) log(`retired ${retired} sensitive todos -> Living State`);
  loadLiving();                                       // evolving Living State memory
  if (living.narrative) narrative = living.narrative;
  if (living.observation) { S.store.ai.insight = living.observation; S.store.ai.insightAt = living.at; }
  const BIZ = IS_BIZLIKE;
  const persisted = S.loadPersisted();                // messages captured by earlier runs (messages.jsonl)
  S.store.messages.sort((a, b) => a.ts - b.ts);
  log(`loaded ${persisted} persisted messages`);
  buildCorpus();
  initMcp({ store: S.store, corpus: () => corpus, sessions: SESSIONS, living, activeMemory, listReminders, listNotes });

  sources = createSources({
    CFG, S, corpus: { add: (d) => corpus.add(d) }, broadcast, log, dataDir: DATA_DIR, extraTypes: await pluginConnectorTypes(),
    onMessage: (m) => {
      broadcast('message', m); broadcast('stats', S.snapshot());
      if (m._tag?.care && !BIZ) broadcast('care', { at: m.ts, text: m.content.slice(0, 80), dir: m._tag.dir });
      if (BIZ) bumpGroundSoon(); else bumpSummaryOnHeat(m._tag);
    },
  });
  await sources.startAll();
  buildCorpus();

  // core tools the assistant can call
  registerTool({
    name: 'list_open_todos', readOnly: true,
    description: '列出当前未完成的待办/承诺/需要回复的事项（已排序）。问到"我还有什么没做/待办/承诺"时用。',
    progress: () => '读取待办清单…',
    run: async () => { const r = listReminders(); return { open: (r.topRanked || r.open || []).slice(0, 20).map((t) => ({ text: t.text, kind: t.kind, score: t.score })) }; },
  });
  // outbound messages from the assistant are side-effectful → approval queue (readOnly:false)
  registerTool({
    name: 'send_message', readOnly: false,
    description: '通过已连接的平台给某个对话发送一条消息（需要用户在面板批准后才会真正发送）。只在用户明确要求发送时使用。',
    parameters: { type: 'object', properties: { chatId: { type: 'string', description: '对话 id（list 里的 session）' }, text: { type: 'string' } }, required: ['chatId', 'text'] },
    preview: (a) => `发送到 ${NAMES[a.chatId] || a.chatId}：${String(a.text || '').slice(0, 120)}`,
    progress: () => '准备发送…',
    run: (a) => sources.send({ chatId: a.chatId, text: a.text }),
  });
  setExecutor(executeTool);   // approval queue runs actions through the tool registry once approved
  plugins = await activatePlugins({
    CFG, log, broadcast, registerTool, dataDir: DATA_DIR,
    store: S.store, messages: () => S.store.messages, living: () => living, reminders: () => listReminders(),
    send: (chatId, text, connector) => sources.send({ chatId, text, connector }),
    notify: (title, text, opts = {}) => sendPush(title, text, { click: CFG.notify?.dashboardUrl, ...opts }),
    addApproval,
  });
  setInterval(() => broadcast('stats', S.snapshot()), 4000);
  setInterval(() => S.saveSnapshotFile(), 60000);

  if (CFG.ai.enabled) {
    // todos + Living State run for every template (extract, score, auto-reconcile "what's done")
    armSummary(12000);
    setTimeout(analysisTick, 8000); setInterval(analysisTick, CFG.ai.analyzeIntervalMs || 20000);   // per-message sentiment; viewer-gated
    setInterval(reminderTick, CFG.ai.reminderIntervalMs);
    setInterval(reconcileTick, CFG.ai.reconcileIntervalMs || CFG.ai.reminderIntervalMs);
    setTimeout(reminderTick, 22000);
    setTimeout(reconcileTick, 70000);
    if (!BIZ) {
      // relationship-only: twice-daily re-grounding + 档案/视角 + 关系体检
      setInterval(narrativeTick, 12 * 3600000);
      if (!living.groundedAt || Date.now() - living.groundedAt > 12 * 3600000) setTimeout(narrativeTick, 35000);
      if (!regen || Date.now() - regen.at > 20 * 3600000) setTimeout(regenTick, 45000);
      if (!checkup || Date.now() - (checkup.at || 0) > 20 * 3600000) setTimeout(checkupTick, 90000);
      setTimeout(() => { regenTick(); setTimeout(checkupTick, 60000); setInterval(() => { regenTick(); setTimeout(checkupTick, 60000); }, 24 * 3600000); }, msUntil(20));
    } else {
      // multi-chat: full per-chat grounding builds the 概览 board — on boot (if stale) + daily
      if (!living.at || Date.now() - living.at > 20 * 3600000) setTimeout(groundBizTick, 6000);
      setTimeout(() => { groundBizTick(); setInterval(groundBizTick, 24 * 3600000); }, msUntil(6));
    }
  }

  // loopback only by default; set "host": "0.0.0.0" in the space config to expose it on your network
  server.listen(CFG.port, CFG.host || '127.0.0.1', () => log(`\n  space "${CFG.name || CFG.id || CONTEXT_TYPE}" -> http://${CFG.host || '127.0.0.1'}:${CFG.port}\n  history ${S.store.messages.length} msgs · template ${CONTEXT_TYPE} · AI ${CFG.ai.enabled ? CFG.ai.model : 'off'}\n`));
}
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e)));
main();
