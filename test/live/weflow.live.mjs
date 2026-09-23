// Live check against a REAL running WeFlow (read-only). Not part of `npm test`.
//   WEFLOW_BASE=http://127.0.0.1:5031 WEFLOW_TOKEN=… WEFLOW_CHAT=filehelper node test/live/weflow.live.mjs
// Allowlists ONE chat (default: File Transfer). Prints counts and statuses only — never message text.
import assert from 'node:assert/strict';
import { bootSpace } from '../helpers/space.mjs';

const base = process.env.WEFLOW_BASE || 'http://127.0.0.1:5031', token = process.env.WEFLOW_TOKEN, chat = process.env.WEFLOW_CHAT || 'filehelper';
if (!token) { console.error('set WEFLOW_TOKEN'); process.exit(2); }

const s = await bootSpace({ connectors: [{ id: 'wx', type: 'weflow', base, token, resyncSec: 3600 }], chats: [{ connector: 'wx', chatId: chat, name: 'File Transfer', kind: 'dm', session: chat }] });
try {
  const test = (await s.post('/api/connectors/wx/test')).body;
  console.log('connection test:', test.ok ? test.info : test.error);
  assert.equal(test.ok, true);
  const chats = (await s.get('/api/connectors/wx/chats')).body;
  console.log('chat picker:', chats.length, 'chats,', chats.filter((c) => c.kind === 'group').length, 'groups; official accounts hidden:', !chats.some((c) => c.chatId.startsWith('gh_')));
  assert.ok(chats.length > 0);
  const status = await s.until(async () => { const c = (await s.get('/api/connectors')).body[0]; return c?.status?.state === 'up' ? c.status : null; }, 20000, 'live push up');
  console.log('live push:', status.state);
  const st = await s.until(async () => { const b = (await s.get('/api/state')).body; return b.kpi.total > 0 ? b : null; }, 30000, 'backfill').catch(() => null);
  const b = st || (await s.get('/api/state')).body;
  console.log(`backfill of "${chat}": ${b.kpi.total} messages (${b.kpi.sent} sent by me), sessions in store: ${b.kpi.sessions}`);
  assert.ok(b.topSessions.every((x) => x.session === chat), 'nothing outside the allowlist was stored');
  console.log('space log errors:', (s.log().match(/err|fail/gi) || []).length);
  console.log('LIVE WEFLOW OK');
} finally { await s.stop(); }
