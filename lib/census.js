// Census = exhaustive enumeration of a category over the FULL history (not top-k retrieval),
// so "analyze every apology" can't miss any. We deterministically collect the complete candidate
// set by lexicon, then the AI classifies each in batches (map) and we aggregate (reduce).
import { tagMessage } from './relationship.js';
import { ME, THEM } from './domain/names.js';

const PROMISE_PAT = ['答应', '保证', '承诺', '我会', '以后不会', '一定会', '下次一定', '说到做到', '会改', '不会再'];
const has = (t, arr) => arr.some((k) => t.includes(k));

// each subject: how to detect a member message, and (optional) a pre-hint the AI can use
export const CENSUS_SUBJECTS = {
  apology: { key: 'apology', label: '道歉', match: (m, tag) => tag.sorry, ritual: (tag) => tag.scriptG,
    cats: '真诚有效 / 敷衍仪式 / 自我贬低回避 / 灭火求和',
    catNote: '真诚有效=承认具体过错并有理解或改变；敷衍仪式=模板化空泛（如"对不起宝宝"）无实质；自我贬低回避=把道歉变成自我否定("我太没用了")让对方反过来安慰；灭火求和=只为快速结束冲突而道歉，没真正理解' },
  promise: { key: 'promise', label: '承诺', match: (m, tag) => has(String(m.content || ''), PROMISE_PAT),
    cats: '具体可执行 / 空泛口号 / 有条件 / 重复失信',
    catNote: '具体可执行=有明确行为和时间；空泛口号="我会努力"这类无法验证；有条件=附带要求；重复失信=同类承诺此前已多次出现' },
  conflict: { key: 'conflict', label: '冲突', match: (m, tag) => tag.conflict >= 5,
    cats: '沟通诉求 / 情绪宣泄 / 试探翻旧账 / 升级伤害',
    catNote: '' },
  love: { key: 'love', label: '爱意表达', match: (m, tag) => tag.love,
    cats: '真情具体 / 习惯口头 / 讨好安抚',
    catNote: '' },
};

// does this question want an exhaustive census, and of what?
export function detectCensus(q) {
  const s = String(q || '');
  const agg = /(所有|全部|每一|每个|每条|逐条|逐个|一条条|挨个|统计|数一?数|有多少|多少条|多少个|多少次|几条|几个|几次|census|count them|analyze all|go through (all|every)|each one)/i.test(s);
  if (!agg) return null;
  if (/道歉|对不起|抱歉|认错|sorry|apolog/i.test(s)) return CENSUS_SUBJECTS.apology;
  if (/承诺|答应|保证|说到做到|promise/i.test(s)) return CENSUS_SUBJECTS.promise;
  if (/吵架|冲突|争执|矛盾|fight|argument|conflict/i.test(s)) return CENSUS_SUBJECTS.conflict;
  if (/爱意|情话|表白|想你|love|affection/i.test(s)) return CENSUS_SUBJECTS.love;
  return null;
}

const who = (dir) => (dir === 'G' ? ME : THEM);
function fmt(ts) { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

// gather the COMPLETE set of matching messages, each with the preceding line as context
export function collectCensus(messages, subject, { max = 800 } = {}) {
  const items = []; let prev = null;
  for (const m of messages) {
    const c = String(m.content || '').trim();
    const tag = m._tag || tagMessage(m);
    if (c && subject.match(m, tag)) {
      items.push({
        i: items.length, ts: m.ts, date: fmt(m.ts), who: who(tag.dir), text: c.slice(0, 160),
        ctx: prev ? `${who((prev._tag || tagMessage(prev)).dir)}: ${String(prev.content || '').slice(0, 90)}` : '',
        ritual: subject.ritual ? !!subject.ritual(tag) : false,
      });
    }
    if (c) prev = m;
  }
  const truncated = items.length > max;
  // when over the cap, keep the MOST RECENT (re-index) — and the caller reports the truncation
  const kept = truncated ? items.slice(-max).map((it, k) => ({ ...it, i: k })) : items;
  return { items: kept, total: items.length, truncated };
}
