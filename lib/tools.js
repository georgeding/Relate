// The agent tool registry — the harness foundation. Every capability the assistant can invoke is a
// tool registered here: { name, description, parameters(JSON schema), readOnly, run(args)->result }.
//
// Read-only tools (readOnly:true) execute freely. Side-effectful tools (readOnly:false) are "gated":
// runTool refuses to execute them directly and instead returns a proposal for the approval queue —
// so nothing outbound (send a message, email, spend) ever fires without you tapping ✓ on the dashboard.
import { addApproval } from './approvals.js';

const REGISTRY = new Map();

// register / replace a tool. Server-side tools (todos, send…) and plugins register themselves at boot,
// since their run() closes over live server state that this module can't import without a cycle.
export function registerTool(t) {
  if (!t || !t.name || typeof t.run !== 'function') return;
  REGISTRY.set(t.name, { readOnly: true, parameters: { type: 'object', properties: {} }, ...t });
}
export function toolMeta(name) { return REGISTRY.get(name); }
export function hasTools() { return REGISTRY.size > 0; }
export function hasTool(name) { return REGISTRY.has(name); }

// OpenAI-style tool specs for the model. Pass names to expose a subset; omit for all.
export function toolSpecs(names) {
  const list = names ? names.map((n) => REGISTRY.get(n)).filter(Boolean) : [...REGISTRY.values()];
  return list.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

// execute a tool call. Read-only runs immediately; a side-effectful tool is NOT run — instead a
// proposal is dropped into the approval queue and the model is told it's pending. Never throws.
export async function runTool(name, args = {}) {
  const t = REGISTRY.get(name);
  if (!t) return { error: `unknown tool: ${name}` };
  if (!t.readOnly) {
    const preview = t.preview ? t.preview(args) : `${name}(${JSON.stringify(args)})`;
    const a = addApproval({ tool: name, args, preview });
    return { needs_approval: true, approvalId: a.id, preview, note: '这是一个会产生实际操作的动作，已加入「待批准」队列。告诉用户你打算做什么、等用户在面板点确认后才会真正执行；不要假装已经做了。' };
  }
  try { return await t.run(args || {}); }
  catch (e) { return { error: String(e && e.message || e).slice(0, 200) }; }
}
// run a tool's real action regardless of its gate — ONLY the approval queue calls this (after the user
// approves). Bypasses the needs_approval envelope so the actual side effect happens.
export async function executeTool(name, args = {}) {
  const t = REGISTRY.get(name);
  if (!t) return { error: `unknown tool: ${name}` };
  try { return await t.run(args || {}); }
  catch (e) { return { error: String(e && e.message || e).slice(0, 200) }; }
}

// short human status line for the "调用工具中…" progress indicator
export function toolProgress(name, args) {
  const t = REGISTRY.get(name);
  if (t && t.progress) { try { return t.progress(args); } catch {} }
  return `调用 ${name}…`;
}
