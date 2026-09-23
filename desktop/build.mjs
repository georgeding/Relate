// Build the Windows release: dist/Relate-portable-<ver>-win-x64.zip and (if Inno Setup is installed)
// dist/RelateSetup-<ver>.exe. Bundles the official Node.js runtime (checksum-verified) so users need nothing else.
//   node desktop/build.mjs                  version from package.json, latest Node LTS
//   NODE_VERSION=v22.14.0 node desktop/build.mjs
//   RELATE_VERSION=1.2.0 ISCC="C:\...\ISCC.exe" node desktop/build.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist'), CACHE = join(DIST, 'cache'), STAGE = join(DIST, 'stage');
const VERSION = (process.env.RELATE_VERSION || JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version).replace(/^v/, '');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const log = (...a) => console.log('[build]', ...a);
// Windows' own bsdtar reads and writes zip; a GNU tar earlier on PATH (Git Bash) can't take C:\ paths
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

async function nodeVersion() {
  if (process.env.NODE_VERSION) return process.env.NODE_VERSION.startsWith('v') ? process.env.NODE_VERSION : 'v' + process.env.NODE_VERSION;
  const list = await (await fetch('https://nodejs.org/dist/index.json')).json();
  return list.find((r) => r.lts && Number(r.version.slice(1).split('.')[0]) >= 22).version;
}

async function fetchNode(ver) {
  const name = `node-${ver}-win-x64`, zip = join(CACHE, `${name}.zip`);
  mkdirSync(CACHE, { recursive: true });
  const sums = await (await fetch(`https://nodejs.org/dist/${ver}/SHASUMS256.txt`)).text();
  const want = sums.split('\n').find((l) => l.endsWith(`${name}.zip`))?.split(/\s+/)[0];
  if (!want) throw new Error(`no checksum for ${name}.zip`);
  const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
  if (!existsSync(zip) || sha(zip) !== want) {
    log(`downloading ${name}.zip`);
    const r = await fetch(`https://nodejs.org/dist/${ver}/${name}.zip`);
    if (!r.ok) throw new Error(`node download HTTP ${r.status}`);
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    if (sha(zip) !== want) throw new Error('node zip checksum mismatch');
  }
  log(`node ${ver} verified (sha256 ${want.slice(0, 12)}…)`);
  const out = join(CACHE, name);
  if (!existsSync(join(out, 'node.exe'))) run(TAR, ['-xf', zip, '-C', CACHE]);
  return out;
}

// the app icon, drawn directly (gradient + heart) as a multi-size 32-bit .ico — no image tooling needed
function makeIco() {
  const top = [0x4a, 0x7b, 0xa6], bottom = [0xc9, 0x7b, 0x84];
  const images = [16, 32, 48, 256].map((n) => {
    const px = Buffer.alloc(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = y / (n - 1), c = top.map((v, i) => Math.round(v + (bottom[i] - v) * t));
      const hx = (x + 0.5 - n / 2) / (n * 0.3), hy = (n * 0.47 - (y + 0.5)) / (n * 0.3);
      const heart = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy ** 3 <= 0;
      const o = ((n - 1 - y) * n + x) * 4;                               // BMP rows are bottom-up
      const [r, g, b] = heart ? [255, 255, 255] : c;
      px[o] = b; px[o + 1] = g; px[o + 2] = r; px[o + 3] = 255;
    }
    const head = Buffer.alloc(40);
    head.writeUInt32LE(40, 0); head.writeInt32LE(n, 4); head.writeInt32LE(n * 2, 8);
    head.writeUInt16LE(1, 12); head.writeUInt16LE(32, 14);
    const mask = Buffer.alloc(Math.ceil(n / 32) * 4 * n);                 // all-opaque AND mask
    return { n, data: Buffer.concat([head, px, mask]) };
  });
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(1, 2); dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach((im, i) => {
    const e = 6 + 16 * i;
    dir[e] = im.n >= 256 ? 0 : im.n; dir[e + 1] = im.n >= 256 ? 0 : im.n;
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(im.data.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += im.data.length;
  });
  return Buffer.concat([dir, ...images.map((im) => im.data)]);
}

function findIscc() {
  const c = [process.env.ISCC, 'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe', 'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe')].filter(Boolean);
  return c.find((f) => existsSync(f)) || null;
}

const ver = await nodeVersion();
const nodeDir = await fetchNode(ver);
log(`staging Relate ${VERSION}`);
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, 'node'), { recursive: true });
cpSync(join(nodeDir, 'node.exe'), join(STAGE, 'node', 'node.exe'));
cpSync(join(nodeDir, 'LICENSE'), join(STAGE, 'node', 'LICENSE'));
// the app = every file git would publish, minus tests/CI; then production dependencies
const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => !/^(test|\.github|dist)\//.test(f) && f !== 'HANDOFF.md' && existsSync(join(ROOT, f)));
for (const f of files) { mkdirSync(dirname(join(STAGE, 'app', f)), { recursive: true }); cpSync(join(ROOT, f), join(STAGE, 'app', f)); }
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: join(STAGE, 'app'), shell: process.platform === 'win32' });
const pkg = JSON.parse(readFileSync(join(STAGE, 'app', 'package.json'), 'utf8')); pkg.version = VERSION;
writeFileSync(join(STAGE, 'app', 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
cpSync(join(ROOT, 'desktop', 'Relate.vbs'), join(STAGE, 'Relate.vbs'));
cpSync(join(ROOT, 'LICENSE'), join(STAGE, 'LICENSE.txt'));
writeFileSync(join(STAGE, 'relate.ico'), makeIco());
writeFileSync(join(STAGE, 'README.txt'), [
  `Relate ${VERSION} (portable)`, '',
  'Double-click Relate.vbs to start Relate and open it in your browser (http://127.0.0.1:5080/hub/).',
  'Run "wscript Relate.vbs --stop" to stop it. Your data is kept in %APPDATA%\\Relate.', '',
  '双击 Relate.vbs 启动并在浏览器中打开 Relate。数据保存在 %APPDATA%\\Relate。', '',
  `Bundles Node.js ${ver} (node/LICENSE).`, '',
].join('\r\n'));
log(`staged ${files.length} app files + ${readdirSync(join(STAGE, 'app', 'node_modules')).length} top-level packages`);

const zip = join(DIST, `Relate-portable-${VERSION}-win-x64.zip`);
rmSync(zip, { force: true });
run(TAR, ['-a', '-c', '-f', zip, '-C', STAGE, '.']);
log(`portable: ${zip}`);

const iscc = findIscc();
if (!iscc) { log('Inno Setup (ISCC.exe) not found — skipped the installer. Install Inno Setup 6 or set ISCC=…'); process.exit(0); }
run(iscc, ['/Q', `/DAppVersion=${VERSION}`, `/DStage=${STAGE}`, join(ROOT, 'desktop', 'relate.iss')]);
log(`installer: ${join(DIST, `RelateSetup-${VERSION}.exe`)}`);
