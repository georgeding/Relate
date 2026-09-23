// Conversation windows for retrieval (RAG): chunk messages into dialogue bursts so a search returns
// context, not orphan lines.
import { CFG } from './config.js';

const ME = () => (CFG.me?.name && CFG.me.name !== 'me' ? CFG.me.name : '我');
const THEM = () => CFG.target?.name || '对方';
const SKIP = /^\[(表情|图片|动画表情|视频|拍了拍|语音|文件|位置|转账|red|名片)\]?/;
function fmtDate(ts) { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

// New window on a >GAP pause or after MAX messages.
export function windowDocsFrom(messages, { gapMs = 25 * 60000, max = 14 } = {}) {
  const docs = [];
  let buf = [];               // [{who,text,ts}]
  let startTs = 0, lastTs = 0;
  const flush = () => {
    if (!buf.length) return;
    // drop windows that are only tiny acknowledgements
    const substantive = buf.some((b) => b.text.length >= 4);
    if (substantive || buf.length >= 3) {
      docs.push({
        id: `w:${startTs}`,
        text: buf.map((b) => `${b.who}: ${b.text}`).join('\n'),
        meta: { date: fmtDate(startTs), dateEnd: fmtDate(lastTs), who: '对话', ts: startTs, n: buf.length },
      });
    }
    buf = [];
  };
  for (const m of messages) {
    const c = String(m.content || '').trim();
    if (!c || SKIP.test(c) || c.length < 2) continue;
    if (buf.length && (m.ts - lastTs > gapMs || buf.length >= max)) flush();
    if (!buf.length) startTs = m.ts;
    buf.push({ who: m.isSend ? ME() : (m.senderName || THEM()), text: c, ts: m.ts });
    lastTs = m.ts;
  }
  flush();
  return docs;
}
