// The approval queue — the safety gate for side-effectful tools. When the assistant wants to run a
// gated tool (restart a service, later: send email), it doesn't execute — it drops a proposal here.
// you approve/reject from the panel; on approve we run the actual tool and record the result.
// This is what makes "propose → you approve → it acts" real. Persisted so pending survives a restart.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = join(DATA_DIR, 'approvals.json');
let queue = [];
let seq = 0;
let executor = null;   // async (tool, args) => result — wired by the server to tools.executeTool

if (existsSync(FILE)) {
  try { const d = JSON.parse(readFileSync(FILE, 'utf8')); if (Array.isArray(d)) { queue = d; seq = d.reduce((m, a) => Math.max(m, a.id || 0), 0); } } catch {}
}
function save() { try { writeFileSync(FILE, JSON.stringify(queue.slice(-200))); } catch {} }

// server injects the real executor (tools.executeTool) so this module doesn't import tools.js (no cycle)
export function setExecutor(fn) { executor = fn; }

export function addApproval({ tool, args, preview, source }) {
  const a = { id: ++seq, tool, args: args || {}, preview: preview || tool, source: source || 'assistant', status: 'pending', at: Date.now(), decidedAt: 0, result: null };
  queue.push(a); save(); return a;
}
export function listApprovals(limit = 40) { return queue.slice(-limit).reverse(); }
export function pendingApprovals() { return queue.filter((a) => a.status === 'pending').reverse(); }
export function pendingCount() { return queue.filter((a) => a.status === 'pending').length; }

export async function approveAction(id) {
  const a = queue.find((x) => x.id === Number(id));
  if (!a) return { ok: false, error: '找不到该请求' };
  if (a.status !== 'pending') return { ok: false, error: '该请求已处理' };
  a.status = 'running'; a.decidedAt = Date.now(); save();
  let result;
  try { result = executor ? await executor(a.tool, a.args) : { error: 'no executor wired' }; }
  catch (e) { result = { error: String(e && e.message || e).slice(0, 200) }; }
  a.status = (result && result.error) ? 'failed' : 'done';
  a.result = result; save();
  return { ok: !(result && result.error), result, action: a };
}
export function rejectAction(id) {
  const a = queue.find((x) => x.id === Number(id));
  if (!a || a.status !== 'pending') return { ok: false };
  a.status = 'rejected'; a.decidedAt = Date.now(); save();
  return { ok: true };
}
