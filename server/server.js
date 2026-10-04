#!/usr/bin/env node
/*
 * ============================================================
 *  方块枪神 2D · 零依赖联机服务端  (Block Gunner 2D)
 * ============================================================
 *  只用 Node 内置模块：http / crypto / fs / path / os / url / net
 *  1) HTTP 静态托管：项目根目录（server/ 的上一级）作为网站根
 *  2) WebSocket 服务端：手写 RFC6455 握手 + 帧解析（端点 /ws）
 *  3) 房间中继：create / join / room / peer / ready / start / relay / ping / leave / err
 *
 *  启动：
 *    node server.js [--port=8080] [--host=0.0.0.0] [--public-url=https://xxx]
 *    也可用环境变量 PORT / HOST / PUBLIC_URL / MAX_PLAYERS / MAX_ROOMS 覆盖
 * ============================================================
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { TunnelManager } = require('./tunnel');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const SERVER_VERSION = '1.1.0';

/* ---------------------------- 配置读取 ---------------------------- */

const DEFAULT_CONFIG = {
  port: 8080,
  host: '0.0.0.0',
  maxPlayers: 6,
  maxRooms: 200,
  publicUrl: '',
  tunnel: {
    auto: true,
    prefer: 'upnp',
    externalPort: 0,
    keepAlive: true,
    provider: 'none',
    frp: { configFile: 'frpc.toml', autoFixLocalPort: true, publicHost: '', publicPort: 0 },
    note: 'publicUrl 可手动填写；--tunnel=auto 穿透成功后会自动写回这里'
  },
  heartbeat: { idleMs: 30000, pongTimeoutMs: 60000, tickMs: 5000 },
  maxMessageBytes: 2 * 1024 * 1024,
  maxNameLength: 16
};

function readConfigFile() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    if (e && e.code !== 'ENOENT') {
      console.warn('[warn] 读取 config.json 失败，使用默认配置：' + e.message);
    }
    return {};
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let m;
    if ((m = /^--(port|host|public-url|publicUrl|max-players|max-rooms|tunnel|tunnel-tool|tunnelTool)=(.*)$/.exec(a))) {
      out[m[1]] = m[2];
    } else if (a === '--port' || a === '--host' || a === '--public-url' || a === '--max-players' || a === '--max-rooms' || a === '--tunnel' || a === '--tunnel-tool') {
      out[a.slice(2)] = argv[i + 1];
      i++;
    } else if (a === '--frp-no-fix') {
      out['frp-no-fix'] = '1';
    } else if (a === '-p' && argv[i + 1]) {
      out.port = argv[++i];
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function toPositiveInt(v, fallback, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function loadConfig() {
  const fileCfg = readConfigFile();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node server.js [--port=8080] [--host=0.0.0.0] [--public-url=https://xxx] [--max-players=6] [--max-rooms=200] [--tunnel=auto|upnp|off] [--tunnel-tool=cloudflared|ngrok|frpc] [--frp-no-fix]');
    process.exit(0);
  }
  const cfg = Object.assign({}, DEFAULT_CONFIG, fileCfg);
  cfg.tunnel = Object.assign({}, DEFAULT_CONFIG.tunnel, fileCfg.tunnel || {});
  cfg.heartbeat = Object.assign({}, DEFAULT_CONFIG.heartbeat, fileCfg.heartbeat || {});

  const pick = (cliKey, envKey, fallback) => {
    if (args[cliKey] !== undefined && args[cliKey] !== '') return args[cliKey];
    if (process.env[envKey]) return process.env[envKey];
    return fallback;
  };

  cfg.port = toPositiveInt(pick('port', 'PORT', cfg.port), DEFAULT_CONFIG.port, 1, 65535);
  cfg.host = String(pick('host', 'HOST', cfg.host) || '0.0.0.0');
  cfg.publicUrl = String(pick('public-url', 'PUBLIC_URL', cfg.publicUrl || '')).trim().replace(/\/+$/, '');
  cfg.maxPlayers = toPositiveInt(pick('max-players', 'MAX_PLAYERS', cfg.maxPlayers), DEFAULT_CONFIG.maxPlayers, 2, 64);
  cfg.maxRooms = toPositiveInt(pick('max-rooms', 'MAX_ROOMS', cfg.maxRooms), DEFAULT_CONFIG.maxRooms, 1, 100000);
  cfg.maxMessageBytes = toPositiveInt(cfg.maxMessageBytes, DEFAULT_CONFIG.maxMessageBytes, 1024, 64 * 1024 * 1024);
  cfg.maxNameLength = toPositiveInt(cfg.maxNameLength, DEFAULT_CONFIG.maxNameLength, 1, 64);

  // 穿透开关：命令行 > 环境变量 > config.json > 默认 auto
  let tunnelMode = String(pick('tunnel', 'TUNNEL', (cfg.tunnel && cfg.tunnel.auto === false) ? 'off' : 'auto') || 'auto').toLowerCase();
  if (tunnelMode !== 'auto' && tunnelMode !== 'upnp' && tunnelMode !== 'off') tunnelMode = 'auto';
  let tunnelTool = String(pick('tunnel-tool', 'TUNNEL_TOOL', '') || '').toLowerCase();
  if (tunnelTool !== 'cloudflared' && tunnelTool !== 'ngrok' && tunnelTool !== 'frpc') tunnelTool = '';
  cfg.tunnelMode = tunnelMode;
  cfg.tunnelTool = tunnelTool;
  cfg.tunnel.prefer = (cfg.tunnel.prefer === 'tool') ? 'tool' : 'upnp';
  cfg.tunnel.externalPort = toPositiveInt(cfg.tunnel.externalPort, 0, 0, 65535);
  cfg.tunnel.auto = tunnelMode !== 'off';

  // frpc.toml（OpenFrp / ofalias 等平台）相关配置
  cfg.frpNoFix = args['frp-no-fix'] === '1' || /^(1|true|yes|on)$/i.test(String(process.env.FRP_NO_FIX || ''));
  cfg.tunnel.frp = Object.assign(
    { configFile: 'frpc.toml', autoFixLocalPort: true, publicHost: '', publicPort: 0 },
    DEFAULT_CONFIG.tunnel.frp || {},
    (fileCfg.tunnel && fileCfg.tunnel.frp) || {}
  );
  cfg.tunnel.frp.configFile = String(cfg.tunnel.frp.configFile || 'frpc.toml');
  cfg.tunnel.frp.autoFixLocalPort = cfg.tunnel.frp.autoFixLocalPort !== false && !cfg.frpNoFix;
  cfg.tunnel.frp.publicHost = String(cfg.tunnel.frp.publicHost || '');
  cfg.tunnel.frp.publicPort = toPositiveInt(cfg.tunnel.frp.publicPort, 0, 0, 65535);
  return cfg;
}

const CONFIG = loadConfig();
const PORT = CONFIG.port;
const HOST = CONFIG.host;
let TUNNEL = null; // 穿透管理器，在 listen 之前初始化
const CONFIGURED_PUBLIC_URL = CONFIG.publicUrl; // 启动时手动配置的 publicUrl（穿透停止后恢复）

/* ---------------------------- 工具函数 ---------------------------- */

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log() {
  const parts = Array.prototype.slice.call(arguments);
  console.log('[' + nowIso() + '] ' + parts.join(' '));
}

function sanitizeName(name, fallback) {
  let s = typeof name === 'string' ? name : (name === undefined || name === null ? '' : String(name));
  s = s.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (s.length > CONFIG.maxNameLength) s = s.slice(0, CONFIG.maxNameLength);
  return s || (fallback || '玩家');
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function httpBase(host, port) {
  const h = (!host || host === '0.0.0.0' || host === '::') ? '127.0.0.1' : host;
  const hh = h.indexOf(':') >= 0 ? '[' + h + ']' : h;
  return 'http://' + hh + ':' + port;
}

function wsFromHttp(base) {
  return base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') + '/ws';
}

/* ---------------------------- 静态文件服务 ---------------------------- */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8'
};

function sendText(res, status, text, contentType) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

function handleHttp(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://' + (req.headers.host || 'localhost')).pathname);
  } catch (e) {
    sendText(res, 400, '400 Bad Request');
    return;
  }

  /* ---------- 穿透相关 API（游戏内「联机」页使用） ---------- */
  if (pathname === '/netinfo') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendText(res, 405, '405 Method Not Allowed');
      return;
    }
    sendText(res, 200, JSON.stringify(buildNetInfo()), 'application/json; charset=utf-8');
    return;
  }

  if (pathname === '/tunnel/start' || pathname === '/tunnel/stop') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendText(res, 405, '405 Method Not Allowed');
      return;
    }
    handleTunnelApi(req, res, pathname);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(res, 405, '405 Method Not Allowed');
    return;
  }

  if (pathname === '/healthz' || pathname === '/api/health') {
    sendText(res, 200, JSON.stringify({
      ok: true,
      name: 'block-gunner-2d-server',
      version: SERVER_VERSION,
      rooms: rooms.size,
      connections: connections.size,
      players: countPlayers(),
      uptimeSec: Math.round(process.uptime()),
      publicUrl: CONFIG.publicUrl || null
    }), 'application/json; charset=utf-8');
    return;
  }

  if (pathname === '/ws') {
    sendText(res, 426, '426 Upgrade Required：/ws 是 WebSocket 端点，请用 ws:// 连接');
    return;
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const filePath = path.resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    sendText(res, 403, '403 Forbidden');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    sendText(res, 404, '404 Not Found：' + pathname);
    return;
  }
  if (stat.isDirectory()) {
    const indexPath = path.join(filePath, 'index.html');
    try {
      stat = fs.statSync(indexPath);
    } catch (e) {
      sendText(res, 404, '404 Not Found：' + pathname);
      return;
    }
    serveFile(req, res, indexPath, stat);
    return;
  }
  serveFile(req, res, filePath, stat);
}

/* ---------------------------- 穿透状态 / API ---------------------------- */

function currentPublicInfo() {
  let pub = TUNNEL ? TUNNEL.getPublic() : null;
  if (!pub && CONFIG.publicUrl) {
    pub = { url: CONFIG.publicUrl.replace(/\/+$/, ''), method: (CONFIG.tunnel && CONFIG.tunnel.provider) || 'manual', ok: true };
  }
  return pub;
}

function buildNetInfo() {
  const lan = lanAddresses().map(function (it) {
    return { ip: it.address, url: 'http://' + it.address + ':' + PORT };
  });
  const tinfo = TUNNEL ? TUNNEL.getInfo() : { provider: null, state: 'off', log: [] };
  const pub = currentPublicInfo();
  return {
    port: PORT,
    lan: lan,
    local: httpBase('127.0.0.1', PORT),
    public: pub ? { url: pub.url || null, method: pub.method || 'manual', ok: pub.ok !== false } : null,
    tunnel: {
      provider: tinfo.provider || (CONFIG.tunnel && CONFIG.tunnel.provider) || null,
      state: tinfo.state || 'off',
      log: tinfo.log || []
    }
  };
}

function handleTunnelApi(req, res, pathname) {
  let body = '';
  let tooBig = false;
  req.on('data', function (chunk) {
    body += chunk;
    if (body.length > 8192) { tooBig = true; try { req.destroy(); } catch (e) {} }
  });
  req.on('error', function () {});
  req.on('end', function () {
    if (tooBig) { sendText(res, 413, '413 Payload Too Large'); return; }
    let opts = {};
    try { if (body.trim()) opts = JSON.parse(body) || {}; } catch (e) { opts = {}; }

    if (!TUNNEL) {
      sendText(res, 503, JSON.stringify({ ok: false, error: '穿透管理器尚未初始化' }), 'application/json; charset=utf-8');
      return;
    }

    if (pathname === '/tunnel/start') {
      const mode = CONFIG.tunnelMode === 'off' ? 'auto' : CONFIG.tunnelMode;
      const tool = (opts && opts.tool) || CONFIG.tunnelTool || null;
      log('收到 /tunnel/start 请求（mode=' + mode + (tool ? ', tool=' + tool : '') + '）');
      TUNNEL.start({ mode: mode, tool: tool, prefer: (CONFIG.tunnel && CONFIG.tunnel.prefer) || 'upnp' }).then(function (r) {
        log('穿透启动结果：ok=' + !!r.ok + ' provider=' + (r.provider || '-') + ' url=' + (r.url || '-') + ' state=' + (r.state || '-'));
        sendText(res, 200, JSON.stringify({
          ok: !!r.ok,
          provider: r.provider || null,
          state: r.state || TUNNEL.state,
          url: r.url || null,
          message: r.message || null,
          netinfo: buildNetInfo()
        }), 'application/json; charset=utf-8');
      }).catch(function (e) {
        sendText(res, 500, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }), 'application/json; charset=utf-8');
      });
      return;
    }

    log('收到 /tunnel/stop 请求');
    TUNNEL.stop('HTTP API').then(function (r) {
      sendText(res, 200, JSON.stringify({ ok: true, state: r.state || 'stopped', netinfo: buildNetInfo() }), 'application/json; charset=utf-8');
    }).catch(function (e) {
      sendText(res, 500, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }), 'application/json; charset=utf-8');
    });
  });
}

function serveFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  // 代码类资源必须每次校验：否则更新后浏览器/Service Worker 会继续用旧 html/css/js
  const NO_CACHE_EXTS = ['.html', '.htm', '.css', '.js', '.mjs', '.webmanifest'];
  const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp'];
  const cacheControl = NO_CACHE_EXTS.indexOf(ext) >= 0
    ? 'no-cache, must-revalidate'
    : (IMAGE_EXTS.indexOf(ext) >= 0 ? 'public, max-age=300' : 'public, max-age=3600');
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff'
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', function () {
    if (!res.headersSent) sendText(res, 500, '500 Internal Server Error');
    else res.destroy();
  });
  stream.pipe(res);
}

/* ---------------------------- WebSocket 帧编解码 ---------------------------- */

function encodeFrame(opcode, payload, options) {
  const opt = options || {};
  const fin = opt.fin === undefined ? true : !!opt.fin;
  const mask = !!opt.mask;
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
  const len = data.length;
  let headerLen = 2;
  if (len >= 126 && len < 65536) headerLen += 2;
  else if (len >= 65536) headerLen += 8;
  if (mask) headerLen += 4;
  const buf = Buffer.allocUnsafe(headerLen + len);
  buf[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  if (len < 126) {
    buf[1] = len;
  } else if (len < 65536) {
    buf[1] = 126;
    buf.writeUInt16BE(len, 2);
  } else {
    buf[1] = 127;
    buf.writeBigUInt64BE(BigInt(len), 2);
  }
  let offset = 2;
  if (len >= 126 && len < 65536) offset = 4;
  else if (len >= 65536) offset = 10;
  if (mask) {
    buf[1] |= 0x80;
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(buf, offset);
    offset += 4;
    for (let i = 0; i < len; i++) buf[offset + i] = data[i] ^ maskKey[i & 3];
  } else {
    data.copy(buf, offset);
  }
  return buf;
}

function closePayload(code, reason) {
  const r = Buffer.from(reason || '', 'utf8');
  const buf = Buffer.allocUnsafe(2 + Math.min(r.length, 123));
  buf.writeUInt16BE(code || 1000, 0);
  r.copy(buf, 2, 0, Math.min(r.length, 123));
  return buf;
}

/* ---------------------------- 连接对象 ---------------------------- */

const connections = new Set();

class WSConn {
  constructor(socket, req) {
    this.id = 'p' + crypto.randomBytes(4).toString('hex');
    this.socket = socket;
    this.req = req;
    this.ip = (socket.remoteAddress || '').replace(/^::ffff:/, '');
    this.name = '';
    this.ready = false;
    this.room = null;
    this.closed = false;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragOpcode = 0;
    this.fragLen = 0;
    this.lastSeen = Date.now();
    this.lastPong = Date.now();
    this.pingSentAt = 0;
    this.awaitingPong = false;

    const self = this;
    socket.setNoDelay(true);
    socket.on('data', function (chunk) { self.onData(chunk); });
    socket.on('close', function () { self.onSocketClose(); });
    socket.on('error', function () { self.onSocketClose(); });
    socket.on('end', function () {
      self.onSocketClose();
      try { self.socket.destroy(); } catch (e) {}
    });
  }

  /* ---- 发送 ---- */
  raw(buf) {
    if (this.closed || !this.socket.writable) return false;
    try {
      this.socket.write(buf);
      return true;
    } catch (e) {
      return false;
    }
  }

  sendFrame(opcode, payload, options) {
    return this.raw(encodeFrame(opcode, payload, options));
  }

  send(obj) {
    if (this.closed || !this.socket.writable) return;
    let text;
    try {
      text = JSON.stringify(obj);
    } catch (e) {
      return;
    }
    this.sendFrame(0x1, text);
  }

  sendErr(msg) {
    this.send({ t: 'err', msg: String(msg || '错误') });
  }

  /* ---- 关闭 ---- */
  close(code, reason) {
    if (this.closed) return;
    try {
      if (this.socket.writable) this.socket.write(encodeFrame(0x8, closePayload(code || 1000, reason || '')));
    } catch (e) {}
    this.closed = true;
    this.cleanupRoom('disconnect');
    connections.delete(this);
    const self = this;
    setTimeout(function () {
      try { self.socket.destroy(); } catch (e) {}
    }, 80).unref();
  }

  terminate(reason) {
    if (this.closed) return;
    this.closed = true;
    this.cleanupRoom('disconnect');
    try { this.socket.destroy(); } catch (e) {}
    connections.delete(this);
    if (reason) log('连接强制断开', this.id, reason);
  }

  onSocketClose() {
    if (!this.closed) this.closed = true;
    connections.delete(this);
    this.cleanupRoom('disconnect');
  }

  /* ---- 房间清理 ---- */
  cleanupRoom(why) {
    const room = this.room;
    if (!room) return;
    this.room = null;
    const isHost = room.hostId === this.id;
    room.players.delete(this.id);
    if (isHost) {
      broadcastRoom(room, { t: 'peer', ev: 'leave', id: this.id, name: this.name, ready: false }, this.id);
      broadcastRoom(room, { t: 'err', msg: '房主已离开，房间已解散' });
      for (const p of room.players.values()) p.room = null;
      room.players.clear();
      rooms.delete(room.code);
      log('房间解散 ' + room.code + '（房主 ' + (this.name || this.id) + ' 离开）');
    } else {
      broadcastRoom(room, { t: 'peer', ev: 'leave', id: this.id, name: this.name, ready: false }, this.id);
      if (room.players.size === 0) {
        rooms.delete(room.code);
      } else {
        log('玩家离开 ' + room.code + '：' + (this.name || this.id) + '（剩余 ' + room.players.size + '）');
      }
    }
  }

  /* ---- 收包 ---- */
  onData(chunk) {
    if (this.closed) return;
    if (!chunk || chunk.length === 0) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    try {
      while (this.parseFrame()) { /* drain */ }
    } catch (e) {
      this.close(1002, 'protocol error');
      log('协议错误，断开 ' + this.id + '：' + e.message);
    }
  }

  parseFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return false;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const rsv = b0 & 0x70;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (rsv !== 0) throw new Error('RSV 非零');
    if (!masked) throw new Error('客户端帧必须带掩码');

    if (len === 126) {
      if (buf.length < 4) return false;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return false;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(CONFIG.maxMessageBytes)) {
        this.close(1009, 'message too big');
        return false;
      }
      len = Number(big);
      offset = 10;
    }
    if (len > CONFIG.maxMessageBytes) {
      this.close(1009, 'message too big');
      return false;
    }
    const total = offset + 4 + len;
    if (buf.length < total) return false;

    const maskKey = buf.subarray(offset, offset + 4);
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = buf[offset + 4 + i] ^ maskKey[i & 3];
    this.buffer = buf.subarray(total);
    this.lastSeen = Date.now();

    if (opcode >= 0x8) {
      if (!fin) throw new Error('控制帧不能分片');
      if (len > 125) throw new Error('控制帧过长');
      this.handleControl(opcode, payload);
      return true;
    }

    if (opcode === 0x0) {
      if (!this.fragOpcode) throw new Error('意外的续帧');
      this.fragments.push(payload);
      this.fragLen += len;
      if (this.fragLen > CONFIG.maxMessageBytes) {
        this.close(1009, 'message too big');
        return false;
      }
      if (fin) {
        const full = Buffer.concat(this.fragments, this.fragLen);
        const op = this.fragOpcode;
        this.fragments = [];
        this.fragOpcode = 0;
        this.fragLen = 0;
        this.handleMessage(op, full);
      }
      return true;
    }

    if (opcode === 0x1 || opcode === 0x2) {
      if (this.fragOpcode) throw new Error('分片未完成时又收到新数据帧');
      if (fin) {
        this.handleMessage(opcode, payload);
      } else {
        this.fragOpcode = opcode;
        this.fragments = [payload];
        this.fragLen = len;
      }
      return true;
    }

    throw new Error('不支持的 opcode: ' + opcode);
  }

  handleControl(opcode, payload) {
    if (opcode === 0x8) {
      this.close(1000, 'bye');
      return;
    }
    if (opcode === 0x9) {
      this.sendFrame(0xA, payload);
      return;
    }
    if (opcode === 0xA) {
      this.lastPong = Date.now();
      this.awaitingPong = false;
      return;
    }
  }

  handleMessage(opcode, payload) {
    if (opcode === 0x2) {
      this.sendErr('仅支持文本帧（JSON）');
      return;
    }
    let text;
    try {
      text = payload.toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    } catch (e) {
      this.sendErr('消息编码无效');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      this.sendErr('消息不是合法 JSON');
      return;
    }
    if (!isObject(msg) || typeof msg.t !== 'string') {
      this.sendErr('消息必须是带 t 字段的 JSON 对象');
      return;
    }
    try {
      handleClientMessage(this, msg);
    } catch (e) {
      this.sendErr('服务器处理消息出错：' + e.message);
      log('处理消息异常', this.id, e && e.stack ? e.stack : e);
    }
  }
}

/* ---------------------------- 房间逻辑 ---------------------------- */

const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomRoomCode() {
  let code = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

function makeRoomCode() {
  for (let i = 0; i < 2000; i++) {
    const code = randomRoomCode();
    if (!rooms.has(code)) return code;
  }
  return null;
}

function playerInfo(conn, room) {
  return { id: conn.id, name: conn.name, host: room.hostId === conn.id, ready: conn.ready };
}

function roomPlayers(room) {
  const arr = [];
  for (const p of room.players.values()) arr.push(playerInfo(p, room));
  return arr;
}

function countPlayers() {
  let n = 0;
  for (const room of rooms.values()) n += room.players.size;
  return n;
}

function broadcastRoom(room, obj, exceptId) {
  for (const p of room.players.values()) {
    if (exceptId !== undefined && p.id === exceptId) continue;
    p.send(obj);
  }
}

function leaveCurrentRoom(conn) {
  if (conn.room) {
    const room = conn.room;
    const isHost = room.hostId === conn.id;
    conn.room = null;
    conn.ready = false;
    room.players.delete(conn.id);
    if (isHost) {
      broadcastRoom(room, { t: 'peer', ev: 'leave', id: conn.id, name: conn.name, ready: false }, conn.id);
      broadcastRoom(room, { t: 'err', msg: '房主已离开，房间已解散' });
      for (const p of room.players.values()) p.room = null;
      room.players.clear();
      rooms.delete(room.code);
      log('房间解散 ' + room.code + '（房主 ' + (conn.name || conn.id) + ' 主动离开）');
    } else {
      broadcastRoom(room, { t: 'peer', ev: 'leave', id: conn.id, name: conn.name, ready: false }, conn.id);
      if (room.players.size === 0) rooms.delete(room.code);
    }
  }
}

function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function handleClientMessage(conn, msg) {
  switch (msg.t) {
    case 'create': {
      leaveCurrentRoom(conn);
      conn.name = sanitizeName(msg.name, '玩家');
      conn.ready = false;
      if (rooms.size >= CONFIG.maxRooms) {
        conn.sendErr('房间数量已达上限（' + CONFIG.maxRooms + '），请稍后再试');
        return;
      }
      const code = makeRoomCode();
      if (!code) {
        conn.sendErr('无法分配房间码，请稍后再试');
        return;
      }
      const room = {
        code: code,
        hostId: conn.id,
        config: isObject(msg.config) ? msg.config : {},
        players: new Map()
      };
      room.players.set(conn.id, conn);
      conn.room = room;
      rooms.set(code, room);
      conn.send({ t: 'room', code: code, id: conn.id, host: true, players: roomPlayers(room) });
      log('创建房间 ' + code + '：' + conn.name + '（' + conn.ip + '）');
      return;
    }

    case 'join': {
      leaveCurrentRoom(conn);
      conn.name = sanitizeName(msg.name, '玩家');
      conn.ready = false;
      const code = normalizeCode(msg.code);
      if (!code) {
        conn.sendErr('房间码无效');
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        conn.sendErr('房间不存在或已解散');
        return;
      }
      if (room.players.size >= CONFIG.maxPlayers) {
        conn.sendErr('房间已满（最多 ' + CONFIG.maxPlayers + ' 人）');
        return;
      }
      room.players.set(conn.id, conn);
      conn.room = room;
      conn.send({
        t: 'room',
        code: room.code,
        id: conn.id,
        host: false,
        players: roomPlayers(room),
        config: room.config
      });
      broadcastRoom(room, { t: 'peer', ev: 'join', id: conn.id, name: conn.name, ready: false }, conn.id);
      log('加入房间 ' + room.code + '：' + conn.name + '（' + conn.ip + '，当前 ' + room.players.size + ' 人）');
      return;
    }

    case 'ready': {
      const room = conn.room;
      if (!room) {
        conn.sendErr('你还没有加入房间');
        return;
      }
      conn.ready = !!msg.v;
      broadcastRoom(room, { t: 'peer', ev: 'ready', id: conn.id, name: conn.name, ready: conn.ready }, conn.id);
      return;
    }

    case 'start': {
      const room = conn.room;
      if (!room) {
        conn.sendErr('你还没有加入房间');
        return;
      }
      broadcastRoom(room, { t: 'start', config: room.config });
      log('开始游戏 ' + room.code + '（由 ' + (conn.name || conn.id) + ' 发起）');
      return;
    }

    case 'relay': {
      const room = conn.room;
      if (!room) {
        conn.sendErr('你还没有加入房间');
        return;
      }
      broadcastRoom(room, { t: 'relay', from: conn.id, data: msg.data }, conn.id);
      return;
    }

    case 'ping': {
      conn.send({ t: 'pong', ts: msg.ts });
      return;
    }

    case 'leave': {
      if (!conn.room) {
        conn.sendErr('你还没有加入房间');
        return;
      }
      leaveCurrentRoom(conn);
      conn.send({ t: 'peer', ev: 'leave', id: conn.id, name: conn.name, ready: false });
      return;
    }

    default:
      conn.sendErr('未知消息类型：' + msg.t);
  }
}

/* ---------------------------- 心跳 ---------------------------- */

const heartbeatTimer = setInterval(function () {
  const now = Date.now();
  for (const conn of connections) {
    if (conn.closed) continue;
    if (conn.awaitingPong) {
      if (now - conn.pingSentAt >= CONFIG.heartbeat.pongTimeoutMs) {
        conn.terminate('心跳超时（60 秒无 pong）');
      }
      continue;
    }
    if (now - conn.lastSeen >= CONFIG.heartbeat.idleMs) {
      conn.awaitingPong = true;
      conn.pingSentAt = now;
      conn.sendFrame(0x9, Buffer.from(String(now), 'utf8'));
    }
  }
}, CONFIG.heartbeat.tickMs);
heartbeatTimer.unref();

/* ---------------------------- HTTP + WS 服务 ---------------------------- */

const server = http.createServer(handleHttp);

server.on('upgrade', function (req, socket, head) {
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://' + (req.headers.host || 'localhost')).pathname;
  } catch (e) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  if (pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }

  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  const version = String(req.headers['sec-websocket-version'] || '');
  const key = req.headers['sec-websocket-key'];
  if (upgrade !== 'websocket' || !key) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  if (version !== '13') {
    socket.write('HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  let accept;
  try {
    accept = crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64');
  } catch (e) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n' +
    '\r\n'
  );

  const conn = new WSConn(socket, req);
  connections.add(conn);
  socket.on('close', function () { connections.delete(conn); });
  if (head && head.length) conn.onData(head);
});

server.on('error', function (err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error('[错误] 端口 ' + PORT + ' 已被占用，请换一个端口：node server.js --port=8081');
  } else {
    console.error('[错误] 服务启动失败：' + (err && err.message ? err.message : err));
  }
  process.exit(1);
});

/* ---------------------------- 启动横幅 ---------------------------- */

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      const family = info.family === 'IPv4' || info.family === 4;
      if (family && !info.internal) out.push({ name: name, address: info.address });
    }
  }
  return out;
}

function joinDeepLink(base) {
  return String(base).replace(/\/+$/, '') + '/#join=房间码';
}

function printBanner() {
  const line = '='.repeat(64);
  const localBase = httpBase('127.0.0.1', PORT);
  const lan = lanAddresses();
  const pub = currentPublicInfo();
  const out = [];
  out.push('');
  out.push(line);
  out.push('  方块枪神 2D · 联机服务端已启动  (Block Gunner 2D Server v' + SERVER_VERSION + ')');
  out.push(line);
  out.push('  【本机】   ' + localBase + '/');
  out.push('            深链示例: ' + localBase + '/#join=房间码');
  if (lan.length) {
    for (const it of lan) {
      const b = 'http://' + it.address + ':' + PORT;
      out.push('  【局域网】 ' + b + '/    [' + it.name + ']');
      out.push('            深链示例: ' + b + '/#join=房间码');
    }
  } else {
    out.push('  【局域网】 未检测到非回环 IPv4 网卡（请检查网络连接）');
  }
  if (pub && pub.url) {
    out.push('  【公网】   ' + String(pub.url).replace(/\/+$/, '') + '/    （方式：' + (pub.method || 'manual') + '）');
    out.push('            深链示例: ' + joinDeepLink(pub.url));
  } else if (TUNNEL && CONFIG.tunnelMode !== 'off' && TUNNEL.state !== 'stopped' && TUNNEL.state !== 'failed') {
    out.push('  【公网】   自动穿透检测中…（局域网已可用，结果稍后打印）');
    out.push('            深链示例: 穿透成功后显示 http(s)://…/#join=房间码');
  } else {
    out.push('  【公网】   未开启 / 不可用（仅本机 + 局域网可玩）');
    out.push('            深链示例: 穿透成功后显示 http(s)://…/#join=房间码');
  }
  out.push('  ------------------------------------------------------------');
  out.push('  参数 : host=' + HOST + ' port=' + PORT + ' maxPlayers=' + CONFIG.maxPlayers + ' maxRooms=' + CONFIG.maxRooms +
    ' 心跳=空闲' + Math.round(CONFIG.heartbeat.idleMs / 1000) + 's/pong超时' + Math.round(CONFIG.heartbeat.pongTimeoutMs / 1000) + 's');
  out.push('  穿透 : --tunnel=' + CONFIG.tunnelMode + (CONFIG.tunnelTool ? ' --tunnel-tool=' + CONFIG.tunnelTool : '') +
    '（auto = 先 UPnP/NAT-PMP，再 cloudflared/ngrok/frpc）');
  out.push('  API  : GET /netinfo · POST /tunnel/start · POST /tunnel/stop');
  out.push('  健康 : ' + localBase + '/healthz');
  out.push(line);
  out.push('  【手机 / 其他电脑怎么连进来】');
  out.push('   1. 同一 WiFi：手机浏览器打开上面「局域网」地址即可；');
  out.push('   2. 房间码分享：直接发 http://<地址>/#join=房间码，打开后自动进联机页；');
  out.push('   3. 外网（不在同一 WiFi）：等「公网」出现地址后，发公网深链；');
  out.push('   4. 没装穿透工具也能玩：局域网模式不受影响。');
  out.push('');
  out.push('  【防火墙】Windows 首次弹窗请勾选「专用网络 + 公用网络」并允许访问。');
  out.push('  【排查】  连不上先看 server/README-联机.md 的「常见故障排查」。');
  out.push(line);
  out.push('');
  console.log(out.join('\n'));
}

function printPublicBlock(result) {
  const line = '='.repeat(64);
  const info = TUNNEL ? TUNNEL.getInfo() : { provider: null, state: 'off', log: [] };
  const pub = currentPublicInfo();
  console.log('');
  console.log(line);
  if (pub && pub.url) {
    console.log('  【公网】   ' + String(pub.url).replace(/\/+$/, '') + '/');
    console.log('            方式：' + (pub.method || 'manual') + (pub.check && pub.check.attempted ? '（外网自检' + (pub.check.ok ? '通过' : '未通过') + '）' : ''));
    console.log('  【分享】   把这条深链发给朋友，打开会自动进入联机页并填好房间码：');
    console.log('            ' + joinDeepLink(pub.url));
  } else {
    console.log('  【公网】   未开启 / 不可用（' + (result && result.message ? result.message : info.state) + '）');
    console.log('  【局域网】 照常可用：把上面的「局域网」深链发给同一 WiFi 的朋友即可。');
    console.log('  【外网】   想要公网联机：安装 cloudflared 后重跑服务端（最简单），');
    console.log('            或打开路由器 UPnP 后执行 node server/server.js --tunnel=upnp；');
    console.log('            详细步骤见 server/README-联机.md 的「内置穿透」章节。');
    console.log('  【API】    GET /netinfo 可查看穿透状态，POST /tunnel/start 可手动重试。');
  }
  console.log(line);
}

function startTunnelOnBoot() {
  if (!TUNNEL) return;
  if (CONFIG.tunnelMode === 'off') {
    log('穿透未开启（--tunnel=off），仅本机 / 局域网可用。');
    return;
  }
  setTimeout(function () {
    TUNNEL.start({
      mode: CONFIG.tunnelMode,
      tool: CONFIG.tunnelTool || null,
      prefer: (CONFIG.tunnel && CONFIG.tunnel.prefer) || 'upnp'
    }).then(function (r) {
      printPublicBlock(r);
    }).catch(function (e) {
      log('穿透启动异常（已忽略）：' + (e && e.message ? e.message : e));
      printPublicBlock({ ok: false, message: '启动异常' });
    });
  }, 50);
}

TUNNEL = new TunnelManager({
  port: PORT,
  configPath: CONFIG_PATH,
  keepAlive: !!(CONFIG.tunnel && CONFIG.tunnel.keepAlive),
  writeConfig: true,
  frp: {
    configDir: __dirname,
    configFile: (CONFIG.tunnel.frp && CONFIG.tunnel.frp.configFile) || 'frpc.toml',
    autoFixLocalPort: !CONFIG.frpNoFix && !(CONFIG.tunnel.frp && CONFIG.tunnel.frp.autoFixLocalPort === false),
    publicHost: (CONFIG.tunnel.frp && CONFIG.tunnel.frp.publicHost) || '',
    publicPort: (CONFIG.tunnel.frp && CONFIG.tunnel.frp.publicPort) || 0,
    noFix: !!CONFIG.frpNoFix
  },
  onLog: function (line) { log(line); },
  onPublic: function (pub) {
    CONFIG.publicUrl = (pub && pub.url) ? String(pub.url).replace(/\/+$/, '') : (CONFIGURED_PUBLIC_URL || '');
  }
});

server.listen(PORT, HOST, function () {
  printBanner();
  log('服务已就绪：静态托管=' + ROOT + '，WebSocket=/ws，穿透模式=' + CONFIG.tunnelMode);
  startTunnelOnBoot();
});

/* ---------------------------- 退出清理 ---------------------------- */

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n收到 ' + signal + '，正在关闭服务端……');
  const force = setTimeout(function () { process.exit(0); }, 2500);
  const done = function () { clearTimeout(force); process.exit(0); };
  const closeAll = function () {
    for (const conn of connections) conn.terminate('server shutdown');
    server.close(function () { done(); });
    setTimeout(done, 800);
  };
  if (TUNNEL) {
    TUNNEL.stop('服务端退出').then(closeAll).catch(closeAll);
  } else {
    closeAll();
  }
}

process.on('SIGINT', function () { shutdown('Ctrl+C'); });
process.on('SIGTERM', function () { shutdown('SIGTERM'); });