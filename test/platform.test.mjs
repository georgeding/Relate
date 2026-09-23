// Platform layer: ingest connector, connector contract helpers, sources runtime (allowlist, episodes, send),
// and the wechat-uia visible-window alignment. No network, no engine config.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import ingest, { parsePayload, sign, safeEqual } from '../lib/connectors/ingest.js';
import { makeMessage, normTs, validateConfig, withDefaults, messageKey } from '../lib/connectors/connector.js';
import { createSources, sessionIdFor } from '../lib/sources.js';
import { newItems } from '../lib/connectors/wechat-uia.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'relate-test-'));

test('connector contract: timestamps, ids, defaults, validation', () => {
  assert.equal(normTs(1700000000), 1700000000000);
  assert.equal(normTs(1700000000000), 1700000000000);
  assert.equal(normTs('2026-09-23T00:00:00Z'), Date.parse('2026-09-23T00:00:00Z'));
  const a = makeMessage({ chatId: 'c', ts: 1, text: 'hi' }), b = makeMessage({ chatId: 'c', ts: 1, text: 'hi' });
  assert.equal(a.id, b.id, 'content-derived ids are stable');
  assert.equal(makeMessage({ fromMe: 'true' }).fromMe, true);
  assert.equal(messageKey({ connector: 'x', chatId: 'c', id: '1' }), 'x:c:1');
  const schema = [{ key: 'token', type: 'secret', required: true, label: 'Token' }, { key: 'n', type: 'number', default: 5 }, { key: 'u', type: 'url' }];
  assert.deepEqual(validateConfig(schema, {}), ['Token is required']);
  assert.equal(withDefaults(schema, {}).n, 5);
  assert.match(validateConfig(schema, { token: 't', u: 'ftp://x' })[0], /URL/);
});

test('ingest: payload shapes, token check, batch limit, webhook signing', async () => {
  assert.equal(parsePayload({ text: 'x', chatId: 'c' }).messages.length, 1);
  assert.equal(parsePayload([{ text: 'a' }, { text: 'b' }]).messages.length, 2);
  assert.equal(parsePayload({ episodes: [{ turns: [] }] }).episodes.length, 1);
  assert.equal(parsePayload({ turns: [{ speaker: 'a', text: 'b' }] }).episodes.length, 1);
  assert.equal(parsePayload('nope'), null);
  assert.ok(safeEqual('abc', 'abc')); assert.ok(!safeEqual('abc', 'abd')); assert.ok(!safeEqual('', ''));
  assert.equal(sign('k', 'body'), 'sha256=' + createHmac('sha256', 'k').update('body').digest('hex'));

  const got = [], posted = [];
  const fakeFetch = async (url, opts) => { posted.push({ url, opts }); return { ok: true, json: async () => ({ id: 'remote-1' }) }; };
  const c = ingest.create({ id: 'br', token: 'tok', platform: 'slack', sendWebhook: 'http://hook', sendSecret: 's', _fetch: fakeFetch }, { onMessage: (m) => { got.push(m); return true; }, onEpisode: () => true, dataDir: tmp() });
  assert.ok(c.checkToken('tok')); assert.ok(!c.checkToken('nope'));
  assert.equal(c.capabilities.send, true);
  const r = c.accept({ messages: [{ chatId: 'C1', text: 'hi', senderName: 'Sam' }, { text: 'no chat id' }] });
  assert.deepEqual([r.ok, r.added, r.skipped], [true, 1, 1]);
  assert.equal(got[0].platform, 'slack'); assert.equal(got[0].connector, 'br');
  assert.equal(c.accept({ messages: Array.from({ length: 501 }, () => ({ chatId: 'c', text: 'x' })) }).ok, false);
  const s = await c.send('C1', 'reply');
  assert.deepEqual(s, { ok: true, id: 'remote-1' });
  assert.equal(posted[0].opts.headers['X-Relate-Signature'], sign('s', posted[0].opts.body));
  assert.equal(got.at(-1).fromMe, true, 'sent message is recorded as mine');
  assert.equal(ingest.create({ id: 'x', token: 't' }, { onMessage: () => true }).capabilities.send, false, 'no webhook, no send');
});

// a minimal in-memory stand-in for lib/store.js
function fakeStore() {
  const store = { messages: [], push: {} }; const keys = new Set();
  return { store, snapshot: () => ({}), addMessage(m) { if (keys.has(m.key)) return null; keys.add(m.key); const n = { ...m, _tag: {} }; store.messages.push(n); return n; } };
}

test('sources: allowlist, session ids, episodes, send routing', async () => {
  const S = fakeStore(), corpus = [], events = [];
  const CFG = {
    me: { name: 'Alex' },
    connectors: [{ id: 'br', type: 'ingest', token: 'tok', platform: 'slack', sendWebhook: 'http://hook', _fetch: async () => ({ ok: true, json: async () => ({}) }) }, { id: 'off', type: 'ingest', token: 't', enabled: false }],
    chats: [{ connector: 'br', chatId: 'C1', name: 'eng', kind: 'group' }],
  };
  const dataDir = tmp();
  const src = createSources({ CFG, S, corpus: { add: (d) => corpus.push(d) }, broadcast: (e) => events.push(e), log: () => {}, dataDir });
  await src.startAll();
  assert.deepEqual(src.describe().map((c) => c.id), ['br'], 'disabled connectors do not start');
  const c = src.get('br');
  const r = c.accept({ messages: [{ chatId: 'C1', text: 'in list', senderName: 'Sam' }, { chatId: 'C2', text: 'not in list' }] });
  assert.deepEqual([r.added, r.skipped], [1, 1]);
  assert.equal(S.store.messages[0].session, 'slack:C1');
  assert.equal(S.store.messages[0].sessionName, 'eng', 'allowlist name wins');
  assert.equal(sessionIdFor({ platform: 'wechat', chatId: 'wxid_a' }), 'wxid_a', 'wechat ids stay bare for legacy data');
  // episodes go to their own store + RAG, never the message store
  assert.equal(c.accept({ episodes: [{ title: 'Standup', turns: [{ speaker: 'A', text: 'x'.repeat(700) }, { speaker: 'B', text: 'y' }] }] }).added, 1);
  assert.equal(S.store.messages.length, 1);
  assert.equal(readdirSync(join(dataDir, 'episodes')).length, 1);
  assert.ok(corpus.some((d) => d.id.startsWith('ep:')));
  assert.equal(src.listEpisodes()[0].title, 'Standup');
  // re-ingesting the same episode is a no-op
  assert.equal(c.accept({ episodes: [{ title: 'Standup', turns: [{ speaker: 'A', text: 'x'.repeat(700) }, { speaker: 'B', text: 'y' }] }] }).added, 0);
  // send: by store session id, by raw chat id, and refusals
  assert.equal((await src.send({ chatId: 'slack:C1', text: 'hello' })).ok, true);
  assert.equal(S.store.messages.at(-1).isSend, 1);
  assert.equal((await src.send({ chatId: 'C1', text: '' })).ok, false);
  assert.match((await src.send({ chatId: 'C1', text: 'x', connector: 'nope' })).error, /no connector/);
  src.stopAll();
});

test('wechat-uia: new-message alignment over a scrolling window', () => {
  const k = (t, s = 'them') => ({ text: t, side: s, cls: 'ChatTextItemView' });
  assert.deepEqual(newItems([k('a'), k('b', 'me'), k('c')], [k('b', 'me'), k('c'), k('d'), k('e', 'me')], new Set()).map((x) => x.text), ['d', 'e']);
  assert.deepEqual(newItems([k('ok'), k('x')], [k('ok'), k('x'), k('ok')], new Set()).map((x) => x.text), ['ok'], 'repeated text is still new');
  assert.deepEqual(newItems([k('zz')], [k('a'), k('new')], new Set(['them|a'])).map((x) => x.text), ['new'], 'jumped window falls back to seen-set');
  assert.deepEqual(newItems([], [k('a')], new Set()).map((x) => x.text), ['a']);
  assert.deepEqual(newItems([k('a'), k('b')], [k('a'), k('b')], new Set()), [], 'nothing new');
});
