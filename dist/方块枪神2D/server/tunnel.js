#!/usr/bin/env node
'use strict';
/*
 * ============================================================
 *  方块枪神 2D · 一键联动本机内网穿透工具
 * ============================================================
 *  零 npm 依赖，只检测/启动本机已有工具：
 *    1) cloudflared   cloudflared tunnel --url http://127.0.0.1:<port>
 *    2) ngrok         ngrok http <port>
 *    3) frpc          frpc -c frpc.ini（地址从 frpc.ini 的 server_addr + remote_port 推断）
 *
 *  启动子进程后从 stdout/stderr 正则抓公网 URL
 *  （https://*.trycloudflare.com、https://*.ngrok-free.app 等），
 *  写回 config.json 的 publicUrl 并打印。
 *
 *  什么都不装也可以：上层会打印清晰指引，局域网模式照常可用。
 * ============================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const TOOL_ORDER = ['cloudflared', 'ngrok', 'frpc'];

const TOOL_DEFS = {
  cloudflared: {
    name: 'cloudflared',
    label: 'cloudflared（Cloudflare 免费隧道，无需注册）',
    bins: ['cloudflared'],
    args: function (port) { return ['tunnel', '--url', 'http://127.0.0.1:' + port, '--no-autoupdate']; },
    urlPatterns: [/https?:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i],
    installHint: '安装：Windows 执行 winget install --id Cloudflare.cloudflared，或下载 cloudflared.exe 放到 C:\\Program Files\\cloudflared\\ 后重跑服务端。'
  },
  ngrok: {
    name: 'ngrok',
    label: 'ngrok（需先配置 authtoken）',
    bins: ['ngrok'],
    args: function (port) { return ['http', '127.0.0.1:' + port, '--log=stdout']; },
    urlPatterns: [
      /https?:\/\/[a-z0-9][a-z0-9-]*\.ngrok-free\.app/i,
      /https?:\/\/[a-z0-9][a-z0-9-]*\.ngrok(?:-free)?\.(?:app|io|dev|com)/i
    ],
    installHint: '安装：下载 ngrok.exe 放到 C:\\ngrok\\，执行 ngrok config add-authtoken <你的 token>，再重跑服务端。'
  },
  frpc: {
    name: 'frpc',
    label: 'frpc（自建 frps 或 OpenFrp / ofalias 等平台）',
    bins: ['frpc'],
    args: function () { return ['-c', 'frpc.ini']; }, // PATH 回退模式；server/frpc.toml 会被优先使用
    urlPatterns: [/https?:\/\/[^\s"'<>]+/i],
    installHint: '安装：把 frpc.exe 放到 PATH 或 C:\\frp\\；平台下发的配置存成 server/frpc.toml（旧版 server/frpc.ini 也支持），服务端会自动使用。'
  }
};

/* ---------------------------- 基础工具 ---------------------------- */

function hhmmss() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isFile(p) {
  try { return !!p && fs.statSync(p).isFile(); } catch (e) { return false; }
}

function candidateFileNames(name) {
  if (process.platform === 'win32') return [name + '.exe', name + '.cmd', name + '.bat', name];
  return [name];
}

function whichSync(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const file of candidateFileNames(name)) {
      const p = path.join(dir, file);
      if (isFile(p)) return p;
    }
  }
  return null;
}

function toolCommonDirs(name) {
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || '';
    const up = process.env['USERPROFILE'] || '';
    const pd = process.env['ProgramData'] || '';
    const dirs = [];
    if (name === 'cloudflared') {
      if (local) dirs.push(path.join(local, 'cloudflared'));
      dirs.push(path.join(pf, 'cloudflared'), path.join(pf86, 'cloudflared'));
      if (up) dirs.push(path.join(up, 'cloudflared'), path.join(up, '.cloudflared'));
    } else if (name === 'ngrok') {
      if (up) dirs.push(path.join(up, 'ngrok'));
      dirs.push('C:\\ngrok');
      if (local) dirs.push(path.join(local, 'ngrok'));
      dirs.push(path.join(pf, 'ngrok'));
    } else if (name === 'frpc') {
      if (up) dirs.push(path.join(up, 'frp'));
      dirs.push('C:\\frp', path.join(pf, 'frp'), path.join(pf86, 'frp'));
    }
    if (pd) dirs.push(path.join(pd, 'chocolatey', 'bin'));
    if (up) dirs.push(path.join(up, 'scoop', 'shims'));
    return dirs;
  }
  return ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/snap/bin', path.join(os.homedir(), 'bin')];
}

/* 查找工具：支持环境变量强制指定（便于测试 / 自定义安装位置） */
function findTool(name) {
  const def = TOOL_DEFS[name];
  if (!def) return null;

  const specific = process.env['BG_TUNNEL_BIN_' + name.toUpperCase()];
  if (isFile(specific)) return specific;
  const generic = process.env.BG_TUNNEL_BIN;
  if (isFile(generic)) {
    const base = path.basename(generic).toLowerCase();
    if (base.indexOf(name) >= 0 || /\.(js|cjs|mjs)$/i.test(base)) return generic;
  }

  for (const binName of def.bins) {
    const hit = whichSync(binName);
    if (hit) return hit;
  }
  for (const dir of toolCommonDirs(name)) {
    for (const file of candidateFileNames(name)) {
      const p = path.join(dir, file);
      if (isFile(p)) return p;
    }
  }
  return null;
}

function detectTools() {
  const out = [];
  for (const name of TOOL_ORDER) {
    const p = findTool(name);
    if (p) out.push({ name: name, path: p, label: TOOL_DEFS[name].label });
  }
  return out;
}

/* ---------------------------- URL 抓取 ---------------------------- */

function sanitizeUrl(raw) {
  let s = String(raw || '').trim().replace(/^[<'"(]+/, '');
  s = s.replace(/[)\]}>.,;:'"\\]+$/, '');
  s = s.replace(/\/+$/, '');
  return s;
}

function extractUrl(text, toolName) {
  if (!text) return null;
  const def = TOOL_DEFS[toolName];
  const patterns = (def && def.urlPatterns) || [];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m) {
      const u = sanitizeUrl(m[0]);
      if (/^https?:\/\//i.test(u)) return u;
    }
  }
  const generic = String(text).match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const raw of generic) {
    const u = sanitizeUrl(raw);
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(u)) continue;
    if (/ngrok\.com|cloudflare\.com|github\.com|golang\.org/i.test(u)) continue;
    return u;
  }
  return null;
}

/* ---------------------------- config 写回 ---------------------------- */

function writeConfigPublicUrl(configPath, url, provider) {
  try {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { cfg = {}; }
    if (!cfg || typeof cfg !== 'object') cfg = {};
    const clean = sanitizeUrl(url);
    cfg.publicUrl = clean;
    cfg.tunnel = Object.assign(
      { auto: true, prefer: 'upnp', externalPort: 0, keepAlive: true },
      cfg.tunnel || {},
      { provider: provider || (cfg.tunnel && cfg.tunnel.provider) || 'none', state: 'running', updatedAt: new Date().toISOString() }
    );
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, configPath);
    return true;
  } catch (e) {
    return false;
  }
}

/* frpc 输出里一般没有公网 URL，从同目录 frpc.ini 推断 */
function parseFrpcIniUrl(binPath) {
  try {
    const ini = (isFile(binPath) && /frpc\.ini$/i.test(binPath)) ? binPath : path.join(path.dirname(binPath), 'frpc.ini');
    if (!isFile(ini)) return null;
    const text = fs.readFileSync(ini, 'utf8');
    const server = /^\s*server_addr\s*=\s*([^\s#;]+)/mi.exec(text);
    let remote = null;
    const re = /^\s*remote_port\s*=\s*(\d+)/gmi;
    let m;
    while ((m = re.exec(text))) remote = m[1];
    if (server && remote) return 'http://' + String(server[1]).replace(/\/+$/, '') + ':' + remote;
  } catch (e) {}
  return null;
}

/* ---------------------------- TOML 解析（只认 frpc.toml 常用字段，零依赖） ---------------------------- */

/* 日志脱敏：任何 token 一律显示为 *** */
function maskToken(value) {
  let s = String(value === undefined || value === null ? '' : value);
  s = s.replace(/(\btoken\s*[:=]\s*)(['"])([\s\S]*?)\2/gi, function (m, p1, q) { return p1 + q + '***' + q; });
  s = s.replace(/(\btoken\s*[:=]\s*)([^\s,;#'"]+)/gi, '$1***');
  return s;
}

function stripTomlComment(line) {
  let inSingle = false;
  let inDouble = false;
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && inDouble) { out += c; if (i + 1 < line.length) out += line[++i]; continue; }
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) break;
    out += c;
  }
  return out;
}

function unquoteTomlKey(key) {
  const k = String(key || '').trim();
  if (k.length >= 2 && ((k[0] === "'" && k[k.length - 1] === "'") || (k[0] === '"' && k[k.length - 1] === '"'))) return k.slice(1, -1);
  return k;
}

function splitTomlKeyPath(key) {
  const parts = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < key.length; i++) {
    const c = key[i];
    if (c === "'" && !inDouble) { inSingle = !inSingle; cur += c; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; cur += c; continue; }
    if (c === '.' && !inSingle && !inDouble) { parts.push(unquoteTomlKey(cur)); cur = ''; continue; }
    cur += c;
  }
  parts.push(unquoteTomlKey(cur));
  return parts.filter(Boolean);
}

function splitTomlArray(inner) {
  const out = [];
  let cur = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
    }
    if (c === ',' && depth === 0 && !inSingle && !inDouble) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseTomlValue(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1);
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    try { return JSON.parse(v); } catch (e) { return v.slice(1, -1); }
  }
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  if (/^\[[\s\S]*\]$/.test(v)) return splitTomlArray(v.slice(1, -1)).map(parseTomlValue);
  if (/^\{[\s\S]*\}$/.test(v)) {
    const out = {};
    for (const part of splitTomlArray(v.slice(1, -1))) {
      const m = /^\s*([^=]+?)\s*=\s*([\s\S]+?)\s*$/.exec(part);
      if (m) out[unquoteTomlKey(m[1])] = parseTomlValue(m[2]);
    }
    return out;
  }
  if (/^[+-]?\d[\d_]*$/.test(v)) return parseInt(v.replace(/_/g, ''), 10);
  if (/^[+-]?(?:\d[\d_]*)?\.\d[\d_]*(?:[eE][+-]?\d+)?$/.test(v) || /^[+-]?\d[\d_]*[eE][+-]?\d+$/.test(v)) return parseFloat(v.replace(/_/g, ''));
  return v;
}
function setTomlPath(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  if (parts.length) cur[parts[parts.length - 1]] = value;
}

function ensureTomlTable(root, parts) {
  let cur = root;
  for (const k of parts) {
    if (Array.isArray(cur[k])) cur = cur[k][cur[k].length - 1];
    else {
      if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
  }
  return cur;
}

function appendTomlArrayTable(root, parts) {
  const parentParts = parts.slice(0, -1);
  const name = parts[parts.length - 1];
  let parent = root;
  for (const k of parentParts) {
    if (Array.isArray(parent[k])) parent = parent[k][parent[k].length - 1];
    else {
      if (!parent[k] || typeof parent[k] !== 'object') parent[k] = {};
      parent = parent[k];
    }
  }
  if (!Array.isArray(parent[name])) parent[name] = [];
  const obj = {};
  parent[name].push(obj);
  return obj;
}

/* 极简 TOML 解析：支持 [table] / [[array of tables]] / key = value / 注释 / 基本字符串 */
function parseToml(text) {
  const root = {};
  let current = root;
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    const line = stripTomlComment(raw).trim();
    if (!line) continue;
    let m = /^\[\[\s*([\s\S]+?)\s*\]\]$/.exec(line);
    if (m) { current = appendTomlArrayTable(root, splitTomlKeyPath(m[1])); continue; }
    m = /^\[\s*([\s\S]+?)\s*\]$/.exec(line);
    if (m) { current = ensureTomlTable(root, splitTomlKeyPath(m[1])); continue; }
    m = /^([^=]+?)\s*=\s*([\s\S]+)$/.exec(line);
    if (m) { setTomlPath(current, splitTomlKeyPath(m[1]), parseTomlValue(m[2])); continue; }
    // 多行字符串 / 未知语法直接忽略（frpc.toml 常用字段都是单行键值）
  }
  return root;
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/* 提取 frpc.toml 里我们需要的那几个字段 */
function parseFrpcToml(text) {
  let root = {};
  let error = null;
  try { root = parseToml(text); } catch (e) { error = e && e.message ? e.message : String(e); }
  const proxies = Array.isArray(root.proxies) ? root.proxies : [];
  const proxy = proxies.length ? proxies[0] : null;
  const auth = root.auth || {};
  const tls = (root.transport && root.transport.tls) || {};
  const pickProxy = function (key) { return proxy && proxy[key] !== undefined ? proxy[key] : null; };
  return {
    ok: !error,
    error: error,
    serverAddr: root.serverAddr !== undefined ? String(root.serverAddr) : null,
    serverPort: toIntOrNull(root.serverPort),
    user: root.user !== undefined ? String(root.user) : null,
    auth: {
      method: auth.method !== undefined ? String(auth.method) : null,
      token: auth.token !== undefined ? String(auth.token) : null
    },
    transport: {
      protocol: root.transport && root.transport.protocol !== undefined ? String(root.transport.protocol) : null,
      tls: {
        enable: tls.enable,
        serverName: tls.serverName !== undefined ? String(tls.serverName) : null
      }
    },
    proxies: proxies,
    name: pickProxy('name') !== null ? String(pickProxy('name')) : null,
    type: pickProxy('type') !== null ? String(pickProxy('type')) : null,
    localIP: pickProxy('localIP') !== null ? String(pickProxy('localIP')) : '127.0.0.1',
    localPort: toIntOrNull(pickProxy('localPort') !== null ? pickProxy('localPort') : root.localPort),
    remotePort: toIntOrNull(pickProxy('remotePort') !== null ? pickProxy('remotePort') : root.remotePort),
    serverName: tls.serverName !== undefined ? String(tls.serverName) : null,
    raw: String(text || '')
  };
}
/* 生成脱敏后的配置摘要（绝不打印 token 原文） */
function describeFrpcToml(info) {
  const parts = ['serverAddr=' + (info.serverAddr || '?')];
  if (info.serverPort) parts.push('serverPort=' + info.serverPort);
  if (info.user) parts.push('user=' + info.user);
  parts.push('token = ***');
  if (info.name) parts.push('proxy=' + info.name);
  if (info.type) parts.push('type=' + info.type);
  parts.push('localPort=' + (info.localPort === null || info.localPort === undefined ? '?' : info.localPort));
  parts.push('remotePort=' + (info.remotePort === null || info.remotePort === undefined ? '?' : info.remotePort));
  if (info.serverName) parts.push('serverName=' + info.serverName);
  return parts.join(' ');
}

/* 原地纠正第一个 [[proxies]] 块的 localPort；尽量保留注释与其它内容 */
function fixLocalPortInToml(text, expectedPort) {
  const src = String(text || '');
  const eol = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\[\[\s*proxies\s*\]\]\s*(?:#.*)?$/i.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return { changed: false, reason: '没有 [[proxies]] 块', oldPort: null, text: src };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) { end = i; break; }
  }
  const keyRe = /^(\s*)(localPort|local_port)(\s*=\s*)(\d+)(\s*(?:#.*)?)$/i;
  for (let i = start + 1; i < end; i++) {
    const m = keyRe.exec(lines[i]);
    if (m) {
      const oldPort = parseInt(m[4], 10);
      if (oldPort === expectedPort) return { changed: false, oldPort: oldPort, line: i + 1, text: src };
      lines[i] = m[1] + m[2] + m[3] + String(expectedPort) + (m[5] || '');
      return { changed: true, oldPort: oldPort, line: i + 1, text: lines.join(eol) };
    }
  }
  let insertAt = start + 1;
  for (let i = start + 1; i < end; i++) {
    if (/^\s*(localIP|local_ip|type)\s*=/i.test(lines[i])) insertAt = i + 1;
  }
  const indentMatch = /^(\s*)/.exec(lines[insertAt] || lines[start + 1] || '');
  const indent = indentMatch ? indentMatch[1] : '';
  lines.splice(insertAt, 0, indent + 'localPort = ' + expectedPort);
  return { changed: true, oldPort: null, inserted: true, line: insertAt + 1, text: lines.join(eol) };
}
function stripHost(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  s = s.split('/')[0];
  s = s.replace(/^\[|\]$/g, '');
  return s;
}

function hostForUrl(host) {
  const h = String(host || '');
  return (h.indexOf(':') >= 0 && h.indexOf('[') !== 0) ? '[' + h + ']' : h;
}

function splitHostPort(raw, defaultPort) {
  const s = stripHost(raw);
  let m = /^\[(.+)\]:(\d+)$/.exec(s);
  if (m) return { host: m[1], port: parseInt(m[2], 10) };
  m = /^([^:]+):(\d+)$/.exec(s);
  if (m) return { host: m[1], port: parseInt(m[2], 10) };
  return { host: s, port: parseInt(defaultPort, 10) || 0 };
}

/* 推导公网地址：publicHost 配置 > serverName 域名 > serverAddr，再拼 remotePort */
function deriveFrpPublicUrl(info, frpOptions) {
  const opts = frpOptions || {};
  const remotePort = parseInt(info && info.remotePort, 10) || 0;
  const publicPort = parseInt(opts.publicPort, 10) || remotePort || 0;
  if (opts.publicHost) {
    const hp = splitHostPort(opts.publicHost, publicPort);
    if (hp.host) return { url: 'http://' + hostForUrl(hp.host) + (hp.port ? ':' + hp.port : ''), source: 'server/config.json tunnel.frp.publicHost' };
  }
  const serverName = stripHost(info && info.serverName);
  const serverAddr = stripHost(info && info.serverAddr);
  let host = '';
  let source = '';
  if (serverName && !/^\d+\.\d+\.\d+\.\d+$/.test(serverName)) { host = serverName; source = 'transport.tls.serverName'; }
  else if (serverAddr) { host = serverAddr; source = 'serverAddr'; }
  else if (serverName) { host = serverName; source = 'transport.tls.serverName'; }
  if (!host || !publicPort) return null;
  return { url: 'http://' + hostForUrl(host) + ':' + publicPort, source: source };
}

/* frpc 配置探测顺序：server/frpc.toml → server/frpc.ini → PATH 里的 frpc */
function resolveFrpcPlan(frp) {
  const opts = frp || {};
  const configDir = opts.configDir || __dirname;
  const configFile = String(opts.configFile || 'frpc.toml');
  const tomlPath = path.isAbsolute(configFile) ? configFile : path.join(configDir, configFile);
  const iniPath = path.join(configDir, 'frpc.ini');
  const bin = findTool('frpc');
  if (isFile(tomlPath)) return { mode: 'toml', bin: bin, configPath: tomlPath, tomlPath: tomlPath, iniPath: iniPath, hasToml: true };
  if (isFile(iniPath)) return { mode: 'ini', bin: bin, configPath: iniPath, tomlPath: tomlPath, iniPath: iniPath, hasToml: false };
  if (bin) return { mode: 'path', bin: bin, configPath: null, tomlPath: tomlPath, iniPath: iniPath, hasToml: false };
  return { mode: null, bin: null, configPath: null, tomlPath: tomlPath, iniPath: iniPath, hasToml: false };
}
/* ---------------------------- 子进程启动 ---------------------------- */

function spawnCommand(binPath, args, cwd) {
  const list = Array.isArray(args) ? args : [];
  const opts = { windowsHide: true, env: process.env };
  if (cwd) opts.cwd = cwd;

  if (/\.(js|cjs|mjs)$/i.test(binPath)) {
    return spawn(process.execPath, [binPath].concat(list), opts);
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
    // .cmd / .bat 需要 cmd.exe 转一层；显式拼命令行，避免 shell:true 的安全告警
    const comspec = process.env.ComSpec || 'cmd.exe';
    const quote = function (s) {
      s = String(s);
      if (s === '') return '""';
      return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s;
    };
    const line = quote(binPath) + (list.length ? ' ' + list.map(quote).join(' ') : '');
    return spawn(comspec, ['/d', '/s', '/c', line], Object.assign({}, opts, { windowsVerbatimArguments: true }));
  }
  return spawn(binPath, list, opts);
}

function spawnToolProcess(toolName, binPath, port) {
  const def = TOOL_DEFS[toolName];
  const args = def.args(port);
  return spawnCommand(binPath, args, toolName === 'frpc' ? path.dirname(binPath) : undefined);
}

function waitExit(child, timeoutMs) {
  return new Promise(function (resolve) {
    if (!child || child.exitCode !== null) { resolve({ ok: true }); return; }
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      resolve({ ok: false, error: '停止超时' });
    }, timeoutMs);
    child.once('exit', function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: true });
    });
  });
}

/* ---------------------------- 穿透管理器 ---------------------------- */

class TunnelManager {
  /*
   * options: { port, configPath, keepAlive, writeConfig, urlTimeoutMs, onLog }
   *   - onLog(line) 会把每条日志同时交给主程序打印
   */
  constructor(options) {
    const opts = options || {};
    this.port = parseInt(opts.port, 10) || 8080;
    this.configPath = opts.configPath || path.join(__dirname, 'config.json');
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    this.onPublic = typeof opts.onPublic === 'function' ? opts.onPublic : function () {};
    this.keepAlive = opts.keepAlive !== false;
    this.writeConfig = opts.writeConfig !== false;
    this.urlTimeoutMs = Math.max(3000, parseInt(opts.urlTimeoutMs, 10) || parseInt(process.env.BG_TUNNEL_URL_TIMEOUT_MS, 10) || 20000);
    this.upnp = opts.upnp || require('./upnp');

    const frp = opts.frp || {};
    this.frp = {
      configDir: frp.configDir || __dirname,
      configFile: String(frp.configFile || 'frpc.toml'),
      autoFixLocalPort: frp.autoFixLocalPort !== false,
      publicHost: String(frp.publicHost || ''),
      publicPort: parseInt(frp.publicPort, 10) || 0,
      noFix: frp.noFix === true
    };

    this.logs = [];
    this.state = 'off';        // off | starting | running | failed | stopped
    this.provider = null;      // upnp | natpmp | cloudflared | ngrok | frpc
    this.public = null;        // { url, method, ok, externalIp, externalPort, check }
    this.child = null;
    this.childTool = null;
    this.childStartedAt = 0;
    this.childRestarts = 0;
    this.upnpResult = null;    // UPnP/NAT-PMP 映射句柄（stop 时删除）
    this._stopped = false;
    this._startPromise = null;
    this._generation = 0;
  }

  log(message) {
    const line = '[' + hhmmss() + '] ' + maskToken(message);
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
    try { this.onLog(line); } catch (e) {}
  }

  getInfo() {
    return { provider: this.provider, state: this.state, log: this.logs.slice(-80) };
  }

  getPublic() {
    return this.public ? Object.assign({}, this.public) : null;
  }

  setPublic(pub) {
    this.public = pub ? Object.assign({}, pub) : null;
    try { this.onPublic(this.public); } catch (e) {}
  }

  /* 启动穿透（幂等；失败绝不 reject） */
  start(options) {
    const opts = options || {};
    if (this._startPromise) return this._startPromise;
    if (this.state === 'running' && this.public) {
      return Promise.resolve({ ok: true, url: this.public.url, provider: this.provider, state: this.state, reused: true });
    }
    this._stopped = false;
    this._generation++;
    const gen = this._generation;
    const self = this;
    this._startPromise = this._doStart(opts, gen).then(function (r) {
      self._startPromise = null;
      return r;
    }, function (e) {
      self._startPromise = null;
      self.state = 'failed';
      self.log('穿透启动异常（已忽略）：' + (e && e.message ? e.message : e));
      return { ok: false, state: 'failed', message: e && e.message ? e.message : String(e) };
    });
    return this._startPromise;
  }

  async _doStart(opts, gen) {
    const mode = String(opts.mode || 'auto').toLowerCase();
    const forcedTool = TOOL_DEFS[opts.tool] ? opts.tool : null;
    const prefer = opts.prefer === 'tool' ? 'tool' : 'upnp';

    this.state = 'starting';
    this.provider = null;
    this.setPublic(null);
    this.log('穿透模式 ' + mode + (forcedTool ? '（指定工具 ' + forcedTool + '）' : '') + '，优先 ' + (prefer === 'tool' ? '本机工具' : 'UPnP/NAT-PMP'));

    if (mode === 'off') {
      this.state = 'off';
      this.log('穿透已关闭（--tunnel=off），仅本机 / 局域网可用。');
      return { ok: false, state: 'off', provider: null, message: 'tunnel off' };
    }

    // 注意：这里必须惰性执行，UPnP 失败后才轮到本机工具（不能并发抢跑）
    const tryUpnp = () => this._tryUpnp(gen);
    const tryTools = () => this._tryTools(forcedTool, gen);

    let ok = false;
    if (mode === 'upnp') {
      ok = await tryUpnp();
    } else if (forcedTool) {
      ok = await tryTools();
    } else if (prefer === 'tool') {
      ok = await tryTools();
      if (!ok && !this._stopped && gen === this._generation) ok = await tryUpnp();
    } else {
      ok = await tryUpnp();
      if (!ok && !this._stopped && gen === this._generation) ok = await tryTools();
    }

    if (this._stopped || gen !== this._generation) {
      return { ok: false, state: this.state, provider: this.provider, message: '已取消' };
    }
    if (ok) {
      this.state = 'running';
      return { ok: true, url: this.public ? this.public.url : null, provider: this.provider, state: this.state };
    }

    this.state = 'failed';
    this.log('所有自动穿透方式都不可用。');
    this.log('局域网模式仍然可用：把「局域网」地址发给同一 WiFi 下的朋友就能联机，不受影响。');
    this.log('想要外网联机请看 server/README-联机.md 的「内置穿透」章节（推荐 cloudflared，免费且不用注册）。');
    return { ok: false, state: 'failed', provider: this.provider, message: '未找到可用的穿透方式（UPnP/NAT-PMP 与本机穿透工具都不可用）' };
  }

  async _tryUpnp(gen) {
    this.log('UPnP/NAT-PMP：开始探测网关（秒级超时，失败自动降级）…');
    const started = Date.now();
    let result = null;
    try {
      result = await this.upnp.openPortMapping({
        port: this.port,
        internalPort: this.port,
        externalPort: this.port,
        selfCheck: true
      });
    } catch (e) {
      result = { ok: false, error: e && e.message ? e.message : String(e) };
    }
    if (this._stopped || gen !== this._generation) return false;
    const cost = Date.now() - started;

    if (result && result.ok) {
      this.provider = result.method === 'natpmp' ? 'natpmp' : 'upnp';
      this.upnpResult = result;
      const url = result.url || null;
      this.setPublic({
        url: url,
        method: this.provider,
        ok: true,
        externalIp: result.externalIp || null,
        externalPort: result.externalPort || null,
        check: result.check || null
      });
      if (url) {
        if (this.writeConfig && writeConfigPublicUrl(this.configPath, url, this.provider)) {
          this.log('已把公网地址写回 server/config.json 的 publicUrl。');
        }
        this.log('UPnP/NAT-PMP 成功（' + cost + 'ms）：' + url + '（TCP ' + this.port + ' → ' + (result.internalIp || '') + ':' + (result.internalPort || this.port) + '）');
        this.log('分享给朋友：' + url + '/#join=房间码');
      } else {
        this.log('UPnP/NAT-PMP 映射成功（' + cost + 'ms），但没取到外网 IP；请用手机流量访问 http://<路由器 WAN IP>:' + (result.externalPort || this.port) + '/ 验证。');
      }
      if (result.check && result.check.attempted) {
        this.log('外网自检：' + (result.check.ok ? '通过' : '未通过 — ' + result.check.detail));
      } else if (result.check && result.check.detail) {
        this.log('外网自检：未执行 — ' + result.check.detail);
      }
      this.state = 'running';
      return true;
    }

    const msg = result && (result.message || result.error) ? (result.message || result.error) : '未知错误';
    this.log('UPnP/NAT-PMP 失败（' + cost + 'ms）：' + msg);
    this.log('提示：多数家用路由器需要先在管理页打开「UPnP」开关；公司/校园网或运营商 CGNAT 环境下 UPnP 往往不可用，建议改用 cloudflared / ngrok。');
    return false;
  }

  async _tryTools(forcedTool, gen) {
    let tools = detectTools();
    const frpPlan = resolveFrpcPlan(this.frp);
    // 即使 frpc 二进制不在 PATH，只要 server/frpc.toml(.ini) 存在也要尝试一次，便于给出明确指引
    if (frpPlan.configPath && !tools.some(function (t) { return t.name === 'frpc'; })) {
      tools.push({ name: 'frpc', path: frpPlan.configPath, label: TOOL_DEFS.frpc.label, configOnly: !frpPlan.bin });
    }
    // 用户明确放了 frpc.toml（平台配置），优先于 cloudflared / ngrok
    if (!forcedTool && frpPlan.mode === 'toml') {
      tools.sort(function (a, b) { return a.name === 'frpc' ? -1 : (b.name === 'frpc' ? 1 : 0); });
    }
    if (forcedTool) {
      tools = tools.filter(function (t) { return t.name === forcedTool; });
      if (!tools.length) {
        this.log('未检测到 ' + forcedTool + '（PATH 和常见安装目录里都没有）。');
        this.log(TOOL_DEFS[forcedTool].installHint);
        return false;
      }
    } else if (!tools.length) {
      this.log('未检测到 cloudflared / ngrok / frpc。');
      this.log('推荐装 cloudflared（免费、不用注册）：' + TOOL_DEFS.cloudflared.installHint);
      return false;
    }

    for (const tool of tools) {
      if (this._stopped || gen !== this._generation) return false;
      this.log('检测到 ' + tool.name + (tool.configOnly ? '（只有配置文件，未找到可执行文件）' : '') + '：' + tool.path);
      const ok = tool.name === 'frpc' ? await this._startFrpcTool(gen) : await this._startToolProcess(tool.name, gen);
      if (ok) return true;
    }
    return false;
  }

  _startToolProcess(name, gen) {
    const def = TOOL_DEFS[name];
    const bin = findTool(name);
    if (!bin) {
      this.log('找不到 ' + name + ' 可执行文件。');
      return Promise.resolve(false);
    }
    let args = [];
    try { args = def.args(this.port); } catch (e) { args = []; }
    const self = this;
    return this._spawnTool({
      name: name,
      bin: bin,
      args: args,
      label: def.label,
      gen: gen,
      fallbackUrl: name === 'frpc' ? parseFrpcIniUrl(bin) : null,
      fallbackDelayMs: 1200,
      restart: function () { return self._startToolProcess(name, gen); }
    });
  }

  /* 通用子进程启动：抓 URL / 配置兜底地址 / keepAlive / 退出处理 */
  _spawnTool(config) {
    const self = this;
    const cfg = config || {};
    const name = cfg.name || 'tunnel';
    const label = cfg.label || name;
    return new Promise(function (resolve) {
      if (!cfg.bin) {
        self.log(label + '：找不到可执行文件。');
        resolve(false);
        return;
      }
      self.provider = name;
      self.state = 'starting';
      self.log('正在启动 ' + label + ' …');
      self.log('命令：' + cfg.bin + ' ' + (cfg.args || []).join(' '));

      let child;
      try {
        child = spawnCommand(cfg.bin, cfg.args || [], cfg.cwd);
      } catch (e) {
        self.log(label + ' 启动失败：' + e.message);
        resolve(false);
        return;
      }
      self.child = child;
      self.childTool = name;
      self.childStartedAt = Date.now();

      let settled = false;
      let buffer = '';
      let urlTimer = null;
      let fallbackTimer = null;

      function finish(ok, url, message) {
        if (settled) return;
        settled = true;
        if (urlTimer) clearTimeout(urlTimer);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (ok) {
          self.setPublic({ url: url, method: name, ok: true });
          self.state = 'running';
          if (self.writeConfig && writeConfigPublicUrl(self.configPath, url, name)) {
            self.log('已把公网地址写回 server/config.json 的 publicUrl。');
          }
          self.log(label + ' 已就绪：' + url);
          if (cfg.fallbackUsed) self.log('提示：如果平台给了独立自定义域名，请手动改 server/config.json 的 publicUrl。');
          self.log('分享给朋友：' + url + '/#join=房间码');
          resolve(true);
        } else {
          self.log(label + ' 失败：' + message);
          resolve(false);
        }
      }

      function onData(chunk) {
        const text = chunk.toString('utf8');
        buffer = (buffer + text).slice(-65536);
        for (const rawLine of text.split(/\r?\n/)) {
          const s = rawLine.trim();
          if (!s) continue;
          if (/trycloudflare\.com|ngrok|Forwarding|started tunnel|Registered tunnel|start proxy|success|Error|ERR|fatal|failed|错误|失败/i.test(s)) {
            self.log('[' + name + '] ' + s.slice(0, 300));
          }
        }
        if (!settled) {
          const url = extractUrl(buffer, name);
          if (url) finish(true, url, '');
        }
      }

      if (child.stdout) child.stdout.on('data', onData);
      if (child.stderr) child.stderr.on('data', onData);

      child.on('error', function (err) {
        if (!settled) finish(false, null, '进程错误：' + err.message);
      });

      child.on('exit', function (code, signal) {
        if (self.child === child) self.child = null;
        if (!settled) {
          const tail = buffer.trim() ? buffer.trim().split(/\r?\n/).slice(-2).join(' | ').slice(0, 240) : '';
          finish(false, null, '提前退出（code=' + code + (signal ? ', signal=' + signal : '') + '）' + (tail ? '；最后输出：' + tail : ''));
          return;
        }
        if (self._stopped || cfg.gen !== self._generation) return;
        const uptime = Date.now() - self.childStartedAt;
        self.log(label + ' 进程已退出（code=' + code + (signal ? ', signal=' + signal : '') + '）。');
        if (self.keepAlive && uptime > 5000 && self.childRestarts < 2) {
          self.childRestarts++;
          self.log('keepAlive 生效：2 秒后自动重启（第 ' + self.childRestarts + ' 次）…');
          setTimeout(function () {
            if (self._stopped || cfg.gen !== self._generation) return;
            const p = typeof cfg.restart === 'function' ? cfg.restart() : self._startToolProcess(name, cfg.gen);
            Promise.resolve(p).then(function (ok) {
              if (!ok) {
                self.state = 'failed';
                self.log('自动重启失败，隧道已断开。');
              }
            });
          }, 2000);
        } else {
          self.state = 'failed';
          self.log('隧道已断开；可重启服务端或在游戏「联机」页重新一键开启。');
        }
      });

      urlTimer = setTimeout(function () {
        if (settled) return;
        finish(false, null, '在 ' + Math.round(self.urlTimeoutMs / 1000) + ' 秒内没有从输出里识别到公网地址');
        self._killChild(child);
      }, self.urlTimeoutMs);

      // 配置兜底地址：延迟一点，优先等 stdout 里的 URL
      if (cfg.fallbackUrl) {
        fallbackTimer = setTimeout(function () {
          if (settled) return;
          cfg.fallbackUsed = true;
          self.log('未从输出抓到 URL，改用配置推导的地址：' + cfg.fallbackUrl);
          finish(true, cfg.fallbackUrl, '');
        }, cfg.fallbackDelayMs || 1500);
      }
    });
  }
  /* frpc：优先 server/frpc.toml，其次 server/frpc.ini，最后 PATH 里的 frpc */
  _startFrpcTool(gen) {
    const plan = resolveFrpcPlan(this.frp);
    const self = this;
    if (!plan.mode) {
      this.log('未找到 server/frpc.toml、server/frpc.ini，也没有 PATH 里的 frpc。');
      this.log(TOOL_DEFS.frpc.installHint);
      return Promise.resolve(false);
    }
    if (!plan.bin) {
      const which = plan.mode === 'toml' ? 'server/frpc.toml' : 'server/frpc.ini';
      this.log('发现 ' + which + '，但没有找到 frpc 可执行文件。');
      this.log('请安装 frpc（放到 PATH 或 C:\\frp\\），配置已就绪，装好后重跑服务端即可。');
      this.log('排查：确认配置里 localPort = ' + this.port + '（游戏端口）、remotePort 与平台隧道一致。');
      return Promise.resolve(false);
    }

    if (plan.mode === 'toml') {
      let text = '';
      try { text = fs.readFileSync(plan.configPath, 'utf8'); } catch (e) {
        this.log('读取 frpc.toml 失败：' + e.message);
        return Promise.resolve(false);
      }
      const info = parseFrpcToml(text);
      if (!info.ok || !info.serverAddr) {
        this.log('frpc.toml 解析失败或缺少 serverAddr，请检查文件格式：' + plan.configPath);
        return Promise.resolve(false);
      }
      this.log('frp 配置：' + describeFrpcToml(info));
      if (!info.remotePort) this.log('提醒：frpc.toml 里没有 remotePort；请与平台隧道配置核对（remotePort 必须与平台一致）。');

      const canFix = this.frp.autoFixLocalPort && !this.frp.noFix;
      if (canFix) {
        const fix = fixLocalPortInToml(text, this.port);
        if (fix.changed) {
          try {
            fs.copyFileSync(plan.configPath, plan.configPath + '.bak');
            fs.writeFileSync(plan.configPath, fix.text, 'utf8');
            this.log('已自动把 frpc.toml 的 localPort 从 ' + (fix.oldPort === null ? '(缺失)' : fix.oldPort) + ' 改为游戏端口 ' + this.port + '（原文件备份：frpc.toml.bak）');
          } catch (e) {
            this.log('自动改写 frpc.toml 失败（继续尝试启动）：' + e.message);
          }
        } else {
          this.log('frpc.toml 的 localPort = ' + (info.localPort === null || info.localPort === undefined ? '(缺失)' : info.localPort) + ' 与游戏端口一致。');
        }
      } else if (info.localPort !== this.port) {
        this.log('提醒：frpc.toml 的 localPort = ' + (info.localPort === null ? '(缺失)' : info.localPort) + ' 与游戏端口 ' + this.port + ' 不一致，自动纠正已关闭（--frp-no-fix / tunnel.frp.autoFixLocalPort=false），请手动修改。');
      }

      const derived = deriveFrpPublicUrl(info, this.frp);
      if (derived && derived.url) {
        this.log('推导公网地址：' + derived.url + '（来源：' + derived.source + '）');
        this.log('提示：如果平台给了独立自定义域名，请手动改 server/config.json 的 publicUrl。');
      } else {
        this.log('暂时无法从 frpc.toml 推导公网地址（缺少 remotePort 或 serverAddr/serverName），将等待 frpc 输出。');
      }
      return this._spawnTool({
        name: 'frpc',
        bin: plan.bin,
        args: ['-c', plan.configPath],
        cwd: path.dirname(plan.configPath),
        label: 'frpc（' + path.basename(plan.configPath) + '）',
        gen: gen,
        fallbackUrl: derived && derived.url,
        fallbackDelayMs: 1800,
        restart: function () { return self._startFrpcTool(gen); }
      });
    }

    if (plan.mode === 'ini') {
      const iniUrl = parseFrpcIniUrl(plan.configPath);
      this.log('使用旧版 frpc.ini 配置：' + plan.configPath);
      if (iniUrl) this.log('从 frpc.ini 推导公网地址：' + iniUrl + '（如与平台不一致请手动改 server/config.json 的 publicUrl）');
      else this.log('提醒：frpc.ini 里缺少 server_addr / remote_port，请与平台/自建服务配置核对。');
      return this._spawnTool({
        name: 'frpc',
        bin: plan.bin,
        args: ['-c', plan.configPath],
        cwd: path.dirname(plan.configPath),
        label: 'frpc（frpc.ini）',
        gen: gen,
        fallbackUrl: iniUrl,
        fallbackDelayMs: 1200,
        restart: function () { return self._startFrpcTool(gen); }
      });
    }

    // PATH 回退：沿用旧逻辑（-c frpc.ini，工作目录 = frpc 所在目录）
    const iniUrl = parseFrpcIniUrl(plan.bin);
    if (iniUrl) this.log('从 frpc 同目录 frpc.ini 推导公网地址：' + iniUrl + '（如与平台不一致请手动改 server/config.json 的 publicUrl）');
    else this.log('未找到 frpc.ini，将只依赖 frpc 输出里的公网地址。');
    return this._spawnTool({
      name: 'frpc',
      bin: plan.bin,
      args: ['-c', 'frpc.ini'],
      cwd: path.dirname(plan.bin),
      label: TOOL_DEFS.frpc.label,
      gen: gen,
      fallbackUrl: iniUrl,
      fallbackDelayMs: 1200,
      restart: function () { return self._startFrpcTool(gen); }
    });
  }
  _killChild(child) {
    if (!child || child.exitCode !== null) return;
    try { child.kill(); } catch (e) {}
    if (process.platform === 'win32' && child.pid) {
      // cmd.exe 退出不代表 ping 等孙进程退出，必须按 PID 杀整棵进程树
      setTimeout(function () {
        try {
          execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, function () {});
        } catch (e) {}
      }, 500);
    } else {
      setTimeout(function () {
        if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch (e) {} }
      }, 1000);
    }
  }

  /* 停止穿透：删除端口映射 + 关闭子进程 */
  async stop(reason) {
    this._stopped = true;
    this._generation++;
    const tasks = [];

    if (this.upnpResult && typeof this.upnpResult.close === 'function') {
      const handle = this.upnpResult;
      this.upnpResult = null;
      this.log('正在删除 UPnP/NAT-PMP 端口映射…');
      tasks.push(Promise.race([
        handle.close().then(function (r) { return r || { ok: true }; }, function (e) { return { ok: false, error: e.message }; }),
        delay(1200).then(function () { return { ok: false, error: '超时' }; })
      ]));
    }
    if (this.child) {
      const child = this.child;
      this.log('正在停止 ' + (this.childTool || '穿透工具') + ' …');
      this._killChild(child);
      tasks.push(waitExit(child, 1500));
    }
    if (tasks.length) {
      try { await Promise.all(tasks); } catch (e) {}
    }

    this.child = null;
    this.childTool = null;
    this.childStartedAt = 0;
    this.state = 'stopped';
    this.setPublic(null);
    this.log('穿透已停止（' + (reason || '用户操作') + '）。局域网仍然可用。');
    return { ok: true, state: 'stopped', provider: this.provider };
  }
}

module.exports = {
  TOOL_ORDER: TOOL_ORDER,
  TOOL_DEFS: TOOL_DEFS,
  findTool: findTool,
  detectTools: detectTools,
  extractUrl: extractUrl,
  sanitizeUrl: sanitizeUrl,
  parseFrpcIniUrl: parseFrpcIniUrl,
  parseFrpcToml: parseFrpcToml,
  parseToml: parseToml,
  describeFrpcToml: describeFrpcToml,
  fixLocalPortInToml: fixLocalPortInToml,
  deriveFrpPublicUrl: deriveFrpPublicUrl,
  resolveFrpcPlan: resolveFrpcPlan,
  maskToken: maskToken,
  writeConfigPublicUrl: writeConfigPublicUrl,
  spawnCommand: spawnCommand,
  spawnToolProcess: spawnToolProcess,
  TunnelManager: TunnelManager
};