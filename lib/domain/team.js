// Team domain: a team / project space — ownership, decisions, blockers and collaboration health.
// Reuses the business message signals (question / urgent / commitment…) with a team-lead persona.
import business from './business.js';
import { ME, ORG } from './names.js';

const PERSONA =
`你是 ${ME} 在「${ORG}」团队里的协作助理，熟悉团队成员在聊天里的沟通。职责：
1) 回忆检索——谁说过什么、某件事的来龙去脉，依据「聊天片段」回答，关键结论用 [编号] 标注；
2) 推进与对齐——谁负责什么、做了哪些决定、哪些事卡住或没人认领、谁在等谁；
3) 协作健康——沟通是否顺畅、有没有人过载或被忽略、分歧在哪，给出具体、对事不对人的建议；
4) 执行——起草消息、会议纪要、方案和一般问题，直接务实。
风格：跟随对话语言，简洁、具体、可执行。`;

export default {
  ...business,
  key: 'team',
  persona: PERSONA,
  emptyMemory: { focus: '', owners: [], decisions: [], openLoops: [], blockers: [], waitingOnMe: [], teamHealth: '', recentEvents: [], watchNow: [] },

  observePrompt(memJson, delta) {
    return {
      sys: `你在维护一份不断演进的"${ORG} 团队状态记忆"(压缩版),并基于它给出当下的实时观察。客观、抓重点。只输出合法 JSON。`,
      user:
`当前记忆(压缩版):\n${memJson}\n\n最近对话:\n${delta}\n\n请:(1)把新内容融入记忆并更新它(recentEvents 只保留最近约6条);(2)给出"现在"的观察。
重点:谁负责什么(owners)、做了什么决定(decisions)、哪些事没完成或没人认领(openLoops)、卡点(blockers)、谁在等 ${ME}(waitingOnMe)、团队协作状态(teamHealth)。即使安静,alerts 里也至少给一条 ${ME} 此刻最该跟进的事。
返回 JSON:
{"memory":{"focus":"团队当前重心","owners":["人: 负责的事"],"decisions":["MM-DD 决定"],"openLoops":["未完成/未认领"],"blockers":["卡点"],"waitingOnMe":["谁在等${ME}做什么"],"teamHealth":"一句话","recentEvents":["MM-DD 简述"],"watchNow":["${ME}现在要跟进的"]},
 "observation":{"headline":"<=10字 现在状态","summary":"3-4句:团队现在在发生什么 + 解读","mood":"一个词","activeTopics":["当前话题"],"alerts":["1-3条 该跟进的具体事"]}}`,
    };
  },

  groundPrompt(perChatText) {
    return {
      sys: `你是 ${ME} 在「${ORG}」团队的协作助理。基于最近各对话,整理一份完整、具体的团队状态。落到具体的人和事。只输出合法 JSON。`,
      user:
`下面是最近各个对话的近况(按联系人/群分组):\n\n${perChatText}\n\n请整理「当前团队状态」,每条注明涉及谁。返回 JSON:
{"memory":{"focus":"团队当前重心","owners":["人: 负责的事"],"decisions":["MM-DD 决定"],"openLoops":["未完成/未认领(注明谁)"],"blockers":["卡点(注明谁)"],"waitingOnMe":["谁在等${ME}做什么"],"teamHealth":"一句话","recentEvents":["MM-DD 简述"],"watchNow":["${ME}现在要跟进的"]},
 "narrative":"3-5句 团队近况"}`,
    };
  },
};
