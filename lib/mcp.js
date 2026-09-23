// MCP (Model Context Protocol) service over the chat store — lets any MCP client (Claude Code,
// Claude Desktop, openclaw, scripts) read every chat this space holds, plus the derived
// board (living memory, todos, notes). Read-only. Streamable HTTP, stateless: one tiny McpServer per
// request, so nothing leaks between clients. Auth is the normal gate in server.js (cookie or Bearer
// apiToken) — this module never sees an unauthenticated request.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { CFG, CONTEXT_TYPE, IS_BIZLIKE } from './config.js';
import { ME } from './domain/names.js';

let ctx = null;   // wired by server.js after seeding: { store, corpus(), sessions, activeMemory, living, listReminders, listNotes }
export function initMcp(c) { ctx = c; }

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const local = (ts) => new Date(ts).toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T');
const clamp = (n, lo, hi, d) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// accepts ms, ISO / 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm' (interpreted in this PC's timezone)
function parseTime(v, endOfDay = false) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (/^\d{12,}$/.test(s)) return Number(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T${endOfDay ? '23:59:59.999' : '00:00:00'}`).getTime();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// every message this instance holds: the main store + the "other chats" feed (relationship instance)
function allMessages() {
  const a = ctx.store.messages, b = ctx.store.otherFeed || [];
  return b.length ? a.concat(b) : a;
}

function kindOf(sid) {
  const m = ctx.sessions?.get(sid);
  if (m?.kind) return m.kind === 'group' ? 'group' : 'dm';
  return /@chatroom$/.test(sid) ? 'group' : 'dm';
}

function chatList() {
  const by = new Map();
  for (const m of allMessages()) {
    const c = by.get(m.session) || { id: m.session, name: m.sessionName || m.session, kind: kindOf(m.session), count: 0, sent: 0, recv: 0, first: Infinity, last: 0 };
    c.count++; if (m.isSend) c.sent++; else c.recv++;
    if (m.ts < c.first) c.first = m.ts;
    if (m.ts > c.last) c.last = m.ts;
    if (m.sessionName) c.name = m.sessionName;
    by.set(m.session, c);
  }
  return [...by.values()].sort((a, b) => b.last - a.last)
    .map((c) => ({ ...c, first: local(c.first), last: local(c.last) }));
}

// chat = exact session id, or a case-insensitive name fragment (unique match required)
function resolveChat(chat) {
  if (!chat) return { id: null };
  const q = String(chat).trim();
  const chats = chatList();
  const exact = chats.find((c) => c.id === q);
  if (exact) return { id: exact.id, name: exact.name };
  const ql = q.toLowerCase();
  const hits = chats.filter((c) => String(c.name).toLowerCase().includes(ql) || c.id.toLowerCase().includes(ql));
  if (hits.length === 1) return { id: hits[0].id, name: hits[0].name };
  return { id: null, error: hits.length ? `ambiguous chat "${q}": ${hits.map((h) => `${h.name} (${h.id})`).join(', ')}` : `no chat matches "${q}"; call list_chats` };
}

function fmt(m) {
  const o = { key: m.key, at: local(m.ts), chat: m.sessionName || m.session, from: m.isSend ? (CFG.target?.me || 'me') : (m.senderName || m.sender), dir: m.isSend ? 'out' : 'in', text: m.content };
  if (m.voice) o.voice = true;
  if (m.analysis?.sentiment) o.sentiment = m.analysis.sentiment;
  return o;
}

function filtered({ chat, since, until }) {
  const r = resolveChat(chat);
  if (chat && !r.id) return { error: r.error };
  const s = parseTime(since), u = parseTime(until, true);
  const out = [];
  for (const m of allMessages()) {
    if (r.id && m.session !== r.id) continue;
    if (s != null && m.ts < s) continue;
    if (u != null && m.ts > u) continue;
    out.push(m);
  }
  out.sort((a, b) => a.ts - b.ts);
  return { chat: r.id ? { id: r.id, name: r.name } : null, msgs: out };
}

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] });
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] });

function instructions() {
  const biz = IS_BIZLIKE;
  return [
    biz ? `This is ${ME}'s ${CONTEXT_TYPE} space "${CFG.name || CFG.id || ''}": several chats (1:1 and groups).`
        : `This is ${ME}'s relationship space for their chats with ${CFG.target?.name || 'one person'}.`,
    `Messages with dir="out" were sent by ${ME}; dir="in" were received. Timestamps are local (${TZ}).`,
    'Start with list_chats, then get_messages for a range or search_messages / search_windows for a topic. get_context expands around one message key.',
    'All tools are read-only.',
  ].join(' ');
}

function buildServer() {
  const server = new McpServer({ name: `relate-${CONTEXT_TYPE}`, version: '1.0.0' }, { instructions: instructions() });

  server.registerTool('list_chats', {
    title: 'List chats',
    description: 'All chats held by this space with message counts and first/last activity. Use the id or a unique name fragment as `chat` in other tools.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => text({ timezone: TZ, context: CONTEXT_TYPE, push: ctx.store.push, chats: chatList() }));

  server.registerTool('get_messages', {
    title: 'Get messages',
    description: 'Messages from one chat (or all chats) in a time window, returned in chronological order. Default: the newest `limit` messages. Page backwards with the returned `next_until`.',
    inputSchema: {
      chat: z.string().optional().describe('chat id or unique name fragment; omit for all chats'),
      since: z.string().optional().describe('start: YYYY-MM-DD, ISO datetime, or epoch ms'),
      until: z.string().optional().describe('end (inclusive): YYYY-MM-DD, ISO datetime, or epoch ms'),
      limit: z.number().int().optional().describe('max messages, 1-300 (default 60)'),
      order: z.enum(['newest', 'oldest']).optional().describe('which end of the window to keep when truncating (default newest)'),
    },
    annotations: { readOnlyHint: true },
  }, async (a) => {
    const f = filtered(a); if (f.error) return fail(f.error);
    const lim = clamp(a.limit, 1, 300, 60);
    const total = f.msgs.length;
    const page = a.order === 'oldest' ? f.msgs.slice(0, lim) : f.msgs.slice(-lim);
    const out = { chat: f.chat, total_in_window: total, returned: page.length, messages: page.map(fmt) };
    if (total > lim) { if (a.order === 'oldest') out.next_since = page[page.length - 1].ts + 1; else out.next_until = page[0].ts - 1; }
    return text(out);
  });

  server.registerTool('search_messages', {
    title: 'Search messages (keyword)',
    description: 'Exact keyword search: every whitespace-separated term must appear in the message (case-insensitive). Newest first. Use for names, amounts, specific phrases.',
    inputSchema: {
      query: z.string().describe('one or more terms'),
      chat: z.string().optional(), since: z.string().optional(), until: z.string().optional(),
      limit: z.number().int().optional().describe('1-200, default 30'),
    },
    annotations: { readOnlyHint: true },
  }, async (a) => {
    const terms = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return fail('query required');
    const f = filtered(a); if (f.error) return fail(f.error);
    const lim = clamp(a.limit, 1, 200, 30);
    const hits = [];
    for (let i = f.msgs.length - 1; i >= 0 && hits.length < lim; i--) {
      const c = String(f.msgs[i].content).toLowerCase();
      if (terms.every((t) => c.includes(t))) hits.push(fmt(f.msgs[i]));
    }
    return text({ chat: f.chat, terms, returned: hits.length, messages: hits });
  });

  server.registerTool('search_windows', {
    title: 'Search conversation windows (BM25)',
    description: 'Ranked retrieval over conversation windows (a few minutes of back-and-forth each) across all chats — the same index the dashboard assistant uses. Best for topics and "when did we discuss X". Returns window text with dates.',
    inputSchema: { query: z.string(), limit: z.number().int().optional().describe('1-30, default 8') },
    annotations: { readOnlyHint: true },
  }, async (a) => {
    const corpus = ctx.corpus?.(); if (!corpus) return fail('corpus not ready');
    const hits = corpus.search(String(a.query || ''), clamp(a.limit, 1, 30, 8));
    return text({ returned: hits.length, windows: hits.map((h) => ({ score: h.score, date: h.meta?.date, dateEnd: h.meta?.dateEnd, n: h.meta?.n, text: h.text })) });
  });

  server.registerTool('get_context', {
    title: 'Messages around one message',
    description: 'The messages immediately before and after a given message key (from any other tool) in the same chat.',
    inputSchema: { key: z.string(), before: z.number().int().optional().describe('default 10, max 60'), after: z.number().int().optional().describe('default 10, max 60') },
    annotations: { readOnlyHint: true },
  }, async (a) => {
    const all = allMessages();
    const hit = all.find((m) => m.key === a.key);
    if (!hit) return fail(`unknown message key ${a.key}`);
    const same = all.filter((m) => m.session === hit.session).sort((x, y) => x.ts - y.ts);
    const i = same.findIndex((m) => m.key === a.key);
    const b = clamp(a.before, 0, 60, 10), f = clamp(a.after, 0, 60, 10);
    return text({ chat: { id: hit.session, name: hit.sessionName }, messages: same.slice(Math.max(0, i - b), i + f + 1).map(fmt) });
  });

  server.registerTool('get_board', {
    title: 'Board: living memory, todos, notes',
    description: 'The derived dashboard state: AI-maintained living memory / narrative / latest observation, open todos (reminders) ranked, and pinned notes.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const r = ctx.listReminders?.() || {};
    const open = (r.open || []).slice(0, 40).map((t) => ({ id: t.id, text: t.text, kind: t.kind, urgency: t.urgency, scope: t.scope, chat: t.chat || t.chatLabel || undefined, score: t.score }));
    const lv = ctx.living || {};
    return text({
      living: { memory: ctx.activeMemory?.() || lv.memory, narrative: lv.narrative, observation: lv.observation, updatedAt: lv.at ? local(lv.at) : null, groundedAt: lv.groundedAt ? local(lv.groundedAt) : null },
      todos: { open_count: (r.open || []).length, open, done_recent: (r.done || []).slice(0, 10).map((t) => t.text) },
      notes: (ctx.listNotes?.() || []).map((n) => ({ id: n.id, at: local(n.at), text: n.text })),
    });
  });

  return server;
}

export const MCP_TOOLS = ['list_chats', 'get_messages', 'search_messages', 'search_windows', 'get_context', 'get_board'];

// Node http handler. POST = JSON-RPC (stateless, JSON replies). GET describes the endpoint; other methods 405.
export async function handleMcp(req, res, parsedBody) {
  if (!ctx) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'mcp not ready' })); }
  if (req.method !== 'POST') {
    res.writeHead(req.method === 'GET' ? 200 : 405, { 'Content-Type': 'application/json', Allow: 'POST' });
    return res.end(JSON.stringify({ mcp: 'streamable-http', endpoint: '/mcp', method: 'POST', auth: 'Authorization: Bearer <auth.apiToken> (or dashboard cookie)', server: `relate-${CONTEXT_TYPE}`, tools: MCP_TOOLS }));
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
