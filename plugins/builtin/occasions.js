// Built-in plugin: upcoming festivals, anniversaries and your own dates (birthdays…), with a heads-up
// push a few days before and a line in the assistant's context so it can suggest what to prepare.
// Lunar festivals (春节/元宵/端午/七夕/中秋) are computed with Node's built-in Chinese calendar — no table
// to go stale. Fully local, no AI calls.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKS = {
  // gregorian: md = 'MM-DD'; lunar: lunar = 'M-D' (month-day in the Chinese calendar, never a leap month)
  cn: [
    { md: '02-14', name: '情人节', idea: '花 + 手写卡片 + 一顿有仪式感的饭' },
    { md: '05-20', name: '520', idea: '一句走心的话，别只发数字' },
    { lunar: '1-1', name: '春节', idea: '拜年 + 红包 + 过年的安排' },
    { lunar: '1-15', name: '元宵节', idea: '一起吃汤圆 / 视频陪伴' },
    { lunar: '5-5', name: '端午节', idea: '粽子 + 一句问候' },
    { lunar: '7-7', name: '七夕', idea: '中式浪漫：花 + 礼物 + 见面，提前订' },
    { lunar: '8-15', name: '中秋节', idea: '团圆：月饼 + 陪伴，异地就视频' },
    { md: '12-24', name: '平安夜', idea: '一起过节的计划' },
    { md: '12-31', name: '跨年', idea: '一起跨年，或视频陪到零点' },
  ],
  intl: [
    { md: '01-01', name: 'New Year', idea: 'first message of the year' },
    { md: '02-14', name: "Valentine's Day", idea: 'flowers + a handwritten card + a proper dinner' },
    { md: '12-24', name: 'Christmas Eve', idea: 'plans to spend it together' },
    { md: '12-25', name: 'Christmas', idea: 'a gift you asked about in advance' },
    { md: '12-31', name: "New Year's Eve", idea: 'count down together, or on video' },
  ],
  none: [],
};

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parseDay = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const daysUntil = (d, now) => Math.round((day0(d) - day0(now)) / DAY);

// lunar 'M-D' -> the gregorian date it falls on in `year` (null if the runtime lacks the Chinese calendar).
// ICU's Chinese calendar can land a day off when a new moon falls within minutes of Beijing midnight
// (it has 春节 2027 on Feb 7 and 2030 on Feb 2), so the first lunar month is anchored to the official
// new-year dates below; other months come from ICU, evaluated at UTC noon so the host timezone never matters.
const NEW_YEAR = { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23', 2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08', 2036: '01-28' };
const lunarFmt = (() => { try { return new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'UTC', month: 'numeric', day: 'numeric' }); } catch { return null; } })();
const lunarCache = new Map();
export function lunarToDate(lunar, year) {
  const key = `${lunar}@${year}`;
  if (lunarCache.has(key)) return lunarCache.get(key);
  let hit = null;
  const [lm, ld] = lunar.split('-').map(Number);
  if (lm === 1 && NEW_YEAR[year]) {
    const [m, d] = NEW_YEAR[year].split('-').map(Number);
    hit = new Date(year, m - 1, d + ld - 1);
  } else if (lunarFmt) {
    for (let i = 0; i < 366; i++) {
      const u = new Date(Date.UTC(year, 0, 1 + i, 12));
      if (u.getUTCFullYear() !== year) break;
      const p = Object.fromEntries(lunarFmt.formatToParts(u).map((x) => [x.type, x.value]));
      if (`${p.month}-${p.day}` === lunar) { hit = new Date(year, u.getUTCMonth(), u.getUTCDate()); break; }
    }
  }
  lunarCache.set(key, hit);
  return hit;
}

// next occurrence (today or later) of a festival / 'MM-DD' / 'YYYY-MM-DD' date
function nextDate(e, now) {
  if (e.date) { const d = parseDay(e.date); return d && d >= day0(now) ? d : null; }
  for (const y of [now.getFullYear(), now.getFullYear() + 1]) {
    const d = e.lunar ? lunarToDate(e.lunar, y) : (() => { const [m, dd] = e.md.split('-').map(Number); return new Date(y, m - 1, dd); })();
    if (d && d >= day0(now)) return d;
  }
  return null;
}

// "MM-DD=Name" or "YYYY-MM-DD=Name" (also "Name=MM-DD"), one per line
export function parseCustom(lines) {
  const out = [];
  for (const raw of lines || []) {
    const parts = String(raw).split('=').map((s) => s.trim());
    if (parts.length < 2) continue;
    const [a, b] = /^\d/.test(parts[0]) ? parts : [parts[1], parts[0]];
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(a)) out.push({ date: a, name: b, type: 'custom' });
    else if (/^\d{1,2}-\d{1,2}$/.test(a)) { const [m, d] = a.split('-').map(Number); out.push({ md: `${pad(m)}-${pad(d)}`, name: b, type: 'custom' }); }
  }
  return out;
}

// day-count milestones + monthly/yearly anniversaries from a start date
function milestones(startStr, now) {
  const start = parseDay(startStr); if (!start) return [];
  const out = [];
  for (const n of [100, 200, 300, 365, 500, 520, 600, 700, 730, 800, 900, 1000, 1314, 1500, 2000]) {
    const d = new Date(start); d.setDate(d.getDate() + n - 1);   // day 1 is the start date itself
    if (d >= day0(now)) out.push({ d, name: `第 ${n} 天`, type: 'milestone', idea: '一个小惊喜，让 TA 知道你记得' });
  }
  for (let k = 1; k <= 30; k++) {
    const d = new Date(start); d.setFullYear(d.getFullYear() + k);
    if (d >= day0(now)) { out.push({ d, name: `${k} 周年`, type: 'anniversary', idea: '认真准备：这是最重要的日子之一' }); break; }
  }
  for (let i = 0; i < 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, start.getDate());
    const months = (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth();
    if (d >= day0(now) && months > 0 && months % 12) { out.push({ d, name: `${months} 个月`, type: 'monthly', idea: '一句话 + 一个小心意就够' }); break; }
  }
  return out;
}

// { upcoming: [...within horizon], next, updatedAt } — each item { date, name, type, gift, daysUntil }
export function computeOccasions(now, { festivals = 'cn', startDate = '', custom = [], horizonDays = 45 } = {}) {
  const items = [];
  const push = (d, e, type) => d && items.push({ date: ymd(d), name: e.name, type, gift: e.idea || '', daysUntil: daysUntil(d, now) });
  const mine = parseCustom(custom);
  const overridden = new Set(mine.map((e) => e.name));   // a date of yours with a festival's name replaces it
  for (const e of PACKS[festivals] || []) if (!overridden.has(e.name)) push(nextDate(e, now), e, 'festival');
  for (const e of mine) push(nextDate(e, now), e, e.type);
  for (const m of milestones(startDate, now)) push(m.d, m, m.type);
  items.sort((a, b) => a.daysUntil - b.daysUntil);
  const upcoming = items.filter((i) => i.daysUntil >= 0 && i.daysUntil <= horizonDays);
  if (!upcoming.length && items.length) upcoming.push(items[0]);
  return { upcoming, next: items[0] || null, updatedAt: now.getTime() };
}

const opts = (api) => ({
  festivals: api.cfg.festivals || 'cn',
  startDate: api.cfg.startDate || api.CFG?.target?.togetherDate || '',
  custom: api.cfg.dates || [],
  horizonDays: Number(api.cfg.horizonDays) || 45,
});
const stateFile = (api) => join(api.dataDir, 'occasions.json');
const loadState = (api) => { try { return JSON.parse(readFileSync(stateFile(api), 'utf8')); } catch { return { notified: {} }; } };

export default {
  name: 'occasions',
  description: 'Upcoming festivals (lunar ones computed), anniversaries and your own dates, with a heads-up push a few days before',
  version: '1.0.0',
  configSchema: [
    { key: 'festivals', label: 'Festival set', type: 'select', options: ['cn', 'intl', 'none'], default: 'cn', help: 'cn = 春节/七夕/中秋/520…; intl = Valentine\'s/Christmas…' },
    { key: 'startDate', label: 'Together since (YYYY-MM-DD)', type: 'string', help: 'For day-count milestones and anniversaries. Defaults to target.togetherDate' },
    { key: 'dates', label: 'Your dates', type: 'list', help: 'One per line: "MM-DD=Name" (yearly, e.g. birthdays) or "YYYY-MM-DD=Name" (one-off)' },
    { key: 'remindDaysBefore', label: 'Push this many days before', type: 'number', default: 3 },
    { key: 'horizonDays', label: 'Show dates within (days)', type: 'number', default: 45 },
  ],

  routes: {
    'GET /api/p/occasions/upcoming': (req, res, api) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(computeOccasions(new Date(), opts(api))));
    },
  },

  context(api) {
    const soon = computeOccasions(new Date(), opts(api)).upcoming.filter((o) => o.daysUntil <= 14);
    return soon.length ? '【临近的日子】' + soon.map((o) => `${o.name}（${o.date}，${o.daysUntil === 0 ? '今天' : o.daysUntil + ' 天后'}）`).join('；') : '';
  },

  ticks: [{
    everySec: 3600,
    async run(api) {
      if (!api.notify) return;
      const before = Math.max(0, Number(api.cfg.remindDaysBefore ?? 3));
      const st = loadState(api);
      for (const o of computeOccasions(new Date(), opts(api)).upcoming) {
        const key = `${o.date}|${o.name}`;
        if (o.daysUntil > before || st.notified[key]) continue;
        await api.notify(`📅 ${o.name}`, `${o.daysUntil === 0 ? '就是今天' : o.daysUntil + ' 天后'}（${o.date}）${o.gift ? ' · ' + o.gift : ''}`, { tag: 'occasion' });
        st.notified[key] = Date.now();
      }
      for (const k of Object.keys(st.notified)) if (Date.now() - st.notified[k] > 60 * DAY) delete st.notified[k];
      writeFileSync(stateFile(api), JSON.stringify(st));
    },
  }],
};
