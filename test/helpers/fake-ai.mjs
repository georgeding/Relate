// A fake OpenAI-compatible provider for tests: recognises each Relate prompt and answers in the shape the
// engine expects (JSON mode, streaming SSE, tool calls). Every request is recorded so tests can assert on
// the prompts themselves (names, no leftovers) without spending real tokens.
import http from 'node:http';

const J = (o) => JSON.stringify(o);
const last = (msgs) => String(msgs[msgs.length - 1]?.content || '');
const all = (msgs) => msgs.map((m) => String(m.content || '')).join('\n');

function answerFor(body) {
  const msgs = body.messages || [];
  const text = all(msgs), user = last(msgs);
  // tool loop: first ask for run_sql, then answer from the tool result
  if (body.tools?.some((t) => t.function?.name === 'run_sql') && /本月营收/.test(text)) {
    if (!msgs.some((m) => m.role === 'tool')) return { tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'run_sql', arguments: J({ sql: 'select sum(total) from orders' }) } }] };
    const res = [...msgs].reverse().find((m) => m.role === 'tool')?.content || '';
    return { content: `本月营收查到了：${res}` };
  }
  if (body.tools?.some((t) => t.function?.name === 'send_message') && /帮我发/.test(text)) {
    if (!msgs.some((m) => m.role === 'tool')) return { tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'send_message', arguments: J({ chatId: 'grp1', text: '明早十点开会' }) } }] };
    return { content: '已放进待批准队列，你确认后才会发送。' };
  }
  if (/chat analytics engine/.test(text)) {
    const n = (user.match(/^\d+\. /gm) || []).length;
    return { content: J({ results: Array.from({ length: n }, (_, i) => ({ i, sentiment: i % 3 ? 'positive' : 'negative', score: i % 3 ? 0.6 : -0.4, emotion: i % 3 ? 'love' : 'anger', lang: 'zh', topics: ['约会'], intent: 'emotional' })) }) };
  }
  if (/逐条评估/.test(text)) {
    const ids = [...user.matchAll(/#(\d+) /g)].map((m) => +m[1]);
    return { content: J({ items: ids.map((i) => ({ i, cat: i % 2 ? '真诚有效' : '敷衍仪式', why: '测试' })) }) };
  }
  if (/判断每条待办是否已被/.test(text)) return { content: J({ addressed: [0], stale: [] }) };
  if (/合并重复的待办/.test(text)) return { content: J({ groups: [] }) };
  if (/争执档案/.test(text)) return { content: J({ episodes: ['9/20–9/21 || 礼物之争 || 一方答应的礼物迟迟未兑现，另一方失望翻旧账；最后道歉并约定周末补上。中立判定：诉求合理，但表达方式加剧了冲突。'] }) };
  if (/两个人的视角/.test(text)) return { content: J({ themValid: ['期待被重视'], themCycle: ['翻旧账'], meValid: ['愿意道歉'], meCycle: ['承诺拖延'], shared: ['都愿意沟通'] }) };
  if (/重建记忆|重建一份压缩的/.test(text)) return { content: J({ memory: { moodArc: '回暖', tension: '礼物', theirNeeds: ['被重视'], landmines: ['爽约'], recentEvents: ['09-21 约周末'], watchNow: ['兑现礼物'] }, narrative: { digest: '整体回暖。', patternShift: '道歉更具体', actions: ['周末兑现礼物'], careSignal: '' } }) };
  if (/实时观察/.test(text) && body.response_format) {
    return { content: J({ memory: { moodArc: '回暖', tension: '礼物', theirNeeds: ['被重视'], landmines: ['爽约'], recentEvents: ['09-21 约周末'], watchNow: ['兑现礼物'] }, observation: { headline: '和好中', summary: '刚道歉，气氛回暖。', mood: '回暖', activeTopics: ['礼物'], alerts: ['记得周末的约定'] } }) };
  }
  if (/提炼/.test(text) && body.response_format) return { content: J({ items: [{ text: '周末前把答应的礼物买好', kind: 'promise', who: 'me', credible: true, urgency: 'high', due: '周末', severity: 4, emotion: 4 }, { text: '回复周末吃饭的时间', kind: 'reply', who: 'me', urgency: 'medium', severity: 3, emotion: 3 }] }) };
  if (/起一个简短中文标题/.test(text)) return { content: '周末约会计划' };
  if (/关系体检/.test(text)) return { content: ['## 依恋类型', 'a', '## 健康度评分', 'b', '## 期待成熟度', 'c', '## Gottman 四骑士', 'd', '## 绿灯 与 红旗', 'e', '## 给 Alex 的建议', 'f'].join('\n') };
  if (/回消息的/.test(text)) return { content: '好呀，周六晚上七点见，礼物我已经准备好了～\n💡 别再迟到' };
  if (/普查/.test(user)) return { content: '**道歉普查：共 N 条**\n## 分类占比\n…' };
  return { content: '根据聊天记录，你们约了周末吃饭 [0]。' };
}

export async function startFakeAi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const body = JSON.parse(b || '{}');
      requests.push({ auth: req.headers.authorization, body });
      if (req.headers.authorization !== 'Bearer fake-key') { res.writeHead(401); return res.end('{"error":"bad key"}'); }
      const a = answerFor(body);
      const usage = { prompt_tokens: 100, completion_tokens: 20 };
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const piece of String(a.content || '').match(/[\s\S]{1,6}/g) || []) res.write(`data: ${J({ choices: [{ delta: { content: piece } }] })}\n\n`);
        res.write(`data: ${J({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(J({ choices: [{ message: { role: 'assistant', content: a.content || '', tool_calls: a.tool_calls }, finish_reason: a.tool_calls ? 'tool_calls' : 'stop' }], usage }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { base: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => new Promise((ok) => server.close(ok)) };
}
