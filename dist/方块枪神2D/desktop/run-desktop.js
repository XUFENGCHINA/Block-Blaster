#!/usr/bin/env node
/* ============================================================
   Block Gunner 2D · Windows desktop launcher (no npm / no Electron)

   What it does:
     1. reuse an already-running Block Gunner server when possible
     2. start `node server/server.js --port=8080`, retry 8081..8099
        when a port is occupied (the server exits on EADDRINUSE)
     3. poll http://127.0.0.1:<port>/healthz until ready
     4. open Edge / Chrome in --app mode (no address bar);
        fall back to the system default browser

   Options (used by tests / power users):
     --no-browser      do not open a browser, just print READY <url>
     --dry-run         print the browser command that would be used
     --port=NNNN       only try this port first (still retries upwards)
     -h, --help        show this help

   Env: BG_NO_BROWSER=1  same as --no-browser
        BG_PORT=NNNN     preferred starting port
   ============================================================ */
'use strict';

const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER_JS = path.join(ROOT, 'server', 'server.js');
const STATE_DIR = path.join(__dirname, '.state');
const LOG_DIR = path.join(__dirname, 'logs');
const INFO_FILE = path.join(STATE_DIR, 'server.json');
const PID_FILE = path.join(STATE_DIR, 'server.pid');
const PORT_FROM = 8080;
const PORT_TO = 8099;
// 游戏专用浏览器配置目录：与用户主浏览器隔离，避免 SW / HTTP 缓存一直发旧资源
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'BlockGunner2D', 'profile');
const HEALTH_TIMEOUT_MS = 15000;
const HEALTH_INTERVAL_MS = 200;

/* ---------------------------- tiny utils ---------------------------- */

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function log(msg) { console.log('[desktop] ' + msg); }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let m;
    if ((m = /^--port=(\d+)$/.exec(a))) out.port = parseInt(m[1], 10);
    else if (a === '--port' && argv[i + 1]) out.port = parseInt(argv[++i], 10);
    else if (a === '--no-browser') out.noBrowser = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function httpGetJson(port, pathname, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = http.get({
      host: '127.0.0.1',
      port: port,
      path: pathname,
      timeout: timeoutMs,
      headers: { 'Connection': 'close' }
    }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; if (body.length > 65536) req.destroy(); });
      res.on('end', function () {
        let json = null;
        try { json = JSON.parse(body); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, body: body, json: json });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

function portInUse(port) {
  return new Promise(function (resolve) {
    const sock = net.connect({ host: '127.0.0.1', port: port });
    let done = false;
    function finish(inUse) {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(inUse);
    }
    sock.setTimeout(350);
    sock.once('connect', function () { finish(true); });
    sock.once('timeout', function () { finish(true); });
    sock.once('error', function () { finish(false); });
  });
}

async function checkHealth(port) {
  try {
    const r = await httpGetJson(port, '/healthz', 500);
    return !!(r && r.status === 200 && r.json && r.json.name === 'block-gunner-2d-server');
  } catch (e) {
    return false;
  }
}

function readInfo() {
  try { return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8')); } catch (e) { return null; }
}

function writeInfo(info) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(INFO_FILE, JSON.stringify(info, null, 2), 'utf8');
  fs.writeFileSync(PID_FILE, String(info.pid || ''), 'utf8');
}

function clearInfo() {
  try { fs.unlinkSync(INFO_FILE); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(PID_FILE); } catch (e) { /* ignore */ }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return !!(e && e.code === 'EPERM'); }
}

/* ---------------------- existing server discovery ---------------------- */

async function findRunning(portList) {
  for (const port of portList) {
    if (await checkHealth(port)) return port;
  }
  return 0;
}

function urlOf(port) { return 'http://127.0.0.1:' + port + '/'; }

/* --------------------------- start the server --------------------------- */

async function waitForReady(port, child) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let exitedCode = null;
  child.once('exit', function (code) { exitedCode = code; });
  while (Date.now() < deadline) {
    if (await checkHealth(port)) return { ok: true };
    if (exitedCode !== null) {
      await sleep(150);
      if (await checkHealth(port)) return { ok: true };
      return { ok: false, exited: true, code: exitedCode };
    }
    await sleep(HEALTH_INTERVAL_MS);
  }
  return { ok: false, exited: exitedCode !== null, code: exitedCode };
}

async function startOnPort(port) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, 'server-' + port + '.log');
  const out = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [SERVER_JS, '--port=' + port], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out]
  });
  child.unref();
  fs.closeSync(out);
  log('starting server on port ' + port + ' (log: ' + path.relative(ROOT, logPath) + ')');
  const result = await waitForReady(port, child);
  if (result.ok) return { port: port, pid: child.pid };
  if (result.exited) return { port: port, failed: 'port busy / server exited (code ' + result.code + ')' };
  try { process.kill(child.pid); } catch (e) { /* ignore */ }
  return { port: port, failed: 'no /healthz answer within ' + Math.round(HEALTH_TIMEOUT_MS / 1000) + 's' };
}

async function startServer(preferredPort) {
  const from = (preferredPort && preferredPort >= 1 && preferredPort <= 65535) ? preferredPort : PORT_FROM;
  const to = Math.max(from, PORT_TO);
  const ports = [];
  for (let p = from; p <= to; p++) ports.push(p);

  let lastFail = '';
  for (const port of ports) {
    if (await portInUse(port)) {
      lastFail = 'port ' + port + ' is already in use';
      log(lastFail + ' -> trying port ' + (port + 1));
      continue;
    }
    const res = await startOnPort(port);
    if (!res.failed) return res;
    lastFail = res.failed;
    log(res.failed + ' -> trying port ' + (port + 1));
  }
  throw new Error(lastFail || 'no usable port in ' + PORT_FROM + '-' + PORT_TO);
}

/* ---------------------------- open browser ---------------------------- */

function firstExisting(list) {
  for (const p of list) {
    if (p && fs.existsSync(p)) return p;
  }
  return '';
}

function findBrowser() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const edge = firstExisting([
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    local ? path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : ''
  ]);
  if (edge) return { kind: 'Edge', exe: edge };
  const chrome = firstExisting([
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''
  ]);
  if (chrome) return { kind: 'Chrome', exe: chrome };
  return { kind: 'default browser', exe: '' };
}

function browserArgs(url) {
  return ['--app=' + url, '--window-size=1280,760', '--no-first-run',
          '--no-default-browser-check', '--user-data-dir=' + PROFILE_DIR];
}

function ensureProfileDir() {
  try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

function openBrowser(port) {
  const url = urlOf(port);
  const browser = findBrowser();

  if (args.dryRun) {
    if (browser.exe) console.log('BROWSER_CMD: "' + browser.exe + '" ' + browserArgs(url).join(' '));
    else console.log('BROWSER_CMD: <default browser> ' + url);
    console.log('READY ' + url);
    return;
  }
  if (noBrowser()) {
    console.log('READY ' + url);
    return;
  }

  if (browser.exe) {
    ensureProfileDir();
    const child = spawn(browser.exe, browserArgs(url), {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    log(browser.kind + ' app window opened: ' + url);
  } else {
    const child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    log('default browser opened: ' + url);
  }
}

function printLanHint(port) {
  const out = [];
  const ifaces = os.networkInterfaces();
  Object.keys(ifaces).forEach(function (name) {
    (ifaces[name] || []).forEach(function (info) {
      const family = info.family === 'IPv4' || info.family === 4;
      if (family && !info.internal) out.push('http://' + info.address + ':' + port + '/');
    });
  });
  if (out.length) log('phone on the same Wi-Fi can open: ' + out.join('  '));
}

/* ------------------------------- main ------------------------------- */

const args = parseArgs(process.argv.slice(2));
function noBrowser() { return args.noBrowser || process.env.BG_NO_BROWSER === '1'; }

async function main() {
  if (args.help) {
    console.log('Usage: node desktop/run-desktop.js [--port=8080] [--no-browser] [--dry-run]');
    return 0;
  }
  if (!fs.existsSync(SERVER_JS)) {
    console.error('[desktop] server/server.js not found: ' + SERVER_JS);
    return 2;
  }

  const portList = [];
  if (args.port && args.port >= 1 && args.port <= 65535) portList.push(args.port);
  for (let p = PORT_FROM; p <= PORT_TO; p++) if (p !== args.port) portList.push(p);

  // 1) reuse a running instance (state file first, then port scan)
  const info = readInfo();
  if (info && isPidAlive(info.pid) && (await checkHealth(info.port))) {
    log('server already running on port ' + info.port + ' (pid ' + info.pid + ')');
    openBrowser(info.port);
    return 0;
  }
  const found = await findRunning(portList);
  if (found) {
    const pid = (info && info.port === found && isPidAlive(info.pid)) ? info.pid : 0;
    writeInfo({ port: found, pid: pid, url: urlOf(found), startedAt: new Date().toISOString(), adopted: !pid });
    log('found an already-running server on port ' + found);
    openBrowser(found);
    return 0;
  }

  // 2) start a fresh server, retrying ports when occupied
  let started;
  try {
    started = await startServer(args.port);
  } catch (err) {
    console.error('[desktop] could not start the server: ' + (err && err.message ? err.message : err));
    console.error('[desktop] ports ' + PORT_FROM + '-' + PORT_TO + ' all failed; close other node servers and retry.');
    return 3;
  }

  writeInfo({
    port: started.port,
    pid: started.pid,
    url: urlOf(started.port),
    startedAt: new Date().toISOString()
  });

  log('server ready: ' + urlOf(started.port) + '  (pid ' + started.pid + ')');
  printLanHint(started.port);
  openBrowser(started.port);
  return 0;
}

main().then(function (code) {
  process.exitCode = code || 0;
}).catch(function (err) {
  console.error('[desktop] unexpected error: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});