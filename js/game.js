/* ============================================================
   方块枪神 2D · 游戏引擎
   ============================================================ */
const Game = (function(){
'use strict';

const W = CFG.W, H = CFG.H, TAU = CFG.TAU, ARENA = CFG.ARENA;
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const hypot = (a, b) => Math.sqrt(a * a + b * b);
const angTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
const pick = a => a[Math.floor(Math.random() * a.length)];
const $ = id => document.getElementById(id);
function angLerp(a, b, t){ const d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; }
function shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

const EVENTS = { onWin: null, onLose: null, onPause: null, onWave: null, onDex: null, onSnapshot: null, onNetEvent: null, onInput: null };
const SNAP_TYPES = Object.keys(ENEMY);

/* ================= 画布 ================= */
const canvas = $('cv'), ctx = canvas.getContext('2d'), stage = $('stage');
let dpr = 1;
function fitStage(){
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.width = (W * s) + 'px';
  stage.style.height = (H * s) + 'px';
  stage.style.fontSize = (16 * s) + 'px';
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', fitStage);

/* ================= 音效 ================= */
const Sfx = {
  ac: null,
  unlock(){
    try {
      if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ac.state === 'suspended') this.ac.resume();
    } catch(e){}
  },
  blip(f1, f2, dur, type, vol){
    if (Save.data.muted) return;
    const ac = this.ac; if (!ac) return;
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f1, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(24, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.03);
  },
  noise(dur, vol, freq, q){
    if (Save.data.muted) return;
    const ac = this.ac; if (!ac) return;
    const t = ac.currentTime, sr = ac.sampleRate, n = Math.max(1, Math.floor(sr * dur));
    const buf = ac.createBuffer(1, n, sr), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = ac.createBufferSource(); s.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ac.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(ac.destination); s.start(t);
  },
  shoot(){ this.blip(900, 170, 0.09, 'square', 0.075); this.noise(0.07, 0.11, 1900, 1.1); },
  eShoot(){ this.blip(330, 150, 0.11, 'sawtooth', 0.04); },
  snipe(){ this.blip(1200, 300, 0.14, 'square', 0.05); },
  hit(){ this.blip(560, 320, 0.04, 'square', 0.04); },
  kill(){ this.noise(0.16, 0.15, 720, 0.8); this.blip(240, 62, 0.16, 'triangle', 0.06); },
  boom(){ this.noise(0.34, 0.22, 300, 0.6); this.blip(160, 42, 0.34, 'sawtooth', 0.09); },
  hurt(){ this.blip(190, 62, 0.24, 'sawtooth', 0.11); this.noise(0.18, 0.11, 420, 0.7); },
  reloadIn(){ this.blip(320, 210, 0.06, 'square', 0.05); },
  reloadOut(){ this.blip(680, 980, 0.08, 'square', 0.06); },
  pickup(){ this.blip(720, 1350, 0.13, 'sine', 0.085); },
  dash(){ this.noise(0.18, 0.1, 1000, 0.7); this.blip(420, 900, 0.1, 'sine', 0.05); },
  wave(){ this.blip(440, 660, 0.15, 'triangle', 0.075); setTimeout(() => this.blip(660, 900, 0.18, 'triangle', 0.075), 120); },
  coin(){ this.blip(1180, 1560, 0.07, 'sine', 0.05); },
  shield(){ this.blip(300, 700, 0.16, 'sine', 0.06); },
  win(){ [523,659,784,1046].forEach((f,i) => setTimeout(() => this.blip(f, f*1.5, 0.22, 'triangle', 0.09), i*130)); },
  lose(){ this.blip(320, 55, 0.85, 'sawtooth', 0.12); this.noise(0.7, 0.1, 260, 0.6); },
  over(){ this.blip(300, 50, 0.7, 'sawtooth', 0.11); }
};

/* ================= 输入 ================= */
const keys = Object.create(null);
const input = { mx: W/2, my: H/2, mouseDown: false, wheelAim: false, usedMouse: false,
                joyX: 0, joyY: 0, touchFire: false, touchMode: false };
let touchCapable = false;

window.addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code) >= 0) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (G.state === 'playing' || G.state === 'paused'){
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    else if (e.code === 'KeyR') tryReload();
    else if (e.code === 'KeyM'){ Save.data.muted = !Save.data.muted; Save.save(); toast(Save.data.muted ? '🔇 已静音' : '🔊 声音开启'); }
    else if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryDash();
  }
}, { passive: false });
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { if (G.state === 'playing') togglePause(); input.mouseDown = false; input.wheelAim = false; btnMask = 0; });

/* 鼠标按键位掩码：bit0=左键(射击) bit1=右键 bit2=中键(锁敌) —— 多个键可同时按住 */
let btnMask = 0;
function btnBit(b){ return b === 1 ? 4 : b === 2 ? 2 : (b === 0 || b === undefined || b === null) ? 1 : 8; }   // 未给 button 时按左键处理
function setBtns(e, mode){
  if (typeof e.buttons === 'number') btnMask = e.buttons;
  else if (mode === 'down') btnMask |= btnBit(e.button);
  else if (mode === 'up') btnMask &= ~btnBit(e.button);
  input.mouseDown = (btnMask & 1) !== 0;
  input.wheelAim = (btnMask & 4) !== 0;
}
function toLocal(cx, cy){
  const r = canvas.getBoundingClientRect();
  return { x: (cx - r.left) / r.width * W, y: (cy - r.top) / r.height * H };
}
canvas.addEventListener('pointerdown', e => {
  Sfx.unlock();
  if (e.pointerType === 'touch') return;
  input.touchMode = false; input.usedMouse = true;
  const p = toLocal(e.clientX, e.clientY); input.mx = p.x; input.my = p.y;
  if (e.button === 1) e.preventDefault();      // 中键：别触发浏览器自动滚动
  setBtns(e, 'down');                          // 左键=射击，中键=锁敌，可同时按住
});
canvas.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });   // 关掉中键自动滚动
canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  input.touchMode = false;
  const p = toLocal(e.clientX, e.clientY); input.mx = p.x; input.my = p.y; input.usedMouse = true;
  setBtns(e, 'move');
});
window.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') setBtns(e, 'up'); });
canvas.addEventListener('contextmenu', e => e.preventDefault());

/* ================= 全局状态 ================= */
const G = {
  state: 'idle',                 // idle | playing | paused | over
  player: null, inter: null, freeze: 0,
  enemies: [], bullets: [], ebullets: [], particles: [], texts: [], pickups: [],
  markers: [], ghosts: [], deco: [], obstacles: [], loot: [], houses: [], remotes: [],
  cam: { x: 0, y: 0 }, world: { w: W, h: H },
  bounds: { l: ARENA.l, t: ARENA.t, r: ARENA.r, b: ARENA.b },
  shake: 0, hitStop: 0, bg: 0, time: 0,
  banner: null, boss: null, hintT: 0
};
let RUN = null;
const MAX_ALIVE = 40;            // 同屏敌人上限（超出的排队刷新）

/* ================= 几何 / 障碍物 ================= */
function pointInRects(x, y){
  for (let i = 0; i < G.obstacles.length; i++){
    const b = G.obstacles[i];
    if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return b;
  }
  return null;
}
function resolveCircle(o, r){
  for (let i = 0; i < G.obstacles.length; i++){
    const b = G.obstacles[i];
    const cx = clamp(o.x, b.x, b.x + b.w), cy = clamp(o.y, b.y, b.y + b.h);
    let dx = o.x - cx, dy = o.y - cy, d = hypot(dx, dy);
    if (d < r){
      if (d < 0.0001){
        const l = o.x - b.x, rr = b.x + b.w - o.x, t = o.y - b.y, bo = b.y + b.h - o.y;
        const m = Math.min(l, rr, t, bo);
        if (m === l) o.x = b.x - r; else if (m === rr) o.x = b.x + b.w + r;
        else if (m === t) o.y = b.y - r; else o.y = b.y + b.h + r;
      } else {
        o.x = cx + dx / d * r; o.y = cy + dy / d * r;
      }
    }
  }
}
function segRect(x1, y1, x2, y2, b){
  const dx = x2 - x1, dy = y2 - y1;
  if (x1 > b.x - 8 && x1 < b.x + b.w + 8 && y1 > b.y - 8 && y1 < b.y + b.h + 8) return true;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy], q = [x1 - b.x, b.x + b.w - x1, y1 - b.y, b.y + b.h - y1];
  for (let i = 0; i < 4; i++){
    if (p[i] === 0){ if (q[i] < 0) return false; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0){ if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
function blockedTo(x1, y1, x2, y2){
  for (let i = 0; i < G.obstacles.length; i++) if (segRect(x1, y1, x2, y2, G.obstacles[i])) return true;
  return false;
}
function freeSpot(x, y, pad){
  const r = pad || 22;
  for (let i = 0; i < G.obstacles.length; i++){
    const b = G.obstacles[i];
    if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return false;
  }
  return true;
}
function makeObstacles(key){
  if (key === 'random'){
    const pool = OBSTACLES.grid.concat(OBSTACLES.rooms, OBSTACLES.arena, OBSTACLES.pillars4);
    const out = [];
    for (let i = 0; i < 6; i++){
      const b = pick(pool);
      const x = rnd(120, 620), y = rnd(100, 380);
      const nb = { x: Math.round(x / 8) * 8, y: Math.round(y / 8) * 8, w: b.w, h: b.h };
      if (Math.abs(nb.x + nb.w/2 - W/2) < 120 && Math.abs(nb.y + nb.h/2 - H/2) < 110) continue;
      let ok = true;
      for (const o of out) if (nb.x < o.x + o.w + 60 && nb.x + nb.w + 60 > o.x && nb.y < o.y + o.h + 60 && nb.y + nb.h + 60 > o.y) ok = false;
      if (ok) out.push(nb);
    }
    return out;
  }
  const src = OBSTACLES[key] || [];
  return src.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
}

/* ================= 粒子 / 文字 ================= */
function addPart(x, y, vx, vy, life, size, color, opt){
  if (G.particles.length > 460) return;
  const q = { x, y, vx, vy, life, max: life, size, color, rot: rnd(0, TAU), vr: rnd(-9, 9), drag: 3.2, glow: false };
  if (opt) for (const k in opt) q[k] = opt[k];
  G.particles.push(q);
}
function burst(x, y, color, n, power, opt){
  for (let i = 0; i < n; i++){
    const a = rnd(0, TAU), s = rnd(power * 0.35, power);
    addPart(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.25, 0.6), rnd(3, 8), color, opt);
  }
}
function floatText(x, y, txt, color, size){
  if (G.texts.length > 34) G.texts.shift();
  G.texts.push({ x, y, txt, color: color || '#fff', size: size || 15, life: 0.8, max: 0.8 });
}
let toastTimer = 0;
function toast(msg){
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1200);
}
function banner(title, sub){ G.banner = { title, sub, life: 1.9, max: 1.9 }; }

/* ================= 玩家 ================= */
function makePlayer(){
  const st = RUN.st;
  const wid = RUN.mode === 'br' ? 'pistol_s' : 'pistol';   // 大逃杀：开局只有一把小手枪
  const w = getWeapon(wid);
  const magSize = (w.mag || 0) + st.magAdd;
  return { x: W/2, y: H/2, vx: 0, vy: 0, r: 15, hp: st.maxHp, maxHp: st.maxHp, aim: -Math.PI/2,
           weapon: wid, mag: magSize, magSize: magSize, reloading: 0, reloadTime: w.reload * st.reloadMul, fireCd: 0,
           dashCd: 0, dashTime: 0, dashDir: 0, invuln: 0, flash: 0, hurt: 0, rage: 0, dashHits: null,
           pickCd: 0, swing: 0 };
}
function giveWeapon(id){
  const p = G.player, st = RUN.st, w = getWeapon(id);
  p.weapon = id;
  p.magSize = (w.mag || 0) + st.magAdd;
  p.mag = w.kind === 'melee' ? 0 : p.magSize;
  p.reloading = 0; p.reloadTime = (w.reload || 1) * st.reloadMul; p.fireCd = 0.18;
  return w;
}
function moveInput(){
  let x = 0, y = 0;
  if (keys['KeyA'] || keys['ArrowLeft']) x -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) x += 1;
  if (keys['KeyW'] || keys['ArrowUp']) y -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) y += 1;
  if (x === 0 && y === 0){ x = input.joyX; y = input.joyY; }
  const m = hypot(x, y);
  if (m > 1){ x /= m; y /= m; }
  return { x, y };
}
function tryReload(){
  const p = G.player;
  if (!p || G.state !== 'playing' || p.reloading > 0) return;
  const w = getWeapon(p.weapon);
  if (w.kind === 'melee' || p.mag >= p.magSize) return;
  p.reloadTime = (w.reload || 1) * RUN.st.reloadMul;
  p.reloading = p.reloadTime; Sfx.reloadIn();
}
function angDiff(a, b){ return Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI); }
function meleeSwing(w){
  const p = G.player, st = RUN.st;
  p.fireCd = w.rate * st.rateMul; p.swing = 0.22; p.flash = 0.05;
  Sfx.noise(0.09, 0.10, 900, 1.4);
  let hits = 0;
  for (let i = 0; i < G.enemies.length; i++){
    const e = G.enemies[i];
    if (e.dead || e.appear > 0) continue;
    const d = hypot(e.x - p.x, e.y - p.y);
    if (d > w.range + e.r) continue;
    if (angDiff(angTo(p.x, p.y, e.x, e.y), p.aim) > w.arc) continue;
    const crit = Math.random() < st.critChance;
    const dmg = Math.round((w.dmg + st.dmgAdd) * (crit ? st.critMul : 1));
    hitEnemy(e, dmg, { fx: p.x, fy: p.y, knock: 320, crit, frost: st.frost });
    floatText(e.x + rnd(-6, 6), e.y - e.r - 4, String(dmg), crit ? '#ffd24a' : '#ffd9b0', crit ? 19 : 14);
    burst(e.x, e.y, '#ff9f2e', 7, 220);
    hits++;
  }
  G.shake = Math.min(G.shake + (hits ? 4 : 1.5), 12);
  if (hits){ Sfx.hit(); G.hitStop = Math.max(G.hitStop, 0.035); }
}
function pickupLoot(l){
  const p = G.player, old = p.weapon;
  const w = giveWeapon(l.weapon);
  l.weapon = old; l.t = 0;
  p.pickCd = 0.55;
  toast('拾取：' + w.name + (w.kind === 'melee' ? '（近战 · 无限挥砍）' : ''));
  floatText(p.x, p.y - 34, w.name, '#ffd24a', 17);
  Sfx.pickup();
  burst(l.x, l.y, '#ffd24a', 8, 160);
}
function tryDash(){
  const p = G.player, st = RUN.st;
  if (!p || G.state !== 'playing' || p.dashCd > 0 || p.dashTime > 0) return;
  const m = moveInput();
  const a = (hypot(m.x, m.y) > 0.15) ? Math.atan2(m.y, m.x) : p.aim;
  p.dashTime = 0.16; p.dashDir = a; p.dashCd = st.dashCd;
  p.invuln = Math.max(p.invuln, 0.34);
  if (st.dashDamage) p.dashHits = [];
  Sfx.dash();
  for (let i = 0; i < 12; i++){
    const ang = a + Math.PI + rnd(-0.7, 0.7);
    addPart(p.x, p.y, Math.cos(ang) * rnd(60, 220), Math.sin(ang) * rnd(60, 220), rnd(0.2, 0.45), rnd(2, 5), st.color);
  }
}
function fire(){
  const p = G.player, st = RUN.st;
  if (p.fireCd > 0 || p.reloading > 0) return;
  const w = getWeapon(p.weapon);
  if (w.kind === 'melee'){ meleeSwing(w); return; }        // 刀：近战横扫
  if (p.mag <= 0){ tryReload(); return; }
  const crit = Math.random() < st.critChance;
  const dmg = Math.round((w.dmg + st.dmgAdd) * (crit ? st.critMul : 1));
  p.mag--; p.fireCd = w.rate * st.rateMul * Math.pow(0.98, p.rage); p.flash = 0.07;
  const a = p.aim + rnd(-w.spread, w.spread);
  const mx = p.x + Math.cos(p.aim) * 22, my = p.y + Math.sin(p.aim) * 22;
  G.bullets.push({ x: mx, y: my, vx: Math.cos(a) * w.bspeed, vy: Math.sin(a) * w.bspeed, r: 4.5,
                   dmg, crit, color: w.color, pierce: crit ? 1 : 0, life: 1.2, hit: [], frost: st.frost, boom: st.critBoom && crit });
  p.vx -= Math.cos(a) * 62; p.vy -= Math.sin(a) * 62;
  G.shake = Math.min(G.shake + (crit ? 5 : 2.6), 14);
  addPart(mx, my, Math.cos(p.aim) * rnd(40, 120), Math.sin(p.aim) * rnd(40, 120), 0.25, rnd(2, 4), '#ffd24a', { drag: 5 });
  addPart(p.x + Math.cos(p.aim + 1.6) * 10, p.y + Math.sin(p.aim + 1.6) * 10,
          Math.cos(p.aim + 1.4) * rnd(60, 140), Math.sin(p.aim + 1.4) * rnd(60, 140), 0.5, 3, '#e8c46a', { drag: 6 });
  Sfx.shoot();
  if (p.mag === 0) tryReload();
}
function damagePlayer(dmg){
  const p = G.player, st = RUN.st;
  if (!p || p.invuln > 0 || G.state !== 'playing') return;
  dmg = Math.max(1, Math.round(dmg * st.dmgTaken));
  p.hp -= dmg; p.invuln = 0.75; p.hurt = 0.3; p.rage = 0;
  G.shake = Math.min(G.shake + 9, 22);
  Sfx.hurt();
  for (let i = 0; i < 10; i++) addPart(p.x, p.y, rnd(-160, 160), rnd(-160, 160), rnd(0.3, 0.6), rnd(3, 6), '#ff5a72');
  if (p.hp <= 0){
    p.hp = 0;
    if (RUN.net){
      p.down = true; p.reviveT = 6; p.invuln = 1.2; p.vx = 0; p.vy = 0;
      if (EVENTS.onNetEvent) EVENTS.onNetEvent({ k: 'down', name: '我' });
      const alive = targets().filter(t => t && !t.down);
      if (!alive.length) loseRun();
    } else loseRun();
  }
}
function healPlayer(v, silent){
  const p = G.player, st = RUN.st;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + v);
  if (!silent && p.hp > before) floatText(p.x, p.y - 24, '+' + Math.round(p.hp - before) + ' HP', '#7dffb1', 16);
}

/* ================= 敌人 ================= */
function cheat(key){ return RUN && RUN.cheats && RUN.cheats.indexOf(key) >= 0; }
/* 个体特性：难度档外挂（cheat）与怪物自带 traits 共用同一套实现 */
function typeHas(t, key){ return cheat(key) || !!(t && t.traits && t.traits.indexOf(key) >= 0); }
/* 行为原型由数据决定：远程/狙击/分裂/自爆/近战 —— 50 种怪共用这几套 AI */
function enemyRole(t){
  if (!t) return 'chaser';
  if (t.bSpeed && t.range) return t.boss ? 'boss' : (t.charge ? 'sniper' : 'shooter');
  if (t.split) return 'splitter';
  if (t.boom) return 'bomber';
  return 'chaser';
}
function hasTrait(e, key){ return typeHas(e && e.t, key); }
function makeEnemy(type, x, y, opt){
  const t = ENEMY[type], o = opt || {};
  const hpMul = o.hpMul || 1, spdMul = o.spdMul || 1;
  const speed = t.speed * spdMul * (typeHas(t, 'speed') ? 1.25 : 1);
  const hp = Math.max(1, Math.round(t.hp * hpMul));

  return { type, t, x, y, vx: 0, vy: 0, size: t.size, r: t.size * 0.5, hp, maxHp: hp,
           speed, baseSpeed: speed, appear: 0.45, flash: 0, contactCd: 0, shootCd: rnd(0.8, 1.7),
           windup: 0, angle: rnd(0, TAU), wob: rnd(0, TAU), strafe: Math.random() < 0.5 ? -1 : 1,
           home: { x: x, y: y }, wanderT: rnd(0.6, 3), aggro: false,
           blockT: 0, slowT: 0, slowF: 1, shield: 0, shieldCd: typeHas(t, 'shield') ? rnd(2, 6) : 0,
           blinkCd: typeHas(t, 'blink') ? rnd(2, 4) : 0, summonCd: typeHas(t, 'summon') ? rnd(3, 6) : 0,
           revived: false, dead: false, boss: !!t.boss, role: enemyRole(t) };
}
function spawnAt(type, x, y, opt){
  const e = makeEnemy(type, x, y, opt);
  e.vx = rnd(-70, 70); e.vy = rnd(-70, 70);
  if (e.appear > 0) e.appear = 0.25;
  G.enemies.push(e);
  if (e.boss) G.boss = e;
  return e;
}
function nearestEnemy(x, y, maxD){
  let best = null, bd = (maxD || 9999) * (maxD || 9999);
  for (let i = 0; i < G.enemies.length; i++){
    const e = G.enemies[i];
    if (e.appear > 0 || e.dead) continue;
    const d = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
    if (d < bd){ bd = d; best = e; }
  }
  return best;
}
function explode(x, y, radius, dmg, opt){
  const o = opt || {};
  for (let i = 0; i < 22; i++){
    const a = rnd(0, TAU), s = rnd(60, radius * 3.4);
    addPart(x, y, Math.cos(a) * s, Math.sin(a) * s, rnd(0.25, 0.55), rnd(3, 9), o.color || '#ffb03a', { glow: true });
  }
  G.shake = Math.min(G.shake + 7, 20);
  Sfx.boom();
  if (o.hurtEnemies !== false){
    for (let i = 0; i < G.enemies.length; i++){
      const e = G.enemies[i];
      if (e.dead || e.appear > 0) continue;
      const d = hypot(e.x - x, e.y - y);
      if (d < radius + e.r){ hitEnemy(e, dmg, { from: 'boom' }); }
    }
  }
  if (o.hurtPlayer){
    const p = G.player;
    if (p && hypot(p.x - x, p.y - y) < radius + p.r) damagePlayer(dmg);
  }
}
function hitEnemy(e, dmg, opt){
  const o = opt || {};
  if (e.dead) return false;
  if (e.shield > 0){
    e.shield--; e.flash = 0.12;
    floatText(e.x, e.y - e.r - 6, '护盾!', '#7fe0ff', 15);
    burst(e.x, e.y, '#7fe0ff', 8, 180);
    Sfx.shield();
    return false;
  }
  e.hp -= dmg; e.flash = 0.1;
  if (o.knock){
    const ka = Math.atan2(e.y - (o.fy || e.y), e.x - (o.fx || e.x));
    e.vx += Math.cos(ka) * o.knock; e.vy += Math.sin(ka) * o.knock;
  }
  if (o.frost && Math.random() < o.frost){ e.slowT = 1.6; e.slowF = 0.6; }
  if (e.hp <= 0) killEnemy(e, o);
  return true;
}
function killEnemy(e, opt){
  const o = opt || {};
  const innateRevive = !!(e.t.traits && e.t.traits.indexOf('revive') >= 0);
  if (hasTrait(e, 'revive') && !e.revived && (innateRevive || e.t.size >= 44)){
    e.revived = true; e.hp = Math.round(e.maxHp * 0.5); e.flash = 0.35;
    floatText(e.x, e.y - e.r - 10, '复活挂!', '#ff9f2e', 17);
    burst(e.x, e.y, '#ff9f2e', 18, 260);
    G.shake = Math.min(G.shake + 6, 18);
    return;
  }
  e.dead = true;
  const st = RUN.st;
  RUN.kills++;
  if (Save.dexCount(e.type) === 0){        // 第一次击败 = 解锁图鉴
    Save.dexAdd(e.type);
    if (EVENTS.onDex) EVENTS.onDex(e.type);
  } else {
    Save.dexAdd(e.type);                   // 之后累计击杀数
  }
  RUN.combo++; RUN.comboT = 2.8;
  const mult = comboMult();
  const gain = Math.round(e.t.score * mult * (RUN.scoreMul || 1));
  RUN.score += gain;
  /* 击杀不再掉落金币：金币只来自首次通关（战役）与每波结算（难度关卡） */

  floatText(e.x, e.y - 8, '+' + gain, mult > 1 ? '#ffd24a' : '#dff1ff', mult > 1 ? 18 : 15);
  burst(e.x, e.y, e.t.color, 14, 250);
  burst(e.x, e.y, '#ffffff', 5, 150);
  G.shake = Math.min(G.shake + 4, 16);
  G.hitStop = Math.max(G.hitStop, 0.05);
  Sfx.kill();
  if (st.rage) G.player.rage = Math.min(10, G.player.rage + 1);
  if (st.lifesteal) healPlayer(st.lifesteal, true);
  if (o.crit && st.critBoom){ floatText(e.x, e.y - 30, '熔岩爆裂!', '#ff7a2e', 15); explode(e.x, e.y, 92, 40, { color: '#ff7a2e' }); }
  if (RUN.mode === 'br' && RUN.br){ RUN.br.killed++; if (RUN.br.killed > RUN.br.total) RUN.br.total = RUN.br.killed; }
  if (e.t.split){
    if (RUN.mode === 'br' && RUN.br) RUN.br.total += e.t.split;
    for (let i = 0; i < e.t.split; i++){
      const a = rnd(0, TAU);
      const m = makeEnemy('mini', e.x + Math.cos(a) * 16, e.y + Math.sin(a) * 16, { hpMul: RUN.hpMul });
      m.appear = 0.2; m.vx = Math.cos(a) * 160; m.vy = Math.sin(a) * 160;
      G.enemies.push(m);
    }
  }
  if (e.t.boom) explode(e.x, e.y, e.t.boom.radius, e.t.boom.dmg, { hurtPlayer: true, hurtEnemies: false, color: '#ff6ad5' });
  if (e.boss) G.boss = null;
  if (Math.random() < (e.t.boss ? 0 : e.t.size >= 44 ? 0.4 : e.type === 'mini' ? 0.06 : 0.12)){
    G.pickups.push({ x: e.x, y: e.y, r: 13, t: 0, life: 14 });
  }
}
function comboMult(){ return clamp(1 + Math.floor(RUN.combo / 5) * 0.5, 1, 4); }

function enemyShoot(e){
  const p = G.player;
  let tgt = { x: p.x, y: p.y };
  if (hasTrait(e, 'aimbot')){                    // 透视锁头：预判走位
    const d = hypot(p.x - e.x, p.y - e.y), tt = d / e.t.bSpeed;
    tgt = { x: p.x + p.vx * tt * 0.85, y: p.y + p.vy * tt * 0.85 };
  }
  const a = angTo(e.x, e.y, tgt.x, tgt.y) + rnd(-0.06, 0.06);
  const sp = e.t.bSpeed;
  const shots = e.boss ? 3 : (e.t.shots || 1);
  for (let i = 0; i < shots; i++){
    const aa = a + (shots > 1 ? (i - (shots - 1) / 2) * 0.22 : 0);
    G.ebullets.push({ x: e.x + Math.cos(aa) * (e.r + 6), y: e.y + Math.sin(aa) * (e.r + 6),
                      vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, r: e.t.boss ? 7 : 5.5,
                      dmg: e.t.bDmg, life: 3.6, color: e.t.color,
                      homing: hasTrait(e, 'homing'), wall: hasTrait(e, 'wallhack'), owner: e });
  }
  for (let i = 0; i < 4; i++) addPart(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r,
                                      Math.cos(a) * rnd(40, 120), Math.sin(a) * rnd(40, 120), 0.25, 3, e.t.color);
  e.t.charge ? Sfx.snipe() : Sfx.eShoot();
}
function updateEnemies(dt){
  for (let i = G.enemies.length - 1; i >= 0; i--){
    const e = G.enemies[i];
    const p = (RUN.net && G.remotes.length) ? nearestTarget(e.x, e.y) : G.player;
    if (e.dead){ G.enemies.splice(i, 1); continue; }
    e.wob += dt * 3; e.angle += dt * 0.8;
    if (e.flash > 0) e.flash -= dt;
    if (e.contactCd > 0) e.contactCd -= dt;
    if (e.slowT > 0){ e.slowT -= dt; if (e.slowT <= 0) e.slowF = 1; }
    if (e.appear > 0){
      e.appear -= dt;
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt);
      continue;
    }
    /* --- 外挂：回血 / 护盾 / 瞬移 / 狂暴 --- */
    /* --- 大逃杀：未激活的敌人只在附近活动，够近或被打过才追击 --- */
    if (RUN.mode === 'br'){
      if (!e.home) e.home = { x: e.x, y: e.y };
      const dp0 = hypot(p.x - e.x, p.y - e.y);
      if (!e.aggro){
        if (dp0 < 430 || e.hp < e.maxHp) e.aggro = true;
        else {
          if (!inView(e.x, e.y, 300)) continue;
          e.wanderT -= dt;
          if (e.wanderT <= 0 || e.wx === undefined){
            e.wanderT = rnd(1.6, 4.2);
            const wa = rnd(0, TAU), wr = rnd(40, 150);
            e.wx = clamp(e.home.x + Math.cos(wa) * wr, G.bounds.l + 30, G.bounds.r - 30);
            e.wy = clamp(e.home.y + Math.sin(wa) * wr, G.bounds.t + 30, G.bounds.b - 30);
          }
          const wdx = e.wx - e.x, wdy = e.wy - e.y, wm = Math.max(1, hypot(wdx, wdy));
          const wk = 1 - Math.pow(0.02, dt);
          e.vx = lerp(e.vx, wdx / wm * e.speed * 0.32, wk);
          e.vy = lerp(e.vy, wdy / wm * e.speed * 0.32, wk);
          e.x += e.vx * dt; e.y += e.vy * dt;
          resolveCircle(e, e.r);
          e.x = clamp(e.x, G.bounds.l + e.r, G.bounds.r - e.r);
          e.y = clamp(e.y, G.bounds.t + e.r, G.bounds.b - e.r);
          continue;
        }
      }
    }
    if (hasTrait(e, 'regen') && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.015 * dt);
    if (hasTrait(e, 'shield')){
      if (e.shieldCd > 0){
        e.shieldCd -= dt;
        if (e.shieldCd <= 0){ e.shield = 1; Sfx.shield(); burst(e.x, e.y, '#7fe0ff', 8, 120); }
      }
    }
    if (hasTrait(e, 'blink') && !e.boss){
      e.blinkCd -= dt;
      if (e.blinkCd <= 0 && hypot(p.x - e.x, p.y - e.y) > 120){
        e.blinkCd = 4;
        const a = angTo(e.x, e.y, p.x, p.y);
        burst(e.x, e.y, e.t.color, 10, 160);
        e.x = clamp(e.x + Math.cos(a) * 100, G.bounds.l + e.r, G.bounds.r - e.r);
        e.y = clamp(e.y + Math.sin(a) * 100, G.bounds.t + e.r, G.bounds.b - e.r);
        resolveCircle(e, e.r);
        burst(e.x, e.y, '#ffffff', 8, 200);
      }
    }
    if (hasTrait(e, 'berserk') && e.hp < e.maxHp * 0.35){
      e.speed = e.baseSpeed * 1.4;
      e.berserk = true;
    } else if (e.berserk){ e.speed = e.baseSpeed; e.berserk = false; }
    /* --- 个体特性：召唤小怪 --- */
    if (e.summonCd > 0){
      e.summonCd -= dt;
      if (e.summonCd <= 0){
        e.summonCd = rnd(6, 9);
        if (G.enemies.length < MAX_ALIVE){
          const sn = rndi(1, 2);
          for (let k = 0; k < sn; k++){
            const sa = rnd(0, TAU);
            const sm = makeEnemy('mini', e.x + Math.cos(sa) * 28, e.y + Math.sin(sa) * 28, { hpMul: RUN.hpMul });
            sm.appear = 0.2; sm.aggro = true;
            sm.vx = Math.cos(sa) * 90; sm.vy = Math.sin(sa) * 90;
            G.enemies.push(sm);
            if (RUN.mode === 'br' && RUN.br) RUN.br.total += 1;
          }
          burst(e.x, e.y, e.t.color, 10, 170);
          floatText(e.x, e.y - e.r - 8, '召唤!', e.t.color, 14);
        }
      }
    }

    const dx = p.x - e.x, dy = p.y - e.y, d = Math.max(1, hypot(dx, dy));
    const ux = dx / d, uy = dy / d;
    let ax = 0, ay = 0;
    const blocked = d > 90 && blockedTo(e.x, e.y, p.x, p.y);
    if (blocked){
      e.blockT += dt;
      if (e.blockT > 1.1){ e.strafe *= -1; e.blockT = 0; }
    } else e.blockT = 0;

    if (e.role === 'shooter' || e.role === 'sniper' || e.role === 'boss'){
      const charge = e.t.charge || 0.34;
      if (e.windup > 0){
        e.windup -= dt;
        if (e.windup <= 0) enemyShoot(e);
        ax *= 0.1; ay *= 0.1;
      } else {
        e.shootCd -= dt;
        if (e.shootCd <= 0 && d < 560 && !blocked){
          e.windup = charge;
          if (e.boss) e.shootCd = e.t.fireCd; else e.shootCd = e.t.fireCd + rnd(-0.2, 0.35);
        }
        const gap = d - (e.t.range || 260);
        const near = clamp(gap / 90, -1, 1);
        ax = ux * near - uy * e.strafe * 0.85;
        ay = uy * near + ux * e.strafe * 0.85;
      }
    } else if (e.role === 'splitter'){
      const w = Math.sin(e.wob) * 0.55;
      ax = ux - uy * w; ay = uy + ux * w;
    } else if (e.role === 'bomber'){
      ax = ux * 1.15; ay = uy * 1.15;
    } else {
      ax = ux + Math.cos(e.wob) * 0.12; ay = uy + Math.sin(e.wob) * 0.12;
    }
    if (blocked){ ax += -uy * e.strafe * 1.15; ay += ux * e.strafe * 1.15; }
    const am = hypot(ax, ay);
    if (am > 1){ ax /= am; ay /= am; }
    const sp = e.speed * e.slowF;
    const k = 1 - Math.pow(0.0016, dt);
    e.vx = lerp(e.vx, ax * sp, k);
    e.vy = lerp(e.vy, ay * sp, k);
    e.x += e.vx * dt; e.y += e.vy * dt;
    resolveCircle(e, e.r);
    e.x = clamp(e.x, G.bounds.l + e.r, G.bounds.r - e.r);
    e.y = clamp(e.y, G.bounds.t + e.r, G.bounds.b - e.r);

    if (d < e.r + p.r && e.contactCd <= 0 && p.invuln <= 0){
      damageTarget(p, e.t.contact);
      e.contactCd = 0.85;
      e.vx -= ux * 240; e.vy -= uy * 240;
      if (hasTrait(e, 'steal')){
        e.hp = Math.min(e.maxHp, e.hp + e.t.contact * 0.5);
        floatText(e.x, e.y - e.r - 6, '吸血!', '#ff6a8a', 13);
      }
      if (e.t.boom){ hitEnemy(e, 9999, { from: 'boom' }); continue; }
      if (G.state === 'playing'){ p.vx += ux * 180; p.vy += uy * 180; }
    }
    for (let j = i - 1; j >= 0; j--){
      const o = G.enemies[j];
      if (o.appear > 0 || o.dead) continue;
      const ddx = o.x - e.x, ddy = o.y - e.y, dd = hypot(ddx, ddy), min = e.r + o.r;
      if (dd > 0.01 && dd < min){
        const push = (min - dd) * 0.5, nx = ddx / dd, ny = ddy / dd;
        e.x -= nx * push * 0.5; e.y -= ny * push * 0.5;
        o.x += nx * push * 0.5; o.y += ny * push * 0.5;
      }
    }
  }
}

/* ================= 子弹 ================= */
function updateBullets(dt){
  const st = RUN.st;
  for (let i = G.bullets.length - 1; i >= 0; i--){
    const b = G.bullets[i];
    b.life -= dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.life <= 0 || b.x < -30 || b.x > G.world.w + 30 || b.y < -30 || b.y > G.world.h + 30){ G.bullets.splice(i, 1); continue; }
    if (pointInRects(b.x, b.y)){
      burst(b.x, b.y, '#9fe9ff', 5, 150); Sfx.hit();
      G.bullets.splice(i, 1); continue;
    }
    if (Math.random() < 0.45) addPart(b.x, b.y, rnd(-18, 18), rnd(-18, 18), 0.2, rnd(1.5, 3), b.crit ? '#ffd24a' : st.color, { drag: 6, glow: true });
    let hitSomething = false;
    for (let j = 0; j < G.enemies.length; j++){
      const e = G.enemies[j];
      if (e.dead || e.appear > 0 || b.hit.indexOf(e) >= 0) continue;
      if (hypot(e.x - b.x, e.y - b.y) < e.r + b.r){
        hitEnemy(e, b.dmg, { fx: b.x - b.vx * 0.02, fy: b.y - b.vy * 0.02, knock: 120, frost: b.frost, crit: b.crit });
        floatText(e.x + rnd(-6, 6), e.y - e.r - 4, String(b.dmg), b.crit ? '#ffd24a' : '#e6f6ff', b.crit ? 19 : 14);
        burst(b.x, b.y, b.crit ? '#ffd24a' : '#bff0ff', b.crit ? 8 : 5, 190);
        G.hitStop = Math.max(G.hitStop, b.crit ? 0.045 : 0.015);
        Sfx.hit();
        b.hit.push(e);
        if (b.pierce > 0 && e.hp > 0){ b.pierce--; b.dmg = Math.round(b.dmg * 0.7); }
        else hitSomething = true;
        break;
      }
    }
    if (hitSomething) G.bullets.splice(i, 1);
  }
  const p = G.player;
  for (let i = G.ebullets.length - 1; i >= 0; i--){
    const b = G.ebullets[i];
    b.life -= dt;
    if (b.homing){
      const a = Math.atan2(b.vy, b.vx), ta = angTo(b.x, b.y, p.x, p.y);
      const na = angLerp(a, ta, 1 - Math.pow(0.35, dt));
      const sp = hypot(b.vx, b.vy);
      b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (Math.random() < 0.3) addPart(b.x, b.y, rnd(-14, 14), rnd(-14, 14), 0.22, rnd(2, 4), b.color, { drag: 5, glow: true });
    if (b.life <= 0 || b.x < -40 || b.x > G.world.w + 40 || b.y < -40 || b.y > G.world.h + 40){ G.ebullets.splice(i, 1); continue; }
    if (!b.wall && pointInRects(b.x, b.y)){
      burst(b.x, b.y, b.color, 5, 140); G.ebullets.splice(i, 1); continue;
    }
    const tlist = targets();
    let hitT = null;
    for (let k = 0; k < tlist.length; k++){
      const tt = tlist[k];
      if (!tt || tt.down) continue;
      if (hypot(tt.x - b.x, tt.y - b.y) < tt.r + b.r){ hitT = tt; break; }
    }
    if (hitT){
      if (hitT.invuln <= 0){
        damageTarget(hitT, b.dmg);
        if (b.owner && !b.owner.dead && hasTrait(b.owner, 'steal')){
          b.owner.hp = Math.min(b.owner.maxHp, b.owner.hp + b.dmg * 0.25);
          floatText(b.owner.x, b.owner.y - b.owner.r - 6, '吸血!', '#ff6a8a', 13);
        }
      }
      burst(b.x, b.y, b.color, 6, 150);
      G.ebullets.splice(i, 1);
    }
  }
}
function updatePickups(dt){
  const p = G.player, st = RUN.st;
  for (let i = G.pickups.length - 1; i >= 0; i--){
    const u = G.pickups[i];
    u.t += dt; u.life -= dt;
    if (u.life <= 0){ G.pickups.splice(i, 1); continue; }
    if (hypot(p.x - u.x, p.y - u.y) < p.r + u.r + 4){
      healPlayer(Math.round(22 * st.healMul), true);
      floatText(p.x, p.y - 26, '+' + Math.round(22 * st.healMul) + ' HP', '#7dffb1', 16);
      Sfx.pickup(); burst(u.x, u.y, '#7dffb1', 12, 200);
      G.pickups.splice(i, 1);
    }
  }
}
function updateParticles(dt){
  for (let i = G.particles.length - 1; i >= 0; i--){
    const q = G.particles[i];
    q.life -= dt;
    if (q.life <= 0){ G.particles.splice(i, 1); continue; }
    const d = Math.pow(1 / (1 + q.drag), dt);
    q.vx *= d; q.vy *= d;
    q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
  }
  for (let i = G.texts.length - 1; i >= 0; i--){
    const t = G.texts[i];
    t.life -= dt; t.y -= 44 * dt;
    if (t.life <= 0) G.texts.splice(i, 1);
  }
  for (let i = G.ghosts.length - 1; i >= 0; i--){
    const g = G.ghosts[i];
    g.life -= dt;
    if (g.life <= 0) G.ghosts.splice(i, 1);
  }
  if (G.banner){ G.banner.life -= dt; if (G.banner.life <= 0) G.banner = null; }
  if (RUN && RUN.comboT > 0){ RUN.comboT -= dt; if (RUN.comboT <= 0) RUN.combo = 0; }
}
function updatePlayer(dt){
  const p = G.player, st = RUN.st;
  if (RUN.net && p.down){
    p.reviveT -= dt;
    if (p.reviveT <= 0){ p.down = false; p.hp = Math.round(p.maxHp * 0.5); p.invuln = 2; burst(p.x, p.y, st.color, 20, 260); }
    return;
  }
  const e = nearestEnemy(p.x, p.y, input.wheelAim ? 1600 : 620);
  G.aimTarget = input.wheelAim ? e : null;
  if (input.wheelAim && e) p.aim = angLerp(p.aim, angTo(p.x, p.y, e.x, e.y), 1 - Math.pow(0.00000002, dt));
  else if ((input.touchMode || !input.usedMouse) && e) p.aim = angLerp(p.aim, angTo(p.x, p.y, e.x, e.y), 1 - Math.pow(0.0000002, dt));
  else p.aim = angLerp(p.aim, angTo(p.x, p.y, input.mx + G.cam.x, input.my + G.cam.y), 1 - Math.pow(0.0000002, dt));   // 鼠标是屏幕坐标，要加回摄像机偏移
  const m = moveInput();
  if (p.dashTime > 0){
    p.dashTime -= dt;
    p.vx = Math.cos(p.dashDir) * 880; p.vy = Math.sin(p.dashDir) * 880;
    if (Math.random() < 0.8) G.ghosts.push({ x: p.x, y: p.y, aim: p.aim, life: 0.26, max: 0.26 });
    if (st.dashDamage){
      for (let i = 0; i < G.enemies.length; i++){
        const en = G.enemies[i];
        if (en.dead || en.appear > 0 || p.dashHits.indexOf(en) >= 0) continue;
        if (hypot(en.x - p.x, en.y - p.y) < en.r + p.r + 8){
          p.dashHits.push(en);
          hitEnemy(en, st.dashDamage, { knock: 220 });
          burst(en.x, en.y, st.color, 8, 200);
        }
      }
    }
  } else {
    const k = 1 - Math.pow(0.0008, dt);
    p.vx = lerp(p.vx, m.x * st.speed, k);
    p.vy = lerp(p.vy, m.y * st.speed, k);
  }
  p.x += p.vx * dt; p.y += p.vy * dt;
  resolveCircle(p, p.r);
  p.x = clamp(p.x, G.bounds.l + p.r, G.bounds.r - p.r);
  p.y = clamp(p.y, G.bounds.t + p.r, G.bounds.b - p.r);
  if (p.fireCd > 0) p.fireCd -= dt;
  if (p.reloading > 0){
    p.reloading -= dt;
    if (p.reloading <= 0){ p.reloading = 0; p.mag = p.magSize; Sfx.reloadOut(); }
  }
  if (p.dashCd > 0) p.dashCd -= dt;
  if (p.invuln > 0) p.invuln -= dt;
  if (p.flash > 0) p.flash -= dt;
  if (p.hurt > 0) p.hurt -= dt;
  if (p.swing > 0) p.swing -= dt;
  if (p.pickCd > 0) p.pickCd -= dt;
  else if (RUN.mode === 'br'){
    for (let i = 0; i < G.loot.length; i++){
      const l = G.loot[i];
      if (hypot(l.x - p.x, l.y - p.y) < 30){ pickupLoot(l); break; }
    }
  }
  if ((input.mouseDown || input.touchFire) && G.state === 'playing') fire();
}

/* ================= 波次 / 关卡 ================= */
function endlessList(n, count){
  const unlocked = [];
  for (let i = 0; i < ENDLESS_WAVES.length; i++){
    const e = ENDLESS_WAVES[i];
    if (n >= e.w) for (let k = 0; k < e.list.length; k++) unlocked.push(e.list[k]);
  }
  const out = [];
  const total = Math.min(220, count);
  for (let i = 0; i < total; i++) out.push(unlocked.length ? pick(unlocked) : 'chaser');
  if (n % 5 === 0){
    const bi = Math.min(ENDLESS_BOSSES.length - 1, Math.floor(n / 5) - 1);
    out.push(ENDLESS_BOSSES[Math.max(0, bi)]);
  }
  return out;
}
function addMarker(type){
  const p = G.player, size = ENEMY[type].size;
  let x = 0, y = 0, tries = 0;
  do {
    const side = rndi(0, 3);
    if (side === 0){ x = rnd(G.bounds.l + 20, G.bounds.r - 20); y = G.bounds.t - 26; }
    else if (side === 1){ x = G.bounds.r + 26; y = rnd(G.bounds.t + 20, G.bounds.b - 20); }
    else if (side === 2){ x = rnd(G.bounds.l + 20, G.bounds.r - 20); y = G.bounds.b + 26; }
    else { x = G.bounds.l - 26; y = rnd(G.bounds.t + 20, G.bounds.b - 20); }
    tries++;
  } while (tries < 24 && (!freeSpot(x, y, size * 0.7) || (p && hypot(x - p.x, y - p.y) < 230)));
  G.markers.push({ x, y, t: 0, max: 0.55, type });
}
function startWave(n){
  RUN.wave = n;
  RUN.wavePhase = 'fight';
  let list = [], hpMul = 1, sub = '';
  if (RUN.mode === 'campaign'){
    const def = RUN.level.waves[n - 1];
    if (!def) return;
    for (const pair of def.n) for (let i = 0; i < pair[1]; i++) list.push(pair[0]);
    hpMul = def.hp || 1;
    sub = RUN.level.name + ' · 第 ' + n + '/' + RUN.level.waves.length + ' 波';
  } else {
    const t = RUN.tier;
    const count = t.baseCount + t.countStep * (n - 1);
    hpMul = 1 + t.hpStep * (n - 1);
    list = endlessList(n, count);
    sub = t.name + ' · 敌人 ' + list.length + ' 只';
    if (t.hpStep > 0 && n > 1){
      showInterstitial('敌人血量 +' + Math.round(t.hpStep * 100) + '%',
                       '累计 +' + Math.round((hpMul - 1) * 100) + '%',
                       '本波敌人 ' + list.length + ' 只 · 数量 +' + t.countStep);
    }
  }
  RUN.hpMul = hpMul;
  shuffle(list);
  const interval = clamp(14 / Math.max(1, list.length), 0.11, 0.5);
  RUN.spawnQueue = list.map((k, i) => ({ type: k, delay: 0.4 + i * interval + rnd(0, 0.12) }));
  banner('第 ' + n + ' 波', sub);
  if (!G.inter) Sfx.wave();
}
function updateWave(dt){
  if (RUN.wavePhase === 'gap'){
    RUN.waveTimer -= dt;
    if (RUN.waveTimer <= 0 && RUN.wave < (RUN.mode === 'campaign' ? RUN.level.waves.length : 9999)) startWave(RUN.wave + 1);
    return;
  }
  for (let i = RUN.spawnQueue.length - 1; i >= 0; i--){
    if (G.enemies.length >= MAX_ALIVE) break;
    const q = RUN.spawnQueue[i];
    q.delay -= dt;
    if (q.delay <= 0){ addMarker(q.type); RUN.spawnQueue.splice(i, 1); }
  }
  for (let i = G.markers.length - 1; i >= 0; i--){
    const m = G.markers[i];
    m.t += dt;
    if (m.t >= m.max){
      const e = makeEnemy(m.type, m.x, m.y, { hpMul: RUN.hpMul });
      G.enemies.push(e);
      if (e.boss) G.boss = e;
      G.markers.splice(i, 1);
    }
  }
  if (!RUN.spawnQueue.length && !G.markers.length && !G.enemies.length && RUN.wave > 0){
    const bonus = Math.round((RUN.mode === 'campaign' ? 40 + RUN.wave * 20 : 60 + RUN.wave * 30) * (RUN.scoreMul || 1));
    RUN.score += bonus;
    /* ---- 金币结算 ----
       战役：只有该关卡【首次通关】才发金币（按波给到手），第 2 次起为 0
       难度：每波都发，并乘档位倍率                                     */
    const wc = waveCoinReward({ mode: RUN.mode, levelId: RUN.levelId, wave: RUN.wave, mul: RUN.coinMul, first: RUN.firstClear });
    if (wc > 0){
      if (RUN.net && RUN.net.role === 'host' && EVENTS.onNetEvent) EVENTS.onNetEvent({ k: 'coins', amount: wc });
      RUN.coins += wc; RUN.waveCoins += wc;
      Save.addCoins(wc); updateCoinHud();
      floatText(G.player.x, G.player.y - 48, '+' + wc + ' 金币', '#ffd24a', 17);
    }
    healPlayer(RUN.st.waveHeal, true);
    floatText(G.player.x, G.player.y - 30, '+' + bonus + ' 分', '#9ff4ff', 16);
    const wcTxt = wc > 0 ? '+' + wc + ' 金币 · ' : (RUN.mode === 'campaign' ? '本关已通关·不再发金币 · ' : '');
    banner('第 ' + RUN.wave + ' 波 清除！', '+' + bonus + ' 分 · ' + wcTxt + '恢复 ' + RUN.st.waveHeal + ' HP');
    Sfx.wave();
    if (RUN.mode === 'campaign' && RUN.wave >= RUN.level.waves.length){ winRun(); return; }
    RUN.wavePhase = 'gap'; RUN.waveTimer = 1.5;
  }
}
function updateCam(dt){
  const p = G.player, k = 1 - Math.pow(0.00005, dt);
  const tx = G.world.w > W ? clamp(p.x - W / 2 + p.vx * 0.12, 0, G.world.w - W) : (G.world.w - W) / 2;
  const ty = G.world.h > H ? clamp(p.y - H / 2 + p.vy * 0.12, 0, G.world.h - H) : (G.world.h - H) / 2;
  G.cam.x = lerp(G.cam.x, tx, k); G.cam.y = lerp(G.cam.y, ty, k);
  if (Math.abs(G.cam.x - tx) < 0.4) G.cam.x = tx;
  if (Math.abs(G.cam.y - ty) < 0.4) G.cam.y = ty;
}
function updateGameplay(dt){
  G.time += dt;
  updateCam(dt);
  if (RUN.net && RUN.net.role === 'client'){
    netTick(dt);            // 客户端只上报输入 + 按快照插值，不跑本地权威逻辑
    if (G.player && G.player.down) G.player.reviveT -= dt;
    return;
  }
  if (RUN.net) netTick(dt);
  updatePlayer(dt);
  updateEnemies(dt);
  updateBullets(dt);
  if (RUN.mode === 'br'){
    if (RUN.br && RUN.br.killed >= RUN.br.total && !RUN.done) winBR();
  } else {
    updateWave(dt);
  }
  updatePickups(dt);
}
function winBR(){
  if (RUN.done) return;
  RUN.done = true;
  G.state = 'over';
  const p = G.player;
  const first = Save.brWins(RUN.map.id) === 0;
  const reward = first ? RUN.map.reward : 0;
  if (reward > 0){ Save.addCoins(reward); RUN.coins += reward; updateCoinHud(); }
  Save.addBRWin(RUN.map.id);
  Save.data.best = Math.max(Save.data.best, RUN.score); Save.save();
  if (RUN.net && RUN.net.role === 'host' && EVENTS.onNetEvent) EVENTS.onNetEvent({ k: 'win' });
  Sfx.win();
  for (let i = 0; i < 60; i++){
    const a = rnd(0, TAU), sp = rnd(120, 420);
    addPart(p.x, p.y, Math.cos(a) * sp, Math.sin(a) * sp, rnd(0.6, 1.3), rnd(3, 9), i % 2 ? '#ffd24a' : '#8ff4ff');
  }
  G.shake = 12;
  canvas.style.cursor = '';
  const res = { mode: 'br', win: true, map: RUN.map, kills: RUN.kills, total: RUN.br.total,
                score: RUN.score, coins: RUN.coins, waveCoins: 0, first, reward,
                time: Math.round(G.time), hp: Math.ceil(p.hp), maxHp: p.maxHp };
  setTimeout(() => { if (EVENTS.onWin) EVENTS.onWin(res); }, 800);
}

/* ================= 过渡画面 ================= */
function showInterstitial(title, sub, extra){
  G.inter = { t: 1.7, max: 1.7, title, sub, extra };
  const el = $('inter');
  if (el){
    el.querySelector('.in-title').textContent = title;
    el.querySelector('.in-sub').textContent = sub;
    el.querySelector('.in-extra').textContent = extra || '';
    el.classList.add('on');
  }
}
function hideInterstitial(){
  G.inter = null;
  const el = $('inter');
  if (el) el.classList.remove('on');
}
function updateCoinHud(){
  const n = Save.data.coins;
  const els = document.querySelectorAll('.coin-num');
  for (let i = 0; i < els.length; i++) els[i].textContent = n;
  const h = $('hudCoins');
  if (h) h.textContent = n;
}

/* ================= 开始 / 结束 ================= */
function startRun(cfg){
  RUN = { mode: cfg.mode, level: cfg.level || null, levelId: cfg.level ? cfg.level.id : 0,
          tier: cfg.tier || null, tierId: cfg.tier ? cfg.tier.id : 0,
          st: buildStats(), cheats: cfg.tier ? cfg.tier.cheatKeys.slice() : [],
          coinMul: cfg.tier ? cfg.tier.coinMul : 1, scoreMul: cfg.tier ? cfg.tier.scoreMul : 1,
          firstClear: cfg.mode === 'campaign' ? (Save.levelStars(cfg.level.id) === 0) : true,
          wave: 0, wavePhase: 'gap', waveTimer: 1.1, spawnQueue: [], hpMul: 1,
          kills: 0, score: 0, coins: 0, waveCoins: 0, combo: 0, comboT: 0 };
  /* 关键：每次开新局都要把世界尺寸/边界/摄像机复位，否则大逃杀的大地图会残留到关卡模式 */
  G.world = { w: W, h: H };
  G.bounds = { l: ARENA.l, t: ARENA.t, r: ARENA.r, b: ARENA.b };
  G.cam.x = 0; G.cam.y = 0;
  G.obstacles = makeObstacles(cfg.obstacle || 'none');
  G.player = makePlayer();
  G.enemies.length = 0; G.bullets.length = 0; G.ebullets.length = 0; G.particles.length = 0;
  G.texts.length = 0; G.pickups.length = 0; G.markers.length = 0; G.ghosts.length = 0;
  G.boss = null; G.banner = null; G.shake = 0; G.hitStop = 0; G.time = 0; G.hintT = 0;
  hideInterstitial();
  input.joyX = 0; input.joyY = 0; input.touchFire = false;
  G.state = 'playing';
  canvas.style.cursor = 'none';
  updateCoinHud();
}
function winRun(){
  const p = G.player;
  G.state = 'over';
  const hpPct = p.hp / p.maxHp;
  const sp = RUN.level.starHp, stars = hpPct >= sp[0] ? 3 : hpPct >= sp[1] ? 2 : 1;
  const first = Save.levelStars(RUN.level.id) === 0;
  Save.setLevel(RUN.level.id, stars);
  const reward = 0;   /* 通关不再发放金币：金币只来自每一波结算与击杀掉落 */
  Save.data.best = Math.max(Save.data.best, RUN.score); Save.save();
  updateCoinHud();
  if (RUN.net && RUN.net.role === 'host' && EVENTS.onNetEvent) EVENTS.onNetEvent({ k: 'win' });
  Sfx.win();
  for (let i = 0; i < 40; i++) addPart(p.x, p.y, rnd(-260, 260), rnd(-260, 260), rnd(0.5, 1), rnd(3, 8), i % 2 ? '#ffd24a' : '#8ff4ff');
  const res = { mode: 'campaign', level: RUN.level, stars, first, reward, score: RUN.score, kills: RUN.kills,
                coins: RUN.coins, waveCoins: RUN.waveCoins, wave: RUN.wave, hp: Math.ceil(p.hp), maxHp: p.maxHp };
  setTimeout(() => { if (EVENTS.onWin) EVENTS.onWin(res); }, 700);
}
function loseRun(){
  const p = G.player;
  G.state = 'over';
  p.dead = true;
  burst(p.x, p.y, '#35e0f5', 30, 360);
  burst(p.x, p.y, '#ffffff', 12, 220);
  G.shake = 22; G.hitStop = 0.2;
  input.mouseDown = false; input.touchFire = false;
  Save.data.best = Math.max(Save.data.best, RUN.score);
  if (RUN.mode === 'endless') Save.setEndlessBest(RUN.tierId, RUN.wave);
  Save.data.runs = (Save.data.runs || 0) + 1;
  Save.save();
  updateCoinHud();
  if (RUN.net && RUN.net.role === 'host' && EVENTS.onNetEvent) EVENTS.onNetEvent({ k: 'lose' });
  Sfx.lose();
  canvas.style.cursor = '';
  const res = { mode: RUN.mode, level: RUN.level, tier: RUN.tier, tierId: RUN.tierId, score: RUN.score,
                map: RUN.map || null, total: RUN.br ? RUN.br.total : 0, time: Math.round(G.time),
                kills: RUN.kills, coins: RUN.coins, waveCoins: RUN.waveCoins, wave: RUN.wave, best: RUN.mode === 'endless' ? Save.endlessBest(RUN.tierId) : 0 };
  setTimeout(() => { if (EVENTS.onLose) EVENTS.onLose(res); }, 850);
}
function togglePause(){
  if (G.state === 'playing'){
    G.state = 'paused'; input.mouseDown = false;
    canvas.style.cursor = '';
    if (EVENTS.onPause) EVENTS.onPause(true);
  } else if (G.state === 'paused'){
    G.state = 'playing';
    canvas.style.cursor = 'none';
    last = performance.now();
    if (EVENTS.onPause) EVENTS.onPause(false);
  }
}
function stopRun(){
  G.state = 'idle';
  G.enemies.length = 0; G.bullets.length = 0; G.ebullets.length = 0; G.markers.length = 0;
  G.pickups.length = 0; G.texts.length = 0; G.boss = null; G.banner = null;
  G.player = null; RUN = null; G.inter = null;
  hideInterstitial();
  canvas.style.cursor = '';
}

/* ================= 更新 ================= */
function update(dtReal){
  G.bg += dtReal;
  if (G.state === 'playing'){
    G.shake = Math.max(0, G.shake - dtReal * 34);
    if (G.inter){
      G.inter.t -= dtReal;
      updateParticles(dtReal);
      if (G.inter.t <= 0) hideInterstitial();
      return;
    }
    let dt = dtReal;
    if (G.hitStop > 0){ G.hitStop -= dtReal; dt *= 0.28; }
    updateGameplay(dt);
    updateParticles(dt);
    updateHud();
  } else {
    updateParticles(dtReal);
    G.shake = Math.max(0, G.shake - dtReal * 34);
    if (G.state === 'idle'){
      for (let i = 0; i < G.deco.length; i++){
        const d = G.deco[i];
        d.x += d.vx * dtReal; d.y += d.vy * dtReal; d.a += d.va * dtReal;
        if (d.x < -50) d.x = W + 50; if (d.x > W + 50) d.x = -50;
        if (d.y < -50) d.y = H + 50; if (d.y > H + 50) d.y = -50;
      }
    }
    if (RUN) updateHud();
  }
}

/* ================= 渲染 ================= */
let bgGrad = null, vigGrad = null, glowGrad = null;
function buildDeco(){
  G.deco.length = 0;
  const cols = ['#16304d', '#1d3a5c', '#232a52', '#164a52'];
  for (let i = 0; i < 20; i++){
    G.deco.push({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-18, 18), vy: rnd(-18, 18), a: rnd(0, TAU),
                  va: rnd(-0.7, 0.7), s: rnd(14, 44), al: rnd(0.14, 0.4), c: pick(cols) });
  }
}
function drawBackground(){
  if (!bgGrad){
    bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0b1322'); bgGrad.addColorStop(0.55, '#070a12'); bgGrad.addColorStop(1, '#0a0d1a');
    glowGrad = ctx.createRadialGradient(W/2, H/2, 40, W/2, H/2, H * 0.9);
    glowGrad.addColorStop(0, 'rgba(45,130,200,0.10)'); glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  }
  ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, W, H);
  const p = G.player;
  const cam = G.cam, step = 48;
  ctx.save();
  ctx.strokeStyle = 'rgba(76,150,215,0.10)'; ctx.lineWidth = 1;
  ctx.beginPath();
  const x0 = Math.floor(cam.x / step) * step, x1 = cam.x + W;
  const y0 = Math.floor(cam.y / step) * step, y1 = cam.y + H;
  for (let x = x0; x < x1 + step; x += step){ ctx.moveTo(x, cam.y); ctx.lineTo(x, cam.y + H); }
  for (let y = y0; y < y1 + step; y += step){ ctx.moveTo(cam.x, y); ctx.lineTo(cam.x + W, y); }
  ctx.stroke();
  ctx.restore();
  /* 地图边界 */
  ctx.strokeStyle = 'rgba(90,170,240,0.28)'; ctx.lineWidth = 6;
  ctx.strokeRect(G.bounds.l, G.bounds.t, G.bounds.r - G.bounds.l, G.bounds.b - G.bounds.t);
  ctx.fillStyle = glowGrad; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < G.deco.length; i++){
    const d = G.deco[i];
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a);
    ctx.globalAlpha = d.al; ctx.fillStyle = d.c; ctx.fillRect(-d.s/2, -d.s/2, d.s, d.s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function drawObstacles(){
  for (let i = 0; i < G.obstacles.length; i++){
    const b = G.obstacles[i];
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(b.x + 5, b.y + 8, b.w, b.h);
    ctx.fillStyle = '#2b3a52'; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#3f577a'; ctx.fillRect(b.x, b.y, b.w, 8);
    ctx.fillStyle = '#1b2433'; ctx.fillRect(b.x, b.y + b.h - 8, b.w, 8);
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
    ctx.strokeStyle = 'rgba(130,190,255,0.10)'; ctx.lineWidth = 10;
    ctx.beginPath();
    for (let k = -b.h; k < b.w; k += 26){ ctx.moveTo(b.x + k, b.y + b.h); ctx.lineTo(b.x + k + b.h, b.y); }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(150,205,255,0.38)'; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.fillStyle = 'rgba(190,225,255,0.55)';
    const s = 4;
    ctx.fillRect(b.x + 4, b.y + 4, s, s); ctx.fillRect(b.x + b.w - 8, b.y + 4, s, s);
    ctx.fillRect(b.x + 4, b.y + b.h - 8, s, s); ctx.fillRect(b.x + b.w - 8, b.y + b.h - 8, s, s);
  }
}
function drawMarkers(){
  for (let i = 0; i < G.markers.length; i++){
    const m = G.markers[i], k = clamp(m.t / m.max, 0, 1);
    ctx.save(); ctx.translate(m.x, m.y);
    ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(G.bg * 12));
    ctx.strokeStyle = ENEMY[m.type].color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, ENEMY[m.type].size * (0.55 + k * 0.8), 0, TAU); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function drawPickups(){
  for (let i = 0; i < G.pickups.length; i++){
    const u = G.pickups[i], bob = Math.sin(u.t * 5) * 2.5;
    const blink = u.life < 4 && Math.floor(u.life * 8) % 2 === 0;
    ctx.save(); ctx.translate(u.x, u.y + bob);
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.shadowColor = '#7dffb1'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#0c2a1c'; ctx.fillRect(-u.r, -u.r, u.r * 2, u.r * 2);
    ctx.strokeStyle = '#7dffb1'; ctx.lineWidth = 2.5; ctx.strokeRect(-u.r, -u.r, u.r * 2, u.r * 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7dffb1';
    ctx.fillRect(-8, -2.5, 16, 5); ctx.fillRect(-2.5, -8, 5, 16);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function drawEnemy(e){
  const t = e.t;
  const sc = e.appear > 0 ? 0.35 + 0.65 * (1 - e.appear / 0.45) : 1;
  const s = e.size * sc, h = s / 2;
  const a = angTo(e.x, e.y, G.player.x, G.player.y);
  ctx.save(); ctx.translate(e.x, e.y);
  if (e.appear > 0){
    ctx.globalAlpha = clamp(1 - e.appear / 0.45, 0, 1);
    ctx.strokeStyle = t.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, (1 - e.appear / 0.45) * e.size * 1.15, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (e.berserk){
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(G.bg * 18);
    ctx.fillStyle = '#ff2d4d'; ctx.fillRect(-h - 5, -h - 5, s + 10, s + 10);
    ctx.globalAlpha = 1;
  }
  if (e.type === 'shooter' || e.type === 'sniper' || e.boss){
    ctx.save(); ctx.rotate(a);
    const gl = e.type === 'sniper' ? 20 : 12;
    ctx.fillStyle = e.type === 'sniper' ? '#0d4257' : '#241a3a';
    ctx.fillRect(h * 0.4, -3.5, h + gl, 7);
    ctx.fillStyle = e.type === 'sniper' ? '#7fe6ff' : '#6a4fb5';
    ctx.fillRect(h * 0.4, -3.5, h + 4, 7);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.fillRect(-h + 3, -h + 5, s, s);
  ctx.fillStyle = t.color; ctx.fillRect(-h, -h, s, s);
  if (e.slowT > 0){
    ctx.globalAlpha = 0.4; ctx.fillStyle = '#9fe9ff'; ctx.fillRect(-h, -h, s, s); ctx.globalAlpha = 1;
  }
  ctx.save(); ctx.rotate(e.angle); const iw = s * 0.36;
  ctx.globalAlpha = 0.5; ctx.fillStyle = t.dark; ctx.fillRect(-iw/2, -iw/2, iw, iw); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.20)'; ctx.fillRect(-h, -h, s, Math.max(3, s * 0.13));
  ctx.lineWidth = Math.max(2, s * 0.08); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeRect(-h, -h, s, s);
  if (e.boss){
    ctx.fillStyle = '#ffd24a';
    const cw = s * 0.16;
    ctx.fillRect(-h + s*0.1, -h - cw, cw, cw); ctx.fillRect(-cw/2, -h - cw * 1.4, cw, cw * 1.4); ctx.fillRect(h - s*0.1 - cw, -h - cw, cw, cw);
  }
  const ex = Math.cos(a) * s * 0.10, ey = Math.sin(a) * s * 0.10, es = Math.max(3.5, s * 0.17);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-s*0.21 + ex - es/2, -s*0.07 + ey - es/2, es, es);
  ctx.fillRect( s*0.21 + ex - es/2, -s*0.07 + ey - es/2, es, es);
  ctx.fillStyle = '#0b1119';
  ctx.fillRect(-s*0.21 + ex*1.8 - es*0.22, -s*0.07 + ey*1.8 - es*0.22, es*0.46, es*0.46);
  ctx.fillRect( s*0.21 + ex*1.8 - es*0.22, -s*0.07 + ey*1.8 - es*0.22, es*0.46, es*0.46);
  if (e.windup > 0){
    const k = 1 - e.windup / (e.t.charge || 0.34);
    ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(G.bg * 30));
    ctx.strokeStyle = t.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, h + 5 + k * 10, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (e.shield > 0){
    ctx.save(); ctx.rotate(G.bg * 2);
    ctx.strokeStyle = 'rgba(127,224,255,0.9)'; ctx.lineWidth = 3; ctx.setLineDash([7, 6]);
    ctx.beginPath(); ctx.arc(0, 0, h + 8, 0, TAU); ctx.stroke(); ctx.restore();
  }
  if (e.flash > 0){
    ctx.globalAlpha = clamp(e.flash / 0.1, 0, 1) * 0.85;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-h, -h, s, s);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (e.hp < e.maxHp && e.appear <= 0 && !e.boss){
    const bw = Math.max(26, e.size), bh = 4, k = clamp(e.hp / e.maxHp, 0, 1);
    const bx = e.x - bw/2, by = e.y - e.size/2 - 13;
    ctx.fillStyle = 'rgba(4,8,14,0.8)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = k > 0.5 ? '#5ef08a' : k > 0.25 ? '#ffd24a' : '#ff5470';
    ctx.fillRect(bx, by, bw * k, bh);
  }
}
function drawPlayer(){
  const p = G.player, st = RUN ? RUN.st : null; if (!p || p.dead) return;
  const col = st ? st.color : '#35e0f5', dark = st ? st.dark : '#0a2c3a';
  for (let i = 0; i < G.ghosts.length; i++){
    const g = G.ghosts[i], k = g.life / g.max;
    ctx.save(); ctx.globalAlpha = k * 0.4; ctx.fillStyle = col;
    ctx.fillRect(g.x - 15, g.y - 15, 30, 30); ctx.restore();
  }
  const flick = p.invuln > 0 && Math.floor(G.bg * 22) % 2 === 0;
  ctx.save();
  ctx.globalAlpha = flick ? 0.5 : 1;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(p.x - 12, p.y - 10, 30, 30);
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.aim);
  if (getWeapon(p.weapon).kind === 'melee'){
    const sw = clamp(p.swing / 0.22, 0, 1), ang = -1.1 + (1 - sw) * 2.2;
    ctx.save(); ctx.rotate(ang); ctx.globalAlpha = 0.35 + sw * 0.65;
    ctx.fillStyle = '#e8eef7';
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(32, -5); ctx.lineTo(34, 0); ctx.lineTo(32, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff9f2e'; ctx.fillRect(8, -3, 8, 6);
    ctx.restore();
    ctx.globalAlpha = 0.22 + sw * 0.3;
    ctx.strokeStyle = '#ffd7a0'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 46, -1.2 + (1 - sw) * 2.2, -0.2 + (1 - sw) * 2.2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#20303f'; ctx.fillRect(4, -4.5, p.r + 12, 9);
  ctx.fillStyle = col; ctx.fillRect(6, -3, 9, 6);
  if (p.flash > 0){
    const f = clamp(p.flash / 0.07, 0, 1);
    ctx.fillStyle = '#fff3b0'; ctx.beginPath(); ctx.arc(p.r + 15, 0, 5 + f * 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(p.r + 14, 0, 3 + f * 4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.fillStyle = dark; ctx.fillRect(-17, -17, 34, 34);
  ctx.fillStyle = p.hurt > 0 ? '#ff9db0' : col; ctx.fillRect(-15, -15, 30, 30);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(-15, -15, 30, 7);
  ctx.save(); ctx.rotate(p.aim);
  ctx.fillStyle = dark; ctx.fillRect(2, -7, 7, 4); ctx.fillRect(2, 3, 7, 4);
  ctx.restore();
  ctx.fillStyle = dark; ctx.fillRect(-5, -5, 10, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();
  if (p.rage > 0){
    ctx.globalAlpha = clamp(p.rage / 10, 0.2, 0.7);
    ctx.strokeStyle = '#ff6a3d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 21, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (p.invuln > 0.1){
    ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = '#9ff6ff'; ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]); ctx.lineDashOffset = -G.bg * 40;
    ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, TAU); ctx.stroke(); ctx.restore();
  }
}
function drawRemote(r){
  const s = 30, h = 15;
  ctx.save(); ctx.translate(r.x, r.y);
  ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.fillRect(-h + 3, -h + 5, s, s);
  ctx.fillStyle = '#0d2230'; ctx.fillRect(-h - 2, -h - 2, s + 4, s + 4);
  ctx.fillStyle = r.down ? '#5a6b7d' : (r.hurt > 0 ? '#ff9db0' : (r.color || '#a6ffcf'));
  ctx.fillRect(-h, -h, s, s);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-h, -h, s, 7);
  ctx.save(); ctx.rotate(r.aim || 0);
  ctx.fillStyle = '#20303f'; ctx.fillRect(4, -4.5, 20, 9);
  ctx.restore();
  if (!r.down){
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-h + 4, -h + 8, 5, 5); ctx.fillRect(h - 9, -h + 8, 5, 5);
  }
  ctx.restore();
  if (r.down){
    ctx.save(); ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffd24a';
    ctx.font = '800 12px "Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('复活中 ' + Math.max(0, r.reviveT).toFixed(1) + 's', r.x, r.y - 26); ctx.restore();
  }
  if (r.hp < r.maxHp || r.down){
    const bw = 34, k = clamp(r.hp / r.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(4,8,14,0.8)'; ctx.fillRect(r.x - bw/2 - 1, r.y - 30, bw + 2, 5);
    ctx.fillStyle = k > 0.5 ? '#5ef08a' : k > 0.25 ? '#ffd24a' : '#ff5470';
    ctx.fillRect(r.x - bw/2, r.y - 29, bw * k, 3);
  }
  ctx.save(); ctx.font = '700 12px "Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,8,14,0.85)';
  ctx.strokeText(r.name || '', r.x, r.y + 30); ctx.fillStyle = r.color || '#a6ffcf';
  ctx.fillText(r.name || '', r.x, r.y + 30); ctx.restore();
}
function drawBullets(){
  const st = RUN ? RUN.st : null;
  for (let i = 0; i < G.bullets.length; i++){
    const b = G.bullets[i], a = Math.atan2(b.vy, b.vx);
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
    ctx.shadowColor = b.crit ? '#ffd24a' : (b.color || (st ? st.color : '#8fe6ff'));
    ctx.shadowBlur = 12;
    ctx.fillStyle = b.crit ? '#fff0a8' : '#dff8ff';
    ctx.fillRect(-b.r * 2.6, -b.r * 0.42, b.r * 5.2, b.r * 0.84);
    ctx.restore();
  }
  for (let i = 0; i < G.ebullets.length; i++){
    const b = G.ebullets[i];
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.shadowColor = b.color; ctx.shadowBlur = 12;
    ctx.fillStyle = b.color; ctx.fillRect(-b.r, -b.r, b.r * 2, b.r * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(-b.r * 0.4, -b.r * 0.4, b.r * 0.8, b.r * 0.8);
    ctx.restore();
  }
  ctx.shadowBlur = 0;
}
function drawParticles(){
  for (let i = 0; i < G.particles.length; i++){
    const q = G.particles[i], k = clamp(q.life / q.max, 0, 1);
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
    ctx.globalAlpha = k;
    ctx.fillStyle = q.color;
    const s = q.size * (0.35 + k * 0.65);
    ctx.fillRect(-s/2, -s/2, s, s);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < G.texts.length; i++){
    const t = G.texts[i], k = clamp(t.life / t.max, 0, 1);
    ctx.save(); ctx.globalAlpha = k;
    ctx.font = '800 ' + t.size + 'px "Segoe UI",system-ui,sans-serif';
    ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,8,14,0.85)';
    ctx.strokeText(t.txt, t.x, t.y); ctx.fillStyle = t.color; ctx.fillText(t.txt, t.x, t.y);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function drawBossBar(){
  const b = G.boss;
  if (!b || b.dead || b.hp <= 0) return;
  const w = 520, x = (W - w)/2, y = 58, k = clamp(b.hp / b.maxHp, 0, 1);
  ctx.save();
  ctx.fillStyle = 'rgba(6,10,18,0.82)'; ctx.fillRect(x - 3, y - 3, w + 6, 20);
  ctx.fillStyle = '#3a0a14'; ctx.fillRect(x, y, w, 14);
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, '#ff2d4d'); g.addColorStop(1, '#ff9f2e');
  ctx.fillStyle = g; ctx.fillRect(x, y, w * k, 14);
  ctx.strokeStyle = 'rgba(255,120,150,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(x - 3, y - 3, w + 6, 20);
  ctx.font = '800 13px "Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd8e0'; ctx.fillText('方 块 之 王  ' + Math.ceil(b.hp) + ' / ' + b.maxHp, W/2, y - 8);
  ctx.restore();
}
function drawBanner(){
  if (!G.banner) return;
  const b = G.banner, k = b.life / b.max;
  const alpha = k > 0.75 ? (1 - k) / 0.25 : clamp(k / 0.35, 0, 1);
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.textAlign = 'center';
  const pop = 1 + (1 - clamp(k / 0.9, 0, 1)) * 0.12;
  ctx.translate(W/2, H * 0.30); ctx.scale(pop, pop);
  ctx.font = '900 44px "Segoe UI",system-ui,sans-serif';
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(3,7,14,0.85)';
  ctx.strokeText(b.title, 0, 0);
  ctx.fillStyle = '#eafcff'; ctx.fillText(b.title, 0, 0);
  ctx.font = '700 16px "Segoe UI",system-ui,sans-serif';
  ctx.fillStyle = '#8fd9ff'; ctx.fillText(b.sub, 0, 30);
  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawCrosshair(){
  if (G.state !== 'playing' || input.touchMode) return;
  const p = G.player; if (!p) return;
  const reloading = p.reloading > 0;
  ctx.save();
  ctx.translate(input.mx, input.my);
  ctx.strokeStyle = reloading ? 'rgba(255,180,90,0.9)' : 'rgba(150,240,255,0.95)';
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  const g = 5, l = 8;
  ctx.beginPath();
  ctx.moveTo(0, -g); ctx.lineTo(0, -g - l);
  ctx.moveTo(0, g); ctx.lineTo(0, g + l);
  ctx.moveTo(-g, 0); ctx.lineTo(-g - l, 0);
  ctx.moveTo(g, 0); ctx.lineTo(g + l, 0);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(-1.5, -1.5, 3, 3);
  ctx.restore();
  if (input.wheelAim && G.aimTarget && !G.aimTarget.dead){
    const t = G.aimTarget, sx = t.x - G.cam.x, sy = t.y - G.cam.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,210,74,0.95)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -G.bg * 30;
    ctx.beginPath(); ctx.arc(sx, sy, (t.r || 16) + 10, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(sx, sy, (t.r || 16) + 15, -0.35, 0.35); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, (t.r || 16) + 15, Math.PI - 0.35, Math.PI + 0.35); ctx.stroke();
    ctx.restore();
  }
}
function drawVignette(){
  const p = G.player;
  if (!vigGrad){
    vigGrad = ctx.createRadialGradient(W/2, H/2, H * 0.66, W/2, H/2, H * 1.35);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)'); vigGrad.addColorStop(1, 'rgba(0,0,0,0.38)');
  }
  ctx.fillStyle = vigGrad; ctx.fillRect(0, 0, W, H);
  if (p && G.state === 'playing' && p.hp < p.maxHp * 0.4 && !p.dead){
    const k = (1 - p.hp / (p.maxHp * 0.4)) * (0.26 + 0.15 * Math.sin(G.bg * 6));
    ctx.save(); ctx.globalAlpha = Math.max(0, k); ctx.fillStyle = '#ff2b4d'; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
}
function drawLoot(){
  if (!RUN || RUN.mode !== 'br') return;
  for (let i = 0; i < G.loot.length; i++){
    const l = G.loot[i], w = getWeapon(l.weapon);
    if (!inView(l.x, l.y, 70)) continue;
    const bob = Math.sin(G.bg * 3 + l.t) * 3;
    const near = G.player && hypot(G.player.x - l.x, G.player.y - l.y) < 150;
    ctx.save(); ctx.translate(l.x, l.y + bob);
    ctx.globalAlpha = 0.20 + 0.12 * Math.sin(G.bg * 4 + l.t);
    ctx.fillStyle = w.kind === 'melee' ? '#ff9f2e' : '#ffd24a';
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.rotate(Math.sin(G.bg * 2 + l.t) * 0.22);
    ctx.fillStyle = 'rgba(6,10,18,0.92)'; ctx.fillRect(-13, -13, 26, 26);
    ctx.strokeStyle = w.kind === 'melee' ? '#ff9f2e' : '#ffd24a'; ctx.lineWidth = 2;
    ctx.strokeRect(-13, -13, 26, 26);
    ctx.fillStyle = w.color || '#dff8ff';
    if (w.kind === 'melee'){
      ctx.beginPath(); ctx.moveTo(-7, 7); ctx.lineTo(7, -7); ctx.lineTo(9, -3); ctx.lineTo(-3, 9); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(-9, -2.5, 18, 5); ctx.fillRect(-3, 2, 5, 6);
    }
    ctx.restore();
    if (near){
      ctx.save(); ctx.font = '800 13px "Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,8,14,0.85)';
      ctx.strokeText(w.name, l.x, l.y - 24);
      ctx.fillStyle = w.kind === 'melee' ? '#ff9f2e' : '#ffd24a';
      ctx.fillText(w.name, l.x, l.y - 24); ctx.restore();
    }
  }
}
function drawMinimap(){
  if (!RUN || RUN.mode !== 'br') return;
  const mw = 172, mh = 120, mx = W - mw - 16, my = H - mh - 16;
  const s = Math.min(mw / G.world.w, mh / G.world.h);
  const ox = mx + (mw - G.world.w * s) / 2, oy = my + (mh - G.world.h * s) / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(6,10,18,0.68)'; ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
  ctx.strokeStyle = 'rgba(120,190,250,0.45)'; ctx.lineWidth = 2; ctx.strokeRect(mx - 3, my - 3, mw + 6, mh + 6);
  ctx.fillStyle = 'rgba(38,58,88,0.75)'; ctx.fillRect(ox, oy, G.world.w * s, G.world.h * s);
  ctx.fillStyle = 'rgba(120,175,225,0.5)';
  for (let i = 0; i < G.houses.length; i++){
    const h = G.houses[i];
    ctx.fillRect(ox + h.x * s, oy + h.y * s, Math.max(2, h.w * s), Math.max(2, h.h * s));
  }
  ctx.fillStyle = '#ffd24a';
  for (let i = 0; i < G.loot.length; i++){
    ctx.fillRect(ox + G.loot[i].x * s - 1.5, oy + G.loot[i].y * s - 1.5, 3, 3);
  }
  for (let i = 0; i < G.enemies.length; i++){
    const e = G.enemies[i];
    if (e.dead) continue;
    ctx.fillStyle = e.aggro ? '#ff4d5e' : 'rgba(255,120,140,0.55)';
    const r = e.t.size >= 44 ? 3.2 : 2;
    ctx.fillRect(ox + e.x * s - r, oy + e.y * s - r, r * 2, r * 2);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
  ctx.strokeRect(ox + G.cam.x * s, oy + G.cam.y * s, W * s, H * s);
  const p = G.player;
  ctx.fillStyle = RUN.st.color;
  ctx.fillRect(ox + p.x * s - 2.5, oy + p.y * s - 2.5, 5, 5);
  ctx.restore();
}
function drawCompass(){
  if (!RUN || RUN.mode !== 'br') return;
  const p = G.player;
  let best = null, bd = Infinity;
  for (let i = 0; i < G.enemies.length; i++){
    const e = G.enemies[i];
    if (e.dead) continue;
    const d = hypot(e.x - p.x, e.y - p.y);
    if (d < bd){ bd = d; best = e; }
  }
  if (!best || inView(best.x, best.y, -40)) return;
  const a = angTo(p.x, p.y, best.x, best.y);
  const x = W / 2 + Math.cos(a) * Math.min(W, H) * 0.33, y = H / 2 + Math.sin(a) * Math.min(W, H) * 0.33;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
  ctx.globalAlpha = 0.85; ctx.fillStyle = '#ff5a72';
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(9, 9); ctx.lineTo(-9, 9); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.85; ctx.fillStyle = '#ffb3c0';
  ctx.font = '800 12px "Segoe UI",system-ui,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(Math.round(bd / 10) + 'm', x, y + 25);
  ctx.restore();
}function render(){
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  ctx.save();
  ctx.translate(-Math.round(G.cam.x), -Math.round(G.cam.y));   // 世界坐标
  if (G.shake > 0.4) ctx.translate(rnd(-1, 1) * G.shake, rnd(-1, 1) * G.shake);
  drawObstacles();
  drawLoot();
  drawMarkers();
  drawPickups();
  if (G.state !== 'idle'){
    for (let i = 0; i < G.enemies.length; i++){
      const e = G.enemies[i];
      if (!e.dead && inView(e.x, e.y, e.size + 40)) drawEnemy(e);
    }
    drawPlayer();
    for (let i = 0; i < G.remotes.length; i++) drawRemote(G.remotes[i]);
    drawBullets();
  }
  drawParticles();
  ctx.restore();
  drawBossBar();
  drawMinimap();
  drawVignette();
  drawBanner();
  drawCrosshair();
  drawCompass();
}
function inView(x, y, pad){
  const c = G.cam, m = pad || 40;
  return x > c.x - m && x < c.x + W + m && y > c.y - m && y < c.y + H + m;
}

/* ================= HUD ================= */
const HUD = {};
function hudInit(){
  HUD.hpFill = $('hpFill'); HUD.hpTxt = $('hpTxt'); HUD.dashFill = $('dashFill'); HUD.dashTxt = $('dashTxt');
  HUD.score = $('scoreTxt'); HUD.kill = $('killTxt'); HUD.mode = $('hudMode'); HUD.combo = $('combo');
  HUD.ammo = $('ammoTxt'); HUD.pipsBox = $('ammoPips'); HUD.reloadWrap = $('reloadWrap'); HUD.reloadFill = $('reloadFill');
  HUD.hint = $('hint'); HUD.hud = $('hud'); HUD.coins = $('hudCoins');
  HUD.weapon = $('hudWeapon'); HUD.brLeft = $('brLeft'); HUD.brChip = $('brChip');
  HUD.pips = [];
  if (HUD.pipsBox){
    HUD.pipsBox.innerHTML = '';
    for (let i = 0; i < 24; i++){
      const s = document.createElement('i');
      HUD.pipsBox.appendChild(s);
      HUD.pips.push(s);
    }
  }
}
function updateHud(){
  const p = G.player;
  if (!p || !HUD.hpFill) return;
  const hp = clamp(p.hp / p.maxHp, 0, 1);
  HUD.hpFill.style.width = (hp * 100) + '%';
  const cls = hp < 0.3 ? 'low' : hp < 0.6 ? 'mid' : '';
  if (HUD.hpFill.className !== cls) HUD.hpFill.className = cls;
  HUD.hpTxt.textContent = Math.max(0, Math.ceil(p.hp)) + '';
  const dk = clamp(1 - p.dashCd / (RUN.st.dashCd || 1), 0, 1);
  HUD.dashFill.style.width = (dk * 100) + '%';
  HUD.dashTxt.textContent = p.dashCd > 0 ? p.dashCd.toFixed(1) + 's' : '就绪';
  HUD.score.textContent = RUN.score + '';
  HUD.kill.textContent = RUN.kills + '';
  if (RUN.mode === 'br'){
    HUD.mode.textContent = RUN.map.name + ' · 剩余敌人 ' + (RUN.br ? Math.max(0, RUN.br.total - RUN.br.killed) : 0);
  } else if (RUN.mode === 'campaign'){
    HUD.mode.textContent = RUN.level.name + ' · 第 ' + Math.max(1, RUN.wave) + '/' + RUN.level.waves.length + ' 波';
  } else {
    HUD.mode.textContent = RUN.tier.name.split(' · ')[0] + ' · 第 ' + Math.max(1, RUN.wave) + ' 波';
  }
  const showCombo = RUN.combo >= 2 && RUN.comboT > 0;
  HUD.combo.style.opacity = showCombo ? '1' : '0';
  if (showCombo) HUD.combo.textContent = '连击 ' + RUN.combo + '  ×' + comboMult().toFixed(1);
  const w = getWeapon(p.weapon);
  const melee = w.kind === 'melee';
  for (let i = 0; i < HUD.pips.length; i++){
    const on = (!melee && i < p.mag) ? 'on' : '';
    if (HUD.pips[i].className !== on) HUD.pips[i].className = on;
  }
  if (HUD.pipsBox) HUD.pipsBox.style.display = melee ? 'none' : 'flex';
  HUD.ammo.textContent = melee ? '近战 · 无限' : (p.reloading > 0 ? '换弹中…' : p.mag + ' / ' + p.magSize);
  if (HUD.weapon) HUD.weapon.textContent = w.name;
  if (HUD.brChip && HUD.brChip.style.display !== (RUN.mode === 'br' ? '' : 'none')) HUD.brChip.style.display = RUN.mode === 'br' ? '' : 'none';
  if (HUD.brLeft && RUN.mode === 'br' && RUN.br) HUD.brLeft.textContent = Math.max(0, RUN.br.total - RUN.br.killed) + '';
  const rl = p.reloading > 0;
  if (HUD.reloadWrap.classList.contains('on') !== rl) HUD.reloadWrap.classList.toggle('on', rl);
  HUD.reloadFill.style.width = (rl ? clamp(1 - p.reloading / p.reloadTime, 0, 1) * 100 : 0) + '%';
  if (HUD.hint){
    if (G.hintT > 9 && HUD.hint.style.opacity !== '0') HUD.hint.style.opacity = '0';
  }
}

/* ================= 触屏 ================= */
function bindTouch(){
  const joy = $('joy'), knob = $('knob');
  if (!joy) return;
  let joyId = null;
  function move(e){
    const r = joy.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width/2)) / (r.width/2);
    let dy = (e.clientY - (r.top + r.height/2)) / (r.height/2);
    const m = hypot(dx, dy); if (m > 1){ dx /= m; dy /= m; }
    input.joyX = dx; input.joyY = dy; input.touchMode = true;
    knob.style.transform = 'translate(-50%,-50%) translate(' + (dx * 34) + 'px,' + (dy * 34) + 'px)';
  }
  function end(){ joyId = null; input.joyX = 0; input.joyY = 0; knob.style.transform = 'translate(-50%,-50%)'; }
  joy.addEventListener('pointerdown', e => { joyId = e.pointerId; try{ joy.setPointerCapture(e.pointerId); }catch(err){} move(e); e.preventDefault(); });
  joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) move(e); });
  joy.addEventListener('pointerup', e => { if (e.pointerId === joyId) end(); });
  joy.addEventListener('pointercancel', end);
  function hold(node, set, tap){
    if (!node) return;
    const on = e => { set(true); input.touchMode = true; node.classList.add('on'); Sfx.unlock(); if (tap) tap(); e.preventDefault(); };
    const off = () => { set(false); node.classList.remove('on'); };
    node.addEventListener('pointerdown', on);
    node.addEventListener('pointerup', off);
    node.addEventListener('pointercancel', off);
    node.addEventListener('pointerleave', off);
  }
  hold($('btnFire'), v => { input.touchFire = v; });
  hold($('btnDash'), () => {}, () => tryDash());
  hold($('btnReload'), () => {}, () => tryReload());
  touchCapable = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}
function showTouch(on){
  const t = $('touch');
  if (t) t.classList.toggle('on', !!on && touchCapable);
}

/* ================= 主循环 ================= */
let last = performance.now();
function loop(now){
  let dt = (now - last) / 1000; last = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  if (dt > 0.05) dt = 0.05;
  update(dt);
  if (G.state === 'playing') G.hintT += dt;
  render();
  requestAnimationFrame(loop);
}

/* ================= 大逃杀模式 ================= */
function addWallH(x, y, w, h, gap){
  if (!gap){ G.obstacles.push({ x, y, w, h, wall: true }); return; }
  const a = clamp(gap[0] - x, 0, w), b = clamp(gap[1] - x, 0, w);
  if (a > 2) G.obstacles.push({ x, y, w: a, h, wall: true });
  if (w - b > 2) G.obstacles.push({ x: x + b, y, w: w - b, h, wall: true });
}
function addWallV(x, y, w, h, gap){
  if (!gap){ G.obstacles.push({ x, y, w, h, wall: true }); return; }
  const a = clamp(gap[0] - y, 0, h), b = clamp(gap[1] - y, 0, h);
  if (a > 2) G.obstacles.push({ x, y, w, h: a, wall: true });
  if (h - b > 2) G.obstacles.push({ x, y: y + b, w, h: h - b, wall: true });
}
function buildBRMap(map){
  G.obstacles.length = 0; G.loot.length = 0; G.houses = [];
  const wall = 18;
  let guard = 0;
  while (G.houses.length < map.houses && guard++ < 600){
    const hw = rnd(190, 310), hh = rnd(150, 250);
    const x = rnd(90, map.w - hw - 90), y = rnd(90, map.h - hh - 90);
    let ok = true;
    for (const o of G.houses){
      if (x < o.x + o.w + 150 && x + hw + 150 > o.x && y < o.y + o.h + 150 && y + hh + 150 > o.y) ok = false;
    }
    if (ok) G.houses.push({ x, y, w: hw, h: hh });
  }
  for (const h of G.houses){
    const door = rndi(0, 3), gap = 78, gp = rnd(0.3, 0.7);
    const gx = h.x + h.w * gp, gy = h.y + h.h * gp;
    addWallH(h.x, h.y, h.w, wall, door === 0 ? [gx, gx + gap] : null);
    addWallH(h.x, h.y + h.h - wall, h.w, wall, door === 2 ? [gx, gx + gap] : null);
    addWallV(h.x, h.y, wall, h.h, door === 3 ? [gy, gy + gap] : null);
    addWallV(h.x + h.w - wall, h.y, wall, h.h, door === 1 ? [gy, gy + gap] : null);
    // 屋里屋外的战利品
    const n = rndi(1, 3);
    for (let i = 0; i < n; i++){
      G.loot.push({ x: h.x + wall + rnd(20, h.w - wall * 2 - 20), y: h.y + wall + rnd(20, h.h - wall * 2 - 20),
                    weapon: randomWeapon(), rot: rnd(0, TAU), t: rnd(0, 6) });
    }
    if (Math.random() < 0.6) G.loot.push({ x: h.x + rnd(-70, h.w + 70), y: h.y + rnd(-70, h.h + 70), weapon: randomWeapon(), rot: rnd(0, TAU), t: rnd(0, 6) });
  }
  // 零散石头掩体
  for (let i = 0; i < Math.round(map.w * map.h / 90000); i++){
    const w = rnd(50, 120), h = rnd(50, 120);
    const x = rnd(70, map.w - w - 70), y = rnd(70, map.h - h - 70);
    let ok = true;
    for (const o of G.obstacles) if (x < o.x + o.w + 70 && x + w + 70 > o.x && y < o.y + o.h + 70 && y + h + 70 > o.y) ok = false;
    for (const o of G.houses) if (x < o.x + o.w + 90 && x + w + 90 > o.x && y < o.y + o.h + 90 && y + h + 90 > o.y) ok = false;
    if (ok) G.obstacles.push({ x, y, w, h, rock: true });
  }
}
function brEnemyType(map){
  const pool = (BR_POOLS && BR_POOLS[(map && map.id) || 1]) || BR_POOLS[1];
  let sum = 0; for (const q of pool) sum += q[1];
  let r = Math.random() * sum;
  for (const q of pool){ r -= q[1]; if (r <= 0) return q[0]; }
  return 'chaser';
}
function spawnBREnemies(map, px, py){
  const cols = Math.max(2, Math.round(Math.sqrt(map.enemies * map.w / map.h)));
  const rows = Math.max(2, Math.ceil(map.enemies / cols));
  let made = 0, guard = 0, cell = 0;
  while (made < map.enemies && guard++ < map.enemies * 80){
    const ci = cell % cols, ri = Math.floor(cell / cols) % rows;
    cell++;
    const cx = (ci + 0.5) * (map.w / cols), cy = (ri + 0.5) * (map.h / rows);
    const x = clamp(cx + rnd(-1, 1) * (map.w / cols) * 0.42, 70, map.w - 70);
    const y = clamp(cy + rnd(-1, 1) * (map.h / rows) * 0.42, 70, map.h - 70);
    if (!freeSpot(x, y, 46)) continue;
    if (hypot(x - px, y - py) < 620) continue;
    let tooClose = false;
    for (let k = 0; k < G.enemies.length; k++){
      const o = G.enemies[k];
      if (hypot(o.x - x, o.y - y) < 92){ tooClose = true; break; }
    }
    if (tooClose) continue;      // 出生点附近不要有敌人
    const e = makeEnemy(brEnemyType(map), x, y, { hpMul: 1 });
    e.home = { x, y }; e.aggro = false; e.wanderT = rnd(0.5, 3); e.bored = 0;
    G.enemies.push(e);
    made++;
  }
  return made;
}
function startBR(mapId){
  const map = getBRMap(mapId);
  const st = buildStats();
  RUN = { mode: 'br', map, level: null, levelId: 0, tier: null, tierId: 0, st,
          cheats: [], coinMul: 1, scoreMul: 1, firstClear: false,
          wave: 1, wavePhase: 'fight', waveTimer: 0, spawnQueue: [], hpMul: 1,
          kills: 0, score: 0, coins: 0, waveCoins: 0, combo: 0, comboT: 0,
          br: { total: 0, killed: 0 } };
  G.world = { w: map.w, h: map.h };
  G.bounds = { l: 30, t: 30, r: map.w - 30, b: map.h - 30 };
  G.cam.x = 0; G.cam.y = 0;
  buildBRMap(map);
  // 找一块空地放玩家
  let px = map.w / 2, py = map.h / 2, tries = 0;
  do { px = rnd(120, map.w - 120); py = rnd(120, map.h - 120); tries++; } while (tries < 200 && !freeSpot(px, py, 60));
  G.player = makePlayer();
  G.player.x = px; G.player.y = py;
  G.enemies.length = 0; G.bullets.length = 0; G.ebullets.length = 0; G.particles.length = 0;
  G.texts.length = 0; G.pickups.length = 0; G.markers.length = 0; G.ghosts.length = 0;
  G.boss = null; G.banner = null; G.shake = 0; G.hitStop = 0; G.time = 0; G.hintT = 0;
  const n = spawnBREnemies(map, px, py);
  RUN.br.total = n;
  hideInterstitial();
  input.joyX = 0; input.joyY = 0; input.touchFire = false;
  G.state = 'playing';
  canvas.style.cursor = 'none';
  updateCoinHud();
  banner('空降完成', map.name + ' · 击杀全部 ' + n + ' 名敌人即可获胜');
  Sfx.wave();
  return true;
}
/* ================= 联机合作（主机权威 + 快照同步） ================= */
function targets(){ return (RUN && RUN.net && G.remotes && G.remotes.length) ? [G.player].concat(G.remotes) : [G.player]; }
function nearestTarget(x, y){
  const list = targets();
  let best = G.player, bd = Infinity;
  for (let i = 0; i < list.length; i++){
    const t = list[i];
    if (!t || t.down) continue;
    const d = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);
    if (d < bd){ bd = d; best = t; }
  }
  return best;
}
function damageTarget(t, dmg){
  if (!t || t.down || t.invuln > 0 || G.state !== 'playing') return;
  if (t === G.player) return damagePlayer(dmg);
  t.hp -= dmg; t.invuln = 0.6; t.hurt = 0.3;
  burst(t.x, t.y, '#ff5a72', 8, 180);
  if (t.hp <= 0) downRemote(t);
}
function downRemote(t){
  t.down = true; t.hp = 0; t.reviveT = 6; t.vx = 0; t.vy = 0;
  burst(t.x, t.y, t.color || '#a6ffcf', 18, 260);
  if (EVENTS.onNetEvent) EVENTS.onNetEvent({ k: 'down', name: t.name });
}
function addRemote(id, name, color){
  const st = RUN.st;
  const r = { id, name: name || ('玩家' + id), x: G.player.x + rnd(-50, 50), y: G.player.y + rnd(-50, 50),
              vx: 0, vy: 0, r: 15, hp: st.maxHp, maxHp: st.maxHp, aim: rnd(0, TAU), weapon: 'pistol',
              fireCd: 0, reloading: 0, reloadTime: st.reload, magSize: st.mag, mag: st.mag,
              dashCd: 0, dashTime: 0, invuln: 1.2, flash: 0, hurt: 0, down: false, reviveT: 0,
              kills: 0, score: 0, color: color || '#a6ffcf', isRemote: true,
              in: { mx: 0, my: 0, aim: 0, fire: false, dash: false, reload: false, seq: 0 } };
  G.remotes.push(r);
  return r;
}
function updateRemotes(dt){
  const st = RUN.st;
  for (let i = 0; i < G.remotes.length; i++){
    const r = G.remotes[i];
    if (r.invuln > 0) r.invuln -= dt;
    if (r.hurt > 0) r.hurt -= dt;
    if (r.flash > 0) r.flash -= dt;
    if (r.down){
      r.reviveT -= dt;
      if (r.reviveT <= 0){ r.down = false; r.hp = Math.round(r.maxHp * 0.5); r.invuln = 1.5; burst(r.x, r.y, r.color, 16, 220); }
      continue;
    }
    const k = 1 - Math.pow(0.0008, dt);
    r.vx = lerp(r.vx, (r.in.mx || 0) * st.speed, k);
    r.vy = lerp(r.vy, (r.in.my || 0) * st.speed, k);
    r.x += r.vx * dt; r.y += r.vy * dt;
    resolveCircle(r, r.r);
    r.x = clamp(r.x, G.bounds.l + r.r, G.bounds.r - r.r);
    r.y = clamp(r.y, G.bounds.t + r.r, G.bounds.b - r.r);
    r.aim = r.in.aim || 0;
    if (r.fireCd > 0) r.fireCd -= dt;
    if (r.reloading > 0){ r.reloading -= dt; if (r.reloading <= 0){ r.reloading = 0; r.mag = r.magSize; } }
    if (r.in.reload && r.reloading <= 0 && r.mag < r.magSize){ r.reloading = r.reloadTime; }
    if (r.in.fire && r.fireCd <= 0 && r.reloading <= 0 && r.mag > 0){    // 远程玩家开火
      r.mag--; r.fireCd = st.fireRate; r.flash = 0.07;
      const crit = Math.random() < st.critChance;
      const a = r.aim + rnd(-0.045, 0.045);
      G.bullets.push({ x: r.x + Math.cos(r.aim) * 22, y: r.y + Math.sin(r.aim) * 22,
                       vx: Math.cos(a) * 1000, vy: Math.sin(a) * 1000, r: 4.5, dmg: Math.round(st.damage * (crit ? st.critMul : 1)),
                       crit, color: r.color, pierce: 0, life: 1.2, hit: [], frost: st.frost, boom: false });
      if (r.mag === 0) r.reloading = r.reloadTime;
    }
  }
}
function buildSnapshot(){
  const list = targets();
  const ids = RUN.net.ids;
  const out = { k: 'snap', t: +(G.time).toFixed(1),
    p: list.map(t => [ids.indexOf(t === G.player ? RUN.net.myId : t.id), Math.round(t.x), Math.round(t.y),
                      +t.aim.toFixed(2), Math.round(t.hp), t.down ? 1 : 0, t.kills || 0, t.score || 0, Math.round(t.maxHp)]),
    e: [], b: [], eb: [], pk: [],
    w: [RUN.wave, RUN.wavePhase === 'gap' ? 1 : 0, RUN.mode === 'campaign' ? 0 : 1, RUN.level ? RUN.level.id : 0, RUN.tier ? RUN.tier.id : 0],
    s: [RUN.score, RUN.kills, Math.round(G.player.hp), Math.round(G.player.maxHp), RUN.coins]
  };
  for (let i = 0; i < G.enemies.length; i++){
    const e = G.enemies[i];
    if (e.dead) continue;
    out.e.push([SNAP_TYPES.indexOf(e.type), Math.round(e.x), Math.round(e.y), Math.round(e.hp), Math.round(e.maxHp),
                e.appear > 0 ? 1 : 0, e.aggro ? 1 : 0, e.flash > 0 ? 1 : 0, Math.round(e.size)]);
  }
  for (let i = 0; i < G.bullets.length; i++){
    const b = G.bullets[i];
    out.b.push([Math.round(b.x), Math.round(b.y), Math.round(b.vx / 10), Math.round(b.vy / 10), b.crit ? 1 : 0]);
  }
  for (let i = 0; i < G.ebullets.length; i++){
    const b = G.ebullets[i];
    out.eb.push([Math.round(b.x), Math.round(b.y), b.color]);
  }
  for (let i = 0; i < G.pickups.length; i++){
    const u = G.pickups[i];
    out.pk.push([Math.round(u.x), Math.round(u.y)]);
  }
  return out;
}
function applySnapshot(s){
  const ids = RUN.net.ids;
  RUN.net.snap = s;
  RUN.wave = s.w[0]; RUN.wavePhase = s.w[1] ? 'gap' : 'fight';
  RUN.score = s.s[0]; RUN.kills = s.s[1];
  RUN.coins = (s.s[4] !== undefined) ? s.s[4] : RUN.coins;   // s = [score,kills,hp,maxHp,coins]
  RUN.hpSync = s.s[2];
  G.enemies.length = 0;
  for (let i = 0; i < s.e.length; i++){
    const d = s.e[i], key = SNAP_TYPES[d[0]] || 'chaser';
    const e = makeEnemy(key, d[1], d[2], { hpMul: 1 });
    e.hp = d[3]; e.maxHp = d[4]; e.appear = d[5] ? 0.2 : 0; e.aggro = !!d[6]; e.flash = d[7] ? 0.08 : 0;
    e.isGhost = true;
    G.enemies.push(e);
  }
  G.bullets.length = 0;
  for (let i = 0; i < s.b.length; i++){
    const d = s.b[i];
    G.bullets.push({ x: d[0], y: d[1], vx: d[2] * 10, vy: d[3] * 10, r: 4.5, dmg: 0, crit: !!d[4], life: 1, hit: [], ghost: true });
  }
  G.ebullets.length = 0;
  for (let i = 0; i < s.eb.length; i++){
    const d = s.eb[i];
    G.ebullets.push({ x: d[0], y: d[1], vx: 0, vy: 0, r: 5.5, dmg: 0, life: 1, color: d[2], ghost: true });
  }
  G.pickups.length = 0;
  for (let i = 0; i < s.pk.length; i++) G.pickups.push({ x: s.pk[i][0], y: s.pk[i][1], r: 13, t: 0, life: 1 });
  for (let i = 0; i < s.p.length; i++){
    const d = s.p[i], id = ids[d[0]];
    const tgt = (id === RUN.net.myId) ? G.player : (G.remotes.filter(x => x.id === id)[0] || addRemote(id, RUN.net.names[id], RUN.net.colors[id]));
    tgt.tx = d[1]; tgt.ty = d[2]; tgt.aim = d[3]; tgt.hp = d[4]; tgt.maxHp = d[8];
    tgt.down = !!d[5]; tgt.kills = d[6]; tgt.score = d[7];
    if (tgt.tx === undefined){ tgt.x = d[1]; tgt.y = d[2]; }
  }
}
function netTick(dt){
  if (!RUN || !RUN.net) return;
  const net = RUN.net;
  if (net.role === 'host'){
    updateRemotes(dt);
    net.snapT -= dt;
    if (net.snapT <= 0){ net.snapT = 0.1; if (EVENTS.onSnapshot) EVENTS.onSnapshot(buildSnapshot()); }
  } else {
    net.inT -= dt;
    if (net.inT <= 0 && typeof Net !== 'undefined' && Net.send){
      net.inT = 0.05;
      const m = moveInput();
      Net.send({ k: 'in', mx: +m.x.toFixed(2), my: +m.y.toFixed(2), aim: +G.player.aim.toFixed(2),
                 fire: !!(input.mouseDown || input.touchFire), dash: false, reload: false });
    }
    const s = net.snap;
    if (s){
      const k = 1 - Math.pow(0.00002, dt);
      for (let i = 0; i < G.remotes.length; i++){
        const r = G.remotes[i];
        if (r.tx !== undefined){ r.x = lerp(r.x, r.tx, k); r.y = lerp(r.y, r.ty, k); }
      }
      if (G.player.tx !== undefined){
        G.player.x = lerp(G.player.x, G.player.tx, k); G.player.y = lerp(G.player.y, G.player.ty, k);
        if (Math.abs(G.player.x - G.player.tx) > 90 || Math.abs(G.player.y - G.player.ty) > 90){ G.player.x = G.player.tx; G.player.y = G.player.ty; }
      }
    }
  }
}
function startCoop(opt){
  const cfg = (opt && opt.config) || {}, net = (opt && opt.net) || {};
  const role = (opt && opt.role === 'client') ? 'client' : 'host';
  let lv = null, tier = null;
  if (cfg.mode === 'endless'){
    tier = DIFFICULTIES.filter(d => d.id === (+cfg.tier || 1))[0] || DIFFICULTIES[0];
    startRun({ mode: 'endless', tier: tier, obstacle: 'random' });
  } else {
    lv = LEVELS.filter(l => l.id === (+cfg.level || 1))[0] || LEVELS[0];
    startRun({ mode: 'campaign', level: lv, obstacle: lv.obs });
  }
  const players = net.players || [];
  RUN.net = { role: role, code: net.code || '', myId: net.myId || 'me',
              ids: [net.myId || 'me'].concat(players.filter(p => p.id !== (net.myId || 'me')).map(p => p.id)),
              names: {}, colors: {}, snapT: 0, inT: 0, snap: null, cfg: cfg };
  for (let i = 0; i < players.length; i++){ RUN.net.names[players[i].id] = players[i].name; RUN.net.colors[players[i].id] = players[i].color || '#a6ffcf'; }
  RUN.net.names[net.myId || 'me'] = '我';
  G.remotes = [];
  if (role === 'host'){
    for (let i = 0; i < RUN.net.ids.length; i++){
      const id = RUN.net.ids[i];
      if (id !== RUN.net.myId) addRemote(id, RUN.net.names[id], RUN.net.colors[id]);
    }
  } else {
    addRemote(RUN.net.myId, '我');   // 占位：自己由快照驱动
    G.remotes.length = 0;
  }
  if (role === 'host' && typeof Net !== 'undefined' && Net.send){
    Net.send({ k: 'setup', obs: G.obstacles.slice(), world: { w: G.world.w, h: G.world.h }, bounds: G.bounds });
  }
  alertBar(role === 'host' ? ('房间 ' + RUN.net.code + ' · 你是房主') : ('房间 ' + RUN.net.code + ' · 已连接'));
  return true;
}
function alertBar(txt){ banner('联机合作', txt); }
/* ---------- Net 事件接线（兼容数组/单函数两种订阅模型） ---------- */
function netOn(name, fn){
  if (typeof Net === 'undefined' || !Net.on) return;
  const slot = Net.on[name];
  if (Array.isArray(slot)) slot.push(fn);
  else if (typeof slot === 'function'){ Net.on[name] = function(a, b){ slot(a, b); fn(a, b); }; }
  else Net.on[name] = fn;
}
function netBind(){
  if (typeof Net === 'undefined' || !Net.on) return;
  EVENTS.onSnapshot = function(snap){ if (Net.send) Net.send(snap); };
  EVENTS.onNetEvent = function(ev){ if (Net.send) Net.send({ k: 'ev', e: ev }); };
  netOn('relay', function(from, data){
    if (!RUN || !RUN.net || !data) return;
    if (data.k === 'in' && RUN.net.role === 'host'){
      for (let i = 0; i < G.remotes.length; i++){
        if (G.remotes[i].id === from){ G.remotes[i].in = { mx: data.mx, my: data.my, aim: data.aim, fire: data.fire }; break; }
      }
    } else if (RUN.net.role === 'client'){
      if (data.k === 'snap') applySnapshot(data);
      else if (data.k === 'setup'){
        if (data.obs) G.obstacles = data.obs.slice();
        if (data.world) G.world = data.world;
        if (data.bounds) G.bounds = data.bounds;
      } else if (data.k === 'ev'){
        const e = data.e || {};
        if (e.k === 'coins' && e.amount){
          Save.addCoins(e.amount); RUN.coins += e.amount; RUN.waveCoins += e.amount; updateCoinHud();
          floatText(G.player.x, G.player.y - 44, '+' + e.amount + ' 金币', '#ffd24a', 16);
        } else if (e.k === 'win'){ if (!RUN.done) winRun(); }
        else if (e.k === 'lose'){ if (!RUN.done) loseRun(); }
        else if (e.k === 'down' && e.name){ toast(e.name + ' 被击倒，6 秒后复活'); }
      }
    }
  });
}
/* ================= 对外接口 ================= */
return {
  events: EVENTS,
  init(){
    fitStage(); hudInit(); buildDeco(); bindTouch(); netBind();
    G.obstacles = [];
    updateCoinHud();
    $('inter'); 
    last = performance.now();
    requestAnimationFrame(loop);
  },
  startCampaign(levelId){
    const lv = LEVELS.filter(l => l.id === levelId)[0];
    if (!lv) return false;
    startRun({ mode: 'campaign', level: lv, obstacle: lv.obs });
    return true;
  },
  startEndless(tierId){
    const t = DIFFICULTIES.filter(d => d.id === tierId)[0];
    if (!t) return false;
    startRun({ mode: 'endless', tier: t, obstacle: 'random' });
    return true;
  },
  startBR(mapId){ return startBR(+mapId || 1); },
  startCoop(opt){ return startCoop(opt); },
  netRole(){ return RUN && RUN.net ? RUN.net.role : null; },
  remotes(){ return G.remotes; },
  pause(){ togglePause(); },
  resume(){ togglePause(); },
  stop(){ stopRun(); },
  showTouch: showTouch,
  state(){ return G.state; },
  dexCoverage(){
    const cover = {};
    for (let i = 0; i < LEVELS.length; i++){
      const lv = LEVELS[i];
      for (let w = 0; w < lv.waves.length; w++)
        for (let p = 0; p < lv.waves[w].n.length; p++) if (!cover[lv.waves[w].n[p][0]]) cover[lv.waves[w].n[p][0]] = '战役·' + lv.name;
    }
    for (let i = 0; i < ENDLESS_WAVES.length; i++){
      const e = ENDLESS_WAVES[i];
      for (let k = 0; k < e.list.length; k++) if (!cover[e.list[k]]) cover[e.list[k]] = '难度·第' + e.w + '波起';
    }
    for (let i = 0; i < ENDLESS_BOSSES.length; i++) if (!cover[ENDLESS_BOSSES[i]]) cover[ENDLESS_BOSSES[i]] = '难度·BOSS波';
    for (const id in BR_POOLS){
      const pool = BR_POOLS[id];
      for (let i = 0; i < pool.length; i++) if (!cover[pool[i][0]]) cover[pool[i][0]] = '大逃杀·地图' + id;
    }
    const missing = [];
    for (const k in ENEMY) if (!cover[k]) missing.push(k);
    return { cover, missing, total: Object.keys(ENEMY).length };
  },
  run(){ return RUN; },
  updateCoinHud: updateCoinHud,
  sfx: Sfx,
  _dbg: { G: () => G, run: () => RUN, loot: () => G.loot, hurt: n => damagePlayer(n), spawn: (t, x, y, o) => spawnAt(t, x, y, o),
          enemies: () => G.enemies, addEnemyToWave: () => {}, explode: explode, kill: e => killEnemy(e, {}) }
};
})();
