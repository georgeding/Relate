// Generic ingest connector — the "any platform" bridge. Three ways in/out:
//   1. PUSH:  an external bridge POSTs canonical messages/episodes to the space's /api/ingest/<id>
//             with `Authorization: Bearer <token>` (see docs/INGEST.md).
//   2. SSE:   optionally subscribe to an external Server-Sent-Events feed that emits the same JSON.
//   3. SEND:  optionally deliver outbound messages by POSTing to your bridge's webhook, signed with
//             HMAC-SHA256 so the bridge can verify it came from this space.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeMessage, makeEpisode, initialStatus } from './connector.js';

export const MAX_BATCH = 500;

// payload: a single Message, {messages:[…]}, {episodes:[…]}, or an array of messages
export function parsePayload(p) {
  if (Array.isArray(p)) return { messages: p, episodes: [] };
  if (p && typeof p === 'object') {
    if (Array.isArray(p.messages) || Array.isArray(p.episodes)) return { messages: p.messages || [], episodes: p.episodes || [] };
    if (p.turns) return { messages: [], episodes: [p] };
    if (p.text != null || p.chatId != null) return { messages: [p], episodes: [] };
  }
  return null;
}

export function sign(secret, body) { return 'sha256=' + createHmac('sha256', String(secret)).update(body).digest('hex'); }

export function safeEqual(a, b) {
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length === B.length && A.length > 0 && timingSafeEqual(A, B);
}

export default {
  type: 'ingest',
  label: 'Custom source (HTTP / SSE / webhook)',
  platform: 'custom',
  capabilities: { live: true, history: false, send: true, episodes: true },
  description: 'Connect anything: push messages to this space over HTTP, or point it at an SSE feed. Add a webhook URL to let the space send replies back through your bridge.',
  configSchema: [
    { key: 'platform', label: 'Platform name', type: 'string', default: 'custom', help: 'Shown on messages, e.g. whatsapp, slack, line' },
    { key: 'token', label: 'Ingest token', type: 'secret', required: true, help: 'Bridges send this as "Authorization: Bearer <token>"' },
    { key: 'sseUrl', label: 'SSE feed URL (optional)', type: 'url', help: 'Subscribe to an external event stream instead of / as well as HTTP push' },
    { key: 'sseHeaders', label: 'SSE request headers', type: 'list', help: 'One per line, "Header: value"' },
    { key: 'sendWebhook', label: 'Send webhook URL (optional)', type: 'url', help: 'Enables sending: we POST {chatId,text} here' },
    { key: 'sendSecret', label: 'Webhook signing secret', type: 'secret', help: 'Signs webhook bodies (X-Relate-Signature: sha256=…)' },
  ],
  create(cfg, ctx) {
    const platform = cfg.platform || 'custom';
    const chatsFile = ctx.dataDir ? join(ctx.dataDir, `ingest-${cfg.id}.chats.json`) : null;
    const chats = new Map();
    try { for (const c of JSON.parse(readFileSync(chatsFile, 'utf8'))) chats.set(c.chatId, c); } catch {}
    let saveTimer = null, sseCtl = null, stopped = true;
    const fetchImpl = cfg._fetch || ctx._fetch || fetch;

    const conn = {
      id: cfg.id, type: 'ingest', platform,
      capabilities: { live: true, history: false, send: !!cfg.sendWebhook, episodes: true },
      status: initialStatus(),
      checkToken(bearer) { return safeEqual(bearer, cfg.token); },
      // called by the engine for HTTP pushes and by the SSE loop; returns counts
      accept(payload) {
        const p = parsePayload(payload);
        if (!p) return { ok: false, error: 'unrecognised payload — send a message object, {messages:[…]} or {episodes:[…]}' };
        if (p.messages.length + p.episodes.length > MAX_BATCH) return { ok: false, error: `batch too large (max ${MAX_BATCH})` };
        let added = 0, skipped = 0;
        for (const raw of p.messages) {
          if (!raw || (raw.text == null && raw.chatId == null)) { skipped++; continue; }
          const m = makeMessage({ ...raw, connector: cfg.id, platform: raw.platform || platform });
          if (!m.chatId) { skipped++; continue; }
          remember(m.chatId, m.chatName, m.chatKind);
          if (ctx.onMessage(m)) added++; else skipped++;
        }
        for (const raw of p.episodes) {
          const e = makeEpisode({ ...raw, connector: cfg.id, platform: raw.platform || platform });
          if (!e.turns.length && !e.summary) { skipped++; continue; }
          if (ctx.onEpisode(e)) added++; else skipped++;
        }
        setStatus('up', `last push ${new Date().toLocaleTimeString()}`);
        return { ok: true, added, skipped };
      },
      async start() {
        stopped = false;
        setStatus(cfg.sseUrl ? 'connecting' : 'up', cfg.sseUrl ? 'subscribing to SSE feed' : 'waiting for pushes');
        if (cfg.sseUrl) sseLoop();
      },
      stop() { stopped = true; try { sseCtl?.abort(); } catch {} setStatus('idle', 'stopped'); },
      async listChats() { return [...chats.values()]; },
      async send(chatId, text) {
        if (!cfg.sendWebhook) return { ok: false, error: 'no send webhook configured' };
        const body = JSON.stringify({ chatId, text, connector: cfg.id, platform, ts: Date.now() });
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.sendSecret) headers['X-Relate-Signature'] = sign(cfg.sendSecret, body);
        try {
          const r = await fetchImpl(cfg.sendWebhook, { method: 'POST', headers, body, signal: AbortSignal.timeout(15000) });
          if (!r.ok) return { ok: false, error: `webhook HTTP ${r.status}` };
          let id = ''; try { id = (await r.json())?.id || ''; } catch {}
          const c = chats.get(chatId);
          ctx.onMessage(makeMessage({ id: id || undefined, connector: cfg.id, platform, chatId, chatName: c?.name, chatKind: c?.kind, ts: Date.now(), senderId: 'me', senderName: 'me', fromMe: true, text }));
          return { ok: true, id };
        } catch (e) { return { ok: false, error: `webhook failed: ${e.message}` }; }
      },
      async test() {
        const parts = [`HTTP push ready (${chats.size} chats seen)`];
        if (cfg.sseUrl) {
          try {
            const r = await fetchImpl(cfg.sseUrl, { headers: { Accept: 'text/event-stream', ...hdrs() }, signal: AbortSignal.timeout(6000) });
            try { await r.body?.cancel(); } catch {}
            if (!r.ok) return { ok: false, error: `SSE feed HTTP ${r.status}` };
            parts.push('SSE feed reachable');
          } catch (e) { return { ok: false, error: `SSE feed unreachable: ${e.message}` }; }
        }
        if (cfg.sendWebhook) parts.push('send webhook configured');
        return { ok: true, info: parts.join(' · ') };
      },
    };

    function hdrs() {
      const h = {};
      for (const line of cfg.sseHeaders || []) { const i = String(line).indexOf(':'); if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
      return h;
    }
    async function sseLoop() {
      let backoff = 1000, lastId = null;
      while (!stopped) {
        try {
          sseCtl = new AbortController();
          const headers = { Accept: 'text/event-stream', ...hdrs() };
          if (lastId) headers['Last-Event-ID'] = lastId;
          const r = await fetchImpl(cfg.sseUrl, { headers, signal: sseCtl.signal });
          if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
          setStatus('up', 'SSE connected'); backoff = 1000;
          let buf = ''; const dec = new TextDecoder();
          for await (const chunk of r.body) {
            buf += dec.decode(chunk, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2); let data = '';
              for (const line of block.split('\n')) {
                if (line.startsWith('id:')) lastId = line.slice(3).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
              }
              if (data) { try { conn.accept(JSON.parse(data)); } catch (e) { ctx.log?.(`ingest ${cfg.id}: bad SSE event: ${e.message}`); } }
            }
          }
        } catch (e) { if (!stopped) setStatus('down', `SSE: ${e.message}`); }
        if (stopped) break;
        await new Promise((r) => setTimeout(r, backoff)); backoff = Math.min(backoff * 1.6, 15000);
      }
    }
    function remember(chatId, name, kind) {
      const prev = chats.get(chatId);
      if (prev && prev.name === name) return;
      chats.set(chatId, { chatId, name: name || prev?.name || chatId, kind: kind || prev?.kind || 'dm' });
      if (chatsFile && !saveTimer) saveTimer = setTimeout(() => { saveTimer = null; try { writeFileSync(chatsFile, JSON.stringify([...chats.values()])); } catch {} }, 2000);
    }
    function setStatus(state, info) { conn.status = { state, info, at: Date.now() }; ctx.onStatus?.(conn.status); }
    return conn;
  },
};
