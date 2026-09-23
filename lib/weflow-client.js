// WeFlow local API client (REST + SSE push) — dependency-free so the hub can load connector types
// without an engine config. WeFlow is a separate, user-installed app; this is only an HTTP client for
// its local API. No WeChat decryption code lives in this repo.
export function createClient(base, token) {
  function url(path, params = {}) {
    const u = new URL(base + path);
    u.searchParams.set('access_token', token);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }
  async function getJson(path, params, timeoutMs = 20000) {
    const res = await fetch(url(path, params), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`weflow ${path} -> HTTP ${res.status}`);
    return res.json();
  }
  async function getSessions() { return (await getJson('/api/v1/sessions')).sessions || []; }
  async function getContacts() { return (await getJson('/api/v1/contacts')).contacts || []; }
  async function getMessages(talker, limit = 40, media = false, timeoutMs = 20000) {
    const params = { talker, limit };
    if (media) params.media = 'true'; // makes weflow decode Silk->WAV into api-media
    return (await getJson('/api/v1/messages', params, timeoutMs)).messages || [];
  }
  async function health(timeoutMs = 5000) { return getJson('/api/v1/health', {}, timeoutMs); }

  /**
   * Subscribe to the live message push stream. Auto-reconnects with backoff.
   * onEvent(eventName, dataObj). onStatus(connected:boolean, info). Returns stop().
   */
  function subscribePush({ onEvent, onStatus }) {
    let stop = false, lastId = null, backoff = 1000, ctl = null;
    async function loop() {
      while (!stop) {
        try {
          const headers = { Accept: 'text/event-stream' };
          if (lastId) headers['Last-Event-ID'] = lastId;
          ctl = new AbortController();
          const res = await fetch(url('/api/v1/push/messages'), { headers, signal: ctl.signal });
          if (!res.ok || !res.body) throw new Error(`push HTTP ${res.status}`);
          onStatus?.(true, 'connected');
          backoff = 1000;
          let buf = '';
          const decoder = new TextDecoder();
          for await (const chunk of res.body) {
            if (stop) break;
            buf += decoder.decode(chunk, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) { const block = buf.slice(0, idx); buf = buf.slice(idx + 2); parseBlock(block); }
          }
        } catch (e) {
          if (!stop) onStatus?.(false, String(e.message || e));
        }
        if (stop) break;
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 1.6, 15000);
      }
    }
    function parseBlock(block) {
      let event = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) lastId = line.slice(3).trim();
        else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) { onEvent?.(event, {}); return; }
      let obj;
      try { obj = JSON.parse(data); } catch { obj = { raw: data }; }
      onEvent?.(event, obj);
    }
    loop();
    return () => { stop = true; try { ctl?.abort(); } catch {} };
  }

  return { getSessions, getContacts, getMessages, health, subscribePush };
}
