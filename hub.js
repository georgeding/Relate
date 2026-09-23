// Relate hub — the control plane. One hub, many spaces:
//   * settings UI (public/hub/) + JSON API under /hub/api (see docs/PLATFORM.md)
//   * space registry: spaces/<id>/config.json (user config, secrets inside) — spaces/ is gitignored
//   * supervisor: runs each space as its own `node server.js` worker (own port, own data dir)
//   * recording router: watches one Plaud inbox, classifies each recording, forwards it to the right space(s)
// The hub never imports the engine (lib/config.js) — workers are separate processes.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, appendFileSync, statSync, renameSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import net from 'node:net';
import { connectorTypes, describeTypes } from './lib/connectors/index.js';
import { validateConfig, withDefaults } from './lib/connectors/connector.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.RELATE_HOME || join(ROOT, 'spaces');
const PORT = Number(process.env.HUB_PORT || 5080);
// ports browsers/fetch refuse to connect to (WHATWG "bad ports") — e.g. 5060/5061 are SIP
const UNSAFE_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
const HOST = process.env.HUB_HOST || '127.0.0.1';
const SETTINGS = join(HOME, 'hub.json');
const ROUTER_DIR = join(HOME, '_router');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
const KEEP = '__set__';                       // placeholder the UI sends back for "keep the stored secret"
mkdirSync(HOME, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------- templates ----------------
const TEMPLATES = [
  { id: 'relationship', label: 'Relationship', description: 'One important person. Tracks mood, needs, sensitive topics, promises and who owes a reply.', defaults: { acceptGroups: false }, plugins: ['occasions', 'reply-nudge'] },
  { id: 'business', label: 'Business', description: 'Your business chats and groups. Open loops, who is waiting on you, commitments, blockers.', defaults: { acceptGroups: true } },
  { id: 'team', label: 'Team', description: 'A team or project. Owners, decisions, unclaimed work, blockers and collaboration health.', defaults: { acceptGroups: true } },
];

// ---------------- settings & auth ----------------
function readJson(f, dflt) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return dflt; } }
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const tmp = f + '.tmp'; writeFileSync(tmp, JSON.stringify(v, null, 2)); renameSync(tmp, f); }
let settings = readJson(SETTINGS, {});
settings.secret ||= randomBytes(24).toString('hex');
settings.ai ||= { base: '', key: '', model: '', maxCallsPerHour: 40 };
settings.episodeRouter ||= { enabled: false, inbox: '', minConfidence: 0.6, speakerMap: [] };
writeJson(SETTINGS, settings);

const hashPw = (pw, salt = randomBytes(16).toString('hex')) => `${salt}:${scryptSync(String(pw), salt, 32).toString('hex')}`;
function checkPw(pw) {
  if (!settings.passwordHash) return false;
  const [salt, h] = settings.passwordHash.split(':');
  const a = Buffer.from(scryptSync(String(pw), salt, 32).toString('hex')), b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
}
const sessionToken = () => createHmac('sha256', settings.secret).update('hub:' + settings.passwordHash).digest('hex');
function cookies(req) { const o = {}; for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o; }
const authed = (req) => !!settings.passwordHash && cookies(req).relate_hub === sessionToken();
const setCookie = (res) => res.setHeader('Set-Cookie', `relate_hub=${sessionToken()}; Path=/; Max-Age=5184000; HttpOnly; SameSite=Lax`);

// ---------------- space registry ----------------
const spaceDir = (id) => join(HOME, id);
const cfgFile = (id) => join(spaceDir(id), 'config.json');
const validId = (id) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(id || '');
function listIds() { return readdirSync(HOME, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(cfgFile(d.name))).map((d) => d.name).sort(); }
const loadCfg = (id) => readJson(cfgFile(id), null);
const saveCfg = (id, c) => writeJson(cfgFile(id), c);
const token = (n = 24) => randomBytes(n).toString('hex');

function slug(name) { return String(name || 'space').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'space'; }
async function freePort(start = 5081) {
  const used = new Set(listIds().map((id) => loadCfg(id)?.port).filter(Boolean));
  for (let p = start; p < start + 200; p++) {
    if (used.has(p) || p === PORT || UNSAFE_PORTS.has(p)) continue;
    const bindable = await new Promise((r) => { const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(p, '127.0.0.1'); });
    // Windows lets us bind 127.0.0.1 even while another process holds the port on all interfaces, so also try to connect
    const taken = bindable && await new Promise((r) => { const c = net.connect(p, '127.0.0.1').once('connect', () => { c.destroy(); r(true); }).once('error', () => r(false)); c.setTimeout(800, () => { c.destroy(); r(false); }); });
    if (bindable && !taken) return p;
  }
  throw new Error('no free port');
}

// secret handling: which fields are secrets, mask them on read, keep stored values on "__set__"
const TOP_SECRETS = [['ai', 'key'], ['auth', 'password'], ['auth', 'secret'], ['auth', 'apiToken']];
async function connSecretKeys(type) { const T = (await connectorTypes()).get(type); return (T?.configSchema || []).filter((f) => f.type === 'secret').map((f) => f.key); }
// plugin settings secrets come from each plugin's configSchema (read via the sandboxed inspection, cached by mtime)
const inspectCache = new Map();   // file -> { mtime, result }
async function pluginSecretKeys(spaceId, name) {
  const f = [join(spacePlugins(spaceId), `${name}.js`), join(SHARED_PLUGINS, `${name}.js`), join(BUILTIN_PLUGINS, `${name}.js`)].find((x) => existsSync(x));
  if (!f) return [];
  const mtime = statSync(f).mtimeMs, hit = inspectCache.get(f);
  const r = hit && hit.mtime === mtime ? hit.result : await inspectPlugin(f, name);
  inspectCache.set(f, { mtime, result: r });
  return (r.meta?.configSchema || []).filter((x) => x.type === 'secret').map((x) => x.key);
}
async function maskPluginSettings(spaceId, name, settings) {
  const out = { ...(settings || {}) };
  for (const k of await pluginSecretKeys(spaceId, name)) if (k in out) out[k] = out[k] ? KEEP : '';
  return out;
}
async function maskCfg(c) {
  const out = structuredClone(c);
  for (const [a, b] of TOP_SECRETS) if (out[a] && b in out[a]) out[a][b] = out[a][b] ? KEEP : '';
  for (const conn of out.connectors || []) for (const k of await connSecretKeys(conn.type)) if (k in conn) conn[k] = conn[k] ? KEEP : '';
  for (const name of Object.keys(out.plugins || {})) out.plugins[name] = await maskPluginSettings(c.id, name, out.plugins[name]);
  return out;
}
async function unmask(incoming, stored) {
  const out = structuredClone(incoming);
  for (const [a, b] of TOP_SECRETS) if (out[a]?.[b] === KEEP) out[a][b] = stored?.[a]?.[b] || '';
  for (const conn of out.connectors || []) {
    const prev = (stored?.connectors || []).find((x) => x.id === conn.id);
    for (const k of await connSecretKeys(conn.type)) if (conn[k] === KEEP) conn[k] = prev?.[k] || '';
  }
  for (const [name, p] of Object.entries(out.plugins || {})) if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) if (v === KEEP) p[k] = stored?.plugins?.[name]?.[k] || '';
  return out;
}
function deepMerge(base, patch) {
  if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out;
}

async function validateSpace(c) {
  const errors = [];
  if (!c.name) errors.push('Name is required');
  if (!TEMPLATES.some((t) => t.id === c.template)) errors.push(`Unknown template "${c.template}"`);
  const types = await connectorTypes();
  const ids = new Set();
  for (const conn of c.connectors || []) {
    if (!conn.id || !/^[\w-]{1,40}$/.test(conn.id)) { errors.push(`Connector id "${conn.id}" is invalid`); continue; }
    if (conn.id === '_space') { errors.push('Connector id "_space" is reserved'); continue; }
    if (ids.has(conn.id)) errors.push(`Duplicate connector id "${conn.id}"`); ids.add(conn.id);
    const T = types.get(conn.type);
    if (!T) { errors.push(`Connector ${conn.id}: unknown type "${conn.type}"`); continue; }
    if (conn.enabled !== false) for (const e of validateConfig(T.configSchema, withDefaults(T.configSchema, conn))) errors.push(`Connector ${conn.id}: ${e}`);
  }
  for (const ch of c.chats || []) if (!ids.has(ch.connector)) errors.push(`Chat "${ch.name || ch.chatId}" refers to missing connector "${ch.connector}"`);
  if (c.template === 'relationship' && c.target?.chatId && !(c.chats || []).some((ch) => ch.chatId === c.target.chatId)) errors.push('The partner chat must be in the chat list');
  return errors;
}

// session id the engine stores a chat under (mirrors lib/sources.js sessionIdFor)
async function sessionFor(c, connectorId, chatId) {
  const conn = (c.connectors || []).find((x) => x.id === connectorId);
  const T = conn && (await connectorTypes()).get(conn.type);
  const platform = conn?.type === 'ingest' ? (conn.platform || 'custom') : (T?.platform || 'custom');
  return platform === 'wechat' ? chatId : `${platform}:${chatId}`;
}

// runtime.json = what the worker actually runs: config + global AI defaults + hub-owned plumbing
async function writeRuntime(id) {
  const c = loadCfg(id);
  const rt = structuredClone(c);
  rt.id = id; rt.contextType = c.template; rt.dataDir = join(spaceDir(id), 'data'); rt.pluginDir = join(spaceDir(id), 'plugins');
  const g = settings.ai || {};
  rt.ai = { ...(c.ai || {}) };
  for (const k of ['base', 'key', 'model']) if (!rt.ai[k]) rt.ai[k] = g[k] || '';
  if (!rt.ai.maxCallsPerHour) rt.ai.maxCallsPerHour = g.maxCallsPerHour || 40;
  rt.ai.enabled = rt.ai.enabled !== false && !!(rt.ai.base && rt.ai.key && rt.ai.model);
  rt.auth = { ...(c.auth || {}) };
  rt.auth.enabled = !!rt.auth.password;
  rt.connectors = [...(c.connectors || [])];
  // every space gets a hub-owned HTTP ingest endpoint (/api/ingest/_space, space ingest token). The recording
  // router delivers through it; recordings need no allowlist, chat messages still only land for listed chats
  if (c.ingest?.token) rt.connectors = [...rt.connectors.filter((x) => x.id !== '_space'), { id: '_space', type: 'ingest', token: c.ingest.token, platform: 'custom' }];
  rt.chats = await Promise.all((c.chats || []).map(async (ch) => ({ ...ch, session: await sessionFor(c, ch.connector, ch.chatId) })));
  if (c.target?.chatId) rt.target = { ...c.target, session: await sessionFor(c, c.target.connector || c.chats?.find((x) => x.chatId === c.target.chatId)?.connector, c.target.chatId) };
  mkdirSync(rt.dataDir, { recursive: true }); mkdirSync(rt.pluginDir, { recursive: true });
  const f = join(spaceDir(id), 'runtime.json'); writeJson(f, rt);
  return f;
}

// ---------------- supervisor ----------------
const procs = new Map();   // id -> { child, status, startedAt, lastError, lines:[], restarts:[] }
const rec = (id) => procs.get(id) || procs.set(id, { status: 'stopped', lines: [], restarts: [] }).get(id);
function pushLine(id, line) {
  const r = rec(id); r.lines.push(line); if (r.lines.length > 800) r.lines.splice(0, r.lines.length - 800);
  try { appendFileSync(join(spaceDir(id), 'worker.log'), line + '\n'); } catch {}
}
async function workerFetch(id, path, opts = {}) {
  const c = loadCfg(id);
  const headers = { ...(opts.headers || {}) };
  if (c?.auth?.apiToken && !headers.Authorization) headers.Authorization = `Bearer ${c.auth.apiToken}`;   // callers (ingest) may bring their own
  return fetch(`http://127.0.0.1:${c.port}${path}`, { ...opts, headers, signal: AbortSignal.timeout(opts.timeout || 8000) });
}
// is THIS space's worker answering on its port? (checks the id, so a stranger on the port is never adopted)
async function portAnswers(id) { try { const r = await workerFetch(id, '/api/space', { timeout: 1500 }); return r.ok && (await r.json()).id === id; } catch { return false; } }

async function startSpace(id) {
  const c = loadCfg(id); if (!c) throw new Error('no such space');
  const r = rec(id);
  if (r.child && (r.status === 'running' || r.status === 'starting')) return r.status;
  c.auth ||= {}; c.auth.apiToken ||= token(); c.auth.secret ||= token(); c.ingest ||= {}; c.ingest.token ||= token(); saveCfg(id, c);
  if (await portAnswers(id)) { r.status = 'running'; r.adopted = true; pushLine(id, `[hub] port ${c.port} already serving this space — adopted`); return r.status; }
  const runtime = await writeRuntime(id);
  const args = [];
  if (settings.sandbox) args.push('--permission', `--allow-fs-read=${ROOT}`, `--allow-fs-read=${spaceDir(id)}`, `--allow-fs-write=${spaceDir(id)}`);
  args.push(join(ROOT, 'server.js'));
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, RELATE_CONFIG: runtime, PORT: String(c.port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  Object.assign(r, { child, status: 'starting', startedAt: Date.now(), lastError: null, adopted: false, stopping: false });
  pushLine(id, `[hub] starting worker pid ${child.pid} on :${c.port}`);
  const onData = (buf) => { for (const l of String(buf).split(/\r?\n/)) if (l.trim()) { pushLine(id, l); if (/Error|ERR_|unhandled/i.test(l)) r.lastError = l.slice(0, 300); } };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('exit', (code) => {
    const was = r.stopping; r.child = null;
    r.status = was ? 'stopped' : 'crashed';
    pushLine(id, `[hub] worker exited (code ${code})${was ? '' : ' — unexpected'}`);
    if (!was) {   // crash: restart with backoff, at most 5 times in 10 minutes
      const now = Date.now(); r.restarts = r.restarts.filter((t) => now - t < 600000);
      if (r.restarts.length < 5) { r.restarts.push(now); const d = 2000 * 2 ** (r.restarts.length - 1); pushLine(id, `[hub] restarting in ${d / 1000}s`); setTimeout(() => { if (rec(id).status === 'crashed') startSpace(id).catch(() => {}); }, d); }
      else pushLine(id, '[hub] crashed 5 times in 10 minutes — giving up until you start it again');
    }
  });
  (async () => {   // readiness: wait for the port to answer, then deliver any queued recordings
    for (let i = 0; i < 120 && r.child === child; i++) {
      if (await portAnswers(id)) { r.status = 'running'; pushLine(id, '[hub] worker ready'); flushOutbox(id); return; }
      await new Promise((ok) => setTimeout(ok, 500));
    }
    if (r.child === child && r.status === 'starting') { r.lastError = 'worker did not become ready within 60s'; pushLine(id, `[hub] ${r.lastError}`); }
  })();
  c.autostart = true; saveCfg(id, c);
  return r.status;
}
async function stopSpace(id, { remember = true } = {}) {
  const r = rec(id);
  if (remember) { const c = loadCfg(id); if (c) { c.autostart = false; saveCfg(id, c); } }
  if (r.child) { r.stopping = true; r.child.kill(); await new Promise((ok) => { const t = setTimeout(ok, 5000); r.child?.once('exit', () => { clearTimeout(t); ok(); }); }); }
  else if (r.adopted) pushLine(id, '[hub] this worker was started outside the hub; stop it there');
  r.status = r.child ? r.status : 'stopped';
  return r.status;
}

async function spaceSummary(id) {
  const c = loadCfg(id), r = rec(id);
  return {
    id, name: c.name, template: c.template, port: c.port, url: `http://127.0.0.1:${c.port}/`,
    status: r.status, pid: r.child?.pid || null, startedAt: r.startedAt || null, lastError: r.lastError || null,
    connectors: (c.connectors || []).map((x) => ({ id: x.id, type: x.type, enabled: x.enabled !== false })), chatCount: (c.chats || []).length,
  };
}

// ---------------- connector test / chat picker (without saving) ----------------
async function resolveConnCfg({ type, config = {}, space }) {
  const cfg = { ...config };
  const stored = (space && loadCfg(space)?.connectors || []).find((x) => x.id === cfg.id)
    || listIds().flatMap((i) => loadCfg(i)?.connectors || []).find((x) => x.id === cfg.id && x.type === type);
  for (const k of await connSecretKeys(type)) if (cfg[k] === KEEP) cfg[k] = stored?.[k] || '';
  return cfg;
}
async function withTempConnector(body, fn) {
  const T = (await connectorTypes()).get(body.type);
  if (!T) return { ok: false, error: `unknown connector type "${body.type}"` };
  const cfg = withDefaults(T.configSchema, await resolveConnCfg(body));
  cfg.id ||= 'test';
  const errs = validateConfig(T.configSchema, cfg);
  if (errs.length) return { ok: false, error: errs.join('; ') };
  const dataDir = body.space && validId(body.space) ? join(spaceDir(body.space), 'data') : join(HOME, '_scratch');
  mkdirSync(dataDir, { recursive: true });
  const conn = T.create(cfg, { onMessage: () => false, onEpisode: () => false, onStatus: () => {}, log, dataDir });
  try { return await fn(conn); } finally { try { conn.stop?.(); } catch {} }
}

// ---------------- AI (global test + recording classifier) ----------------
async function aiChat({ base, key, model }, messages, { json = false, maxTokens = 600, timeout = 60000 } = {}) {
  const body = { model, messages, max_tokens: maxTokens, temperature: 0.2 };
  if (json) body.response_format = { type: 'json_object' };
  const r = await fetch(String(base).replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 160)}`);
  return JSON.parse(txt).choices?.[0]?.message?.content || '';
}
function looseJson(t) { try { return JSON.parse(t); } catch {} const s = t.indexOf('{'), e = t.lastIndexOf('}'); if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} } return null; }

// ---------------- recording router (Plaud inbox → spaces) ----------------
const EP_DIR = join(ROUTER_DIR, 'episodes');
mkdirSync(EP_DIR, { recursive: true });
const epFile = (id) => join(EP_DIR, `${String(id).replace(/[^\w.-]/g, '_')}.json`);
let routerConn = null;

async function classify(ep) {
  const ai = settings.ai || {};
  const spaces = listIds().map((id) => { const c = loadCfg(id); return { id, name: c.name, template: c.template, about: c.description || '', people: (c.chats || []).map((x) => x.name).slice(0, 20) }; });
  if (!spaces.length) return [];
  if (!(ai.base && ai.key && ai.model)) return null;   // no AI → manual review
  const excerpt = ep.turns.slice(0, 60).map((t) => `${t.speaker}: ${t.text}`).join('\n').slice(0, 5000);
  const raw = await aiChat(ai, [
    { role: 'system', content: 'You route a recorded conversation to the spaces (areas of the user\'s life/work) it is relevant to. A recording may belong to several spaces or none. Output only JSON.' },
    { role: 'user', content: `Spaces:\n${JSON.stringify(spaces)}\n\nRecording "${ep.title}" (${new Date(ep.ts).toISOString()}), participants: ${ep.participants.join(', ')}\n${ep.summary ? 'Summary: ' + ep.summary + '\n' : ''}Transcript excerpt:\n${excerpt}\n\nReturn {"scores":[{"space":"<id>","score":0..1,"why":"short"}]} for every space.` },
  ], { json: true, maxTokens: 500 });
  const p = looseJson(raw);
  return (p?.scores || []).filter((s) => spaces.some((x) => x.id === s.space)).map((s) => ({ space: s.space, score: Math.max(0, Math.min(1, Number(s.score) || 0)), why: String(s.why || '').slice(0, 120) })).sort((a, b) => b.score - a.score);
}

function onRouterEpisode(ep) {
  if (existsSync(epFile(ep.id))) return false;
  writeJson(epFile(ep.id), { episode: ep, routing: { status: 'classifying', suggested: [], routedTo: [], pending: [] } });
  log(`router: new recording "${ep.title}"`);
  (async () => {
    const doc = readJson(epFile(ep.id));
    try {
      const scores = await classify(ep);
      doc.routing.suggested = scores || [];
      const min = Number(settings.episodeRouter?.minConfidence) || 0.6;
      const pick = (scores || []).filter((s) => s.score >= min).map((s) => s.space);
      if (scores && pick.length) { doc.routing.status = 'routed'; doc.routing.pending = pick; }
      else doc.routing.status = 'review';
    } catch (e) { doc.routing.status = 'review'; doc.routing.error = e.message; }
    writeJson(epFile(ep.id), doc);
    for (const s of doc.routing.pending) flushOutbox(s);
  })();
  return true;
}
// deliver queued recordings to a space (called on route, and whenever the space becomes ready)
async function flushOutbox(spaceId) {
  if (rec(spaceId).status !== 'running') return;
  const c = loadCfg(spaceId); if (!c?.ingest?.token) return;
  for (const f of readdirSync(EP_DIR).filter((x) => x.endsWith('.json'))) {
    const doc = readJson(join(EP_DIR, f)); if (!doc?.routing?.pending?.includes(spaceId)) continue;
    try {
      const r = await workerFetch(spaceId, '/api/ingest/_space', { method: 'POST', headers: { Authorization: `Bearer ${c.ingest.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ episodes: [{ ...doc.episode, tags: [spaceId] }] }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      doc.routing.pending = doc.routing.pending.filter((x) => x !== spaceId); doc.routing.routedTo = [...new Set([...doc.routing.routedTo, spaceId])];
      writeJson(join(EP_DIR, f), doc); log(`router: "${doc.episode.title}" → ${spaceId}`);
    } catch (e) { log(`router: delivery to ${spaceId} failed (${e.message}) — will retry when it restarts`); }
  }
}
async function startRouter() {
  try { routerConn?.stop(); } catch {} routerConn = null;
  const R = settings.episodeRouter || {};
  if (!R.enabled || !R.inbox) return;
  const T = (await connectorTypes()).get('plaud');
  if (!T) { log('router: plaud connector type unavailable'); return; }
  routerConn = T.create(withDefaults(T.configSchema, { id: 'router', inbox: R.inbox, speakerMap: R.speakerMap || [], pollSec: R.pollSec }), { onMessage: () => false, onEpisode: onRouterEpisode, onStatus: () => {}, log, dataDir: ROUTER_DIR });
  await routerConn.start(); log(`router: watching ${R.inbox}`);
}

// ---------------- plugins: inspect (sandboxed), AI draft, save ----------------
const PLUGIN_NAME = /^[a-z][a-z0-9-]{1,39}$/;
const SHARED_PLUGINS = join(ROOT, 'plugins');
const BUILTIN_PLUGINS = join(ROOT, 'plugins', 'builtin');
const spacePlugins = (id) => join(spaceDir(id), 'plugins');
const INSPECT_JS = `
const { pathToFileURL } = await import('node:url');
const f = process.argv[1], want = process.argv[2];
try {
  const d = (await import(pathToFileURL(f).href)).default;
  const problems = [];
  if (!d || typeof d !== 'object') throw new Error('the file must "export default" an object');
  if (d.name !== want) problems.push('name must be "' + want + '" (the file name), got "' + d.name + '"');
  if (!d.description) problems.push('missing description');
  for (const t of d.tools || []) {
    if (!t || !t.name || typeof t.run !== 'function') problems.push('every tool needs a name and a run() function');
    else if (t.readOnly === undefined) problems.push('tool ' + t.name + ': set readOnly explicitly (false for anything with side effects)');
  }
  for (const k of d.ticks || []) if (!k || typeof k.run !== 'function') problems.push('every tick needs a run() function');
  for (const [k, v] of Object.entries(d.routes || {})) if (!/^(GET|POST|PUT|DELETE) \\/api\\/p\\//.test(k) || typeof v !== 'function') problems.push('route "' + k + '" must look like "GET /api/p/<plugin>/..." and map to a function');
  console.log(JSON.stringify({ ok: problems.length === 0, problems, meta: {
    name: d.name, description: d.description || '', version: d.version || '', configSchema: d.configSchema || [],
    provides: { tools: (d.tools || []).map((t) => ({ name: t && t.name, readOnly: t && t.readOnly !== false })), ticks: (d.ticks || []).length,
      routes: Object.keys(d.routes || {}), connectors: (d.connectors || []).map((c) => c && c.type), domains: Object.keys(d.domains || {}),
      context: typeof d.context === 'function', setup: typeof d.setup === 'function' } } }));
} catch (e) { console.log(JSON.stringify({ ok: false, problems: [String(e && e.message || e).slice(0, 300)] })); }
process.exit(0);`;

// import the plugin in a throwaway, permission-restricted node process and report its shape
function inspectPlugin(file, name) {
  return new Promise((resolve) => {
    const args = ['--permission', `--allow-fs-read=${ROOT}`, `--allow-fs-read=${dirname(file)}`, '--input-type=module', '-e', INSPECT_JS, file, name];
    const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill(); resolve({ ok: false, problems: ['inspection timed out (top-level code must not block)'] }); }, 10000);
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    child.on('exit', () => { clearTimeout(t); const line = out.trim().split('\n').pop(); try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, problems: [(err || out || 'no output').trim().split('\n').slice(0, 3).join(' ').slice(0, 300)] }); } });
  });
}

async function listPlugins(id) {
  const cfg = loadCfg(id), out = [];
  for (const [scope, dir] of [['space', spacePlugins(id)], ['shared', SHARED_PLUGINS], ['builtin', BUILTIN_PLUGINS]]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const name = f.slice(0, -3);
      if (out.some((p) => p.name === name)) continue;   // space-local shadows shared
      const check = await inspectPlugin(join(dir, f), name);
      inspectCache.set(join(dir, f), { mtime: statSync(join(dir, f)).mtimeMs, result: check });
      out.push({ name, scope, enabled: !!cfg.plugins?.[name] && cfg.plugins[name].enabled !== false, settings: await maskPluginSettings(id, name, cfg.plugins?.[name]), ...check });
    }
  }
  return out;
}

async function draftPlugin(id, request, name) {
  const ai = settings.ai || {};
  if (!(ai.base && ai.key && ai.model)) throw new Error('Set up the global AI provider first (Global settings)');
  const c = loadCfg(id);
  const guide = readFileSync(join(ROOT, 'docs', 'PLUGINS.md'), 'utf8');
  const example = readFileSync(join(BUILTIN_PLUGINS, 'keyword-alert.js'), 'utf8');
  const space = { template: c.template, connectors: (c.connectors || []).map((x) => x.type), chats: (c.chats || []).map((x) => x.name).slice(0, 30) };
  const raw = await aiChat(ai, [
    { role: 'system', content: 'You write plugins for the Relate chat-assistant platform. Follow the guide exactly. Reply with ONE ```js code block containing the complete plugin file and nothing else.' },
    { role: 'user', content: `# Guide\n${guide}\n\n# Example plugin\n\`\`\`js\n${example}\n\`\`\`\n\n# This space\n${JSON.stringify(space)}\n\n# Request\n${request}\n${name ? `\nThe plugin name (and file name) must be "${name}".` : '\nPick a short kebab-case name.'}` },
  ], { maxTokens: 3500, timeout: 120000 });
  const code = (raw.match(/```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/) || [null, raw])[1].trim() + '\n';
  const nm = name || (code.match(/name:\s*['"]([a-z][a-z0-9-]{1,39})['"]/) || [])[1] || 'my-plugin';
  const dir = join(HOME, '_scratch', 'drafts'); mkdirSync(dir, { recursive: true });
  const f = join(dir, `${nm}.js`); writeFileSync(f, code);
  return { name: nm, code, ...(await inspectPlugin(f, nm)) };
}

// ---------------- HTTP ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const json = (res, o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
function body(req, limit = 2e6) { return new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > limit) req.destroy(); }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); }); }
function serveStatic(res, p) {
  const rel = p === '/hub' || p === '/hub/' ? 'index.html' : p.slice('/hub/'.length);
  if (rel.includes('..')) return json(res, { error: 'bad path' }, 400);
  const f = join(ROOT, 'public', 'hub', rel);
  if (!existsSync(f) || !statSync(f).isFile()) return json(res, { error: 'not found' }, 404);
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(readFileSync(f));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const M = req.method;
  try {
    if (p === '/' ) { res.writeHead(302, { Location: '/hub/' }); return res.end(); }
    if (p === '/hub' || (p.startsWith('/hub/') && !p.startsWith('/hub/api/'))) return serveStatic(res, p);
    if (!p.startsWith('/hub/api/')) return json(res, { error: 'not found' }, 404);
    const api = p.slice('/hub/api'.length);

    // --- unauthenticated ---
    if (api === '/session') return json(res, { authed: authed(req), setupNeeded: !settings.passwordHash, version: VERSION });
    if (api === '/setup' && M === 'POST') {
      if (settings.passwordHash) return json(res, { ok: false, error: 'already set up' }, 409);
      const { password } = await body(req);
      if (!password || String(password).length < 8) return json(res, { ok: false, error: 'Use at least 8 characters' }, 400);
      settings.passwordHash = hashPw(password); writeJson(SETTINGS, settings); setCookie(res); return json(res, { ok: true });
    }
    if (api === '/login' && M === 'POST') {
      const { password } = await body(req);
      if (!checkPw(password)) { await new Promise((ok) => setTimeout(ok, 400)); return json(res, { ok: false, error: 'Wrong password' }, 401); }
      setCookie(res); return json(res, { ok: true });
    }
    if (api === '/logout' && M === 'POST') { res.setHeader('Set-Cookie', 'relate_hub=; Path=/; Max-Age=0'); return json(res, { ok: true }); }
    if (!authed(req)) return json(res, { error: 'unauthorized' }, 401);

    // --- meta ---
    if (api === '/meta') return json(res, { version: VERSION, templates: TEMPLATES, connectorTypes: await describeTypes() });

    // --- spaces ---
    if (api === '/spaces' && M === 'GET') return json(res, await Promise.all(listIds().map(spaceSummary)));
    if (api === '/spaces' && M === 'POST') {
      const b = await body(req);
      const tpl = TEMPLATES.find((t) => t.id === b.template);
      if (!tpl) return json(res, { ok: false, error: 'Pick a template' }, 400);
      if (!String(b.name || '').trim()) return json(res, { ok: false, error: 'Name is required' }, 400);
      let id = b.id ? String(b.id) : slug(b.name);
      if (!validId(id)) return json(res, { ok: false, error: 'id: lowercase letters, digits and dashes' }, 400);
      if (existsSync(cfgFile(id))) { if (b.id) return json(res, { ok: false, error: `space "${id}" exists` }, 409); let n = 2; while (existsSync(cfgFile(`${id}-${n}`))) n++; id = `${id}-${n}`; }
      const c = { id, name: String(b.name).trim(), template: tpl.id, port: await freePort(), me: { name: b.me?.name || '' }, ...tpl.defaults,
        connectors: [], chats: [], ai: { base: '', key: '', model: '' }, auth: { password: '', secret: token(), apiToken: token() }, ingest: { token: token() }, plugins: Object.fromEntries((tpl.plugins || []).map((n) => [n, { enabled: true }])), autostart: false, createdAt: Date.now() };
      mkdirSync(spaceDir(id), { recursive: true }); saveCfg(id, c);
      log(`space created: ${id} (${tpl.id}) on :${c.port}`);
      return json(res, { ok: true, id, space: await spaceSummary(id) });
    }
    // --- plugins ---
    const pm = api.match(/^\/spaces\/([a-z0-9-]+)\/plugins(?:\/([a-z][a-z0-9-]{1,39}))?$/);
    if (pm && existsSync(cfgFile(pm[1]))) {
      const [, id, name] = pm;
      if (!name && M === 'GET') return json(res, await listPlugins(id));
      if (name === 'draft' && M === 'POST') {
        const b = await body(req);
        if (!String(b.request || '').trim()) return json(res, { ok: false, problems: ['Describe what the plugin should do'] }, 400);
        if (b.name && !PLUGIN_NAME.test(b.name)) return json(res, { ok: false, problems: ['name: lowercase letters, digits, dashes'] }, 400);
        try { return json(res, await draftPlugin(id, String(b.request).slice(0, 4000), b.name)); } catch (e) { return json(res, { ok: false, problems: [e.message] }, 502); }
      }
      if (name && name !== 'draft') {
        const own = join(spacePlugins(id), `${name}.js`), shared = join(SHARED_PLUGINS, `${name}.js`), builtin = join(BUILTIN_PLUGINS, `${name}.js`);
        if (M === 'GET') { const f = [own, shared, builtin].find((x) => existsSync(x)); return f ? json(res, { name, scope: f === own ? 'space' : f === shared ? 'shared' : 'builtin', code: readFileSync(f, 'utf8') }) : json(res, { error: 'no such plugin' }, 404); }
        if (M === 'PUT') {
          const { code } = await body(req);
          if (!String(code || '').trim()) return json(res, { ok: false, problems: ['empty file'] }, 400);
          const tmpDir = join(HOME, '_scratch', 'check'); mkdirSync(tmpDir, { recursive: true });
          const tmp = join(tmpDir, `${name}.js`); writeFileSync(tmp, code);
          const check = await inspectPlugin(tmp, name);
          if (!check.meta) return json(res, { ok: false, saved: false, problems: check.problems }, 400);   // doesn't even load — refuse
          mkdirSync(spacePlugins(id), { recursive: true }); writeFileSync(own, code);
          return json(res, { ok: check.ok, saved: true, problems: check.problems, meta: check.meta, restartNeeded: ['running', 'starting'].includes(rec(id).status) });
        }
        if (M === 'DELETE') {
          if (existsSync(own)) rmSync(own);
          const c = loadCfg(id); if (c.plugins?.[name]) { delete c.plugins[name]; saveCfg(id, c); }
          return json(res, { ok: true, restartNeeded: ['running', 'starting'].includes(rec(id).status) });
        }
      }
    }
    const m = api.match(/^\/spaces\/([a-z0-9-]+)(\/[a-z-]+)?$/);
    if (m) {
      const [, id, sub = ''] = m;
      if (!existsSync(cfgFile(id))) return json(res, { error: 'no such space' }, 404);
      if (!sub && M === 'GET') return json(res, await maskCfg(loadCfg(id)));
      if (!sub && M === 'PUT') {
        const stored = loadCfg(id), b = await body(req);
        delete b.id; delete b.port;   // hub-owned
        const next = await unmask(deepMerge(stored, b), stored);
        if (b.connectors) next.connectors = (await unmask({ connectors: b.connectors }, stored)).connectors;
        if (b.chats) next.chats = b.chats;
        const errors = await validateSpace(next);
        if (errors.length) return json(res, { ok: false, errors }, 400);
        saveCfg(id, next);
        const running = ['running', 'starting'].includes(rec(id).status);
        return json(res, { ok: true, restartNeeded: running });
      }
      if (!sub && M === 'DELETE') {
        await stopSpace(id);
        if (u.searchParams.get('purge') === '1') rmSync(spaceDir(id), { recursive: true, force: true });
        else renameSync(spaceDir(id), join(HOME, `_deleted-${id}-${Date.now()}`));   // recoverable by default
        procs.delete(id); log(`space deleted: ${id}`); return json(res, { ok: true });
      }
      if (sub === '/start' && M === 'POST') { const errs = await validateSpace(loadCfg(id)); if (errs.length) return json(res, { ok: false, errors: errs }, 400); return json(res, { ok: true, status: await startSpace(id) }); }
      if (sub === '/stop' && M === 'POST') return json(res, { ok: true, status: await stopSpace(id) });
      if (sub === '/restart' && M === 'POST') { await stopSpace(id, { remember: false }); return json(res, { ok: true, status: await startSpace(id) }); }
      if (sub === '/logs') { const n = Math.min(2000, Number(u.searchParams.get('tail')) || 200); return json(res, { lines: rec(id).lines.slice(-n) }); }
      if (sub === '/live') { if (rec(id).status !== 'running') return json(res, []); try { const r = await workerFetch(id, '/api/connectors'); return json(res, r.ok ? await r.json() : []); } catch { return json(res, []); } }
    }

    // --- connectors (test / chat picker, without saving) ---
    if (api === '/connectors/test' && M === 'POST') { const b = await body(req); return json(res, await withTempConnector(b, async (c) => (c.test ? await c.test() : { ok: true, info: 'no test available for this type' })).catch((e) => ({ ok: false, error: e.message }))); }
    if (api === '/connectors/chats' && M === 'POST') { const b = await body(req); const r = await withTempConnector(b, async (c) => (c.listChats ? await c.listChats() : [])).catch(() => []); return json(res, Array.isArray(r) ? r : []); }

    // --- global settings ---
    if (api === '/settings' && M === 'GET') return json(res, { ai: { ...settings.ai, key: settings.ai.key ? KEEP : '' }, episodeRouter: settings.episodeRouter, sandbox: !!settings.sandbox });
    if (api === '/settings' && M === 'PUT') {
      const b = await body(req);
      if (b.ai) settings.ai = { ...settings.ai, ...b.ai, key: b.ai.key === KEEP ? settings.ai.key : (b.ai.key ?? settings.ai.key) };
      if (b.episodeRouter) settings.episodeRouter = { ...settings.episodeRouter, ...b.episodeRouter };
      if (typeof b.sandbox === 'boolean') settings.sandbox = b.sandbox;
      writeJson(SETTINGS, settings);
      if (b.episodeRouter) await startRouter().catch((e) => log('router start failed', e.message));
      const running = listIds().filter((id) => rec(id).status === 'running');
      return json(res, { ok: true, restartNeeded: !!b.ai && running.length > 0 });
    }
    if (api === '/ai/test' && M === 'POST') {
      const b = await body(req);
      const spaceAi = b.space && validId(b.space) ? loadCfg(b.space)?.ai || {} : {};
      const g = settings.ai || {};
      const cfg = b.useGlobal ? g : { base: b.base || g.base, model: b.model || g.model, key: b.key === KEEP ? (spaceAi.key || g.key) : (b.key || g.key) };
      if (!(cfg.base && cfg.key && cfg.model)) return json(res, { ok: false, error: 'base URL, key and model are all required' });
      const t0 = Date.now();
      try { const s = await aiChat(cfg, [{ role: 'user', content: 'Reply with the single word: ok' }], { maxTokens: 20, timeout: 45000 }); return json(res, { ok: true, ms: Date.now() - t0, sample: s.slice(0, 40) }); }
      catch (e) { return json(res, { ok: false, ms: Date.now() - t0, error: e.message.replace(cfg.key, '***') }); }
    }

    // --- recording review queue ---
    if (api === '/episodes/review') {
      const out = [];
      for (const f of readdirSync(EP_DIR).filter((x) => x.endsWith('.json'))) {
        const d = readJson(join(EP_DIR, f)); if (d?.routing?.status !== 'review') continue;
        out.push({ id: d.episode.id, title: d.episode.title, ts: d.episode.ts, excerpt: (d.episode.summary || d.episode.turns.slice(0, 4).map((t) => `${t.speaker}: ${t.text}`).join(' / ')).slice(0, 300), suggested: d.routing.suggested, error: d.routing.error || null });
      }
      return json(res, out.sort((a, b) => b.ts - a.ts));
    }
    const em = api.match(/^\/episodes\/([\w.-]+)\/route$/);
    if (em && M === 'POST') {
      const f = epFile(em[1]); const d = readJson(f); if (!d) return json(res, { error: 'no such recording' }, 404);
      const { spaces = [] } = await body(req);
      d.routing.pending = spaces.filter((s) => existsSync(cfgFile(s))); d.routing.status = spaces.length ? 'routed' : 'dismissed';
      writeJson(f, d); for (const s of d.routing.pending) flushOutbox(s);
      return json(res, { ok: true, routed: d.routing.pending });
    }
    return json(res, { error: 'not found' }, 404);
  } catch (e) { log('hub error', p, e.stack || e.message); if (!res.headersSent) json(res, { error: e.message }, 500); }
});

async function main() {
  server.listen(PORT, HOST, () => log(`\n  Relate hub -> http://${HOST}:${PORT}/hub/  (${listIds().length} spaces, home ${HOME})\n`));
  for (const id of listIds()) if (loadCfg(id)?.autostart) startSpace(id).catch((e) => log(`autostart ${id} failed: ${e.message}`));
  startRouter().catch((e) => log('router start failed', e.message));
}
const shutdown = async () => { log('hub shutting down — stopping workers'); await Promise.all(listIds().map((id) => stopSpace(id, { remember: false }).catch(() => {}))); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (e) => log('unhandledRejection', String(e?.stack || e)));
main();
