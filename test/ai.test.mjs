// End to end with AI ON against a fake OpenAI-compatible provider: every AI feature runs through a real
// space worker (observation, todos + reconcile, sentiment, ask, streaming, census, reply draft, checkup,
// archive/perspectives, tool calls, approval-gated sending), and the prompts carry the configured names.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startFakeAi } from './helpers/fake-ai.mjs';
import { bootSpace } from './helpers/space.mjs';

const ai = (base) => ({ enabled: true, base, key: 'fake-key', model: 'fake-model', pauseWhenNoViewer: false, maxCallsPerHour: 1000, batchSize: 16, analyzeIntervalMs: 1000 });

function convo(now) {
  const lines = [['在吗', 0], ['在的，刚下班', 1], ['你答应我的礼物呢', 0], ['对不起宝宝，周末一定买', 1], ['哼，每次都这样', 0], ['我错了，别生气了，周六请你吃饭', 1], ['好吧，爱你', 0], ['爱你，想你', 1]];
  return lines.map(([text, me], i) => ({ chatId: 'sam', chatName: 'Sam', text, fromMe: !!me, ts: now - (lines.length - i) * 60000 }));
}

test('AI features, relationship space (fake provider)', async (t) => {
  const fake = await startFakeAi();
  const s = await bootSpace({ ai: ai(fake.base) });
  const unwatch = s.watch();
  t.after(async () => { unwatch(); await s.stop(); await fake.close(); });
  assert.equal((await s.push({ messages: convo(Date.now()) })).status, 200);

  // background loops: Living State observation, todo extraction, sentiment, reconcile
  const living = await s.until(async () => { const r = (await s.get('/api/living')).body; return r.memory?.moodArc ? r : null; }, 25000, 'living state');
  assert.equal(living.memory.moodArc, '回暖');
  const st = await s.until(async () => { const b = (await s.get('/api/state')).body; return b.ai?.insight?.headline && b.kpi.analyzed > 0 ? b : null; }, 25000, 'observation + sentiment');
  assert.equal(st.ai.insight.headline, '和好中');
  const rem = await s.until(async () => { const r = (await s.get('/api/reminders')).body; return (r.open || []).length ? r : null; }, 25000, 'todos');
  assert.ok(rem.open.some((x) => /礼物/.test(x.text)), 'extracted the promise');
  assert.ok(rem.open.every((x) => x.scope === 'main'));

  // ask (plain + streaming) and chat titles
  const a1 = await s.post('/api/ask', { q: '我们周末约了什么？' });
  assert.equal(a1.status, 200); assert.match(a1.body.answer, /周末/); assert.deepEqual(a1.body.cited, [0]);
  await s.until(async () => (await s.get('/api/chats')).body.chats.some((c) => c.title === '周末约会计划'), 10000, 'chat title');
  const a2 = await s.post('/api/ask/stream', { q: '她在意什么', chatId: a1.body.chatId });
  const kinds = a2.body.map((x) => x.type);
  assert.equal(kinds[0], 'meta'); assert.equal(kinds.at(-1), 'done');
  assert.match(a2.body.filter((x) => x.type === 'token').map((x) => x.t).join(''), /周末/);

  // census: exhaustive classify-then-report over every apology
  const c = await s.post('/api/ask/stream', { q: '分析一下所有的道歉' });
  assert.ok(c.body.some((x) => x.type === 'progress'), 'census reports progress');
  assert.match(c.body.filter((x) => x.type === 'token').map((x) => x.t).join(''), /普查/);

  // "记住 X" saves a note with no AI call
  const note = await s.post('/api/ask', { q: '记住：Sam 不吃辣' });
  assert.equal(note.body.remembered, true);
  assert.ok(!fake.requests.some((r) => /记住：Sam 不吃辣/.test(JSON.stringify(r.body.messages.at(-1)))), 'remember never reaches the model');
  assert.ok((await s.get('/api/notes')).body.notes.some((x) => /不吃辣/.test(x.text)));

  // reply draft, voice, checkup, archive + perspectives
  const d = await s.get('/api/reply-preview?scope=main');
  assert.match(d.body.draft, /周六/); assert.match(d.body.note, /迟到/);
  const v = await s.post('/api/voice', { q: 'what did we plan' });
  assert.ok(v.body.answer && !/[*#|]/.test(v.body.answer), 'voice answers are plain text');
  await s.post('/api/checkup/run');
  const ck = await s.until(async () => { const r = (await s.get('/api/checkup')).body; return r.report ? r : null; }, 15000, 'checkup');
  assert.match(ck.report, /## 给 Alex 的建议/);
  await s.post('/api/regen/run');
  const rg = await s.until(async () => { const r = (await s.get('/api/regen')).body; return r.perspectives?.themValid ? r : null; }, 15000, 'regen');
  assert.deepEqual(rg.perspectives.meCycle, ['承诺拖延']);
  assert.equal(rg.archive.episodes[0].tag, '礼物之争');

  // prompts: the configured names are used, and the key is sent
  const prompts = fake.requests.map((r) => JSON.stringify(r.body.messages)).join('\n');
  assert.match(prompts, /Alex/); assert.match(prompts, /Sam/);
  assert.ok(fake.requests.every((r) => r.auth === 'Bearer fake-key'));
  const usage = (await s.get('/api/ai')).body;
  assert.ok(usage.calls >= 8 && usage.errors === 0, `ai usage: ${JSON.stringify({ calls: usage.calls, errors: usage.errors, last: usage.lastError })}`);
});

test('AI tool calls + approval-gated sending, business space (fake provider)', async (t) => {
  const fake = await startFakeAi();
  const sent = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { sent.push(JSON.parse(b)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"out-1"}'); }); });
  await new Promise((ok) => hook.listen(0, '127.0.0.1', ok));
  // a space-local plugin standing in for sql-readonly, so the tool loop needs no database
  const fakeSql = `export default { name: 'fake-sql', description: 'test', tools: [{ name: 'run_sql', description: 'sql', readOnly: true, parameters: { type: 'object', properties: { sql: { type: 'string' } } }, run: () => ({ rows: [{ total: 4242 }] }) }] };`;
  const s = await bootSpace({
    template: 'business', org: { name: 'Acme' }, target: {}, ai: ai(fake.base), acceptGroups: true,
    connectors: [{ id: 'in', type: 'ingest', token: 'tok-123', platform: 'custom', sendWebhook: `http://127.0.0.1:${hook.address().port}/send` }],
    plugins: { 'fake-sql': { enabled: true } },
  }, { pluginFiles: { 'fake-sql': fakeSql } });
  t.after(async () => { await s.stop(); await fake.close(); await new Promise((ok) => hook.close(ok)); });
  await s.push({ messages: [{ chatId: 'grp1', chatName: 'Ops', chatKind: 'group', text: '明天几点开会？', ts: Date.now() - 60000, senderName: 'Kim' }] });

  const q = await s.post('/api/ask', { q: '本月营收多少？' });
  assert.match(q.body.answer, /4242/, 'the answer uses the tool result');
  const toolRound = fake.requests.find((r) => r.body.messages.some((m) => m.role === 'tool'));
  assert.ok(toolRound, 'the tool result went back to the model');

  const ask = await s.post('/api/ask', { q: '帮我发到 Ops 群：明早十点开会' });
  assert.match(ask.body.answer, /待批准/);
  assert.equal(sent.length, 0, 'nothing is sent before approval');
  const pending = (await s.get('/api/approvals')).body.pending;
  assert.equal(pending.length, 1); assert.equal(pending[0].tool, 'send_message');
  const ok = await s.post(`/api/approvals/${pending[0].id}/approve`);
  assert.equal(ok.status, 200);
  await s.until(async () => sent.length === 1, 5000, 'webhook send');
  assert.deepEqual({ chatId: sent[0].chatId, text: sent[0].text }, { chatId: 'grp1', text: '明早十点开会' });

  const prompts = fake.requests.map((r) => JSON.stringify(r.body.messages)).join('\n');
  assert.match(prompts, /Acme/);
});
