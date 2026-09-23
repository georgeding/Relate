// Built-in plugins: pure logic (dates, overdue replies, roster parsing, SQL guard) + every built-in
// passes the same shape checks the hub runs before a plugin can be enabled. No network, no engine config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeOccasions, lunarToDate, parseCustom } from '../plugins/builtin/occasions.js';
import { overdueChats } from '../plugins/builtin/reply-nudge.js';
import { parseCsv, parseRoster, onShift } from '../plugins/builtin/shift-roster.js';
import { guardSql } from '../plugins/builtin/sql-readonly.js';

const BUILTIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'builtin');
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('built-in plugins: shape matches what the hub requires', async () => {
  const files = readdirSync(BUILTIN).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 5, 'expected the shipped built-ins');
  for (const f of files) {
    const d = (await import(pathToFileURL(join(BUILTIN, f)).href)).default;
    assert.equal(d.name, f.slice(0, -3), `${f}: name must equal the file name`);
    assert.ok(d.description, `${f}: description`);
    for (const t of d.tools || []) {
      assert.equal(typeof t.run, 'function', `${f}: tool ${t.name} run()`);
      assert.equal(typeof t.readOnly, 'boolean', `${f}: tool ${t.name} readOnly must be explicit`);
    }
    for (const k of d.ticks || []) assert.equal(typeof k.run, 'function', `${f}: tick run()`);
    for (const r of Object.keys(d.routes || {})) assert.match(r, /^(GET|POST|PUT|DELETE) \/api\/p\//, `${f}: route ${r}`);
    for (const s of d.configSchema || []) assert.ok(s.key && s.type, `${f}: config field needs key + type`);
  }
});

test('occasions: lunar festivals match the official calendar, incl. ICU edge years', () => {
  assert.equal(ymd(lunarToDate('1-1', 2027)), '2027-02-06');    // 春节 2027
  assert.equal(ymd(lunarToDate('7-7', 2026)), '2026-08-19');    // 七夕 2026
  assert.equal(ymd(lunarToDate('8-15', 2028)), '2028-10-03');   // 中秋 2028
  assert.equal(ymd(lunarToDate('1-1', 2030)), '2030-02-03');   // ICU alone says 02-02
  assert.equal(ymd(lunarToDate('1-15', 2027)), '2027-02-20');   // 元宵 follows the anchored new year
  assert.equal(ymd(lunarToDate('7-7', 2031)), '2031-08-24');
});

test('occasions: custom dates, milestones, horizon and ordering', () => {
  assert.deepEqual(parseCustom(['03-07=Birthday', 'Trip=2026-10-01', 'nonsense', '2026-1-5=Thing']), [
    { md: '03-07', name: 'Birthday', type: 'custom' }, { date: '2026-10-01', name: 'Trip', type: 'custom' }, { date: '2026-1-5', name: 'Thing', type: 'custom' },
  ]);
  const now = new Date(2026, 8, 23);   // 2026-09-23
  const r = computeOccasions(now, { festivals: 'none', startDate: '2026-06-17', custom: ['09-30=Mum birthday'], horizonDays: 45 });
  assert.equal(r.upcoming.find((o) => o.name === 'Mum birthday').daysUntil, 7);
  const d100 = r.upcoming.find((o) => o.name === '第 100 天');   // day 1 = 2026-06-17 → day 100 = 2026-09-24
  assert.equal(d100.date, '2026-09-24');
  assert.ok(r.upcoming.every((o, i, a) => i === 0 || a[i - 1].daysUntil <= o.daysUntil), 'sorted by date');
  assert.ok(r.upcoming.every((o) => o.daysUntil >= 0 && o.daysUntil <= 45));
  const cn = computeOccasions(now, { festivals: 'cn' });
  assert.ok(cn.upcoming.some((o) => o.name === '中秋节' && o.date === '2026-09-25'));
  assert.equal(computeOccasions(now, { festivals: 'none' }).upcoming.length, 0, 'nothing configured → nothing shown');
  const own = computeOccasions(now, { festivals: 'cn', custom: ['2026-09-26=中秋节'] });
  assert.deepEqual(own.upcoming.filter((o) => o.name === '中秋节').map((o) => o.date), ['2026-09-26'], 'your date replaces the festival');
});

test('reply-nudge: only chats whose last message is theirs and old enough', () => {
  const now = Date.UTC(2026, 8, 23, 12);
  const min = 60000;
  const msgs = [
    { session: 'a', sessionName: 'A', isSend: 0, content: 'you there?', ts: now - 90 * min },
    { session: 'b', sessionName: 'B', isSend: 0, content: 'q', ts: now - 90 * min },
    { session: 'b', sessionName: 'B', isSend: 1, content: 'answered', ts: now - 80 * min },
    { session: 'c', sessionName: 'C', isSend: 0, content: 'just now', ts: now - 5 * min },
    { session: 'g', sessionName: 'Group', isSend: 0, content: 'hi all', ts: now - 90 * min, kind: 'group' },
  ];
  assert.deepEqual(overdueChats(msgs, { idleMin: 45, now }).map((c) => c.session), ['a']);
  assert.deepEqual(overdueChats(msgs, { idleMin: 45, now, includeGroups: true }).map((c) => c.session).sort(), ['a', 'g']);
  assert.deepEqual(overdueChats(msgs, { idleMin: 45, now, chats: ['Group'], includeGroups: true }).map((c) => c.session), ['g']);
});

test('shift-roster: CSV parsing, overnight shifts, next shift', () => {
  assert.deepEqual(parseCsv('a,"b,c",d\n"x ""y""",2,3\n'), [['a', 'b,c', 'd'], ['x "y"', '2', '3']]);
  const shifts = parseRoster([
    'Date,Start,End,Name,Role',
    '2026-09-22,20:00,02:00,Kim,close',
    '2026-09-23,10:00,15:00,Lee,open',
    '2026-09-23,15:00,20:00,Pat,',
    'bad-row,1,2,3',
  ].join('\r\n'));
  assert.equal(shifts.length, 3);
  const early = onShift(shifts, new Date(2026, 8, 23, 1, 30));   // 01:30 → yesterday's overnight shift
  assert.deepEqual(early.now.map((s) => s.name), ['Kim']);
  assert.equal(early.next.name, 'Lee');
  const noon = onShift(shifts, new Date(2026, 8, 23, 12, 0));
  assert.deepEqual(noon.now.map((s) => s.name), ['Lee']);
  assert.equal(noon.next.name, 'Pat');
  assert.throws(() => parseRoster('when,who\n1,2'), /date, start, end and name/);
});

test('sql-readonly: only a single SELECT gets through, with a row cap', () => {
  assert.deepEqual(guardSql('select * from t;'), { sql: 'select * from t limit 300' });
  assert.deepEqual(guardSql('WITH x AS (select 1) SELECT * FROM x LIMIT 5'), { sql: 'WITH x AS (select 1) SELECT * FROM x LIMIT 5' });
  assert.ok(guardSql('delete from t').error);
  assert.ok(guardSql('select 1; drop table t').error);
  assert.ok(guardSql('with d as (delete from t returning *) select * from d').error);
  assert.ok(!guardSql("select * from notes where body = 'please delete me'").error, 'keywords inside strings are fine');
});
