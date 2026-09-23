import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');

// which config file to run — lets several instances run the SAME code with their own config.
// The hub launches each space with RELATE_CONFIG=<abs path to spaces/<id>/runtime.json>.
const CONFIG_FILE = process.env.RELATE_CONFIG || 'config.json';
const raw = JSON.parse(readFileSync(isAbsolute(CONFIG_FILE) ? CONFIG_FILE : join(ROOT, CONFIG_FILE), 'utf8'));

const ai = raw.ai || {};
// allow env overrides for the sensitive bits
export const CFG = {
  ringBufferSize: 120000,
  ...raw,
  port: Number(process.env.PORT || raw.port || 5050),
  target: { name: '', displayName: '', ...(raw.target || {}) },
  me: { name: 'me', ...(raw.me || {}) },
  connectors: Array.isArray(raw.connectors) ? raw.connectors : [],
  chats: Array.isArray(raw.chats) ? raw.chats : [],
  notify: { enabled: true, ...(raw.notify || {}) },
  ai: {
    batchSize: 16, reminderIntervalMs: 900000, reconcileIntervalMs: 1200000, maxCallsPerHour: 40, pauseWhenNoViewer: true,
    ...ai,
    base: process.env.AI_BASE || ai.base || '',
    key: process.env.AI_KEY || ai.key || '',
    model: process.env.AI_MODEL || ai.model || '',
    enabled: process.env.AI_ENABLED ? process.env.AI_ENABLED !== 'false' : (ai.enabled ?? !!(ai.base && ai.key)),
  },
};
if (!CFG.target.displayName) CFG.target.displayName = CFG.target.name;

// per-instance data directory (default 'data'); absolute paths (hub-managed spaces) used as-is
export const DATA_DIR = isAbsolute(raw.dataDir || '') ? raw.dataDir : join(ROOT, raw.dataDir || 'data');
try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// domain / template: relationship | business | team — gates domain-specific features
export const CONTEXT_TYPE = raw.contextType || raw.template || 'relationship';
// business and team spaces share the multi-chat engine path (per-chat board, grounding, no 1:1 KPIs)
export const IS_BIZLIKE = CONTEXT_TYPE === 'business' || CONTEXT_TYPE === 'team';
