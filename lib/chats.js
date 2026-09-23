// Persistent 问它 conversations: multiple chats, each with a message log + an auto title.
// Server-authoritative: the ask endpoints read history from here and append answers here,
// so chats survive reloads and are consistent across devices.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = join(DATA_DIR, 'chats.json');
let store = { chats: {}, order: [] };   // order = ids, newest-first
try { const d = JSON.parse(readFileSync(FILE, 'utf8')); if (d && d.chats) store = d; } catch {}

let seq = 0;
function save() { try { writeFileSync(FILE, JSON.stringify(store)); } catch {} }
function newId() { return Date.now().toString(36) + (seq++).toString(36) + Math.floor(Math.random() * 1296).toString(36); }

export function createChat(title = '') {
  const id = newId();
  store.chats[id] = { id, title: title || '', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  store.order.unshift(id);
  save();
  return store.chats[id];
}
export function getChat(id) { return store.chats[id] || null; }
export function listChats() {
  return store.order.filter((id) => store.chats[id]).map((id) => {
    const c = store.chats[id];
    return { id: c.id, title: c.title || '新对话', updatedAt: c.updatedAt, count: c.messages.length };
  });
}
export function appendMessage(id, msg) {
  const c = store.chats[id]; if (!c) return;
  c.messages.push({ role: msg.role, content: msg.content, hits: msg.hits || null, cited: msg.cited || null, at: msg.at || Date.now() });
  c.updatedAt = Date.now();
  store.order = [id, ...store.order.filter((x) => x !== id)];   // bump to front
  save();
}
export function setTitle(id, title) { const c = store.chats[id]; if (c) { c.title = String(title || '').slice(0, 40); save(); } }
export function deleteChat(id) { delete store.chats[id]; store.order = store.order.filter((x) => x !== id); save(); }
export function clearAllChats() { store = { chats: {}, order: [] }; save(); }
// history the AI sees: prior user/assistant turns of this chat (content only)
export function historyFor(id) {
  const c = store.chats[id]; if (!c) return [];
  return c.messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content }));
}
