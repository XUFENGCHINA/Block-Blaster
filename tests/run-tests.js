#!/usr/bin/env node
/* ============================================================
   方块枪神 2D · 独立测试脚手架 (tests/run-tests.js)
   - 用 Node vm.runInThisContext 加载 js/data.js -> js/game.js -> js/ui.js
   - 自建 DOM / Canvas / 时钟 桩，不依赖任何第三方库
   - 只用 tests/ 目录；绝不修改业务代码
   用法见 tests/README.md
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const cp = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const FILES = {
  html: path.join(ROOT, 'index.html'),
  data: path.join(ROOT, 'js', 'data.js'),
  levels: path.join(ROOT, 'js', 'levels100.js'),
  game: path.join(ROOT, 'js', 'game.js'),
  ui:   path.join(ROOT, 'js', 'ui.js')
};
const HTML_SRC = fs.readFileSync(FILES.html, 'utf8');
const UI_SRC   = fs.readFileSync(FILES.ui, 'utf8');
const GAME_SRC = fs.readFileSync(FILES.game, 'utf8');

const ARGV = process.argv.slice(2);
const hasFlag = f => ARGV.includes(f);
const getOpt = (name, def) => {
  const a = ARGV.find(x => x.startsWith(name + '='));
  return a === undefined ? def : a.slice(name.length + 1);
};
const PROFILE    = getOpt('--profile', 'desktop');       // desktop | mobile
const IS_MOBILE  = PROFILE === 'mobile';
const IS_CHILD   = hasFlag('--child');
const STRICT     = hasFlag('--strict');                  // 依赖完成后：缺功能 = FAIL 而非 SKIP
const JSON_MODE  = hasFlag('--json');
const WANT_BROWSER = !hasFlag('--no-browser');
const ONLY = getOpt('--only', '');
const BASE_SEED  = (parseInt(getOpt('--seed', '20250501'), 10) || 20250501) >>> 0;
const EDGE = getOpt('--edge', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');

const S = {
  errors: [], wrappers: [], X: null, Game: null, UI: null, Save: null,
  document: null, coinNodes: null, profile: PROFILE
};

/* ================= 可控时钟 ================= */
const clock = {
  now: 1000,
  timers: new Map(),
  raf: new Map(),
  nextTimerId: 1,
  nextRafId: 1
};
/* 句柄做成带 unref/ref 的对象：Node 内部（undici/WebSocket）会对 setTimeout 返回值调用 unref */
function timerHandle(id){
  return { id, unref(){ return this; }, ref(){ return this; }, [Symbol.toPrimitive](){ return id; } };
}
function handleId(h){ return (h && typeof h === 'object') ? h.id : h; }
function simSetTimeout(fn, delay, ...args){
  const id = clock.nextTimerId++;
  clock.timers.set(id, { id, fn, args, time: clock.now + Math.max(0, Number(delay) || 0), interval: 0 });
  return timerHandle(id);
}
function simSetInterval(fn, delay, ...args){
  const d = Math.max(1, Number(delay) || 1);
  const id = clock.nextTimerId++;
  clock.timers.set(id, { id, fn, args, time: clock.now + d, interval: d });
  return timerHandle(id);
}
function simClearTimer(id){ clock.timers.delete(handleId(id)); }
function clearTimers(){ clock.timers.clear(); }
function simRAF(cb){
  const id = clock.nextRafId++;
  clock.raf.set(id, { id, cb });
  return timerHandle(id);
}
function simCAF(id){ clock.raf.delete(handleId(id)); }
function nextDueTimer(){
  let best = null;
  for (const t of clock.timers.values()){
    if (!best || t.time < best.time || (t.time === best.time && t.id < best.id)) best = t;
  }
  return best;
}
function runDueTimers(){
  let guard = 0;
  for (;;){
    if (++guard > 100000) throw new Error('定时器执行超限（疑似 interval 风暴）');
    const t = nextDueTimer();
    if (!t || t.time > clock.now + 1e-9) break;
    if (t.interval > 0) t.time += t.interval;
    else clock.timers.delete(t.id);
    invoke(t.fn, t.args, 'timer');
  }
}
function runRaf(t){
  const list = [...clock.raf.values()].sort((a, b) => a.id - b.id);
  clock.raf.clear();
  for (const r of list) invoke(r.cb, [t], 'requestAnimationFrame');
  /* 产品代码在 rAF 回调中抛异常会导致浏览器同样停止后续帧；
     测试里自动把主循环补回去，避免一个 bug 连锁污染其余用例（异常仍会记入该用例） */
  if (S.loopCb){
    let present = false;
    for (const r of clock.raf.values()) if (r.cb === S.loopCb) present = true;
    if (!present) simRAF(S.loopCb);
  }
}
function invoke(fn, args, label){
  try { fn.apply(null, args || []); }
  catch (err){
    S.errors.push({ label: label || 'callback', message: (err && (err.stack || err.message)) || String(err) });
  }
}
/* 手动步进：每 frameMs 触发一次 rAF（游戏主循环），中途按虚拟时钟触发 setTimeout/setInterval */
function step(ms, frameMs){
  const fm = frameMs || (1000 / 60);
  const end = clock.now + Math.max(0, Number(ms) || 0);
  let guard = 0;
  while (clock.now < end - 1e-9){
    if (++guard > 2000000) throw new Error('step() 迭代超限（疑似死循环）');
    const frameAt = Math.min(clock.now + fm, end);
    let due = nextDueTimer();
    while (due && due.time <= frameAt + 1e-9){
      clock.now = Math.max(clock.now, due.time);
      runDueTimers();
      due = nextDueTimer();
    }
    clock.now = frameAt;
    runRaf(clock.now);
    runDueTimers();
  }
  clock.now = end;
  runDueTimers();
}
function stepUntil(pred, maxMs, tick){
  tick = tick || 50;
  const end = clock.now + (maxMs || 5000);
  while (clock.now < end && !pred()){
    step(tick);
    if (S.errors.length) break;
  }
  return pred();
}
/* 每个用例独立的确定性随机源，失败可复现 */
function seedRng(seed){
  let a = seed >>> 0;
  Math.random = function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================= DOM / Canvas 桩 ================= */
function makeEvent(type, target, extra){
  const ev = {
    type, target, currentTarget: target, defaultPrevented: false, propagationStopped: false,
    preventDefault(){ this.defaultPrevented = true; },
    stopPropagation(){ this.propagationStopped = true; },
    stopImmediatePropagation(){ this.propagationStopped = true; },
    pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0, button: 0, code: '', repeat: false
  };
  if (extra) for (const k in extra) ev[k] = extra[k];
  return ev;
}
function matchSelector(el, sel){
  sel = String(sel || '').trim();
  if (!sel) return false;
  if (sel.includes(',')) return sel.split(',').some(s => matchSelector(el, s));
  const m = sel.match(/^([a-zA-Z0-9-]+)?(.*)$/);
  const tag = m[1], rest = m[2] || '';
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  const parts = rest.match(/(\.[\w-]+|\[[^\]]+\])/g) || [];
  for (const p of parts){
    if (p[0] === '.'){
      if (!el._cls.has(p.slice(1))) return false;
    } else {
      const a = p.slice(1, -1).match(/^([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/);
      if (!a) return false;
      const name = a[1], val = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
      if (!(name in el._attrs)) return false;
      if (val !== undefined && el._attrs[name] !== val) return false;
    }
  }
  return true;
}
class FakeElement {
  constructor(tag, id){
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = id || '';
    this._attrs = Object.create(null);
    this._lis = Object.create(null);
    this._cls = new Set();
    this._text = '';
    this._html = '';
    this._children = [];
    this._qcache = Object.create(null);
    this.parentNode = null;
    this._rect = { left: 0, top: 0, width: 960, height: 540 };
    this.style = { setProperty(k, v){ this[k] = v; }, removeProperty(k){ delete this[k]; }, getPropertyValue(k){ return this[k] || ''; } };
    this.offsetWidth = 0; this.offsetHeight = 0;
    this.clientWidth = 960; this.clientHeight = 540;
    this.scrollWidth = 960; this.scrollHeight = 540;
    this.disabled = false; this.value = ''; this.checked = false; this.hidden = false;
    this.children = this._children;
    this.childNodes = this._children;
    const cls = this._cls;
    this.classList = {
      add: (...n) => n.forEach(x => cls.add(x)),
      remove: (...n) => n.forEach(x => cls.delete(x)),
      contains: n => cls.has(n),
      toggle: (n, force) => {
        const has = cls.has(n);
        const want = force === undefined ? !has : !!force;
        if (want) cls.add(n); else cls.delete(n);
        return want;
      },
      replace: (a, b) => { if (!cls.has(a)) return false; cls.delete(a); cls.add(b); return true; },
      item: i => [...cls][i] === undefined ? null : [...cls][i],
      toString: () => [...cls].join(' '),
      _list: () => [...cls]
    };
    Object.defineProperty(this.classList, 'length', { get(){ return cls.size; } });
    const self = this;
    this.dataset = new Proxy({}, {
      get(t, k){ return self._attrs['data-' + k]; },
      set(t, k, v){ self._attrs['data-' + k] = String(v); return true; },
      has(t, k){ return ('data-' + k) in self._attrs; },
      ownKeys(){ return Object.keys(self._attrs).filter(k => k.startsWith('data-')).map(k => k.slice(5)); },
      getOwnPropertyDescriptor(){ return { enumerable: true, configurable: true }; }
    });
    this._ctx = null;
  }
  get className(){ return [...this._cls].join(' '); }
  set className(v){ this._cls.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach(c => this._cls.add(c)); }
  get textContent(){ return this._text; }
  set textContent(v){ this._text = String(v); }
  get innerText(){ return this._text || this._html; }
  set innerText(v){ this._text = String(v); }
  get innerHTML(){ return this._html; }
  set innerHTML(v){ this._html = String(v); }
  get firstChild(){ return this._children[0] || null; }
  get lastChild(){ return this._children[this._children.length - 1] || null; }
  setAttribute(k, v){ this._attrs[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k){ return k in this._attrs ? this._attrs[k] : null; }
  hasAttribute(k){ return k in this._attrs; }
  removeAttribute(k){ delete this._attrs[k]; }
  appendChild(c){ if (c.parentNode) c.parentNode.removeChild(c); this._children.push(c); c.parentNode = this; return c; }
  insertBefore(c, ref){ if (c.parentNode) c.parentNode.removeChild(c); const i = ref ? this._children.indexOf(ref) : -1; if (i >= 0) this._children.splice(i, 0, c); else this._children.push(c); c.parentNode = this; return c; }
  removeChild(c){ const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); c.parentNode = null; return c; }
  remove(){ if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn, opts){ (this._lis[type] = this._lis[type] || []).push({ fn, once: !!(opts && opts.once) }); }
  removeEventListener(type, fn){ const a = this._lis[type]; if (a){ const i = a.findIndex(l => l.fn === fn); if (i >= 0) a.splice(i, 1); } }
  _fire(type, ev){
    const a = this._lis[type];
    if (!a || !a.length) return null;
    ev = ev || makeEvent(type, this);
    if (!ev.target) ev.target = this;
    if (!ev.currentTarget) ev.currentTarget = this;
    for (const l of a.slice()){
      l.fn.call(this, ev);
      if (l.once) this.removeEventListener(type, l.fn);
    }
    return ev;
  }
  dispatchEvent(ev){ return this._fire(ev && ev.type, ev); }
  click(){
    const ev = makeEvent('click', this);
    this._fire('click', ev);
    let p = this.parentNode;
    while (p){ p._fire('click', ev); p = p.parentNode; }
    return ev;
  }
  querySelector(sel){ if (!this._qcache[sel]) this._qcache[sel] = new FakeElement('div', ''); return this._qcache[sel]; }
  querySelectorAll(){ return []; }
  closest(sel){ let n = this; while (n){ if (matchSelector(n, sel)) return n; n = n.parentNode; } return null; }
  getBoundingClientRect(){
    const r = this._rect;
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
  setPointerCapture(){}
  releasePointerCapture(){}
  focus(){}
  blur(){}
  getContext(type){ return (this.tagName === 'CANVAS' && type === '2d') ? this._ctx : null; }
  getRootNode(){ return documentStub; }
}
function makeCtx(canvas){
  const grad = { addColorStop(){} };
  return new Proxy({ _canvas: canvas }, {
    get(t, prop){
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'canvas') return t._canvas;
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop in t) return t[prop];
      return () => grad;
    },
    set(t, prop, v){ t[prop] = v; return true; }
  });
}
const coinEl = new FakeElement('b', 'coinProbe');
coinEl.classList.add('coin-num');
S.coinNodes = [coinEl];

const documentStub = {
  _els: new Map(),
  _created: new Set(),
  _lis: Object.create(null),
  readyState: 'complete',
  hidden: false,
  visibilityState: 'visible',
  body: null,
  documentElement: null,
  head: null,
  createElement(tag){
    const t = String(tag || 'div').toLowerCase();
    const el = new FakeElement(t === 'canvas' ? 'canvas' : t, '');
    if (t === 'canvas'){ el.width = 300; el.height = 150; el._ctx = makeCtx(el); }
    return el;
  },
  getElementById(id){
    id = String(id);
    if (!this._els.has(id)){
      const isCanvas = id === 'cv';
      const el = this.createElement(isCanvas ? 'canvas' : 'div');
      el.id = id;
      this._els.set(id, el);
      this._created.add(id);
    }
    return this._els.get(id);
  },
  querySelector(sel){
    sel = String(sel || '');
    if (sel[0] === '#') return this.getElementById(sel.slice(1));
    return this._generic || (this._generic = new FakeElement('div', ''));
  },
  querySelectorAll(sel){
    if (sel === '.coin-num') return S.coinNodes;
    return [];
  },
  addEventListener(type, fn, opts){ (this._lis[type] = this._lis[type] || []).push({ fn, once: !!(opts && opts.once) }); },
  removeEventListener(type, fn){ const a = this._lis[type]; if (a){ const i = a.findIndex(l => l.fn === fn); if (i >= 0) a.splice(i, 1); } },
  _fire(type, ev){
    const a = this._lis[type];
    if (!a || !a.length) return null;
    ev = ev || makeEvent(type, this);
    for (const l of a.slice()){ l.fn.call(this, ev); if (l.once) this.removeEventListener(type, l.fn); }
    return ev;
  }
};
documentStub.body = documentStub.createElement('body'); documentStub.body.id = 'body';
documentStub.documentElement = documentStub.createElement('html');
documentStub.head = documentStub.createElement('head');
S.document = documentStub;

/* ================= window / 全局桩 ================= */
const winListeners = Object.create(null);
function winAdd(type, fn, opts){ (winListeners[type] = winListeners[type] || []).push({ fn, once: !!(opts && opts.once) }); }
function winRemove(type, fn){ const a = winListeners[type]; if (a){ const i = a.findIndex(l => l.fn === fn); if (i >= 0) a.splice(i, 1); } }
function fireWindow(type, extra){
  const a = winListeners[type] || [];
  const ev = makeEvent(type, globalThis, extra);
  for (const l of a.slice()){ if (l.once) winRemove(type, l.fn); l.fn.call(globalThis, ev); }
  return ev;
}
const localStorageStub = {
  _data: Object.create(null),
  getItem(k){ return k in this._data ? this._data[k] : null; },
  setItem(k, v){ this._data[k] = String(v); },
  removeItem(k){ delete this._data[k]; },
  clear(){ this._data = Object.create(null); },
  key(i){ const k = Object.keys(this._data)[i]; return k === undefined ? null : k; }
};
Object.defineProperty(localStorageStub, 'length', { get(){ return Object.keys(this._data).length; } });

function matchMediaStub(q){
  q = String(q);
  let matches = false;
  if (/pointer\s*:\s*coarse/.test(q)) matches = IS_MOBILE;
  else if (/pointer\s*:\s*fine/.test(q)) matches = !IS_MOBILE;
  else if (/hover\s*:\s*none/.test(q)) matches = IS_MOBILE;
  else if (/hover\s*:\s*hover/.test(q)) matches = !IS_MOBILE;
  else if (/orientation\s*:\s*portrait/.test(q)) matches = globalThis.innerHeight >= globalThis.innerWidth;
  else if (/orientation\s*:\s*landscape/.test(q)) matches = globalThis.innerWidth > globalThis.innerHeight;
  else if (/max-width/.test(q)){ const m = q.match(/max-width\s*:\s*(\d+)/); matches = m ? globalThis.innerWidth <= +m[1] : false; }
  else if (/min-width/.test(q)){ const m = q.match(/min-width\s*:\s*(\d+)/); matches = m ? globalThis.innerWidth >= +m[1] : false; }
  else if (/prefers-reduced-motion/.test(q)) matches = false;
  return {
    matches, media: q, onchange: null,
    addListener(){}, removeListener(){},
    addEventListener(){}, removeEventListener(){}
  };
}
function applyViewport(){
  globalThis.innerWidth = IS_MOBILE ? 390 : 1280;
  globalThis.innerHeight = IS_MOBILE ? 844 : 720;
  globalThis.devicePixelRatio = IS_MOBILE ? 3 : 1;
  if (globalThis.screen){ globalThis.screen.width = globalThis.innerWidth; globalThis.screen.height = globalThis.innerHeight; }
}
const EXPORT_SNIPPET = '\n;globalThis.__X = { Game, UI, Save, LEVELS, DIFFICULTIES, ENEMY, ENEMY_META, TRAITS, WEAPONS, BR_MAPS, BR_POOLS, ENDLESS_WAVES, ENDLESS_BOSSES, OBSTACLES, waveCoinReward, levelWaveCoins };\n';

function installGlobals(){
  globalThis.window = globalThis;
  globalThis.document = documentStub;
  globalThis.addEventListener = (t, f, o) => winAdd(t, f, o);
  globalThis.removeEventListener = (t, f) => winRemove(t, f);
  globalThis.dispatchEvent = ev => fireWindow(ev && ev.type, ev);
  globalThis.requestAnimationFrame = cb => simRAF(cb);
  globalThis.cancelAnimationFrame = id => simCAF(id);
  globalThis.setTimeout = (fn, delay, ...args) => simSetTimeout(fn, delay, ...args);
  globalThis.clearTimeout = id => simClearTimer(id);
  globalThis.setInterval = (fn, delay, ...args) => simSetInterval(fn, delay, ...args);
  globalThis.clearInterval = id => simClearTimer(id);
  Object.defineProperty(globalThis, 'performance', {
    value: { now: () => clock.now, timeOrigin: 0, mark(){}, measure(){}, markResourceTiming(){}, getEntriesByName(){ return []; }, getEntriesByType(){ return []; }, clearMarks(){}, clearMeasures(){} },
    writable: true, configurable: true
  });
  globalThis.matchMedia = matchMediaStub;
  globalThis.localStorage = localStorageStub;
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      userAgent: IS_MOBILE
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      maxTouchPoints: IS_MOBILE ? 5 : 0,
      vibrate(){ return false; }
    },
    writable: true, configurable: true
  });
  applyViewport();
  globalThis.screen = {
    width: globalThis.innerWidth, height: globalThis.innerHeight,
    orientation: { type: IS_MOBILE ? 'portrait-primary' : 'landscape-primary', angle: IS_MOBILE ? 0 : 90 }
  };
  globalThis.location = { href: pathToFileURL(FILES.html).href, protocol: 'file:', search: '', hash: '' };
  globalThis.AudioContext = undefined;
  globalThis.webkitAudioContext = undefined;
  /* 联机引擎单测用的 mock Net（available=false，避免影响离线 UI 行为）；
     真实 Net 由 js/net.js 在浏览器里提供，Node 桩不加载它。 */
  const mockNet = {
    _sent: [],
    on: { status: [], peer: [], start: [], relay: [], err: [], room: [] },
    send(d){ this._sent.push(d); },
    available(){ return false; },
    status(){ return 'off'; },
    myId(){ return 'me'; },
    isHost(){ return false; },
    roomCode(){ return ''; },
    players(){ return []; },
    latency(){ return 0; },
    connect(){ return Promise.resolve({ ok: false, err: 'file:// 离线' }); },
    createRoom(){ return Promise.resolve({ ok: false, err: 'file:// 离线' }); },
    joinRoom(){ return Promise.resolve({ ok: false, err: 'file:// 离线' }); },
    ready(){}, startGame(){}, disconnect(){},
    autoUrl(){ return ''; },
    parseHash(){ return {}; },
    onRelay(){}, onStatus(){}, onPeer(){}, onStart(){}, onErr(){}, onRoom(){}, subscribe(){}, off(){}
  };
  globalThis.Net = mockNet;
  S.mockNet = mockNet;
}

/* ================= 加载业务代码 ================= */
function bootEnvironment(){
  installGlobals();
  vm.runInThisContext(fs.readFileSync(FILES.data, 'utf8'), { filename: FILES.data });
  if (fs.existsSync(FILES.levels)) vm.runInThisContext(fs.readFileSync(FILES.levels, 'utf8'), { filename: FILES.levels });
  vm.runInThisContext(fs.readFileSync(FILES.game, 'utf8'), { filename: FILES.game });
  vm.runInThisContext(fs.readFileSync(FILES.ui, 'utf8') + EXPORT_SNIPPET, { filename: FILES.ui });
  if (!globalThis.__X || !globalThis.__X.Game) throw new Error('无法从业务代码导出 __X（检查 vm 加载与追加导出片段）');
  S.X = globalThis.__X;
  S.Game = S.X.Game; S.UI = S.X.UI; S.Save = S.X.Save;
  S.Game.init();
  S.UI.init();
  S.loopCb = null;
  for (const r of clock.raf.values()){ if (!S.loopCb) S.loopCb = r.cb; }
}

/* ================= 通用断言 / 小工具 ================= */
function assert(cond, msg){ if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(actual, expected, msg){
  if (actual !== expected) throw new Error((msg || '值不相等') + `（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}
function assertClose(actual, expected, eps, msg){
  if (!(Math.abs(actual - expected) <= eps)) throw new Error((msg || '值超出误差') + `（期望 ${expected}±${eps}，实际 ${actual}）`);
}
function G_(){ return S.Game._dbg.G(); }
function RUN_(){ return S.Game.run(); }
function W_(id){ return S.X.WEAPONS[id]; }
function spawn(t, x, y, o){ return S.Game._dbg.spawn(t, x, y, o); }
function getStartBR(){
  if (typeof S.Game.startBR === 'function') return S.Game.startBR;
  const d = S.Game._dbg;
  if (d && typeof d.startBR === 'function') return d.startBR;
  return null;
}
function startBR(mapId){
  const fn = getStartBR();
  assert(fn, 'Game.startBR 不存在（大逃杀功能未完成）');
  const r = fn.call(S.Game, mapId);
  assert(r !== false, 'Game.startBR(' + mapId + ') 返回 false');
  return G_();
}
function circleRectOverlap(cx, cy, r, b){
  const x = Math.max(b.x, Math.min(cx, b.x + b.w));
  const y = Math.max(b.y, Math.min(cy, b.y + b.h));
  const dx = cx - x, dy = cy - y;
  return dx * dx + dy * dy < r * r - 1e-9;
}
function clearEnemies(){ const G = G_(); G.enemies.length = 0; G.markers.length = 0; }
/* 清场但保留一个远处的假敌人，避免 BR 胜利条件误触发 */
function prepBRSandbox(){
  const G = G_(), RUN = RUN_();
  G.enemies.length = 0; G.markers.length = 0;
  if (G.player) G.player.invuln = 1e9;
  if (RUN && RUN.br) RUN.br.total = 1e9;
  const d = spawn('tank', Math.max(120, G.world.w - 150), Math.max(120, G.world.h - 150), {});
  d.appear = 0; d.speed = 0; d.baseSpeed = 0; d.contactCd = 1e9;
  d.hp = d.maxHp = 1e9;
  return d;
}
function aimAtWorld(wx, wy){
  const G = G_();
  const cv = S.document.getElementById('cv');
  cv._fire('pointermove', makeEvent('pointermove', cv, {
    clientX: wx - G.cam.x, clientY: wy - G.cam.y, pointerType: 'mouse'
  }));
}
function holdFire(on){
  const cv = S.document.getElementById('cv');
  if (on){
    const G = G_();
    cv._fire('pointerdown', makeEvent('pointerdown', cv, {
      clientX: G.player.x - G.cam.x, clientY: G.player.y - G.cam.y, pointerType: 'mouse'
    }));
  } else {
    fireWindow('pointerup', { pointerType: 'mouse' });
  }
}
function wrapEvent(name){
  const prev = S.Game.events[name];
  const calls = [];
  const rec = { name, calls, prev, restore(){ S.Game.events[name] = prev; } };
  S.Game.events[name] = function(res){
    let prevErr = null;
    try { if (prev) prev(res); } catch (e){ prevErr = e; }
    if (prevErr) S.errors.push({ label: 'UI 事件处理 (' + name + ') 抛错', message: prevErr.stack || String(prevErr) });
    calls.push(res);
  };
  S.wrappers.push(rec);
  return rec;
}
/* 循环清完当前 run（战役/难度），用于回归 */
function clearCurrentRun(guardLimit){
  const G = G_();
  const seen = new Set();
  let guard = 0;
  while (S.Game.state() === 'playing' && guard++ < (guardLimit || 6000)){
    for (const e of G.enemies.slice()){
      if (!e.dead && !seen.has(e)){ seen.add(e); S.Game._dbg.kill(e); }
    }
    step(50);
    if (S.errors.length) break;
  }
  return seen.size;
}
function resetForTest(){
  while (S.wrappers.length){ try { S.wrappers.pop().restore(); } catch (e){} }
  S.errors.length = 0;
  clearTimers();
  applyViewport();
  localStorageStub._data = Object.create(null);
  try { S.Save.load(); } catch (e){ S.errors.push({ label: 'reset Save.load', message: e.stack || String(e) }); }
  try { fireWindow('blur'); } catch (e){}
  try { fireWindow('pointerup', { pointerType: 'mouse' }); } catch (e){}
  try { S.Game.stop(); } catch (e){}
  try { S.UI.goMenu(); } catch (e){ S.errors.push({ label: 'reset UI.goMenu', message: e.stack || String(e) }); }
  if (S.loopCb){
    let hasLoop = false;
    for (const r of clock.raf.values()) if (r.cb === S.loopCb) hasLoop = true;
    if (!hasLoop) simRAF(S.loopCb);
  }
}

/* ================= 用例注册 ================= */
const TESTS = [];
function test(def){ TESTS.push(def); }

/* 能力探测：依赖未完成时非 strict 模式 SKIP，strict 模式 FAIL */
function capBR(){
  if (getStartBR()) return null;
  return 'Game.startBR 尚未导出（task-1 大逃杀未完成）';
}
function capUIMobile(){
  const hasBRUI = typeof S.UI.goBR === 'function' || /goBR|start-br/.test(UI_SRC) || /data-act="br"/.test(HTML_SRC);
  const hasRotate = /id=["']rotate["']/.test(HTML_SRC) || /rotate/.test(UI_SRC);
  if (!hasBRUI) return 'UI 缺少大逃杀入口 goBR/play-br（task-2 未完成）';
  if (!hasRotate) return 'UI 缺少 #rotate 竖屏提示（task-2 未完成）';
  return null;
}
function capBrowser(){
  if (!/data-act="br"/.test(HTML_SRC) && !/start-br/.test(UI_SRC) && !/scrBR/.test(HTML_SRC)) return 'HTML/UI 尚无大逃杀入口（task-2 未完成）';
  if (!fs.existsSync(EDGE)) return '未找到 Edge：' + EDGE;
  return null;
}


/* ================= 报告辅助 ================= */
S.notes = [];
function note(msg){ S.notes.push(String(msg)); }

/* ================= G1 大逃杀开局 ================= */
function testBRStart(mapId){
  const map = S.X.BR_MAPS.find(m => m.id === mapId);
  assert(map, 'BR_MAPS 中没有地图 ' + mapId);
  const G = startBR(mapId);
  const RUN = RUN_();
  assertEq(RUN.mode, 'br', 'RUN.mode 应为 br');
  assertEq(G.world.w, map.w, '世界宽度应等于地图宽');
  assertEq(G.world.h, map.h, '世界高度应等于地图高');
  assertEq(G.bounds.l, 30, '边界 left 应为 30');
  assertEq(G.bounds.r, map.w - 30, '边界 right 应为 w-30');
  assertEq(G.enemies.length, map.enemies, '敌人数量应为 ' + map.enemies);
  if (RUN.br) assertEq(RUN.br.total, map.enemies, 'RUN.br.total');
  assert(G.player, '缺少玩家');
  assertEq(G.player.weapon, 'pistol_s', 'BR 开局武器应为 pistol_s');
  assertEq(G.player.magSize, S.X.WEAPONS.pistol_s.mag + RUN.st.magAdd, '开局 magSize');
  assertEq(G.player.mag, G.player.magSize, '开局应满弹匣');
  let minD = Infinity, minPair = null;
  const overlaps = [];
  for (let i = 0; i < G.enemies.length; i++){
    for (let j = i + 1; j < G.enemies.length; j++){
      const a = G.enemies[i], b = G.enemies[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < minD){ minD = d; minPair = [a, b]; }
      if (d < a.r + b.r - 1e-6) overlaps.push({ i, j, d, need: a.r + b.r });
    }
  }
  assert(overlaps.length === 0, '敌人互相重叠 ' + overlaps.length + ' 对，例：' + JSON.stringify(overlaps.slice(0, 3)));
  assert(minD > 60, '敌人最小中心间距 ' + minD.toFixed(1) + 'px 未 > 60px' +
    (minPair ? '（最近一对：(' + minPair[0].x.toFixed(1) + ',' + minPair[0].y.toFixed(1) + ') / (' + minPair[1].x.toFixed(1) + ',' + minPair[1].y.toFixed(1) + ')）' : ''));
  const inWall = [];
  for (const e of G.enemies){
    for (const b of G.obstacles){
      if (circleRectOverlap(e.x, e.y, e.r, b)) inWall.push({ type: e.type, x: +e.x.toFixed(1), y: +e.y.toFixed(1) });
    }
  }
  assert(inWall.length === 0, '有 ' + inWall.length + ' 个敌人刷在障碍里：' + JSON.stringify(inWall.slice(0, 3)));
  const near = G.enemies
    .map(e => ({ e, d: Math.hypot(e.x - G.player.x, e.y - G.player.y) }))
    .filter(o => o.d < 620 - 1e-6);
  assert(near.length === 0, '玩家出生点 620px 内有 ' + near.length + ' 个敌人，最近 ' + (near.length ? near[0].d.toFixed(1) : '-') + 'px');
  note('map' + mapId + ' 敌人数=' + G.enemies.length + ' 最小间距=' + minD.toFixed(1) + 'px 出生点=(' + G.player.x.toFixed(0) + ',' + G.player.y.toFixed(0) + ')');
}
test({ id: 'G1.1', group: '1', name: 'BR 开局 · 地图1(1800x1200, 24敌)', profiles: ['desktop'], capability: capBR, fn: () => testBRStart(1) });
test({ id: 'G1.2', group: '1', name: 'BR 开局 · 地图2(2600x1700, 38敌)', profiles: ['desktop'], capability: capBR, fn: () => testBRStart(2) });
test({ id: 'G1.3', group: '1', name: 'BR 开局 · 地图3(3400x2200, 56敌)', profiles: ['desktop'], capability: capBR, fn: () => testBRStart(3) });

/* ================= G2 拾取换枪 ================= */
function testBRPickupSwap(){
  const G = startBR(1);
  prepBRSandbox();
  const p = G.player;
  assert(G.loot.length > 0, 'BR 地图未生成战利品 loot');
  const loot = G.loot.find(x => x.weapon !== 'pistol_s') || G.loot[0];
  loot.weapon = 'pistol_h';
  const oldId = p.weapon;
  let picked = false;
  for (let i = 0; i < 40 && !picked; i++){
    p.x = loot.x; p.y = loot.y; p.vx = 0; p.vy = 0;
    step(50);
    picked = (p.weapon === 'pistol_h');
  }
  assert(picked, '站上战利品后未换枪（weapon=' + p.weapon + '）');
  assertEq(loot.weapon, oldId, '旧武器应留在原地供换回');
  let back = false;
  for (let i = 0; i < 40 && !back; i++){
    p.x = loot.x; p.y = loot.y; p.vx = 0; p.vy = 0;
    step(50);
    back = (p.weapon === oldId);
  }
  assert(back, '没能换回旧武器（weapon=' + p.weapon + '，地面=' + loot.weapon + '）');
}
test({ id: 'G2.1', group: '2', name: 'BR 拾取换枪 · 旧枪留在原地且可换回', profiles: ['desktop'], capability: capBR, fn: testBRPickupSwap });

function testBRKnifePickup(){
  const G = startBR(1);
  prepBRSandbox();
  const p = G.player;
  assert(G.loot.length > 0, 'BR 地图未生成战利品 loot');
  const loot = G.loot[0];
  loot.weapon = 'knife';
  let picked = false;
  for (let i = 0; i < 40 && !picked; i++){
    p.x = loot.x; p.y = loot.y; p.vx = 0; p.vy = 0;
    step(50);
    picked = (p.weapon === 'knife');
  }
  assert(picked, '未拾取到匕首（weapon=' + p.weapon + '）');
  assertEq(W_('knife').kind, 'melee', '匕首 kind 应为 melee');
  assertEq(p.mag, 0, '拿匕首时弹匣应为 0');
  assert(Number.isFinite(p.magSize) && p.magSize === 0, '匕首 magSize 应为有限值 0（防 NaN 回归），实际 ' + p.magSize);
  note('匕首 magSize=0 且有限，NaN 回归防护通过');
  G.obstacles.length = 0;
  p.x = Math.max(G.bounds.l + 80, Math.min(G.bounds.r - 80, loot.x + 200));
  p.y = Math.max(G.bounds.t + 80, Math.min(G.bounds.b - 80, loot.y));
  p.vx = 0; p.vy = 0; p.pickCd = 0;
  step(50);
  const bullets0 = G.bullets.length;
  holdFire(true);
  for (let i = 0; i < 20; i++){ aimAtWorld(p.x + 300, p.y); step(50); }
  holdFire(false);
  assertEq(p.weapon, 'knife', '近战开火后武器不应变化');
  assertEq(p.mag, 0, '匕首开火不应消耗子弹');
  assert(G.bullets.length === bullets0, '匕首开火不应产生玩家子弹（' + bullets0 + ' -> ' + G.bullets.length + '）');
}
test({ id: 'G2.2', group: '2', name: 'BR 拾取匕首 · kind=melee 且开火不耗弹', profiles: ['desktop'], capability: capBR, fn: testBRKnifePickup });

/* ================= G3 匕首近战方向性 ================= */
function testKnifeMeleeDirection(){
  const G = startBR(1);
  prepBRSandbox();
  G.obstacles.length = 0;
  const p = G.player;
  p.x = 100; p.y = 100; p.vx = 0; p.vy = 0;
  step(200);
  assert(G.cam.x === 0 && G.cam.y === 0, '前置条件：玩家在左上角时镜头应为 (0,0)');
  p.weapon = 'knife'; p.mag = 0; p.magSize = 0; p.fireCd = 0; p.aim = 0;
  const front = spawn('chaser', p.x + 30, p.y, {});
  front.appear = 0; front.speed = 0; front.baseSpeed = 0; front.contactCd = 1e9; front.hp = 1;
  holdFire(true);
  let hit = false;
  for (let i = 0; i < 40 && !hit; i++){
    aimAtWorld(p.x + 300, p.y);
    step(50);
    hit = (front.dead || front.hp <= 0);
  }
  holdFire(false);
  assert(hit, '正前方 30px 的敌人未被匕首命中（hp=' + front.hp + '/' + front.maxHp + '，dead=' + front.dead + '）');
  note('正面 30px 匕首可命中');
  clearEnemies();
  const back = spawn('chaser', p.x - 30, p.y, {});
  back.appear = 0; back.speed = 0; back.baseSpeed = 0; back.contactCd = 1e9;
  const hp0 = back.hp;
  holdFire(true);
  for (let i = 0; i < 30; i++){ aimAtWorld(p.x + 300, p.y); step(50); }
  holdFire(false);
  assert(!back.dead && back.hp === hp0, '背后的敌人不应被匕首命中（hp ' + hp0 + ' -> ' + back.hp + '，dead=' + back.dead + '）');
  note('背后 30px 匕首不掉血（方向性正确）');
}
test({ id: 'G3.1', group: '3', name: '匕首近战 · 正面命中 / 背后不掉血', profiles: ['desktop'], capability: capBR, fn: testKnifeMeleeDirection });

function testBRAimWithCamera(){
  const G = startBR(1);
  prepBRSandbox();
  G.obstacles.length = 0;
  const p = G.player;
  p.x = G.world.w / 2; p.y = G.world.h / 2; p.vx = 0; p.vy = 0; p.aim = 0;
  step(1500);
  assert(G.cam.x > 100, '前置条件：地图中央时镜头应已向右偏移（cam.x=' + G.cam.x + '）');
  aimAtWorld(p.x + 300, p.y);          // 鼠标指向玩家右侧（屏幕坐标 = 世界坐标 - 镜头）
  step(150);
  assertClose(Math.cos(p.aim), 1, 0.05, '鼠标指向 +x 时 p.aim 应约等于 0（说明瞄准补偿了镜头偏移）');
  note('cam.x=' + G.cam.x.toFixed(0) + ' 鼠标指向 +x 后 p.aim=' + p.aim.toFixed(3) + '（cos=' + Math.cos(p.aim).toFixed(3) + '）');
}
test({ id: 'G3.2', group: '3', name: 'BR 鼠标瞄准 · 大世界摄像机偏移下方向正确', profiles: ['desktop'], capability: capBR, fn: testBRAimWithCamera });

/* ================= G4 杀光胜利 ================= */
function testBRWin(){
  const X = S.X, Game = S.Game, map = X.BR_MAPS[0];
  localStorageStub._data = Object.create(null); S.Save.load();
  const w1 = wrapEvent('onWin');
  startBR(1);
  const G = G_(), RUN = RUN_();
  assertEq(G.enemies.length, map.enemies, '开局敌人数');
  G.player.invuln = 1e9;
  const coins0 = S.Save.data.coins;
  let killGuard = 0;
  while (G.enemies.length && killGuard++ < 200){
    for (const e of G.enemies.slice()) if (!e.dead) Game._dbg.kill(e);
    step(50);
  }
  const totalAfter = RUN.br ? RUN.br.total : map.enemies;
  assert(RUN.br && RUN.br.total >= map.enemies, 'BR 总敌人数应不少于地图配置');
  note('清场后 killed=' + (RUN.br ? RUN.br.killed : 'n/a') + '/' + totalAfter + '（含分裂产生的小怪） state=' + Game.state() + '');
  assert(stepUntil(() => w1.calls.length > 0, 8000, 50), '清空全部敌人后 8 秒内未触发 Game.events.onWin');
  const res = w1.calls[w1.calls.length - 1];
  assertEq(res.mode, 'br', 'res.mode 应为 br');
  assert(res.win === true, 'res.win 应为 true（由 UI.onWin 包装写入）');
  assertEq(res.kills, totalAfter, 'res.kills 应等于结算总敌人数（含分裂小怪）');
  assertEq(res.total, totalAfter, 'res.total 应等于结算总敌人数');
  assertEq(RUN.br.killed, totalAfter, 'RUN.br.killed 应等于结算总敌人数');
  note('已由 Lead 清理：BR 只剩 RUN.br 一个真相源，G.br 死状态已移除');
  assert(res.reward > 0, '首次 BR 胜利 reward 应 > 0（实际 ' + res.reward + '）');
  assert(S.Save.data.coins > coins0, '首次 BR 胜利应发金币（' + coins0 + ' -> ' + S.Save.data.coins + '）');
  note('首次胜利 reward=' + res.reward + '，金币 ' + coins0 + ' -> ' + S.Save.data.coins + '；res.first=' + res.first);
  const w2 = wrapEvent('onWin');
  const coins1 = S.Save.data.coins;
  startBR(1);
  const G2 = G_();
  G2.player.invuln = 1e9;
  let killGuard2 = 0;
  while (G2.enemies.length && killGuard2++ < 200){
    for (const e of G2.enemies.slice()) if (!e.dead) Game._dbg.kill(e);
    step(50);
  }
  const total2 = RUN_().br ? RUN_().br.total : map.enemies;
  assert(stepUntil(() => w2.calls.length > 0, 8000, 50), '第二次清空后 8 秒内未触发 onWin');
  const res2 = w2.calls[w2.calls.length - 1];
  assertEq(res2.kills, total2, '第二次 res.kills 应等于总敌人数');
  assertEq(res2.first, false, '重复胜利应带 first=false');
  assertEq(res2.reward, 0, '重复胜利 reward 应为 0');
  assertEq(S.Save.data.coins, coins1, '重复胜利不应再发金币');
  note('重复胜利 first=false / reward=0 / 金币不变');
}
test({ id: 'G4.1', group: '4', name: 'BR 杀光胜利 · 首次发奖 / 重复不发', profiles: ['desktop'], capability: capBR, fn: testBRWin });

/* ================= G5 摄像机 ================= */
function testBRCamera(){
  const VIEW_W = 960, VIEW_H = 540;
  const G = startBR(1);
  prepBRSandbox();
  G.obstacles.length = 0;
  const p = G.player, world = G.world, b = G.bounds;
  const corners = [
    { x: b.l + 40, y: b.t + 40, tag: '左上' },
    { x: b.r - 40, y: b.t + 40, tag: '右上' },
    { x: b.r - 40, y: b.b - 40, tag: '右下' },
    { x: b.l + 40, y: b.b - 40, tag: '左下' }
  ];
  for (const c of corners){
    p.x = c.x; p.y = c.y; p.vx = 0; p.vy = 0;
    step(1200);
    assert(G.cam.x >= -0.5 && G.cam.x <= world.w - VIEW_W + 0.5, c.tag + ': cam.x=' + G.cam.x.toFixed(1) + ' 越界 [0, ' + (world.w - VIEW_W) + ']');
    assert(G.cam.y >= -0.5 && G.cam.y <= world.h - VIEW_H + 0.5, c.tag + ': cam.y=' + G.cam.y.toFixed(1) + ' 越界 [0, ' + (world.h - VIEW_H) + ']');
    const sx = p.x - G.cam.x, sy = p.y - G.cam.y;
    assert(sx >= -0.5 && sx <= VIEW_W + 0.5 && sy >= -0.5 && sy <= VIEW_H + 0.5, c.tag + ': 玩家不在镜头内 (' + sx.toFixed(1) + ', ' + sy.toFixed(1) + ')');
    note(c.tag + ' cam=(' + G.cam.x.toFixed(0) + ',' + G.cam.y.toFixed(0) + ') 玩家屏幕=(' + sx.toFixed(0) + ',' + sy.toFixed(0) + ')');
  }
  p.x = world.w / 2; p.y = world.h / 2; p.vx = 0; p.vy = 0;
  step(1500);
  assertClose(p.x - G.cam.x, VIEW_W / 2, 2, '地图中央时玩家应大致居中 x');
  assertClose(p.y - G.cam.y, VIEW_H / 2, 2, '地图中央时玩家应大致居中 y');
}
test({ id: 'G5.1', group: '5', name: 'BR 摄像机 · 四角夹紧且玩家在镜内', profiles: ['desktop'], capability: capBR, fn: testBRCamera });

/* ================= G6 边界与子弹回收 ================= */
function testBRBounds(){
  const G = startBR(1);
  prepBRSandbox();
  G.obstacles.length = 0;
  const p = G.player, b = G.bounds;
  p.x = -500; p.y = -500; p.vx = -800; p.vy = -800;
  step(500);
  assert(p.x >= b.l + p.r - 1e-6 && p.y >= b.t + p.r - 1e-6, '玩家未被夹在左上边界内（' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + '）');
  p.x = G.world.w + 500; p.y = G.world.h + 500; p.vx = 800; p.vy = 800;
  step(500);
  assert(p.x <= b.r - p.r + 1e-6 && p.y <= b.b - p.r + 1e-6, '玩家未被夹在右下边界内（' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + '）');
  note('边界夹紧正常 [' + b.l + ',' + b.t + ']-[' + b.r + ',' + b.b + ']');
}
test({ id: 'G6.1', group: '6', name: 'BR 边界 · 玩家被限制在 bounds 内', profiles: ['desktop'], capability: capBR, fn: testBRBounds });

function testBulletWorldRecycle(){
  const G = startBR(1);
  prepBRSandbox();
  G.obstacles.length = 0;
  const p = G.player;
  G.bullets.length = 0;
  G.bullets.push({ x: G.world.w + 40, y: 100, vx: 100, vy: 0, r: 4.5, dmg: 1, life: 5, hit: [], crit: false });
  G.bullets.push({ x: -40, y: 100, vx: -100, vy: 0, r: 4.5, dmg: 1, life: 5, hit: [], crit: false });
  step(50);
  assertEq(G.bullets.length, 0, '飞出世界边界的子弹应被回收');
  p.x = G.world.w / 2; p.y = G.world.h / 2; p.aim = 0;
  aimAtWorld(p.x + 400, p.y);
  holdFire(true);
  const emptied = stepUntil(() => G.bullets.length === 0, 4000, 50);
  holdFire(false);
  assert(emptied, '实际发射的子弹在 4 秒后仍未回收（剩 ' + G.bullets.length + '）');
}
test({ id: 'G6.2', group: '6', name: 'BR 子弹 · 飞出世界被回收', profiles: ['desktop'], capability: capBR, fn: testBulletWorldRecycle });

/* ================= G7 回归：战役 / 难度 / 障碍 ================= */
function testCampaignClearAndCoins(){
  const X = S.X, Game = S.Game;
  localStorageStub._data = Object.create(null); S.Save.load();
  const w1 = wrapEvent('onWin');
  assert(Game.startCampaign(1), 'Game.startCampaign(1) 返回 false');
  const G = G_();
  G.player.invuln = 1e9;
  const killed = clearCurrentRun(6000);
  assertEq(Game.state(), 'over', '普通关通关后状态应为 over');
  step(1000);
  assert(w1.calls.length >= 1, '通关未触发 Game.events.onWin');
  const res = w1.calls[w1.calls.length - 1];
  assertEq(res.mode, 'campaign', 'res.mode');
  assertEq(res.win, true, 'res.win');
  assertEq(res.kills, 11, '第 1 关总击杀数');
  assertEq(res.first, true, '首次通关 first 应为 true');
  assertEq(res.stars, 3, '满血通关应 3 星');
  const perWave = X.levelWaveCoins(X.LEVELS[0]);
  assertEq(res.coins, perWave, '通关本局金币应为每波之和 ' + perWave);
  assertEq(S.Save.data.coins, perWave, '存档金币');
  assertEq(S.Save.levelStars(1), 3, '存档星级');
  note('普通关清空 ' + killed + ' 只，首通金币 +' + perWave + '，3 星');
  clearTimers();   // 取消失败结算页的 4 秒自动返回，避免污染第二次挑战
  const w2 = wrapEvent('onWin');
  const coins1 = S.Save.data.coins;
  assert(Game.startCampaign(1), '重复 startCampaign(1) 返回 false');
  G_().player.invuln = 1e9;
  clearCurrentRun(6000);
  assertEq(Game.state(), 'over', '重复通关后状态');
  step(1000);
  assert(w2.calls.length >= 1, '重复通关未触发 onWin');
  const res2 = w2.calls[w2.calls.length - 1];
  assertEq(res2.first, false, '重复通关 first 应为 false');
  assertEq(res2.coins, 0, '重复通关本局金币应为 0');
  assertEq(S.Save.data.coins, coins1, '重复通关不应增加存档金币');
  note('重复通关不再发金币');
}
test({ id: 'G7.1', group: '7', name: '回归 · 战役第1关通关 + 每波金币 + 重复不发', profiles: ['desktop'], fn: testCampaignClearAndCoins });

function testObstacleBlocksBullet(){
  const Game = S.Game;
  assert(Game.startCampaign(2), 'startCampaign(2) 返回 false');
  const G = G_();
  const p = G.player;
  G.enemies.length = 0; G.markers.length = 0;
  p.invuln = 1e9; p.x = 150; p.y = 151; p.vx = 0; p.vy = 0;
  G.bullets.length = 0;
  G.bullets.push({ x: 200, y: 151, vx: 600, vy: 0, r: 4.5, dmg: 10, life: 2, hit: [], crit: false });
  step(200);
  assertEq(G.bullets.length, 0, '撞柱子的子弹应被回收');
  const e = spawn('chaser', 400, 100, {});
  e.appear = 0; e.speed = 0; e.baseSpeed = 0; e.contactCd = 1e9;
  const hp0 = e.hp;
  G.bullets.length = 0;
  G.bullets.push({ x: 200, y: 100, vx: 600, vy: 0, r: 4.5, dmg: 10, life: 2, hit: [], crit: false });
  step(600);
  assert(e.hp < hp0 || e.dead, '无遮挡的子弹应命中敌人（hp ' + hp0 + ' -> ' + e.hp + '，dead=' + e.dead + '）');
  assertEq(G.bullets.length, 0, '命中后的子弹应被回收');
  note('柱子挡弹 + 无遮挡可命中，均正常');
}
test({ id: 'G7.2', group: '7', name: '回归 · 障碍物挡子弹', profiles: ['desktop'], fn: testObstacleBlocksBullet });

function testEndlessCheatsAndCoins(){
  const Game = S.Game, X = S.X;
  assert(Game.startEndless(4), 'startEndless(4) 返回 false');
  const RUN = RUN_();
  assertEq(RUN.mode, 'endless', 'RUN.mode');
  assertEq(RUN.tier.id, 4, 'RUN.tier.id');
  assertEq(RUN.cheats.length, 9, '第四档应有 9 项外挂');
  assert(RUN.cheats.indexOf('speed') >= 0 && RUN.cheats.indexOf('shield') >= 0, '第四档应含 speed/shield 外挂');
  assertEq(RUN.coinMul, 4, 'coinMul');
  assertEq(RUN.scoreMul, 3, 'scoreMul');
  const G = G_();
  G.enemies.length = 0;
  const e = spawn('chaser', G.player.x + 300, G.player.y, {});
  assertClose(e.speed, X.ENEMY.chaser.speed * 1.25, 1e-6, '第四档敌人速度应 +25%');
  G.player.invuln = 1e9;
  S.Save.data.coins = 0;
  let guard = 0;
  while (RUN.wave < 1 && guard++ < 400){
    for (const en of G.enemies.slice()) if (!en.dead) Game._dbg.kill(en);
    step(50);
  }
  assertEq(RUN.wave, 1, '第一波应已开始');
  guard = 0;
  while (RUN.wave === 1 && guard++ < 4000){
    for (const en of G.enemies.slice()) if (!en.dead) Game._dbg.kill(en);
    step(50);
    if (S.errors.length) break;
  }
  assertEq(RUN.wave, 2, '第一波清完后应进入第二波');
  const expect = X.waveCoinReward({ mode: 'endless', wave: 1, mul: 4 });
  assertEq(S.Save.data.coins, expect, '难四第一波金币应为 ' + expect);
  assertEq(RUN.coins, expect, 'RUN.coins');
  note('难四首波金币 +' + expect + '（含 x4 系数）');
}
test({ id: 'G7.3', group: '7', name: '回归 · 难四外挂生效 + 每波金币x4', profiles: ['desktop'], fn: testEndlessCheatsAndCoins });

/* ================= G8 移动端路径（mobile profile） ================= */
function elShown(el){
  if (!el) return false;
  if (el.classList.contains('on')) return true;
  const d = String(el.style.display || '');
  if (d && d !== 'none') return true;
  const o = String(el.style.opacity || '');
  if (o && o !== '0') return true;
  if (el.hidden === false && (el.style.display === 'flex' || el.style.display === 'block')) return true;
  return false;
}
function clickDataAct(act, id){
  const btn = S.document.createElement('button');
  btn.setAttribute('data-act', act);
  if (id !== undefined) btn.setAttribute('data-id', String(id));
  S.document.body._fire('click', makeEvent('click', btn));
  return btn;
}
function testMobilePath(){
  assert(IS_MOBILE, '该用例只能在 mobile profile 运行');
  const doc = S.document, Game = S.Game, UI = S.UI;
  assert(globalThis.matchMedia('(pointer: coarse)').matches === true, 'matchMedia(pointer:coarse) 桩应命中');
  assertEq(Game.showTouch !== undefined, true, '缺少 Game.showTouch');
  /* 竖屏尺寸下，竖屏提示应显示 */
  applyViewport();
  fireWindow('resize');
  UI.show('menu');
  const rotate = doc.getElementById('rotate');
  assert(rotate, '缺少 #rotate 元素');
  assert(elShown(rotate), '竖屏 + 粗指针时 #rotate 提示应显示（class="on"/style 可见）');
  note('竖屏 matchMedia coarse -> #rotate 显示');
  /* Game.showTouch 生效 */
  Game.showTouch(true);
  assert(elShown(doc.getElementById('touch')), 'Game.showTouch(true) 后 #touch 应显示');
  Game.showTouch(false);
  assert(!elShown(doc.getElementById('touch')), 'Game.showTouch(false) 后 #touch 应隐藏');
  /* 主菜单战绩面板 + body.touch */
  const menuBR = doc.getElementById('menuBR');
  assert(menuBR && String(menuBR.innerHTML).indexOf(S.X.BR_MAPS[0].name) >= 0, '#menuBR 应显示大逃杀地图战绩');
  assert(doc.body.classList.contains('touch'), '移动端 body 应有 touch 类');
  /* goBR -> 地图卡选择 -> start-br 流程 */
  UI.goBR();
  const grid = doc.getElementById('brGrid');
  const cardCount = (String(grid.innerHTML).match(/data-act="sel-br"/g) || []).length;
  assertEq(cardCount, 3, '#brGrid 应渲染 3 张地图卡');
  clickDataAct('sel-br', 2);
  assert(String(doc.getElementById('brDetail').innerHTML).indexOf(S.X.BR_MAPS[1].name) >= 0, '#brDetail 应切换为地图2');
  clickDataAct('sel-br', 1);
  clickDataAct('start-br');
  assertEq(Game.state(), 'playing', '进入 BR 后状态应为 playing');
  const RUN = Game.run();
  assert(RUN && RUN.mode === 'br', '进入 BR 后 run().mode 应为 br');
  assert(RUN.map && RUN.map.id === 1, '应进入地图 1');
  assert(doc.getElementById('brChip').style.display !== 'none', '游戏中 #brChip 应显示');
  assert(elShown(doc.getElementById('touch')), '游戏中触屏控件应显示');
  assert(elShown(rotate), '竖屏游戏中 #rotate 仍应显示');
  note('UI goBR(1) -> Game.startBR -> playing，触屏控件显示');
  /* 横屏后提示消失 */
  globalThis.innerWidth = 844; globalThis.innerHeight = 390;
  if (globalThis.screen){ globalThis.screen.width = 844; globalThis.screen.height = 390; }
  fireWindow('resize');
  fireWindow('orientationchange');
  UI.show(null);
  assert(!elShown(rotate), '横屏时 #rotate 提示应隐藏');
  note('横屏 -> #rotate 隐藏');
  /* 回到竖屏应恢复 */
  applyViewport();
  fireWindow('resize');
  UI.show(null);
  assert(elShown(rotate), '回到竖屏 #rotate 应重新显示');
}
function capUIMobileFull(){
  const base = capUIMobile();
  if (base) return base;
  if (!getStartBR()) return 'Game.startBR 尚未导出（task-1 大逃杀未完成）';
  return null;
}
test({ id: 'G8.1', group: '8', name: '移动端 · 竖屏提示 + 触屏控件 + goBR 进游戏', profiles: ['mobile'], capability: capUIMobileFull, fn: testMobilePath });

/* ================= G9 浏览器冒烟（Edge headless） ================= */
const realSleep = ms => new Promise(res => require('timers').setTimeout(res, ms));
const realSetTimeout = require('timers').setTimeout;
class EnvSkip extends Error { constructor(m){ super(m); this.isEnv = true; } }
function killTree(child){
  try { if (child && child.pid) cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e){}
}
function rmrf(p){ try { fs.rmSync(p, { recursive: true, force: true }); } catch (e){} }
function openCDP(wsUrl){
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e){ return reject(new EnvSkip('WebSocket 创建失败: ' + e.message)); }
    const pending = new Map();
    let seq = 0;
    let settled = false;
    const to = realSetTimeout(() => { if (!settled){ settled = true; try { ws.close(); } catch (e){} reject(new EnvSkip('CDP 连接超时')); } }, 15000);
    const api = {
      send(method, params){
        return new Promise((res, rej) => {
          const id = ++seq;
          const timer = realSetTimeout(() => { if (pending.has(id)){ pending.delete(id); rej(new EnvSkip('CDP ' + method + ' 超时')); } }, 20000);
          pending.set(id, {
            res: v => { clearTimeout(timer); res(v); },
            rej: e => { clearTimeout(timer); rej(e); }
          });
          try { ws.send(JSON.stringify({ id, method, params: params || {} })); }
          catch (e){ pending.delete(id); clearTimeout(timer); rej(e); }
        });
      },
      close(){ try { ws.close(); } catch (e){} }
    };
    ws.onopen = () => { if (!settled){ settled = true; clearTimeout(to); resolve(api); } };
    ws.onerror = () => { if (!settled){ settled = true; clearTimeout(to); reject(new EnvSkip('CDP WebSocket 连接失败')); } };
    ws.onmessage = ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e){ return; }
      if (msg && msg.id && pending.has(msg.id)){
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.rej(new Error('CDP error: ' + JSON.stringify(msg.error)));
        else p.res(msg.result);
      }
    };
  });
}
async function testBrowserSmoke(){
  const url = pathToFileURL(FILES.html).href;
  if (!fs.existsSync(EDGE)) throw new EnvSkip('未找到 Edge: ' + EDGE);
  const uncaught = [];
  const onUncaught = e => uncaught.push(e);
  process.on('uncaughtException', onUncaught);
  /* ① dump-dom：主菜单渲染 + 大逃杀按钮 */
  const dumpOnce = targetUrl => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg2d-dom-'));
    try {
      const args = ['--headless','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check',
        '--disable-extensions','--disable-sync','--user-data-dir=' + tmp,'--virtual-time-budget=4000','--dump-dom', targetUrl];
      const r = cp.spawnSync(EDGE, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
      if (r.error) throw new EnvSkip('Edge dump-dom 启动失败: ' + r.error.message);
      return { dom: r.stdout || '', err: String(r.stderr || '') };
    } finally { rmrf(tmp); }
  };
  const assertNoPageError = (label, out) => {
    assert(out.dom.indexOf('NAVERR') < 0 && out.err.indexOf('NAVERR') < 0, label + ': 出现 NAVERR');
    const bad = out.err.split(/\r?\n/).filter(l => /Uncaught|ReferenceError|SyntaxError|NAVERR/.test(l));
    assert(bad.length === 0, label + ': 浏览器报错 ' + bad.slice(0, 3).join(' | '));
  };
  const plain = dumpOnce(url);
  assert(plain.dom.indexOf('id="scrMenu"') >= 0, 'dump-dom 未包含主菜单 scrMenu');
  assert(plain.dom.indexOf('data-act="br"') >= 0, '主菜单缺少大逃杀按钮 [data-act="br"]');
  assert(plain.dom.indexOf('menuStats') >= 0 && plain.dom.indexOf('金币') >= 0, '主菜单数据面板未渲染（可能启动 JS 抛错）');
  assertNoPageError('主菜单 dump-dom', plain);
  note('dump-dom 主菜单：大逃杀按钮存在，无 NAVERR/JS 报错');
  const brPage = dumpOnce(url + '#br');
  assert(brPage.dom.indexOf('id="scrBR"') >= 0, 'DOM 缺少大逃杀页面 scrBR');
  assert(/class="[^"]*\bon\b[^"]*"[^>]*id="scrBR"/.test(brPage.dom), '#br 应直接进入大逃杀页（scrBR 带 on）');
  const cards = (brPage.dom.match(/data-act="sel-br"/g) || []).length;
  assert(cards >= 3, '#brGrid 应渲染 3 张地图卡（实际 ' + cards + '）');
  assert(brPage.dom.indexOf('data-act="start-br"') >= 0, '大逃杀页缺少 start-br 按钮');
  assertNoPageError('大逃杀页 dump-dom', brPage);
  note('dump-dom #br 直入大逃杀页：3 张地图卡 + 开始按钮，无 NAVERR/JS 报错');
  /* ② CDP：真实浏览器里点击大逃杀按钮并进入 BR */
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bg2d-cdp-'));
  const pf = path.join(tmp2, 'DevToolsActivePort');
  const child = cp.spawn(EDGE, ['--headless','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check',
    '--disable-extensions','--disable-sync','--remote-debugging-port=0','--user-data-dir=' + tmp2, url], { stdio: 'ignore' });
  let cdp = null;
  try {
    let port = 0;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !port){
      await realSleep(300);
      if (fs.existsSync(pf)){
        const lines = fs.readFileSync(pf, 'utf8').split(/\r?\n/);
        port = parseInt(lines[0], 10) || 0;
      }
    }
    if (!port) throw new EnvSkip('Edge 未在 30s 内暴露 DevTools 端口（首次运行可能被挂起拦截）');
    let list = null, lastFetchErr = null;
    for (let i = 0; i < 20 && !list; i++){
      try { list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); }
      catch (e){ lastFetchErr = e; await realSleep(400); }
    }
    if (!list) throw new EnvSkip('无法访问 DevTools 列表: ' + (lastFetchErr && lastFetchErr.message));
    const page = (list || []).find(t => t.type === 'page' && /index\.html/i.test(t.url || '')) || (list || [])[0];
    if (!page || !page.webSocketDebuggerUrl) throw new EnvSkip('DevTools 未返回可调试页面');
    cdp = await openCDP(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.__bg2dErrors=[];window.addEventListener("error",function(e){window.__bg2dErrors.push(String(e.message||e.error))});window.addEventListener("unhandledrejection",function(e){window.__bg2dErrors.push("rejection:"+String(e.reason))});'
    });
    await cdp.send('Page.reload', { ignoreCache: true });
    const evalExpr = async expr => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r && r.exceptionDetails) throw new Error('页面 evaluate 异常: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++){
      await realSleep(250);
      try { ready = await evalExpr('(typeof Game!==undefined) && (typeof UI!==undefined) && !!document.getElementById("scrMenu")'); } catch (e){}
    }
    assert(ready, '真实浏览器中页面 15s 内未完成初始化');
    const errs1 = await evalExpr('window.__bg2dErrors.slice()');
    assert(!errs1 || errs1.length === 0, '页面初始化 JS 错误: ' + JSON.stringify(errs1));
    const hasBtn = await evalExpr('!!document.querySelector("[data-act=\\"br\\"]")');
    assert(hasBtn, '真实浏览器主菜单没有大逃杀按钮');
    await evalExpr('(function(){var b=document.querySelector("[data-act=\\"br\\"]");if(b){b.click();}return true;})()');
    await realSleep(500);
    const hasStart = await evalExpr('!!document.querySelector("[data-act=\\"start-br\\"]")');
    assert(hasStart, '大逃杀页面缺少开始按钮 [data-act="start-br"]');
    await evalExpr('(function(){var b=document.querySelector("[data-act=\\"start-br\\"]");if(b){b.click();}return true;})()');
    await realSleep(900);
    const st = await evalExpr('({state:Game.state(),mode:(Game.run()&&Game.run().mode)||null})');
    assert(st && st.state === 'playing' && st.mode === 'br', '真实浏览器点击大逃杀后未进入 BR: ' + JSON.stringify(st));
    const errs2 = await evalExpr('window.__bg2dErrors.slice()');
    assert(!errs2 || errs2.length === 0, '进入 BR 后出现 JS 错误: ' + JSON.stringify(errs2));
    note('CDP: 点击大逃杀按钮 -> Game.state()=playing, run().mode=br，无 JS 错误');
  } finally {
    if (cdp) cdp.close();
    killTree(child);
    await realSleep(500);
    rmrf(tmp2);
    process.removeListener('uncaughtException', onUncaught);
  }
  if (uncaught.length) throw new EnvSkip('浏览器子进程/WebSocket 异常: ' + (uncaught[0] && uncaught[0].message));
}
test({ id: 'G9.1', group: '9', name: 'Edge headless 冒烟 · 主菜单/进入 BR/无 JS 错误', profiles: ['desktop'], requiresBrowser: true, capability: capBrowser, fn: testBrowserSmoke });

/* ================= 补充：HUD 大逃杀集成 ================= */
function testBRHudChips(){
  const Game = S.Game, doc = S.document;
  assert(Game.startCampaign(1), 'startCampaign(1) 返回 false');
  step(120);
  const brChip = doc.getElementById('brChip');
  assertEq(brChip.style.display, 'none', '非 BR 模式 #brChip 应 display:none');
  const G = startBR(1);
  step(200);
  assert(brChip.style.display !== 'none', 'BR 模式 #brChip 应显示');
  const left = doc.getElementById('brLeft');
  const total = RUN_().br.total;
  assertEq(left.textContent, String(total), 'BR 初始剩余敌人数');
  assertEq(doc.getElementById('hudWeapon').textContent, S.X.WEAPONS.pistol_s.name, '#hudWeapon 应显示小手枪');
  const victim = G.enemies.find(e => !e.dead && e.type !== 'splitter' && e.type !== 'mini');
  assert(victim, '找不到可用于测试的非分裂敌人');
  Game._dbg.kill(victim);
  step(200);
  assertEq(left.textContent, String(total - 1), '击杀一个非分裂敌人后剩余数应 -1');
  note('非 BR 隐藏 #brChip；BR 显示剩余敌人并随击杀更新；#hudWeapon 正确');
}
test({ id: 'G1.4', group: '1', name: 'BR HUD · brChip 显隐 / 剩余敌人 / hudWeapon', profiles: ['desktop'], capability: capBR, fn: testBRHudChips });

/* ================= 补充：三张地图首胜奖励 / 重复 0 ================= */
function clearBRRun(Game, G){
  let guard = 0;
  while (guard++ < 1200){
    for (const e of G.enemies.slice()) if (!e.dead) Game._dbg.kill(e);
    if (Game.state() !== 'playing' && !G.enemies.some(e => !e.dead)) break;
    step(50);
    if (Game.state() === 'over') break;
  }
}
function testBRReward(mapId){
  const X = S.X, Game = S.Game, map = X.BR_MAPS.find(m => m.id === mapId);
  localStorageStub._data = Object.create(null); S.Save.load();
  const w1 = wrapEvent('onWin');
  startBR(mapId);
  const G = G_();
  G.player.invuln = 1e9;
  clearBRRun(Game, G);
  assert(stepUntil(() => w1.calls.length > 0, 10000, 50), '地图 ' + mapId + ' 清空后 10s 内未触发 onWin');
  const res = w1.calls[w1.calls.length - 1];
  assertEq(res.mode, 'br', 'res.mode');
  assert(res.win === true, 'res.win');
  assertEq(res.first, true, '首胜 first 应为 true');
  assertEq(res.reward, map.reward, '地图 ' + mapId + ' 首胜奖励应为 ' + map.reward);
  assertEq(res.coins, map.reward, 'res.coins');
  assertEq(S.Save.data.coins, map.reward, '存档金币');
  assertEq(S.Save.brWins(mapId), 1, 'Save.brWins 应 +1');
  assertEq(res.kills, res.total, 'kills 应等于 total（含分裂小怪）');
  note('地图 ' + mapId + ' 首胜 +' + res.reward + ' 金币（total=' + res.total + ', kills=' + res.kills + '）');
  clearTimers();
  const w2 = wrapEvent('onWin');
  const coins1 = S.Save.data.coins;
  startBR(mapId);
  const G2 = G_();
  G2.player.invuln = 1e9;
  clearBRRun(Game, G2);
  assert(stepUntil(() => w2.calls.length > 0, 10000, 50), '地图 ' + mapId + ' 第二次清空后未触发 onWin');
  const res2 = w2.calls[w2.calls.length - 1];
  assertEq(res2.first, false, '重复 first 应为 false');
  assertEq(res2.reward, 0, '重复 reward 应为 0');
  assertEq(S.Save.data.coins, coins1, '重复不应增加金币');
  assertEq(S.Save.brWins(mapId), 2, 'Save.brWins 应为 2');
  note('地图 ' + mapId + ' 重复胜利 reward=0、金币不变');
}
test({ id: 'G4.2', group: '4', name: 'BR 地图2 · 首胜 +600 / 重复 0', profiles: ['desktop'], capability: capBR, fn: () => testBRReward(2) });
test({ id: 'G4.3', group: '4', name: 'BR 地图3 · 首胜 +1100 / 重复 0', profiles: ['desktop'], capability: capBR, fn: () => testBRReward(3) });

/* ================= 补充：战役 BOSS 回归 ================= */
function testCampaignBoss(){
  const Game = S.Game;
  localStorageStub._data = Object.create(null); S.Save.load();
  const w = wrapEvent('onWin');
  assert(Game.startCampaign(8), 'startCampaign(8) 返回 false');
  const G = G_();
  G.player.invuln = 1e9;
  let guard = 0, bossSeen = false, wave2Seen = false;
  while (Game.state() === 'playing' && guard++ < 6000){
    for (const e of G.enemies.slice()){
      if (e.dead) continue;
      if (e.boss) bossSeen = true;
      if (RUN_().wave >= 2) wave2Seen = true;
      Game._dbg.kill(e);
    }
    step(50);
  }
  assertEq(Game.state(), 'over', '第 8 关应通关（state=over）');
  step(1000);
  assert(w.calls.length >= 1, 'BOSS 关通关未触发 onWin');
  const res = w.calls[w.calls.length - 1];
  assertEq(res.mode, 'campaign', 'res.mode');
  assertEq(res.win, true, 'res.win');
  assertEq(res.wave, 2, '应打到第 2 波');
  assert(bossSeen, '第 2 波应出现 BOSS');
  assertEq(S.Save.levelStars(8), 3, '满血通关 3 星');
  note('BOSS 关通关：bossSeen=' + bossSeen + ' wave2=' + wave2Seen + ' kills=' + res.kills + ' stars=' + res.stars);
}
test({ id: 'G7.4', group: '7', name: '回归 · 第8关 BOSS 通关', profiles: ['desktop'], fn: testCampaignBoss });
/* ================= 第 3 轮：50 怪数据 / 实例化 ================= */
function campaignSandbox(levelId){
  const Game = S.Game;
  assert(Game.startCampaign(levelId || 1), 'startCampaign(' + (levelId || 1) + ') 返回 false');
  const G = G_(), RUN = RUN_();
  RUN.waveTimer = 1e9;                 // 阻止战役自动刷波，隔离被测怪
  G.player.invuln = 1e9;
  G.obstacles.length = 0;
  G.enemies.length = 0; G.markers.length = 0; G.ebullets.length = 0; G.bullets.length = 0;
  return { Game: Game, G: G, RUN: RUN };
}

function testEnemyDataStatic(){
  const X = S.X, E = X.ENEMY, keys = Object.keys(E);
  assertEq(keys.length, 50, 'ENEMY 应恰好 50 条');
  const badKeys = keys.filter(k => !/^[a-z][a-z0-9_]*$/.test(k));
  assertEq(badKeys.length, 0, '存在非法 key: ' + badKeys.join(','));
  const TIERS = ['普通', '精锐', '稀有', '史诗', '传说'];
  const counts = {};
  const problems = [];
  for (const k of keys){
    const e = E[k];
    for (const f of ['name', 'tier', 'size', 'hp', 'speed', 'color', 'dark', 'score', 'contact', 'desc', 'where']){
      if (e[f] === undefined) problems.push(k + '.' + f + ' 缺失');
    }
    if (typeof e.name !== 'string' || !e.name) problems.push(k + '.name 非法');
    if (typeof e.desc !== 'string' || !e.desc) problems.push(k + '.desc 非法');
    if (typeof e.where !== 'string' || !e.where) problems.push(k + '.where 非法');
    else if (!/战役|难度|大逃杀/.test(e.where)) problems.push(k + '.where=' + e.where);
    if (TIERS.indexOf(e.tier) < 0) problems.push(k + '.tier=' + e.tier);
    for (const f of ['size', 'hp', 'speed', 'score', 'contact']){
      if (typeof e[f] !== 'number' || !(e[f] > 0)) problems.push(k + '.' + f + '=' + e[f]);
    }
    for (const f of ['color', 'dark']) if (typeof e[f] !== 'string' || e[f][0] !== '#') problems.push(k + '.' + f + ' 非法');
    counts[e.tier] = (counts[e.tier] || 0) + 1;
    if (e.traits !== undefined){
      if (!Array.isArray(e.traits)) problems.push(k + '.traits 不是数组');
      else for (const tr of e.traits) if (!X.TRAITS[tr]) problems.push(k + '.traits 未在 TRAITS 中: ' + tr);
    }
  }
  assertEq(problems.length, 0, '数据字段问题: ' + problems.slice(0, 8).join('; '));
  for (const tier of TIERS) assert((counts[tier] || 0) >= 2, 'tier ' + tier + ' 至少应有 2 条，实际 ' + (counts[tier] || 0));
  note('50 条字段/类型校验通过；实际 tier 分布：' + TIERS.map(x => x + '=' + (counts[x] || 0)).join(' '));
}

function testEnemyTierDistribution(){
  const E = S.X.ENEMY, TIERS = ['普通', '精锐', '稀有', '史诗', '传说'];
  const counts = {};
  for (const k in E) counts[E[k].tier] = (counts[E[k].tier] || 0) + 1;
  const expect = { '普通':4, '精锐':7, '稀有':16, '史诗':13, '传说':10 };
  const actual = TIERS.map(x => x + '=' + (counts[x] || 0)).join(' ');
  for (const tier of TIERS) assertEq(counts[tier] || 0, expect[tier], 'tier ' + tier + ' 与数据事实不一致（实际 ' + actual + '）');
  note('tier 分布与文档一致（4/7/16/13/10）');
}

test({ id: 'G10.1', group: '10', name: '数据 · 50 条 ENEMY 字段与 tier 分布', profiles: ['desktop'], fn: testEnemyDataStatic });

function testEnemyDataRules(){
  const X = S.X, E = X.ENEMY, T = X.TRAITS;
  const traitKeys = Object.keys(T || {});
  assertEq(traitKeys.length, 10, 'TRAITS 应恰好 10 条');
  const wanted = ['regen', 'shield', 'blink', 'homing', 'wallhack', 'berserk', 'revive', 'aimbot', 'summon', 'steal'];
  for (const tr of wanted) assert(traitKeys.indexOf(tr) >= 0, 'TRAITS 缺少 ' + tr);
  for (const tr of traitKeys){
    const v = T[tr];
    assert(v && v.icon && v.name && v.desc, 'TRAITS.' + tr + ' 字段不全');
  }
  const problems = [];
  const bossHp = [], normalHp = [];
  for (const k of Object.keys(E)){
    const e = E[k];
    if (e.bSpeed !== undefined){
      for (const f of ['bDmg', 'fireCd', 'range']) if (typeof e[f] !== 'number' || !(e[f] > 0)) problems.push(k + ' 远程缺少有效 ' + f);
    }
    if (e.charge !== undefined && !(e.charge > 0)) problems.push(k + '.charge 非法');
    if (e.split !== undefined && (!Number.isInteger(e.split) || e.split < 2)) problems.push(k + '.split 非法');
    if (e.boom !== undefined && !(e.boom && e.boom.radius > 0 && e.boom.dmg > 0)) problems.push(k + '.boom 非法');
    if (e.shots !== undefined && (!Number.isInteger(e.shots) || e.shots < 1)) problems.push(k + '.shots 非法');
    if (e.boss){ bossHp.push(e.hp); if (e.bSpeed === undefined) problems.push(k + ' 是 BOSS 但没有远程攻击'); }
    else normalHp.push(e.hp);
  }
  const avg = normalHp.reduce((a, b) => a + b, 0) / normalHp.length;
  for (const hp of bossHp) assert(hp > avg * 1.8, 'BOSS 血量应显著高于普通均值: ' + hp + ' vs ' + avg.toFixed(1));
  assertEq(problems.length, 0, '字段规则问题: ' + problems.slice(0, 8).join('; '));
  assertEq(bossHp.length, 7, 'BOSS 数量应为 7');
  note('TRAITS 10 条完整；远程字段齐全；7 个 BOSS 血量 ' + bossHp.join('/') + '，普通均值 ' + avg.toFixed(0));
}
test({ id: 'G10.2', group: '10', name: '数据 · TRAITS 10 条 / 远程字段 / BOSS 血量', profiles: ['desktop'], fn: testEnemyDataRules });
test({ id: 'G10.3', group: '10', name: '数据 · tier 分布与文档一致(4/7/16/13/10)', profiles: ['desktop'], fn: testEnemyTierDistribution });

function testAllEnemiesInstantiate(){
  const Game = S.Game, X = S.X;
  localStorageStub._data = Object.create(null); S.Save.load();
  const sb = campaignSandbox(1);
  const G = sb.G, keys = Object.keys(X.ENEMY);
  const problems = [];
  for (const k of keys){
    G.enemies.length = 0; G.ebullets.length = 0; G.markers.length = 0;
    let e = null;
    try { e = spawn(k, G.player.x + 420, G.player.y, {}); }
    catch (err){ problems.push(k + ' spawn 异常: ' + (err && err.message)); continue; }
    e.appear = 0;
    const t = X.ENEMY[k];
    if (e.hp !== t.hp) problems.push(k + '.hp ' + e.hp + ' != ' + t.hp);
    if (e.size !== t.size) problems.push(k + '.size ' + e.size + ' != ' + t.size);
    if (Math.abs(e.baseSpeed - t.speed) > t.speed * 0.3) problems.push(k + '.speed ' + e.baseSpeed + ' vs ' + t.speed);
    step(1000);                        // 60 帧
    if (S.errors.length) break;
  }
  G.enemies.length = 0; G.ebullets.length = 0;
  assertEq(problems.length, 0, '实例化/数值问题: ' + problems.slice(0, 8).join('; '));
  if (S.errors.length) throw new Error('50 种怪跑 60 帧期间出现异常: ' + S.errors.map(x => x.message).join(' | '));
  note('50/50 key 各生成并跑 60 帧无异常，hp/size/基础速度与数据一致');
}
test({ id: 'G11.1', group: '11', name: '实例化 · 50 个 key 各跑 60 帧', profiles: ['desktop'], fn: testAllEnemiesInstantiate });
/* ================= 第 3 轮：10 个个体特性各一条可观测断言 ================= */
function testTraitSummon(){
  const sb = campaignSandbox(1), G = sb.G;
  const e = spawn('summoner', G.player.x + 400, G.player.y, {});
  e.appear = 0; e.speed = 0; e.contactCd = 1e9; e.summonCd = 0.01;
  step(200);
  const minis = G.enemies.filter(x => x.type === 'mini' && !x.dead);
  assert(minis.length >= 1, 'summon 未召唤出 mini（当前 enemies=' + G.enemies.length + '）');
  assert(e.summonCd > 0, 'summon 冷却未重置');
  note('summon 生效：召出 ' + minis.length + ' 只 mini');
}
test({ id: 'G12.1', group: '12', name: '特性 · summon 召唤小怪', profiles: ['desktop'], fn: testTraitSummon });

function testTraitRegen(){
  const sb = campaignSandbox(1), G = sb.G;
  const e = spawn('chaser_regen', G.player.x + 400, G.player.y, {});
  e.appear = 0; e.speed = 0; e.contactCd = 1e9;
  e.hp = Math.floor(e.maxHp * 0.5);
  const hp0 = e.hp;
  step(1000);
  const healed = e.hp - hp0;
  assert(healed > e.maxHp * 0.01, 'regen 1 秒回血应 >1% 最大生命，实际 ' + healed.toFixed(2));
  note('regen 生效：' + hp0 + ' -> ' + e.hp.toFixed(1) + '（最大 ' + e.maxHp + '）');
}
test({ id: 'G12.2', group: '12', name: '特性 · regen 持续回血', profiles: ['desktop'], fn: testTraitRegen });

function testTraitShield(){
  const sb = campaignSandbox(1), G = sb.G;
  const e = spawn('tank_fortress', G.player.x + 400, G.player.y, {});
  e.appear = 0; e.speed = 0; e.contactCd = 1e9; e.shieldCd = 0.01;
  step(100);
  assertEq(e.shield, 1, 'shield 未生成护盾');
  const hp0 = e.hp;
  sb.Game._dbg.explode(e.x, e.y, 30, 60, { hurtEnemies: true, hurtPlayer: false });
  assertEq(e.shield, 0, '护盾应被消耗');
  assertEq(e.hp, hp0, '护盾应完全挡下这次伤害');
  note('shield 生效：护盾挡下 60 点伤害，hp 不变');
}
test({ id: 'G12.3', group: '12', name: '特性 · shield 挡下一次伤害', profiles: ['desktop'], fn: testTraitShield });

function testTraitSteal(){
  const sb = campaignSandbox(1), G = sb.G, p = G.player;
  const e = spawn('vampire', p.x + 60, p.y, {});
  e.appear = 0; e.speed = 0; e.contactCd = 0;
  e.hp = Math.floor(e.maxHp * 0.5);
  p.invuln = 0; p.x = e.x - 30; p.y = e.y; p.vx = 0; p.vy = 0;
  const hp0 = e.hp;
  step(150);
  assert(e.hp > hp0, 'steal 接触命中后未回血（' + hp0 + ' -> ' + e.hp.toFixed(1) + '）');
  note('steal 生效：接触命中后 ' + hp0 + ' -> ' + e.hp.toFixed(1));
}
test({ id: 'G12.4', group: '12', name: '特性 · steal 命中回血', profiles: ['desktop'], fn: testTraitSteal });

function testTraitBlink(){
  const sb = campaignSandbox(1), G = sb.G;
  const e = spawn('chaser_blink', G.player.x + 500, G.player.y, {});
  e.appear = 0; e.speed = 0; e.contactCd = 1e9; e.blinkCd = 0.01;
  const x0 = e.x, y0 = e.y;
  step(100);
  const d = Math.hypot(e.x - x0, e.y - y0);
  assert(d > 60, 'blink 未瞬移（位移 ' + d.toFixed(1) + 'px）');
  assert(d < 180, 'blink 位移异常（' + d.toFixed(1) + 'px）');
  note('blink 生效：瞬移 ' + d.toFixed(1) + 'px');
}
test({ id: 'G12.5', group: '12', name: '特性 · blink 瞬移', profiles: ['desktop'], fn: testTraitBlink });

function testTraitBerserk(){
  const sb = campaignSandbox(1), G = sb.G;
  const e = spawn('chaser_rage', G.player.x + 400, G.player.y, {});
  e.appear = 0; e.contactCd = 1e9;
  e.hp = Math.floor(e.maxHp * 0.2); e.speed = 0;
  step(100);
  assertEq(e.berserk, true, 'berserk 未触发');
  assertClose(e.speed, e.baseSpeed * 1.4, 1e-6, '狂暴时速度应为基准 x1.4');
  note('berserk 生效：速度 ' + e.baseSpeed + ' -> ' + e.speed);
}
test({ id: 'G12.6', group: '12', name: '特性 · berserk 残血加速', profiles: ['desktop'], fn: testTraitBerserk });

function testTraitRevive(){
  const sb = campaignSandbox(1), G = sb.G;
  const e = spawn('elite_champion', G.player.x + 300, G.player.y, {});
  e.appear = 0;
  sb.Game._dbg.kill(e);
  assert(e.dead !== true, 'revive 触发后不应死亡');
  assertEq(e.revived, true, 'revived 标记应为 true');
  assertClose(e.hp, e.maxHp * 0.5, 2, '复活血量应约 50%');
  sb.Game._dbg.kill(e);
  assertEq(e.dead, true, '第二次击杀应正常死亡');
  note('revive 生效：半血复活一次，第二次击杀死亡');
}
test({ id: 'G12.7', group: '12', name: '特性 · revive 半血复活一次', profiles: ['desktop'], fn: testTraitRevive });

function testTraitAimbot(){
  const sb = campaignSandbox(1), G = sb.G, p = G.player;
  p.invuln = 1e9;
  const shootAngle = type => {
    G.enemies.length = 0; G.ebullets.length = 0;
    p.x = 480; p.y = 270; p.vx = 0; p.vy = 250;
    const e = spawn(type, p.x - 200, p.y, {});
    e.appear = 0; e.speed = 0; e.contactCd = 1e9; e.windup = 0.001;
    step(30);
    const b = G.ebullets[0];
    return b ? Math.atan2(b.vy, b.vx) : null;
  };
  const aim = shootAngle('shooter_aim');
  const plain = shootAngle('shooter');
  assert(aim !== null && plain !== null, '未生成敌弹');
  assert(aim - plain > 0.15, 'aimbot 应预判上移目标（aim=' + aim.toFixed(3) + ' plain=' + plain.toFixed(3) + '）');
  note('aimbot 生效：弹角 ' + aim.toFixed(3) + ' rad，普通 ' + plain.toFixed(3) + ' rad');
}
test({ id: 'G12.8', group: '12', name: '特性 · aimbot 预判走位', profiles: ['desktop'], fn: testTraitAimbot });

function testTraitHoming(){
  const sb = campaignSandbox(1), G = sb.G, p = G.player;
  p.invuln = 1e9; p.x = 480; p.y = 270;
  const e = spawn('shooter_homing', p.x, p.y + 200, {});
  e.appear = 0; e.speed = 0; e.contactCd = 1e9; e.windup = 0.001;
  step(30);
  const b = G.ebullets[0];
  assert(b, '追踪射手未开枪');
  assertEq(b.homing, true, 'homing 弹应带 homing=true');
  const a0 = Math.atan2(b.vy, b.vx);
  p.x += 250;
  step(250);
  assert(G.ebullets.indexOf(b) >= 0, '追踪弹提前消失（不应在 250ms 内命中）');
  const a1 = Math.atan2(b.vy, b.vx);
  let diff = Math.abs(((a1 - a0 + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
  assert(diff > 0.15, 'homing 弹未拐弯（角度变化 ' + diff.toFixed(3) + ' rad）');
  note('homing 生效：玩家横向瞬移后弹角变化 ' + diff.toFixed(3) + ' rad');
}
test({ id: 'G12.9', group: '12', name: '特性 · homing 追踪弹拐弯', profiles: ['desktop'], fn: testTraitHoming });

function testTraitWallhack(){
  const Game = S.Game;
  assert(Game.startCampaign(2), 'startCampaign(2) 返回 false');
  const G = G_(), RUN = RUN_();
  RUN.waveTimer = 1e9;
  const p = G.player;
  p.invuln = 1e9; p.x = 150; p.y = 151; p.vx = 0; p.vy = 0;
  G.enemies.length = 0; G.markers.length = 0; G.ebullets.length = 0;
  assert(G.obstacles.length > 0, '第 2 关应有柱子');
  const e = spawn('shooter_wall', 400, 151, {});
  e.appear = 0; e.speed = 0; e.contactCd = 1e9; e.windup = 0.001;
  step(30);
  const b = G.ebullets[0];
  assert(b, '穿墙射手未开枪');
  assertEq(b.wall, true, 'wallhack 子弹应带 wall=true');
  b.x = 270; b.y = 151; b.vx = 0; b.vy = 0;
  step(30);
  assert(G.ebullets.indexOf(b) >= 0, '穿墙弹被柱子挡下');
  G.enemies.length = 0; G.ebullets.length = 0;
  const e2 = spawn('shooter', 400, 151, {});
  e2.appear = 0; e2.speed = 0; e2.contactCd = 1e9; e2.windup = 0.001;
  step(30);
  const b2 = G.ebullets[0];
  assert(b2, '对照普通枪手未开枪');
  assert(!b2.wall, '普通子弹不应带 wall');
  b2.x = 270; b2.y = 151; b2.vx = 0; b2.vy = 0;
  step(30);
  assert(G.ebullets.indexOf(b2) < 0, '对照：普通子弹应被柱子挡下');
  note('wallhack 生效：穿墙弹留在柱子里，对照普通弹被回收');
}
test({ id: 'G12.10', group: '12', name: '特性 · wallhack 子弹穿墙', profiles: ['desktop'], fn: testTraitWallhack });
/* ================= 第 3 轮：投放覆盖 / 图鉴收录 / 图鉴界面 ================= */
function computeCoverageStatic(){
  const X = S.X, cover = {};
  const set = (k, src) => { if (k && !cover[k]) cover[k] = src; };
  for (const lv of X.LEVELS) for (const w of (lv.waves || [])) for (const pair of (w.n || [])) set(pair[0], '战役·' + lv.name);
  for (const e of X.ENDLESS_WAVES) for (const k of (e.list || [])) set(k, '难度·第' + e.w + '波起');
  for (const k of X.ENDLESS_BOSSES) set(k, '难度·BOSS波');
  for (const id in X.BR_POOLS) for (const pair of (X.BR_POOLS[id] || [])) set(pair[0], '大逃杀·地图' + id);
  return cover;
}
function testDexCoverage(){
  const X = S.X, Game = S.Game;
  const keys = Object.keys(X.ENEMY);
  const cover = computeCoverageStatic();
  const missing = keys.filter(k => !cover[k]);
  assertEq(missing.length, 0, '静态扫描有未投放 key: ' + missing.join(','));
  const dc = Game.dexCoverage();
  assert(dc && typeof dc === 'object', 'Game.dexCoverage() 未返回对象');
  assertEq(dc.total, 50, 'dexCoverage().total 应为 50');
  assertEq(dc.missing.length, 0, 'dexCoverage().missing 应为空: ' + dc.missing.join(','));
  const apiMiss = keys.filter(k => !dc.cover[k]);
  assertEq(apiMiss.length, 0, 'dexCoverage().cover 缺少: ' + apiMiss.join(','));
  const out = { generatedAt: new Date().toISOString(), total: keys.length, cover: {} };
  for (const k of keys){
    out.cover[k] = cover[k];
    assertEq(dc.cover[k], cover[k], 'API 与静态扫描来源不一致: ' + k + ' (' + dc.cover[k] + ' vs ' + cover[k] + ')');
  }
  fs.writeFileSync(path.join(__dirname, 'dex-coverage.json'), JSON.stringify(out, null, 2), 'utf8');
  note('50/50 全部有投放途径；每个 key 的首投放清单已写入 tests/dex-coverage.json');
}
test({ id: 'G13.1', group: '13', name: '投放 · 50/50 全部有途径且 API 一致', profiles: ['desktop'], fn: testDexCoverage });

function testDexSaveCollection(){
  const Game = S.Game, Save = S.Save;
  localStorageStub._data = Object.create(null); Save.load();
  const key = 'chaser_fast';
  assertEq(Save.dexCount(key), 0, '初始应未收录');
  assertEq(Save.dexTotal(), 0, '初始收录种类应为 0');
  assertEq(Save.dexKinds(), 50, 'dexKinds 应为 50');
  const origSave = Save.save;
  let saves = 0;
  Save.save = function(){ saves++; return origSave.apply(this, arguments); };
  const prevOnDex = Game.events.onDex;
  const dexEvents = [];
  Game.events.onDex = k => dexEvents.push(k);
  try {
    const sb = campaignSandbox(1), G = sb.G;
    const e1 = spawn(key, G.player.x + 400, G.player.y, {});
    assertEq(Save.dexCount(key), 0, '仅生成（未击杀）不应收录');
    assertEq(saves, 0, '仅生成不应写盘');
    assertEq(dexEvents.length, 0, '仅生成不应触发 onDex');
    Game._dbg.kill(e1);
    assertEq(Save.dexCount(key), 1, '首次击杀后计数应为 1');
    assertEq(saves, 1, '首次击杀应写盘一次');
    assertEq(dexEvents.length, 1, '首次击杀应触发一次 onDex');
    assertEq(dexEvents[0], key, 'onDex 参数应为 key');
    const e2 = spawn(key, G.player.x + 420, G.player.y, {});
    Game._dbg.kill(e2);
    assertEq(Save.dexCount(key), 2, '第二次击杀后计数应为 2');
    assertEq(saves, 2, '每次击杀各写盘一次');
    assertEq(dexEvents.length, 1, '后续击杀不应重复触发 onDex');
    assertEq(Save.dexTotal(), 1, 'dexTotal 应等于已解锁种类数');
    const before = Save.dexCount(key);
    Save.load();
    assertEq(Save.dexCount(key), before, '重新 load 后计数应保留');
    assertEq(Save.dexTotal(), 1, '重新 load 后收录种类数应保留');
  } finally {
    Save.save = origSave;
    Game.events.onDex = prevOnDex;
  }
  note('生成不收录不写盘；首次击杀 0->1 且 onDex 一次；再次击杀 1->2；重载持久');
}
test({ id: 'G14.1', group: '14', name: '图鉴存档 · 生成不收录 / 击杀递增 / onDex 一次 / 重载持久', profiles: ['desktop'], fn: testDexSaveCollection });

function testDexOnDexEvent(){
  const Game = S.Game, Save = S.Save;
  localStorageStub._data = Object.create(null); Save.load();
  const calls = [];
  const prev = Game.events.onDex;
  Game.events.onDex = k => calls.push(k);
  try {
    const sb = campaignSandbox(1), G = sb.G;
    const e1 = spawn('tank_heavy', G.player.x + 400, G.player.y, {});
    spawn('tank_heavy', G.player.x + 420, G.player.y, {});
    assertEq(calls.length, 0, '仅生成不应触发 onDex');
    assertEq(Save.dexCount('tank_heavy'), 0, '仅生成不应收录');
    Game._dbg.kill(e1);
    assertEq(calls.length, 1, '首次击杀应触发一次 onDex');
    assertEq(calls[0], 'tank_heavy', 'onDex 参数应为 key');
    assertEq(Save.dexCount('tank_heavy'), 1, '首次击杀后计数 1');
    const e3 = spawn('tank_heavy', G.player.x + 440, G.player.y, {});
    Game._dbg.kill(e3);
    assertEq(calls.length, 1, '后续击杀不应重复触发 onDex');
    assertEq(Save.dexCount('tank_heavy'), 2, '后续击杀计数应累加');
  } finally { Game.events.onDex = prev; }
  note('onDex 在首次击杀时触发一次；生成与后续击杀不触发');
}
test({ id: 'G14.2', group: '14', name: '图鉴事件 · onDex 首次击杀只触发一次', profiles: ['desktop'], fn: testDexOnDexEvent });

function testDexUI(){
  const doc = S.document, Game = S.Game, Save = S.Save, X = S.X;
  localStorageStub._data = Object.create(null); Save.load();
  Game.stop();
  S.UI.goBook();
  const grid = doc.getElementById('bookGrid');
  const countCards = h => (String(h).match(/class="card dex-card/g) || []).length;
  let html = String(grid.innerHTML);
  assertEq(countCards(html), 50, '未收录时图鉴卡片应 50 张');
  assert(html.indexOf('???') >= 0, '未收录卡片应显示 ???');
  assert(html.indexOf('击败它以解锁图鉴') >= 0, '未收录卡片应保留解锁提示');
  assert(html.indexOf('未收录') >= 0, '未收录角标');
  assertEq(doc.getElementById('bookProgTxt').textContent, '已收录 0 / 50', '初始进度文本');
  /* 收录一只后再看 */
  Save.dexAdd('chaser_fast');
  S.UI.goBook();
  html = String(grid.innerHTML);
  assert(html.indexOf(X.ENEMY['chaser_fast'].name) >= 0, '已收录卡片应显示名字');
  assertEq(doc.getElementById('bookProgTxt').textContent, '已收录 1 / 50', '进度文本');
  assertEq(doc.getElementById('bookChipTxt').textContent, '1 / 50', '顶部 chip');
  /* 筛选数量自洽 */
  clickDataAct('book-filter', 'own');
  assertEq(countCards(grid.innerHTML), 1, '已收录筛选应 1 张');
  clickDataAct('book-filter', 'lock');
  assertEq(countCards(grid.innerHTML), 49, '未收录筛选应 49 张');
  clickDataAct('book-filter', 'all');
  assertEq(countCards(grid.innerHTML), 50, '全部筛选应 50 张');
  const unowned = Object.keys(X.ENEMY).find(k => Save.dexCount(k) === 0);
  assert(unowned, '应存在未收录 key');
  assert(String(grid.innerHTML).indexOf('data-key="' + unowned + '"') >= 0, '卡片应带 data-key');
  /* 主菜单进度 */
  S.UI.goMenu();
  assert(String(doc.getElementById('menuStats').innerHTML).indexOf('1 / 50') >= 0, '主菜单图鉴进度');
  assertEq(doc.getElementById('menuDexNote').textContent, '收录进度 1 / 50', '主菜单进度小字');
  note('图鉴卡片 50 张、???/解锁提示/筛选 1+49=50/进度文本/主菜单入口均正确');
}
test({ id: 'G15.1', group: '15', name: '图鉴界面 · 50 卡 / ??? / 筛选自洽 / 进度', profiles: ['desktop'], fn: testDexUI });
/* ================= 第 4 轮：100 关数据与界面 ================= */
function testLevels100Data(){
  const X = S.X, E = X.ENEMY, L = X.LEVELS;
  assertEq(L.length, 100, 'LEVELS 应为 100 关');
  const problems = [];
  for (let i = 0; i < L.length; i++){
    const lv = L[i], expectId = i + 1;
    if (lv.id !== expectId) problems.push('第' + expectId + '项 id=' + lv.id);
    for (const f of ['name', 'sub', 'obs', 'tip']) if (typeof lv[f] !== 'string' || !lv[f]) problems.push('关卡' + lv.id + ' 缺少 ' + f);
    if (!Array.isArray(lv.waves) || !lv.waves.length) problems.push('关卡' + lv.id + ' waves 为空');
    else {
      if (lv.waves.length > 3) problems.push('关卡' + lv.id + ' 波数 >3（' + lv.waves.length + '）');
      lv.waves.forEach((w, wi) => {
        if (!Array.isArray(w.n) || !w.n.length) problems.push('关卡' + lv.id + ' 第' + (wi + 1) + '波 n 为空');
        else w.n.forEach(p => {
          if (!Array.isArray(p) || p.length !== 2) problems.push('关卡' + lv.id + ' 波次敌人项格式非法');
          else if (!E[p[0]]) problems.push('关卡' + lv.id + ' 非法敌人 key ' + p[0]);
          else if (!Number.isInteger(p[1]) || p[1] <= 0) problems.push('关卡' + lv.id + ' 敌人数量非法 ' + p[1]);
        });
        if (w.hp !== undefined && !(typeof w.hp === 'number' && w.hp > 0)) problems.push('关卡' + lv.id + ' hp 非法');
      });
    }
    if (!Array.isArray(lv.starHp) || lv.starHp.length !== 2 || !(lv.starHp[0] > 0) || !(lv.starHp[1] > 0) || !(lv.starHp[0] > lv.starHp[1])) problems.push('关卡' + lv.id + ' starHp 非法');
    if (lv.obs !== 'random' && !X.OBSTACLES[lv.obs]) problems.push('关卡' + lv.id + ' obs 非法: ' + lv.obs);
  }
  assertEq(problems.length, 0, '100 关数据问题: ' + problems.slice(0, 10).join('; '));
  assertEq(X.levelWaveCoins(L[0]), 108, '第 1 关首通金币应仍为 108');
  const bossProblems = [];
  for (const lv of L){
    if (lv.id % 10 !== 0) continue;
    const last = lv.waves[lv.waves.length - 1];
    const hasBoss = last.n.some(p => E[p[0]] && E[p[0]].boss);
    if (!hasBoss) bossProblems.push('第' + lv.id + '关最后一波无 BOSS: ' + last.n.map(p => p[0]).join(','));
  }
  assertEq(bossProblems.length, 0, '每 10 关 BOSS 规则问题: ' + bossProblems.join(' | '));
  const total = L.reduce((s, lv) => s + X.levelWaveCoins(lv), 0);
  assertEq(total, 43188, '100 关首通金币总额应为 43188');
  note('100 关数据全通过；第1关 108；10 个整十关最后一波均含 BOSS；首通总额 ' + total);
}
test({ id: 'G16.1', group: '16', name: '100关数据 · id连续/字段/波次key/每10关BOSS/总额43188', profiles: ['desktop'], fn: testLevels100Data });

function testLevels100UI(){
  const Game = S.Game, X = S.X;
  Game.stop();
  S.UI.goLevels();
  const html = String(S.document.getElementById('lvGrid').innerHTML);
  const cards = (html.match(/class="card lv-card/g) || []).length;
  assertEq(cards, 100, '关卡页应渲染 100 张卡（实际 ' + cards + '）');
  assertEq(X.Save.levelUnlocked(0), true, '第 1 关应解锁');
  assertEq(X.Save.levelUnlocked(99), false, '第 100 关默认应锁定');
  note('关卡页渲染 100 张卡；默认解锁状态正确（1 解锁 / 100 锁定）');
}
test({ id: 'G16.2', group: '16', name: '100关界面 · 关卡页渲染 100 张卡', profiles: ['desktop'], fn: testLevels100UI });
/* ================= 第 4 轮：联机合作引擎（mock Net，主机侧） ================= */
function resetMockNet(){ S.mockNet._sent.length = 0; return S.mockNet; }
function emitRelay(from, data){
  const hs = S.mockNet.on.relay || [];
  for (let i = 0; i < hs.length; i++) hs[i](from, data);
}
function coopStart(role, opts){
  opts = opts || {};
  const Game = S.Game;
  resetMockNet();
  Game.stop();
  const players = opts.players || [{ id: 'h1', name: 'Host' }, { id: 'c1', name: 'Client' }];
  const myId = opts.myId || (role === 'client' ? 'me' : 'h1');
  assert(Game.startCoop({ role: role, config: opts.config || { mode: 'campaign', level: 1 }, net: { code: 'T1', myId: myId, players: players } }), 'startCoop(' + role + ') 返回 false');
  const G = G_(), RUN = RUN_();
  if (!opts.waves) RUN.waveTimer = 1e9;
  G.obstacles.length = 0;
  G.enemies.length = 0; G.markers.length = 0; G.ebullets.length = 0; G.bullets.length = 0; G.pickups.length = 0;
  return { Game: Game, G: G, RUN: RUN };
}

function testCoopHostSnapshot(){
  const s = coopStart('host');
  assertEq(s.Game.netRole(), 'host', 'netRole 应为 host');
  assertEq(s.Game.remotes().length, 1, '主机应有 1 个远程玩家');
  assertEq(s.Game._dbg.G().remotes.length, 1, 'G.remotes 应同步');
  const setup = S.mockNet._sent.find(m => m.k === 'setup');
  assert(setup, '主机未广播 setup');
  assert(Array.isArray(setup.obs) && setup.world && setup.bounds, 'setup 字段不全');
  resetMockNet();
  step(1000);
  const snaps = S.mockNet._sent.filter(m => m.k === 'snap');
  assert(snaps.length >= 9 && snaps.length <= 12, '10Hz 快照数量异常: ' + snaps.length);
  const snap = snaps[0];
  assertEq(snap.k, 'snap');
  assertEq(snap.p.length, 2, '快照应含 2 名玩家');
  assert(snap.p.every(r => Array.isArray(r) && r.length === 9), 'p 行应为 9 元组');
  assert(snap.e.every(r => r.length === 9), 'e 行应为 9 元组');
  assert(snap.b.every(r => r.length === 5), 'b 行应为 5 元组');
  assert(snap.eb.every(r => r.length === 3), 'eb 行应为 3 元组');
  assert(snap.pk.every(r => r.length === 2), 'pk 行应为 2 元组');
  assertEq(snap.w.length, 5, 'w 应为 5 元组');
  assertEq(snap.s.length, 5, 's 应为 5 元组');
  note('主机 setup + 10Hz 快照 + 快照字段格式正确（1s 内 ' + snaps.length + ' 帧）');
}
test({ id: 'G17.1', group: '17', name: '联机主机 · setup / 10Hz 快照 / 格式', profiles: ['desktop'], fn: testCoopHostSnapshot });

function testCoopHostRemoteInput(){
  const s = coopStart('host');
  const r = s.G.remotes[0];
  r.in = { mx: 1, my: 0, aim: 0, fire: false };
  const x0 = r.x;
  step(500);
  assert(r.x - x0 > 50, '远程移动未生效（位移 ' + (r.x - x0).toFixed(1) + '）');
  s.G.enemies.length = 0;
  const e = spawn('chaser', r.x + 150, r.y, {});
  e.appear = 0; e.speed = 0; e.contactCd = 1e9;
  const hp0 = e.hp;
  r.aim = 0; r.in = { mx: 0, my: 0, aim: 0, fire: true }; r.mag = r.magSize; r.fireCd = 0;
  step(300);
  assert(e.hp < hp0 || e.dead, '远程玩家开火未命中敌人');
  assert(r.mag < r.magSize, '远程开火未消耗弹匣');
  note('远程输入驱动移动与开火正常');
}
test({ id: 'G17.2', group: '17', name: '联机主机 · 远程输入驱动移动/开火', profiles: ['desktop'], fn: testCoopHostRemoteInput });

function testCoopHostEnemyTargetsRemote(){
  const s = coopStart('host');
  const r = s.G.remotes[0], p = s.G.player;
  r.x = p.x + 250; r.y = p.y; r.vx = r.vy = 0; r.in = { mx: 0, my: 0, aim: 0, fire: false }; r.hp = r.maxHp;
  const e = spawn('chaser', r.x + 300, r.y, {});
  e.appear = 0; e.speed = 140; e.contactCd = 1e9;
  const d0 = Math.hypot(e.x - r.x, e.y - r.y);
  step(600);
  const d1 = Math.hypot(e.x - r.x, e.y - r.y);
  assert(d1 < d0 - 30, '敌人未追最近的远程玩家（' + d0.toFixed(0) + ' -> ' + d1.toFixed(0) + '）');
  note('敌人选择最近的远程玩家作为目标（距离 ' + d0.toFixed(0) + ' -> ' + d1.toFixed(0) + '）');
}
test({ id: 'G17.3', group: '17', name: '联机主机 · 敌人追最近玩家', profiles: ['desktop'], fn: testCoopHostEnemyTargetsRemote });

function testCoopHostDownRevive(){
  const s = coopStart('host');
  const r = s.G.remotes[0], p = s.G.player;
  p.invuln = 1e9;
  r.x = p.x + 200; r.y = p.y; r.vx = r.vy = 0; r.in = { mx: 0, my: 0, aim: 0, fire: false };
  r.invuln = 0; r.hp = 5;
  const e = spawn('shooter', r.x + 120, r.y, {});
  e.appear = 0; e.speed = 0; e.contactCd = 1e9; e.shootCd = 0.01;
  let guard = 0;
  while (!r.down && guard++ < 120) step(50);
  assert(r.down, '远程玩家未被敌弹击倒');
  assertEq(r.hp, 0, '倒地时 hp 应为 0');
  stepUntil(() => !r.down, 8000, 50);
  assert(!r.down, '倒地 6 秒后应复活');
  assertClose(r.hp, r.maxHp * 0.5, 2, '复活血量应约 50%');
  note('远程玩家被击倒 -> 6 秒后半血复活');
}
test({ id: 'G17.4', group: '17', name: '联机主机 · 远程倒地 6 秒复活', profiles: ['desktop'], fn: testCoopHostDownRevive });

function testCoopHostAllDownLose(){
  const s = coopStart('host');
  const Game = s.Game;
  const lost = [];
  const prev = Game.events.onLose;
  Game.events.onLose = res => { if (prev) prev(res); lost.push(res); };
  try {
    s.G.player.invuln = 0; s.G.player.hp = 1;
    const r = s.G.remotes[0]; r.down = true; r.reviveT = 99; r.hp = 0;
    Game._dbg.hurt(50);
    assertEq(Game.state(), 'over', '全员倒地后应直接失败');
    step(1200);
    assert(lost.length >= 1, '未触发 onLose');
    assertEq(lost[lost.length - 1].mode, 'campaign', 'onLose res.mode');
    assertEq(lost[lost.length - 1].win, false, 'onLose res.win 应为 false');
    assert(S.mockNet._sent.some(m => m.k === 'ev' && m.e && m.e.k === 'lose'), '主机未广播 lose');
    note('全员倒地 -> lose 广播');
  } finally { Game.events.onLose = prev; }
}
test({ id: 'G17.5', group: '17', name: '联机主机 · 全员倒地判负广播', profiles: ['desktop'], fn: testCoopHostAllDownLose });

function testCoopHostCoinWinBroadcast(){
  const s = coopStart('host', { waves: true });
  s.G.player.invuln = 1e9;
  const Game = s.Game;
  const won = [];
  const prev = Game.events.onWin;
  Game.events.onWin = res => { if (prev) prev(res); won.push(res); };
  try {
    let guard = 0, coinEvt = null;
    while (guard++ < 600 && !coinEvt){
      for (const e of s.G.enemies.slice()) if (!e.dead) Game._dbg.kill(e);
      step(50);
      coinEvt = S.mockNet._sent.find(m => m.k === 'ev' && m.e && m.e.k === 'coins');
    }
    assert(coinEvt, '清第 1 波未广播 coins');
    assertEq(coinEvt.e.amount, 50, '第 1 波金币应为 50');
    guard = 0;
    while (Game.state() === 'playing' && guard++ < 1200){
      for (const e of s.G.enemies.slice()) if (!e.dead) Game._dbg.kill(e);
      step(50);
    }
    assertEq(Game.state(), 'over', '第 1 关应通关');
    const evKinds = S.mockNet._sent.filter(m => m.k === 'ev').map(m => m.e && m.e.k).join(',');
    assert(S.mockNet._sent.some(m => m.k === 'ev' && m.e && m.e.k === 'win'), '通关未广播 win（已广播事件: ' + evKinds + '）');
    step(1000);
    assert(won.length >= 1, '未触发 onWin');
    note('主机清波广播 coins=50，通关广播 win');
  } finally { Game.events.onWin = prev; }
}
test({ id: 'G17.6', group: '17', name: '联机主机 · 清波金币/通关广播', profiles: ['desktop'], fn: testCoopHostCoinWinBroadcast });
/* ================= 第 4 轮：联机合作引擎（mock Net，客户端/公共） ================= */
function testCoopClientInputUpload(){
  const players = [{ id: 'me', name: '我' }, { id: 'c1', name: 'Bob' }];
  const s = coopStart('client', { players: players, myId: 'me' });
  assertEq(s.Game.netRole(), 'client', 'netRole 应为 client');
  resetMockNet();
  step(300);
  const ins = S.mockNet._sent.filter(m => m.k === 'in');
  assert(ins.length >= 5 && ins.length <= 8, '客户端输入上传频率异常: ' + ins.length);
  assert(typeof ins[0].mx === 'number' && typeof ins[0].my === 'number' && typeof ins[0].aim === 'number', 'in 消息字段不全');
  assert('fire' in ins[0], 'in 消息应含 fire');
  note('客户端每 50ms 上报输入（300ms 内 ' + ins.length + ' 条）');
}
test({ id: 'G18.1', group: '18', name: '联机客户端 · 每 50ms 上报输入', profiles: ['desktop'], fn: testCoopClientInputUpload });

function testCoopClientSnapshot(){
  const players = [{ id: 'me', name: '我' }, { id: 'c1', name: 'Bob' }];
  const s = coopStart('client', { players: players, myId: 'me' });
  const g = s.G;
  emitRelay('h1', { k: 'setup', obs: [{ x: 0, y: 0, w: 10, h: 10 }], world: { w: 1200, h: 800 }, bounds: { l: 0, t: 0, r: 1200, b: 800 } });
  assertEq(g.world.w, 1200, 'setup world 未应用');
  assertEq(g.obstacles.length, 1, 'setup obs 未应用');
  assertEq(g.bounds.r, 1200, 'setup bounds 未应用');
  const chaserIdx = Object.keys(S.X.ENEMY).indexOf('chaser');
  const snap = { k: 'snap', t: 1,
    p: [[0, 100, 100, 0, 100, 0, 0, 0, 100], [1, 300, 100, 0, 100, 0, 0, 0, 100]],
    e: [[chaserIdx, 400, 100, 62, 62, 0, 1, 0, 30]],
    b: [[200, 100, 50, 0, 0]], eb: [[250, 120, '#ff0000']], pk: [[260, 130]],
    w: [1, 0, 0, 1, 0], s: [7, 3, 88, 100, 55] };
  emitRelay('h1', snap);
  assertEq(g.enemies.length, 1, '应重建 1 个 ghost 敌人');
  assertEq(g.enemies[0].isGhost, true, '敌人应为 ghost');
  assertEq(g.enemies[0].type, 'chaser', '敌人类型');
  assertEq(g.enemies[0].hp, 62, '敌人 hp');
  assertEq(g.bullets.length, 1, '应重建 1 颗子弹');
  assertEq(g.bullets[0].ghost, true, '子弹应为 ghost');
  assertEq(g.bullets[0].vx, 500, '子弹 vx 应还原为 vx*10');
  assertEq(g.ebullets.length, 1, '应重建 1 颗敌弹');
  assertEq(g.ebullets[0].ghost, true, '敌弹应为 ghost');
  assertEq(g.pickups.length, 1, '应重建拾取物');
  assertEq(g.remotes.length, 1, '应创建 1 个远程玩家');
  assertEq(g.remotes[0].id, 'c1', '远程玩家 id');
  assertEq(s.RUN.score, 7, 'snap s[0] -> score');
  assertEq(s.RUN.kills, 3, 'snap s[1] -> kills');
  assertEq(s.RUN.wave, 1, 'snap w[0] -> wave');
  assertEq(s.RUN.hpSync, 88, 'snap s[2] -> hp');
  assertEq(s.RUN.coins, snap.s[4], 'snap s[4] -> coins（格式约定 s=[score,kills,hp,maxHp,coins]）');
  const r = g.remotes[0];
  step(400);
  assert(Math.abs(r.x - 300) < 25, '远程插值未到快照目标: ' + r.x.toFixed(1));
  assert(Math.abs(g.player.x - 100) < 25, '自己插值未到快照目标: ' + g.player.x.toFixed(1));
  note('客户端 setup/snap 重建 + 插值正确');
}
test({ id: 'G18.2', group: '18', name: '联机客户端 · setup/snap 重建与插值', profiles: ['desktop'], fn: testCoopClientSnapshot });

function testCoopClientEvents(){
  const players = [{ id: 'me', name: '我' }, { id: 'c1', name: 'Bob' }];
  const s = coopStart('client', { players: players, myId: 'me' });
  const coins0 = S.Save.data.coins;
  emitRelay('h1', { k: 'ev', e: { k: 'coins', amount: 77 } });
  assertEq(S.Save.data.coins, coins0 + 77, 'coins 广播未入账');
  assertEq(s.RUN.coins, 77, 'RUN.coins 未累计');
  emitRelay('h1', { k: 'ev', e: { k: 'down', name: 'Bob' } });
  emitRelay('h1', { k: 'ev', e: { k: 'win' } });
  assertEq(s.Game.state(), 'over', 'win 广播后应结算');
  note('客户端 coins/down/win 事件处理正确');
}
test({ id: 'G18.3', group: '18', name: '联机客户端 · coins/down/win 事件', profiles: ['desktop'], fn: testCoopClientEvents });

function testCoopClientLoseEvent(){
  const players = [{ id: 'me', name: '我' }, { id: 'c1', name: 'Bob' }];
  const s = coopStart('client', { players: players, myId: 'me' });
  emitRelay('h1', { k: 'ev', e: { k: 'lose' } });
  assertEq(s.Game.state(), 'over', 'lose 广播后应结算');
  note('客户端 lose 广播处理正确');
}
test({ id: 'G18.4', group: '18', name: '联机客户端 · lose 事件', profiles: ['desktop'], fn: testCoopClientLoseEvent });

function testCoopClientAuthority(){
  const players = [{ id: 'me', name: '我' }, { id: 'c1', name: 'Bob' }];
  const s = coopStart('client', { players: players, myId: 'me' });
  emitRelay('h1', { k: 'snap', t: 1, p: [[0, 100, 100, 0, 100, 0, 0, 0, 100]],
    e: [], b: [], eb: [], pk: [], w: [1, 0, 0, 1, 0], s: [0, 0, 100, 100, 0] });
  const coins0 = S.Save.data.coins;
  step(3000);
  assertEq(s.Game.state(), 'playing', '客户端不应本地结算胜负');
  assertEq(S.Save.data.coins, coins0, '客户端不应本地发放波次金币');
  const locals = s.G.enemies.filter(e => !e.isGhost);
  assertEq(locals.length, 0, '客户端不应自行生成敌人（实际 ' + locals.length + '）');
  note('客户端未本地推进波次/发金币/生成敌人');
}
test({ id: 'G18.5', group: '18', name: '联机客户端 · 不本地推进波次（主机权威）', profiles: ['desktop'], fn: testCoopClientAuthority });

function testCoopPlayerDownRevive(){
  const s = coopStart('host');
  const p = s.G.player;
  p.invuln = 0; p.hp = 1;
  s.Game._dbg.hurt(50);
  assertEq(p.down, true, '玩家 hp 归零应进入倒地而不是直接失败');
  assertEq(s.Game.state(), 'playing', '队友存活时不应判负');
  stepUntil(() => !p.down, 8000, 50);
  assert(!p.down, '玩家应 6 秒后复活');
  assertClose(p.hp, p.maxHp * 0.5, 2, '玩家复活血量应约 50%');
  note('玩家倒地 6 秒后半血复活（队友存活）');
}
test({ id: 'G19.1', group: '19', name: '联机合作 · 玩家倒地 6 秒复活', profiles: ['desktop'], fn: testCoopPlayerDownRevive });
/* ================= 运行器 ================= */
async function runSuite(){
  const results = [];
  for (let i = 0; i < TESTS.length; i++){
    const t = TESTS[i];
    if (ONLY && ONLY.split(',').indexOf(t.id) < 0 && ONLY.split(',').indexOf(t.group) < 0) continue;
    const base = { id: t.id, group: t.group, name: t.name, profile: PROFILE };
    if (t.profiles.indexOf(PROFILE) < 0){
      results.push(Object.assign({}, base, { status: 'SKIP', reason: '当前 profile=' + PROFILE + ' 不运行该组' }));
      continue;
    }
    if (t.requiresBrowser && !WANT_BROWSER){
      results.push(Object.assign({}, base, { status: 'SKIP', reason: '未启用浏览器冒烟（--no-browser）' }));
      continue;
    }
    let cap = null;
    if (t.capability){
      try { cap = t.capability(); } catch (e){ cap = 'capability 检查异常: ' + (e.message || e); }
    }
    if (cap){
      results.push(Object.assign({}, base, { status: STRICT ? 'FAIL' : 'SKIP', reason: cap, strictBlocked: STRICT }));
      continue;
    }
    seedRng(BASE_SEED + i * 7919);
    resetForTest();
    S.notes = [];
    const t0 = Date.now();
    try {
      await t.fn();
      if (S.errors.length){
        throw new Error('执行期间捕获 ' + S.errors.length + ' 个回调异常：\n' + S.errors.map(e => '[' + e.label + '] ' + e.message).join('\n'));
      }
      results.push(Object.assign({}, base, { status: 'PASS', ms: Date.now() - t0, notes: S.notes.slice() }));
    } catch (err){
      const msg = (err && (err.stack || err.message)) || String(err);
      const errs = S.errors.length ? '\n回调异常：\n' + S.errors.map(e => '[' + e.label + '] ' + e.message).join('\n') : '';
      if (err && err.isEnv){
        results.push(Object.assign({}, base, { status: 'SKIP', reason: '环境: ' + err.message, notes: S.notes.slice() }));
      } else {
        results.push(Object.assign({}, base, { status: 'FAIL', ms: Date.now() - t0, error: msg + errs, notes: S.notes.slice() }));
      }
    }
  }
  return results;
}
function printResults(results, label){
  console.log('\n=== ' + label + ' ===');
  for (const r of results){
    const ms = r.ms !== undefined ? ' (' + r.ms + 'ms)' : '';
    console.log('[' + r.status + '] ' + r.id + ' ' + r.name + ms);
    if (r.reason) console.log('       原因: ' + r.reason);
    if (r.error) console.log(String(r.error).split('\n').map(l => '       ' + l).join('\n'));
    if (r.notes) for (const n of r.notes) console.log('       备注: ' + n);
  }
  const p = results.filter(r => r.status === 'PASS').length;
  const f = results.filter(r => r.status === 'FAIL').length;
  const s = results.filter(r => r.status === 'SKIP').length;
  console.log('--- ' + label + ' 汇总: PASS ' + p + ' / FAIL ' + f + ' / SKIP ' + s + ' ---');
  return { p, f, s };
}
function spawnMobileProfile(){
  const args = [__filename, '--profile=mobile', '--child', '--no-browser', '--json', '--seed=' + BASE_SEED];
  if (STRICT) args.push('--strict');
  const r = cp.spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  const fail = reason => [{ id: 'G0.mobile', group: '0', name: 'mobile profile 子进程', profile: 'mobile', status: 'FAIL', error: reason }];
  if (r.error) return fail('无法启动 mobile 子进程: ' + r.error.message);
  const lines = String(r.stdout || '').split(/\r?\n/);
  const line = lines.slice().reverse().find(l => l.indexOf('@@RESULT_JSON@@') === 0);
  if (!line) return fail('mobile 子进程未返回结果。stdout:\n' + (r.stdout || '') + '\nstderr:\n' + (r.stderr || ''));
  let arr;
  try { arr = JSON.parse(line.slice('@@RESULT_JSON@@'.length).trim()); }
  catch (e){ return fail('解析 mobile 结果失败: ' + e.message); }
  return arr.filter(r => r.profile === 'mobile' && !(r.status === 'SKIP' && /^当前 profile=/.test(r.reason || '')));
}
async function main(){
  console.log('方块枪神 2D · 独立测试运行器');
  console.log('profile=' + PROFILE + '  strict=' + STRICT + '  seed=' + BASE_SEED + '  browser=' + (WANT_BROWSER ? 'on' : 'off') + '  node=' + process.version);
  bootEnvironment();
  let results = await runSuite();
  if (!IS_CHILD && !IS_MOBILE && !hasFlag('--no-mobile')){
    results = results.concat(spawnMobileProfile());
  }
  const summary = printResults(results, '全量结果 (profile=' + PROFILE + (IS_CHILD ? ' 子进程' : '') + ')');
  try {
    fs.writeFileSync(path.join(__dirname, 'last-results.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), profile: PROFILE, strict: STRICT, seed: BASE_SEED, node: process.version, results }, null, 2), 'utf8');
    console.log('结果 JSON 已写入 tests/last-results.json');
  } catch (e){ console.log('写入 last-results.json 失败: ' + e.message); }
  if (JSON_MODE) console.log('@@RESULT_JSON@@ ' + JSON.stringify(results));
  if (summary.f > 0 || hasFlag('--fail-on-skip') && summary.s > 0) process.exitCode = 1;
}
main().catch(err => {
  console.error('运行器自身异常: ' + ((err && (err.stack || err.message)) || err));
  process.exitCode = 2;
});

