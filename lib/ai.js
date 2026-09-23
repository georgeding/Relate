// Thin OpenAI-compatible client + chat analysis helpers (todos, Living State, reports, assistant).
import { CFG, DATA_DIR } from './config.js';
import { domain } from './domain/index.js';
import { ME, THEM } from './domain/names.js';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

let callsThisHour = 0;
let hourAnchor = 0;

export const aiStats = { calls: 0, tokensIn: 0, tokensOut: 0, errors: 0, lastError: null, byLabel: {} };
const CALL_LOG = join(DATA_DIR, 'ai_calls.jsonl');
// optional per-model registry (CFG.ai.models): which key (primary or 'full' = fallbackKey) + real price per model.
const REG = CFG.ai.models || {};
const PRICE_IN = CFG.ai.priceIn ?? 1.6, PRICE_OUT = CFG.ai.priceOut ?? 5.6;
const FB_IN = CFG.ai.fallbackPriceIn ?? 8, FB_OUT = CFG.ai.fallbackPriceOut ?? 28;
function keyFor(model) { return REG[model]?.key === 'full' ? (CFG.ai.fallbackKey || CFG.ai.key) : CFG.ai.key; }
function altKey(model) { const p = keyFor(model); return p === CFG.ai.key ? CFG.ai.fallbackKey : CFG.ai.key; }
function priceFor(model) { const r = REG[model]; return r ? [r.priceIn, r.priceOut] : [PRICE_IN, PRICE_OUT]; }
const cost = (model, inTok, outTok, fb) => {
  // price by the actual model — the fallback now targets a *known* cheap model, so bill it correctly
  const r = REG[model];
  const [pi, po] = r ? [r.priceIn, r.priceOut] : (fb ? [FB_IN, FB_OUT] : [PRICE_IN, PRICE_OUT]);
  return inTok / 1e6 * pi + outTok / 1e6 * po;
};
const isQwen = (m) => /qwen/i.test(m || '');
// where to retry when a model errors: a different cheap+reliable model on ITS OWN key, else just
// swap keys for the same model. This stops a dead cheap channel from falling onto a full-price model —
// we drop to CFG.ai.fallbackModel instead.
function fallbackTarget(model) {
  const fm = CFG.ai.fallbackModel;
  if (fm && fm !== model) return { model: fm, key: keyFor(fm) };
  return { model, key: altKey(model) };
}
// qwen3.7-plus is a reasoning model: thinking OFF for bulk/cheap calls, ON only for deep answers.
function applyThink(body, model, think) { if (isQwen(model)) body.enable_thinking = !!think; }

// today's ledger, auto-resets at local midnight
let daily = { date: '', byLabel: {}, calls: 0, cost: 0 };
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function record(label, model, usage, ms, ok, err, fb) {
  const inTok = usage?.prompt_tokens || 0, outTok = usage?.completion_tokens || 0;
  const b = aiStats.byLabel[label] || (aiStats.byLabel[label] = { calls: 0, in: 0, out: 0, errors: 0, model });
  b.calls++; b.in += inTok; b.out += outTok; b.model = model; if (!ok) b.errors++;
  const dk = todayKey();
  if (daily.date !== dk) daily = { date: dk, byLabel: {}, calls: 0, cost: 0, fallbackCalls: 0 };
  const c = daily.byLabel[label] || (daily.byLabel[label] = { calls: 0, in: 0, out: 0, cost: 0, model });
  const cc = cost(model.replace(' (fallback)', ''), inTok, outTok, fb);
  c.calls++; c.in += inTok; c.out += outTok; c.cost += cc; c.model = model;
  daily.calls++; daily.cost += cc; if (fb) daily.fallbackCalls = (daily.fallbackCalls || 0) + 1;
  try { appendFileSync(CALL_LOG, JSON.stringify({ ts: nowMs(), label, model, in: inTok, out: outTok, ms, ok, fb: fb || undefined, err: err || undefined }) + '\n'); } catch {}
}

export function aiDaily() {
  const dk = todayKey();
  if (daily.date !== dk) return { date: dk, byLabel: {}, calls: 0, cost: 0, priceIn: PRICE_IN, priceOut: PRICE_OUT };
  return { ...daily, cost: +daily.cost.toFixed(3), priceIn: PRICE_IN, priceOut: PRICE_OUT };
}

function nowMs() { return Date.now(); }

// hard hourly cap to keep external API usage low (user requirement)
function rateLimited() {
  const h = Math.floor(nowMs() / 3600000);
  if (h !== hourAnchor) { hourAnchor = h; callsThisHour = 0; }
  return callsThisHour >= (CFG.ai.maxCallsPerHour || 60);
}
export function aiBudget() {
  const h = Math.floor(nowMs() / 3600000);
  if (h !== hourAnchor) { hourAnchor = h; callsThisHour = 0; }
  return { used: callsThisHour, cap: CFG.ai.maxCallsPerHour || 60 };
}

// core: returns { content, finish, usage }. `chat` wraps it to return just the string (back-compat).
async function chatFull(messages, { json = false, maxTokens = 800, temperature = 0.2, model, label = 'other', timeoutMs = 120000, think = false } = {}) {
  const useModel = model || CFG.ai.model;
  const mkBody = (m) => { const b = { model: m, messages, max_tokens: maxTokens, temperature }; if (json) b.response_format = { type: 'json_object' }; applyThink(b, m, think); return b; };

  // shared deadline across primary + fallback so the TOTAL call is bounded by timeoutMs
  // (otherwise a slow primary + a fallback attempt could take ~2×timeoutMs and blow the tunnel's limit)
  const deadline = nowMs() + timeoutMs;
  // one attempt against a given model+key; `fb` = the fallback model/key (for cost accounting)
  async function attempt(m, key, fb) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), Math.max(4000, deadline - nowMs()));
    const t0 = nowMs();
    try {
      const res = await fetch(`${CFG.ai.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(mkBody(m)), signal: ctl.signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`AI HTTP ${res.status}: ${txt.slice(0, 200)}`); }
      const data = await res.json();
      aiStats.calls++; callsThisHour++;
      if (data.usage) { aiStats.tokensIn += data.usage.prompt_tokens || 0; aiStats.tokensOut += data.usage.completion_tokens || 0; }
      record(label, m + (fb ? ' (fallback)' : ''), data.usage, nowMs() - t0, true, null, fb);
      return { content: data.choices?.[0]?.message?.content || '', finish: data.choices?.[0]?.finish_reason || 'stop', usage: data.usage };
    } finally { clearTimeout(t); }
  }

  const primaryKey = keyFor(useModel);
  try {
    return await attempt(useModel, primaryKey, false);
  } catch (e) {
    // only fall back if there's real time left — otherwise a stuck primary + a fresh fallback
    // attempt could push total latency past the client/tunnel limits.
    const fb = fallbackTarget(useModel);
    if (fb.key && !(fb.model === useModel && fb.key === primaryKey) && (deadline - nowMs()) > 8000) {
      try { const r = await attempt(fb.model, fb.key, true); log_(`AI fell back (${useModel}→${fb.model}/${label}): ${String(e.message).slice(0, 50)}`); return r; }
      catch (e2) { aiStats.errors++; aiStats.lastError = String(e2.message || e2); record(label, fb.model, null, 0, false, String(e2.message || e2).slice(0, 80), true); throw e2; }
    }
    aiStats.errors++; aiStats.lastError = String(e.message || e);
    record(label, useModel, null, 0, false, String(e.message || e).slice(0, 80), false);
    throw e;
  }
}
async function chat(messages, opts = {}) { return (await chatFull(messages, opts)).content;
}

// raw chat that can pass `tools` and returns the full assistant message (incl tool_calls).
async function chatRaw(messages, { tools, maxTokens = 1000, temperature = 0.4, model, label = 'other', timeoutMs = 70000, think = false } = {}) {
  const useModel = model || CFG.ai.model;
  const mkBody = (m) => { const b = { model: m, messages, max_tokens: maxTokens, temperature }; if (tools) { b.tools = tools; b.tool_choice = 'auto'; } applyThink(b, m, think); return b; };
  const deadline = nowMs() + timeoutMs;
  async function attempt(m, key, fb) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), Math.max(4000, deadline - nowMs())); const t0 = nowMs();
    try {
      const res = await fetch(`${CFG.ai.base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(mkBody(m)), signal: ctl.signal });
      if (!res.ok) { const tx = await res.text().catch(() => ''); throw new Error(`AI HTTP ${res.status}: ${tx.slice(0, 150)}`); }
      const data = await res.json();
      aiStats.calls++; callsThisHour++;
      if (data.usage) { aiStats.tokensIn += data.usage.prompt_tokens || 0; aiStats.tokensOut += data.usage.completion_tokens || 0; }
      record(label, m + (fb ? ' (fallback)' : ''), data.usage, nowMs() - t0, true, null, fb);
      return data.choices?.[0]?.message || {};
    } finally { clearTimeout(t); }
  }
  const pk = keyFor(useModel);
  try { return await attempt(useModel, pk, false); }
  catch (e) { const fb = fallbackTarget(useModel); if (fb.key && !(fb.model === useModel && fb.key === pk) && (deadline - nowMs()) > 8000) { try { return await attempt(fb.model, fb.key, true); } catch (e2) { throw e2; } } throw e; }
}

// assistant WITH tools (e.g. a plugin's run_sql) — can fetch data on demand for any numbers question.
export const VOICE_HINT = 'VOICE MODE: your reply is read aloud in English, so answer in natural spoken ENGLISH regardless of the language of the question or the context. Keep it short — usually 1-3 sentences, just the key point. No markdown, tables, bullet points, numbering, asterisks, hashes, pipes or any symbols, and don\'t read out source-reference numbers. Keep names/proper nouns as they are. Talk like you\'re on a quick phone call. Money in plain speech (e.g. "thirty-seven thousand", "about fifty-four K").';
export async function askWithData(question, windows, ctx = {}, history = [], { onToken, onProgress, voice, deep = false, fast = false } = {}) {
  if (!CFG.ai.enabled) { onToken && onToken('AI 未启用。'); return { answer: 'AI 未启用。', cited: [] }; }
  const { toolSpecs, runTool, toolProgress } = await import('./tools.js');
  const msgs = buildAskMessages(question, windows, ctx, history, !fast);   // lighter context in fast mode
  if (voice) msgs.splice(1, 0, { role: 'system', content: VOICE_HINT });
  const tools = toolSpecs();
  // multi-round tool loop. Thinking ON = smarter tool choice but ~2-3x slower;
  // fast mode (voice) turns it OFF so answers come back in seconds instead of timing out.
  for (let i = 0; i < (fast ? 3 : 5); i++) {
    const m = await chatRaw(msgs, { tools, maxTokens: fast ? 700 : 1300, temperature: 0.4, label: 'ask', timeoutMs: fast ? 40000 : 90000, think: !fast });
    const tcs = m.tool_calls;
    if (tcs && tcs.length) {
      msgs.push({ role: 'assistant', content: m.content || '', tool_calls: tcs });
      for (const tc of tcs) {
        let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        onProgress && onProgress(toolProgress(tc.function.name, args));
        const result = await runTool(tc.function.name, args);
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 5000) });
      }
      continue;
    }
    const ans = (m.content || '(无回答)').trim();
    onToken && onToken(ans);
    return { answer: ans, cited: citedFrom(ans, windows) };
  }
  const fm = await chatRaw([...msgs, { role: 'user', content: '基于以上查询结果直接回答，不要再调用工具。' }], { maxTokens: 1300, label: 'ask', timeoutMs: 60000, think: false });
  const ans = (fm.content || '(无回答)').trim(); onToken && onToken(ans);
  return { answer: ans, cited: [] };
}

// Streaming chat: pushes each token delta through onToken as it arrives. Because bytes start
// flowing immediately, the tunnel's ~100s header timeout never triggers → answers can run long.
// Falls back to the alt key only if nothing was streamed yet (avoids duplicating partial output).
async function chatStream(messages, { maxTokens = 2000, temperature = 0.2, model, label = 'other', timeoutMs = 200000, stallMs = 45000, onToken, think = false } = {}) {
  const useModel = model || CFG.ai.model;
  const mkBody = (m) => { const b = { model: m, messages, max_tokens: maxTokens, temperature, stream: true, stream_options: { include_usage: true } }; applyThink(b, m, think); return b; };
  const deadline = nowMs() + timeoutMs;
  let emitted = 0;
  async function attempt(m, key, fb) {
    const ctl = new AbortController();
    let stall = null;
    const armStall = () => { if (stall) clearTimeout(stall); stall = setTimeout(() => ctl.abort(), stallMs); };
    const total = setTimeout(() => ctl.abort(), Math.max(4000, deadline - nowMs()));
    const t0 = nowMs();
    let full = '', finish = 'stop', inTok = 0, outTok = 0;
    armStall();
    try {
      const res = await fetch(`${CFG.ai.base}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(mkBody(m)), signal: ctl.signal,
      });
      if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`AI HTTP ${res.status}: ${txt.slice(0, 200)}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armStall();
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const ch = j.choices?.[0];
            const delta = ch?.delta?.content || '';
            if (delta) { full += delta; emitted++; try { onToken && onToken(delta); } catch {} }
            if (ch?.finish_reason) finish = ch.finish_reason;
            if (j.usage) { inTok = j.usage.prompt_tokens || inTok; outTok = j.usage.completion_tokens || outTok; }
          } catch {}
        }
      }
      aiStats.calls++; callsThisHour++;
      if (!outTok) outTok = Math.ceil(full.length / 1.7);   // some endpoints omit usage on stream
      aiStats.tokensIn += inTok; aiStats.tokensOut += outTok;
      record(label, m + (fb ? ' (fallback)' : ''), { prompt_tokens: inTok, completion_tokens: outTok }, nowMs() - t0, true, null, fb);
      return { content: full, finish };
    } finally { clearTimeout(total); if (stall) clearTimeout(stall); }
  }
  const primaryKey = keyFor(useModel);
  try {
    return await attempt(useModel, primaryKey, false);
  } catch (e) {
    const fb = fallbackTarget(useModel);
    if (fb.key && !(fb.model === useModel && fb.key === primaryKey) && emitted === 0 && (deadline - nowMs()) > 8000) {
      try { const r = await attempt(fb.model, fb.key, true); log_(`AI stream fell back (${useModel}→${fb.model}/${label}): ${String(e.message).slice(0, 50)}`); return r; }
      catch (e2) { aiStats.errors++; aiStats.lastError = String(e2.message || e2); record(label, fb.model, null, 0, false, String(e2.message || e2).slice(0, 80), true); throw e2; }
    }
    aiStats.errors++; aiStats.lastError = String(e.message || e);
    record(label, useModel, null, 0, false, String(e.message || e).slice(0, 80), false);
    throw e;
  }
}
function log_(m) { try { console.log(new Date().toISOString().slice(11, 19), m); } catch {} }

function safeJson(text) {
  if (!text) return null;
  let t = text.trim();
  // strip code fences if present
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch {}
  // try to locate first { .. last }
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch {} }
  if (s >= 0) { try { return JSON.parse(rebalance(t.slice(s))); } catch {} }
  return null;
}
// glm-5.2 miscounts closers on nested objects about half the time: it drops the final `}` or closes
// the root early right before `,"observation"`. A max_tokens cutoff leaves the tail open the same way.
// Rebalance brackets outside strings so those replies still parse instead of being silently dropped.
function rebalance(t) {
  let out = '', inStr = false, esc = false; const stack = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { out += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      const at = stack.lastIndexOf(ch);
      if (at < 0) continue;                                                 // stray closer
      if (at === 0 && /^\s*,/.test(t.slice(i + 1))) continue;               // root closed early, more keys follow
      while (stack.length - 1 > at) out += stack.pop();                     // it skipped an inner closer
      stack.pop();
    }
    out += ch;
  }
  if (inStr) out += '"';                                                    // cut off mid-string
  out = out.replace(/[\s,]+$/, '');
  while (stack.length) out += stack.pop();
  return out;
}

/**
 * Analyze a batch of messages. Returns array aligned by index with
 * { sentiment: 'positive'|'neutral'|'negative', score: -1..1, emotion, lang, topics:[], intent }
 */
export async function analyzeBatch(items) {
  if (!CFG.ai.enabled || !items.length) return [];
  if (rateLimited()) return [];
  const lines = items.map((m, i) =>
    `${i}. [${m.sessionName || m.session}] ${m.isSend ? '(me)' : '(them)'}: ${String(m.content).slice(0, 240)}`
  ).join('\n');

  const sys = 'You are a precise multilingual (Chinese + English) chat analytics engine. ' +
    'Output ONLY valid JSON. Be concise. Never add commentary.';
  const user =
`Analyze each chat message below. Return JSON:
{"results":[{"i":<index>,"sentiment":"positive|neutral|negative","score":<-1..1 float>,"emotion":"<one word e.g. joy,love,anger,sadness,neutral,anxiety,humor>","lang":"zh|en|other","topics":["<1-3 short topic tags>"],"intent":"<statement|question|request|emotional|logistics|other>"}]}

Messages:
${lines}`;

  const raw = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { json: true, maxTokens: 1400, label: 'sentiment' }
  );
  const parsed = safeJson(raw);
  const out = new Array(items.length).fill(null);
  const arr = parsed?.results || parsed?.data || (Array.isArray(parsed) ? parsed : []);
  for (const r of arr) {
    const i = Number(r.i);
    if (Number.isInteger(i) && i >= 0 && i < items.length) {
      out[i] = {
        sentiment: normSent(r.sentiment),
        score: clamp(Number(r.score), -1, 1),
        emotion: String(r.emotion || 'neutral').toLowerCase().slice(0, 16),
        lang: (r.lang || 'other').toLowerCase().slice(0, 6),
        topics: Array.isArray(r.topics) ? r.topics.map((x) => String(x).slice(0, 24)).slice(0, 3) : [],
        intent: String(r.intent || 'other').toLowerCase().slice(0, 16),
      };
    }
  }
  return out;
}

/**
 * Extract categorized TODOs from the current context of ONE chat.
 * Categories: promise (with credible flag), sensitive (敏感点), reply (需回复), discuss (需讨论).
 * `label` names the other side of the chat; the space's domain prompt decides what to emphasise.
 * Returns [{ text, kind, who, credible, urgency, due }]
 */
export async function extractTodos(recent, label) {
  if (!CFG.ai.enabled || recent.length < 2) return [];
  if (rateLimited()) return [];
  const convo = recent.slice(-70).map((m) =>
    `[${fmtTime(m.ts)}]${m.isSend ? `我(${ME})` : (m.senderName || label || 'Ta')}: ${String(m.content).slice(0, 180)}`
  ).join('\n');
  const { sys, user } = domain.todoPrompt(convo);
  const raw = await chat(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { json: true, maxTokens: 1000, temperature: 0.25, label: 'todos' }
  );
  const parsed = safeJson(raw);
  const arr = parsed?.items || (Array.isArray(parsed) ? parsed : []);
  const clamp5 = (n) => Math.max(1, Math.min(5, Math.round(Number(n) || 3)));
  // sensitive/敏感点 now come from the Living State memory, not extraction — drop them here.
  // domain.todoFilter lets a domain reject off-scope items (e.g. business drops personal/relationship).
  return arr.filter((x) => x && x.text && ['reply', 'promise', 'discuss'].includes(x.kind))
    .filter((x) => !domain.todoFilter || domain.todoFilter(x.text))
    .slice(0, 5)                                    // cap new items per cycle
    .map((x) => ({
      text: String(x.text).slice(0, 200),
      kind: x.kind,
      who: x.who === 'me' ? 'me' : 'them',
      credible: x.credible === false ? false : (x.kind === 'promise' ? Boolean(x.credible) : undefined),
      urgency: ['low', 'medium', 'high'].includes(x.urgency) ? x.urgency : 'medium',
      due: String(x.due || '').slice(0, 40),
      severity: clamp5(x.severity),
      emotion: clamp5(x.emotion),
    }));
}

/**
 * Reconcile open todos against your subsequent replies/actions.
 * `todos`: [{i, kind, text, who}] (i = stable index). Returns [{i, status, reason}]
 * status: 'addressed' | 'open' | 'stale'. ONE cheap call resolves them all.
 */
export async function reconcileTodos(todos, recent, evidence) {
  if (!CFG.ai.enabled || !todos.length) return [];
  if (rateLimited()) return [];
  const convo = recent.slice(-60).map((m) =>
    `[${fmtTime(m.ts)}]${m.isSend ? `我(${ME})` : (m.senderName || 'Ta')}: ${String(m.content).slice(0, 160)}`).join('\n');
  // each todo carries RAG-retrieved evidence from the WHOLE corpus (not just the recent tail),
  // so a task fulfilled in another chat or long ago can still be detected as done.
  const list = todos.map((t) => {
    const ev = evidence && evidence[t.i] ? `\n   ↳ 全库检索到的相关线索：${evidence[t.i]}` : '';
    return `${t.i}. [${t.kind}] ${t.text}${ev}`;
  }).join('\n');
  const sys = `你判断每条待办是否已被 ${ME} 处理，依据是后续消息、行动、以及每条待办下方"全库检索到的相关线索"。中立、只看证据。只输出合法 JSON。`;
  const user =
`根据【最近对话】以及每条待办下方的【全库检索线索】，判断每条待办的状态。判断要严格、只看是否真的做了：
- promise(承诺)：必须有明确证据表明事情**真的做完/兑现了**（例如"已经发了""搞定了""上线了""加好了"）才标 addressed。仅仅是当初答应、提到、讨论过、说"我会做"——**不算完成，保持 open**。
- reply(需回复)：${ME} 已经**实质回应**了对方的问题 → addressed；只是看到问题还没答 → open。
- discuss(需讨论)：双方**已经认真谈过并有结论/决定** → addressed；只是提了一嘴 → open。
- sensitive(雷区)：已冷却不再是当前问题 → stale；否则 open。
**重要：下方"全库检索线索"经常就是当初提出这件事的原话，那只能证明这件事存在，不能证明已完成。别把"提出/承诺"误当成"已完成"。** 拿不准就保持 open。
只有确定已过时/被取代/不再是待办的，才标 stale。

只返回被处理(addressed)或过时(stale)的编号，其余默认 open。JSON：{"addressed":[<编号...>],"stale":[<编号...>]}

待办：
${list}

最近对话（重点看"我(${ME})"的回应）：
${convo}`;
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }],
    { json: true, maxTokens: 900, temperature: 0.2, label: 'reconcile' });
  const p = safeJson(raw) || {};
  const nums = (a) => (Array.isArray(a) ? a : []).map(Number).filter(Number.isInteger);
  return { addressed: nums(p.addressed), stale: nums(p.stale) };
}

// ---------- Living State: an evolving, condensed relationship memory ----------
export const EMPTY_MEMORY = { moodArc: '', tension: '', theirNeeds: [], landmines: [], recentEvents: [], watchNow: [] };

/**
 * Incremental update (cheap/fast model): fold new messages into the condensed memory
 * AND produce the current 实时观察. Small input (memory + a few msgs) → near real-time.
 * Returns { memory, observation }.
 */
// generic memory sanitizer — works for ANY domain schema (caps strings + arrays), so
// relationship (moodArc/landmines…) and business (openLoops/waitingOnMe…) both round-trip.
function sanitizeMemory(m) {
  if (!m || typeof m !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (Array.isArray(v)) out[k] = v.map((s) => String(s).slice(0, 140)).slice(0, 8);
    else if (typeof v === 'string') out[k] = v.slice(0, 200);
  }
  return out;
}

// Business grounding: read recent activity PER CHAT (not a flat tail) and build a full state.
// Cheap-ish: one consolidated call over per-chat recent tails. Runs on boot + daily.
export async function groundBusiness(messages, doneList = []) {
  if (!CFG.ai.enabled || !domain.groundPrompt) return null;
  const byChat = new Map();
  for (const m of messages) { if (!m.content) continue; const a = byChat.get(m.session) || { name: m.sessionName, msgs: [] }; a.msgs.push(m); byChat.set(m.session, a); }
  const cutoff = Date.now() - 45 * 86400000;
  const blocks = [];
  for (const { name, msgs } of byChat.values()) {
    const recent = msgs.filter((m) => m.ts >= cutoff).slice(-16);
    if (recent.length < 2) continue;
    blocks.push(`【${name}】\n` + recent.map((m) => `${m.isSend ? '我' : name}: ${String(m.content).slice(0, 120)}`).join('\n'));
  }
  if (!blocks.length) return null;
  const { sys, user } = domain.groundPrompt(blocks.join('\n\n').slice(0, 9000));
  // tell the grounder what you already handled, so it doesn't re-raise ticked-off items
  const doneNote = (doneList && doneList.length)
    ? `\n\n【以下事项 ${ME} 已完成/已处理，不要再列入待办、承诺、在等、卡点或未完成；除非聊天里有全新进展】\n` + doneList.slice(0, 25).map((t) => '· ' + t).join('\n')
    : '';
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user + doneNote }], { json: true, maxTokens: 1800, temperature: 0.3, label: 'ground' });
  const p = safeJson(raw); if (!p) return null;
  return { memory: sanitizeMemory(p.memory), narrative: p.narrative ? String(p.narrative).slice(0, 600) : null };
}

export async function observeLiving(memory, newMsgs) {
  if (!CFG.ai.enabled || rateLimited()) return null;
  const mem = JSON.stringify(memory || domain.emptyMemory);
  const delta = (newMsgs || []).slice(-24).map((m) => `[${fmtTime(m.ts)}]${domain.speaker(m)}: ${String(m.content).slice(0, 150)}`).join('\n') || '（暂无新消息）';
  const { sys, user } = domain.observePrompt(mem, delta);
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }],
    { json: true, maxTokens: 1500, temperature: 0.3, model: CFG.ai.observModel, label: 'observe' });   // replies run 600-900 tokens; a 900 cap truncated about half of them
  const p = safeJson(raw); if (!p) return null;
  if (!p.observation) return null;   // memory comes first in the reply, so no observation = cut off mid-memory — don't overwrite memory with a partial
  const arr = (x) => Array.isArray(x) ? x.map((s) => String(s).slice(0, 120)).slice(0, 8) : [];
  return {
    memory: sanitizeMemory(p.memory),
    observation: p.observation ? { headline: String(p.observation.headline || '').slice(0, 40), summary: String(p.observation.summary || '').slice(0, 300), mood: String(p.observation.mood || '').slice(0, 20), activeTopics: arr(p.observation.activeTopics).slice(0, 5), alerts: arr(p.observation.alerts).slice(0, 3) } : null,
  };
}

/**
 * Daily re-grounding (main model): rebuild the memory from raw recent history to kill drift,
 * and produce the 近期动态 narrative view. Returns { memory, narrative }.
 */
export async function groundLiving(recentMsgs) {
  if (!CFG.ai.enabled || (recentMsgs || []).length < 5) return null;
  const convo = recentMsgs.slice(-160).map((m) => `[${new Date(m.ts).toLocaleString('zh-CN')}]${m.isSend ? ME : THEM}: ${String(m.content).slice(0, 150)}`).join('\n');
  const sys = '你是中立的关系分析助手。基于最近的真实对话,重建一份压缩的"关系状态记忆",并写一段"近期动态"。中立克制。只输出合法 JSON。';
  const user =
`最近对话:\n${convo}\n\n请重建记忆(去掉过时的、合并重复的)并写近期动态。返回 JSON:
{"memory":{"moodArc":"","tension":"","theirNeeds":[],"landmines":[],"recentEvents":["MM-DD 简述"],"watchNow":[]},
 "narrative":{"digest":"2-3句 最近关系状态","patternShift":"相处模式的新变化(好或坏)","actions":["给两个人的1-3条具体建议"],"careSignal":"需要认真对待的情绪信号,没有就空"}}`;
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }],
    { json: true, maxTokens: 1200, temperature: 0.4, label: 'ground' });
  const p = safeJson(raw); if (!p) return null;
  const arr = (x) => Array.isArray(x) ? x.map((s) => String(s).slice(0, 200)).slice(0, 8) : [];
  const m = p.memory || {}, n = p.narrative || {};
  return {
    memory: { moodArc: String(m.moodArc || '').slice(0, 120), tension: String(m.tension || '').slice(0, 160), theirNeeds: arr(m.theirNeeds), landmines: arr(m.landmines), recentEvents: arr(m.recentEvents).slice(0, 6), watchNow: arr(m.watchNow) },
    narrative: { digest: String(n.digest || ''), patternShift: String(n.patternShift || ''), actions: arr(n.actions).slice(0, 4), careSignal: String(n.careSignal || ''), newEpisodes: [], at: Date.now() },
  };
}

/**
 * Draft a suggested reply preview for the current conversation, grounded in
 * retrieved history (RAG) + the live tail. Uses CFG.ai.replyModel when set.
 * Returns { draft, tone, note }.
 */
export async function draftReply({ label, isMain, tail, ragSnippets }) {
  if (!CFG.ai.enabled) return null;
  const history = (ragSnippets || []).slice(0, 6).map((s) =>
    `· ${s.meta?.date || ''} ${s.meta?.who || ''}: ${String(s.text).slice(0, 120)}`).join('\n');
  const convo = (tail || []).slice(-16).map((m) =>
    `${m.isSend ? '我' : (label || 'Ta')}: ${String(m.content).slice(0, 160)}`).join('\n');
  // plain text (NOT JSON) — robust across models (avoids the JSON double-nesting some models do)
  const sys = isMain && !domain.groundPrompt
    ? `你是在帮 ${ME} 给 ${label} 回消息的贴心助手。模仿 ${ME} 在历史片段里的说话风格和语气，` +
      '给出一条真诚、具体、不敷衍的回复：先接住情绪，再给具体行动或明确答复，避免空洞道歉和空头承诺。' +
      `直接输出这条可发送的消息本身；如果有要提醒 ${ME} 的雷区/承诺，另起一行以「💡」开头写一句。不要 JSON、不要解释。`
    : `你是帮 ${ME} 回消息的助手。给出一条自然得体、可直接发送的回复，语言跟随对话。直接输出消息本身，若有提醒另起一行以「💡」开头。不要 JSON。`;
  const user = `【相关历史片段】\n${history || '（无）'}\n\n【当前对话结尾】\n${convo}\n\n请给出建议回复：`;
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: user }];
  let raw;
  try {
    raw = await chat(msgs, { maxTokens: 400, temperature: 0.6, model: CFG.ai.replyModel, label: 'reply', timeoutMs: 20000 });
  } catch (e) {
    aiStats.lastError = `reply fell back to ${CFG.ai.model}: ${String(e.message || e).slice(0, 60)}`;
    raw = await chat(msgs, { maxTokens: 400, temperature: 0.6, label: 'reply-fallback', timeoutMs: 90000 });
  }
  let text = String(raw || '').trim();
  // if a model still wrapped it in JSON, pull the draft out
  if (text.startsWith('{')) { const j = safeJson(text); if (j?.draft) return { draft: String(j.draft), tone: j.tone || '', note: j.note || '' }; }
  // split off the 💡 reminder line
  const idx = text.indexOf('💡');
  const draft = (idx >= 0 ? text.slice(0, idx) : text).trim();
  const note = idx >= 0 ? text.slice(idx + 2).trim() : '';
  return { draft, tone: '', note };
}

/**
 * RAG answer: given retrieved chat snippets, answer the user's question about
 * the relationship in Chinese, grounded and citing message indices. ONE AI call.
 */
// persona now lives in the domain module (lib/domain/*.js) — use domain.persona.

// friendly labels for the structured memory object (business + relationship keys)
const MEM_LABELS = {
  moodArc: '情绪走向', tension: '当前张力', theirNeeds: '对方的需求', landmines: '雷区', focus: '当前重点',
  waitingOnMe: '等我处理', commitments: '我的承诺', waitingOnThem: '在等别人', blockers: '卡点',
  openLoops: '未完成', recentEvents: '近期事件', watchNow: '需要关注',
};
// render the memory (object OR string) into readable text — previously String(object) => "[object Object]"
function memText(mem) {
  if (!mem) return '';
  if (typeof mem === 'string') return mem;
  const lines = [];
  for (const [k, v] of Object.entries(mem)) {
    if (Array.isArray(v)) {
      const items = v.map((x) => (typeof x === 'string' ? x : (x && x.text) || '')).filter(Boolean);
      if (items.length) lines.push(`${MEM_LABELS[k] || k}：${items.join('；')}`);
    } else if (v) lines.push(`${MEM_LABELS[k] || k}：${v}`);
  }
  return lines.join('\n');
}
// relative age label so the model can tell live from old ("刚刚" vs "4天前")
function relAge(ts, now) {
  const min = (now - ts) / 60000, hr = min / 60, day = hr / 24;
  if (min < 8) return '刚刚';
  if (min < 60) return Math.round(min) + '分钟前';
  if (day < 1 && new Date(ts).getDate() === new Date(now).getDate()) return Math.round(hr) + '小时前·今天';
  if (day < 2) return '昨天';
  if (day < 8) return Math.round(day) + '天前';
  const d = new Date(ts); return `${d.getMonth() + 1}月${d.getDate()}日`;
}
// hybrid NOW boundary: the current conversation burst (consecutive msgs with <3h gaps) within ~24h.
// Anything outside it is "earlier" — usable for analysis but never as "现在/刚才".
function liveTail(recent) {
  const now = nowMs();
  if (!recent || !recent.length) return { now, live: [], earlier: [] };
  const GAP = 3 * 3600 * 1000, DAY = 26 * 3600 * 1000;
  const s = recent.slice();
  if (now - s[s.length - 1].ts > DAY) return { now, live: [], earlier: s };   // nothing fresh
  const live = [s[s.length - 1]];
  for (let i = s.length - 2; i >= 0; i--) {
    if (s[i + 1].ts - s[i].ts > GAP || now - s[i].ts > DAY) break;
    live.unshift(s[i]);
  }
  const set = new Set(live);
  return { now, live, earlier: s.filter((m) => !set.has(m)) };
}
function ctxBlock(ctx, deep = false) {
  // deep questions get a much longer memory/narrative slice for fuller grounding
  const mem = deep ? 3200 : 1400, nar = deep ? 1600 : 800, obs = deep ? 900 : 500;
  const parts = [];
  // the model has no clock — tell it the real date, or it guesses "this month" (was answering April in July)
  const nowStr = new Date().toLocaleString('zh-CN', { ...(CFG.timezone ? { timeZone: CFG.timezone } : {}), year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
  parts.push(`【当前时间】现在是 ${nowStr}。凡是"今天/现在/本月/这个月/最近/上周/昨天"一律以此为准；写 SQL 算"本月/今天"时用 current_date（或其所在年月），绝不要硬编码月份或凭空假设。`);
  if (ctx?.notes) parts.push(ctx.notes);
  if (ctx?.done) parts.push(ctx.done);
  if (ctx?.metrics) parts.push(ctx.metrics);
  if (ctx?.self) parts.push(`【关于 ${ME} 本人（帮 TA 时更懂 TA、用 TA 的方式，必要时温和地提醒盲点）】\n${ctx.self}`);
  if (ctx?.snapshot?.text) parts.push(`【行为数据（来自真实统计）】\n${ctx.snapshot.text}`);
  if (ctx?.trends) parts.push(ctx.trends);
  if (ctx?.contacts) parts.push(ctx.contacts);
  if (ctx?.memory) { const mt = memText(ctx.memory); if (mt) parts.push(`【关系/业务记忆（长期浓缩）】\n${mt.slice(0, mem)}`); }
  if (ctx?.narrative) parts.push(`【当前叙事】\n${String(ctx.narrative).slice(0, nar)}`);
  if (ctx?.observation) parts.push(`【最新实时观察】\n${String(ctx.observation).slice(0, obs)}`);
  // the real latest messages — split into the LIVE burst ("现在") vs earlier (dated) so the model
  // never narrates 4-day-old fragments as "刚才/今天".
  if (ctx?.recent?.length) {
    const { now, live, earlier } = liveTail(ctx.recent);
    const fmt = (r) => `${r.who}：${r.text}`;
    if (live.length) {
      parts.push(`【现在·实时对话（这才是"刚才/现在"最新的交流；任何"现在该说什么/话术"只能针对这里）】\n${live.map(fmt).join('\n')}`);
    } else {
      parts.push('【注意：现在没有正在进行的实时对话（最近的交流已经过去一阵了）。不要凭空说"对方刚才说了X"或编造当下情景——如需给话术，先说明现在没有需要立即回应的消息。】');
    }
    const older = earlier.slice(deep ? -24 : -14);
    if (older.length) parts.push(`【较早的近期对话（仅作背景参考，每条已标时间；绝不要当成"现在/刚才"发生的事）】\n${older.map((r) => `[${relAge(r.ts, now)}] ${fmt(r)}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

// shared message builder for the assistant (streaming + non-streaming use the same context).
// multi-turn: prior turns give continuity; the heavy context block rides only on the current message.
function buildAskMessages(question, windows, ctx = {}, history = [], deep = false) {
  const snips = (windows || []).map((s, i) =>
    `[${i}] ${s.meta?.date || ''}${s.meta?.dateEnd ? '–' + s.meta.dateEnd : ''}\n${String(s.text).slice(0, deep ? 900 : 600)}`
  ).join('\n\n');
  const user =
`${ctxBlock(ctx, deep)}

【可能相关的历史聊天片段（都是过去的记录，时间见每段开头；用于分析，不要当成刚刚发生的事）】
${snips || '（无）'}

【时间铁律】上面凡是带时间标注（"X天前""昨天""几月几日"）的都是历史。只有"现在·实时对话"里的才算当下。分析尽管引用历史（注明时间没问题），但任何"现在该说的话/话术"必须只基于"现在·实时对话"；若那里没有需要回应的新消息，就直说"现在没有需要立即回应的，等对方再开口"，绝不能把几天前的内容（比如某条旧消息、某个旧梗）说成"对方刚才/今天…"。

${ME} 的问题：${question}

请直接回答。分析部分可引用历史[编号]并注明时间；若要给"现在可以说/做"，只依据"现在·实时对话"。`;
  const msgs = [{ role: 'system', content: domain.persona }];
  for (const h of (history || []).slice(-6)) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) msgs.push({ role: h.role, content: String(h.content).slice(0, 1800) });
  }
  msgs.push({ role: 'user', content: user });
  return msgs;
}
const citedFrom = (answer, windows) =>
  [...new Set([...String(answer).matchAll(/\[(\d+)\]/g)].map((m) => +m[1]))].filter((n) => n < (windows || []).length);

export async function askAssistant(question, windows, ctx = {}, history = [], deep = false, voice = false) {
  if (!CFG.ai.enabled) return { answer: 'AI 未启用。', cited: [] };
  const msgs = buildAskMessages(question, windows, ctx, history, deep);
  if (voice) msgs.splice(1, 0, { role: 'system', content: VOICE_HINT });
  const r = await chatFull(msgs, { maxTokens: deep ? 5000 : 4000, temperature: 0.5, label: 'ask', timeoutMs: 110000, think: deep });
  let answer = (r.content || '(无回答)').trim();
  if (r.finish === 'length') answer += '\n\n_（回答较长还没写完——回复「继续」我接着写。）_';
  return { answer, cited: citedFrom(answer, windows) };
}

// streaming variant: tokens are pushed through onToken as they arrive; returns the full answer + cites.
// No CF-timeout worry (bytes start flowing immediately) so answers can be as long as needed.
export async function askAssistantStream(question, windows, ctx = {}, history = [], onToken, deep = false) {
  if (!CFG.ai.enabled) { onToken && onToken('AI 未启用。'); return { answer: 'AI 未启用。', cited: [] }; }
  const msgs = buildAskMessages(question, windows, ctx, history, deep);
  const r = await chatStream(msgs, { maxTokens: deep ? 5000 : 4000, temperature: 0.5, label: 'ask', timeoutMs: 200000, stallMs: deep ? 70000 : 45000, onToken, think: deep });
  let answer = (r.content || '').trim();
  if (r.finish === 'length') { const tail = '\n\n_（回答较长还没写完——回复「继续」我接着写。）_'; answer += tail; onToken && onToken(tail); }
  return { answer, cited: citedFrom(answer, windows) };
}

// Exhaustive census: classify EVERY item (map, batched, fast model) then aggregate + summarize
// (reduce, streamed). Guarantees completeness — the candidate set is deterministic, not retrieved.
export async function censusAnalyze(subject, collected, ctx = {}, { onProgress, onToken } = {}) {
  const items = collected.items, N = items.length;
  if (!N) { const r = `在完整聊天记录里没有找到「${subject.label}」类消息。`; onToken && onToken(r); return { report: r, tallies: {}, total: 0 }; }
  const BATCH = 30, batches = [];
  for (let i = 0; i < N; i += BATCH) batches.push(items.slice(i, i + BATCH));
  onProgress && onProgress(`在完整记录里找到 ${collected.total} 条${subject.label}${collected.truncated ? `，取最近 ${N} 条` : ''}，分 ${batches.length} 批逐条分析…`);

  const mapModel = CFG.ai.observModel || CFG.ai.model;   // fast model for per-item classification
  const classify = async (batch, model) => {
    const lines = batch.map((it) => `#${it.i} [${it.date}] ${it.who}${it.ritual ? '(疑似模板)' : ''}｜前一句:${it.ctx || '无'}｜内容:${it.text}`).join('\n');
    const sys = `你在逐条评估一段真实聊天里 ${ME} 和 ${THEM} 的「${subject.label}」。只依据每条内容和前一句，客观判断，不脑补。`;
    const user = `把下面每一条归入其一：${subject.cats}。${subject.catNote ? '（' + subject.catNote + '）' : ''}
必须对**每一个编号**都输出，一个都不能漏。每条给一句极简理由。
只返回 JSON：{"items":[{"i":<编号>,"cat":"<类别>","why":"<理由>"}]}

${lines}`;
    const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }],
      { json: true, maxTokens: 1800, temperature: 0.2, label: 'census', model, timeoutMs: 60000 });
    const p = safeJson(raw) || {};
    return Array.isArray(p.items) ? p.items : [];
  };

  // limited-concurrency pool over batches, with progress
  const verdicts = new Map(); let done = 0; const POOL = 4;
  for (let s = 0; s < batches.length; s += POOL) {
    const chunk = batches.slice(s, s + POOL);
    const rs = await Promise.all(chunk.map((b) => classify(b, mapModel).catch(() => [])));
    for (const arr of rs) for (const v of arr) if (typeof v.i === 'number' && v.cat) verdicts.set(v.i, v);
    done += chunk.length;
    onProgress && onProgress(`已分析 ${Math.min(done * BATCH, N)}/${N} 条…`);
  }
  // second pass: re-run any items the fast model skipped, on the stronger model — so none are lost
  let missed = items.filter((it) => !verdicts.has(it.i));
  if (missed.length) {
    onProgress && onProgress(`补判 ${missed.length} 条漏掉的…`);
    for (let s = 0; s < missed.length; s += BATCH) {
      const arr = await classify(missed.slice(s, s + BATCH), CFG.ai.model).catch(() => []);
      for (const v of arr) if (typeof v.i === 'number' && v.cat) verdicts.set(v.i, v);
    }
  }

  // canonicalize free-form model labels back to the defined categories (else '其他')
  const canon = subject.cats.split('/').map((s) => s.trim()).filter(Boolean);
  const norm = (cat) => { const c = String(cat || '').trim(); if (!c) return '其他/难判定'; for (const k of canon) if (c.includes(k) || k.includes(c)) return k; return '其他/难判定'; };
  // reduce: tally + gather examples (2nd pass already backfilled skips, so nothing is lost)
  const tallies = {}; const examples = {};
  for (const it of items) {
    const v = verdicts.get(it.i);
    it.cat = norm(v && v.cat); it.why = (v && v.why) || '';
    tallies[it.cat] = (tallies[it.cat] || 0) + 1;
    (examples[it.cat] = examples[it.cat] || []).push(it);
  }
  const tallyLine = Object.entries(tallies).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}条(${Math.round(v / N * 100)}%)`).join('，');
  const exBlock = Object.entries(examples).map(([cat, arr]) =>
    `【${cat}】共${arr.length}条，例：\n${arr.slice(0, 5).map((it) => `- ${it.date} ${it.who}：${it.text}｜${it.why}`).join('\n')}`).join('\n\n');

  const sys2 = domain.persona;
  const user2 = `${ctxBlock(ctx, true)}

这是对全部 ${N} 条「${subject.label}」逐条分类后的**完整普查结果**（不是抽样）：
分类统计：${tallyLine}

各类代表例子：
${exBlock}

请用中文 Markdown 给一份「${subject.label}普查报告」：
第一行写：**${subject.label}普查：共 ${N} 条**
## 分类占比（用表格：类别｜条数｜占比｜含义）
## 关键发现（哪一类最多、说明了什么模式）
## 对 ${ME} 的直接影响与建议（2-3 条具体行动）
诚实、基于上面的真实统计，不灌鸡汤。`;
  const r2 = await chatStream([{ role: 'system', content: sys2 }, { role: 'user', content: user2 }],
    { maxTokens: 2200, temperature: 0.4, label: 'census', onToken, timeoutMs: 120000 });
  return { report: r2.content, tallies, total: N };
}

// group semantically-duplicate todos (same task, different wording) — cheap one call.
// returns array of index-groups, e.g. [[0,1,2],[5,9,12]]. Only groups with 2+ members.
export async function dedupeTodos(todos) {
  if (!CFG.ai.enabled || (todos || []).length < 2) return [];
  const list = todos.map((t) => `${t.i}. ${String(t.text).slice(0, 120)}`).join('\n');
  const sys = '你在合并重复的待办清单。把指向"同一件具体事情"的条目分到一组，即使措辞、补充说明不同。判断以核心动作+对象为准（例如都是"催供应商发报价"、都是"给网站加限流"、都是"订周末的餐厅"就是同一件事）。只输出合法 JSON。';
  const user = `下面的待办有很多其实是同一件事的重复。把它们按"同一件事"分组，只返回含 2 条及以上的重复组，独立的不用返回。
返回 JSON：{"groups":[[编号,编号,...], ...]}

${list}`;
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }],
    { json: true, maxTokens: 700, temperature: 0.1, label: 'dedupe' });
  const p = safeJson(raw) || {};
  return (Array.isArray(p.groups) ? p.groups : [])
    .map((g) => (Array.isArray(g) ? g.map(Number).filter(Number.isInteger) : []))
    .filter((g) => g.length > 1);
}

// short auto-title for a chat, from its first exchange — cheap + fast (tiny output).
export async function chatTitle(userMsg, answer) {
  if (!CFG.ai.enabled) return '';
  try {
    const raw = await chat(
      [{ role: 'system', content: '给下面这段对话起一个简短中文标题，概括主题，6到12个字，只输出标题本身，不要标点、引号或"标题："前缀。' },
       { role: 'user', content: `问：${String(userMsg || '').slice(0, 200)}\n答：${String(answer || '').slice(0, 300)}` }],
      { maxTokens: 24, temperature: 0.3, label: 'title', timeoutMs: 20000 });
    return String(raw || '').replace(/["'「」《》【】\n\r：:]/g, '').trim().slice(0, 20);
  } catch { return ''; }
}

// Structured deep report: attachment styles, health scorecard, expectations, Gottman, flags.
export async function relationshipCheckup(ctx = {}, windows = []) {
  if (!CFG.ai.enabled) return { report: 'AI 未启用。', at: null };
  const evidence = (windows || []).slice(0, 10).map((s, i) =>
    `[${i}] ${s.meta?.date || ''}: ${String(s.text).slice(0, 400)}`
  ).join('\n\n');
  const user =
`${ctxBlock(ctx)}

【部分对话样本】
${evidence || '（无）'}

请为 ${ME} 和 ${THEM} 做一次「关系体检」。用 Markdown 输出，严格包含以下全部 6 个小节（标题用 ##）。
**极其重要：必须写完所有 6 节。每节保持精炼——每条证据一句话即可，不要长篇大论，把篇幅均匀分配给 6 节，宁可每节短一点也要全部写完。**

## 依恋类型
${ME} 和 ${THEM} 各判断依恋类型（安全/焦虑/回避/混乱）+ 置信度(低/中/高) + 1 条最关键证据。每人 2-3 行。
## 健康度评分
用一个 Markdown 表格：列为 维度 | 分数 | 一句点评。维度为 沟通、信任、冲突修复、付出平衡、互相尊重，各 1-10 分。
## 期待成熟度
2-4 行：谁的期待偏高或偏低、是否符合成熟关系。
## Gottman 四骑士
2-4 行：是否出现 批评/蔑视/防御/冷战，在谁身上更明显。
## 绿灯 与 红旗
各 2-3 条，短句。
## 给 ${ME} 的建议
2-3 条具体、可马上做的行动，每条一句。

诚实、基于证据、不站队、不灌鸡汤。再次强调：6 节全部写完，别在中途停。`;
  const report = await chat(
    [{ role: 'system', content: domain.persona }, { role: 'user', content: user }],
    { maxTokens: 3600, temperature: 0.45, label: 'checkup' }
  );
  return { report: (report || '').trim(), at: Date.now() };
}

const convoOf = (recent) => recent.slice(-160).map((m) => `[${new Date(m.ts).toLocaleString('zh-CN')}]${m.isSend ? ME : THEM}: ${String(m.content).slice(0, 140)}`).join('\n');

/** Regenerate the 争执档案 (conflict archive) from recent chats. */
export async function regenerateArchive(recent) {
  if (!CFG.ai.enabled || (recent || []).length < 5) return null;
  const sys = '你是中立、不站队的关系分析助手。基于最近的真实聊天，生成一份"争执档案"。' +
    '每条包含：起因→过程→收场→双方各自站得住/站不住的部分，保持中立克制、有据可依，绝不评判谁对谁错。只输出合法 JSON。';
  const user =
`根据下面的真实对话，整理其中的争执/摩擦事件。按时间倒序，最多 12 条；没有就返回空数组。
每条是一个字符串，用 " || " 分三段：日期 || 短标签 || 中立叙述(80-160字，含起因/过程/收场/中立判定)。
格式示例（内容必须来自真实对话）："M/D–M/D || 短标签 || 中立叙述"

返回 JSON：{"episodes":["..."]}

===== 最近对话 =====
${convoOf(recent)}`;
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, maxTokens: 3600, temperature: 0.45, label: 'archive' });
  const p = safeJson(raw); if (!p) return null;
  const list = Array.isArray(p.episodes) ? p.episodes : [];
  const raw2 = list.map((x) => {
    if (typeof x === 'string') { const parts = x.split(/\s*\|\|\s*/); return { date: (parts[0] || '').trim(), tag: (parts[1] || '').slice(0, 24).trim(), body: (parts.slice(2).join(' ') || '').slice(0, 1200).trim() }; }
    return { date: String(x.date || ''), tag: String(x.tag || '').slice(0, 24), body: String(x.body || '').slice(0, 1200) };
  });
  // merge fragments: entries with no real date/tag are continuations of the previous episode
  const hasDate = (d) => /\d/.test(d);
  const eps = [];
  for (const e of raw2) {
    if ((hasDate(e.date) && e.tag) || !eps.length) { eps.push(e); }
    else { const prev = eps[eps.length - 1]; prev.body = (prev.body + ' ' + [e.date, e.tag, e.body].filter(Boolean).join(' ')).slice(0, 1400).trim(); }
  }
  const clean = eps.filter((e) => e.body.length > 20 && hasDate(e.date) && !/短标签|中立叙述/.test(e.body)).slice(0, 14);
  if (!clean.length) return null;
  return { episodes: clean, at: Date.now() };
}

/** Regenerate 两个人的视角 (both perspectives) from recent chats. Keys: them* = the other person, me* = you. */
export async function regeneratePerspectives(recent) {
  if (!CFG.ai.enabled || (recent || []).length < 5) return null;
  const sys = '你是中立、不站队的关系分析助手。基于最近聊天，生成"两个人的视角"，对称呈现双方的合理之处与盲区，绝不站队。只输出合法 JSON，所有字段是中文字符串数组。';
  const user =
`基于下面的真实对话，生成两个人的视角。返回 JSON：
{
 "themValid":["${THEM} 合理、有事实依据的点..."],
 "themCycle":["${THEM} 喂养循环/盲区的点..."],
 "meValid":["${ME} 合理的点..."],
 "meCycle":["${ME} 盲区的点..."],
 "shared":["这段关系真实拥有的好东西..."]
}
每个数组 3-5 条，简洁具体，中立。

===== 最近对话 =====
${convoOf(recent)}`;
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, maxTokens: 1800, temperature: 0.4, label: 'perspectives' });
  const p = safeJson(raw); if (!p) return null;
  const arr = (x) => (Array.isArray(p[x]) ? p[x] : []).slice(0, 6).map((s) => String(s).slice(0, 300));
  return { themValid: arr('themValid'), themCycle: arr('themCycle'), meValid: arr('meValid'), meCycle: arr('meCycle'), shared: arr('shared'), at: Date.now() };
}

function normSent(s) {
  s = String(s || '').toLowerCase();
  if (s.startsWith('pos')) return 'positive';
  if (s.startsWith('neg')) return 'negative';
  return 'neutral';
}
function clamp(n, lo, hi) { if (!Number.isFinite(n)) return 0; return Math.max(lo, Math.min(hi, n)); }
function fmtTime(ts) { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
