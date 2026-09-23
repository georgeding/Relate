// Simple cookie-based auth gate — one shared password. Protects the whole dashboard so the
// public tunnel URL doesn't leak. Cookie = HMAC(secret) token, httpOnly, long-lived.
import { createHmac } from 'node:crypto';
import { CFG } from './config.js';

const A = CFG.auth || {};
const COOKIE = 'relate_auth';
function token() { return createHmac('sha256', A.secret || 'x').update('relate:' + (A.password || '')).digest('hex'); }

export function authEnabled() { return !!A.enabled; }

function parseCookies(req) {
  const out = {}; const c = req.headers.cookie; if (!c) return out;
  for (const part of c.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
// a long-lived API token (for Siri Shortcut / scripts) — sent as "Authorization: Bearer <token>"
function bearer(req) { const h = req.headers.authorization || ''; const m = h.match(/^Bearer\s+(.+)$/i); return m ? m[1].trim() : ''; }
export function isAuthed(req) { return !A.enabled || parseCookies(req)[COOKIE] === token() || (!!A.apiToken && bearer(req) === A.apiToken); }

// paths reachable without auth: login + the PWA shell assets (no data in them)
const PUBLIC = new Set(['/login', '/manifest.json', '/sw.js', '/pwa.js', '/icon-192.png', '/icon-512.png', '/icon-180.png', '/favicon.ico']);
export function isPublicPath(p) { return PUBLIC.has(p); }

export function readBody(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); }); }

export function setAuthCookie(res) {
  // 60-day, httpOnly, Secure (works over the https tunnel), SameSite=Lax
  res.setHeader('Set-Cookie', `${COOKIE}=${token()}; Path=/; Max-Age=5184000; HttpOnly; Secure; SameSite=Lax`);
}
export function checkPassword(pw) { return A.enabled && pw === A.password; }

export const LOGIN_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Relate</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#faf8f5;font-family:-apple-system,"PingFang SC",sans-serif}
.box{background:#fff;border:1px solid #e8e2da;border-radius:16px;padding:32px 28px;width:280px;box-shadow:0 4px 20px rgba(0,0,0,.06);text-align:center}
h1{font-size:20px;color:#2d2a26;margin:0 0 4px}p{color:#7a746c;font-size:13px;margin:0 0 20px}
input{width:100%;padding:12px;border:1px solid #e8e2da;border-radius:10px;font-size:16px;box-sizing:border-box;margin-bottom:12px}
button{width:100%;padding:12px;background:#2d2a26;color:#fff;border:0;border-radius:22px;font-size:15px;font-weight:600}
.err{color:#b3542e;font-size:13px;margin-top:10px;min-height:16px}</style></head>
<body><form class="box" onsubmit="go(event)"><h1>💬 Relate</h1><p>请输入访问密码</p>
<input id="pw" type="password" placeholder="密码" autofocus autocomplete="current-password">
<button>进入</button><div class="err" id="e"></div></form>
<script>async function go(ev){ev.preventDefault();const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});if(r.ok){location.href='/'}else{document.getElementById('e').textContent='密码不对'}}</script>
</body></html>`;
