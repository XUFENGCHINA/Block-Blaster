#!/usr/bin/env node
/* ============================================================
   Block Gunner 2D · stop the desktop server
   - kills the process recorded by desktop/.state/server.json
   - fallback: find the listener on 8080-8099 and kill its process
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STATE_DIR = path.join(__dirname, '.state');
const INFO_FILE = path.join(STATE_DIR, 'server.json');
const PID_FILE = path.join(STATE_DIR, 'server.pid');
const PORT_FROM = 8080;
const PORT_TO = 8099;

function readInfo() {
  try { return JSON.parse(fs.readFileSync(INFO_FILE, 'utf8')); } catch (e) { return null; }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return !!(e && e.code === 'EPERM'); }
}

function cleanup() {
  try { fs.unlinkSync(INFO_FILE); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(PID_FILE); } catch (e) { /* ignore */ }
  try { fs.rmdirSync(STATE_DIR); } catch (e) { /* ignore */ }
}

function checkHealth(port) {
  return new Promise(function (resolve) {
    const req = http.get({ host: '127.0.0.1', port: port, path: '/healthz', timeout: 400 }, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () {
        let ok = false;
        try { const j = JSON.parse(body); ok = !!(j && j.name === 'block-gunner-2d-server'); } catch (e) { /* ignore */ }
        resolve(ok);
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function () { resolve(false); });
  });
}

async function findHealthPort() {
  for (let p = PORT_FROM; p <= PORT_TO; p++) {
    if (await checkHealth(p)) return p;
  }
  return 0;
}

function netstatPid(port) {
  let out = '';
  try { out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); }
  catch (e) { return 0; }
  const lines = out.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 4) continue;
    const listensHere = parts.some(function (p) { return p.endsWith(':' + port); });
    if (!listensHere) continue;
    const pid = parseInt(parts[parts.length - 1], 10);
    if (pid > 0) return pid;
  }
  return 0;
}

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return true;
  } catch (e) {
    try { process.kill(pid); return true; } catch (e2) { return false; }
  }
}

async function main() {
  const info = readInfo();
  let port = (info && info.port) ? info.port : 0;
  let pid = 0;

  if (info && info.pid && isPidAlive(info.pid) && (!port || await checkHealth(port))) {
    pid = info.pid;
  }
  if (!pid && port) pid = netstatPid(port);
  if (!pid) {
    const found = await findHealthPort();
    if (found) { port = found; pid = netstatPid(found); }
  }

  if (!pid) {
    console.log('[desktop] Block Gunner 2D server is not running.');
    cleanup();
    return 0;
  }
  if (!killTree(pid)) {
    console.error('[desktop] failed to stop pid ' + pid + ' (try running this script as administrator).');
    return 1;
  }
  console.log('[desktop] stopped Block Gunner 2D server (port ' + (port || '?') + ', pid ' + pid + ').');
  cleanup();
  return 0;
}

main().then(function (code) {
  process.exitCode = code || 0;
}).catch(function (err) {
  console.error('[desktop] unexpected error: ' + (err && err.message ? err.message : err));
  process.exitCode = 1;
});