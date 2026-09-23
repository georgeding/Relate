// End to end: the MCP server a space exposes (auth, tools over JSON-RPC), and a space worker running under
// the sandbox (Node permission model) — it still works, but a plugin can't read outside or spawn processes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootSpace } from './helpers/space.mjs';

const rpc = (s, method, params, token = 'api-tok') => fetch(s.base + '/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});

test('mcp: bearer auth, tool list, list_chats / search_messages / get_board', async (t) => {
  const s = await bootSpace({ auth: { enabled: true, password: 'pw-secret-1', secret: 'x'.repeat(32), apiToken: 'api-tok' } });
  t.after(() => s.stop());
  const now = Date.now();
  await s.push({ messages: [
    { chatId: 'sam', chatName: 'Sam', text: '周六七点吃火锅', ts: now - 120000 },
    { chatId: 'sam', chatName: 'Sam', text: '好，七点见', ts: now - 60000, fromMe: true },
  ] });

  assert.equal((await rpc(s, 'tools/list', {}, null)).status, 401, 'no token, no chats');
  const init = await rpc(s, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200);
  const info = (await init.json()).result;
  assert.match(info.instructions, /Alex/); assert.match(info.instructions, /relationship space/);

  const tools = (await (await rpc(s, 'tools/list', {})).json()).result.tools.map((x) => x.name).sort();
  assert.deepEqual(tools, ['get_board', 'get_context', 'get_messages', 'list_chats', 'search_messages', 'search_windows']);
  const call = async (name, args = {}) => JSON.parse((await (await rpc(s, 'tools/call', { name, arguments: args })).json()).result.content[0].text);
  const chats = await call('list_chats');
  assert.ok(JSON.stringify(chats).includes('Sam'));
  const hits = await call('search_messages', { query: '火锅' });
  assert.ok(JSON.stringify(hits).includes('周六七点吃火锅'));
  assert.ok(await call('get_board'));
});

test('sandbox: the worker runs under --permission and plugins stay contained', async (t) => {
  const probe = `import { readFileSync } from 'node:fs';
async function probe() {
  const out = {};
  try { readFileSync(process.env.SystemRoot ? process.env.SystemRoot + '/win.ini' : '/etc/hosts'); out.read = 'allowed'; } catch (e) { out.read = e.code; }
  try { const cp = await import('node:child_process'); cp.execSync('echo hi'); out.spawn = 'allowed'; } catch (e) { out.spawn = e.code; }
  return out; }
export default { name: 'probe', description: 'tries to escape', tools: [{ name: 'probe', readOnly: true, run: probe }],
  routes: { 'GET /api/p/probe/run': async (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(await probe())); } } };`;
  const s = await bootSpace({ plugins: { probe: { enabled: true }, occasions: { enabled: true } } }, { sandbox: true, pluginFiles: { probe } });
  t.after(() => s.stop());
  assert.equal((await s.push({ chatId: 'sam', text: 'hi' })).status, 200, 'ingest works sandboxed');
  assert.equal((await s.get('/api/state')).body.kpi.total, 1);
  assert.ok((await s.get('/api/p/occasions/upcoming')).body.upcoming, 'built-in plugins work sandboxed');
  const r = (await s.get('/api/p/probe/run')).body;
  assert.equal(r.read, 'ERR_ACCESS_DENIED', 'reading outside the install + space folder is blocked');
  assert.equal(r.spawn, 'ERR_ACCESS_DENIED', 'child processes are blocked');
});
