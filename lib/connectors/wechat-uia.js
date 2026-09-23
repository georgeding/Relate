// WeChat via the desktop window's accessibility tree (Windows, Weixin 4.x) — the "no WeFlow" path.
// A PowerShell sidecar (wechat-uia.ps1) reads what WeChat exposes to UI Automation — the interface screen
// readers use — and renders the window to tell whose bubble is whose. No memory reading, no database
// decryption, no code injection.
//
// Limits, by design of the approach:
//   * it only sees what the WeChat window shows: the open chat's visible messages + each chat's preview line.
//     With `visitChats` on, it briefly opens chats that got new messages to read them, then switches back —
//     this changes what your WeChat window shows while it happens.
//   * WeChat must be running and not minimized (it can sit behind other windows). While minimized, capture
//     pauses: the text is still readable but whose bubble is whose is not, and a wrong sender would corrupt
//     reply/ratio stats.
//   * timestamps are "when we saw it", not WeChat's own send time.
//   * sending is off unless you enable it, and rate-limited. Automated sending can violate WeChat's terms
//     and risk your account — keep it for low-volume, human-approved replies.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMessage, initialStatus, hashId } from './connector.js';

const PS1 = join(dirname(fileURLToPath(import.meta.url)), 'wechat-uia.ps1');
const TYPE_BY_CLASS = [[/Image|Pic/i, 'image'], [/Voice|Audio/i, 'voice'], [/Video/i, 'video'], [/File|App/i, 'file']];
const keyOf = (m) => `${m.side}|${m.text}`;

// which items of `cur` are new, given the previously seen visible list `prev` (both oldest→newest).
// Aligns on the last previously-seen item (confirmed by up to 4 preceding items); if the window jumped
// (no alignment), falls back to "not in the recent-seen set".
export function newItems(prev, cur, seen) {
  if (prev?.length) {
    const last = keyOf(prev[prev.length - 1]);
    for (let i = cur.length - 1; i >= 0; i--) {
      if (keyOf(cur[i]) !== last) continue;
      let ok = true;
      for (let k = 1; k <= Math.min(4, i, prev.length - 1); k++) if (keyOf(cur[i - k]) !== keyOf(prev[prev.length - 1 - k])) { ok = false; break; }
      if (ok) return cur.slice(i + 1);
    }
  }
  return cur.filter((m) => !seen.has(keyOf(m)));
}

export function create(cfg, ctx) {
  const stateFile = ctx.dataDir ? join(ctx.dataDir, `wechat-uia-${cfg.id}.json`) : null;
  let st = { visible: {}, seen: {}, previews: {} };   // per chat: last visible list, recent keys, last preview line
  try { st = { ...st, ...JSON.parse(readFileSync(stateFile, 'utf8')) }; } catch {}
  const save = () => { if (stateFile) try { writeFileSync(stateFile, JSON.stringify(st)); } catch {} };
  let child = null, queue = Promise.resolve(), timer = null, stopped = true, lastSend = 0;
  const expectMine = new Map();   // text -> count we just sent (so the next snapshot doesn't re-emit them)
  let lastSessions = [];

  // one sidecar process at a time; each instance owns its buffer + waiters, so a late 'exit' from a
  // killed predecessor can never orphan or fail its replacement
  function sidecar() {
    if (child) return child;
    const c = spawn(cfg.powershell || 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS1], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    c.waiters = []; let buf = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; const w = c.waiters.shift(); if (w) { try { w.ok(JSON.parse(line)); } catch (e) { w.fail(e); } } }
    });
    c.stderr.on('data', (d) => ctx.log?.(`wechat-uia ${cfg.id}: ${String(d).trim().slice(0, 200)}`));
    c.on('exit', () => { if (child === c) child = null; for (const w of c.waiters.splice(0)) w.fail(new Error('sidecar exited')); });
    return (child = c);
  }
  function killSidecar() { const c = child; child = null; if (c) { try { c.stdin.end(); c.kill(); } catch {} } }
  // commands are serialized: the sidecar handles one at a time
  function cmd(obj, timeoutMs = 20000, { poll = false } = {}) {
    const run = () => new Promise((ok, fail) => {
      if (poll && stopped) return fail(new Error('stopped'));
      const c = sidecar(); const t = setTimeout(() => { fail(new Error(`${obj.cmd} timed out`)); if (child === c) killSidecar(); }, timeoutMs);
      c.waiters.push({ ok: (v) => { clearTimeout(t); ok(v); }, fail: (e) => { clearTimeout(t); fail(e); } });
      c.stdin.write(JSON.stringify(obj) + '\n');
    });
    const p = queue.then(run, run); queue = p.catch(() => {}); return p;
  }

  function ingestVisible(chat, items) {
    const list = items.filter((m) => m.text && m.cls !== 'ChatItemView');   // ChatItemView = time separators / system lines
    const fresh = newItems(st.visible[chat], list, new Set(st.seen[chat] || []));
    const now = Date.now();
    fresh.forEach((m, i) => {
      if (m.side === 'me' && expectMine.get(m.text)) { expectMine.set(m.text, expectMine.get(m.text) - 1); return; }
      const type = TYPE_BY_CLASS.find(([re]) => re.test(m.cls))?.[1] || 'text';
      ctx.onMessage(makeMessage({
        id: hashId(`${chat}|${now}|${i}|${m.text}`), connector: cfg.id, platform: 'wechat', chatId: chat, chatName: chat,
        ts: now - (fresh.length - 1 - i) * 1000, senderId: m.side === 'me' ? 'me' : chat, senderName: m.side === 'me' ? (cfg.meName || 'me') : chat,
        fromMe: m.side === 'me', text: m.text, type, meta: { uiClass: m.cls, side: m.side },
      }));
    });
    st.visible[chat] = list.slice(-40);
    st.seen[chat] = [...new Set([...(st.seen[chat] || []), ...list.map(keyOf)])].slice(-400);
    return fresh.length;
  }

  async function tick() {
    if (stopped) return;
    try {
      const s = await cmd({ cmd: 'snapshot' }, 20000, { poll: true });
      if (!s.ok) { setStatus('down', s.error); return; }
      lastSessions = s.sessions || [];
      if (s.minimized) { setStatus('down', 'WeChat is minimized — capture paused. Restore the window (it can stay behind other windows).'); return; }
      let n = 0;
      if (s.chat) n += ingestVisible(s.chat, s.messages || []);
      // chats whose preview line changed while not open
      const changed = lastSessions.filter((x) => x.name !== s.chat && st.previews[x.name] !== undefined && st.previews[x.name] !== x.preview);
      for (const x of lastSessions) st.previews[x.name] = x.preview;
      const wanted = changed.filter((x) => !cfg.onlyChats?.length || cfg.onlyChats.includes(x.name));
      if (cfg.visitChats && wanted.length && s.chat) {
        for (const x of wanted.slice(0, 3)) {
          if (!(await cmd({ cmd: 'open', chat: x.name }, 20000, { poll: true })).ok) continue;
          const v = await cmd({ cmd: 'snapshot' }, 20000, { poll: true });
          if (v.ok && v.chat === x.name) n += ingestVisible(x.name, v.messages || []);
        }
        await cmd({ cmd: 'open', chat: s.chat }, 20000, { poll: true });   // put the user's chat back
      }
      save();
      setStatus('up', `watching "${s.chat || '—'}"${wanted.length && !cfg.visitChats ? ` · ${wanted.length} other chat(s) have new messages (open them in WeChat, or enable "visit chats")` : ''}${n ? ` · +${n}` : ''}`);
    } catch (e) { setStatus('error', e.message); }
    finally { if (!stopped) timer = setTimeout(tick, Math.max(2, Number(cfg.pollSec) || 5) * 1000); }
  }

  const conn = {
    id: cfg.id, type: 'wechat-uia', platform: 'wechat',
    capabilities: { live: true, history: false, send: !!cfg.allowSend, episodes: false },
    status: initialStatus(),
    async start() {
      if (process.platform !== 'win32') { setStatus('error', 'Windows only'); return; }
      stopped = false; setStatus('connecting', 'starting accessibility reader'); tick();
    },
    stop() { stopped = true; clearTimeout(timer); killSidecar(); save(); setStatus('idle', 'stopped'); },
    async listChats() {
      if (!lastSessions.length) { const s = await cmd({ cmd: 'snapshot' }).catch(() => null); if (s?.ok) lastSessions = s.sessions || []; }
      return lastSessions.map((x) => ({ chatId: x.name, name: x.name, kind: 'dm' }));
    },
    async send(chatId, text) {
      if (!cfg.allowSend) return { ok: false, error: 'sending is disabled for this connector' };
      const gap = (Number(cfg.sendMinIntervalSec) || 20) * 1000 - (Date.now() - lastSend);
      if (gap > 0) return { ok: false, error: `rate limited — try again in ${Math.ceil(gap / 1000)}s` };
      lastSend = Date.now();
      const r = await cmd({ cmd: 'send', chat: chatId, text: String(text) }, 30000).catch((e) => ({ ok: false, error: e.message }));
      if (!r.ok) return r;
      expectMine.set(String(text), (expectMine.get(String(text)) || 0) + 1);
      ctx.onMessage(makeMessage({ connector: cfg.id, platform: 'wechat', chatId, chatName: chatId, ts: Date.now(), senderId: 'me', senderName: cfg.meName || 'me', fromMe: true, text: String(text), meta: { via: 'uia-send' } }));
      return { ok: true };
    },
    async test() {
      if (process.platform !== 'win32') return { ok: false, error: 'This connector only works on Windows' };
      try {
        const p = await cmd({ cmd: 'ping' }, 30000);
        if (!p.found) return { ok: false, error: 'WeChat window not found — start WeChat and log in' };
        if (p.minimized) return { ok: false, error: 'WeChat is minimized — restore it (it can stay behind other windows)' };
        const s = await cmd({ cmd: 'snapshot' });
        if (!s.ok) return { ok: false, error: s.error };
        const sides = (s.messages || []).map((m) => m.side);
        return { ok: true, info: `reading ${s.sessions.length} chats · open chat has ${sides.length} visible messages (${sides.filter((x) => x !== '?').length} with a known sender side)` };
      } catch (e) { return { ok: false, error: e.message }; }
      finally { if (stopped) killSidecar(); }
    },
  };
  function setStatus(state, info) { conn.status = { state, info, at: Date.now() }; ctx.onStatus?.(conn.status); }
  return conn;
}

export default {
  type: 'wechat-uia',
  label: 'WeChat (screen reader mode, Windows)',
  platform: 'wechat',
  os: 'win32',
  capabilities: { live: true, history: false, send: true, episodes: false },
  description: 'Reads the WeChat desktop window the way a screen reader does — no WeFlow, no decryption. Sees the open chat and chat previews; can optionally open chats with new messages and (if you allow it) send replies. WeChat must stay open (not minimized).',
  configSchema: [
    { key: 'meName', label: 'Your name', type: 'string', default: 'me' },
    { key: 'pollSec', label: 'Check every (seconds)', type: 'number', default: 5 },
    { key: 'visitChats', label: 'Open chats with new messages to read them', type: 'bool', default: false, help: 'Briefly switches the chat shown in your WeChat window, then switches back' },
    { key: 'onlyChats', label: 'Only these chats (names)', type: 'list', help: 'Limit which chats are visited; empty = all' },
    { key: 'allowSend', label: 'Allow sending', type: 'bool', default: false, help: 'Off by default. Automated sending may break WeChat\'s terms and risk your account' },
    { key: 'sendMinIntervalSec', label: 'Minimum seconds between sends', type: 'number', default: 20 },
    { key: 'powershell', label: 'PowerShell executable', type: 'string', default: 'powershell.exe' },
  ],
  create,
};
