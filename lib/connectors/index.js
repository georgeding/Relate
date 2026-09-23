// Connector type registry. Each file exports a factory (see connector.js). Types that fail to load
// (e.g. a platform-specific one on the wrong OS) are skipped rather than breaking the engine.
const FILES = ['weflow', 'ingest', 'telegram', 'plaud', 'wechat-uia'];

let cache = null;
// extra: connector types contributed by plugins (lib/plugins.js) — passed in by the engine
export async function connectorTypes(extra = []) {
  if (cache) { for (const t of extra) if (t?.type) cache.set(t.type, t); return cache; }
  const out = new Map();
  for (const f of FILES) {
    try { const mod = await import(`./${f}.js`); if (mod.default?.type) out.set(mod.default.type, mod.default); } catch (e) {
      if (e?.code !== 'ERR_MODULE_NOT_FOUND') console.error(`connector type ${f} failed to load: ${e.message}`);
    }
  }
  for (const t of extra) if (t?.type) out.set(t.type, t);
  return (cache = out);
}

// what the hub/settings UI needs to render forms — no functions
export async function describeTypes(extra = []) {
  return [...(await connectorTypes(extra)).values()].map((t) => ({
    type: t.type, label: t.label, platform: t.platform, description: t.description || '',
    capabilities: t.capabilities, configSchema: t.configSchema || [], os: t.os || null,
  }));
}
