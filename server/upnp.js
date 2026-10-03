#!/usr/bin/env node
'use strict';
/*
 * ============================================================
 *  方块枪神 2D · 内置内网穿透：UPnP IGD + NAT-PMP
 * ============================================================
 *  纯 Node 内置模块（dgram / http / https / os），零 npm 依赖。
 *
 *  用法：
 *    const upnp = require('./upnp');
 *    const r = await upnp.openPortMapping({ port: 8080 });
 *    if (r.ok) {
 *      console.log(r.url);       // 公网地址（有可能为 null）
 *      await r.close();          // 退出前删除端口映射
 *    }
 *
 *  能力：
 *    - SSDP M-SEARCH 发现 IGD（InternetGatewayDevice / WANIPConnection / WANPPPConnection）
 *    - 解析 LOCATION 设备描述，定位 WAN 连接服务的 controlURL
 *    - SOAP AddPortMapping / DeletePortMapping（TCP，外部端口 = 内部端口）
 *    - NAT-PMP（RFC6886，网关 UDP 5351）作为回退
 *    - 成功后做外部可达性自检；拿不到外网 IP 时也会返回映射成功 + 提示
 *    - 所有超时秒级，失败绝不抛异常、绝不卡死（最坏约 2 秒返回失败）
 * ============================================================
 */

const dgram = require('dgram');
const http = require('http');
const https = require('https');
const os = require('os');

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const NATPMP_PORT = 5351;
const USER_AGENT = 'BlockGunner2D/1.1 (UPnP; Node.js)';

const DEFAULT_SSDP_TIMEOUT_MS = envInt('BG_UPNP_TIMEOUT_MS', 1200);
const DEFAULT_NATPMP_TIMEOUT_MS = envInt('BG_NATPMP_TIMEOUT_MS', 500);
const DEFAULT_MAPPING_TIMEOUT_MS = envInt('BG_UPNP_MAPPING_TIMEOUT_MS', 1500);
const DEFAULT_SELF_CHECK_TIMEOUT_MS = envInt('BG_UPNP_CHECK_TIMEOUT_MS', 1200);
const DEFAULT_EXTERNAL_IP_TIMEOUT_MS = envInt('BG_UPNP_EXTERNAL_IP_TIMEOUT_MS', 800);

const SEARCH_TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
  'urn:schemas-upnp-org:service:WANPPPConnection:1'
];

/* ---------------------------- 小工具 ---------------------------- */

function envInt(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function debug() {
  if (process.env.BG_UPNP_DEBUG) {
    const args = Array.prototype.slice.call(arguments);
    console.log('[upnp:debug] ' + args.join(' '));
  }
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function escapeXml(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[<>&'"]/g, function (c) {
    if (c === '<') return '&lt;';
    if (c === '>') return '&gt;';
    if (c === '&') return '&amp;';
    if (c === "'") return '&apos;';
    return '&quot;';
  });
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
    .replace(/&#(\d+);/g, function (m, d) { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; } })
    .replace(/&amp;/g, '&');
}

/* 从 XML 中取第一个同名标签的文本（兼容命名空间前缀） */
function firstTag(xml, tag) {
  if (!xml) return null;
  let re;
  try {
    re = new RegExp('<(?:[A-Za-z0-9_]+:)?' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?' + tag + '>', 'i');
  } catch (e) {
    return null;
  }
  const m = re.exec(String(xml));
  return m ? decodeXmlEntities(m[1]).trim() : null;
}

function resolveUrl(ref, base) {
  try { return new URL(ref, base).toString(); } catch (e) { return null; }
}

function isIpv4(ip) {
  if (typeof ip !== 'string') return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  for (let i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
  return true;
}

function normalizeIp(value) {
  if (!value) return null;
  let s = String(value).trim().replace(/^\[|\]$/g, '');
  if (isIpv4(s)) return s;
  if (s.indexOf(':') >= 0 && /^[0-9a-f:.]+$/i.test(s)) return s;
  return null;
}

function isPrivateIPv4(ip) {
  if (!isIpv4(ip)) return false;
  const p = ip.split('.').map(Number);
  if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // 运营商 CGNAT
  if (p[0] >= 224) return true;
  return false;
}

function hostForUrl(ip) {
  return String(ip).indexOf(':') >= 0 ? '[' + ip + ']' : String(ip);
}

function localIPv4List() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      const family = info.family === 'IPv4' || info.family === 4;
      if (family && !info.internal && isIpv4(info.address)) out.push({ name: name, address: info.address });
    }
  }
  return out;
}

function primaryLocalIp() {
  const list = localIPv4List();
  return list.length ? list[0].address : '127.0.0.1';
}

/* ---------------------------- SSDP 发现 ---------------------------- */

function buildMSearch(searchTarget, mx) {
  const st = searchTarget || SEARCH_TARGETS[0];
  return 'M-SEARCH * HTTP/1.1\r\n' +
    'HOST: ' + SSDP_ADDRESS + ':' + SSDP_PORT + '\r\n' +
    'MAN: "ssdp:discover"\r\n' +
    'MX: ' + (mx || 1) + '\r\n' +
    'ST: ' + st + '\r\n' +
    'USER-AGENT: ' + USER_AGENT + '\r\n' +
    '\r\n';
}

/* 解析 SSDP 搜索响应，返回 { location, st, usn, server } 或 null */
function parseMSearchResponse(text) {
  if (!text || text.indexOf('HTTP/1.1 200') < 0 && text.indexOf('HTTP/1.0 200') < 0) return null;
  const headers = {};
  const lines = String(text).split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx <= 0) continue;
    const key = lines[i].slice(0, idx).trim().toLowerCase();
    const val = lines[i].slice(idx + 1).trim();
    if (key) headers[key] = val;
  }
  if (!headers.location) return null;
  return {
    location: headers.location,
    st: headers.st || '',
    usn: headers.usn || '',
    server: headers.server || '',
    raw: String(text).slice(0, 512)
  };
}

/*
 * SSDP 发现 IGD。
 * options: { address, port, timeoutMs, searchTargets, mx }
 * 返回 Promise<Array>（失败/超时返回空数组，绝不 reject）
 */
function discoverIGD(options) {
  const opts = options || {};
  const address = opts.address || SSDP_ADDRESS;
  const port = opts.port || SSDP_PORT;
  const timeoutMs = Math.max(300, Math.min(opts.timeoutMs || DEFAULT_SSDP_TIMEOUT_MS, 10000));
  const targets = (opts.searchTargets && opts.searchTargets.length) ? opts.searchTargets : SEARCH_TARGETS;
  return new Promise(function (resolve) {
    const found = new Map();
    let settled = false;
    let socket = null;
    let timer = null;
    function finish() {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket.close(); } catch (e) {}
      resolve(Array.from(found.values()));
    }
    try {
      socket = dgram.createSocket('udp4');
    } catch (e) {
      debug('创建 UDP socket 失败：' + e.message);
      resolve([]);
      return;
    }
    socket.on('error', function (err) { debug('SSDP socket 错误：' + err.message); finish(); });
    socket.on('message', function (msg) {
      const info = parseMSearchResponse(msg.toString('utf8'));
      if (info && info.location && !found.has(info.location)) {
        debug('发现 SSDP 响应 ' + info.location);
        found.set(info.location, info);
      }
    });
    // 兜底计时器：即使 bind 回调没有触发也能按时失败
    timer = setTimeout(finish, timeoutMs);
    try {
      socket.bind(0, function () {
        try { socket.setBroadcast(true); } catch (e) {}
        for (const st of targets) {
          const buf = Buffer.from(buildMSearch(st, opts.mx || 1), 'utf8');
          try {
            socket.send(buf, 0, buf.length, port, address, function (err) { if (err) debug('SSDP 发送失败：' + err.message); });
          } catch (e) { debug('SSDP 发送异常：' + e.message); }
        }
      });
    } catch (e) {
      debug('SSDP bind 失败：' + e.message);
      finish();
    }
  });
}

/* ---------------------------- 设备描述 / controlURL ---------------------------- */

/* 解析 IGD 设备描述 XML，提取 serviceType + controlURL（递归扫描所有 service 块） */
function parseDeviceDescription(xml, baseUrl) {
  const text = String(xml || '');
  const services = [];
  const re = /<(?:[A-Za-z0-9_]+:)?service\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?service>/gi;
  let m;
  while ((m = re.exec(text))) {
    const block = m[1];
    const serviceType = firstTag(block, 'serviceType');
    const controlURL = firstTag(block, 'controlURL');
    if (serviceType && controlURL) {
      const resolved = resolveUrl(controlURL, baseUrl);
      if (resolved) services.push({ serviceType: serviceType, controlURL: resolved });
    }
  }
  return {
    friendlyName: firstTag(text, 'friendlyName') || '',
    manufacturer: firstTag(text, 'manufacturer') || '',
    modelName: firstTag(text, 'modelName') || '',
    services: services,
    location: baseUrl
  };
}

/* 在设备描述里挑 WANIPConnection / WANPPPConnection 服务 */
function pickConnectionService(parsed) {
  const list = (parsed && parsed.services) || [];
  for (const wanted of ['WANIPConnection', 'WANPPPConnection']) {
    const hit = list.find(function (s) { return String(s.serviceType || '').indexOf(wanted) >= 0; });
    if (hit) return hit;
  }
  return null;
}

/* ---------------------------- HTTP 小工具 ---------------------------- */

function fetchText(url, timeoutMs, redirectsLeft) {
  const ms = Math.max(200, timeoutMs || 1000);
  return new Promise(function (resolve) {
    let settled = false;
    function finish(r) { if (settled) return; settled = true; resolve(r); }
    let u;
    try { u = new URL(url); } catch (e) { finish({ ok: false, error: 'URL 无效：' + url }); return; }
    const mod = u.protocol === 'https:' ? https : (u.protocol === 'http:' ? http : null);
    if (!mod) { finish({ ok: false, error: '不支持的协议：' + u.protocol }); return; }
    let req;
    try {
      req = mod.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: (u.pathname || '/') + (u.search || ''),
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*', 'Connection': 'close' }
      }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (redirectsLeft === undefined ? 2 : redirectsLeft) > 0) {
          res.resume();
          const next = resolveUrl(res.headers.location, url);
          if (!next) { finish({ ok: false, error: '重定向地址无效' }); return; }
          fetchText(next, ms, (redirectsLeft === undefined ? 2 : redirectsLeft) - 1).then(finish);
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', function (c) { size += c.length; if (size <= 300 * 1024) chunks.push(c); });
        res.on('end', function () {
          finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', function (e) { finish({ ok: false, error: e.message }); });
      });
    } catch (e) { finish({ ok: false, error: e.message }); return; }
    req.setTimeout(ms, function () { try { req.destroy(new Error('请求超时')); } catch (e) {} });
    req.on('error', function (e) { finish({ ok: false, error: e.message }); });
    req.end();
  });
}

/* ---------------------------- SOAP ---------------------------- */

function buildSoapEnvelope(serviceType, action, args) {
  let inner = '';
  const a = args || {};
  for (const key of Object.keys(a)) inner += '<' + key + '>' + escapeXml(a[key]) + '</' + key + '>';
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    '<s:Body>' +
    '<u:' + action + ' xmlns:u="' + escapeXml(serviceType) + '">' + inner + '</u:' + action + '>' +
    '</s:Body></s:Envelope>';
}

/* 向 controlURL 发 SOAP POST；永远 resolve，不 reject */
function soapRequest(controlUrl, serviceType, action, args, timeoutMs) {
  const ms = Math.max(200, timeoutMs || 1000);
  return new Promise(function (resolve) {
    let settled = false;
    function finish(r) { if (settled) return; settled = true; resolve(r); }
    let u;
    try { u = new URL(controlUrl); } catch (e) { finish({ ok: false, error: 'controlURL 无效：' + controlUrl }); return; }
    const mod = u.protocol === 'https:' ? https : (u.protocol === 'http:' ? http : null);
    if (!mod) { finish({ ok: false, error: 'controlURL 协议不支持：' + u.protocol }); return; }
    const body = buildSoapEnvelope(serviceType, action, args);
    let req;
    try {
      req = mod.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: (u.pathname || '/') + (u.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'SOAPAction': '"' + serviceType + '#' + action + '"',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': USER_AGENT,
          'Connection': 'close'
        }
      }, function (res) {
        const chunks = [];
        let size = 0;
        res.on('data', function (c) { size += c.length; if (size <= 200 * 1024) chunks.push(c); });
        res.on('end', function () {
          const text = Buffer.concat(chunks).toString('utf8');
          const codeRaw = firstTag(text, 'errorCode');
          const errorCode = codeRaw !== null ? parseInt(codeRaw, 10) : null;
          const hasUpnpError = /<(?:[A-Za-z0-9_]+:)?UPnPError\b/i.test(text) || Number.isFinite(errorCode);
          const httpOk = res.statusCode >= 200 && res.statusCode < 300;
          let error = null;
          if (hasUpnpError) error = 'UPnP 错误 ' + (Number.isFinite(errorCode) ? errorCode : '') + ' ' + (firstTag(text, 'errorDescription') || '');
          else if (!httpOk) error = 'HTTP ' + res.statusCode;
          finish({
            ok: httpOk && !hasUpnpError,
            status: res.statusCode || 0,
            body: text,
            errorCode: Number.isFinite(errorCode) ? errorCode : null,
            errorDescription: firstTag(text, 'errorDescription') || null,
            error: error ? error.trim() : null
          });
        });
        res.on('error', function (e) { finish({ ok: false, error: e.message }); });
      });
    } catch (e) { finish({ ok: false, error: e.message }); return; }
    req.setTimeout(ms, function () { try { req.destroy(new Error('请求超时')); } catch (e) {} });
    req.on('error', function (e) { finish({ ok: false, error: e.message }); });
    try { req.end(body); } catch (e) { finish({ ok: false, error: e.message }); }
  });
}

/* ---------------------------- 外网 IP / 自检 ---------------------------- */

function queryExternalIp(timeoutMs) {
  const endpoints = ['http://api.ipify.org', 'http://checkip.amazonaws.com'];
  const deadline = Date.now() + Math.max(300, timeoutMs || DEFAULT_EXTERNAL_IP_TIMEOUT_MS);
  return (async function () {
    for (const url of endpoints) {
      const remain = deadline - Date.now();
      if (remain <= 120) break;
      const r = await fetchText(url, Math.min(remain, 700));
      if (r.ok) {
        const ip = normalizeIp(String(r.body || '').trim().split(/\s+/)[0]);
        if (ip && !isPrivateIPv4(ip)) return ip;
      }
    }
    return null;
  })();
}

/* 访问 http://<外网IP>:<端口>/healthz 自检；拿不到外网 IP 时返回 attempted:false 的提示 */
function selfCheckExternal(baseUrl, timeoutMs) {
  const url = String(baseUrl).replace(/\/+$/, '') + '/healthz';
  return fetchText(url, timeoutMs || DEFAULT_SELF_CHECK_TIMEOUT_MS).then(function (r) {
    if (r.ok && r.status === 200) {
      return { attempted: true, ok: true, status: r.status, url: url, detail: '外网地址自检成功（http://<外网IP>:<端口>/healthz 已可访问）' };
    }
    return {
      attempted: true, ok: false, status: r.status || 0, url: url,
      detail: '端口映射已建立，但从内网访问外网地址失败（可能是路由器不支持 NAT 回环；请用手机流量打开地址验证）',
      error: r.error || null
    };
  }).catch(function (e) {
    return { attempted: true, ok: false, status: 0, url: url, detail: '自检异常：' + e.message };
  });
}

/* ---------------------------- UPnP AddPortMapping ---------------------------- */

/* 只做 UPnP（不碰 NAT-PMP）。返回统一结构，永不 reject。 */
async function addUpnpMapping(options) {
  const opts = options || {};
  const internalPort = parseInt(opts.internalPort || opts.port, 10) || 8080;
  const externalPort = parseInt(opts.externalPort, 10) || internalPort;
  const internalIp = String(opts.internalIp || primaryLocalIp());
  const leaseSeconds = Number.isFinite(Number(opts.leaseSeconds)) ? Number(opts.leaseSeconds) : 7200;
  const description = String(opts.description || 'Block Gunner 2D');
  const ssdpTimeoutMs = Math.max(300, Math.min(opts.ssdpTimeoutMs || DEFAULT_SSDP_TIMEOUT_MS, 10000));
  const mappingTimeoutMs = Math.max(200, opts.mappingTimeoutMs || DEFAULT_MAPPING_TIMEOUT_MS);

  const devices = await discoverIGD({
    address: opts.ssdp && opts.ssdp.address,
    port: opts.ssdp && opts.ssdp.port,
    timeoutMs: ssdpTimeoutMs,
    searchTargets: opts.searchTargets
  }).catch(function () { return []; });

  if (!devices.length) {
    return {
      ok: false, method: 'upnp', stage: 'discover',
      error: '未发现 IGD（' + Math.round(ssdpTimeoutMs) + 'ms 内没有 SSDP 响应）。常见原因：路由器没开 UPnP、光猫桥接、公司/校园网或运营商 CGNAT。'
    };
  }

  let lastError = '没有可用的 WANIPConnection / WANPPPConnection 服务';
  for (const device of devices) {
    const page = await fetchText(device.location, Math.min(mappingTimeoutMs, 1500));
    if (!page.ok || !page.body) {
      lastError = '读取 IGD 描述失败：' + (page.error || 'HTTP ' + page.status);
      continue;
    }
    const parsed = parseDeviceDescription(page.body, device.location);
    const service = pickConnectionService(parsed);
    if (!service) {
      lastError = 'IGD 描述中没有 WANIPConnection/WANPPPConnection 服务';
      continue;
    }

    const args = {
      NewRemoteHost: '',
      NewExternalPort: String(externalPort),
      NewProtocol: 'TCP',
      NewInternalPort: String(internalPort),
      NewInternalClient: internalIp,
      NewEnabled: '1',
      NewPortMappingDescription: description,
      NewLeaseDuration: String(leaseSeconds)
    };
    let added = await soapRequest(service.controlURL, service.serviceType, 'AddPortMapping', args, mappingTimeoutMs);
    if (!added.ok && added.errorCode === 725 && leaseSeconds !== 0) {
      // 有些路由器只支持永久租约
      debug('IGD 仅支持永久租约（725），改用 NewLeaseDuration=0 重试');
      args.NewLeaseDuration = '0';
      added = await soapRequest(service.controlURL, service.serviceType, 'AddPortMapping', args, mappingTimeoutMs);
    }
    if (!added.ok) {
      lastError = added.error || ('AddPortMapping 失败（HTTP ' + added.status + '）');
      continue;
    }

    let externalIp = null;
    const ipRes = await soapRequest(service.controlURL, service.serviceType, 'GetExternalIPAddress', {}, Math.min(mappingTimeoutMs, 1200));
    if (ipRes.ok && ipRes.body) externalIp = normalizeIp(firstTag(ipRes.body, 'NewExternalIPAddress'));
    if (!externalIp) externalIp = await queryExternalIp(Math.min(opts.externalIpTimeoutMs || DEFAULT_EXTERNAL_IP_TIMEOUT_MS, 800));

    let closed = false;
    const result = {
      ok: true,
      method: 'upnp',
      message: 'UPnP AddPortMapping 成功',
      controlUrl: service.controlURL,
      serviceType: service.serviceType,
      friendlyName: parsed.friendlyName || device.server || '',
      internalIp: internalIp,
      internalPort: internalPort,
      externalPort: externalPort,
      externalIp: externalIp,
      url: externalIp ? ('http://' + hostForUrl(externalIp) + ':' + externalPort) : null,
      close: async function () {
        if (closed) return { ok: true, alreadyClosed: true };
        closed = true;
        const del = await soapRequest(service.controlURL, service.serviceType, 'DeletePortMapping', {
          NewRemoteHost: '',
          NewExternalPort: String(externalPort),
          NewProtocol: 'TCP'
        }, 1000);
        return { ok: del.ok, error: del.error || null };
      }
    };
    return result;
  }

  return { ok: false, method: 'upnp', stage: 'control', error: lastError };
}

/* ---------------------------- NAT-PMP（RFC6886） ---------------------------- */

function buildExternalAddressRequest() {
  return Buffer.from([0, 0, 0, 0]); // version=0, opcode=0(External IP), reserved
}

function buildMapTcpRequest(internalPort, suggestedExternalPort, lifetimeSeconds) {
  const buf = Buffer.alloc(12);
  buf[0] = 0; // version
  buf[1] = 2; // opcode 2 = map TCP
  buf.writeUInt16BE(0, 2); // reserved
  buf.writeUInt16BE(internalPort & 0xffff, 4);
  buf.writeUInt16BE(suggestedExternalPort & 0xffff, 6);
  buf.writeUInt32BE(lifetimeSeconds >>> 0, 8);
  return buf;
}

function buildDeleteTcpRequest(internalPort, externalPort) {
  const buf = Buffer.alloc(8);
  buf[0] = 0; // version
  buf[1] = 4; // opcode 4 = delete TCP mapping
  buf.writeUInt16BE(0, 2); // reserved
  buf.writeUInt16BE(internalPort & 0xffff, 4);
  buf.writeUInt16BE(externalPort & 0xffff, 6);
  return buf;
}

function ipBytesToString(buf, offset) {
  return buf[offset] + '.' + buf[offset + 1] + '.' + buf[offset + 2] + '.' + buf[offset + 3];
}

/* 向一个网关做一次完整 NAT-PMP 流程（外网 IP → 映射 TCP），超时后优雅返回失败 */
function tryNatpmpOne(gateway, gatewayPort, internalPort, suggestedExternalPort, lifetimeSeconds, timeoutMs) {
  return new Promise(function (resolve) {
    const socket = dgram.createSocket('udp4');
    const deadline = Date.now() + Math.max(200, timeoutMs || DEFAULT_NATPMP_TIMEOUT_MS);
    let stage = 'external';
    let externalIp = null;
    let settled = false;
    let timer = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { socket.removeAllListeners(); } catch (e) {}
      try { socket.close(); } catch (e) {}
      resolve(result);
    }

    function arm() {
      if (timer) clearTimeout(timer);
      const remain = Math.max(100, deadline - Date.now());
      timer = setTimeout(function () {
        finish({ ok: false, error: 'NAT-PMP 网关 ' + gateway + ' 无响应（超时）' });
      }, remain);
    }

    function send(buf) {
      try {
        socket.send(buf, 0, buf.length, gatewayPort, gateway, function (err) {
          if (err) finish({ ok: false, error: 'NAT-PMP 发送失败：' + err.message });
        });
      } catch (e) {
        finish({ ok: false, error: 'NAT-PMP 发送异常：' + e.message });
      }
    }

    socket.on('error', function (err) { finish({ ok: false, error: 'NAT-PMP 套接字错误：' + err.message }); });

    socket.on('message', function (msg) {
      if (!msg || msg.length < 4 || msg[0] !== 0) return;
      const opcode = msg[1];
      const resultCode = msg.readUInt16BE(2);
      if (stage === 'external') {
        if (opcode !== 128) return;
        if (resultCode !== 0) { finish({ ok: false, error: '网关不支持 NAT-PMP（错误码 ' + resultCode + '）' }); return; }
        if (msg.length >= 12) externalIp = ipBytesToString(msg, 8);
        stage = 'map';
        arm();
        send(buildMapTcpRequest(internalPort, suggestedExternalPort, lifetimeSeconds));
        return;
      }
      if (stage === 'map') {
        if (opcode !== 130) return;
        if (resultCode !== 0) { finish({ ok: false, error: 'NAT-PMP 映射失败（错误码 ' + resultCode + '）' }); return; }
        if (msg.length < 16) { finish({ ok: false, error: 'NAT-PMP 响应长度异常' }); return; }
        const mappedInternal = msg.readUInt16BE(8);
        const mappedExternal = msg.readUInt16BE(10);
        const mappedLifetime = msg.readUInt32BE(12);
        finish({
          ok: true,
          method: 'natpmp',
          message: 'NAT-PMP 端口映射成功',
          gateway: gateway,
          internalIp: primaryLocalIp(),
          internalPort: mappedInternal || internalPort,
          externalPort: mappedExternal || internalPort,
          externalIp: normalizeIp(externalIp),
          lifetime: mappedLifetime,
          url: externalIp ? ('http://' + hostForUrl(externalIp) + ':' + (mappedExternal || internalPort)) : null,
          close: async function () {
            return await deleteNatpmpMapping(gateway, gatewayPort, mappedInternal || internalPort, mappedExternal || internalPort, 800);
          }
        });
        return;
      }
    });

    try {
      socket.bind(0, function () {
        if (settled) return;
        arm();
        send(buildExternalAddressRequest());
      });
    } catch (e) {
      finish({ ok: false, error: 'NAT-PMP bind 失败：' + e.message });
    }
  });
}

function deleteNatpmpMapping(gateway, gatewayPort, internalPort, externalPort, timeoutMs) {
  return new Promise(function (resolve) {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const timer = setTimeout(function () { finish({ ok: false, error: '删除映射响应超时' }); }, Math.max(200, timeoutMs || 800));
    function finish(r) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch (e) {}
      resolve(r);
    }
    socket.on('error', function (e) { finish({ ok: false, error: e.message }); });
    socket.on('message', function (msg) {
      if (msg && msg.length >= 4 && msg[1] === 132) {
        if (msg.readUInt16BE(2) === 0) finish({ ok: true });
        else finish({ ok: false, error: '删除失败（错误码 ' + msg.readUInt16BE(2) + '）' });
      }
    });
    try {
      socket.bind(0, function () {
        if (settled) return;
        const req = buildDeleteTcpRequest(internalPort, externalPort);
        try {
          socket.send(req, 0, req.length, gatewayPort, gateway, function (err) { if (err) finish({ ok: false, error: err.message }); });
        } catch (e) { finish({ ok: false, error: e.message }); }
      });
    } catch (e) { finish({ ok: false, error: e.message }); }
  });
}

/* 推断默认网关候选（NAT-PMP 用）。可用 BG_NATPMP_GATEWAYS=1.2.3.4,5.6.7.8 覆盖。 */
function candidateGateways() {
  const env = String(process.env.BG_NATPMP_GATEWAYS || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (env.length) return env;
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      const family = info.family === 'IPv4' || info.family === 4;
      if (!family || info.internal || !isIpv4(info.address)) continue;
      const parts = String(info.address).split('.');
      const base = parts.slice(0, 3).join('.');
      for (const last of ['1', '254', '2', '253']) {
        const gw = base + '.' + last;
        if (gw !== info.address && out.indexOf(gw) < 0) out.push(gw);
      }
    }
  }
  if (out.length) {
    for (const gw of ['192.168.1.1', '192.168.0.1']) if (out.indexOf(gw) < 0) out.push(gw);
  }
  return out.slice(0, 8);
}

/*
 * NAT-PMP 映射 TCP 端口。
 * options: { gateway, gateways:[], gatewayPort/port, internalPort, suggestedExternalPort/externalPort, lifetimeSeconds, timeoutMs }
 * 多个候选网关并行探测，先成功者胜；总超时 timeoutMs（默认 500ms）。
 */
function mapTcp(options) {
  const opts = options || {};
  const internalPort = parseInt(opts.internalPort || opts.localPort, 10) || 8080;
  const suggested = parseInt(opts.suggestedExternalPort || opts.externalPort, 10) || 0;
  const lifetimeSeconds = Number.isFinite(Number(opts.lifetimeSeconds)) ? Number(opts.lifetimeSeconds) : 7200;
  const gatewayPort = parseInt(opts.gatewayPort || opts.port, 10) || NATPMP_PORT;
  const timeoutMs = Math.max(200, Math.min(opts.timeoutMs || DEFAULT_NATPMP_TIMEOUT_MS, 5000));
  const gateways = (opts.gateway ? [opts.gateway] : (opts.gateways && opts.gateways.length ? opts.gateways.slice() : candidateGateways())).filter(Boolean);

  return new Promise(function (resolve) {
    if (!gateways.length) {
      resolve({ ok: false, method: 'natpmp', error: '无法推断默认网关地址（NAT-PMP 需要网关 IP）' });
      return;
    }
    let settled = false;
    let pending = gateways.length;
    const errors = [];
    const totalTimer = setTimeout(function () {
      finish({ ok: false, method: 'natpmp', error: 'NAT-PMP 总超时：网关 ' + gateways.join('/') + ' 均无响应' });
    }, timeoutMs);
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      resolve(result);
    }
    gateways.forEach(function (gw) {
      tryNatpmpOne(gw, gatewayPort, internalPort, suggested, lifetimeSeconds, timeoutMs).then(function (r) {
        if (r && r.ok) { finish(r); return; }
        errors.push(gw + ': ' + ((r && r.error) || '失败'));
        pending--;
        if (pending === 0) finish({ ok: false, method: 'natpmp', error: errors.join('；') });
      }).catch(function (e) {
        errors.push(gw + ': ' + e.message);
        pending--;
        if (pending === 0) finish({ ok: false, method: 'natpmp', error: errors.join('；') });
      });
    });
  });
}

/* ---------------------------- 对外主入口 ---------------------------- */

function finalizeResult(result, opts) {
  const port = parseInt(opts.port, 10) || 8080;
  // 拿不到外网 IP 时，至少保证结构完整 + 清晰提示
  if (!result.close) result.close = async function () { return { ok: true }; };

  if (result.externalIp && isPrivateIPv4(result.externalIp)) {
    result.url = null;
    result.check = {
      attempted: false, ok: false,
      detail: '网关返回的外网 IP 是内网/运营商 NAT 地址（' + result.externalIp + '），公网可能无法直连；建议改用 cloudflared / ngrok 穿透。'
    };
    return Promise.resolve(result);
  }

  if (opts.selfCheck === false) return Promise.resolve(result);

  if (result.url) {
    return selfCheckExternal(result.url, opts.selfCheckTimeoutMs).then(function (check) {
      result.check = check;
      return result;
    });
  }
  result.check = {
    attempted: false, ok: false,
    detail: '端口映射已成功，但没取到外网 IP，无法自动自检；请用手机流量访问 http://<路由器 WAN IP>:' + (result.externalPort || port) + '/ 验证。'
  };
  return Promise.resolve(result);
}

/*
 * 一站式端口映射：先 UPnP，失败自动降级 NAT-PMP。
 * options:
 *   port / internalPort / externalPort / internalIp / description / leaseSeconds
 *   ssdpTimeoutMs / mappingTimeoutMs / selfCheck / selfCheckTimeoutMs / externalIpTimeoutMs
 *   enableNatpmp / ssdp:{address,port} / gateways / natpmpPort / natpmpTimeoutMs
 * 返回：
 *   { ok, method:'upnp'|'natpmp'|'none', url, externalIp, externalPort, internalIp, internalPort,
 *     check:{attempted,ok,detail}, errors:[{method,message}], close:async() }
 * 绝不抛异常、绝不卡死。
 */
async function openPortMapping(options) {
  const opts = Object.assign({
    port: 8080,
    internalPort: 0,
    externalPort: 0,
    internalIp: '',
    description: 'Block Gunner 2D',
    leaseSeconds: 7200,
    ssdpTimeoutMs: DEFAULT_SSDP_TIMEOUT_MS,
    mappingTimeoutMs: DEFAULT_MAPPING_TIMEOUT_MS,
    natpmpTimeoutMs: DEFAULT_NATPMP_TIMEOUT_MS,
    selfCheck: true,
    selfCheckTimeoutMs: DEFAULT_SELF_CHECK_TIMEOUT_MS,
    externalIpTimeoutMs: DEFAULT_EXTERNAL_IP_TIMEOUT_MS,
    enableNatpmp: true,
    ssdp: null,
    gateways: null,
    natpmpPort: NATPMP_PORT
  }, options || {});

  const internalPort = parseInt(opts.internalPort || opts.port, 10) || 8080;
  const externalPort = parseInt(opts.externalPort, 10) || internalPort;
  const errors = [];

  // 1) UPnP
  let upnpResult = null;
  try {
    upnpResult = await addUpnpMapping({
      port: opts.port,
      internalPort: internalPort,
      externalPort: externalPort,
      internalIp: opts.internalIp,
      description: opts.description,
      leaseSeconds: opts.leaseSeconds,
      ssdpTimeoutMs: opts.ssdpTimeoutMs,
      mappingTimeoutMs: opts.mappingTimeoutMs,
      externalIpTimeoutMs: opts.externalIpTimeoutMs,
      ssdp: opts.ssdp,
      searchTargets: opts.searchTargets
    });
  } catch (e) {
    upnpResult = { ok: false, method: 'upnp', error: e && e.message ? e.message : String(e) };
  }
  if (upnpResult && upnpResult.ok) return finalizeResult(upnpResult, opts);
  if (upnpResult && upnpResult.error) errors.push({ method: 'upnp', message: upnpResult.error });
  debug('UPnP 失败：' + (upnpResult && upnpResult.error));

  // 2) NAT-PMP 回退
  if (opts.enableNatpmp !== false) {
    let natResult = null;
    try {
      natResult = await mapTcp({
        gateway: opts.gateway,
        gateways: opts.gateways,
        gatewayPort: opts.natpmpPort,
        internalPort: internalPort,
        suggestedExternalPort: externalPort,
        lifetimeSeconds: opts.leaseSeconds,
        timeoutMs: opts.natpmpTimeoutMs
      });
    } catch (e) {
      natResult = { ok: false, method: 'natpmp', error: e && e.message ? e.message : String(e) };
    }
    if (natResult && natResult.ok) return finalizeResult(natResult, opts);
    if (natResult && natResult.error) errors.push({ method: 'natpmp', message: natResult.error });
    debug('NAT-PMP 失败：' + (natResult && natResult.error));
  }

  return {
    ok: false,
    method: 'none',
    url: null,
    externalIp: null,
    externalPort: externalPort,
    internalIp: String(opts.internalIp || primaryLocalIp()),
    internalPort: internalPort,
    errors: errors,
    message: errors.length
      ? 'UPnP / NAT-PMP 自动端口映射失败：' + errors.map(function (e) { return e.method + ' — ' + e.message; }).join('；')
      : 'UPnP / NAT-PMP 自动端口映射失败',
    check: { attempted: false, ok: false, detail: '未建立映射' },
    close: async function () { return { ok: true }; }
  };
}

module.exports = {
  SSDP_ADDRESS: SSDP_ADDRESS,
  SSDP_PORT: SSDP_PORT,
  NATPMP_PORT: NATPMP_PORT,
  SEARCH_TARGETS: SEARCH_TARGETS,
  buildMSearch: buildMSearch,
  parseMSearchResponse: parseMSearchResponse,
  discoverIGD: discoverIGD,
  parseDeviceDescription: parseDeviceDescription,
  pickConnectionService: pickConnectionService,
  buildSoapEnvelope: buildSoapEnvelope,
  soapRequest: soapRequest,
  addUpnpMapping: addUpnpMapping,
  openPortMapping: openPortMapping,
  natpmp: {
    candidateGateways: candidateGateways,
    buildExternalAddressRequest: buildExternalAddressRequest,
    buildMapTcpRequest: buildMapTcpRequest,
    buildDeleteTcpRequest: buildDeleteTcpRequest,
    mapTcp: mapTcp,
    deleteMapping: deleteNatpmpMapping
  },
  fetchText: fetchText,
  selfCheckExternal: selfCheckExternal,
  queryExternalIp: queryExternalIp,
  isPrivateIPv4: isPrivateIPv4,
  primaryLocalIp: primaryLocalIp
};