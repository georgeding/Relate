// Desktop launcher (used by the Windows installer's shortcuts): starts the hub in the background if it
// isn't running, then opens it in the browser. Data lives outside the install folder so upgrades and
// uninstalls never touch it.
//   node desktop/launcher.mjs               start if needed + open the browser
//   node desktop/launcher.mjs --background  start if needed, no browser (sign-in autostart)
//   node desktop/launcher.mjs --stop        stop the hub and its space workers
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.RELATE_DATA || join(process.env.APPDATA || join(process.env.HOME || '.', '.config'), 'Relate');
const PORT = Number(process.env.HUB_PORT || 5080);
const URL_ = `http://127.0.0.1:${PORT}/hub/`;
const PID = join(DATA, 'hub.pid');
const args = new Set(process.argv.slice(2));

async function hubUp() {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/hub/api/session`, { signal: AbortSignal.timeout(1500) }); return r.ok && 'setupNeeded' in (await r.json()); }
  catch { return false; }
}
function openBrowser() {
  if (process.platform === 'win32') execFile('cmd.exe', ['/c', 'start', '', URL_], { windowsHide: true });
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [URL_]);
}
function stop() {
  let pid = 0; try { pid = Number(readFileSync(PID, 'utf8')); } catch {}
  if (!pid) return;
  // /T takes the space workers (child processes) down with the hub
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(pid); } catch {} }
  try { rmSync(PID); } catch {}
}

if (args.has('--stop')) { stop(); }
else {
  mkdirSync(DATA, { recursive: true });
  if (!(await hubUp())) {
    const log = openSync(join(DATA, 'hub.log'), 'a');
    const child = spawn(process.execPath, [join(ROOT, 'hub.js')], {
      cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log],
      env: { ...process.env, RELATE_HOME: join(DATA, 'spaces'), HUB_PORT: String(PORT) },
    });
    writeFileSync(PID, String(child.pid));
    child.unref();
    for (let i = 0; i < 60 && !(await hubUp()); i++) await new Promise((r) => setTimeout(r, 250));
  }
  if (!args.has('--background')) openBrowser();
}
