// Example plugin: watch every chat in the space for keywords, alert the dashboard, and give the assistant a
// tool to list recent hits. Copy to plugins/keyword-alert.js (or spaces/<id>/plugins/) and enable it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const load = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return { lastTs: 0, hits: [] }; } };

export default {
  name: 'keyword-alert',
  description: 'Alerts when watched keywords appear in any chat, and lets the assistant list recent mentions',
  version: '1.0.0',
  configSchema: [
    { key: 'keywords', label: 'Keywords', type: 'list', required: true, help: 'One per line; case-insensitive' },
    { key: 'ignoreMine', label: 'Ignore my own messages', type: 'bool', default: true },
  ],

  ticks: [{
    everySec: 30,
    run(api) {
      const words = (api.cfg.keywords || []).map((w) => String(w).toLowerCase()).filter(Boolean);
      if (!words.length) return;
      const file = join(api.dataDir, 'keyword-alert.json');
      const st = load(file);
      const fresh = api.messages().filter((m) => m.ts > st.lastTs && !(api.cfg.ignoreMine !== false && m.isSend));
      for (const m of fresh) {
        const hit = words.find((w) => String(m.content).toLowerCase().includes(w));
        if (!hit) continue;
        const h = { ts: m.ts, chat: m.sessionName, from: m.senderName, keyword: hit, text: String(m.content).slice(0, 200) };
        st.hits.push(h);
        api.broadcast('care', { at: m.ts, text: `[${hit}] ${m.sessionName}: ${h.text.slice(0, 60)}`, dir: 'in' });
        api.log(`hit "${hit}" in ${m.sessionName}`);
      }
      if (fresh.length) st.lastTs = Math.max(st.lastTs, ...fresh.map((m) => m.ts));
      st.hits = st.hits.slice(-200);
      writeFileSync(file, JSON.stringify(st));
    },
  }],

  tools: [{
    name: 'keyword_hits',
    description: 'List recent messages that mentioned one of the watched keywords',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'look back this many days (default 7)' } } },
    readOnly: true,
    run(args, api) {
      const since = Date.now() - (Number(args.days) || 7) * 86400000;
      return { hits: load(join(api.dataDir, 'keyword-alert.json')).hits.filter((h) => h.ts >= since) };
    },
  }],

  context(api) {
    const n = load(join(api.dataDir, 'keyword-alert.json')).hits.filter((h) => h.ts > Date.now() - 86400000).length;
    return n ? `【关键词提醒】过去24小时有 ${n} 条消息命中关注词（可用 keyword_hits 工具查看）。` : '';
  },
};
