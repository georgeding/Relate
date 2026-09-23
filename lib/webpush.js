// Web Push (VAPID) — native notifications to the dashboard installed as a PWA (iOS 16.4+ / Android).
import webpush from 'web-push';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CFG, DATA_DIR } from './config.js';

// VAPID keypair (identifies this space as the sender): made on first start, kept in the space's data folder
const VAPID_FILE = join(DATA_DIR, 'vapid.json');
let VAPID = null;
try { VAPID = JSON.parse(readFileSync(VAPID_FILE, 'utf8')); } catch {}
if (!VAPID?.publicKey) { try { VAPID = webpush.generateVAPIDKeys(); writeFileSync(VAPID_FILE, JSON.stringify(VAPID)); } catch { VAPID = null; } }
if (VAPID) webpush.setVapidDetails('mailto:' + (CFG.notify?.contact || 'relate@localhost'), VAPID.publicKey, VAPID.privateKey);

// subscriptions are per-instance (different devices subscribe to each dashboard)
const SUBS_FILE = join(DATA_DIR, 'push_subs.json');
let subs = [];
if (existsSync(SUBS_FILE)) { try { subs = JSON.parse(readFileSync(SUBS_FILE, 'utf8')); } catch { subs = []; } }
function save() { try { writeFileSync(SUBS_FILE, JSON.stringify(subs)); } catch {} }

export function vapidPublic() { return VAPID ? VAPID.publicKey : ''; }
export function subCount() { return subs.length; }
export function addSub(sub) {
  if (sub?.endpoint && !subs.find((s) => s.endpoint === sub.endpoint)) { subs.push(sub); save(); }
  return subs.length;
}

// send to every subscribed device; prune dead subscriptions (404/410)
export async function sendWebPush(title, body, { url, tag } = {}) {
  if (!VAPID || !subs.length) return { sent: 0, subs: 0 };
  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0; const dead = [];
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s, payload); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) { subs = subs.filter((s) => !dead.includes(s.endpoint)); save(); }
  return { sent, subs: subs.length };
}
