// WeChat via WeFlow's local HTTP API (read-only). WeFlow must be installed and running separately;
// this connector ships no decryption code. WeFlow exposes no send endpoint, so capabilities.send=false.
import { createClient } from '../weflow-client.js';
import { makeMessage, initialStatus } from './connector.js';

const TYPE = { 1: 'text', 3: 'image', 34: 'voice', 43: 'video', 47: 'image', 49: 'file', 10000: 'system' };
const kindOf = (id) => (String(id).endsWith('@chatroom') ? 'group' : 'dm');

export default {
  type: 'weflow',
  label: 'WeChat (via WeFlow)',
  platform: 'wechat',
  capabilities: { live: true, history: true, send: false, episodes: false },
  description: 'Reads WeChat through the WeFlow desktop app\'s local API. Install and run WeFlow yourself, then paste its API token. Read-only.',
  configSchema: [
    { key: 'base', label: 'WeFlow API URL', type: 'url', default: 'http://127.0.0.1:5031', required: true },
    { key: 'token', label: 'WeFlow access token', type: 'secret', required: true, help: 'WeFlow → Settings → HTTP API' },
    { key: 'meIds', label: 'Your WeChat IDs', type: 'list', help: 'wxid(s) of your own account — used to mark live messages as sent by you' },
    { key: 'resyncSec', label: 'History resync (seconds)', type: 'number', default: 45, help: 'Re-pulls recent messages per chat so gaps self-heal when the live push is quiet' },
  ],
  create(cfg, ctx) {
    const client = createClient(String(cfg.base).replace(/\/+$/, ''), cfg.token);
    const me = new Set((cfg.meIds || []).map(String));
    const names = new Map();   // username -> display name (from sessions/contacts)
    let stopPush = null;
    const conn = {
      id: cfg.id, type: 'weflow', platform: 'wechat',
      capabilities: { live: true, history: true, send: false, episodes: false },
      resyncSec: Number(cfg.resyncSec) || 45,
      status: initialStatus(),
      async start() {
        try { await loadNames(); } catch {}
        stopPush = client.subscribePush({
          onEvent: (event, o) => {
            if (event !== 'message.new' || !o || !o.content) return;
            const chatId = o.sessionId || o.talker || '';
            const sender = o.senderUsername || o.fromUser || '';
            ctx.onMessage(makeMessage({
              id: o.rawid || o.serverId, connector: cfg.id, platform: 'wechat',
              chatId, chatName: names.get(chatId) || o.sourceName || chatId, chatKind: kindOf(chatId),
              ts: o.timestamp, senderId: sender, senderName: names.get(sender) || o.sourceName || sender,
              fromMe: o.isSend === 1 || o.isSend === true || me.has(sender), text: o.content, type: 'text',
            }));
          },
          onStatus: (up, info) => setStatus(up ? 'up' : 'down', info),
        });
      },
      stop() { stopPush?.(); stopPush = null; setStatus('idle', 'stopped'); },
      async listChats() {
        const ss = await client.getSessions();
        return ss.filter((s) => s.username && !s.username.startsWith('gh_'))
          .sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0))
          .map((s) => ({ chatId: s.username, name: s.displayName || s.username, kind: kindOf(s.username), lastTs: (s.lastTimestamp || 0) * 1000 }));
      },
      async getMessages(chatId, { limit = 50 } = {}) {
        const rows = await client.getMessages(chatId, limit, false, 20000);
        return rows.filter((r) => r.localType !== 10000).map((r) => makeMessage({
          id: r.serverId || r.localId, connector: cfg.id, platform: 'wechat',
          chatId, chatName: names.get(chatId) || chatId, chatKind: kindOf(chatId),
          ts: r.createTime, senderId: r.senderUsername || (r.isSend ? 'me' : chatId),
          senderName: names.get(r.senderUsername) || r.senderUsername || '', fromMe: !!r.isSend,
          text: r.content || '', type: TYPE[r.localType] || 'text', meta: { localType: r.localType, localId: r.localId },
        }));
      },
      async test() {
        try { const ss = await client.getSessions(); return { ok: true, info: `connected — ${ss.length} chats visible` }; }
        catch (e) { return { ok: false, error: /401/.test(e.message) ? 'WeFlow rejected the token' : `WeFlow not reachable: ${e.message}` }; }
      },
    };
    async function loadNames() {
      const [ss, cs] = await Promise.all([client.getSessions().catch(() => []), client.getContacts().catch(() => [])]);
      for (const c of cs) if (c.username) names.set(c.username, c.remark || c.nickname || c.displayName || c.username);
      for (const s of ss) if (s.username) names.set(s.username, s.displayName || names.get(s.username) || s.username);
    }
    function setStatus(state, info) { conn.status = { state, info, at: Date.now() }; ctx.onStatus?.(conn.status); }
    return conn;
  },
};
