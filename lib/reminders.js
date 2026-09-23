// Open-loop / reminder tracker. Deduped, persisted, manually dismissable.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = join(DATA_DIR, 'reminders.json');

export const reminders = new Map(); // id -> reminder

function norm(s) { return String(s || '').toLowerCase().replace(/[\s\p{P}]+/gu, '').slice(0, 24); }
// dedup on normalized text only (NOT kind) so "promise" vs "request" wordings of the
// same underlying item collapse into one.
function idFor(r) { return norm(r.text); }

// fuzzy similarity (char-bigram Jaccard) to catch reworded near-duplicates the id misses
function bigrams(s) { const t = String(s || '').toLowerCase().replace(/[\s\p{P}]+/gu, ''); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; }
function similar(a, b, thr = 0.6) {
  const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return false;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter) >= thr;
}
// find an existing OPEN reminder in the same scope that's a near-duplicate of `text`
function findSimilarOpen(text, scope) {
  for (const r of reminders.values()) if (r.status === 'open' && r.scope === scope && similar(r.text, text)) return r;
  return null;
}
// collapse existing near-duplicate OPEN todos: keep the highest-score, stale the rest. Local, no AI.
export function collapseDuplicates(nowMs) {
  const open = [...reminders.values()].filter((r) => r.status === 'open').sort((a, b) => (b.score || 0) - (a.score || 0));
  let merged = 0;
  for (let i = 0; i < open.length; i++) {
    const keep = open[i]; if (keep.status !== 'open') continue;
    for (let j = i + 1; j < open.length; j++) {
      const dup = open[j]; if (dup.status !== 'open' || dup.scope !== keep.scope) continue;
      if (similar(keep.text, dup.text)) { dup.status = 'stale'; dup.reason = '合并重复'; dup.resolvedAt = nowMs; merged++; keep.seen = (keep.seen || 1) + 1; }
    }
  }
  if (merged) save();
  return merged;
}

let seq = 1;

export function loadReminders() {
  if (!existsSync(FILE)) return;
  try {
    const arr = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const r of arr) { reminders.set(r.id, r); seq = Math.max(seq, (r.n || 0) + 1); }
  } catch {}
}

function save() {
  try { writeFileSync(FILE, JSON.stringify([...reminders.values()])); } catch {}
}

// merge freshly extracted items; keeps existing status, adds new ones.
// scope: 'main' | 'other' — which conversation these came from. nowMs passed in.
export function mergeExtracted(items, nowMs, scope = 'main', chatLabel = '') {
  let added = 0;
  for (const it of items) {
    const id = `${scope}|${idFor(it)}`;
    let ex = reminders.get(id);
    if (!ex) { const sim = findSimilarOpen(it.text, scope); if (sim) ex = sim; } // fuzzy: bump the near-dup instead of adding
    if (ex) {
      ex.lastSeen = nowMs;
      ex.seen = (ex.seen || 1) + 1;                 // mention frequency
      ex.urgency = it.urgency || ex.urgency;
      if (it.due) ex.due = it.due;
      if (it.credible !== undefined) ex.credible = it.credible;
      if (it.severity) ex.severity = Math.max(ex.severity || 0, it.severity);
      if (it.emotion) ex.emotion = Math.max(ex.emotion || 0, it.emotion);
      ex.score = scoreOf(ex, nowMs);
    } else {
      const r = {
        id, n: seq++,
        text: it.text, kind: it.kind, who: it.who,
        session: it.session || chatLabel, scope, chatLabel,
        credible: it.credible, urgency: it.urgency, due: it.due,
        severity: it.severity || 3, emotion: it.emotion || 3,
        seen: 1, status: 'open', createdAt: nowMs, lastSeen: nowMs,
      };
      r.score = scoreOf(r, nowMs);
      reminders.set(id, r);
      added++;
    }
  }
  save();
  return added;
}

// Priority matrix: severity + 时效性(urgency/due) + mention frequency + emotional score.
const URG_W = { high: 1, medium: 0.6, low: 0.3 };
export function scoreOf(r, nowMs = 0) {
  const sev = (r.severity || 3) / 5;
  let timeliness = URG_W[r.urgency] ?? 0.6;
  if (r.due && /今天|马上|现在|立刻|尽快|today/i.test(r.due)) timeliness = 1;
  const emotion = (r.emotion || 3) / 5;
  const freq = Math.min(1, (r.seen || 1) / 5);
  // sensitive/care kinds get a mild severity nudge
  const kindBoost = r.kind === 'sensitive' ? 0.08 : 0;
  const s = 0.30 * sev + 0.28 * timeliness + 0.22 * emotion + 0.20 * freq + kindBoost;
  return Math.round(Math.min(1, s) * 100);
}

// apply AI reconciliation verdicts. `verdict`: {addressed:[i...], stale:[i...]}, `idByIndex`: i -> id
export function applyReconcile(verdict, idByIndex, nowMs) {
  let changed = 0;
  const set = (list, status, reason) => {
    for (const i of list) {
      const r = reminders.get(idByIndex[i]); if (!r || r.status !== 'open') continue;
      r.status = status; r.reason = reason; r.resolvedAt = nowMs; changed++;
    }
  };
  set(verdict.addressed || [], 'addressed', '你已回应/兑现');
  set(verdict.stale || [], 'stale', '已冷却/过时');
  if (changed) save();
  return changed;
}

// merge duplicates: mark the given ids as stale ("合并重复"); keep counts on nothing (caller keeps best)
export function mergeAway(ids, nowMs) {
  let n = 0;
  for (const id of ids) { const r = reminders.get(id); if (r && r.status === 'open') { r.status = 'stale'; r.reason = '合并重复'; r.resolvedAt = nowMs; n++; } }
  if (n) save();
  return n;
}
export function markDone(id, nowMs) {
  const r = reminders.get(id);
  if (!r) return false;
  r.status = r.status === 'done' ? 'open' : 'done';
  r.doneAt = nowMs;
  save();
  return true;
}

export function clearDone() {
  for (const [id, r] of reminders) if (r.status === 'done') reminders.delete(id);
  save();
}

const URG = { high: 0, medium: 1, low: 2 };
const KINDS = ['reply', 'promise', 'discuss'];   // 敏感点 now come from the Living State memory

// one-time cleanup: retire old extracted sensitive todos (superseded by Living State landmines)
export function retireSensitive(nowMs) {
  let n = 0;
  for (const r of reminders.values()) if (r.status === 'open' && r.kind === 'sensitive') { r.status = 'stale'; r.reason = '移至关系状态记忆'; r.resolvedAt = nowMs; n++; }
  if (n) save();
  return n;
}
export function listReminders() {
  const all = [...reminders.values()];
  const open = all.filter((r) => r.status === 'open')
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (URG[a.urgency] - URG[b.urgency]));
  const done = all.filter((r) => r.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 20);
  const mainOpen = open.filter((r) => r.scope === 'main');
  const groups = {};
  for (const k of KINDS) groups[k] = mainOpen.filter((r) => r.kind === k);
  const stashed = all.filter((r) => (r.status === 'addressed' || r.status === 'stale') && r.scope === 'main')
    .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0)).slice(0, 30);
  return {
    open, done, groups, stashed,
    topRanked: mainOpen.slice(0, 10),
    rest: mainOpen.slice(10),
    counts: {
      open: mainOpen.length,
      high: mainOpen.filter((r) => r.urgency === 'high').length,
      reply: groups.reply.length,
      promise: groups.promise.length,
      discuss: groups.discuss.length,
      main: mainOpen.length,
      other: open.filter((r) => r.scope === 'other').length,
    },
  };
}
