// End to end: a scratch hub (RELATE_HOME in a temp dir) — first-run password, creating a space from a
// template, the built-in plugins it lists, plugin secret masking, and starting/stopping the worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('hub: setup → space from template → built-in plugins → masked secrets → worker runs', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'relate-hub-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['hub.js'], { cwd: ROOT, env: { ...process.env, RELATE_HOME: home, HUB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
  let cookie = '';
  const base = `http://127.0.0.1:${port}/hub/api`;
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json() };
  };
  let spaceId = null;
  t.after(async () => { if (spaceId) await call('POST', `/spaces/${spaceId}/stop`).catch(() => {}); child.kill(); });

  for (let i = 0; ; i++) { try { await fetch(base + '/session'); break; } catch { if (i > 100) throw new Error('hub did not start:\n' + out); await sleep(100); } }
  assert.equal((await call('GET', '/session')).body.setupNeeded, true);
  assert.equal((await call('GET', '/spaces')).status, 401, 'everything is locked before setup');
  assert.equal((await call('POST', '/setup', { password: 'short' })).status, 400);
  assert.equal((await call('POST', '/setup', { password: 'correct horse battery' })).status, 200);

  const created = await call('POST', '/spaces', { name: 'Us', template: 'relationship', me: { name: 'Alex' } });
  assert.equal(created.status, 200);
  spaceId = created.body.id;
  const cfg = (await call('GET', `/spaces/${spaceId}`)).body;
  assert.deepEqual(Object.keys(cfg.plugins).sort(), ['occasions', 'reply-nudge'], 'relationship spaces start with the relationship built-ins');

  const plugins = (await call('GET', `/spaces/${spaceId}/plugins`)).body;
  const byName = Object.fromEntries(plugins.map((p) => [p.name, p]));
  for (const n of ['keyword-alert', 'occasions', 'reply-nudge', 'shift-roster', 'sql-readonly']) {
    assert.equal(byName[n]?.scope, 'builtin', `${n} is listed as built-in`);
    assert.equal(byName[n].ok, true, `${n} passes the sandboxed inspection: ${JSON.stringify(byName[n].problems)}`);
  }
  assert.equal(byName.occasions.enabled, true);
  assert.equal(byName['sql-readonly'].enabled, false);

  // a plugin secret is stored, but never sent back to the browser
  const put = await call('PUT', `/spaces/${spaceId}`, { plugins: { ...cfg.plugins, 'sql-readonly': { enabled: true, dbUrl: 'postgres://ro:hunter2@db/x' } } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const masked = (await call('GET', `/spaces/${spaceId}`)).body.plugins['sql-readonly'];
  assert.notEqual(masked.dbUrl, 'postgres://ro:hunter2@db/x');
  assert.ok(masked.dbUrl, 'masked, not blanked');
  assert.equal(JSON.parse(readFileSync(join(home, spaceId, 'config.json'), 'utf8')).plugins['sql-readonly'].dbUrl, 'postgres://ro:hunter2@db/x');
  // saving the masked value back keeps the real secret
  await call('PUT', `/spaces/${spaceId}`, { plugins: { 'sql-readonly': { enabled: false, dbUrl: masked.dbUrl } } });
  assert.equal(JSON.parse(readFileSync(join(home, spaceId, 'config.json'), 'utf8')).plugins['sql-readonly'].dbUrl, 'postgres://ro:hunter2@db/x');

  const started = await call('POST', `/spaces/${spaceId}/start`);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  let status = '';
  for (let i = 0; i < 80 && status !== 'running'; i++) { await sleep(150); status = (await call('GET', '/spaces')).body.find((s) => s.id === spaceId)?.status; }
  assert.equal(status, 'running', 'worker came up:\n' + out);
  const logs = (await call('GET', `/spaces/${spaceId}/logs`)).body.lines.join('\n');
  assert.match(logs, /plugin occasions active/);
  assert.doesNotMatch(logs, /failed to load|setup failed/);
});
