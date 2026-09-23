// A fake WeFlow local API (REST + SSE push) with the same shapes the real app returns, so the weflow
// connector can be tested end to end without WeChat. `emit()` pushes a live message to every subscriber.
import http from 'node:http';

export async function startFakeWeflow({ token = 'wf-token' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const state = {
    sessions: [
      { username: 'wxid_sam', displayName: 'Sam', lastTimestamp: now - 60 },
      { username: '123@chatroom', displayName: 'Family group', lastTimestamp: now - 120 },
      { username: 'gh_news', displayName: 'Some official account', lastTimestamp: now - 30 },
    ],
    contacts: [{ username: 'wxid_sam', remark: 'Sam', nickname: 'sammy' }, { username: 'wxid_kim', nickname: 'Kim' }],
    messages: {
      wxid_sam: [
        { localId: 1, serverId: 's1', localType: 1, createTime: now - 600, isSend: 0, senderUsername: 'wxid_sam', content: '晚上吃什么' },
        { localId: 2, serverId: 's2', localType: 1, createTime: now - 540, isSend: 1, senderUsername: 'wxid_me', content: '火锅？' },
        { localId: 3, serverId: 's3', localType: 10000, createTime: now - 500, isSend: 0, content: '系统消息' },
        { localId: 4, serverId: 's4', localType: 3, createTime: now - 480, isSend: 0, senderUsername: 'wxid_sam', content: '' },
      ],
      '123@chatroom': [{ localId: 9, serverId: 'g9', localType: 1, createTime: now - 300, isSend: 0, senderUsername: 'wxid_kim', content: '周日回家吃饭' }],
    },
    subscribers: new Set(), hits: [], eventId: 0,
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    state.hits.push(u.pathname);
    if (u.searchParams.get('access_token') !== token) { res.writeHead(401); return res.end('unauthorized'); }
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/api/v1/health') return json({ ok: true });
    if (u.pathname === '/api/v1/sessions') return json({ sessions: state.sessions });
    if (u.pathname === '/api/v1/contacts') return json({ contacts: state.contacts });
    if (u.pathname === '/api/v1/messages') {
      const rows = (state.messages[u.searchParams.get('talker')] || []).slice(-Number(u.searchParams.get('limit') || 40));
      return json({ messages: rows.slice().reverse() });   // newest first, like WeFlow
    }
    if (u.pathname === '/api/v1/push/messages') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(': hello\n\n');
      state.subscribers.add(res);
      req.on('close', () => state.subscribers.delete(res));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    base: `http://127.0.0.1:${server.address().port}`, token, state,
    emit(msg) { const id = ++state.eventId; for (const r of state.subscribers) r.write(`id: ${id}\nevent: message.new\ndata: ${JSON.stringify(msg)}\n\n`); return state.subscribers.size; },
    dropSubscribers() { for (const r of state.subscribers) r.destroy(); state.subscribers.clear(); },
    close: () => { for (const r of state.subscribers) r.destroy(); return new Promise((ok) => server.close(ok)); },
  };
}
