// User-taught facts / background notes — you tell the assistant something ("Sam left the team",
// "Jo moved teams but I still ask for their input") and it persists + rides in every
// answer's context. Per space (its data folder). High priority: overrides stale history.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = join(DATA_DIR, 'notes.json');
let notes = [];
try { const d = JSON.parse(readFileSync(FILE, 'utf8')); if (Array.isArray(d)) notes = d; } catch {}
let seq = notes.reduce((m, n) => Math.max(m, n.id || 0), 0);
function save() { try { writeFileSync(FILE, JSON.stringify(notes)); } catch {} }

export function listNotes() { return notes.slice().sort((a, b) => b.at - a.at); }
export function addNote(text) {
  const t = String(text || '').trim().slice(0, 400); if (t.length < 2) return null;
  const n = { id: ++seq, text: t, at: Date.now() }; notes.push(n); save(); return n;
}
export function deleteNote(id) { const i = notes.findIndex((n) => n.id === Number(id)); if (i >= 0) { notes.splice(i, 1); save(); return true; } return false; }
export function notesText() {
  if (!notes.length) return '';
  return '【背景笔记（用户亲自告诉你的事实/最新情况，回答时务必据此调整；这些优先级高于旧的聊天记录）】\n'
    + listNotes().slice(0, 30).map((n) => '· ' + n.text).join('\n');
}

// detect a "remember this" request and return the fact to save (or null)
const REMEMBER_RE = /^\s*(记住[:：]?|记一下[:：]?|记录[:：]?|备注[:：]?|请记住[:：]?|帮我记[一下]*[:：]?|remember[:：]?|note[:：]|note that|keep in mind)\s*/i;
export function extractRemember(q) {
  const m = REMEMBER_RE.exec(String(q || '')); if (!m) return null;
  const fact = String(q).slice(m[0].length).trim();
  return fact.length >= 2 ? fact : null;
}
