// Relationship signal extraction (local, no AI): keyword scoring, direction, daily metrics.
// Direction codes: 'G' = me (the space owner), 'E' = the other person.

// conflict lexicon (weight 1) and strong markers (weight 5)
export const CONFLICT_KW = ['生气', '难受', '崩溃', '委屈', '失望', '吵架', '冷战', '失联', '不理', '翻旧账',
  '歇斯底里', '哭', '发抖', '呕吐', '为什么', '凭什么', '算了', '无所谓', '随便', '你别', '不用了',
  '够了', '烦', '累了', '心寒', '伤心', '道歉', '解释', '借口', '敷衍', '不在乎', '旧账', '每次都'];
export const STRONG_KW = ['分手', '分开', '不想过了', '回不去', '结束', '别聊了', '拉黑', '删了', '不谈了', '毁灭'];

export const SORRY_PAT = ['对不起', '我错了', '抱歉', '我的错'];
export const LOVE_PAT = ['爱你', '想你', '老婆', '宝宝', '亲亲'];
// my templated-reply phrases (apology-as-ritual signal)
export const SCRIPT_PAT_G = ['对不起宝宝', '我会做改变', '我会努力的', '我错啦', '会改的', '以后不会了', '别生气了', '我知道错了'];
// the other person's testing / old-account probing phrases
export const TEST_PAT_E = ['你是不是', '是不是因为', '你会吗', '如果我', '你还会', '每次都', '上次', '之前说', '到底', '为什么不'];
// self-harm / crisis language — feeds ONLY the care alert, never a "score"
export const CARE_KW = ['不想过了', '别醒', '没出生就好了', '不想活', '毁灭自己', '消失算了', '不想醒', '解脱', '活着没意思'];

const has = (t, arr) => arr.some((k) => t.includes(k));
const count = (t, arr) => arr.reduce((n, k) => n + (t.split(k).length - 1), 0);

export function kwScore(text) {
  const t = String(text || '');
  return count(t, STRONG_KW) * 5 + count(t, CONFLICT_KW);
}

// who said it: 'G' (me) or 'E' (the other person)
export function direction(m) {
  return m.isSend ? 'G' : 'E';
}

export function tagMessage(m) {
  const t = String(m.content || '');
  return {
    dir: direction(m),
    conflict: kwScore(t),
    sorry: has(t, SORRY_PAT),
    love: has(t, LOVE_PAT),
    scriptG: has(t, SCRIPT_PAT_G),
    testE: has(t, TEST_PAT_E),
    care: has(t, CARE_KW),
  };
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// live relationship metrics over the message buffer
export function relationshipStats(messages) {
  const today = dayKey(Date.now());
  const cutoff = Date.now() - 35 * 86400000;
  let gToday = 0, eToday = 0, conflictToday = 0, sorryG = 0, sorryE = 0, loveG = 0, loveE = 0, scriptG = 0, testE = 0;
  let careFlag = null;
  const days = {}; // day -> {n, score}
  let last = null;

  for (const m of messages) {
    const tag = m._tag || tagMessage(m);
    const dk = dayKey(m.ts);
    if (m.ts >= cutoff) {
      const dd = days[dk] || (days[dk] = { n: 0, score: 0 });
      dd.n++; dd.score += tag.conflict;
    }
    if (dk === today) {
      if (tag.dir === 'G') gToday++; else eToday++;
      conflictToday += tag.conflict;
      if (tag.sorry) { if (tag.dir === 'G') sorryG++; else sorryE++; }
      if (tag.love) { if (tag.dir === 'G') loveG++; else loveE++; }
      if (tag.scriptG && tag.dir === 'G') scriptG++;
      if (tag.testE && tag.dir === 'E') testE++;
    }
    // care flag only for RECENT events (last 12h) — never pin a historical line
    if (tag.care && m.ts >= Date.now() - 12 * 3600000) careFlag = { at: m.ts, dir: tag.dir, text: String(m.content).slice(0, 80) };
    last = m;
  }

  // who owes a reply right now
  let waiting = null;
  if (last) {
    const owes = last._tag ? last._tag.dir : direction(last); // last speaker was 'owes' the OTHER a reply
    const other = owes === 'G' ? 'E' : 'G';
    waiting = { whoShouldReply: other, lastFrom: owes, minutes: Math.floor((Date.now() - last.ts) / 60000) };
  }

  return {
    today, gToday, eToday, conflictToday, sorryG, sorryE, loveG, loveE, scriptG, testE,
    care: careFlag, waiting, days,
  };
}
