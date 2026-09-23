// Plugins — each user's own .js extensions, loaded into their space's worker.
//
// Where they live:  plugins/builtin/<name>.js    (shipped with Relate)
//                   plugins/<name>.js            (yours, shared by every space on this install)
//                   spaces/<id>/plugins/<name>.js (only that space; the hub sets CFG.pluginDir)
// A space-local file shadows a shared one, which shadows a built-in of the same name.
// Nothing loads unless the space config enables it:  "plugins": { "<name>": { "enabled": true, …cfg } }
//
// A plugin is a module whose default export is:
//   {
//     name, description, version,
//     configSchema: [...],                  // same field types as connectors; the hub renders the form
//     connectors: [connectorType, ...],     // new connector types (see lib/connectors/connector.js)
//     domains: { key: domainObject },       // new space templates (see lib/domain/business.js for the shape)
//     tools: [ { name, description, parameters, readOnly, run(args, api) } ],   // readOnly:false ⇒ approval-gated
//     context(api) -> string,               // extra facts appended to the assistant's context each question
//     ticks: [ { everySec, run(api) } ],    // background jobs
//     routes: { 'GET /api/p/<name>/x': (req, res, api) => … },   // extra HTTP endpoints (behind space auth)
//     setup(api) -> void | Promise<void>,
//   }
// Plugins run with the worker's privileges. The hub can start workers under Node's permission model
// (fs limited to the space folder, no child processes) — see docs/PLUGINS.md.
import { readdirSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CFG, ROOT } from './config.js';

const enabledCfg = () => Object.entries(CFG.plugins || {}).filter(([, c]) => c && c.enabled !== false);

export function pluginDirs() {
  const dirs = [join(ROOT, 'plugins'), join(ROOT, 'plugins', 'builtin')];
  if (CFG.pluginDir) dirs.unshift(isAbsolute(CFG.pluginDir) ? CFG.pluginDir : join(ROOT, CFG.pluginDir));   // space-local wins
  return dirs.filter((d) => existsSync(d));
}

export function findPluginFile(name) {
  if (!/^[\w.-]+$/.test(name)) return null;
  for (const d of pluginDirs()) { const f = join(d, `${name}.js`); if (existsSync(f)) return f; }
  return null;
}

export function listPluginFiles() {
  const seen = new Map();
  for (const d of pluginDirs()) for (const f of readdirSync(d)) if (f.endsWith('.js') && !seen.has(f)) seen.set(f.slice(0, -3), join(d, f));
  return seen;
}

// load every enabled plugin module once (domain selection needs them before the engine boots)
let loaded = null;
const loadProblems = [];   // kept so activatePlugins can report them (the first load happens before logging is wired)
export async function loadPlugins() {
  if (loaded) return loaded;
  loaded = [];
  const log = (msg) => loadProblems.push(msg);
  for (const [name, cfg] of enabledCfg()) {
    const file = findPluginFile(name);
    if (!file) { log(`plugin ${name}: not found in ${pluginDirs().join(', ') || '(no plugin dirs)'}`); continue; }
    try {
      const mod = (await import(pathToFileURL(file).href)).default;
      if (!mod || typeof mod !== 'object') throw new Error('no default export object');
      loaded.push({ name, file, cfg, mod });
    } catch (e) { log(`plugin ${name} failed to load: ${e.message}`); }
  }
  return loaded;
}

export async function pluginDomains() {
  const out = {};
  for (const p of await loadPlugins()) Object.assign(out, p.mod.domains || {});
  return out;
}
export async function pluginConnectorTypes() {
  return (await loadPlugins()).flatMap((p) => p.mod.connectors || []);
}

// wire tools / ticks / routes / context into the running engine
export async function activatePlugins(engine) {
  const { registerTool, log } = engine;
  const routes = new Map(), contexts = [], names = [];
  const list = await loadPlugins();
  for (const msg of loadProblems) log(msg);
  for (const p of list) {
    const api = { ...engine, cfg: p.cfg, name: p.name, log: (...a) => log(`[${p.name}]`, ...a) };
    try { await p.mod.setup?.(api); } catch (e) { log(`plugin ${p.name} setup failed: ${e.message}`); continue; }
    names.push(p.name);
    log(`plugin ${p.name} active`);
    for (const t of p.mod.tools || []) registerTool({ ...t, name: t.name, run: (args) => t.run(args, api) });
    for (const tk of p.mod.ticks || []) {
      const every = Math.max(10, Number(tk.everySec) || 300) * 1000;
      const run = () => Promise.resolve().then(() => tk.run(api)).catch((e) => api.log(`tick error: ${e.message}`));
      setTimeout(run, 5000); setInterval(run, every);
    }
    for (const [k, fn] of Object.entries(p.mod.routes || {})) routes.set(k, (req, res) => fn(req, res, api));
    if (p.mod.context) contexts.push(() => { try { return String(p.mod.context(api) || ''); } catch { return ''; } });
  }
  return {
    names,
    route: (method, path) => routes.get(`${method} ${path}`),
    contextText: () => contexts.map((f) => f()).filter(Boolean).join('\n'),
  };
}
