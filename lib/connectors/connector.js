// Connector contract — decouples message SOURCES from the engine.
//
// A connector *type* (one per file in lib/connectors/) is a factory:
//   export default {
//     type: 'telegram', label: 'Telegram (bot)', platform: 'telegram',
//     capabilities: { live, history, send, episodes },   // what instances of this type can do
//     configSchema: [ { key, label, type, required?, default?, help?, options? } ],
//     create(cfg, ctx) -> Connector,
//   }
// configSchema field types: 'string' | 'secret' | 'number' | 'bool' | 'url' | 'path' | 'select' | 'list'
// The hub settings UI renders forms straight from configSchema, so adding a connector type needs no UI work.
//
// A Connector instance:
//   {
//     id, type, platform, capabilities,
//     start() -> Promise<void>          // begin live delivery via ctx.onMessage / ctx.onEpisode
//     stop()  -> void
//     listChats?()                   -> Promise<Chat[]>
//     getMessages?(chatId, {limit})  -> Promise<Message[]>          (history backfill)
//     send?(chatId, text)            -> Promise<{ ok, id?, error? }>  (only when capabilities.send)
//     test?()                        -> Promise<{ ok, info?, error? }> (settings "Test" button)
//     status                          // { state: 'idle'|'connecting'|'up'|'down'|'error', info, at }
//   }
// ctx (supplied by the engine): { onMessage(m), onEpisode(ep), onStatus(status), log(...a), dataDir }
//
// Everything a connector emits is canonical — the engine never sees platform shapes.

/**
 * @typedef {Object} Message
 * @property {string}  id         stable per connector+chat (platform msg id, or a content hash)
 * @property {string}  connector  connector instance id that produced it
 * @property {string}  platform   'wechat'|'telegram'|'whatsapp'|'plaud'|'custom'|…
 * @property {string}  chatId
 * @property {string}  chatName
 * @property {'dm'|'group'} chatKind
 * @property {number}  ts         epoch ms
 * @property {string}  senderId
 * @property {string}  senderName
 * @property {boolean} fromMe
 * @property {string}  text       plaintext ('' for pure media)
 * @property {'text'|'voice'|'image'|'video'|'file'|'system'} type
 * @property {object}  [meta]
 */

/**
 * Long-form recordings (Plaud, meeting notes, call transcripts). Kept OUT of the chat message stream so
 * they don't skew chat KPIs (who-replies, ratios); they go to RAG + Living-State grounding instead.
 * @typedef {Object} Episode
 * @property {string}  id
 * @property {string}  connector
 * @property {string}  platform
 * @property {string}  title
 * @property {number}  ts          start, epoch ms
 * @property {number}  [durationMs]
 * @property {string[]} participants
 * @property {{speaker:string, text:string, offsetMs?:number}[]} turns
 * @property {string}  [summary]
 * @property {string[]} [tags]      routing tags (space ids) — set by the hub's episode router
 * @property {object}  [meta]
 */

const s = (v) => (v == null ? '' : String(v));

export function makeMessage(p) {
  const m = {
    id: s(p.id), connector: s(p.connector), platform: s(p.platform) || 'custom',
    chatId: s(p.chatId), chatName: s(p.chatName || p.chatId), chatKind: p.chatKind === 'group' ? 'group' : 'dm',
    ts: normTs(p.ts), senderId: s(p.senderId), senderName: s(p.senderName || p.senderId),
    fromMe: p.fromMe === true || p.fromMe === 1 || p.fromMe === 'true',
    text: s(p.text), type: p.type || 'text', meta: p.meta && typeof p.meta === 'object' ? p.meta : {},
  };
  // no id from the source: derive one from the RAW timestamp, so a retried push (no ts → "now") dedupes
  if (!m.id) m.id = hashId(`${m.chatId}|${p.ts ?? ''}|${m.senderId}|${m.fromMe}|${m.text}`);
  return m;
}

export function makeEpisode(p) {
  const turns = Array.isArray(p.turns) ? p.turns.map((t) => ({ speaker: s(t.speaker) || '?', text: s(t.text), ...(t.offsetMs != null ? { offsetMs: Number(t.offsetMs) } : {}) })).filter((t) => t.text) : [];
  const e = {
    id: s(p.id), connector: s(p.connector), platform: s(p.platform) || 'custom', title: s(p.title) || 'Untitled recording',
    ts: normTs(p.ts), durationMs: p.durationMs != null ? Number(p.durationMs) : undefined,
    participants: Array.isArray(p.participants) ? p.participants.map(s) : [...new Set(turns.map((t) => t.speaker))],
    turns, summary: s(p.summary), tags: Array.isArray(p.tags) ? p.tags.map(s) : [], meta: p.meta && typeof p.meta === 'object' ? p.meta : {},
  };
  if (!e.id) e.id = hashId(`${e.title}|${p.ts ?? ''}|${turns.length}|${turns[0]?.text || ''}|${turns.at(-1)?.text || ''}`);
  return e;
}

// the engine's store key — unique across connectors
export const messageKey = (m) => `${m.connector}:${m.chatId}:${m.id}`;

// accept seconds, ms, ISO strings; default now
export function normTs(v) {
  if (v == null || v === '') return Date.now();
  if (typeof v === 'number' || /^\d+$/.test(String(v))) { const n = Number(v); return n < 1e12 ? n * 1000 : n; }
  const t = Date.parse(v); return Number.isFinite(t) ? t : Date.now();
}

export function hashId(str) {   // small stable non-crypto hash (FNV-1a 52-bit) — ids only, not security
  let h = 0xcbf29ce484222325n; const P = 0x100000001b3n;
  for (const ch of String(str)) { h ^= BigInt(ch.codePointAt(0)); h = (h * P) & 0xfffffffffffffn; }
  return h.toString(36);
}

export function validateConfig(schema, cfg) {
  const errors = [];
  for (const f of schema || []) {
    const v = cfg?.[f.key];
    if (f.required && (v == null || v === '')) errors.push(`${f.label || f.key} is required`);
    if (v != null && v !== '' && f.type === 'number' && !Number.isFinite(Number(v))) errors.push(`${f.label || f.key} must be a number`);
    if (v && f.type === 'url' && !/^(https?|wss?):\/\//i.test(String(v))) errors.push(`${f.label || f.key} must be a URL`);
    if (v && f.type === 'select' && f.options && !f.options.some((o) => (o.value ?? o) === v)) errors.push(`${f.label || f.key} has an invalid option`);
  }
  return errors;
}

export function withDefaults(schema, cfg) {
  const out = { ...(cfg || {}) };
  for (const f of schema || []) if ((out[f.key] == null || out[f.key] === '') && f.default !== undefined) out[f.key] = f.default;
  return out;
}

export function initialStatus() { return { state: 'idle', info: '', at: Date.now() }; }
