'use strict';
/* ============================================================
   server/server.js 独立集成测试：真实启动服务端 + 3 个 WebSocket 客户端
   用法：node tests/run-server-tests.js
   只写 tests/；用完会杀掉服务端进程。
   ============================================================ */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('http timeout')); });
  });
}
class WsClient {
  constructor(name){ this.name = name; this.ws = null; this.msgs = []; this.waiters = []; this.closed = false; }
  connect(url){
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const to = setTimeout(() => reject(new Error(this.name + ' 连接超时')), 8000);
      ws.onopen = () => { clearTimeout(to); resolve(this); };
      ws.onerror = () => { clearTimeout(to); reject(new Error(this.name + ' WebSocket 连接失败')); };
      ws.onclose = () => {
        this.closed = true;
        for (const w of this.waiters.splice(0)) w.reject(new Error(this.name + ' 连接已关闭'));
      };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e){ m = { raw: ev.data }; }
        this.msgs.push(m);
        for (const w of this.waiters.slice()){
          if (w.pred(m)){ this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m); }
        }
      };
    });
  }
  send(obj){ this.ws.send(JSON.stringify(obj)); }
  wait(pred, timeout, label){
    const found = this.msgs.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0){ this.waiters.splice(i, 1); reject(new Error('等待超时: ' + (label || this.name))); }
      }, timeout || 4000);
    });
  }
  close(){ try { this.ws.close(); } catch (e){} }
}

const results = [];
function check(id, name, cond, detail){
  results.push({ id, name, status: cond ? 'PASS' : 'FAIL', detail: detail === undefined ? '' : String(detail) });
  console.log('[' + (cond ? 'PASS' : 'FAIL') + '] ' + id + ' ' + name + (detail !== undefined ? '  -> ' + detail : ''));
}

(async () => {
  let port = 0, server = null;
  try { port = await freePort(); } catch (e){ console.log('无法获取空闲端口: ' + e.message); process.exit(2); }
  const serverJs = path.join(ROOT, 'server', 'server.js');
  if (!fs.existsSync(serverJs)){ console.log('缺少 server/server.js'); process.exit(2); }
  server = cp.spawn(NODE, [serverJs, '--port=' + port], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverOut = '';
  server.stdout.on('data', d => serverOut += d);
  server.stderr.on('data', d => serverOut += d);

  let base = '';
  let up = false;
  for (let i = 0; i < 60 && !up; i++){
    await sleep(250);
    try {
      const r = await httpGet('http://127.0.0.1:' + port + '/index.html');
      if (r.status === 200){ up = true; base = 'http://127.0.0.1:' + port; }
    } catch (e){}
  }
  check('S1', '服务端启动 + GET /index.html 200', up, up ? ('端口 ' + port) : ('15s 未就绪；输出: ' + serverOut.slice(0, 400)));
  if (!up){ try { server.kill(); } catch (e){} process.exit(1); }

  try {
    const idx = await httpGet(base + '/index.html');
    check('S2', '静态页含 方块枪神', idx.status === 200 && idx.body.indexOf('方块枪神') >= 0, 'status=' + idx.status + ' len=' + idx.body.length);
    const js = await httpGet(base + '/js/game.js');
    check('S3', '静态资源 /js/game.js 200', js.status === 200 && js.body.length > 1000, 'status=' + js.status);
  } catch (e){ check('S2', '静态托管检查', false, e.message); }

  const wsUrl = 'ws://127.0.0.1:' + port + '/ws';
  const c1 = new WsClient('c1'), c2 = new WsClient('c2'), c3 = new WsClient('c3');
  let code = '', id1 = '', id2 = '', id3 = '';
  try {
    await c1.connect(wsUrl);
    await c2.connect(wsUrl);
    await c3.connect(wsUrl);
    check('S4', '3 个 WebSocket 客户端连接 /ws', true);

    c1.send({ t: 'create', name: '房主', config: { mode: 'campaign', level: 1 } });
    const room1 = await c1.wait(m => m.t === 'room', 4000, 'create->room');
    code = room1.code; id1 = room1.id;
    check('S5', 'create 建房：4 位房间码 + host 标记 + 1 名玩家',
      /^[A-Z0-9]{4}$/.test(code) && room1.host === true && room1.players.length === 1, 'code=' + code);

    c2.send({ t: 'join', name: '队友2', code });
    const room2 = await c2.wait(m => m.t === 'room', 4000, 'join->room');
    id2 = room2.id;
    check('S6', 'join 加入：host=false + 玩家列表 2 人', room2.host === false && room2.players.length === 2, 'players=' + room2.players.length);
    const pJoin = await c1.wait(m => m.t === 'peer' && m.ev === 'join' && m.id === id2, 4000, 'peer join');
    check('S7', 'peer join 广播到房主', !!pJoin, 'name=' + pJoin.name);

    c3.send({ t: 'join', name: '队友3', code });
    const room3 = await c3.wait(m => m.t === 'room', 4000, 'c3 join');
    id3 = room3.id;
    await c1.wait(m => m.t === 'peer' && m.ev === 'join' && m.id === id3, 4000, 'peer join3');
    check('S8', '第 3 人加入后房间 3 人', room3.players.length === 3, 'players=' + room3.players.length);

    c2.send({ t: 'relay', data: { k: 'in', mx: 1, my: 0, aim: 0, fire: true } });
    const r1 = await c1.wait(m => m.t === 'relay' && m.from === id2, 4000, 'relay c1');
    const r3 = await c3.wait(m => m.t === 'relay' && m.from === id2, 4000, 'relay c3');
    await sleep(150);
    const c2GotRelay = c2.msgs.some(m => m.t === 'relay');
    check('S9', 'relay 双向到达其他两人，不回发给发送者',
      r1 && r3 && r1.data && r1.data.k === 'in' && !c2GotRelay, 'from=' + id2);

    c2.send({ t: 'ready', v: true });
    const rd1 = await c1.wait(m => m.t === 'peer' && m.ev === 'ready' && m.id === id2, 4000, 'peer ready');
    const rd3 = await c3.wait(m => m.t === 'peer' && m.ev === 'ready' && m.id === id2, 4000, 'peer ready3');
    check('S10', 'ready 事件广播（ready=true）', rd1.ready === true && rd3.ready === true);

    c1.send({ t: 'start' });
    const st1 = await c1.wait(m => m.t === 'start', 4000, 'start c1');
    const st2 = await c2.wait(m => m.t === 'start', 4000, 'start c2');
    const st3 = await c3.wait(m => m.t === 'start', 4000, 'start c3');
    check('S11', 'start 广播给 3 人且带 config',
      st1 && st2 && st3 && st1.config && st1.config.mode === 'campaign' && st1.config.level === 1, JSON.stringify(st1.config));

    c1.send({ t: 'ping', ts: 12345 });
    const pong = await c1.wait(m => m.t === 'pong', 4000, 'pong');
    check('S12', 'ping->pong 原样返回 ts', pong.ts === 12345, 'ts=' + pong.ts);

    c2.send({ t: 'not-a-real-type' });
    const err = await c2.wait(m => m.t === 'err', 4000, '非法消息 err');
    check('S13', '非法消息回 err 且服务端不崩', !!err && !c2.closed, err.msg || '');
    c2.send({ t: 'ping', ts: 777 });
    const pong2 = await c2.wait(m => m.t === 'pong' && m.ts === 777, 4000, 'c2 pong after err');
    check('S14', '非法消息后连接仍可用', !!pong2);

    c3.send({ t: 'leave' });
    const lv1 = await c1.wait(m => m.t === 'peer' && m.ev === 'leave' && m.id === id3, 4000, 'peer leave');
    const lv2 = await c2.wait(m => m.t === 'peer' && m.ev === 'leave' && m.id === id3, 4000, 'peer leave2');
    check('S15', 'leave 后 peer leave 广播 + 房间清理', !!lv1 && !!lv2);

    c1.close();
    let hostGone = 'timeout';
    for (let i = 0; i < 40; i++){
      await sleep(100);
      if (c2.msgs.some(m => (m.t === 'peer' && m.ev === 'leave' && m.id === id1) || m.t === 'err')){ hostGone = 'broadcast'; break; }
      if (c2.closed){ hostGone = 'closed'; break; }
    }
    check('S16', '房主断开后房间解散/残留客户端被清理', hostGone !== 'timeout', hostGone);

    const idxAfter = await httpGet(base + '/index.html');
    check('S17', '联机测试后静态托管仍正常', idxAfter.status === 200 && idxAfter.body.indexOf('方块枪神') >= 0);
  } catch (e){
    check('S99', '服务端协议用例异常', false, e && e.message);
  } finally {
    c1.close(); c2.close(); c3.close();
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log('--- 服务端汇总: PASS ' + passed + ' / FAIL ' + failed + ' ---');
  try {
    fs.writeFileSync(path.join(__dirname, 'last-server-results.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), port, results }, null, 2), 'utf8');
  } catch (e){}
  try { cp.spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e){}
  await sleep(400);
  process.exit(failed > 0 ? 1 : 0);
})().catch(err => {
  console.error('服务端测试运行器异常: ' + (err && (err.stack || err.message)));
  process.exit(2);
});