import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTranscript, parseSpeakerMap, parseClock, dateFromName, titleFromName } from '../lib/connectors/plaud-parse.js';
import plaud from '../lib/connectors/plaud.js';
import telegram, { redact, splitText } from '../lib/connectors/telegram.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'relate-conn-'));

// ---------- plaud parser ----------

test('clock + filename helpers', () => {
  assert.equal(parseClock('01:23'), 83000);
  assert.equal(parseClock('00:01:23,500'), 83500);
  assert.equal(parseClock('1:02:03.25'), 3723250);
  assert.equal(parseClock('nope'), null);
  assert.equal(dateFromName('2026-09-12 14_30 Team sync.txt'), new Date(2026, 8, 12, 14, 30).getTime());
  assert.equal(dateFromName('20260912_rec.json'), new Date(2026, 8, 12).getTime());
  assert.equal(dateFromName('20260912_143005.md'), new Date(2026, 8, 12, 14, 30, 5).getTime());
  assert.equal(dateFromName('2026-13-40 bad.txt'), null);
  assert.equal(dateFromName('meeting.txt'), null);
  assert.equal(titleFromName('2026-09-12 14_30 Team sync.txt'), 'Team sync');
  assert.equal(titleFromName('20260912.txt'), '20260912');
});

test('speakerMap: list, string, object; Speaker N ≡ 说话人N', () => {
  const a = parseSpeakerMap(['Speaker 1=Alex', 'Speaker 2 = Sam']);
  assert.equal(a.get('speaker1'), 'Alex');
  assert.equal(a.get('speaker2'), 'Sam');
  assert.equal(parseSpeakerMap('Speaker 1=A, 说话人2=B').get('speaker2'), 'B');
  assert.equal(parseSpeakerMap({ 'Speaker 3': 'C' }).get('speaker3'), 'C');
});

test('txt: "Speaker 1 00:00:03" header style + md title + summary section + speakerMap', () => {
  const src = [
    '# Weekly shop sync',
    '',
    '## Summary',
    'Agreed to restock drinks.',
    'Jordan will call the landlord.',
    '',
    '## Transcript',
    'Speaker 1 00:00:03',
    'Morning, quick one on stock.',
    'We are out of Red Bull.',
    '',
    'Speaker 2 00:00:15',
    'I will order today.',
    'Speaker 1 00:01:02',
    'Great.',
  ].join('\n');
  const r = parseTranscript(src, { filename: '2026-09-12 14_30 sync.md', speakerMap: ['Speaker 1=Alex', 'Speaker 2=Jordan'] });
  assert.equal(r.title, 'Weekly shop sync');
  assert.equal(r.summary, 'Agreed to restock drinks.\nJordan will call the landlord.');
  assert.equal(r.ts, new Date(2026, 8, 12, 14, 30).getTime());
  assert.deepEqual(r.turns.map((t) => t.speaker), ['Alex', 'Jordan', 'Alex']);
  assert.equal(r.turns[0].text, 'Morning, quick one on stock.\nWe are out of Red Bull.');
  assert.equal(r.turns[0].offsetMs, 3000);
  assert.equal(r.turns[2].offsetMs, 62000);
  assert.equal(r.durationMs, 62000);
});

test('txt: "[00:01:23] Speaker 1: text" lines', () => {
  const r = parseTranscript('[00:00:05] Speaker 1: hello there\n[00:01:23] Speaker 2: hi\ncontinued line', { filename: 'call.txt', mtimeMs: 1234 });
  assert.equal(r.title, 'call');
  assert.equal(r.ts, 1234);
  assert.deepEqual(r.turns, [
    { speaker: 'Speaker 1', text: 'hello there', offsetMs: 5000 },
    { speaker: 'Speaker 2', text: 'hi\ncontinued line', offsetMs: 83000 },
  ]);
});

test('txt: "Speaker 1: text" and Chinese 说话人1：text with fullwidth colon; 摘要 section', () => {
  const src = '摘要\n讨论了排班。\n\n转写\n说话人1：今天谁上夜班？\n说话人2：我来。\nSpeaker 1: ok thanks';
  const r = parseTranscript(src, { filename: 'x.txt', speakerMap: 'Speaker 1=Alex' });
  assert.equal(r.summary, '讨论了排班。');
  assert.deepEqual(r.turns.map((t) => [t.speaker, t.text]), [['Alex', '今天谁上夜班？'], ['说话人2', '我来。'], ['Alex', 'ok thanks']]);
});

test('txt: generic "Name: text" only counts as a speaker when it repeats', () => {
  const r = parseTranscript('Alex: first\nSam: reply\nAlex: again\nSam: bye\nNote: this is part of the last turn', { filename: 'n.txt' });
  assert.deepEqual(r.turns.map((t) => t.speaker), ['Alex', 'Sam', 'Alex', 'Sam']);
  assert.equal(r.turns[3].text, 'bye\nNote: this is part of the last turn');
});

test('txt: no speakers at all → single Unknown turn', () => {
  const r = parseTranscript('just some dictated notes\nsecond line', { filename: 'memo.txt' });
  assert.deepEqual(r.turns, [{ speaker: 'Unknown', text: 'just some dictated notes\nsecond line' }]);
});

test('srt with speaker prefixes merges consecutive cues', () => {
  const src = '1\n00:00:01,000 --> 00:00:03,000\nSpeaker 1: hello\n\n2\n00:00:03,500 --> 00:00:05,000\nSpeaker 1: again\n\n3\n00:00:06,000 --> 00:00:09,250\n[Speaker 2] hi back\n';
  const r = parseTranscript(src, { filename: 'a.srt', speakerMap: ['Speaker 2=Sam'] });
  assert.deepEqual(r.turns, [{ speaker: 'Speaker 1', text: 'hello\nagain', offsetMs: 1000 }, { speaker: 'Sam', text: 'hi back', offsetMs: 6000 }]);
  assert.equal(r.durationMs, 9250);
});

test('vtt with <v> voice tags', () => {
  const src = 'WEBVTT\n\nNOTE generated\n\n00:00:01.000 --> 00:00:02.000\n<v Speaker 1>hey</v>\n\n00:00:02.500 --> 00:00:04.000\n<v 说话人2>你好</v>\n';
  const r = parseTranscript(src, { filename: 'b.vtt', speakerMap: ['说话人2=Sam'] });
  assert.deepEqual(r.turns.map((t) => [t.speaker, t.text]), [['Speaker 1', 'hey'], ['Sam', '你好']]);
});

test('json: array with seconds, segments with ms start_time, transcript string', () => {
  const a = parseTranscript(JSON.stringify([{ speaker: 'Speaker 1', text: 'one', start: 1.5, end: 3 }, { speaker: 'Speaker 2', text: 'two', start: 4 }]), { filename: 'a.json', speakerMap: ['Speaker 1=G'] });
  assert.deepEqual(a.turns, [{ speaker: 'G', text: 'one', offsetMs: 1500 }, { speaker: 'Speaker 2', text: 'two', offsetMs: 4000 }]);
  assert.equal(a.durationMs, 4000);

  const b = parseTranscript(JSON.stringify({ title: 'Call', summary: 'short', segments: [{ speaker: 'A', text: 'x', start_time: 120000 }, { speaker: 'B', text: 'y', start_time: 180500 }] }), { filename: '20260101.json' });
  assert.equal(b.title, 'Call');
  assert.equal(b.summary, 'short');
  assert.deepEqual(b.turns.map((t) => t.offsetMs), [120000, 180500]);
  assert.equal(b.ts, new Date(2026, 0, 1).getTime());

  const c = parseTranscript(JSON.stringify({ transcript: 'Speaker 1: a\nSpeaker 2: b' }), { filename: 'c.json' });
  assert.deepEqual(c.turns.map((t) => t.speaker), ['Speaker 1', 'Speaker 2']);
});

// ---------- plaud watcher ----------

test('plaud watcher: waits for a stable size, emits one Episode, archives with clash suffix', async () => {
  const inbox = tmp();
  const eps = [], statuses = [];
  const conn = plaud.create({ id: 'rec', inbox, speakerMap: ['Speaker 1=Alex'] }, { onEpisode: (e) => eps.push(e), onStatus: (s) => statuses.push(s), log: () => {} });
  mkdirSync(join(inbox, '_done'));
  writeFileSync(join(inbox, '_done', '2026-09-12 sync.txt'), 'older');   // forces the clash suffix
  writeFileSync(join(inbox, '2026-09-12 sync.txt'), 'Speaker 1: hello\nSpeaker 2: hi');
  writeFileSync(join(inbox, 'ignore.docx'), 'x');
  writeFileSync(join(inbox, 'half.txt.part'), 'x');

  assert.deepEqual((await conn.test()), { ok: true, info: '1 pending file in inbox' });
  assert.equal((await conn._pollOnce()).length, 0);          // first sighting: not yet stable
  const out = await conn._pollOnce();                          // same size on the second poll → processed
  assert.equal(out.length, 1);
  assert.equal(eps.length, 1);
  const ep = eps[0];
  assert.equal(ep.connector, 'rec');
  assert.equal(ep.platform, 'plaud');
  assert.equal(ep.title, 'sync');
  assert.deepEqual(ep.participants, ['Alex', 'Speaker 2']);
  assert.ok(ep.id);
  assert.equal(existsSync(join(inbox, '2026-09-12 sync.txt')), false);
  assert.deepEqual(readdirSync(join(inbox, '_done')).sort(), ['2026-09-12 sync (1).txt', '2026-09-12 sync.txt']);
  assert.equal(readFileSync(join(inbox, '_done', '2026-09-12 sync (1).txt'), 'utf8'), 'Speaker 1: hello\nSpeaker 2: hi');
  assert.equal(statuses.at(-1).state, 'up');
  assert.equal((await conn._pollOnce()).length, 0);            // nothing replays
});

test('plaud watcher: a growing file is not processed until it stops changing; empty transcript → _failed', async () => {
  const inbox = tmp();
  const eps = [];
  const conn = plaud.create({ inbox }, { onEpisode: (e) => eps.push(e), log: () => {} });
  writeFileSync(join(inbox, 'a.txt'), 'Speaker 1: part');
  await conn._pollOnce();
  writeFileSync(join(inbox, 'a.txt'), 'Speaker 1: part one and more');
  assert.equal((await conn._pollOnce()).length, 0);
  assert.equal((await conn._pollOnce()).length, 1);
  writeFileSync(join(inbox, 'empty.json'), '[]');
  await conn._pollOnce(); await conn._pollOnce();
  assert.ok(existsSync(join(inbox, '_failed', 'empty.json')));
  assert.equal(eps.length, 1);
});

test('plaud test(): missing inbox', async () => {
  const r = await plaud.create({ inbox: join(tmp(), 'nope') }).test();
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
});

// ---------- telegram ----------

const TOKEN = '000000000:TEST_fake_token_not_real_xxxxxxxxxx';

function fakeTelegram({ updates = [], failGetMe = false } = {}) {
  const calls = [];
  let delivered = false;
  const reply = (result) => ({ ok: true, status: 200, json: async () => ({ ok: true, result }) });
  const fetch = async (url, init = {}) => {
    const method = url.split('/').pop();
    const body = JSON.parse(init.body || '{}');
    calls.push({ url, method, body });
    if (method === 'getMe') {
      if (failGetMe) return { ok: false, status: 401, json: async () => ({ ok: false, error_code: 401, description: `Unauthorized for https://api.telegram.org/bot${TOKEN}/getMe` }) };
      return reply({ id: 999, is_bot: true, username: 'relatebot' });
    }
    if (method === 'getUpdates') {
      if (!delivered && updates.length) { delivered = true; return reply(updates.filter((u) => u.update_id >= (body.offset || 0))); }
      return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    }
    if (method === 'sendMessage') return reply({ message_id: 500 + calls.filter((c) => c.method === 'sendMessage').length, date: 1700000100, chat: { id: body.chat_id, type: 'private', first_name: 'Sam' } });
    return reply(true);
  };
  return { fetch, calls };
}

const UPDATES = [
  { update_id: 10, message: { message_id: 1, date: 1700000000, chat: { id: 42, type: 'private', first_name: 'Sam' }, from: { id: 42, first_name: 'Sam' }, text: 'hi' } },
  { update_id: 11, message: { message_id: 2, date: 1700000005, chat: { id: -100, type: 'supergroup', title: 'Ops team' }, from: { id: 7, first_name: 'Jordan', last_name: 'Z' }, caption: 'photo caption', photo: [{}] } },
  { update_id: 12, edited_message: { message_id: 1, date: 1700000000, chat: { id: 42, type: 'private', first_name: 'Sam' }, from: { id: 42, first_name: 'Sam' }, text: 'hi (edited)' } },
  { update_id: 13, message: { message_id: 3, date: 1700000009, chat: { id: 42, type: 'private', first_name: 'Sam' }, from: { id: 999, is_bot: true, first_name: 'bot' }, text: 'from the bot' } },
];

async function runUntil(conn, pred, ms = 2000) {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); }
}

test('telegram: getMe, update mapping, offset persistence, seen chats', async () => {
  const dataDir = tmp();
  const msgs = [];
  const fk = fakeTelegram({ updates: UPDATES });
  const conn = telegram.create({ id: 'tg', botToken: TOKEN, meName: 'Alex', _fetch: fk.fetch }, { dataDir, onMessage: (m) => msgs.push(m), log: () => {} });
  await conn.start();
  await runUntil(conn, () => msgs.length === 4);
  conn.stop(); await conn._loop();

  assert.equal(conn.status.state, 'idle');
  const [a, b, c, d] = msgs;
  assert.deepEqual({ id: a.id, chatId: a.chatId, chatName: a.chatName, chatKind: a.chatKind, ts: a.ts, senderName: a.senderName, fromMe: a.fromMe, text: a.text, type: a.type, connector: a.connector, platform: a.platform },
    { id: '1', chatId: '42', chatName: 'Sam', chatKind: 'dm', ts: 1700000000000, senderName: 'Sam', fromMe: false, text: 'hi', type: 'text', connector: 'tg', platform: 'telegram' });
  assert.equal(b.chatKind, 'group'); assert.equal(b.chatName, 'Ops team'); assert.equal(b.senderName, 'Jordan Z'); assert.equal(b.text, 'photo caption'); assert.equal(b.type, 'image');
  assert.equal(c.meta.edited, true); assert.equal(c.id, '1');
  assert.equal(d.fromMe, true); assert.equal(d.senderName, 'Alex');

  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'telegram-tg.offset.json'), 'utf8')), { offset: 14 });
  assert.deepEqual((await conn.listChats()).sort((x, y) => x.chatId.localeCompare(y.chatId)), [{ chatId: '-100', name: 'Ops team', kind: 'group' }, { chatId: '42', name: 'Sam', kind: 'dm' }]);

  // restart: the persisted offset is sent, so nothing replays
  const fk2 = fakeTelegram({ updates: UPDATES });
  const again = [];
  const conn2 = telegram.create({ id: 'tg', botToken: TOKEN, _fetch: fk2.fetch }, { dataDir, onMessage: (m) => again.push(m), log: () => {} });
  await conn2.start();
  await runUntil(conn2, () => fk2.calls.some((x) => x.method === 'getUpdates'));
  conn2.stop(); await conn2._loop();
  assert.equal(fk2.calls.find((x) => x.method === 'getUpdates').body.offset, 14);
  assert.equal(again.length, 0);
  assert.equal((await conn2.listChats()).length, 2);   // seen chats survive restarts
});

test('telegram: allowedChatIds filters', async () => {
  const msgs = [];
  const fk = fakeTelegram({ updates: UPDATES });
  const conn = telegram.create({ botToken: TOKEN, allowedChatIds: ['-100'], _fetch: fk.fetch }, { dataDir: tmp(), onMessage: (m) => msgs.push(m), log: () => {} });
  await conn.start();
  await runUntil(conn, () => fk.calls.filter((x) => x.method === 'getUpdates').length >= 2);
  conn.stop(); await conn._loop();
  assert.deepEqual(msgs.map((m) => m.chatId), ['-100']);
});

test('telegram: send splits >4096 chars and emits fromMe messages', async () => {
  const msgs = [];
  const fk = fakeTelegram();
  const conn = telegram.create({ botToken: TOKEN, meName: 'Alex', _fetch: fk.fetch }, { dataDir: tmp(), onMessage: (m) => msgs.push(m), log: () => {} });
  const long = ('word '.repeat(1000) + '\n').repeat(2);   // ~10k chars
  const r = await conn.send('42', long);
  const sends = fk.calls.filter((c) => c.method === 'sendMessage');
  assert.equal(r.ok, true);
  assert.equal(sends.length, 3);
  assert.ok(sends.every((s) => s.body.text.length <= 4096 && s.body.chat_id === '42'));
  assert.equal(sends.map((s) => s.body.text).join('').replace(/\s/g, ''), long.replace(/\s/g, ''));
  assert.equal(r.id, '503');
  assert.equal(msgs.length, 3);
  assert.ok(msgs.every((m) => m.fromMe && m.senderName === 'Alex' && m.chatId === '42' && m.chatKind === 'dm'));
  assert.deepEqual(splitText('short'), ['short']);
  assert.deepEqual(splitText(''), ['']);
  assert.deepEqual(splitText('x'.repeat(9000)).map((s) => s.length), [4096, 4096, 808]);
});

test('telegram: token never leaks through test(), status, logs or send errors', async () => {
  const logs = [], statuses = [];
  const fk = fakeTelegram({ failGetMe: true });
  const conn = telegram.create({ botToken: TOKEN, _fetch: fk.fetch }, { dataDir: tmp(), log: (...a) => logs.push(a.join(' ')), onStatus: (s) => statuses.push(s) });
  const t = await conn.test();
  assert.equal(t.ok, false);
  assert.ok(!t.error.includes(TOKEN) && !t.error.includes('AAHdqTcv'), t.error);
  assert.match(t.error, /redacted/);

  await conn.start();
  await runUntil(conn, () => statuses.some((s) => s.state === 'down'));
  conn.stop(); await conn._loop();
  for (const s of statuses) assert.ok(!s.info.includes(TOKEN));
  for (const l of logs) assert.ok(!l.includes(TOKEN), l);

  const boom = telegram.create({ botToken: TOKEN, _fetch: async (url) => { throw new Error(`connect ECONNREFUSED ${url}`); } }, { dataDir: tmp(), log: (...a) => logs.push(a.join(' ')) });
  const s = await boom.send('1', 'x');
  assert.equal(s.ok, false);
  assert.ok(!s.error.includes(TOKEN), s.error);
  assert.equal(redact(`https://api.telegram.org/bot${TOKEN}/x`, ''), 'https://api.telegram.org/bot<redacted>/x');
});

test('telegram: missing token', async () => {
  const conn = telegram.create({}, { dataDir: tmp() });
  assert.deepEqual(await conn.test(), { ok: false, error: 'botToken is required' });
  await conn.start();
  assert.equal(conn.status.state, 'error');
});
