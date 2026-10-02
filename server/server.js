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

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const SERVER_VERSION = '1.0.0';

/* ---------------------------- 配置读取 ---------------------------- */

const DEFAULT_CONFIG = {
  port: 8080,
  host: '0.0.0.0',
  maxPlayers: 6,
  maxRooms: 200,
  publicUrl: '',
  tunnel: { provider: 'none', note: '把公网地址填到 publicUrl' },
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
    if ((m = /^--(port|host|public-url|publicUrl|max-players|max-rooms)=(.*)$/.exec(a))) {
      out[m[1]] = m[2];
    } else if (a === '--port' || a === '--host' || a === '--public-url' || a === '--max-players' || a === '--max-rooms') {
      out[a.slice(2)] = argv[i + 1];
      i++;
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
    console.log('用法: node server.js [--port=8080] [--host=0.0.0.0] [--public-url=https://xxx] [--max-players=6] [--max-rooms=200]');
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
  return cfg;
}

const CONFIG = loadConfig();
const PORT = CONFIG.port;
const HOST = CONFIG.host;

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

function serveFile(req, res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600',
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

function printBanner() {
  const line = '='.repeat(62);
  const baseLocal = httpBase('127.0.0.1', PORT);
  const lan = lanAddresses();
  const out = [];
  out.push('');
  out.push(line);
  out.push('  方块枪神 2D · 联机服务端已启动  (Block Gunner 2D Server v' + SERVER_VERSION + ')');
  out.push(line);
  out.push('  本机访问 : ' + baseLocal + '/');
  out.push('  本机 WS  : ' + wsFromHttp(baseLocal));
  if (lan.length) {
    out.push('  局域网访问（同一 WiFi / 同一路由器）：');
    for (const it of lan) {
      const b = 'http://' + it.address + ':' + PORT;
      out.push('    [' + it.name + '] ' + b + '/       ' + wsFromHttp(b));
    }
  } else {
    out.push('  局域网访问 : 未检测到非回环 IPv4 网卡（请检查网络连接）');
  }
  if (CONFIG.publicUrl) {
    const p = CONFIG.publicUrl.replace(/\/+$/, '');
    out.push('  公网/穿透 : ' + p + '/');
    out.push('              ' + wsFromHttp(p));
    out.push('  分享给好友: ' + p + '/#join=房间码');
  } else {
    out.push('  公网/穿透 : 未配置（仅局域网可玩）');
    out.push('              需要外网联机请看 server/README-联机.md，');
    out.push('              并用 frp / ngrok / cloudflared 把 TCP ' + PORT + ' 穿透出去。');
  }
  out.push('  运行参数 : host=' + HOST + ' maxPlayers=' + CONFIG.maxPlayers + ' maxRooms=' + CONFIG.maxRooms +
    ' 心跳=空闲' + Math.round(CONFIG.heartbeat.idleMs / 1000) + 's/pong超时' + Math.round(CONFIG.heartbeat.pongTimeoutMs / 1000) + 's');
  out.push('');
  out.push('  【手机 / 其他电脑怎么连进来】');
  out.push('   1. 手机和电脑连同一个 Wi-Fi（同一路由器）；');
  out.push('   2. 手机浏览器打开上面任意一个「局域网访问」地址；');
  out.push('   3. 页面里进入「联机合作」：一台设备创建房间拿到 4 位房间码，');
  out.push('      其他设备输入房间码加入；房间码也可以直接拼在网址后面分享：');
  out.push('      http://<电脑IP>:' + PORT + '/#join=房间码');
  out.push('   4. 外网联机（不在同一 WiFi）：先用 frp / ngrok / cloudflared 穿透，');
  out.push('      把公网地址填进 server/config.json 的 publicUrl 后重启本服务。');
  out.push('');
  out.push('  【连不上先查这里】');
  out.push('   - Windows 首次启动弹出防火墙窗口时，勾选「专用网络 + 公用网络」并允许；');
  out.push('   - 仍然连不上：控制面板 → Windows Defender 防火墙 → 高级设置 →');
  out.push('     入站规则 → 新建规则 → 端口 → TCP ' + PORT + ' → 允许连接；');
  out.push('   - 能打开网页但进不了房间：WebSocket /ws 被拦截，检查代理、防火墙或穿透配置；');
  out.push('   - 只能本机访问：确认手机与电脑在同一网段（IP 前 3 段相同）。');
  out.push(line);
  out.push('');
  console.log(out.join('\n'));
  log('服务已就绪：静态托管=' + ROOT + '，WebSocket=/ws');
}

server.listen(PORT, HOST, function () {
  printBanner();
});

process.on('SIGINT', function () {
  console.log('\n收到 Ctrl+C，正在关闭服务端……');
  for (const conn of connections) conn.terminate('server shutdown');
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 500).unref();
});