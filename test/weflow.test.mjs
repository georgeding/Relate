// End to end: a space reading WeChat through the weflow connector, against a fake WeFlow API —
// history backfill, names, direction, system/media handling, the live SSE push, reconnect after a drop,
// allowlist filtering, a bad token, and the hub-style connection test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startFakeWeflow } from './helpers/fake-weflow.mjs';
import { bootSpace } from './helpers/space.mjs';

test('weflow connector: backfill, live push, reconnect, allowlist, bad token', async (t) => {
  const wf = await startFakeWeflow();
  const s = await bootSpace({
    connectors: [{ id: 'wx', type: 'weflow', base: wf.base, token: wf.token, meIds: ['wxid_me'], resyncSec: 3600 }],
    chats: [{ connector: 'wx', chatId: 'wxid_sam', name: 'Sam', kind: 'dm', session: 'wxid_sam' }, { connector: 'wx', chatId: '123@chatroom', name: 'Family', kind: 'group', session: '123@chatroom' }],
  });
  t.after(async () => { await s.stop(); await wf.close(); });

  // history backfill for every allowlisted chat: system message dropped, image kept as a marker
  const st = await s.until(async () => { const b = (await s.get('/api/state')).body; return b.kpi.total >= 4 ? b : null; }, 10000, 'backfill');
  const texts = st.recent.map((m) => m.content);
  assert.ok(texts.includes('晚上吃什么') && texts.includes('火锅？') && texts.includes('周日回家吃饭'));
  assert.ok(!texts.includes('系统消息'), 'system messages are dropped');
  assert.ok(texts.includes('[image]'), 'media becomes a marker');
  assert.equal(st.recent.find((m) => m.content === '火锅？').isSend, 1, 'my own messages are marked sent');
  assert.equal(st.recent.find((m) => m.content === '周日回家吃饭').sessionName, 'Family', 'allowlist name wins');

  // live push over SSE (subscriber is connected once the connector reports up)
  await s.until(async () => (await s.get('/api/connectors')).body[0]?.status?.state === 'up', 10000, 'push connected');
  const ts = Math.floor(Date.now() / 1000);
  wf.emit({ rawid: 'live-1', sessionId: 'wxid_sam', senderUsername: 'wxid_sam', content: '到家了吗', timestamp: ts });
  wf.emit({ rawid: 'live-2', sessionId: 'wxid_stranger', senderUsername: 'wxid_stranger', content: '不在名单里', timestamp: ts });
  wf.emit({ rawid: 'live-3', sessionId: 'wxid_sam', senderUsername: 'wxid_me', content: '刚到', timestamp: ts + 1 });
  const live = await s.until(async () => { const b = (await s.get('/api/state')).body; return b.recent.some((m) => m.content === '刚到') ? b : null; }, 10000, 'live messages');
  assert.ok(!live.recent.some((m) => m.content === '不在名单里'), 'chats outside the allowlist are ignored');
  assert.equal(live.recent.find((m) => m.content === '刚到').isSend, 1, 'meIds marks live messages as mine');
  assert.equal(live.recent.find((m) => m.content === '到家了吗').senderName, 'Sam', 'sender names come from WeFlow contacts');

  // WeFlow restarts / drops the stream: the connector reconnects and keeps receiving
  wf.dropSubscribers();
  await s.until(async () => wf.state.subscribers.size > 0, 15000, 'reconnect');
  wf.emit({ rawid: 'live-4', sessionId: 'wxid_sam', senderUsername: 'wxid_sam', content: '重连后', timestamp: ts + 5 });
  await s.until(async () => (await s.get('/api/state')).body.recent.some((m) => m.content === '重连后'), 10000, 'message after reconnect');

  // duplicates (same message from push + resync) are stored once
  const before = (await s.get('/api/state')).body.kpi.total;
  wf.emit({ rawid: 'live-4', sessionId: 'wxid_sam', senderUsername: 'wxid_sam', content: '重连后', timestamp: ts + 5 });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((await s.get('/api/state')).body.kpi.total, before);

  // connection test + chat picker (official accounts hidden)
  assert.match((await s.post('/api/connectors/wx/test')).body.info, /3 chats visible/);
  const chats = (await s.get('/api/connectors/wx/chats')).body;
  assert.deepEqual(chats.map((c) => c.chatId), ['wxid_sam', '123@chatroom']);
  assert.equal(chats[1].kind, 'group');
});

test('weflow connector: a wrong token is reported, not crashed on', async (t) => {
  const wf = await startFakeWeflow();
  const s = await bootSpace({ connectors: [{ id: 'wx', type: 'weflow', base: wf.base, token: 'wrong' }] });
  t.after(async () => { await s.stop(); await wf.close(); });
  const r = (await s.post('/api/connectors/wx/test')).body;
  assert.deepEqual(r, { ok: false, error: 'WeFlow rejected the token' });
  await s.until(async () => (await s.get('/api/connectors')).body[0]?.status?.state === 'down', 10000, 'status down');
  assert.equal((await s.get('/api/state')).status, 200, 'the space keeps running');
});
