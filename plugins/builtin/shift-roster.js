// Built-in plugin: answers "who's on shift?" from a roster CSV — a published Google Sheet
// (File → Share → Publish to web → CSV) or any CSV URL. Gives the assistant a who_on_shift tool and
// keeps today's shifts in its context. Fully local parsing, no AI calls.
//
// CSV columns (header row required, order free, case-insensitive):
//   date (YYYY-MM-DD) | start (HH:MM) | end (HH:MM, may pass midnight) | name | role (optional)
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };

// minimal RFC-4180 CSV (quoted fields, commas and newlines inside quotes)
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export function parseRoster(text) {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const col = (n) => head.findIndex((h) => h.trim().toLowerCase() === n);
  const [di, si, ei, ni, ri] = ['date', 'start', 'end', 'name', 'role'].map(col);
  if (di < 0 || si < 0 || ei < 0 || ni < 0) throw new Error('roster CSV needs date, start, end and name columns');
  return rows.map((r) => ({ date: (r[di] || '').trim(), start: (r[si] || '').trim(), end: (r[ei] || '').trim(), name: (r[ni] || '').trim(), role: ri >= 0 ? (r[ri] || '').trim() : '' }))
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.name && toMin(s.start) != null && toMin(s.end) != null);
}

// shifts on `date`, and who is working at `now` (an overnight shift from yesterday still counts)
export function onShift(shifts, now) {
  const today = ymd(now);
  const yest = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const mins = now.getHours() * 60 + now.getMinutes();
  const working = shifts.filter((s) => {
    const a = toMin(s.start), b = toMin(s.end), overnight = b <= a;
    if (s.date === today) return overnight ? mins >= a : mins >= a && mins < b;
    if (s.date === yest) return overnight && mins < b;
    return false;
  });
  const later = shifts.filter((s) => s.date === today && toMin(s.start) > mins).sort((x, y) => toMin(x.start) - toMin(y.start));
  return { date: today, now: working, next: later[0] || null, today: shifts.filter((s) => s.date === today) };
}

// "now" as wall-clock time in the roster's timezone
function nowIn(tz) { try { return tz ? new Date(new Date().toLocaleString('en-US', { timeZone: tz })) : new Date(); } catch { return new Date(); } }

let cache = { url: '', at: 0, shifts: [] };
async function load(api) {
  const url = api.cfg.csvUrl;
  if (!url) throw new Error('roster CSV URL not set');
  if (cache.url === url && Date.now() - cache.at < 10 * 60000) return cache.shifts;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('roster HTTP ' + res.status);
  cache = { url, at: Date.now(), shifts: parseRoster(await res.text()) };
  return cache.shifts;
}
const fmt = (s) => `${s.name}${s.role ? '（' + s.role + '）' : ''} ${s.start}-${s.end}`;
let ctxLine = '';

export default {
  name: 'shift-roster',
  description: "Knows who's on shift from a roster CSV / published Google Sheet (who_on_shift tool)",
  version: '1.0.0',
  configSchema: [
    { key: 'csvUrl', label: 'Roster CSV URL', type: 'url', required: true, help: 'Columns: date, start, end, name, role (optional)' },
    { key: 'timezone', label: 'Timezone', type: 'string', help: 'IANA name, e.g. Asia/Shanghai. Empty = this computer\'s' },
  ],

  tools: [{
    name: 'who_on_shift',
    description: '查排班表：某天谁当班、现在谁在班。不带 date = 现在/今天；带 date（YYYY-MM-DD）= 看那天。',
    parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD；省略则为现在' } } },
    readOnly: true,
    progress: () => '查排班表…',
    async run({ date }, api) {
      const shifts = await load(api);
      if (date) return { date, shifts: shifts.filter((s) => s.date === date) };
      const r = onShift(shifts, nowIn(api.cfg.timezone));
      return { ...r, summary: r.now.length ? `现在当班：${r.now.map(fmt).join('、')}` : '现在没人当班' };
    },
  }],

  ticks: [{
    everySec: 600,
    async run(api) {
      const r = onShift(await load(api), nowIn(api.cfg.timezone));
      ctxLine = r.today.length ? `【今日排班】${r.today.map(fmt).join('；')}${r.now.length ? ` · 现在当班：${r.now.map((s) => s.name).join('、')}` : ''}` : '';
    },
  }],

  context: () => ctxLine,
};
