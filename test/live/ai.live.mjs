// Live check against a REAL OpenAI-compatible provider, on a small synthetic conversation. Not part of `npm test`.
//   AI_BASE=… AI_KEY=… AI_MODEL=… node test/live/ai.live.mjs
// Capped at AI_MAX_CALLS (default 10) calls; prints what each feature produced and the token usage.
import assert from 'node:assert/strict';
import { bootSpace } from '../helpers/space.mjs';

const { AI_BASE: base, AI_KEY: key, AI_MODEL: model } = process.env;
if (!base || !key || !model) { console.error('set AI_BASE, AI_KEY, AI_MODEL'); process.exit(2); }
const cap = Number(process.env.AI_MAX_CALLS || 10);

const s = await bootSpace({ ai: { enabled: true, base, key, model, pauseWhenNoViewer: false, maxCallsPerHour: cap, batchSize: 16, analyzeIntervalMs: 3600000 } });
const unwatch = s.watch();
const results = {};
const check = async (name, fn) => { try { results[name] = await fn(); console.log(`✓ ${name}:`, JSON.stringify(results[name]).slice(0, 220)); } catch (e) { results[name] = null; console.log(`✗ ${name}: ${e.message.split('\n')[0]}`); } };
try {
  const now = Date.now();
  const lines = [['在吗', 0], ['在的，刚下班', 1], ['你答应我的礼物呢', 0], ['对不起，周末一定买', 1], ['哼，每次都这样', 0], ['我错了，周六请你吃火锅', 1], ['好吧，七点哦', 0], ['好，七点见', 1]];
  await s.push({ messages: lines.map(([text, me], i) => ({ chatId: 'sam', chatName: 'Sam', text, fromMe: !!me, ts: now - (lines.length - i) * 60000 })) });

  await check('observation (Living State)', () => s.until(async () => { const b = (await s.get('/api/state')).body; return b.ai?.insight?.headline ? b.ai.insight : null; }, 90000, 'observation'));
  await check('todos', () => s.until(async () => { const r = (await s.get('/api/reminders')).body; return r.open?.length ? r.open.map((x) => `${x.kind}: ${x.text}`) : null; }, 90000, 'todos'));
  await check('ask (streaming)', async () => { const r = (await s.post('/api/ask/stream', { q: '我们约了什么时间吃什么？' })).body; const t = r.filter((x) => x.type === 'token').map((x) => x.t).join(''); assert.ok(t.length > 5, 'empty answer'); return t; });
  await check('reply draft', async () => { const r = (await s.get('/api/reply-preview?scope=main')).body; assert.ok(r.draft, r.error || 'no draft'); return r; });

  const u = (await s.get('/api/ai')).body;
  console.log(`\nAI usage: ${u.calls} calls, ${u.tokensIn} in / ${u.tokensOut} out tokens, ${u.errors} errors${u.lastError ? ' — last: ' + u.lastError.slice(0, 120) : ''}`);
  console.log('by feature:', JSON.stringify(Object.fromEntries(Object.entries(u.byLabel).map(([k, v]) => [k, `${v.calls} calls ${v.in}/${v.out}`]))));
  const failed = Object.entries(results).filter(([, v]) => v == null).map(([k]) => k);
  console.log(failed.length ? `LIVE AI FAILED: ${failed.join(', ')}` : 'LIVE AI OK');
  process.exitCode = failed.length ? 1 : 0;
} finally { unwatch(); await s.stop(); }
