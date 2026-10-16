/* ============================================================
   方块枪神 2D · v1.1.4 验收矩阵（真实 Edge + CDP）
   验收标准（HANDOFF 待办①）：
     3 种视口尺寸 × 系统字体放大 1.0 / 1.3 / 1.5，
     主菜单 7 个入口全部在 #stage 内，且中心 elementFromPoint 命中自身；
     另外每个组合都用真实鼠标事件点一次「🎨 材质包」（用户实际卡住的那个按钮），
     确认能进入材质包页面；并检查主菜单诊断行的内容。

   字体放大的模拟方式与 Android System WebView 的 setTextZoom 等价：
     WebView 会把元素的 computed font-size 乘以系统字号比例，
     本项目 UI 全用 em 级联，所以把 fitStage() 写下的 #stage 字号乘上比例即可完整复现。

   用法（项目根目录）：
     & "C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" tests/acceptance-menu-114.js
   ============================================================ */
'use strict';
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const { pathToFileURL } = require('url');

const EDGE = process.env.BG_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const HTML = path.resolve(__dirname, '..', 'index.html');
const URL = pathToFileURL(HTML).href;
const SIZES = [[960, 540], [740, 360], [390, 844]];   // v1.1.1 起沿用至今的三种视口
const ZOOMS = [1.0, 1.3, 1.5];                        // 系统「字体大小」放大比例
const EXPECT_BUTTONS = ['levels', 'diff', 'br', 'net', 'shop', 'book', 'pack'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg2d-menu114-'));
const child = cp.spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-sync', '--remote-debugging-port=0',
  '--user-data-dir=' + tmp, URL
], { stdio: 'ignore' });

function rmrf(p){ try { fs.rmSync(p, { recursive: true, force: true }); } catch(e){} }
function kill(){ try { cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch(e){} }

let failures = 0;
function check(ok, label, extra){
  if (!ok) failures++;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log('  [' + tag + '] ' + label + (extra === undefined ? '' : '  → ' + extra));
}

(async () => {
  const pf = path.join(tmp, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 60 && !port; i++){ await sleep(300); if (fs.existsSync(pf)) port = parseInt(fs.readFileSync(pf, 'utf8').split(/\r?\n/)[0], 10) || 0; }
  if (!port) throw new Error('ENV: Edge DevTools 端口未就绪');
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = list.find(t => t.type === 'page' && /index\.html/i.test(t.url)) || list.find(t => t.type === 'page');
  if (!page) throw new Error('ENV: 没找到页面');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)){ const p = pend.get(m.id); pend.delete(m.id); p(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; setTimeout(() => rej(new Error('ENV: websocket 超时')), 10000); });
  const send = (method, params) => new Promise(res => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const evalExpr = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r && r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails));
    return r && r.result ? r.result.value : undefined;
  };

  let ready = false;
  for (let i = 0; i < 60 && !ready; i++){ await sleep(250); try { ready = await evalExpr('typeof Game!=="undefined" && typeof UI!=="undefined" && !!document.querySelector(".menu-btns")'); } catch(e){} }
  if (!ready) throw new Error('ENV: 页面未初始化');
  await evalExpr('UI.goMenu()');
  await sleep(300);

  // 无头 Edge 默认 navigator.maxTouchPoints=10，会被 isTouchDevice() 当成触屏 →
  // 窄屏纵向时弹出「请旋转手机」遮罩（真机上是刻意行为，APK 也已锁横屏）。
  // 本矩阵要测的是主菜单在不同视口 / 字号下的几何，所以显式模拟非触屏桌面浏览器。
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{Object.defineProperty(navigator,'maxTouchPoints',{get:function(){return 0;},configurable:true});}catch(e){}"
  });
  await send('Page.reload', { ignoreCache: true });
  ready = false;
  for (let i = 0; i < 60 && !ready; i++){ await sleep(250); try { ready = await evalExpr('typeof Game!=="undefined" && typeof UI!=="undefined" && !!document.querySelector(".menu-btns")'); } catch(e){} }
  if (!ready) throw new Error('ENV: 重载后页面未初始化');
  await evalExpr('UI.goMenu()');
  await sleep(300);
  const envInfo = await evalExpr('({ maxTouchPoints: navigator.maxTouchPoints, touchClass: document.body.classList.contains("touch"), rotate: document.getElementById("rotate").classList.contains("on") })');
  console.log('环境：maxTouchPoints=' + envInfo.maxTouchPoints + ' · body.touch=' + envInfo.touchClass + ' · 竖屏遮罩=' + envInfo.rotate + '\n');
  check(envInfo.maxTouchPoints === 0 && envInfo.touchClass === false, '环境：非触屏桌面浏览器（矩阵不受竖屏遮罩影响）', JSON.stringify(envInfo));

  console.log('（视口 × 字体放大）主菜单 7 入口验收');
  for (const [w, h] of SIZES){
    for (const z of ZOOMS){
      const label = w + '×' + h + ' 字体×' + z.toFixed(1);
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
      await sleep(400);                                    // fitStage() 重新排版
      const applied = await evalExpr(`(function(){
        var st=document.getElementById('stage');
        st.style.fontSize='';
        window.dispatchEvent(new Event('resize'));   // 让 game.js fitStage() 重新写入干净基准字号
        var base=parseFloat(st.style.fontSize)||16;
        st.style.fontSize=(base*${z})+'px';          // 等价于 Android textZoom 放大文本
        if (typeof UI.updateViewport === 'function') UI.updateViewport();
        return Math.round(base*1000)/1000;
      })()`);
      await sleep(150);

      const snap = await evalExpr(`(function(){
        var stage=document.getElementById('stage');
        var st=stage.getBoundingClientRect();
        var left=document.querySelector('.menu-left');
        var diag=document.getElementById('diag');
        var btns=[].slice.call(document.querySelectorAll('.menu-btns button[data-act]'));
        var out={ label:${JSON.stringify(label)}, zoom:${z}, baseFont:${applied},
          viewport:[window.innerWidth,window.innerHeight],
          stage:[Math.round(st.width),Math.round(st.height)],
          stageFont:window.getComputedStyle(stage).fontSize,
          scale:(typeof window.__bgMenuScale==='number')?window.__bgMenuScale:null,
          menuScroll: !!(left && left.classList.contains('menu-scroll')),
          diagText: diag ? diag.textContent : null, diagVisible: !!(diag && !diag.hidden),
          notes: [].slice.call(document.querySelectorAll('.menu-left h1, .menu-left .sub, .menu-btns .btn-note')).map(function(e){
            var r=e.getBoundingClientRect();
            return { text:String(e.textContent||'').slice(0,14), h:Math.round(r.height),
              inside: r.top>=st.top-0.5 && r.bottom<=st.bottom+0.5 && r.left>=st.left-0.5 && r.right<=st.right+0.5 };
          }).filter(function(n){ return n.h>0; }),
          buttons: btns.map(function(b){
            var r=b.getBoundingClientRect();
            var cx=r.left+r.width/2, cy=r.top+r.height/2;
            var hit=document.elementFromPoint(cx,cy);
            var owner=(hit&&hit.closest)?hit.closest('button[data-act]'):null;
            return { act:b.getAttribute('data-act'), show:!b.classList.contains('hide'),
              w:Math.round(r.width), h:Math.round(r.height),
              inside: r.top>=st.top-0.5 && r.bottom<=st.bottom+0.5 && r.left>=st.left-0.5 && r.right<=st.right+0.5,
              hitSelf: owner===b, hit: hit?(hit.tagName+(hit.className?('.'+String(hit.className).split(' ')[0]):'')):null };
          }) };
        return out;
      })()`);

      const shown = (snap.buttons || []).filter(b => b.show);
      const acts = shown.map(b => b.act).sort();
      const info = 'stage ' + snap.stage.join('×') + ' · stage字号 ' + snap.stageFont +
        ' · 菜单自适应 ' + (snap.scale === null ? '?' : Math.round(snap.scale * 100) + '%') +
        (snap.menuScroll ? ' · 滚动兜底' : '') + ' · 按钮高 ' + shown.map(b => b.h).join('/');
      check(shown.length === 7 && acts.join(',') === EXPECT_BUTTONS.slice().sort().join(','),
        label + ' 7 个入口齐全', shown.length + ' 个: ' + shown.map(b => b.act + (b.inside ? '' : '✗屏外') + (b.hitSelf ? '' : '✗未命中')).join(' '));
      const outside = shown.filter(b => !b.inside);
      check(outside.length === 0, label + ' 全部落在 #stage 内', outside.length ? outside.map(b => b.act).join(',') : 'ok');
      const unhit = shown.filter(b => !b.hitSelf);
      check(unhit.length === 0, label + ' 中心 elementFromPoint 命中自身', unhit.length ? unhit.map(b => b.act + '→' + b.hit).join(',') : 'ok');
      check(!snap.menuScroll, label + ' 无需滚动即可全部点到', snap.menuScroll ? '退化为滚动兜底' : 'ok');
      check(!!snap.diagText && /v1\.1\.4/.test(snap.diagText) && /dpr/.test(snap.diagText) &&
            /(Chrome|WebView)/.test(snap.diagText) && snap.diagText.indexOf('×') > 0,
        label + ' 诊断行内容', snap.diagText);
      check(snap.diagVisible === true, label + ' 诊断行在主菜单可见', snap.diagVisible);
      const clipped = (snap.notes || []).filter(n => !n.inside);
      check(clipped.length === 0, label + ' 标题 / 说明小字完整可见（不被裁掉）',
        clipped.length ? clipped.map(n => n.text).join(' | ') : (snap.notes || []).length + ' 个文本块 ok');

      // 真实鼠标点击「🎨 材质包」（用户实际卡住的按钮）
      const pack = shown.filter(b => b.act === 'pack')[0];
      const pos = await evalExpr(`(function(){
        var b=document.querySelector('.menu-btns button[data-act="pack"]');
        var r=b.getBoundingClientRect();
        return { x:r.left+r.width/2, y:r.top+r.height/2, hidden:b.classList.contains('hide') };
      })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
      await sleep(250);
      const opened = await evalExpr('!!(document.getElementById("scrPack") && document.getElementById("scrPack").classList.contains("on"))');
      check(opened === true, label + ' 点击「🎨 材质包」进入材质包页', opened ? 'ok' : '未进入（按钮 ' + (pack ? pack.w + '×' + pack.h : '?') + '）');
      await evalExpr('UI.goMenu()');
      await sleep(200);
      console.log('  · ' + label + ' → ' + info);
    }
  }

  // 压力用例：超出正常范围的放大（2.0×）+ 极端窄屏，验证「滚动兜底」这条退路真的存在
  await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  await evalExpr(`(function(){var st=document.getElementById('stage');st.style.fontSize='';window.dispatchEvent(new Event('resize'));var base=parseFloat(st.style.fontSize)||16;st.style.fontSize=(base*2)+'px';UI.updateViewport();})()`);
  await sleep(150);
  const stress = await evalExpr(`(function(){
    var left=document.querySelector('.menu-left');
    return { scale: window.__bgMenuScale, scroll: !!(left && left.classList.contains('menu-scroll')) };
  })()`);
  console.log('压力用例 640×360 字体×2.0 → 自适应 ' + Math.round(stress.scale * 100) + '%' +
    (stress.scroll ? ' + 滚动兜底' : '（未触发兜底）'));
  check(stress.scale !== null && (stress.scale > 0 || stress.scroll), '压力用例：字号或滚动兜底至少有一个生效',
    'scale=' + stress.scale + ' scroll=' + stress.scroll);

  // 反向对照：人为把菜单字号钉回 100%（等价于关掉 fitMenu 兜底），
  // 确认矩阵真能抓到 v1.1.4 之前的溢出症状，而不是恒真断言。
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 2, mobile: false });
  await sleep(400);
  await evalExpr(`(function(){var st=document.getElementById('stage');st.style.fontSize='';window.dispatchEvent(new Event('resize'));var base=parseFloat(st.style.fontSize)||16;st.style.fontSize=(base*1.5)+'px';UI.updateViewport();})()`);
  await sleep(150);
  const control = await evalExpr(`(function(){
    var grid=document.querySelector('.menu-grid');
    grid.style.fontSize='100%';                       // 绕过兜底，还原修复前的布局
    var st=document.getElementById('stage').getBoundingClientRect();
    var b=document.querySelector('.menu-btns button[data-act="pack"]');
    var r=b.getBoundingClientRect();
    var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
    return { packBottom:Math.round(r.bottom), stageBottom:Math.round(st.bottom),
      inside: r.bottom<=st.bottom+0.5,
      hitSelf: !!(hit&&hit.closest&&hit.closest('button[data-act]')===b) };
  })()`);
  console.log('\n反向对照 960×540 字体×1.5 关掉兜底 → pack 底 ' + control.packBottom +
    ' vs stage 底 ' + control.stageBottom + ' · 在屏内=' + control.inside + ' · 中心命中=' + control.hitSelf);
  check(control.inside === false || control.hitSelf === false,
    '反向对照：关掉兜底后确实溢出 / 点不到（证明矩阵能抓到原缺陷）',
    JSON.stringify(control));
  await evalExpr('UI.updateViewport()');   // 恢复兜底状态

  console.log(failures === 0 ? '\n验收矩阵：全部通过 ✅' : '\n验收矩阵：' + failures + ' 项失败 ❌');
  ws.close(); kill(); await sleep(600); rmrf(tmp);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => {
  console.log('ENV/ERROR: ' + (e && e.message));
  kill(); rmrf(tmp);
  process.exitCode = 1;
});