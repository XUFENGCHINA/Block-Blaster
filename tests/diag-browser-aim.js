/* 真实浏览器最小复现：大逃杀大世界里，鼠标瞄准方向没有补偿摄像机偏移。
   用法（在项目根目录）：
   & "C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" tests/diag-browser-aim.js
   期望正确结果 cos(aim)≈1；若输出约 -1 则确认缺陷。 */
'use strict';
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const { pathToFileURL } = require('url');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML = path.resolve(__dirname, '..', 'index.html');
const URL = pathToFileURL(HTML).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg2d-aim-'));
const child = cp.spawn(EDGE, ['--headless','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-sync','--remote-debugging-port=0','--user-data-dir=' + tmp, URL], { stdio: 'ignore' });
function rmrf(p){ try { fs.rmSync(p, { recursive: true, force: true }); } catch(e){} }
function kill(){ try { cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch(e){} }
(async () => {
  const pf = path.join(tmp, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 60 && !port; i++){ await sleep(300); if (fs.existsSync(pf)) port = parseInt(fs.readFileSync(pf, 'utf8').split(/\r?\n/)[0], 10) || 0; }
  if (!port) throw new Error('ENV: Edge DevTools port 未就绪');
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = list.find(t => t.type === 'page' && /index\.html/i.test(t.url)) || list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)){ const p = pend.get(m.id); pend.delete(m.id); p(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; setTimeout(() => rej(new Error('ENV: websocket timeout')), 10000); });
  const send = (method, params) => new Promise(res => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evalExpr = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r && r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails));
    return r && r.result ? r.result.value : undefined;
  };
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++){ await sleep(250); try { ready = await evalExpr('typeof Game!=="undefined" && typeof UI!=="undefined"'); } catch(e){} }
  if (!ready) throw new Error('ENV: 页面未初始化');
  await evalExpr('document.querySelector("[data-act=\\"br\\"]").click()');
  await sleep(400);
  await evalExpr('document.querySelector("[data-act=\\"start-br\\"]").click()');
  await sleep(600);
  const out = await evalExpr(`(function(){
    var G = Game._dbg.G();
    G.player.invuln = 1e9;
    G.player.x = G.world.w / 2; G.player.y = G.world.h / 2;
    G.player.vx = 0; G.player.vy = 0;
    return new Promise(function(resolve){
      setTimeout(function(){
        var cv = document.getElementById('cv');
        var r = cv.getBoundingClientRect();
        var sx = G.player.x + 300 - G.cam.x;      // 想把枪口指向玩家右侧 300px（世界坐标）
        var sy = G.player.y - G.cam.y;
        var ev = new PointerEvent('pointermove', {
          clientX: r.left + sx * (r.width / 960),
          clientY: r.top + sy * (r.height / 540),
          pointerType: 'mouse', bubbles: true
        });
        cv.dispatchEvent(ev);
        setTimeout(function(){
          resolve({ camX: G.cam.x, playerX: G.player.x, aim: G.player.aim, cos: Math.cos(G.player.aim) });
        }, 400);
      }, 1500);
    });
  })()`);
  console.log(JSON.stringify({ result: out, verdict: out && out.cos > 0.9 ? 'OK 瞄准方向正确' : 'BUG 鼠标指向右侧但实际瞄准方向错误' }, null, 2));
  ws.close(); kill(); await sleep(600); rmrf(tmp);
})().catch(e => { console.log('ENV/ERROR: ' + (e && e.message)); kill(); rmrf(tmp); process.exitCode = 1; });