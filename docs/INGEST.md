# Connecting any chat app (ingest bridges)

If there's no built-in connector for your platform, write a small **bridge**: a script that gets messages
from the platform (its API, a webhook, an export) and pushes them into a space. Relate can also send
replies back through your bridge.

## Push messages in

Add a **Custom source** connector to the space (Settings → Connectors). It has its own token.

```
POST http://127.0.0.1:<space port>/api/ingest/<connector id>
Authorization: Bearer <connector token>
Content-Type: application/json
```

Body: one message, an array of messages, `{ "messages": [...] }` or `{ "episodes": [...] }` (max 500 items).

```json
{ "messages": [ {
  "id": "platform-message-id",
  "chatId": "C024BE91L", "chatName": "eng-team", "chatKind": "group",
  "ts": 1790000000,
  "senderId": "U123", "senderName": "Sam",
  "fromMe": false,
  "text": "Can you review the deploy PR today?"
} ] }
```

| field | notes |
|---|---|
| `chatId` | required; stable id of the conversation on your platform |
| `id` | recommended; without it an id is derived from the content, so re-pushing the same message is still a no-op |
| `ts` | seconds, milliseconds or ISO-8601; default "now" |
| `fromMe` | `true` for messages the space's owner sent |
| `type` | `text` (default), `voice`, `image`, `video`, `file`, `system` (`system` is ignored) |
| `chatKind` | `dm` (default) or `group` |

Response: `{ "ok": true, "added": 1, "skipped": 0 }`. Messages for chats that aren't in the space's chat list
are skipped (add them under Settings → Chats); duplicates are skipped.

Every space also has a hub-owned endpoint, `POST /api/ingest/_space` with the space's ingest token
(Settings → Access). The recording router uses it; it accepts recordings from anything.

## Push recordings / transcripts in (episodes)

Long conversations — meetings, calls, voice-recorder transcripts — go in as **episodes**. They are searchable
and feed the assistant's memory, but are kept out of chat statistics.

```json
{ "episodes": [ {
  "id": "rec-2026-09-23-1000",
  "title": "Eng sync", "ts": "2026-09-23T10:00:00+10:00", "durationMs": 1800000,
  "turns": [ { "speaker": "Alex", "text": "The migration is still blocked." },
             { "speaker": "Sam",  "text": "I'll pair with you this afternoon." } ],
  "summary": "Migration blocked; Sam to help."
} ] }
```

## Or: let Relate subscribe to your feed (SSE)

Set **SSE feed URL** on the Custom source connector. Each Server-Sent Event's `data:` must be one of the
payloads above. Relate reconnects with backoff and sends `Last-Event-ID`.

## Send replies back (webhook)

Set **Send webhook URL** (and a **signing secret**). When someone sends from Relate — or approves an
assistant action that sends — Relate POSTs:

```
POST <your webhook>
Content-Type: application/json
X-Relate-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>

{ "chatId": "C024BE91L", "text": "PR reviewed, LGTM", "connector": "slack", "platform": "slack", "ts": 1790000123456 }
```

Verify the signature, deliver the message on your platform, and answer `2xx` (optionally `{ "id": "<platform id>" }`).
Anything else is reported as a failed send.

```js
// verifying in Node
import { createHmac, timingSafeEqual } from 'node:crypto';
const ok = (raw, header, secret) => {
  const want = Buffer.from('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(String(header || ''));
  return got.length === want.length && timingSafeEqual(got, want);
};
```
