'use strict';
/* ============================================================
   端到端：真实 server + 两个无头 Edge（真实 js/net.js + ui.js + game.js）
   流程：host 建房 -> client 加入 -> host 开局 -> 双方 Game.state()==='playing'
   附加：file:// 打开时 Net.available()===false 且无报错
   用法：node tests/e2e-coop.js     （只写 tests/，用完杀进程）
   ============================================================ */
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(id, name, cond, detail){
  results.push({ id, name, status: cond ? 'PASS' : 'FAIL', detail: detail === undefined ? '' : String(detail) });
  console.log('[' + (cond ? 'PASS' : 'FAIL') + '] ' + id + ' ' + name + (detail !== undefined ? '  -> ' + detail : ''));
}
function freePort(){
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function httpGet(url){
  return new Promise((resolve, reject) => {
    const req = http.get(url, res => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('http timeout')));
  });
}
function killTree(child){
  try { if (child && child.pid) cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e){}
}
function rmrf(p){ try { fs.rmSync(p, { recursive: true, force: true }); } catch (e){} }
async function waitFor(fn, timeout, interval, label){
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end){
    try { last = await fn(); if (last) return last; } catch (e){ last = e.message; }
    await sleep(interval || 250);
  }
  throw new Error('等待超时: ' + label + (last ? ('（最后: ' + JSON.stringify(last) + '）') : ''));
}
function openCDP(wsUrl){
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map(); let seq = 0; let settled = false;
    const to = setTimeout(() => { if (!settled){ settled = true; reject(new Error('CDP 连接超时')); } }, 15000);
    const api = {
      send(method, params){
        return new Promise((res, rej) => {
          const id = ++seq;
          const t = setTimeout(() => { if (pending.has(id)){ pending.delete(id); rej(new Error('CDP ' + method + ' 超时')); } }, 20000);
          pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
          ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
      },
      close(){ try { ws.close(); } catch (e){} }
    };
    ws.onopen = () => { if (!settled){ settled = true; clearTimeout(to); resolve(api); } };
    ws.onerror = () => { if (!settled){ settled = true; clearTimeout(to); reject(new Error('CDP WebSocket 失败')); } };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e){ return; }
      if (m && m.id && pending.has(m.id)){
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.rej(new Error('CDP error: ' + JSON.stringify(m.error))); else p.res(m.result);
      }
    };
  });
}
async function evalExpr(cdp, expr){
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r && r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r && r.result ? r.result.value : undefined;
}
async function launchEdge(url, label){
  if (!fs.existsSync(EDGE)) throw new Error('未找到 Edge: ' + EDGE);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg2d-e2e-' + label + '-'));
  const pf = path.join(tmp, 'DevToolsActivePort');
  const child = cp.spawn(EDGE, ['--headless','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check',
    '--disable-extensions','--disable-sync','--remote-debugging-port=0','--user-data-dir=' + tmp, url], { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++){
    await sleep(300);
    if (fs.existsSync(pf)) port = parseInt(fs.readFileSync(pf, 'utf8').split(/\r?\n/)[0], 10) || 0;
  }
  if (!port){ killTree(child); throw new Error('Edge(' + label + ') 未暴露 DevTools 端口'); }
  const list = await waitFor(async () => {
    const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const p = (l || []).find(t => t.type === 'page' && /index\.html/i.test(t.url || ''));
    return p && p.webSocketDebuggerUrl ? p : null;
  }, 15000, 300, 'DevTools page target');
  const cdp = await openCDP(list.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__e2eErrors=[];window.addEventListener("error",function(e){window.__e2eErrors.push(String(e.message||e.error))});window.addEventListener("unhandledrejection",function(e){window.__e2eErrors.push("rejection:"+String(e.reason))});'
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(() => evalExpr(cdp, '(typeof Game!=="undefined")&&(typeof UI!=="undefined")&&(typeof Net!=="undefined")&&!!document.getElementById("netName")'), 20000, 300, label + ' 页面初始化');
  return { child, tmp, cdp, label };
}

(async () => {
  let server = null, host = null, client = null, port = 0;
  try {
    port = await freePort();
    const serverJs = path.join(ROOT, 'server', 'server.js');
    if (!fs.existsSync(serverJs)) throw new Error('缺少 server/server.js');
    server = cp.spawn(NODE, [serverJs, '--port=' + port], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; server.stdout.on('data', d => out += d); server.stderr.on('data', d => out += d);
    await waitFor(async () => { try { return (await httpGet('http://127.0.0.1:' + port + '/index.html')).status === 200; } catch (e){ return false; } }, 20000, 250, '服务端就绪');
    check('E1', '真实服务端启动（静态页 200）', true, 'port=' + port);

    const url = 'http://127.0.0.1:' + port + '/index.html#net';
    host = await launchEdge(url, 'host');
    await evalExpr(host.cdp, 'document.getElementById("netName").value="HostE2E";document.querySelector(\'[data-act="net-create"]\').click();true');
    await waitFor(() => evalExpr(host.cdp, '(Net.status()==="online")&&!!Net.roomCode()'), 15000, 300, 'host 建房');
    const code = await evalExpr(host.cdp, 'Net.roomCode()');
    check('E2', 'host 创建房间并获得房间码', /^[A-Z0-9]{4}$/.test(String(code)), 'code=' + code);

    client = await launchEdge(url, 'client');
    await evalExpr(client.cdp, 'document.getElementById("netName").value="ClientE2E";document.getElementById("netCode").value=' + JSON.stringify(String(code)) + ';document.querySelector(\'[data-act="net-join"]\').click();true');
    await waitFor(() => evalExpr(client.cdp, 'Net.status()==="online"&&Net.roomCode()===' + JSON.stringify(String(code))), 15000, 300, 'client 加入房间');
    await waitFor(() => evalExpr(host.cdp, '(Net.players()||[]).length>=2'), 10000, 300, 'host 看到 2 人');
    const roomInfo = await evalExpr(host.cdp, '({players:(Net.players()||[]).length,host:Net.isHost(),clientHas:Net.myId()!==null})');
    check('E3', 'client 加入后 host 房间 2 人', roomInfo && roomInfo.players === 2 && roomInfo.host === true, JSON.stringify(roomInfo));

    await evalExpr(host.cdp, 'document.querySelector(\'[data-act="net-start"]\').click();true');
    await waitFor(() => evalExpr(host.cdp, 'Game.state()==="playing"&&Game.netRole()==="host"'), 15000, 300, 'host 进入 playing');
    await waitFor(() => evalExpr(client.cdp, 'Game.state()==="playing"&&Game.netRole()==="client"'), 15000, 300, 'client 进入 playing');
    check('E4', 'host 开局后 host=playing/host 角色', true);
    check('E5', 'client 收到 start 后 client=playing/client 角色', true);

    await sleep(1500);
    const roles = {
      host: await evalExpr(host.cdp, '({role:Game.netRole(),remotes:Game._dbg.G().remotes.length,hud:document.getElementById("netHud").classList.contains("on")})'),
      client: await evalExpr(client.cdp, '({role:Game.netRole(),remotes:Game._dbg.G().remotes.length,hud:document.getElementById("netHud").classList.contains("on")})')
    };
    check('E6', 'host 侧 remotes=1 且 netHud 显示', roles.host.role === 'host' && roles.host.remotes === 1 && roles.host.hud, JSON.stringify(roles.host));
    check('E7', 'client 侧重建远程玩家且 netHud 显示', roles.client.role === 'client' && roles.client.remotes >= 1 && roles.client.hud, JSON.stringify(roles.client));

    const errsHost = await evalExpr(host.cdp, 'window.__e2eErrors.slice()');
    const errsClient = await evalExpr(client.cdp, 'window.__e2eErrors.slice()');
    check('E8', '双端无 JS 运行时错误', (!errsHost || !errsHost.length) && (!errsClient || !errsClient.length), 'host=' + JSON.stringify(errsHost) + ' client=' + JSON.stringify(errsClient));

    const fileUrl = pathToFileURL(path.join(ROOT, 'index.html')).href;
    await host.cdp.send('Page.navigate', { url: fileUrl });
    await waitFor(() => evalExpr(host.cdp, '(typeof Game!=="undefined")&&(typeof Net!=="undefined")&&!!document.getElementById("netStatus")'), 15000, 300, 'file:// 页面');
    const fileNet = await evalExpr(host.cdp, '({available:Net.available(),status:Net.status(),hint:(document.getElementById("netStatus").textContent||"").length>0})');
    const fileErrs = await evalExpr(host.cdp, 'window.__e2eErrors.slice()');
    check('E9', 'file:// 下 Net.available()===false 且 status===off、无报错',
      fileNet.available === false && fileNet.status === 'off' && fileNet.hint && (!fileErrs || !fileErrs.length), JSON.stringify(fileNet) + ' errs=' + JSON.stringify(fileErrs));
  } catch (e){
    check('E99', '端到端流程异常', false, e && e.message);
  } finally {
    if (host){ host.cdp.close(); killTree(host.child); }
    if (client){ client.cdp.close(); killTree(client.child); }
    await sleep(600);
    if (host) rmrf(host.tmp);
    if (client) rmrf(client.tmp);
    if (server) killTree(server);
  }
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log('--- E2E 汇总: PASS ' + passed + ' / FAIL ' + failed + ' ---');
  try { fs.writeFileSync(path.join(__dirname, 'last-e2e-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8'); } catch (e){}
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => { console.error('E2E 运行器异常: ' + (err && (err.stack || err.message))); process.exit(2); });