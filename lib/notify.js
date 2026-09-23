// Push notifications — PRIMARY: native Web Push to the dashboard installed as a PWA on your
// iOS home screen (no extra app). OPTIONAL: ntfy/Pushover if configured.
import { CFG } from './config.js';
import { sendWebPush, subCount } from './webpush.js';

export async function sendPush(title, body, { priority = 'default', tags = '', click } = {}) {
  const n = CFG.notify || {};
  if (n.enabled === false) return { skipped: true };   // on unless turned off; nothing is sent until a device subscribes
  const out = {};
  // native PWA push (this is what fires on your iOS home-screen app)
  try { const w = await sendWebPush(title, body, { url: click }); out.webpush = w.sent; } catch (e) { out.webpushErr = String(e.message).slice(0, 60); }
  // ntfy/pushover only if explicitly turned on
  if (!n.extraEnabled) return out;
  try {
    if (n.provider === 'pushover' && n.pushoverToken && n.pushoverUser) {
      const r = await fetch('https://api.pushover.net/1/messages.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: n.pushoverToken, user: n.pushoverUser, title, message: body, url: click }),
      });
      out.pushover = r.ok;
    } else {
      const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Priority': priority };
      if (/^[\x00-\x7F]*$/.test(title)) headers['Title'] = title;
      if (tags) headers['Tags'] = tags;
      if (click) headers['Click'] = click;
      const r = await fetch(`${(n.ntfyServer || 'https://ntfy.sh').replace(/\/$/, '')}/${n.ntfyTopic}`, { method: 'POST', headers, body });
      out.ntfy = r.ok;
    }
  } catch (e) { out.extraErr = String(e.message || e).slice(0, 60); }
  return out;
}
