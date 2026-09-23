// Living State — the evolving, condensed relationship memory (persisted).
// observeLiving() updates it incrementally (cheap/frequent); groundLiving() re-anchors it daily.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';
import { domain } from './domain/index.js';

const FILE = join(DATA_DIR, 'living_state.json');
const EMPTY_MEMORY = domain.emptyMemory;

export const living = {
  memory: { ...EMPTY_MEMORY },
  narrative: null,          // 近期动态 view (from grounding)
  observation: null,        // 实时观察 (from incremental observe)
  at: 0,                    // last incremental update
  groundedAt: 0,            // last full re-anchor
  dismissed: {},            // normalized item text -> dismissedAt ms; Living-State lines you've ticked off
};

// Living-State items are AI-derived (no id) and regenerate on re-ground, so we can't "complete" them
// like a todo. Instead, ticking one records it here and we hide it until the TTL lapses — long enough
// that a handled item stays gone, short enough that a genuinely-still-open one eventually resurfaces.
const DISMISS_TTL = 14 * 24 * 3600 * 1000;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

export function loadLiving() {
  if (!existsSync(FILE)) return;
  try {
    const d = JSON.parse(readFileSync(FILE, 'utf8'));
    Object.assign(living, { memory: { ...EMPTY_MEMORY, ...(d.memory || {}) }, narrative: d.narrative || null, observation: d.observation || null, at: d.at || 0, groundedAt: d.groundedAt || 0, dismissed: d.dismissed || {} });
  } catch {}
}
export function saveLiving() {
  const now = Date.now();
  for (const [k, t] of Object.entries(living.dismissed || {})) if (now - t > DISMISS_TTL) delete living.dismissed[k];  // prune expired
  try { writeFileSync(FILE, JSON.stringify(living)); } catch {}
}

export function dismissLiving(text) {
  const k = norm(text); if (k.length < 2) return false;
  living.dismissed = living.dismissed || {};
  living.dismissed[k] = Date.now(); saveLiving(); return true;
}
// char-bigram overlap so a reworded version of a ticked-off item still counts as dismissed
function bigrams(s) { const c = norm(s).toLowerCase().replace(/[\s，。、,.:：;；!！?？()（）]/g, ''); const g = new Set(); for (let i = 0; i < c.length - 1; i++) g.add(c.slice(i, i + 2)); return g; }
function similar(a, b) {
  const A = bigrams(a), B = bigrams(b); if (A.size < 2 || B.size < 2) return norm(a) === norm(b);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size) >= 0.6;                       // one is largely contained in the other
}
export function isDismissed(text) {
  const now = Date.now(); const k = norm(text);
  const d = living.dismissed || {};
  if (d[k] != null && now - d[k] <= DISMISS_TTL) return true;           // exact
  for (const [key, t] of Object.entries(d)) if (now - t <= DISMISS_TTL && similar(text, key)) return true;   // reworded
  return false;
}
// the things you've recently ticked off (newest first) — fed to the AI as "already handled" context
export function dismissedList() {
  const now = Date.now();
  return Object.entries(living.dismissed || {})
    .filter(([, t]) => now - t <= DISMISS_TTL)
    .sort((a, b) => b[1] - a[1])
    .map(([text, at]) => ({ text, at }));
}
// memory with dismissed lines filtered out — what the board should render
export function activeMemory() {
  const m = living.memory || {};
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = Array.isArray(v) ? v.filter((x) => !isDismissed(typeof x === 'string' ? x : (x && x.text) || '')) : v;
  }
  return out;
}
