# Writing a plugin

A plugin is one `.js` file (an ES module) that extends a space: new tools the assistant can call, background
jobs, extra facts for the assistant, new connector types, new space templates, extra HTTP endpoints.

* **Built-in plugin:** `plugins/builtin/<name>.js` — shipped with Relate (see the table below).
* **Shared plugin:** `plugins/<name>.js` — yours; any space on this install can enable it.
* **Space plugin:** `spaces/<space-id>/plugins/<name>.js` — only that space can use it.
* A space plugin shadows a shared one, which shadows a built-in of the same name — so to customise a built-in,
  open it in the hub and *Save as this space's copy*.
* Nothing runs until the space enables it: in the hub, *Space → Plugins → Enable*, which writes
  `"plugins": { "<name>": { "enabled": true, ...settings } }` into the space config.
* You can write one by hand, or describe what you want in the hub and let the AI draft it. Drafts are
  checked in a sandboxed process before they can be saved, and you review the code before enabling.

## Shape

```js
export default {
  name: 'keyword-alert',                 // must equal the file name (without .js)
  description: 'Alerts when watched keywords appear in any chat',
  version: '1.0.0',
  configSchema: [                        // rendered as a settings form in the hub
    { key: 'keywords', label: 'Keywords', type: 'list', required: true },
  ],
  tools: [ /* see below */ ],
  ticks: [ /* see below */ ],
  context(api) { return 'extra facts for the assistant'; },   // optional, called per question
  routes: { 'GET /api/p/keyword-alert/hits': (req, res, api) => { … } },  // optional
  connectors: [ /* connector types, see lib/connectors/connector.js */ ],   // optional
  domains: { /* template key -> domain object, see lib/domain/team.js */ }, // optional
  async setup(api) { /* runs once at boot */ },
};
```

Config field types: `string`, `secret`, `number`, `bool`, `url`, `path`, `select` (with `options`), `list`.

## The `api` object (passed to every hook)

| member | what |
|---|---|
| `api.cfg` | this plugin's settings from the space config |
| `api.CFG` | the whole space config (read-only by convention) |
| `api.messages()` | the space's chat messages, oldest → newest. Each: `{ key, ts, session, sessionName, senderName, isSend (1 = me), content, _tag }` |
| `api.living()` | the Living State: `{ memory, observation, narrative, at }` |
| `api.reminders()` | the current todo list |
| `api.store` | raw store (`api.store.messages`, `api.store.push`) |
| `api.send(chatId, text, connector?)` | send through a connector that can send → `{ ok, error? }`. **Only call this from a tool with `readOnly: false`** so a person approves it first |
| `api.addApproval({ tool, args, preview })` | queue an action for approval |
| `api.notify(title, text, { priority?, tag? })` | push a notification to your phone (if the space has push set up) |
| `api.broadcast(event, data)` | push a live event to open dashboards |
| `api.registerTool(tool)` | register a tool at runtime (usually use `tools: []` instead) |
| `api.log(...)` | write to the space log (prefixed with the plugin name) |
| `api.dataDir` | the space's data folder — keep plugin state in `join(api.dataDir, '<name>.json')` |

## Tools

Tools are functions the assistant can call when you ask it something.

```js
tools: [{
  name: 'keyword_hits',                       // snake_case, unique per space
  description: 'List recent messages that mention a watched keyword',   // the model reads this
  parameters: { type: 'object', properties: { days: { type: 'number' } } },   // JSON schema
  readOnly: true,                             // false ⇒ goes to the approval queue instead of running
  preview: (args) => 'what will happen',      // shown in the approval queue (readOnly:false only)
  async run(args, api) { return { hits: [] }; },   // return plain JSON
}]
```

Anything with side effects (sending, spending, writing outside `api.dataDir`, calling external write APIs)
**must** be `readOnly: false`. It then only runs after someone taps approve on the dashboard.

## Ticks (background jobs)

```js
ticks: [{ everySec: 300, async run(api) { … } }]   // minimum 10s; first run ~5s after boot; errors are logged, not fatal
```

## Rules

1. Plain Node 22 ES module. Built-ins (`node:fs`, `node:path`, …) and global `fetch` only — no npm packages.
2. `export default` one object; `name` equals the file name.
3. No top-level side effects: do work in `setup`, `ticks`, `tools`, `routes`, `context` — not at import time
   (the hub imports the file in a sandbox just to read its description).
4. Keep state in `api.dataDir`. Never read other spaces' folders.
5. Never log or return secrets (`api.cfg` fields of type `secret`).
6. Be idempotent: ticks may re-run after restarts; remember what you already processed.

## Safety model

Plugins run inside the space worker with the worker's permissions. Turn on **Global settings → Sandbox
space workers** to run workers under Node's permission model: file access is limited to this install's
code and the space's own folder, and child processes are blocked. Network access is not restricted, so
only enable plugins you have read.

## Example

`plugins/builtin/keyword-alert.js` is the smallest complete example; the other built-ins show tools, routes,
context and a Postgres client.

## Built-in plugins

| Plugin | What it does | On by default |
|---|---|---|
| `occasions` | Upcoming festivals (春节/七夕/中秋… computed per year, or Valentine's/Christmas), day-count milestones and anniversaries from your start date, and your own dates (birthdays…). Push a few days before; the assistant knows what's coming. Route: `GET /api/p/occasions/upcoming` | relationship spaces |
| `reply-nudge` | Push when someone has waited too long for your reply; immediate push on a care signal | relationship spaces |
| `keyword-alert` | Flags messages that mention words you watch; `keyword_hits` tool | – |
| `shift-roster` | Who's on shift, from a roster CSV / published Google Sheet (`date,start,end,name,role`); `who_on_shift` tool | – |
| `sql-readonly` | Read-only SELECTs over your Postgres so the assistant can answer number questions; `run_sql` tool | – |
