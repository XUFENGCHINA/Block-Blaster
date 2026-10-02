/* ============================================================
   方块枪神 2D · 客户端联机网络层（零依赖，纯浏览器 WebSocket）
   全局 Net：房间中继 / 多订阅者事件 / 断线重连 / 延迟检测
   服务器协议（冻结）：create join ready start relay ping→pong peer err
   ------------------------------------------------------------
   多订阅者说明（重要）：
   Net.on 的每个字段都是「数组式」回调，以下写法全部等效且互不覆盖：
     Net.on.relay.push(fn);
     Net.on.relay = fn;        // setter 内部 push，不会覆盖别人
     Net.onRelay(fn);          // 同 Net.on.relay.push(fn)
     Net.subscribe('relay', fn);
   已注册的回调可用 Net.off('relay', fn) 或 Net.on.relay.splice(...) 移除。
   ============================================================ */
const Net = (function(){
'use strict';

const FILE_HINT = '请通过服务端地址打开（例如 http://192.168.1.5:8080），file:// 页面无法联机。';
const CONNECT_TIMEOUT = 7000;    // WebSocket 建连超时
const REQUEST_TIMEOUT = 10000;   // create / join 等待服务器响应超时
const RESTORE_TIMEOUT = 8000;    // 断线重连后恢复房间超时
const PING_INTERVAL = 5000;      // 每 5 秒 ping 一次
const MAX_RETRY = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

/* ==================== 多订阅者事件中心 ==================== */
const SLOT_NAMES = ['status', 'peer', 'start', 'relay', 'err', 'room'];
const slots = { status: [], peer: [], start: [], relay: [], err: [], room: [] };
const on = {};
SLOT_NAMES.forEach(function(name){
  Object.defineProperty(on, name, {
    enumerable: true,
    configurable: true,
    get: function(){ return slots[name]; },
    set: function(v){
      if (v === slots[name]) return;                 // Net.on.x = Net.on.x 不重复注册
      if (v == null){ slots[name].length = 0; return; }
      if (Array.isArray(v)){ for (let i = 0; i < v.length; i++) subscribe(name, v[i]); return; }
      subscribe(name, v);
    }
  });
});
function subscribe(name, fn){
  if (!slots[name] || typeof fn !== 'function') return fn;
  if (slots[name].indexOf(fn) < 0) slots[name].push(fn);
  return fn;
}
function unsubscribe(name, fn){
  const list = slots[name]; if (!list) return;
  const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1);
}
function emit(name){
  const list = slots[name]; if (!list || !list.length) return;
  const args = Array.prototype.slice.call(arguments, 1);
  for (let i = 0; i < list.length; i++){
    try { list[i].apply(null, args); }
    catch(e){ try { console.warn('[Net] ' + name + ' 回调异常：', e); } catch(_){} }
  }
}

/* ==================== 内部状态 ==================== */
let status = 'off';          // off | connecting | online | error
let ws = null;
let url = '';                // 当前（或最后一次）服务器地址
let myId = '';
let hostFlag = false;
let code = '';
let members = [];            // [{id,name,host,ready}]
let roomCfg = null;
let pingMs = 0;
let pingTimer = null;
let connectTimer = null;
let reconnectTimer = null;
let requestTimer = null;
let restoreTimer = null;
let pending = null;          // {kind, resolve, timer}
let identity = null;         // {type:'create'|'join', name, code, config} 用于断线重连
let manualClose = false;
let retries = 0;
let restoring = false;
let activeConnect = null;    // {finish} 保证 connect Promise 只结算一次

/* ==================== 工具 ==================== */
function available(){
  try {
    return typeof WebSocket === 'function' &&
           typeof window !== 'undefined' && !!window.location &&
           window.location.protocol !== 'file:';
  } catch(e){ return false; }
}
function autoUrl(){
  try {
    const loc = window.location;
    if (!loc || !loc.host) return '';
    const proto = (loc.protocol === 'https:') ? 'wss:' : 'ws:';
    return proto + '//' + loc.host + '/ws';
  } catch(e){ return ''; }
}
/* 允许用户输入 192.168.1.5:8080 / http://ip:8080 / ws://ip:8080/ws 等 */
function normalizeUrl(raw){
  let u = String(raw == null ? '' : raw).trim();
  if (!u) u = autoUrl();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) u = u.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(u)){
    if (u.charAt(0) === '/') u = ((window.location && window.location.protocol === 'https:') ? 'wss:' : 'ws:') + '//' + ((window.location && window.location.host) || 'localhost') + u;
    else u = 'ws://' + u;
  }
  const m = /^(wss?:\/\/[^\/?#]+)(\/[^?#]*)?(\?[^#]*)?$/i.exec(u);
  if (m){
    const path = m[2] || '';
    u = m[1] + ((path === '' || path === '/') ? '/ws' : path) + (m[3] || '');
  }
  return u;
}
function cleanName(name){
  let n = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').trim();
  if (!n) n = '方块战士';
  if (n.length > 10) n = n.slice(0, 10);
  return n;
}
function cleanCode(c){
  return String(c == null ? '' : c).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}
function playersCopy(){
  return members.map(function(p){
    return { id: p.id, name: p.name, host: !!p.host, ready: !!p.ready, color: p.color || '' };
  });
}
function roomInfo(){
  return { code: code, id: myId, host: hostFlag, players: playersCopy(), config: roomCfg };
}
function setStatus(st, msg){
  status = st;
  emit('status', st, msg || '');
}
function sendMsg(obj){
  if (!ws || ws.readyState !== 1) return false;
  try { ws.send(JSON.stringify(obj)); return true; }
  catch(e){ return false; }
}
function clearTimer(t){ if (t){ clearTimeout(t); } return null; }

/* ==================== 连接管理 ==================== */
function cancelConnect(reason){
  const a = activeConnect;
  activeConnect = null;
  if (a && a.finish) a.finish({ ok: false, err: reason || '连接已取消' });
}
function teardownSocket(){
  stopPing();
  cancelConnect('连接已取消');
  const s = ws;
  ws = null;
  if (s){
    try { s.onopen = null; s.onmessage = null; s.onerror = null; s.onclose = null; } catch(e){}
    try { s.close(); } catch(e){}
  }
}
function openSocket(){
  return new Promise(function(resolve){
    let done = false;
    function finish(r){
      if (done) return;
      done = true;
      if (activeConnect && activeConnect.finish === finish) activeConnect = null;
      resolve(r);
    }
    activeConnect = { finish: finish };
    let sock;
    try { sock = new WebSocket(url); }
    catch(e){
      setStatus('error', '服务器地址不合法');
      finish({ ok: false, err: '服务器地址不合法：' + url + '，请填写如 ws://192.168.1.5:8080/ws' });
      return;
    }
    ws = sock;
    setStatus('connecting', '正在连接 ' + url);
    connectTimer = clearTimer(connectTimer);
    connectTimer = setTimeout(function(){
      connectTimer = null;
      if (done) return;
      if (ws === sock) ws = null;
      try { sock.close(); } catch(e){}
      setStatus('error', '连接超时');
      finish({ ok: false, err: '连接服务器超时：' + url + '，请确认服务端已启动、手机与电脑在同一网络。' });
    }, CONNECT_TIMEOUT);

    sock.onopen = function(){
      if (ws !== sock) return;
      connectTimer = clearTimer(connectTimer);
      if (done) return;
      retries = 0;
      setStatus('online', '已连接服务器');
      startPing();
      finish({ ok: true });
    };
    sock.onmessage = function(ev){ onMessage(ev); };
    sock.onerror = function(){ /* 失败统一走 onclose，避免重复结算 */ };
    sock.onclose = function(){
      connectTimer = clearTimer(connectTimer);
      if (ws === sock) ws = null;
      stopPing();
      if (manualClose){ setStatus('off', '已断开连接'); return; }
      if (!done){
        setStatus('error', '无法连接服务器');
        finish({ ok: false, err: '无法连接服务器：' + url + '。请确认服务端已启动、端口已放行，地址形如 ws://192.168.1.5:8080/ws。' });
        return;
      }
      if (identity && retries < MAX_RETRY){ scheduleReconnect(); }
      else {
        const msg = (identity && retries >= MAX_RETRY) ? '与服务器断开连接（重连 3 次失败）' : '与服务器断开连接';
        resetRoom();
        setStatus('error', msg);
        emit('err', msg);
      }
    };
  });
}
function scheduleReconnect(){
  if (!identity || manualClose) return;
  if (retries >= MAX_RETRY){ failReconnect(); return; }
  retries++;
  const delay = RETRY_DELAYS[Math.min(retries - 1, RETRY_DELAYS.length - 1)];
  setStatus('connecting', '连接断开，' + Math.round(delay / 1000) + ' 秒后重连（' + retries + '/' + MAX_RETRY + '）…');
  reconnectTimer = clearTimer(reconnectTimer);
  reconnectTimer = setTimeout(function(){
    reconnectTimer = null;
    if (manualClose || !identity) return;
    openSocket().then(function(r){
      if (!r.ok){ scheduleReconnect(); return; }
      restoring = true;
      restoreTimer = clearTimer(restoreTimer);
      restoreTimer = setTimeout(function(){
        restoreTimer = null;
        if (!restoring) return;
        restoring = false;
        failReconnect();
      }, RESTORE_TIMEOUT);
      setStatus('online', '已重连，正在恢复房间…');
      if (identity.type === 'create') sendMsg({ t: 'create', name: identity.name, config: identity.config });
      else sendMsg({ t: 'join', name: identity.name, code: identity.code });
    });
  }, delay);
}
function failReconnect(){
  restoring = false;
  restoreTimer = clearTimer(restoreTimer);
  resetRoom();
  setStatus('error', '重连 3 次失败，已断开');
  emit('err', '与服务器断开连接，重连 3 次失败。');
}
function resetRoom(){
  myId = ''; hostFlag = false; code = ''; members = []; roomCfg = null;
  identity = null; restoring = false;
  restoreTimer = clearTimer(restoreTimer);
}
function startPing(){
  stopPing();
  pingTimer = setInterval(function(){
    if (ws && ws.readyState === 1) sendMsg({ t: 'ping', ts: Date.now() });
  }, PING_INTERVAL);
}
function stopPing(){ pingTimer = clearTimer(pingTimer); }

/* ==================== 消息处理 ==================== */
function onMessage(ev){
  let msg;
  try { msg = JSON.parse(ev && ev.data); }
  catch(e){ return; }                     // 非法 JSON 静默兜底
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t){
    case 'room':   handleRoom(msg); break;
    case 'peer':   handlePeer(msg); break;
    case 'start':  roomCfg = msg.config || roomCfg; emit('start', roomCfg); break;
    case 'relay':  emit('relay', msg.from, msg.data); break;
    case 'pong':
      pingMs = Math.max(0, Date.now() - (+msg.ts || Date.now()));
      emit('status', status, '');         // 让界面刷新延迟
      break;
    case 'err':    handleErr(String(msg.msg || '服务器返回错误')); break;
    default: break;
  }
}
function normPlayers(arr){
  const out = [];
  for (let i = 0; i < arr.length; i++){
    const p = arr[i];
    if (p == null) continue;
    if (typeof p === 'string') out.push({ id: p, name: p, host: false, ready: false, color: '' });
    else out.push({
      id: String(p.id == null ? ('p' + i) : p.id),
      name: String(p.name || ('玩家' + (i + 1))),
      host: !!p.host,
      ready: !!p.ready,
      color: p.color || ''
    });
  }
  return out;
}
function handleRoom(msg){
  const first = !code;
  if (msg.id != null) myId = String(msg.id);
  hostFlag = !!msg.host;
  if (msg.code) code = String(msg.code).toUpperCase();
  if (Array.isArray(msg.players)) members = normPlayers(msg.players);
  if (msg.config) roomCfg = msg.config;
  if (hostFlag && myId && !members.some(function(p){ return p.host; })){
    const me = members.filter(function(p){ return p.id === myId; })[0];
    if (me) me.host = true;
  }
  restoring = false;
  restoreTimer = clearTimer(restoreTimer);
  if (pending){
    const p = pending; pending = null;
    clearTimer(p.timer);
    p.resolve(p.kind === 'join'
      ? { ok: true, code: code, config: roomCfg, players: playersCopy() }
      : { ok: true, code: code });
  } else {
    emit('room', roomInfo());
  }
  setStatus('online', first ? ('已进入房间 ' + code) : '');
}
function handlePeer(msg){
  const ev = String(msg.ev || msg.event || 'peer');
  const id = msg.id == null ? '' : String(msg.id);
  const name = String(msg.name || '玩家');
  const ready = !!(msg.ready != null ? msg.ready : msg.v);
  const found = id ? members.filter(function(p){ return p.id === id; })[0] : null;
  if (ev === 'join'){
    if (found){ found.name = name; }
    else if (id){ members.push({ id: id, name: name, host: false, ready: ready, color: '' }); }
  } else if (ev === 'leave'){
    members = members.filter(function(p){ return p.id !== id; });
  } else if (ev === 'ready'){
    if (found) found.ready = ready;
    else if (id) members.push({ id: id, name: name, host: false, ready: ready, color: '' });
  } else if (ev === 'host'){
    members.forEach(function(p){ p.host = (p.id === id); });
    hostFlag = (id === myId);
  }
  emit('peer', { ev: ev, id: id, name: name, ready: ready, players: playersCopy() });
  emit('status', status, '');
}
function handleErr(text){
  if (pending){
    const p = pending; pending = null;
    clearTimer(p.timer);
    identity = null;
    p.resolve({ ok: false, err: text });
    emit('err', text);
    emit('status', status, '');
    return;
  }
  if (restoring){ restoring = false; failReconnect(); emit('err', text); return; }
  emit('err', text);
  /* 房间被解散 / 不存在 / 无效：清掉房间态，界面回到创建/加入表单 */
  if (code && /解散|不存在|无效|离开|已满|还没有加入/.test(text)){
    resetRoom();
    setStatus(ws && ws.readyState === 1 ? 'online' : 'off', text);
    return;
  }
  emit('status', status, '');
}

/* ==================== 请求（create / join） ==================== */
function ensureOnline(){
  if (ws && ws.readyState === 1 && status === 'online') return Promise.resolve({ ok: true });
  return connect(url || autoUrl());
}
function request(payload, kind){
  return new Promise(function(resolve){
    if (pending){
      const old = pending; pending = null;
      clearTimer(old.timer);
      old.resolve({ ok: false, err: '上一个请求已被新的请求取消' });
    }
    requestTimer = clearTimer(requestTimer);
    pending = { kind: kind, resolve: resolve, timer: null };
    pending.timer = requestTimer = setTimeout(function(){
      if (!pending || pending.resolve !== resolve) return;
      pending = null; requestTimer = null; identity = null;
      const msg = '服务器响应超时，请确认服务端已启动：' + url;
      emit('err', msg);
      resolve({ ok: false, err: msg });
    }, REQUEST_TIMEOUT);
    if (!sendMsg(payload)){
      pending = null; requestTimer = clearTimer(requestTimer); identity = null;
      resolve({ ok: false, err: '发送失败：尚未连接到服务器' });
    }
  });
}

/* ==================== 对外 API ==================== */
function connect(rawUrl){
  if (!available()) return Promise.resolve({ ok: false, err: FILE_HINT });
  const target = normalizeUrl(rawUrl);
  if (!target) return Promise.resolve({ ok: false, err: '服务器地址为空，请填写如 ws://192.168.1.5:8080/ws' });
  if (ws && ws.readyState === 1 && status === 'online' && target === url) return Promise.resolve({ ok: true });
  teardownSocket();
  url = target;
  manualClose = false;
  retries = 0;
  return openSocket();
}
function createRoom(name, config){
  if (!available()) return Promise.resolve({ ok: false, err: FILE_HINT });
  if (code) return Promise.resolve({ ok: false, err: '你已在房间 ' + code + ' 中，请先退出' });
  const cfg = config || { mode: 'campaign', level: 1, tier: 1 };
  return ensureOnline().then(function(c){
    if (!c.ok) return c;
    const nm = cleanName(name);
    identity = { type: 'create', name: nm, code: '', config: cfg };
    return request({ t: 'create', name: nm, config: cfg }, 'create');
  });
}
function joinRoom(name, roomCode){
  if (!available()) return Promise.resolve({ ok: false, err: FILE_HINT });
  const c = cleanCode(roomCode);
  if (c.length !== 4) return Promise.resolve({ ok: false, err: '房间码应为 4 位字母或数字' });
  if (code) return Promise.resolve({ ok: false, err: '你已在房间 ' + code + ' 中，请先退出' });
  return ensureOnline().then(function(r){
    if (!r.ok) return r;
    const nm = cleanName(name);
    identity = { type: 'join', name: nm, code: c };
    return request({ t: 'join', name: nm, code: c }, 'join');
  });
}
function ready(v){
  if (code && myId){
    const me = members.filter(function(p){ return p.id === myId; })[0];
    if (me) me.ready = v !== false;
    emit('status', status, '');
    emit('peer', { ev: 'ready', id: myId, name: me ? me.name : '', ready: me ? me.ready : (v !== false), players: playersCopy() });
  }
  return sendMsg({ t: 'ready', v: v !== false });
}
function startGame(config){
  if (!hostFlag) return false;
  return sendMsg({ t: 'start', config: config || roomCfg || undefined });
}
function send(data){
  if (!code || !ws || ws.readyState !== 1) return false;
  return sendMsg({ t: 'relay', data: data });
}
function disconnect(){
  manualClose = true;
  reconnectTimer = clearTimer(reconnectTimer);
  restoreTimer = clearTimer(restoreTimer);
  if (requestTimer){ requestTimer = clearTimer(requestTimer); }
  if (pending){
    const p = pending; pending = null;
    clearTimer(p.timer);
    p.resolve({ ok: false, err: '已断开连接' });
  }
  if (ws && ws.readyState === 1 && code){ try { ws.send(JSON.stringify({ t: 'leave' })); } catch(e){} }
  resetRoom();
  teardownSocket();
  setStatus('off', '已断开连接');
}

const api = {
  FILE_HINT: FILE_HINT,
  available: available,
  autoUrl: autoUrl,
  normalizeUrl: normalizeUrl,
  parseHash: function(){
    const out = { screen: null, join: null };
    try {
      const raw = String((window.location && window.location.hash) || '').replace(/^#+/, '');
      if (!raw) return out;
      const m = /(?:^|&)join=([^&]*)/i.exec(raw);
      if (m && m[1]){
        out.join = decodeURIComponent(m[1]).trim().toUpperCase();
        out.screen = 'net';
      } else if (/^(net|coop)$/i.test(raw)){
        out.screen = 'net';
      }
    } catch(e){}
    return out;
  },
  status: function(){ return status; },
  myId: function(){ return myId; },
  isHost: function(){ return hostFlag; },
  roomCode: function(){ return code; },
  players: playersCopy,
  config: function(){ return roomCfg; },
  url: function(){ return url; },
  latency: function(){ return pingMs; },
  connect: connect,
  createRoom: createRoom,
  joinRoom: joinRoom,
  ready: ready,
  startGame: startGame,
  disconnect: disconnect,
  send: send,
  subscribe: subscribe,
  off: unsubscribe,
  onStatus: function(fn){ return subscribe('status', fn); },
  onPeer: function(fn){ return subscribe('peer', fn); },
  onStart: function(fn){ return subscribe('start', fn); },
  onRelay: function(fn){ return subscribe('relay', fn); },
  onErr: function(fn){ return subscribe('err', fn); },
  onRoom: function(fn){ return subscribe('room', fn); },
  _emit: emit,
  _slots: slots
};
Object.defineProperty(api, 'on', {
  enumerable: true,
  configurable: true,
  get: function(){ return on; },
  set: function(v){
    if (!v || typeof v !== 'object') return;
    for (let i = 0; i < SLOT_NAMES.length; i++){
      const k = SLOT_NAMES[i];
      if (typeof v[k] === 'function') subscribe(k, v[k]);
      else if (Array.isArray(v[k])) for (let j = 0; j < v[k].length; j++) subscribe(k, v[k][j]);
    }
  }
});
return api;
})();