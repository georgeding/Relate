// Built-in plugin: a phone push when someone has been waiting on your reply too long, plus an immediate
// push when a message carries a "take this seriously" care signal (relationship template).
// Needs push set up on the space (Web Push or ntfy). Fully local, no AI calls.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const load = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return { waiting: {}, careAt: 0 }; } };

// latest message per chat → the chats whose last message is someone else's, older than `idleMin`
export function overdueChats(messages, { idleMin = 45, chats = [], includeGroups = false, now = Date.now() } = {}) {
  const last = new Map();
  for (const m of messages) {
    if (!String(m.content || '').trim()) continue;
    const k = m.session || m.sessionName || '_';
    const cur = last.get(k);
    if (!cur || m.ts >= cur.ts) last.set(k, m);
  }
  const want = chats.map((c) => String(c).trim()).filter(Boolean);
  const out = [];
  for (const [session, m] of last) {
    if (m.isSend) continue;
    if (!includeGroups && m.kind === 'group') continue;
    if (want.length && !want.some((w) => w === session || w === m.sessionName)) continue;
    const mins = Math.floor((now - m.ts) / 60000);
    if (mins >= idleMin) out.push({ session, name: m.sessionName || m.senderName || session, mins, ts: m.ts, text: String(m.content).slice(0, 60) });
  }
  return out.sort((a, b) => b.mins - a.mins);
}

export default {
  name: 'reply-nudge',
  description: 'Pushes you when someone has waited too long for your reply, and right away on a care signal',
  version: '1.0.0',
  configSchema: [
    { key: 'idleMinutes', label: 'Nudge after (minutes)', type: 'number', default: 45 },
    { key: 'repeatMinutes', label: 'Repeat every (minutes)', type: 'number', default: 120 },
    { key: 'chats', label: 'Only these chats', type: 'list', help: 'Chat names or ids, one per line. Empty = every 1:1 chat' },
    { key: 'includeGroups', label: 'Include group chats', type: 'bool', default: false },
    { key: 'maxAgeHours', label: 'Ignore messages older than (hours)', type: 'number', default: 24 },
    { key: 'careAlerts', label: 'Push immediately on care signals', type: 'bool', default: true },
  ],

  ticks: [{
    everySec: 60,
    async run(api) {
      if (!api.notify) return;
      const file = join(api.dataDir, 'reply-nudge.json');
      const st = load(file);
      const msgs = api.messages();
      const now = Date.now();

      if (api.cfg.careAlerts !== false) {
        for (const m of msgs.slice(-50)) {
          if (m.isSend || !m._tag?.care || m.ts <= st.careAt) continue;
          st.careAt = m.ts;
          await api.notify('⚠️ 需要认真对待', `${m.senderName || m.sessionName || ''}：「${String(m.content).slice(0, 50)}」`, { priority: 'high', tag: 'care' });
        }
      }

      const maxAge = (Number(api.cfg.maxAgeHours) || 24) * 3600000;
      const repeat = (Number(api.cfg.repeatMinutes) || 120) * 60000;
      const due = overdueChats(msgs, { idleMin: Number(api.cfg.idleMinutes) || 45, chats: api.cfg.chats || [], includeGroups: !!api.cfg.includeGroups, now })
        .filter((c) => now - c.ts <= maxAge);
      const live = new Set();
      for (const c of due) {
        live.add(c.session);
        const seen = st.waiting[c.session];
        if (seen && seen.ts === c.ts && now - seen.at < repeat) continue;   // already nudged for this message recently
        await api.notify('⏰ 还没回复', `${c.name} 已等你 ${c.mins} 分钟：「${c.text}」`, { tag: 'reply-' + c.session });
        st.waiting[c.session] = { ts: c.ts, at: now };
      }
      for (const k of Object.keys(st.waiting)) if (!live.has(k)) delete st.waiting[k];   // replied → re-arm
      writeFileSync(file, JSON.stringify(st));
    },
  }],
};
