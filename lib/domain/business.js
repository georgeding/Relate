// Business domain: ops signals, a chief-of-staff persona, and a Living-State that thinks in
// open loops / who's-waiting / commitments rather than moods and landmines. Names come from the space config.
import { direction, SORRY_PAT } from '../relationship.js';
import { ME, ORG } from "./names.js";

const has = (t, arr) => arr.some((k) => t.includes(k));

const PERSONA =
`你是 ${ME} 的 ${ORG} 业务助理兼幕僚长，长期跟进 ${ORG} 的日常运营，熟悉他和团队、伙伴在聊天里的沟通。你有全部授权。你的职责：
1) 回忆检索——关于业务历史、谁说过什么、某件事进展的问题，依据下面的「聊天片段」回答，关键结论后用 [编号] 标注依据；
2) 待办与跟进——帮 ${ME} 理清：他答应了什么还没做、别人在等他回复什么、有哪些 deadline、哪些事卡住了、该催谁；
3) 人与协作——客观分析每个人的沟通风格、可靠度、当前状态和诉求，帮他更好地推进事情；
4) 出主意与执行——运营建议、起草消息/方案、决策分析、一般问题，直接务实。
风格：中文，坦率直接（frank），抓重点、可执行。一切判断基于真实聊天和数据，不空谈、不灌鸡汤。
篇幅按需：简单问题简短答；需要分析或展开时写透彻、分点清楚。`;

// business message signals — compatible shape (dir/conflict/sorry/love/scriptG/testE/care) so the
// engine + census keep working, PLUS ops-relevant flags (question/urgent/money/commitment).
function tagMessage(m) {
  const t = String(m.content || '');
  const mine = m.isSend === 1;
  return {
    dir: direction(m),
    conflict: 0, love: false, scriptG: false, testE: false, care: false,
    sorry: has(t, SORRY_PAT),
    question: /[?？]|吗[?？]?$|多少|什么时候|几点|能不能|可以吗|怎么弄|行不行/.test(t),
    urgent: /急|尽快|马上|立刻|赶紧|今天内|deadline|asap/i.test(t),
    money: /转账|付款|收款|报价|价格|金额|发票|结算|[¥$]\s?\d/.test(t),
    commitment: mine && (/(安排|处理|搞定|下单|补货|发你|确认|跟进|弄好|办好|搞好|回头弄|回头发)/.test(t) || /(我(会|来|去|把)|待会|回头|明天|等下|稍后|马上就|尽快)/.test(t)),
  };
}

export default {
  key: 'business',
  persona: PERSONA,
  tagMessage,
  speaker: (m) => (m.isSend ? `我(${ME})` : (m.senderName || 'Ta')),
  // drop personal/relationship items that surface inside close-cofounder chats
  todoFilter: (text) => !/(七夕|情人节|女友|男友|老婆|老公|女朋友|男朋友|求婚|纪念日)/i.test(String(text || '')),
  emptyMemory: { focus: '', openLoops: [], waitingOnMe: [], waitingOnThem: [], commitments: [], blockers: [], recentEvents: [], watchNow: [] },

  observePrompt(memJson, delta) {
    return {
      sys: `你在维护一份不断演进的"${ORG}业务状态记忆"(压缩版),并基于它给出当下的实时观察。客观、抓重点。只输出合法 JSON。`,
      user:
`当前记忆(压缩版):\n${memJson}\n\n最近的业务相关对话(可能跨多个联系人,行首标注了是谁):\n${delta}\n\n请:(1)把新内容融入记忆并更新它(recentEvents 只保留最近约6条,旧的合并);(2)基于更新后的记忆给出"现在"的观察。
**只关注 ${ORG}/生意相关的事,忽略 ${ME} 的个人生活/感情私事。**
重点跟踪:哪些事还没完成(openLoops)、谁在等 ${ME} 回复或交付(waitingOnMe)、${ME} 在等谁(waitingOnThem)、谁承诺了什么(commitments)、哪里卡住了(blockers)。即使此刻安静,也要在 alerts 里给出此刻 ${ME} 最该处理或记得的一件事。
返回 JSON:
{"memory":{"focus":"当前业务重心一句话","openLoops":["未完成的具体事项"],"waitingOnMe":["谁在等${ME}做什么"],"waitingOnThem":["${ME}在等谁做什么"],"commitments":["谁答应了什么"],"blockers":["卡点"],"recentEvents":["MM-DD 简述"],"watchNow":["${ME}现在要注意/处理的"]},
 "observation":{"headline":"<=10字 现在状态","summary":"3-4句:业务现在在发生什么 + 结合背景的解读","mood":"一个词","activeTopics":["当前话题"],"alerts":["1-3条:提醒${ME}此刻最该回复/推进/别忘的事(安静时也至少给1条最相关的)"]}}`,
    };
  },

  // full grounding pass: read recent activity PER CHAT and build a complete business state.
  groundPrompt(perChatText) {
    return {
      sys: `你是 ${ME} 的 ${ORG} 幕僚长。基于最近各联系人/群的聊天，整理一份完整、具体的业务状态。客观、抓重点、落到具体的人和事，别空泛。只关注 ${ORG}/生意，忽略个人生活/感情。只输出合法 JSON。`,
      user:
`下面是最近各个对话的近况（按联系人/群分组）：\n\n${perChatText}\n\n请通读后整理出「当前业务状态」。对每个对话都想一想：有没有人在等 ${ME} 回复或交付？${ME} 在等谁做什么？有什么答应了还没做？卡在哪？每一条都要具体、注明涉及谁（如"某某在等你确认数据"）。
返回 JSON：
{"memory":{"focus":"当前业务重心一句话","openLoops":["未完成的具体事项(注明涉及谁)"],"waitingOnMe":["谁在等${ME}做什么"],"waitingOnThem":["${ME}在等谁做什么"],"commitments":["${ME}答应了什么还没做"],"blockers":["卡点/被什么挡住"],"recentEvents":["MM-DD 简述"],"watchNow":["现在最该处理的1-3件"]},"narrative":"3-5句：业务现在整体什么状态、重点和风险"}`,
    };
  },

  todoPrompt(convo) {
    return {
      sys: `你是 ${ME} 的 ${ORG} 业务助理，从业务相关的聊天里提炼 ${ME} 需要亲自处理的**业务**待办。只输出合法 JSON，中文书写 text。不要编造上下文里没有依据的事。`
        + `**只保留与 ${ORG}/生意相关的事项；坚决排除个人生活、感情、家庭、送伴侣礼物、给女友钱等私人事务——即使它们出现在对话里也不要提取。**`,
      user:
`基于下面这段【${ORG}业务对话】上下文，只提炼 ${ME} 需要去做的、还没完成的、**与 ${ORG}业务相关**的具体待办，分三类：
- reply：有人问了 ${ME}、或在等他回复/确认，他还没回
- promise：${ME} 答应要做但还没做的具体事（下单/发送/对接/安排/确认金额/给方案等）
- discuss：需要 ${ME} 做决定、或和合伙人/团队认真商量的悬而未决事项

严格排除：已完成的、纯闲聊、无依据臆测、以及"关注一下"这类监视型笔记。只保留真正需要 ${ME} 去做一件具体事的项。最多 5 条，挑最重要的新待办。text 里注明涉及谁（如"给某某确认…"）。
每条打分（整数）：severity 1-5（紧迫/影响）、emotion 1-5（这里表示对业务的重要程度）。
返回 JSON：
{"items":[{"text":"<简短中文，一个具体动作，注明涉及谁>","kind":"reply|promise|discuss","who":"me|them","credible":true,"urgency":"low|medium|high","due":"<时间短语或空>","severity":3,"emotion":3}]}

对话上下文：
${convo}`,
    };
  },
};
