// End to end: boot a real space worker (server.js) on a scratch config with AI off, push messages through
// the ingest connector, and check the dashboard APIs, built-in plugins, static serving and auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import http from 'node:http';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });

async function bootSpace(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'relate-space-'));
  const port = await freePort();
  const cfg = {
    id: 'e2e', name: 'E2E space', template: 'relationship', contextType: 'relationship', port,
    dataDir: join(dir, 'data'), pluginDir: join(dir, 'plugins'),
    me: { name: 'Alex' }, target: { name: 'Sam', pronoun: '她', togetherDate: '2026-06-17' },
    connectors: [{ id: 'in', type: 'ingest', token: 'tok-123', platform: 'custom' }], chats: [],
    ai: { enabled: false }, auth: { enabled: false }, notify: { enabled: false },
    plugins: { occasions: { enabled: true, festivals: 'cn', dates: ['12-01=Sam birthday'] }, 'keyword-alert': { enabled: true, keywords: ['urgent'] } },
    ...extra,
  };
  mkdirSync(cfg.pluginDir, { recursive: true });
  const file = join(dir, 'runtime.json');
  writeFileSync(file, JSON.stringify(cfg));
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, RELATE_CONFIG: file, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode != null) throw new Error('space exited:\n' + out);
    try { await fetch(base + '/login'); return { base, child, log: () => out, stop: () => child.kill() }; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  child.kill(); throw new Error('space did not start:\n' + out);
}
// raw request, so a custom Host header survives (fetch drops it)
const rawGet = (base, p, headers) => new Promise((ok, fail) => { const u = new URL(base + p); http.get({ host: u.hostname, port: u.port, path: u.pathname, headers }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => ok({ status: r.statusCode, body: b })); }).on('error', fail); });
const get = async (base, p, opts) => { const r = await fetch(base + p, opts); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };

test('space worker: ingest → store → dashboard APIs + built-in plugins', async (t) => {
  const s = await bootSpace();
  t.after(s.stop);
  const now = Date.now();
  const push = (body, token = 'tok-123') => fetch(s.base + '/api/ingest/in', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  assert.equal((await push({ chatId: 'sam', text: 'x' }, 'wrong')).status, 401, 'bad ingest token is refused');
  const r = await push({ messages: [
    { chatId: 'sam', chatName: 'Sam', text: '在吗？有点 urgent', ts: now - 120000, fromMe: false },
    { chatId: 'sam', chatName: 'Sam', text: '在的，怎么了', ts: now - 60000, fromMe: true },
    { chatId: 'grp', chatName: 'Some group', chatKind: 'group', text: 'group chatter', ts: now - 30000 },
  ] });
  assert.equal(r.status, 200);

  const space = (await get(s.base, '/api/space')).body;
  assert.equal(space.name, 'E2E space');
  assert.equal(space.template, 'relationship');
  assert.deepEqual(space.me, { name: 'Alex' });
  assert.equal(space.target.name, 'Sam');
  assert.deepEqual(space.plugins.sort(), ['keyword-alert', 'occasions']);

  const st = (await get(s.base, '/api/state')).body;
  assert.equal(st.kpi.total, 2, 'group message dropped: no allowlist + groups not accepted');
  assert.equal(st.kpi.sent, 1);
  assert.equal(st.rel.waiting.whoShouldReply, 'E', 'I spoke last, so the other person owes the reply');

  const an = (await get(s.base, '/api/analytics')).body;
  assert.equal(an.totalMsgs, 2, 'analytics are computed from this space only');
  assert.equal(an.target.togetherDate, '2026-06-17');

  const occ = (await get(s.base, '/api/p/occasions/upcoming')).body;
  assert.ok(Array.isArray(occ.upcoming) && occ.next, 'occasions plugin route answers');

  const vapid = (await get(s.base, '/api/push/vapid')).body;
  assert.match(vapid.key, /^[A-Za-z0-9_-]{80,}$/, 'push keys are generated on first start');
  const rem = (await get(s.base, '/api/reminders')).body;
  assert.ok(Array.isArray(rem.open));
  assert.equal((await get(s.base, '/api/connectors')).body[0].id, 'in');

  const page = await get(s.base, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/i);
  for (const p of ['/hub/index.html', '/archive', '/others', '/api/metrics', '/../package.json']) assert.equal((await get(s.base, p)).status, 404, `${p} is not served`);
  assert.doesNotMatch(s.log(), /Error|failed/i, 'clean boot log');
});

test('space worker: without a password, only this computer gets in (tunnels / proxies are refused)', async (t) => {
  const s = await bootSpace();
  t.after(s.stop);
  assert.equal((await get(s.base, '/api/state')).status, 200, 'local is fine');
  for (const headers of [{ 'X-Forwarded-For': '203.0.113.9' }, { 'CF-Connecting-IP': '203.0.113.9' }, { Host: 'relate.example.com' }, { 'Tailscale-User-Login': 'me@example.com' }]) {
    const r = await rawGet(s.base, '/api/state', headers);
    assert.equal(r.status, 403, `refused with ${Object.keys(headers)[0]}`);
    assert.match(r.body, /看板密码/);
  }
  const ing = await fetch(s.base + '/api/ingest/in', { method: 'POST', headers: { Authorization: 'Bearer tok-123', 'X-Forwarded-For': '203.0.113.9' }, body: JSON.stringify({ chatId: 'sam', text: 'via bridge' }) });
  assert.equal(ing.status, 200, 'token-authenticated ingest still works through a tunnel');
});

test('space worker: with a password, tunnel visitors get the normal login', async (t) => {
  const s = await bootSpace({ auth: { enabled: true, password: 'pw-secret-1', secret: 'x'.repeat(32), apiToken: 'api-tok' } });
  t.after(s.stop);
  const r = await rawGet(s.base, '/', { 'X-Forwarded-For': '203.0.113.9', Host: 'relate.example.com' });
  assert.equal(r.status, 200); assert.doesNotMatch(r.body, /先设置看板密码/);
  assert.equal((await rawGet(s.base, '/manifest.json', { Host: 'relate.example.com' })).status, 200, 'PWA shell is reachable for install');
});

test('space worker: password auth gates data routes but not ingest', async (t) => {
  const s = await bootSpace({ auth: { enabled: true, password: 'pw-secret-1', secret: 'x'.repeat(32), apiToken: 'api-tok' } });
  t.after(s.stop);
  assert.equal((await get(s.base, '/api/state')).status, 401);
  assert.equal((await get(s.base, '/api/state', { headers: { Authorization: 'Bearer api-tok' } })).status, 200, 'API token works');
  const login = await fetch(s.base + '/login', { method: 'POST', body: JSON.stringify({ password: 'pw-secret-1' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await get(s.base, '/api/space', { headers: { cookie } })).status, 200, 'session cookie works');
  const ing = await fetch(s.base + '/api/ingest/in', { method: 'POST', headers: { Authorization: 'Bearer tok-123' }, body: JSON.stringify({ chatId: 'sam', text: 'hi' }) });
  assert.equal(ing.status, 200, 'bridges authenticate with their own ingest token');
});
