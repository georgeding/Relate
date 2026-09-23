// Plaud connector — Plaud has no public API, so the reliable path is an INBOX FOLDER: point Plaud's
// export/share (or a sync tool / email-attachment saver) at a folder and every transcript dropped there
// becomes one Episode. Files are only picked up once their size is unchanged across two polls (so a
// half-written export is never parsed), then moved to the archive folder (originals are kept).
import { existsSync, statSync, readdirSync, readFileSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { makeEpisode, withDefaults, initialStatus, hashId } from './connector.js';
import { parseTranscript, parseSpeakerMap, SUPPORTED_EXT } from './plaud-parse.js';

const configSchema = [
  { key: 'inbox', label: 'Inbox folder', type: 'path', required: true, help: 'Folder where Plaud transcripts (.txt .md .srt .vtt .json) are dropped' },
  { key: 'archive', label: 'Archive folder', type: 'path', help: 'Processed files are moved here (default: <inbox>/_done)' },
  { key: 'speakerMap', label: 'Speaker names', type: 'list', help: 'One per line, e.g. "Speaker 1=Alex" (also matches 说话人1)' },
  { key: 'pollSec', label: 'Poll every (s)', type: 'number', default: 30 },
];

const isCandidate = (name) => !name.startsWith('.') && !name.startsWith('~') && !/\.(part|tmp|crdownload|download)$/i.test(name) && SUPPORTED_EXT.includes(extname(name).toLowerCase());

// move without ever overwriting: "x.txt" → "x (1).txt" on clash; falls back to copy+delete across volumes
export function moveUnique(src, dir) {
  mkdirSync(dir, { recursive: true });
  const ext = extname(src), stem = basename(src, ext);
  let dest = join(dir, basename(src)), n = 1;
  while (existsSync(dest)) dest = join(dir, `${stem} (${n++})${ext}`);
  try { renameSync(src, dest); } catch (e) { if (e.code !== 'EXDEV') throw e; copyFileSync(src, dest); unlinkSync(src); }
  return dest;
}

export function create(cfg = {}, ctx = {}) {
  const c = withDefaults(configSchema, cfg);
  const id = cfg.id || 'plaud';
  const inbox = String(c.inbox || '');
  const archive = String(c.archive || (inbox ? join(inbox, '_done') : ''));
  const failed = inbox ? join(inbox, '_failed') : '';
  const speakerMap = parseSpeakerMap(c.speakerMap);
  const pollMs = Math.max(1, Number(c.pollSec) || 30) * 1000;
  const sizes = new Map();   // filename -> size seen on the previous poll
  let timer = null, running = false;

  const conn = {
    id, type: 'plaud', platform: 'plaud',
    capabilities: { live: true, history: false, send: false, episodes: true },
    status: initialStatus(),
  };
  const setStatus = (state, info = '') => { conn.status = { state, info, at: Date.now() }; ctx.onStatus?.(conn.status); };
  const pending = () => readdirSync(inbox, { withFileTypes: true }).filter((d) => d.isFile() && isCandidate(d.name)).map((d) => d.name);

  function processFile(name) {
    const full = join(inbox, name);
    const st = statSync(full);
    const parsed = parseTranscript(readFileSync(full, 'utf8'), { filename: name, mtimeMs: st.mtimeMs, speakerMap });
    if (!parsed.turns.length && !parsed.summary) {
      const to = moveUnique(full, failed);
      ctx.log?.(`plaud: no transcript found in ${name} → ${to}`);
      return null;
    }
    const ep = makeEpisode({
      id: hashId(`${name}|${st.size}|${parsed.turns[0]?.text || parsed.summary}`), connector: id, platform: 'plaud',
      title: parsed.title, ts: parsed.ts, durationMs: parsed.durationMs, turns: parsed.turns, summary: parsed.summary,
      meta: { file: name },
    });
    ctx.onEpisode?.(ep);   // emit before archiving: if the engine throws, the file stays in the inbox for a retry
    const to = moveUnique(full, archive);
    ep.meta.archivedAs = to;
    return ep;
  }

  async function pollOnce() {
    if (!inbox || !existsSync(inbox)) { setStatus('error', `Inbox folder not found: ${inbox}`); return []; }
    const out = [];
    let names;
    try { names = pending(); } catch (e) { setStatus('error', e.message); return out; }
    const present = new Set(names);
    for (const k of [...sizes.keys()]) if (!present.has(k)) sizes.delete(k);
    for (const name of names) {
      let size;
      try { size = statSync(join(inbox, name)).size; } catch { continue; }
      const prev = sizes.get(name);
      sizes.set(name, size);
      if (prev !== size || size === 0) continue;   // new or still growing — wait for a stable second look
      try { const ep = processFile(name); if (ep) out.push(ep); sizes.delete(name); }
      catch (e) { ctx.log?.(`plaud: failed on ${name}: ${e.message}`); }
    }
    setStatus('up', `watching ${inbox}${sizes.size ? ` · ${sizes.size} waiting` : ''}`);
    return out;
  }

  function schedule() { if (running) timer = setTimeout(async () => { await pollOnce(); schedule(); }, pollMs); }

  conn.start = async () => {
    if (running) return;
    if (!inbox) { setStatus('error', 'inbox is required'); return; }
    running = true;
    try { if (existsSync(inbox)) mkdirSync(archive, { recursive: true }); } catch {}
    await pollOnce();
    schedule();
  };
  conn.stop = () => { running = false; if (timer) clearTimeout(timer); timer = null; setStatus('idle', 'stopped'); };
  conn._pollOnce = pollOnce;

  conn.test = async () => {
    if (!inbox) return { ok: false, error: 'inbox is required' };
    try {
      if (!existsSync(inbox) || !statSync(inbox).isDirectory()) return { ok: false, error: `Inbox folder not found: ${inbox}` };
      const n = pending().length;
      return { ok: true, info: `${n} pending file${n === 1 ? '' : 's'} in inbox` };
    } catch (e) { return { ok: false, error: e.message }; }
  };

  return conn;
}

export default {
  type: 'plaud', label: 'Plaud recordings (inbox folder)', platform: 'plaud',
  capabilities: { live: true, history: false, send: false, episodes: true },
  configSchema, create,
};
