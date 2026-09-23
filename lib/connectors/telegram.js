// Telegram connector — official Bot API (sanctioned, no ban risk, supports send).
// Long-polls getUpdates; the offset is persisted so a restart never replays old updates.
// The Bot API can't enumerate chats, so listChats() returns the chats the bot has seen so far.
// The token is embedded in every API URL — anything that might surface it goes through redact().
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeMessage, withDefaults, initialStatus } from './connector.js';

const API = 'https://api.telegram.org';
const MAX_LEN = 4096;

const configSchema = [
  { key: 'botToken', label: 'Bot token', type: 'secret', required: true, help: 'From @BotFather — looks like 123456:ABC-…' },
  { key: 'allowedChatIds', label: 'Allowed chat ids', type: 'list', help: 'Only ingest these chats (empty = every chat the bot is in)' },
  { key: 'meName', label: 'Your name', type: 'string', default: 'me', help: 'Sender name used for messages the bot sends on your behalf' },
  { key: 'pollTimeoutSec', label: 'Long-poll timeout (s)', type: 'number', default: 25 },
];

export function redact(text, token) {
  let t = String(text ?? '');
  if (token) t = t.split(token).join('<redacted>');
  return t.replace(/bot\d{3,}:[A-Za-z0-9_-]{20,}/g, 'bot<redacted>');
}

// split at the last newline/space before the limit so words and lines stay intact when possible
export function splitText(text, max = MAX_LEN) {
  const out = []; let rest = String(text ?? '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut)); rest = rest.slice(cut).replace(/^[\n ]/, '');
  }
  if (rest.length || !out.length) out.push(rest);
  return out;
}

const toList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,\s]+/)).map((x) => String(x).trim()).filter(Boolean);
const fullName = (u) => (u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.title || String(u.id ?? '') : '');
function readJson(f, dflt) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return dflt; } }

function msgType(m) {
  if (m.voice || m.audio) return 'voice';
  if (m.photo || m.sticker) return 'image';
  if (m.video || m.video_note || m.animation) return 'video';
  if (m.document) return 'file';
  if (m.text != null || m.caption != null) return 'text';
  return 'system';
}

export function create(cfg = {}, ctx = {}) {
  const c = withDefaults(configSchema, cfg);
  const id = cfg.id || 'telegram';
  const token = String(c.botToken || '');
  const fetchFn = cfg._fetch || ctx._fetch || globalThis.fetch;
  const log = (...a) => ctx.log?.(...a.map((x) => redact(x instanceof Error ? x.message : x, token)));
  const allowed = new Set(toList(c.allowedChatIds));
  const dataDir = ctx.dataDir || '.';
  const offsetFile = join(dataDir, `telegram-${id}.offset.json`);
  const chatsFile = join(dataDir, `telegram-${id}.chats.json`);
  let offset = readJson(offsetFile, {}).offset || 0;
  const seen = readJson(chatsFile, {});
  let bot = null, stopped = true, ctl = null, loopPromise = null;

  const conn = {
    id, type: 'telegram', platform: 'telegram',
    capabilities: { live: true, history: false, send: true, episodes: false },
    status: initialStatus(),
  };
  const setStatus = (state, info = '') => { conn.status = { state, info: redact(info, token), at: Date.now() }; ctx.onStatus?.(conn.status); };

  async function call(method, params = {}, signal) {
    let res;
    try {
      res = await fetchFn(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal });
    } catch (e) { if (e?.name === 'AbortError') throw e; throw new Error(redact(`telegram ${method}: ${e?.message || e}`, token)); }
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) {
      const err = new Error(redact(`telegram ${method}: ${data?.description || `HTTP ${res.status}`}`, token));
      err.code = data?.error_code || res.status; err.retryAfter = data?.parameters?.retry_after;
      throw err;
    }
    return data.result;
  }

  function persistOffset() { try { mkdirSync(dataDir, { recursive: true }); writeFileSync(offsetFile, JSON.stringify({ offset })); } catch (e) { log('telegram offset save failed', e); } }
  function rememberChat(chat) {
    const key = String(chat.id);
    const entry = { name: chat.title || fullName(chat) || key, kind: chat.type === 'private' ? 'dm' : 'group' };
    if (seen[key]?.name === entry.name && seen[key]?.kind === entry.kind) return;
    seen[key] = entry;
    try { mkdirSync(dataDir, { recursive: true }); writeFileSync(chatsFile, JSON.stringify(seen)); } catch (e) { log('telegram chats save failed', e); }
  }

  function mapUpdate(u) {
    const m = u.message || u.edited_message || u.channel_post || u.edited_channel_post;
    if (!m || !m.chat) return null;
    const chatId = String(m.chat.id);
    if (allowed.size && !allowed.has(chatId)) return null;
    rememberChat(m.chat);
    const fromMe = !!(bot && m.from && m.from.id === bot.id);
    const sender = m.from || m.sender_chat || m.chat;
    return makeMessage({
      id: String(m.message_id), connector: id, platform: 'telegram',
      chatId, chatName: seen[chatId]?.name || chatId, chatKind: m.chat.type === 'private' ? 'dm' : 'group',
      ts: m.date, senderId: String(sender.id ?? ''), senderName: fromMe ? c.meName : fullName(sender),
      fromMe, text: m.text ?? m.caption ?? '', type: msgType(m),
      meta: {
        updateId: u.update_id,
        ...(u.edited_message || u.edited_channel_post ? { edited: true } : {}),
        ...(m.reply_to_message ? { replyTo: String(m.reply_to_message.message_id) } : {}),
      },
    });
  }

  const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); ctl?.signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

  async function loop() {
    let fails = 0;
    while (!stopped) {
      try {
        if (!bot) { bot = await call('getMe', {}, ctl.signal); setStatus('up', `@${bot.username}`); }
        const updates = await call('getUpdates', { offset, timeout: Number(c.pollTimeoutSec) || 25, allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'] }, ctl.signal);
        if (conn.status.state !== 'up') setStatus('up', `@${bot.username}`);
        fails = 0;
        if (updates.length) {
          for (const u of updates) {
            offset = Math.max(offset, u.update_id + 1);
            const msg = mapUpdate(u);
            if (msg) { try { ctx.onMessage?.(msg); } catch (e) { log('telegram onMessage threw', e); } }
          }
          persistOffset();
        }
      } catch (e) {
        if (stopped || e?.name === 'AbortError') break;
        fails++;
        const hint = e.code === 409 ? ' (another poller or a webhook is active for this bot)' : e.code === 401 ? ' (bad token)' : '';
        setStatus('down', e.message + hint);
        log(e.message + hint);
        await sleep(e.retryAfter ? e.retryAfter * 1000 : Math.min(1000 * 1.6 ** fails, 30000));
      }
    }
  }

  conn.start = async () => {
    if (!stopped) return;
    if (!token) { setStatus('error', 'botToken is required'); return; }
    stopped = false; ctl = new AbortController();
    setStatus('connecting');
    loopPromise = loop();
  };
  conn.stop = () => { stopped = true; ctl?.abort(); setStatus('idle', 'stopped'); };
  conn._loop = () => loopPromise;   // tests await this after stop()

  conn.listChats = async () => Object.entries(seen).map(([chatId, v]) => ({ chatId, name: v.name, kind: v.kind }));

  conn.send = async (chatId, text) => {
    try {
      let last = null;
      for (const part of splitText(text)) {
        last = await call('sendMessage', { chat_id: chatId, text: part });
        ctx.onMessage?.(makeMessage({
          id: String(last.message_id), connector: id, platform: 'telegram', chatId: String(chatId),
          chatName: seen[String(chatId)]?.name || last.chat?.title || fullName(last.chat) || String(chatId),
          chatKind: last.chat?.type && last.chat.type !== 'private' ? 'group' : 'dm', ts: last.date,
          senderId: String(bot?.id ?? last.from?.id ?? ''), senderName: c.meName, fromMe: true, text: part, type: 'text',
        }));
      }
      return { ok: true, id: last ? String(last.message_id) : undefined };
    } catch (e) { const error = redact(e.message, token); log(error); return { ok: false, error }; }
  };

  conn.test = async () => {
    if (!token) return { ok: false, error: 'botToken is required' };
    try { const me = await call('getMe'); return { ok: true, info: `@${me.username}` }; }
    catch (e) { return { ok: false, error: redact(e.message, token) }; }
  };

  return conn;
}

export default {
  type: 'telegram', label: 'Telegram (bot)', platform: 'telegram',
  capabilities: { live: true, history: false, send: true, episodes: false },
  configSchema, create,
};
