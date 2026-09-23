// Boot a real space worker (server.js) on a scratch config, for end-to-end tests.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function bootSpace(cfgOverrides = {}, { pluginFiles = {}, sandbox = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'relate-space-'));
  const port = await freePort();
  const cfg = {
    id: 'e2e', name: 'E2E space', template: 'relationship', contextType: 'relationship', port,
    dataDir: join(dir, 'data'), pluginDir: join(dir, 'plugins'),
    me: { name: 'Alex' }, target: { name: 'Sam', pronoun: '她', togetherDate: '2026-06-17' },
    connectors: [{ id: 'in', type: 'ingest', token: 'tok-123', platform: 'custom' }], chats: [],
    ai: { enabled: false }, auth: { enabled: false }, notify: { enabled: false }, plugins: {},
    ...cfgOverrides,
  };
  if (cfg.template !== 'relationship') cfg.contextType = cfg.template;
  mkdirSync(cfg.pluginDir, { recursive: true });
  for (const [name, code] of Object.entries(pluginFiles)) writeFileSync(join(cfg.pluginDir, `${name}.js`), code);
  const file = join(dir, 'runtime.json');
  writeFileSync(file, JSON.stringify(cfg));
  // sandbox: the same Node permission flags the hub uses for workers
  const args = sandbox ? ['--permission', `--allow-fs-read=${ROOT}`, `--allow-fs-read=${dir}`, `--allow-fs-write=${dir}`, 'server.js'] : ['server.js'];
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, RELATE_CONFIG: file, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode != null) throw new Error('space exited:\n' + out);
    try { await fetch(base + '/login'); break; } catch { await sleep(100); }
    if (i === 149) { child.kill(); throw new Error('space did not start:\n' + out); }
  }
  const api = {
    base, dir, cfg, child, log: () => out,
    stop: () => new Promise((ok) => { if (child.exitCode != null) return ok(); child.once('exit', ok); child.kill(); }),
    async get(p, opts) { const r = await fetch(base + p, opts); const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() }; },
    async post(p, body, headers = {}) { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) }); const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('ndjson') ? (await r.text()).trim().split('\n').map((l) => JSON.parse(l)) : ct.includes('json') ? await r.json() : await r.text() }; },
    push: (body, token = 'tok-123', connector = 'in') => fetch(`${base}/api/ingest/${connector}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
    // hold an SSE connection open (the dashboard "viewer") — wakes the viewer-gated AI loops
    watch() { const ctl = new AbortController(); fetch(base + '/stream', { signal: ctl.signal }).then((r) => r.body.getReader().read()).catch(() => {}); return () => ctl.abort(); },
    async until(fn, ms = 20000, what = 'condition') { const t = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > t) throw new Error(`timed out waiting for ${what}\n--- log ---\n${out.slice(-3000)}`); await sleep(250); } },
  };
  return api;
}
