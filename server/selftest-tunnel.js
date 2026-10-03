#!/usr/bin/env node
'use strict';
/*
 * ============================================================
 *  方块枪神 2D · 内置穿透自测脚本
 *  运行：node server/selftest-tunnel.js
 * ============================================================
 *  覆盖：
 *   0. node --check 语法检查
 *   1. 无 IGD：UPnP 快速失败 + NAT-PMP 回退，2 秒级优雅降级，不抛异常
 *   2. 假 SSDP + 假 IGD：controlURL 解析 + SOAP Add/DeletePortMapping XML
 *   3. 假 NAT-PMP 网关：RFC6886 外网 IP / 映射 TCP / 删除映射
 *   4. 假 cloudflared：PATH 检测 + URL 抓取 + config.json 写回
 *   5. 真实服务端：--tunnel=auto 降级日志 + /netinfo 结构 + /tunnel/start|stop API
 *  退出码：0 = 全部通过；1 = 有失败项
 * ============================================================
 */

const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SERVER_JS = path.join(ROOT, 'server.js');
const upnp = require('./upnp');
const tunnel = require('./tunnel');

let passed = 0;
let failed = 0;
const failedNames = [];

function section(title) { console.log('\n=== ' + title + ' ==='); }
function info(text) { console.log('  · ' + text); }
function check(name, condition, extra) {
  if (condition) {
    passed++;
    console.log('  [PASS] ' + name + (extra ? '  -> ' + extra : ''));
  } else {
    failed++;
    failedNames.push(name);
    console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : ''));
  }
}
function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

function freeTcpPort() {
  return new Promise(function (resolve, reject) {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', function () {
      const p = srv.address().port;
      srv.close(function () { resolve(p); });
    });
  });
}

function freeUdpPort() {
  return new Promise(function (resolve, reject) {
    const s = dgram.createSocket('udp4');
    s.once('error', reject);
    s.bind(0, '127.0.0.1', function () {
      const p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

function listenHttp(server) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () { resolve(server.address().port); });
  });
}

function closeHttp(server) {
  return new Promise(function (resolve) {
    try { server.close(function () { resolve(); }); } catch (e) { resolve(); }
  });
}

function httpRequest(opts) {
  return new Promise(function (resolve) {
    const req = http.request({
      host: opts.host || '127.0.0.1',
      port: opts.port || 80,
      path: opts.path || '/',
      method: opts.method || 'GET',
      headers: Object.assign({ 'Connection': 'close' }, opts.headers || {})
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch (e) {}
        resolve({ status: res.statusCode, body: body, json: json });
      });
    });
    req.setTimeout(opts.timeout || 3000, function () { try { req.destroy(new Error('timeout')); } catch (e) {} });
    req.on('error', function (e) { resolve({ status: 0, body: '', json: null, error: e.message }); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function waitFor(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let v = false;
    try { v = await fn(); } catch (e) {}
    if (v) return v;
    await wait(intervalMs || 100);
  }
  return false;
}

function soapEnvelope(action, serviceType, inner) {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
    '<u:' + action + 'Response xmlns:u="' + serviceType + '">' + inner + '</u:' + action + 'Response>' +
    '</s:Body></s:Envelope>';
}

function spawnServer(port, extraArgs, extraEnv) {
  const args = [SERVER_JS, '--port=' + port].concat(extraArgs || []);
  const env = Object.assign({}, process.env, extraEnv || {});
  const child = spawn(process.execPath, args, {
    cwd: PROJECT_ROOT,
    env: env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const state = { child: child, out: '' };
  child.stdout.on('data', function (d) {
    state.out += d.toString('utf8');
    process.stdout.write('[server:' + port + '] ' + d.toString('utf8').replace(/\n/g, '\n[server:' + port + '] '));
  });
  child.stderr.on('data', function (d) {
    state.out += d.toString('utf8');
    process.stdout.write('[server:' + port + ':err] ' + d.toString('utf8').replace(/\n/g, '\n[server:' + port + ':err] '));
  });
  return state;
}

async function stopServer(state) {
  if (!state || !state.child) return;
  try { state.child.kill(); } catch (e) {}
  await Promise.race([
    new Promise(function (resolve) { state.child.once('exit', resolve); }),
    wait(2500)
  ]);
}

(async function main() {
  const startedAll = Date.now();
  console.log('方块枪神 2D · 内置穿透自测');
  console.log('Node ' + process.version + ' / ' + process.platform + ' / ' + new Date().toISOString());

  /* ---------------------------------------------------------- */
  section('0. node --check 语法检查');
  for (const file of ['server.js', 'upnp.js', 'tunnel.js', 'selftest-tunnel.js']) {
    const full = path.join(ROOT, file);
    const r = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
    check('node --check ' + file, r.status === 0, (r.stderr || r.stdout || '').trim().split('\n')[0] || 'OK');
  }

  /* ---------------------------------------------------------- */
  section('1. 无 IGD：UPnP 快速失败 + NAT-PMP 回退（不抛异常、不卡死）');
  const deadUdp1 = await freeUdpPort();
  let discoverResult = null;
  let discoverErr = null;
  const tDiscover = Date.now();
  try {
    discoverResult = await upnp.discoverIGD({ address: '127.0.0.1', port: deadUdp1, timeoutMs: 1200 });
  } catch (e) { discoverErr = e; }
  const discoverMs = Date.now() - tDiscover;
  check('discoverIGD 无 IGD 时不抛异常、返回空数组', !discoverErr && Array.isArray(discoverResult) && discoverResult.length === 0,
    (discoverErr ? discoverErr.message : '空数组') + ' / ' + discoverMs + 'ms');
  check('discoverIGD 在 2 秒内返回（实测 ' + discoverMs + 'ms）', discoverMs <= 2000);

  const deadUdp2 = await freeUdpPort();
  let openResult = null;
  let openErr = null;
  const tOpen = Date.now();
  try {
    openResult = await upnp.openPortMapping({
      port: 45678,
      internalIp: '127.0.0.1',
      ssdp: { address: '127.0.0.1', port: deadUdp1 },
      ssdpTimeoutMs: 1200,
      gateways: ['127.0.0.1'],
      natpmpPort: deadUdp2,
      natpmpTimeoutMs: 600,
      selfCheck: false
    });
  } catch (e) { openErr = e; }
  const openMs = Date.now() - tOpen;
  check('openPortMapping 优雅返回 ok:false + errors[]', !openErr && openResult && openResult.ok === false && Array.isArray(openResult.errors) && openResult.errors.length >= 2,
    openErr ? openErr.message : (openResult && openResult.message || '').slice(0, 160));
  check('UPnP + NAT-PMP 总耗时 ' + openMs + 'ms < 2200ms', openMs < 2200, openMs + 'ms');

  /* ---------------------------------------------------------- */
  section('2. 假 SSDP + 假 IGD：controlURL 解析 + SOAP XML 构造');
  const soapCalls = [];
  const fakeIgd = http.createServer(function (req, res) {
    if (req.method === 'GET' && req.url === '/desc.xml') {
      const xml = '<?xml version="1.0"?>' +
        '<root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>' +
        '<device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>' +
        '<friendlyName>Fake IGD (selftest)</friendlyName><manufacturer>selftest</manufacturer><modelName>FakeRouter</modelName>' +
        '<deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType>' +
        '<deviceList><device><deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType>' +
        '<serviceList><service>' +
        '<serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>' +
        '<serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId>' +
        '<controlURL>/ctl</controlURL><eventSubURL>/evt</eventSubURL><SCPDURL>/scpd.xml</SCPDURL>' +
        '</service></serviceList></device></deviceList></device></deviceList></device></root>';
      res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
      res.end(xml);
      return;
    }
    if (req.method === 'POST' && req.url === '/ctl') {
      let body = '';
      req.on('data', function (c) { body += c; });
      req.on('end', function () {
        const action = String(req.headers.soapaction || '');
        soapCalls.push({ action: action, body: body });
        const st = 'urn:schemas-upnp-org:service:WANIPConnection:1';
        let xml;
        if (action.indexOf('GetExternalIPAddress') >= 0) {
          xml = soapEnvelope('GetExternalIPAddress', st, '<NewExternalIPAddress>203.0.113.9</NewExternalIPAddress>');
        } else if (action.indexOf('AddPortMapping') >= 0) {
          xml = soapEnvelope('AddPortMapping', st, '<NewLeaseDuration>7200</NewLeaseDuration>');
        } else if (action.indexOf('DeletePortMapping') >= 0) {
          xml = soapEnvelope('DeletePortMapping', st, '');
        } else {
          xml = soapEnvelope('Unknown', st, '');
        }
        res.writeHead(200, { 'Content-Type': 'text/xml; charset="utf-8"' });
        res.end(xml);
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  const fakeIgdPort = await listenHttp(fakeIgd);

  const fakeSsdp = dgram.createSocket('udp4');
  await new Promise(function (resolve) { fakeSsdp.bind(0, '127.0.0.1', resolve); });
  const fakeSsdpPort = fakeSsdp.address().port;
  fakeSsdp.on('message', function (msg, rinfo) {
    const text = msg.toString('utf8');
    if (!/^M-SEARCH/i.test(text)) return;
    const m = /^ST:\s*(.+?)\s*$/mi.exec(text);
    const st = m ? m[1] : 'urn:schemas-upnp-org:device:InternetGatewayDevice:1';
    const reply = 'HTTP/1.1 200 OK\r\n' +
      'CACHE-CONTROL: max-age=120\r\n' +
      'ST: ' + st + '\r\n' +
      'USN: uuid:selftest-igd::' + st + '\r\n' +
      'LOCATION: http://127.0.0.1:' + fakeIgdPort + '/desc.xml\r\n' +
      'SERVER: Selftest/1.0 UPnP/1.0 FakeIGD/1.0\r\n\r\n';
    fakeSsdp.send(Buffer.from(reply, 'utf8'), rinfo.port, rinfo.address);
  });

  let mapped = null;
  let mappedErr = null;
  try {
    mapped = await upnp.openPortMapping({
      port: 45678,
      internalPort: 45678,
      externalPort: 45678,
      internalIp: '127.0.0.1',
      description: 'Block Gunner 2D selftest',
      ssdp: { address: '127.0.0.1', port: fakeSsdpPort },
      ssdpTimeoutMs: 1500,
      enableNatpmp: false,
      selfCheck: false
    });
  } catch (e) { mappedErr = e; }
  const addCall = soapCalls.find(function (c) { return c.action.indexOf('AddPortMapping') >= 0; });
  check('假 SSDP 响应可被发现并解析出 IGD', !mappedErr && mapped && mapped.ok === true && mapped.method === 'upnp',
    mappedErr ? mappedErr.message : (mapped && mapped.controlUrl || ''));
  check('LOCATION -> 设备描述 -> controlURL 解析正确', mapped && /\/ctl$/.test(mapped.controlUrl || ''), mapped && mapped.controlUrl);
  check('SOAPAction 头正确（WANIPConnection#AddPortMapping）',
    !!addCall && addCall.action === '"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping"',
    addCall ? addCall.action : '未收到 AddPortMapping');
  check('AddPortMapping SOAP 参数正确（TCP / 内外端口 / 内网 IP / Enabled / Lease）',
    !!addCall &&
    /<NewExternalPort>45678<\/NewExternalPort>/.test(addCall.body) &&
    /<NewProtocol>TCP<\/NewProtocol>/.test(addCall.body) &&
    /<NewInternalPort>45678<\/NewInternalPort>/.test(addCall.body) &&
    /<NewInternalClient>127\.0\.0\.1<\/NewInternalClient>/.test(addCall.body) &&
    /<NewEnabled>1<\/NewEnabled>/.test(addCall.body) &&
    /<NewLeaseDuration>7200<\/NewLeaseDuration>/.test(addCall.body),
    addCall ? ('body ' + addCall.body.length + ' bytes') : '未收到');
  check('GetExternalIPAddress 解析出外网 IP 并拼出公网 URL',
    mapped && mapped.externalIp === '203.0.113.9' && mapped.url === 'http://203.0.113.9:45678',
    mapped ? (mapped.externalIp + ' / ' + mapped.url) : '');
  const soapEnv = upnp.buildSoapEnvelope('urn:x:service:Y:1', 'AddPortMapping', { NewRemoteHost: '', NewPortMappingDescription: 'A & B <test>' });
  check('SOAP XML 特殊字符正确转义', soapEnv.indexOf('A &amp; B &lt;test&gt;') >= 0, '');
  let closeMapped = null;
  try { closeMapped = await mapped.close(); } catch (e) {}
  const delCall = soapCalls.find(function (c) { return c.action.indexOf('DeletePortMapping') >= 0; });
  check('退出时 DeletePortMapping SOAP 正确发送',
    closeMapped && closeMapped.ok === true && !!delCall && /<NewExternalPort>45678<\/NewExternalPort>/.test(delCall.body),
    delCall ? delCall.action : '未收到 DeletePortMapping');
  fakeSsdp.close();
  await closeHttp(fakeIgd);

  /* ---------------------------------------------------------- */
  section('3. 假 NAT-PMP 网关（RFC6886）：外网 IP / 映射 TCP / 删除映射');
  const natSock = dgram.createSocket('udp4');
  await new Promise(function (resolve) { natSock.bind(0, '127.0.0.1', resolve); });
  const natPort = natSock.address().port;
  const natReqs = [];
  natSock.on('message', function (msg, rinfo) {
    const op = msg[1];
    const rec = { op: op, len: msg.length };
    if (op === 2 || op === 4) {
      rec.internalPort = msg.readUInt16BE(4);
      rec.externalPort = msg.readUInt16BE(6);
      if (op === 2) { rec.suggested = msg.readUInt16BE(6); rec.lifetime = msg.readUInt32BE(8); }
    }
    natReqs.push(rec);
    let res;
    if (op === 0) {
      res = Buffer.alloc(12);
      res[0] = 0; res[1] = 128; res.writeUInt16BE(0, 2); res.writeUInt32BE(1, 4);
      res[8] = 203; res[9] = 0; res[10] = 113; res[11] = 7;
    } else if (op === 2) {
      res = Buffer.alloc(16);
      res[0] = 0; res[1] = 130; res.writeUInt16BE(0, 2); res.writeUInt32BE(1, 4);
      res.writeUInt16BE(msg.readUInt16BE(4), 8);
      res.writeUInt16BE(45678, 10);
      res.writeUInt32BE(7200, 12);
    } else if (op === 4) {
      res = Buffer.alloc(8);
      res[0] = 0; res[1] = 132; res.writeUInt16BE(0, 2); res.writeUInt32BE(1, 4);
    } else {
      res = Buffer.alloc(8);
    }
    natSock.send(res, rinfo.port, rinfo.address);
  });
  let npResult = null;
  let npErr = null;
  try {
    npResult = await upnp.natpmp.mapTcp({
      gateway: '127.0.0.1',
      gatewayPort: natPort,
      internalPort: 45678,
      suggestedExternalPort: 45678,
      timeoutMs: 800
    });
  } catch (e) { npErr = e; }
  const mapReq = natReqs.find(function (r) { return r.op === 2; });
  check('NAT-PMP 映射成功且返回分配的外部端口', !npErr && npResult && npResult.ok === true && npResult.externalPort === 45678,
    npErr ? npErr.message : JSON.stringify(npResult && { ok: npResult.ok, externalPort: npResult.externalPort }));
  check('NAT-PMP 响应里的外网 IP 解析正确', npResult && npResult.externalIp === '203.0.113.7', npResult && npResult.externalIp);
  check('NAT-PMP Map TCP 请求字段正确（opcode2 / 内部端口 / 建议端口 / 租期）',
    !!mapReq && mapReq.internalPort === 45678 && mapReq.suggested === 45678 && mapReq.lifetime === 7200,
    JSON.stringify(mapReq || {}));
  let npClose = null;
  try { npClose = await npResult.close(); } catch (e) {}
  const delReq = natReqs.find(function (r) { return r.op === 4; });
  check('NAT-PMP Delete TCP 请求正确（opcode4 / 8 字节）', npClose && npClose.ok === true && !!delReq && delReq.len === 8 && delReq.externalPort === 45678,
    JSON.stringify(delReq || {}));
  natSock.close();

  /* ---------------------------------------------------------- */
  section('4. 假 cloudflared：PATH 检测 + URL 抓取 + config.json 写回');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg2d-tunnel-selftest-'));
  let fakeBin;
  if (process.platform === 'win32') {
    fakeBin = path.join(tmp, 'cloudflared.cmd');
    fs.writeFileSync(fakeBin, [
      '@echo off',
      'echo 2024-01-01 INF Requesting new quick Tunnel on trycloudflare.com...',
      'echo 2024-01-01 INF Your quick Tunnel has been created! Visit it at:',
      'echo https://fake.trycloudflare.com',
      'ping -n 30 127.0.0.1 >nul',
      ''
    ].join('\r\n'), 'utf8');
  } else {
    fakeBin = path.join(tmp, 'cloudflared');
    fs.writeFileSync(fakeBin, '#!/bin/sh\necho "2024-01-01 INF Your quick Tunnel has been created! Visit it at:"\necho "https://fake.trycloudflare.com"\nsleep 30\n', 'utf8');
    fs.chmodSync(fakeBin, 0o755);
  }
  const oldPath = process.env.PATH;
  process.env.PATH = tmp + path.delimiter + oldPath;
  const found = tunnel.findTool('cloudflared');
  check('PATH 中检测到假 cloudflared', !!found && path.resolve(found) === path.resolve(fakeBin), found || '未找到');
  const tmpCfg = path.join(tmp, 'config.json');
  fs.writeFileSync(tmpCfg, JSON.stringify({ port: 18080, publicUrl: '', tunnel: { auto: true, prefer: 'upnp', externalPort: 0, keepAlive: true } }, null, 2), 'utf8');
  const mgrLogs = [];
  const mgr = new tunnel.TunnelManager({
    port: 18080,
    configPath: tmpCfg,
    writeConfig: true,
    keepAlive: false,
    urlTimeoutMs: 8000,
    onLog: function (l) { mgrLogs.push(l); }
  });
  let tr = null;
  let trErr = null;
  try { tr = await mgr.start({ mode: 'auto', tool: 'cloudflared', prefer: 'upnp' }); } catch (e) { trErr = e; }
  check('假 cloudflared 启动并从输出抓到公网 URL',
    !trErr && tr && tr.ok === true && tr.url === 'https://fake.trycloudflare.com',
    trErr ? trErr.message : JSON.stringify(tr && { ok: tr.ok, url: tr.url, provider: tr.provider, state: tr.state }));
  let cfgAfter = null;
  try { cfgAfter = JSON.parse(fs.readFileSync(tmpCfg, 'utf8')); } catch (e) {}
  check('publicUrl 已写回 config.json', cfgAfter && cfgAfter.publicUrl === 'https://fake.trycloudflare.com', cfgAfter && cfgAfter.publicUrl);
  check('tunnel.provider 已写回为 cloudflared', cfgAfter && cfgAfter.tunnel && cfgAfter.tunnel.provider === 'cloudflared',
    cfgAfter && cfgAfter.tunnel && cfgAfter.tunnel.provider);
  const mgrStop = await mgr.stop('selftest');
  check('穿透管理器可正常停止', mgrStop && mgrStop.ok === true, JSON.stringify(mgrStop));
  process.env.PATH = oldPath;

  /* ---------------------------------------------------------- */
  section('5A. 真实服务端 --tunnel=auto：无 IGD 优雅降级 + 服务照常可用');
  const portA = await freeTcpPort();
  const serverA = spawnServer(portA, ['--tunnel=auto'], {
    BG_UPNP_TIMEOUT_MS: '1200',
    BG_NATPMP_TIMEOUT_MS: '600',
    BG_TUNNEL_URL_TIMEOUT_MS: '5000'
  });
  const tA = Date.now();
  const healthyA = await waitFor(async function () {
    const r = await httpRequest({ port: portA, path: '/healthz', timeout: 500 });
    return r.status === 200 && r.json && r.json.ok === true;
  }, 6000, 150);
  check('服务端照常启动（GET /healthz 200）', healthyA === true, 'port=' + portA + ' / ' + (Date.now() - tA) + 'ms');
  const degraded = await waitFor(function () {
    return /UPnP\/NAT-PMP 失败|未检测到 cloudflared|所有自动穿透方式都不可用/.test(serverA.out);
  }, 5000, 100);
  const degradeTotalMs = Date.now() - tA;
  const failMatch = /UPnP\/NAT-PMP 失败（(\d+)ms）/.exec(serverA.out);
  check('无 IGD 时输出清晰的降级日志', degraded === true, failMatch ? failMatch[0] : '已匹配降级关键字');
  check('UPnP/NAT-PMP 阶段在 2 秒级失败', !!failMatch && Number(failMatch[1]) <= 2200,
    failMatch ? failMatch[1] + 'ms' : '未找到耗时日志');
  check('整体降级（含 Node 启动）< 3s', degradeTotalMs <= 3000, degradeTotalMs + 'ms');
  check('启动横幅为三段式（本机 / 局域网 / 公网）',
    serverA.out.indexOf('【本机】') >= 0 && serverA.out.indexOf('【局域网】') >= 0 && serverA.out.indexOf('【公网】') >= 0, '');

  const niRes = await httpRequest({ port: portA, path: '/netinfo', timeout: 2000 });
  const ni = niRes.json;
  const niShapeOk = niRes.status === 200 && ni &&
    ni.port === portA &&
    Array.isArray(ni.lan) &&
    ni.lan.every(function (x) { return x && typeof x.ip === 'string' && /^http:\/\//.test(x.url); }) &&
    typeof ni.local === 'string' && /^http:\/\/127\.0\.0\.1:/.test(ni.local) &&
    (ni.public === null || (typeof ni.public === 'object' && 'url' in ni.public && 'method' in ni.public && 'ok' in ni.public)) &&
    ni.tunnel && typeof ni.tunnel.state === 'string' && Array.isArray(ni.tunnel.log);
  check('GET /netinfo 结构正确', niShapeOk === true,
    JSON.stringify({ port: ni && ni.port, lan: ni && ni.lan, local: ni && ni.local, public: ni && ni.public, state: ni && ni.tunnel && ni.tunnel.state, logLen: ni && ni.tunnel && ni.tunnel.log.length }).slice(0, 420));
  check('/netinfo.tunnel.log 包含穿透尝试日志',
    ni && ni.tunnel && Array.isArray(ni.tunnel.log) && ni.tunnel.log.some(function (l) { return /UPnP|NAT-PMP|cloudflared|穿透/.test(l); }),
    ni && ni.tunnel && ni.tunnel.log ? ('log ' + ni.tunnel.log.length + ' 条') : '');
  const badMethod = await httpRequest({ port: portA, path: '/tunnel/stop', method: 'GET', timeout: 1500 });
  check('GET /tunnel/stop 返回 405（只允许 POST）', badMethod.status === 405, 'status=' + badMethod.status);
  const stopApiA = await httpRequest({ port: portA, path: '/tunnel/stop', method: 'POST', timeout: 4000 });
  check('POST /tunnel/stop 可用', stopApiA.status === 200 && stopApiA.json && stopApiA.json.ok === true,
    JSON.stringify(stopApiA.json && { ok: stopApiA.json.ok, state: stopApiA.json.state }));
  await stopServer(serverA);

  /* ---------------------------------------------------------- */
  section('5B. 真实服务端 API：POST /tunnel/start 联动假 cloudflared + 写回 config');
  const realCfgPath = path.join(ROOT, 'config.json');
  const cfgBackup = fs.readFileSync(realCfgPath);
  let serverB = null;
  try {
    const portB = await freeTcpPort();
    serverB = spawnServer(portB, ['--tunnel=off', '--tunnel-tool=cloudflared'], {
      PATH: tmp + path.delimiter + process.env.PATH,
      BG_TUNNEL_URL_TIMEOUT_MS: '8000'
    });
    const healthyB = await waitFor(async function () {
      const r = await httpRequest({ port: portB, path: '/healthz', timeout: 500 });
      return r.status === 200 && r.json && r.json.ok === true;
    }, 6000, 150);
    check('--tunnel=off 启动后服务照常可用，不自动起穿透', healthyB === true && !/cloudflared 已就绪/.test(serverB.out), 'port=' + portB);

    const niBefore = (await httpRequest({ port: portB, path: '/netinfo', timeout: 2000 })).json;
    check('/netinfo 初始 public 为 null / state off', niBefore && niBefore.public === null && niBefore.tunnel && niBefore.tunnel.state === 'off',
      JSON.stringify(niBefore && { public: niBefore.public, state: niBefore.tunnel && niBefore.tunnel.state }));

    const startRes = await httpRequest({ port: portB, path: '/tunnel/start', method: 'POST', body: '{}', timeout: 12000, headers: { 'Content-Type': 'application/json' } });
    check('POST /tunnel/start 一键启动 cloudflared 并返回公网 URL',
      startRes.status === 200 && startRes.json && startRes.json.ok === true && startRes.json.url === 'https://fake.trycloudflare.com',
      JSON.stringify({ status: startRes.status, ok: startRes.json && startRes.json.ok, url: startRes.json && startRes.json.url }));
    const niAfter = (await httpRequest({ port: portB, path: '/netinfo', timeout: 2000 })).json;
    check('/netinfo.public 已更新为公网地址（provider=cloudflared, ok=true）',
      niAfter && niAfter.public && niAfter.public.url === 'https://fake.trycloudflare.com' && niAfter.public.method === 'cloudflared' && niAfter.public.ok === true,
      JSON.stringify(niAfter && niAfter.public));
    const cfgNow = JSON.parse(fs.readFileSync(realCfgPath, 'utf8'));
    check('穿透成功后自动写回 server/config.json 的 publicUrl', cfgNow.publicUrl === 'https://fake.trycloudflare.com', cfgNow.publicUrl);

    const stopResB = await httpRequest({ port: portB, path: '/tunnel/stop', method: 'POST', timeout: 5000 });
    check('POST /tunnel/stop 返回 ok', stopResB.status === 200 && stopResB.json && stopResB.json.ok === true, JSON.stringify(stopResB.json && { ok: stopResB.json.ok, state: stopResB.json.state }));
    const niStopped = (await httpRequest({ port: portB, path: '/netinfo', timeout: 2000 })).json;
    check('停止后 /netinfo.public 恢复为 null', niStopped && niStopped.public === null && niStopped.tunnel && niStopped.tunnel.state === 'stopped',
      JSON.stringify(niStopped && { public: niStopped.public, state: niStopped.tunnel && niStopped.tunnel.state }));
  } finally {
    fs.writeFileSync(realCfgPath, cfgBackup);
    await stopServer(serverB);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }

  /* ---------------------------------------------------------- */
  const totalMs = Date.now() - startedAll;
  console.log('\n============================================================');
  console.log('  自测结果：' + passed + ' 项通过，' + failed + ' 项失败，用时 ' + totalMs + 'ms');
  if (failed) console.log('  失败项：\n   - ' + failedNames.join('\n   - '));
  console.log('============================================================');
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error('\n[自测异常] ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});