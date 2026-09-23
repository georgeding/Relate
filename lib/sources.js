// Platform-mode ingestion: runs the space's connectors and feeds their canonical output into the
// engine. Messages → the chat store (KPIs, todos, Living State). Episodes (recordings, transcripts)
// → an episode store + RAG, deliberately NOT the chat store so they don't skew chat metrics.
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { connectorTypes } from './connectors/index.js';
import { messageKey, withDefaults, validateConfig } from './connectors/connector.js';

const STORE_TYPE = { text: 1, image: 3, voice: 34, video: 43, file: 49 };

// Store session id for a canonical message. WeChat ids (wxid_…, …@chatroom) are globally unique and
// match data migrated from the legacy single-instance store, so they stay bare; every other platform
// is namespaced so e.g. Telegram chat 12345 can never collide with another platform's 12345.
export const sessionIdFor = (m) => (m.platform === 'wechat' ? m.chatId : `${m.platform}:${m.chatId}`);

// extraTypes: connector types contributed by plugins (the engine passes them in; this module stays config-free)
export function createSources({ CFG, S, corpus, broadcast, log, dataDir, onMessage, onEpisode, extraTypes = [] }) {
  const conns = new Map();                       // id -> connector instance
  const allow = new Map();                       // `${connector}|${chatId}` -> chat entry
  for (const c of CFG.chats || []) allow.set(`${c.connector}|${c.chatId}`, c);
  const acceptAll = allow.size === 0;
  const meName = CFG.me?.name || 'me';
  const epDir = join(dataDir, 'episodes');
  mkdirSync(epDir, { recursive: true });

  function allowed(m) {
    if (acceptAll) return m.chatKind === 'dm' || CFG.acceptGroups === true ? {} : null;   // no allowlist: DMs only unless opted in
    return allow.get(`${m.connector}|${m.chatId}`) || null;
  }

  function ingestMessage(m) {
    const entry = allowed(m);
    if (!entry || m.type === 'system') return false;
    if (!m.text && m.type === 'text') return false;
    const chatName = entry.name || m.chatName;
    const stored = S.addMessage({
      key: messageKey(m), ts: m.ts, session: sessionIdFor(m), sessionName: chatName,
      sender: m.fromMe ? 'me' : (m.senderId || m.chatId), senderName: m.fromMe ? meName : (m.senderName || chatName),
      isSend: m.fromMe ? 1 : 0, content: m.text || `[${m.type}]`, type: STORE_TYPE[m.type] || 1,
      voice: m.type === 'voice', source: 'live',
    });
    if (!stored) return false;
    stored.connector = m.connector; stored.platform = m.platform;
    if (stored.content.length > 1) corpus.add({ id: stored.key, text: `${stored.senderName}: ${stored.content}`, meta: { date: new Date(stored.ts).toLocaleString(), ts: stored.ts, chat: chatName } });
    onMessage?.(stored, entry);
    return true;
  }

  function ingestEpisode(e) {
    const file = join(epDir, `${e.id.replace(/[^\w.-]/g, '_')}.json`);
    if (existsSync(file)) return false;
    writeFileSync(file, JSON.stringify(e));
    indexEpisode(e);
    broadcast('episode', episodeMeta(e));
    onEpisode?.(e);
    log(`episode +1: "${e.title}" (${e.turns.length} turns)`);
    return true;
  }

  // chunk turns into ~600-char windows so RAG retrieves passages, not whole recordings
  function indexEpisode(e, target = corpus) {
    const date = new Date(e.ts).toLocaleString();
    if (e.summary) target.add({ id: `ep:${e.id}:sum`, text: `【${e.title}】${e.summary}`, meta: { date, ts: e.ts, episode: e.id } });
    let buf = [], len = 0, n = 0;
    const flush = () => { if (!buf.length) return; target.add({ id: `ep:${e.id}:${n++}`, text: `【${e.title}】\n${buf.join('\n')}`, meta: { date, ts: e.ts, episode: e.id } }); buf = []; len = 0; };
    for (const t of e.turns) { const line = `${t.speaker}: ${t.text}`; buf.push(line); len += line.length; if (len > 600) flush(); }
    flush();
  }
  const episodeMeta = (e) => ({ id: e.id, title: e.title, ts: e.ts, durationMs: e.durationMs, participants: e.participants, turns: e.turns.length, summary: e.summary?.slice(0, 280), platform: e.platform, tags: e.tags });

  // re-add every stored episode to a (freshly rebuilt) RAG corpus
  function reindexEpisodes(target = corpus) {
    let n = 0;
    for (const f of readdirSync(epDir).filter((x) => x.endsWith('.json'))) { try { indexEpisode(JSON.parse(readFileSync(join(epDir, f), 'utf8')), target); n++; } catch {} }
    return n;
  }
  function listEpisodes(limit = 50) {
    const out = [];
    for (const f of readdirSync(epDir).filter((x) => x.endsWith('.json'))) { try { out.push(episodeMeta(JSON.parse(readFileSync(join(epDir, f), 'utf8')))); } catch {} }
    return out.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  function pushStatus() {
    const list = [...conns.values()].map((c) => ({ id: c.id, ...c.status }));
    const up = list.some((s) => s.state === 'up');
    S.store.push.connected = up; S.store.push.info = list.map((s) => `${s.id}:${s.state}`).join(' ');
    broadcast('status', S.store.push);
  }

  async function backfill(c) {
    if (!c.capabilities.history || !c.getMessages) return;
    const targets = acceptAll ? [] : [...allow.values()].filter((a) => a.connector === c.id);
    let added = 0;
    for (const t of targets) {
      try { for (const m of await c.getMessages(t.chatId, { limit: 50 })) if (ingestMessage(m)) added++; }
      catch (e) { log(`backfill ${c.id}/${t.name || t.chatId}: ${e.message}`); }
    }
    if (added) { S.store.messages.sort((a, b) => a.ts - b.ts); log(`backfill ${c.id}: +${added}`); broadcast('stats', S.snapshot()); }
  }

  async function startAll() {
    const nEp = reindexEpisodes(); if (nEp) log(`episodes: indexed ${nEp} from disk`);
    const types = await connectorTypes(extraTypes);
    for (const raw of CFG.connectors || []) {
      if (raw.enabled === false) continue;
      const T = types.get(raw.type);
      if (!T) { log(`connector ${raw.id}: unknown type "${raw.type}" — skipped`); continue; }
      const cfg = withDefaults(T.configSchema, raw);
      const errs = validateConfig(T.configSchema, cfg);
      if (errs.length) { log(`connector ${raw.id}: ${errs.join('; ')} — skipped`); continue; }
      const c = T.create(cfg, {
        onMessage: (m) => ingestMessage(m), onEpisode: (e) => ingestEpisode(e),
        onStatus: () => pushStatus(), log, dataDir,
      });
      conns.set(c.id, c);
      try { await c.start(); log(`connector ${c.id} (${c.type}) started`); } catch (e) { c.status = { state: 'error', info: e.message, at: Date.now() }; log(`connector ${c.id} failed to start: ${e.message}`); }
      backfill(c);
      if (c.resyncSec) setInterval(() => backfill(c), c.resyncSec * 1000);
    }
    pushStatus();
  }

  function stopAll() { for (const c of conns.values()) try { c.stop(); } catch {} }

  const describe = () => [...conns.values()].map((c) => ({ id: c.id, type: c.type, platform: c.platform, capabilities: c.capabilities, status: c.status }));

  // outbound: pick the connector that owns the chat (or the one named), require send capability.
  // Connectors record their own sent message (fromMe) through onMessage, so nothing is added here.
  async function send({ chatId, text, connector }) {
    if (!chatId || !String(text || '').trim()) return { ok: false, error: 'chatId and text are required' };
    let id = connector;
    if (!id) {
      const hit = [...allow.values()].find((a) => a.chatId === chatId || sessionIdFor({ platform: conns.get(a.connector)?.platform, chatId: a.chatId }) === chatId);
      id = hit?.connector || [...conns.values()].find((c) => c.capabilities.send)?.id;
      if (hit) chatId = hit.chatId;
    }
    const c = conns.get(id);
    if (!c) return { ok: false, error: `no connector "${id}"` };
    if (!c.capabilities.send || !c.send) return { ok: false, error: `${c.type} connector can't send messages` };
    const r = await c.send(chatId, String(text));
    log(`send via ${c.id} → ${chatId}: ${r.ok ? 'ok' : r.error}`);
    return r;
  }

  return {
    startAll, stopAll, describe, reindexEpisodes, send, listEpisodes, ingestMessage, ingestEpisode,
    get: (id) => conns.get(id),
    firstOfType: (type) => [...conns.values()].find((c) => c.type === type),
  };
}
