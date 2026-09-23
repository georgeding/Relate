# Platform architecture (branch `platform`)

```
             ┌──────────────── hub.js  (control plane, :5080) ─────────────────┐
 browser ──▶ │ settings UI (public/hub/)  ·  space registry  ·  process supervisor │
             │ global settings (AI defaults)  ·  episode router (Plaud → spaces)  │
             └───────┬───────────────────────┬──────────────────────────┬──────┘
          spawn+env  │                       │                          │
        ┌────────────▼─────┐      ┌──────────▼───────┐       ┌──────────▼───────┐
        │ space worker     │      │ space worker     │  ...  │ space worker     │
        │ server.js :5081  │      │ server.js :5082  │       │ server.js :508x  │
        │ domain: relation │      │ domain: business │       │ domain: team     │
        │ connectors: …    │      │ connectors: …    │       │ connectors: …    │
        └──────────────────┘      └──────────────────┘       └──────────────────┘
```

* A **space** = one engine worker = one domain (relationship | business | team) + its connectors +
  its chat allowlist + its own data dir. Files: `spaces/<id>/config.json` (user-edited, secrets inside),
  `spaces/<id>/runtime.json` (hub-generated: config merged with global defaults; what the worker runs),
  `spaces/<id>/data/` (engine state). `spaces/` is gitignored.
* A worker can also run on its own: `RELATE_CONFIG=/abs/path/runtime.json node server.js` (the hub writes
  `spaces/<id>/runtime.json` = config + global AI defaults + hub plumbing).

## Space config

```jsonc
{
  "id": "family", "name": "Family", "template": "relationship",   // template → contextType
  "port": 5081,
  "me": { "name": "Alex", "about": "optional: a few lines about you for the assistant" },
  "target": { "name": "Sam", "pronoun": "她", "chatId": "12345", "connector": "tg",   // relationship only
              "togetherDate": "2026-01-01", "firstContactDate": "2025-12-01" },  // optional; drive the day counter
  "org": { "name": "Acme" },                                        // business / team: how prompts name the org
  "connectors": [ { "id": "tg", "type": "telegram", "enabled": true, "botToken": "…" } ],
  "chats": [ { "connector": "tg", "chatId": "12345", "name": "Sam", "kind": "dm" } ],  // allowlist; [] = accept all DMs
  "acceptGroups": false,                                             // with an empty allowlist, also accept groups
  "timezone": "Asia/Shanghai",                                       // optional; what "today" means to the assistant
  "host": "127.0.0.1",                                               // optional; worker bind address
  "plugins": { "occasions": { "enabled": true, "festivals": "cn" } },
  "notify": { "enabled": true },                                     // Web Push to the installed dashboard (PWA)
  "ai": { … }, "auth": { … }
}
```

## Worker API (all behind the space's auth except `/api/ingest`, which uses its own token)

| Method | Path | Body / result |
|---|---|---|
| GET  | `/api/space` | `{id, name, template, me:{name}, target:{name,pronoun,togetherDate,firstContactDate}, org:{name}, plugins:[names]}` — no secrets |
| GET  | `/api/state` | live snapshot (KPIs, recent messages, sentiment, relationship stats) |
| GET  | `/api/reminders` | todos: `{open, topRanked, rest, done, counts}` |
| GET  | `/api/living` · `/api/narrative` · `/api/checkup` · `/api/regen` | Living State memory and the generated reports |
| POST | `/api/ask/stream` | `{q, chatId?}` → NDJSON `{type: meta|token|progress|done|error}` |
| GET  | `/api/reply-preview?scope=main` | draft a reply (`scope=other&chat=<name>` for one chat) |
| GET  | `/api/p/<plugin>/…` | plugin routes |
| *    | `/mcp` | MCP server (Bearer `auth.apiToken`) |
| GET  | `/api/connectors` | `[{id,type,platform,capabilities,status}]` |
| POST | `/api/connectors/:id/test` | `{ok, info?, error?}` |
| GET  | `/api/connectors/:id/chats` | `[{chatId,name,kind}]` (if supported) |
| POST | `/api/ingest` | canonical Message, `{messages:[…]}`, or `{episodes:[…]}` → `{ok, added, skipped}`. Auth: `Authorization: Bearer <space ingest token>` |
| POST | `/api/send` | `{chatId, text, connector?}` → `{ok, id?, error?}` — only connectors with `capabilities.send` |
| GET  | `/api/episodes` | recent episodes (metadata) |

## Hub API (`/hub/api/*`, cookie auth via hub password; `/hub` serves the UI)

| Method | Path | Body → Result |
|---|---|---|
| GET  | `/hub/api/session` | `{authed, setupNeeded}` — setupNeeded=true when no hub password set yet |
| POST | `/hub/api/login` | `{password}` → sets cookie |
| POST | `/hub/api/setup` | `{password}` — first run only |
| GET  | `/hub/api/meta` | `{version, templates:[{id,label,description,defaults}], connectorTypes:[{type,label,platform,capabilities,configSchema}]}` |
| GET  | `/hub/api/spaces` | `[{id,name,template,port,url,status,pid,startedAt,lastError,connectors:[{id,type,enabled}], chatCount}]` status ∈ running/stopped/starting/crashed |
| POST | `/hub/api/spaces` | `{name, template, id?}` → space (created stopped, port auto-assigned) |
| GET  | `/hub/api/spaces/:id` | full config; every `secret` field replaced by `"__set__"` (value present) or `""` |
| PUT  | `/hub/api/spaces/:id` | full or partial config; a secret field whose value is `"__set__"` keeps the stored value → `{ok, errors?, restartNeeded}` |
| DELETE | `/hub/api/spaces/:id?purge=1` | stops it; purge=1 also deletes data |
| POST | `/hub/api/spaces/:id/start` · `/stop` · `/restart` | → `{ok, status}` |
| GET  | `/hub/api/spaces/:id/logs?tail=200` | `{lines:[…]}` |
| GET  | `/hub/api/spaces/:id/live` | proxied worker `/api/connectors` (live connector status; `{}` when stopped) |
| POST | `/hub/api/connectors/test` | `{type, config}` → `{ok, info?, error?}` (tests without saving) |
| POST | `/hub/api/connectors/chats` | `{type, config}` → `[{chatId,name,kind}]` (chat picker without saving) |
| GET  | `/hub/api/settings` · PUT | global: `{ai:{base,key(secret),model,maxCallsPerHour}, episodeRouter:{enabled, inbox, minConfidence}}` |
| POST | `/hub/api/ai/test` | `{base,key,model}` (key may be "__set__" = use stored) → `{ok, ms, sample?, error?}` |
| GET  | `/hub/api/episodes/review` | low-confidence routing queue `[{id,title,ts,excerpt,suggested:[{space,score}]}]` |
| POST | `/hub/api/episodes/:id/route` | `{spaces:[ids]}` → forwards to those spaces |

## Additions

* **Ports:** hub `5080`, spaces from `5081`, skipping ports browsers refuse (e.g. 5060/5061 are SIP).
* **`_space` ingest endpoint:** every space gets a hub-owned ingest connector `_space` (token = the space's
  `ingest.token`, shown under Access). The recording router delivers through `/api/ingest/_space`. `_space` is a
  reserved connector id.
* **Sandbox:** Global settings → `sandbox: true` starts workers with `node --permission`, file reads limited to
  the install + the space folder, writes to the space folder, no child processes. Plugins that need more (SSH,
  subprocesses) won't work under it.
* **Recording router:** Global settings → `episodeRouter {enabled, inbox, minConfidence}`. The hub watches one inbox
  (Plaud connector), asks the global AI which spaces each recording belongs to, and delivers to every space
  scoring ≥ minConfidence. Stopped spaces get it when they start. Everything else lands in the review queue.
  State: `spaces/_router/episodes/<id>.json`.

### Plugin API (hub)

| Method | Path | Body → Result |
|---|---|---|
| GET | `/hub/api/spaces/:id/plugins` | `[{name, scope, enabled, settings, ok, problems, meta}]`: every file is inspected in a sandboxed child process. `scope` ∈ space / shared / builtin |
| GET | `/hub/api/spaces/:id/plugins/:name` | `{name, scope, code}` |
| PUT | `/hub/api/spaces/:id/plugins/:name` | `{code}` → `{ok, saved, problems, meta, restartNeeded}` (refused if the file doesn't load) |
| DELETE | `/hub/api/spaces/:id/plugins/:name` | removes the space-local file and its config entry |
| POST | `/hub/api/spaces/:id/plugins/draft` | `{request, name?}` → AI-written `{name, code, ok, problems, meta}` (not saved) |

Enable a plugin and set its settings with `PUT /hub/api/spaces/:id` `{plugins: {<name>: {enabled: true, …}}}`.
