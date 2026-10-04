/* ============================================================
   方块枪神 2D · 界面层（页面路由 / 商店 / 关卡 / 难度 / 结算）
   ============================================================ */
const UI = (function(){
'use strict';

const $ = id => document.getElementById(id);
const SCREENS = ['menu', 'levels', 'diff', 'br', 'shop', 'book', 'pack', 'net', 'pause', 'result'];
const LV_COLORS = ['#3ee06b','#35e0f5','#b06cff','#ffb03a','#ff8a3d','#4ad4ff','#ff6ad5','#ff3355'];
let cur = null, shopTab = 'gear', selectedBookFilter = 'all', selTier = 1, selectedMap = 1, autoTimer = null, autoLeft = 0;
let netMode = 'campaign', netStatusMsg = '', netStarted = false, netPendingConfig = null;
let lastRunRes = null;

function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }

/* ---------------- 怪物图鉴：稀有度 / 特性 / 卡片 ---------------- */
function enemyBook(){
  try { return (typeof ENEMY !== 'undefined' && ENEMY) ? ENEMY : {}; } catch(e){ return {}; }
}
function enemyKeys(){ return Object.keys(enemyBook()); }
function dexOf(key){
  try {
    if (typeof Save !== 'undefined' && Save && typeof Save.dexCount === 'function') return +Save.dexCount(key) || 0;
    const d = (Save && Save.data && Save.data.dex) || {};
    return +d[key] || 0;
  } catch(e){ return 0; }
}
function dexOwned(){ return enemyKeys().filter(function(k){ return dexOf(k) > 0; }).length; }
const TIER_KEYS = ['normal', 'elite', 'rare', 'epic', 'legend'];
const TIER_NAMES = ['普通', '精锐', '稀有', '史诗', '传说'];
function tierIndexOf(t){
  if (typeof t === 'number' && isFinite(t)) return Math.max(0, Math.min(4, (t <= 1 ? 1 : t) - 1));
  const s = String(t || '');
  if (/传说|神话|legend|gold/i.test(s)) return 4;
  if (/史诗|epic/i.test(s)) return 3;
  if (/稀有|罕见|rare/i.test(s)) return 2;
  if (/精锐|精良|elite/i.test(s)) return 1;
  return 0;
}
function sizeClassOf(n){
  n = +n || 0;
  if (n <= 26) return 'small';
  if (n <= 46) return 'mid';
  return 'big';
}
function dexWhere(e){
  const w = e && e.where;
  if (Array.isArray(w)) return w.join(' · ');
  if (w) return String(w);
  return '未知区域';
}
function traitTagsOf(e){
  const arr = (e && Array.isArray(e.traits)) ? e.traits : [];
  if (!arr.length) return '';
  let html = '';
  for (let i = 0; i < arr.length; i++){
    const tr = arr[i];
    let icon = '✦', name = '';
    if (tr && typeof tr === 'object'){ icon = tr.icon || icon; name = tr.name || tr.key || ''; }
    else {
      name = String(tr == null ? '' : tr);
      try {
        if (typeof TRAITS !== 'undefined' && TRAITS && TRAITS[name]){ icon = TRAITS[name].icon || icon; name = TRAITS[name].name || name; }
      } catch(err){}
      if (!name) name = '未知特性';
    }
    html += '<span class="trait-tag">' + icon + ' ' + esc(name) + '</span>';
  }
  return '<div class="trait-row">' + html + '</div>';
}
function bookStat(label, val, ico){
  return '<span><i>' + ico + '</i>' + label + '<b>' + val + '</b></span>';
}
function bookCard(key, e, count){
  e = e || {};
  const own = count > 0;
  const ti = tierIndexOf(e.tier);
  const tk = TIER_KEYS[ti];
  const color = e.color || '#54627c';
  const dark = e.dark || '#1b2740';
  const name = e.name || key;
  const where = dexWhere(e);
  const hp = (e.hp == null) ? '--' : Math.round(e.hp);
  const spd = (e.speed == null) ? '--' : Math.round(e.speed);
  const rawDmg = (e.bDmg != null) ? e.bDmg : e.contact;
  const dmg = (rawDmg == null) ? '--' : Math.round(rawDmg);
  const desc = own ? (e.desc || '暂无更多情报。') : '击败它以解锁图鉴';
  const killTxt = own ? '击杀 ' + count : '未收录';
  return '<div class="card dex-card t-' + tk + (own ? ' own' : ' lock') + '" data-key="' + esc(key) + '">' +
    '<div class="dex-pv s-' + sizeClassOf(e.size) + '" style="--c:' + esc(color) + ';--d:' + esc(dark) + '"><i class="dark"></i></div>' +
    '<span class="dex-kill' + (own ? '' : ' off') + '">' + killTxt + '</span>' +
    '<div class="dex-name">' + (own ? esc(name) : '???') + '</div>' +
    '<div class="dex-meta">' +
      '<span class="dex-tier">' + TIER_NAMES[ti] + '</span>' +
      '<span class="dex-where" title="' + esc('出现在：' + where) + '">📍 ' + esc(where) + '</span>' +
    '</div>' +
    '<div class="dex-stats">' + bookStat('血量', own ? hp : '--', '❤️') + bookStat('速度', own ? spd : '--', '👟') + bookStat('伤害', own ? dmg : '--', '⚔️') + '</div>' +
    (own ? traitTagsOf(e) : '') +
    '<div class="dex-desc">' + esc(desc) + '</div>' +
  '</div>';
}


/* ---------------- 路由 ---------------- */
function show(name){
  cur = name;
  SCREENS.forEach(s => {
    const el = $(s === 'br' ? 'scrBR' : 'scr' + s.charAt(0).toUpperCase() + s.slice(1));
    if (el) el.classList.toggle('on', s === name);
  });
  const ov = $('overlay');
  ov.classList.toggle('hide', name === null);
  const hud = $('hud');
  if (hud) hud.classList.toggle('on', name === null || name === 'pause');
  Game.showTouch(name === null);
  if (name !== 'result') stopAuto();   // 离开结算页就取消倒数，但别清掉刚启动的自动返回
  refreshCoins();
}
function back(){
  if (cur === 'levels') goMenu();
  else if (cur === 'diff') goMenu();
  else if (cur === 'shop') goMenu();
  else if (cur === 'result') goMenu();
  else if (cur === 'book') goMenu();
  else if (cur === 'pack') goMenu();
  else goMenu();
}
function goMenu(){
  if (cur === 'net' && netAvailable() && Net.status() !== 'off'){ try { Net.disconnect(); } catch(e){} }
  netPendingConfig = null;
  Game.stop(); show('menu'); renderMenu();
}
function goLevels(){
  Game.stop(); show('levels'); renderLevels();
}
function goDiff(){
  Game.stop(); show('diff'); renderDiff();
}
function goShop(){
  Game.stop(); show('shop'); renderShop();
}
function goBook(){
  Game.stop(); show('book'); renderBook();
}
function goPack(){
  try { Game.stop(); } catch(e){}
  try {
    show('pack');
    renderPack();
  } catch(e){
    toastMsg('打开材质包失败：' + ((e && e.message) ? e.message : '未知错误'));
  }
}
function goBR(){
  Game.stop(); show('br'); renderBR();
}
function playLevel(id){
  if (!Game.startCampaign(id)) return;
  show(null);
}
function playTier(id){
  if (!Game.startEndless(id)) return;
  show(null);
}
function refreshCoins(){
  const n = Save.data.coins;
  const els = document.querySelectorAll('.coin-num');
  for (let i = 0; i < els.length; i++) els[i].textContent = n;
}

/* ---------------- 主页面 ---------------- */
function renderMenu(){
  const stars = Save.totalStars(), maxStars = LEVELS.length * 3;
  const cleared = LEVELS.filter(l => Save.levelStars(l.id) > 0).length;
  $('menuStats').innerHTML =
    '<div class="ms"><span>最高分</span><b>' + Save.data.best + '</b></div>' +
    '<div class="ms"><span>通关进度</span><b>' + cleared + ' / ' + LEVELS.length + '</b></div>' +
    '<div class="ms"><span>星星</span><b>' + stars + ' / ' + maxStars + '</b></div>' +
    '<div class="ms"><span>金币</span><b class="coin-num">' + Save.data.coins + '</b></div>' +
    '<div class="ms"><span>图鉴收录</span><b id="menuDexStat">' + dexOwned() + ' / ' + enemyKeys().length + '</b></div>';
  const menuDexNote = $('menuDexNote');
  if (menuDexNote) menuDexNote.textContent = '收录进度 ' + dexOwned() + ' / ' + enemyKeys().length;
  const bests = DIFFICULTIES.map(d => '第' + d.id + '档 ' + Save.endlessBest(d.id) + ' 波').join(' · ');
  $('menuEndless').textContent = bests;
  const brBox = $('menuBR');
  if (brBox){
    brBox.innerHTML = (typeof BR_MAPS !== 'undefined' ? BR_MAPS : []).map(m =>
      '<div class="ms"><span>🪂 ' + esc(m.name) + '</span><b>' + brWins(m.id) + ' 胜</b></div>'
    ).join('') || '<div class="ms"><span>暂无战绩</span><b>0 胜</b></div>';
  }
  const lvNote = $('menuLevelsNote');
  if (lvNote) lvNote.textContent = '战役关卡 · ' + LEVELS.length + ' 关剧情挑战';
  refreshCoins();
  updatePackMenuNote();
  applyPackVisuals();
  // PWA：主菜单「📲 安装到桌面」按钮只在可安装 / iOS 时显示
  if (typeof PWA !== 'undefined' && PWA && PWA.updateInstallButton) PWA.updateInstallButton();
}

/* ---------------- 关卡页 ---------------- */
function levelCard(lv, i){
  const st = Save.levelStars(lv.id), unlocked = Save.levelUnlocked(i);
  const types = {};
  lv.waves.forEach(w => w.n.forEach(p => { types[p[0]] = true; }));
  const icons = Object.keys(types).map(t => ENEMY[t].name).join(' · ');
  const stars = '★★★'.slice(0, st) + '☆☆☆'.slice(0, 3 - st);
  const ac = LV_COLORS[(lv.id - 1) % LV_COLORS.length];
  return '<div class="card lv-card' + (unlocked ? '' : ' locked') + (st ? ' done' : '') + '"' +
    ' style="--ac:' + ac + '" data-no="' + String(lv.id).padStart(2, '0') + '"' +
    (unlocked ? ' data-act="play-level" data-id="' + lv.id + '"' : '') + '>' +
    '<div class="lv-head"><span class="lv-no">第 ' + lv.id + ' 关</span>' +
    '<span class="lv-stars">' + stars + '</span></div>' +
    '<div class="lv-name">' + esc(lv.name) + '</div>' +
    '<div class="lv-sub">' + esc(lv.sub) + '</div>' +
    '<div class="lv-meta"><span>👾 ' + esc(icons) + '</span></div>' +
    '<div class="lv-meta"><span>🌊 ' + lv.waves.length + ' 波</span><span class="' + (st ? 'dimtxt' : 'cointxt') + '">' + (st ? '🪙 首通金币已领取' : '🪙 首通 ' + levelWaveCoins(lv)) + '</span></div>' +
    '<div class="lv-tip">' + esc(lv.tip) + '</div>' +
    (unlocked ? '' : '<div class="lock">🔒 通关上一关解锁</div>') +
    '</div>';
}
function renderLevels(){
  const total = Save.totalStars();
  $('lvTop').innerHTML = '<span class="star-total">⭐ ' + total + ' / ' + (LEVELS.length * 3) + '</span>' +
                         '<span class="coin-chip">🪙 <b class="coin-num">' + Save.data.coins + '</b></span>';
  $('lvGrid').innerHTML = LEVELS.map((lv, i) => levelCard(lv, i)).join('');
  refreshCoins();
}

/* ---------------- 难度页 ---------------- */
function diffCard(d){
  const m = d.cheatKeys.length;
  const cheatHtml = m
    ? '<div class="cheat-list">' + d.cheatKeys.map(k => {
        const c = CHEATS[k];
        return '<div class="cheat"><span class="ci">' + c.icon + '</span><div><b>' + c.name + '</b><i>' + c.desc + '</i></div></div>';
      }).join('') + '</div>'
    : '<div class="cheat-none">✅ 本档敌人不开任何外挂</div>';
  return '<div class="card diff-card' + (d.id === selTier ? ' sel' : '') + '" data-act="sel-tier" data-id="' + d.id + '" style="--tc:' + d.color + '">' +
    '<div class="df-head"><span class="df-name">' + d.name + '</span><span class="df-tag">' + d.tag + '</span></div>' +
    '<div class="df-scale">' +
      '<span>每波敌人 <b>+' + d.countStep + '</b></span>' +
      '<span>每波血量 <b>+' + Math.round(d.hpStep * 100) + '%</b></span>' +
      '<span>收益 <b>×' + d.coinMul + '</b></span>' +
    '</div>' +
    '<div class="df-brief">' + esc(d.brief) + '</div>' +
    cheatHtml +
    '<div class="df-best">历史最好：第 ' + Save.endlessBest(d.id) + ' 波</div>' +
    '</div>';
}
function renderDiff(){
  $('dfGrid').innerHTML = DIFFICULTIES.map(diffCard).join('');
  const d = DIFFICULTIES.filter(x => x.id === selTier)[0] || DIFFICULTIES[0];
  $('dfDetail').innerHTML =
    '<div class="dd-title" style="color:' + d.color + '">' + d.name + ' · 敌方外挂清单（' + (d.cheatKeys.length || '无') + '）</div>' +
    (d.cheatKeys.length
      ? '<div class="dd-grid">' + d.cheatKeys.map(k => {
          const c = CHEATS[k];
          return '<div class="dd-item"><span class="ci">' + c.icon + '</span><div><b>' + c.name + '</b><i>' + c.desc + '</i></div></div>';
        }).join('') + '</div>'
      : '<div class="dd-item"><span class="ci">🕊️</span><div><b>无外挂</b><i>敌人只会老老实实追你、开枪，难度来自每波 +10 只的数量压制</i></div></div>');
  refreshCoins();
}

/* ---------------- 大逃杀 ---------------- */
const BR_COLORS = ['#35e0f5', '#b06cff', '#ffb03a'];
function brWins(id){
  try {
    if (Save && typeof Save.brWins === 'function') return Save.brWins(id) || 0;
    const b = (Save && Save.data && Save.data.br) || {};
    return +b[id] || +b[String(id)] || 0;
  } catch(e){ return 0; }
}
function brCard(m, i){
  const ac = BR_COLORS[i % BR_COLORS.length];
  const win = brWins(m.id);
  return '<div class="card br-card' + (m.id === selectedMap ? ' sel' : '') + '" style="--bc:' + ac + '"' +
    ' data-act="sel-br" data-id="' + m.id + '">' +
    '<div class="br-head"><span class="br-name">' + esc(m.name) + '</span>' +
    '<span class="br-win">' + (win ? '🏆 ' + win + ' 胜' : '未通关') + '</span></div>' +
    '<div class="br-size">🗺️ ' + esc(m.size) + '</div>' +
    '<div class="br-meta"><span>👾 敌人 ' + m.enemies + '</span><span>🏠 房屋 ' + m.houses + '</span></div>' +
    '<div class="br-desc">' + esc(m.desc) + '</div>' +
    '<div class="br-pick">' + (m.id === selectedMap ? '✔ 已选中 · 点击开始空降' : '点击选择这张地图') + '</div>' +
    '</div>';
}
function brFact(ico, name, val){
  return '<div class="br-fact"><span class="bi">' + ico + '</span><div>' +
    '<span class="bn">' + name + '</span><span class="bv">' + val + '</span></div></div>';
}
function renderBR(){
  const maps = (typeof BR_MAPS !== 'undefined' && BR_MAPS && BR_MAPS.length) ? BR_MAPS : [];
  const grid = $('brGrid'), detail = $('brDetail');
  if (!maps.length){
    if (grid) grid.innerHTML = '<div class="br-empty">地图数据加载失败</div>';
    if (detail) detail.innerHTML = '';
    return;
  }
  if (!maps.some(m => m.id === selectedMap)) selectedMap = maps[0].id;
  if (grid) grid.innerHTML = maps.map(brCard).join('');
  const m = maps.filter(x => x.id === selectedMap)[0] || maps[0];
  if (detail){
    detail.innerHTML =
      '<div class="dd-title" style="color:var(--cy)">🪂 ' + esc(m.name) + ' · 战场情报</div>' +
      '<div class="br-facts">' +
        brFact('🗺️', '地图尺寸', esc(m.size)) +
        brFact('👾', '敌人数量', m.enemies + ' 名') +
        brFact('🏠', '房屋数量', m.houses + ' 栋') +
        brFact('🪙', '首胜奖励', m.reward + ' 金币') +
      '</div>' +
      '<div class="br-howto">' +
        '<b>玩法说明</b>' +
        '<ul>' +
          '<li>开局只有一把小手枪，子弹有限，先捡枪再开战。</li>' +
          '<li>房屋里的武器随机刷新，但只有手枪和匕首两种。</li>' +
          '<li>杀光地图上的所有敌人即可获胜，中途阵亡挑战立刻结束。</li>' +
          '<li>跟着小地图和指南针找敌人，别在超大战场里迷路。</li>' +
        '</ul>' +
        '<div class="br-best">' +
          (brWins(m.id) ? '🏆 已通关 ' + brWins(m.id) + ' 次，再接再厉！' : '尚未通关，首胜可拿 ' + m.reward + ' 金币') +
          ' · ' + esc(m.desc) +
        '</div>' +
      '</div>';
  }
  refreshCoins();
}

/* ---------------- 怪物图鉴 ---------------- */
function renderBook(){
  const keys = enemyKeys();
  const total = keys.length;
  const owned = keys.filter(function(k){ return dexOf(k) > 0; }).length;
  const pct = total ? Math.round(owned * 100 / total) : 0;
  let list = keys;
  if (selectedBookFilter === 'own') list = keys.filter(function(k){ return dexOf(k) > 0; });
  else if (selectedBookFilter === 'lock') list = keys.filter(function(k){ return dexOf(k) === 0; });
  const grid = $('bookGrid');
  if (grid){
    if (list.length){
      const book = enemyBook();
      let html = '';
      for (let i = 0; i < list.length; i++){
        const k = list[i];
        html += bookCard(k, book[k], dexOf(k));
      }
      grid.innerHTML = html;
    } else {
      grid.innerHTML = '<div class="dex-empty">' + (selectedBookFilter === 'own'
        ? '还没有收录任何怪物，去战斗吧！'
        : '全部怪物都已收录，图鉴圆满！') + '</div>';
    }
  }
  const prog = $('bookProgTxt');
  if (prog) prog.textContent = '已收录 ' + owned + ' / ' + total;
  const fill = $('bookProgFill');
  if (fill) fill.style.width = pct + '%';
  const chip = $('bookChipTxt');
  if (chip) chip.textContent = owned + ' / ' + total;
  const tabIds = ['bookTabAll', 'bookTabOwn', 'bookTabLock'];
  const tabVals = ['all', 'own', 'lock'];
  for (let i = 0; i < tabIds.length; i++){
    const el = $(tabIds[i]);
    if (el) el.classList.toggle('on', selectedBookFilter === tabVals[i]);
  }
}

/* ---------------- 材质包 ---------------- */
function svgDataUri(svg){
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg).replace(/[()']/g, function(c){
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}
function samplePack(){
  const bg = svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#0d1730"/><stop offset="0.55" stop-color="#231243"/><stop offset="1" stop-color="#081a2c"/>' +
    '</linearGradient></defs><rect width="960" height="540" fill="url(#g)"/>' +
    '<g stroke="#35e0f5" stroke-opacity="0.14" stroke-width="2" fill="none">' +
    '<path d="M0 135H960M0 270H960M0 405H960M240 0V540M480 0V540M720 0V540"/></g>' +
    '<circle cx="480" cy="270" r="180" fill="#b06cff" fill-opacity="0.10"/></svg>');
  const avatar = svgDataUri('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
    '<rect width="32" height="32" rx="6" fill="#35e0f5"/>' +
    '<rect x="5" y="5" width="22" height="22" rx="3" fill="#0a2c3a"/>' +
    '<rect x="10" y="12" width="4" height="5" fill="#9ff6ff"/><rect x="18" y="12" width="4" height="5" fill="#9ff6ff"/>' +
    '<rect x="11" y="21" width="10" height="2" fill="#35e0f5"/></svg>');
  return {
    format: 1,
    name: '示例 · 赛博方块',
    author: 'Block Gunner 2D',
    version: '1.0',
    background: bg,
    panels: { mode: 'replace', html: '这是示例材质包替换后的主菜单面板。\n把 panels.mode 改成 hide 可以隐藏右侧所有面板，改成 keep 则保持原样。\n（安全起见，这里的内容按纯文本显示，不会执行 HTML。）' },
    styles: [
      { id: 'neon', name: '霓虹战士', color: '#35e0f5', dark: '#0a2c3a', image: avatar, glow: true },
      { id: 'blaze', name: '烈焰方块', color: '#ff5b4a', dark: '#4a1009', glow: true }
    ]
  };
}
function packSafeImage(src){
  return (typeof src === 'string' && /^data:image\//i.test(src)) ? src : '';
}
function packPreviewColor(c){
  const s = (typeof c === 'string') ? c.trim() : '';
  return /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s]+\)|hsla?\([\d.,%\s]+\))$/.test(s) ? s : '#35e0f5';
}
function installPackText(text){
  let obj = null;
  try { obj = JSON.parse(String(text)); }
  catch(e){ toastMsg('安装失败：不是有效的 JSON 文件'); return false; }
  if (!Save || typeof Save.installPack !== 'function'){ toastMsg('安装失败：存档接口不可用'); return false; }
  const r = Save.installPack(obj);
  if (!r || !r.ok){ toastMsg('安装失败：' + ((r && r.err) || '未知错误')); return false; }
  if (Game && Game.sfx && Game.sfx.pickup) Game.sfx.pickup();
  toastMsg('材质包已安装：' + r.name);
  renderPack();
  return true;
}
function onPackFilePicked(e){
  const input = e && e.target;
  const file = input && input.files && input.files[0];
  if (!file) return;
  if (file.size && file.size > 4 * 1024 * 1024){
    toastMsg('材质包过大（建议图片压缩到 1MB 内）');
    try { input.value = ''; } catch(err){}
    return;
  }
  if (typeof FileReader !== 'function'){ toastMsg('当前环境不支持读取本地文件'); return; }
  let fr = null;
  try { fr = new FileReader(); }
  catch(err){ toastMsg('当前环境不支持读取本地文件'); return; }
  fr.onload = function(){
    installPackText(fr.result);
    try { input.value = ''; } catch(err){}
  };
  fr.onerror = function(){
    toastMsg('材质包读取失败，请重试');
    try { input.value = ''; } catch(err){}
  };
  try { fr.readAsText(file, 'utf-8'); }
  catch(err){ toastMsg('材质包读取失败：' + ((err && err.message) ? err.message : '未知错误')); }
}
function clearNode(el){ while (el.firstChild) el.removeChild(el.firstChild); }
function packRow(pack, id){
  const active = Save.data.packActive === id;
  const styles = (pack.styles || []).length;
  return '<div class="card pack-item' + (active ? ' on' : '') + '">' +
    '<div class="pack-item-head"><b class="pack-item-name">' + esc(pack.name) + '</b>' +
      (active ? '<span class="pack-badge">使用中</span>' : '') + '</div>' +
    '<div class="pack-meta">作者 ' + esc(pack.author || '匿名') + ' · v' + esc(pack.version || '1.0') + ' · ' + styles + ' 套样式</div>' +
    '<div class="pack-btns">' +
      (active
        ? '<button class="btn tiny ghost" data-act="pack-off">停用</button>'
        : '<button class="btn tiny" data-act="pack-on" data-id="' + esc(id) + '">启用</button>') +
      '<button class="btn tiny ghost danger" data-act="pack-del" data-id="' + esc(id) + '">删除</button>' +
    '</div>' +
  '</div>';
}
function updatePackMenuNote(){
  const note = $('menuPackNote');
  if (!note) return;
  const active = (Save.activePack ? Save.activePack() : null);
  const cs = (Save.characterStyle ? Save.characterStyle() : null);
  note.textContent = active ? ('当前：' + active.name + (cs ? ' · ' + cs.name : '')) : '未安装 · 换背景 / 面板 / 角色头像';
}
function renderPack(){
  try { renderPackBody(); }
  catch(e){ toastMsg('材质包页面渲染失败：' + ((e && e.message) ? e.message : '未知错误')); }
}
function renderPackBody(){
  const chip = $('packChipTxt');
  const active = (Save.activePack ? Save.activePack() : null);
  if (chip) chip.textContent = active ? active.name : '未安装';
  const box = $('packList');
  if (box){
    const list = Save.packs(), ids = Object.keys(list);
    if (ids.length){
      let html = '';
      for (let i = 0; i < ids.length; i++) html += packRow(list[ids[i]], ids[i]);
      box.innerHTML = html;
    } else {
      box.innerHTML = '<div class="pack-empty">还没有安装材质包。点上面的「选择 .bgpack 文件」，或先用「载入示例包」看看效果。</div>';
    }
  }
  const sg = $('packStyles');
  if (sg){
    if (active && active.styles && active.styles.length){
      const cur = (Save.characterStyle ? Save.characterStyle() : null);
      let html = '';
      for (let i = 0; i < active.styles.length; i++){
        const s = active.styles[i];
        const img = packSafeImage(s.image);
        const on = cur && cur.id === s.id;
        html += '<div class="card pack-style' + (on ? ' on' : '') + '" data-act="pack-style" data-id="' + esc(s.id) + '">' +
          '<div class="pack-style-pv">' + (img
            ? '<img src="' + esc(img) + '" alt="">'
            : '<i style="--c:' + esc(packPreviewColor(s.color)) + '"></i>') + '</div>' +
          '<div class="pack-style-name">' + esc(s.name) + '</div>' +
          (s.glow ? '<div class="pack-style-tag">✦ 发光</div>' : '') +
        '</div>';
      }
      sg.innerHTML = '<div class="pack-style-grid">' + html + '</div>';
    } else {
      sg.innerHTML = '<div class="pack-empty">启用一个材质包后，这里会显示它的全部角色样式，点击即可切换当前角色外观。</div>';
    }
  }
  updatePackMenuNote();
  applyPackVisuals();
}
function applyPackVisuals(){
  if (typeof Save === 'undefined' || !Save || !Save.data) return;
  const active = (Save.activePack ? Save.activePack() : null);
  const bg = (active && active.background) ? active.background : '';
  const ov = $('overlay');
  if (ov){
    ov.classList.toggle('pack-bg', !!bg);
    try {
      if (bg) ov.style.setProperty('--pack-bg', 'url("' + bg.replace(/["\\\r\n]/g, '') + '")');
      else ov.style.removeProperty('--pack-bg');
    } catch(e){}
  }
  const panels = (active && active.panels) ? active.panels : null;
  const mode = panels ? panels.mode : 'keep';
  const mr = $('menuRight');
  if (mr){
    mr.classList.toggle('panels-hidden', mode === 'hide');
    mr.classList.toggle('pack-replaced', mode === 'replace');
  }
  const slot = $('menuPackPanel');
  if (slot){
    if (mode === 'replace' && panels){
      slot.hidden = false;
      clearNode(slot);
      const imgSrc = packSafeImage(panels.image);
      if (imgSrc){
        const img = document.createElement('img');
        img.className = 'pack-panel-img';
        img.alt = active ? active.name : '材质包面板';
        img.src = imgSrc;
        slot.appendChild(img);
      }
      if (panels.html){
        const txt = document.createElement('div');
        txt.className = 'pack-panel-text';
        txt.textContent = String(panels.html);   // 安全：纯文本写入，绝不 innerHTML
        slot.appendChild(txt);
      }
    } else {
      slot.hidden = true;
      slot.textContent = '';
    }
  }
}
function goPack(){
  try { Game.stop(); } catch(e){}
  try {
    show('pack');
    renderPack();
  } catch(e){
    toastMsg('打开材质包失败：' + ((e && e.message) ? e.message : '未知错误'));
  }
}

/* ---------------- 商店 ---------------- */
function gearCard(u){
  const lv = Save.lv(u.id), max = u.max, maxed = lv >= max;
  const cost = maxed ? 0 : u.cost[lv];
  const afford = Save.data.coins >= cost;
  let pips = '';
  for (let i = 0; i < max; i++) pips += '<i class="' + (i < lv ? 'on' : '') + '"></i>';
  return '<div class="card up-card">' +
    '<div class="up-ico">' + u.icon + '</div>' +
    '<div class="up-main">' +
      '<div class="up-name">' + u.name + '<span class="lv">Lv.' + lv + ' / ' + max + '</span></div>' +
      '<div class="up-desc">' + u.desc + '</div>' +
      '<div class="lv-pips">' + pips + '</div>' +
    '</div>' +
    (maxed
      ? '<button class="btn small dis" disabled>已满级</button>'
      : '<button class="btn small' + (afford ? '' : ' dis') + '" data-act="buy-up" data-id="' + u.id + '">' + cost + ' 🪙</button>') +
    '</div>';
}
function skinCard(s){
  const owned = Save.hasSkin(s.id), eq = Save.data.skin === s.id;
  return '<div class="card skin-card' + (eq ? ' eq' : '') + '" data-act="' + (owned ? 'equip-skin' : 'buy-skin') + '" data-id="' + s.id + '">' +
    '<div class="skin-pv" style="--c:' + s.color + ';--d:' + s.dark + '"></div>' +
    '<div class="skin-body">' +
      '<div class="skin-name">' + s.name + (eq ? '<span class="tag-eq">装备中</span>' : '') + '</div>' +
      '<div class="skin-skill">✦ ' + s.skill + '</div>' +
      '<div class="skin-desc">' + s.skillDesc + '</div>' +
      (owned ? '<div class="skin-price">已拥有</div>' : '<div class="skin-price' + (Save.data.coins >= s.price ? '' : ' poor') + '">🪙 ' + s.price + '</div>') +
    '</div>' +
  '</div>';
}
function renderShop(){
  $('shopTabs').innerHTML =
    '<button class="tab' + (shopTab === 'gear' ? ' on' : '') + '" data-act="tab" data-id="gear">⚙️ 装备升级</button>' +
    '<button class="tab' + (shopTab === 'skin' ? ' on' : '') + '" data-act="tab" data-id="skin">🎨 皮肤技能</button>' +
    '<span class="coin-chip">🪙 <b class="coin-num">' + Save.data.coins + '</b></span>';
  if (shopTab === 'gear'){
    $('shopBody').innerHTML = '<div class="shop-hint">用金币永久强化你的手枪与身体，所有关卡通用。</div>' +
      '<div class="up-list">' + UPGRADES.map(gearCard).join('') + '</div>';
  } else {
    $('shopBody').innerHTML = '<div class="shop-hint">每个皮肤都带一个专属技能，点击卡片购买 / 装备。</div>' +
      '<div class="skin-grid">' + SKINS.map(skinCard).join('') + '</div>';
  }
  refreshCoins();
}

/* ---------------- 结算 ---------------- */
function starsHtml(n){
  let s = '';
  for (let i = 0; i < 3; i++) s += '<span class="st' + (i < n ? ' on' : '') + '" style="animation-delay:' + (i * 0.18) + 's">★</span>';
  return '<div class="big-stars">' + s + '</div>';
}
function showResult(res){
  lastRunRes = res;
  const box = $('resBody');
  if (res.mode === 'br'){
    const mp = res.map || { id: selectedMap, name: '大逃杀' };
    const total = res.total || 0;
    const kills = res.kills || 0;
    const btnHtml =
      '<div class="btns">' +
        '<button class="btn" data-act="replay-br">再来一局</button>' +
        '<button class="btn ghost" data-act="br">返回大逃杀</button>' +
        '<button class="btn ghost" data-act="shop">商店</button>' +
      '</div>';
    if (res.win){
      box.innerHTML =
        '<div class="res-title win">🏆 吃鸡成功</div>' +
        '<div class="res-sub">' + esc(mp.name) + ' · 杀光全部 ' + total + ' 名敌人</div>' +
        '<div class="res-grid">' +
          '<div><span>击杀</span><b>' + kills + ' / ' + total + '</b></div>' +
          '<div><span>得分</span><b>' + (res.score || 0) + '</b></div>' +
          '<div><span>本局金币</span><b>+' + (res.coins || 0) + '</b></div>' +
          '<div><span>首胜奖励</span><b>' + (res.first ? '+' + (res.reward || 0) : '已领取') + '</b></div>' +
        '</div>' +
        '<div class="res-note">' + (res.first
          ? '🎉 首次通关「' + esc(mp.name) + '」！额外发放 ' + (res.reward || 0) + ' 金币首胜奖励，主菜单可查看三张地图战绩。'
          : '这张地图之前已经吃鸡，本次不再发放首胜奖励，击杀金币照常结算。') + '</div>' +
        btnHtml;
    } else {
      const left = Math.max(0, total - kills);
      box.innerHTML =
        '<div class="res-title lose">挑战结束</div>' +
        '<div class="res-sub">' + esc(mp.name) + ' · 大逃杀阵亡</div>' +
        '<div class="res-grid">' +
          '<div><span>击杀</span><b>' + kills + ' / ' + total + '</b></div>' +
          '<div><span>剩余敌人</span><b>' + left + '</b></div>' +
          '<div><span>得分</span><b>' + (res.score || 0) + '</b></div>' +
          '<div><span>本局金币</span><b>+' + (res.coins || 0) + '</b></div>' +
        '</div>' +
        '<div class="res-note">还差 ' + left + ' 名敌人就能吃鸡，先去房屋捡把好枪再来！</div>' +
        btnHtml;
    }
    stopAuto();
    show('result');
    return;
  }
  if (res.mode === 'campaign' && res.win){
    box.innerHTML =
      '<div class="res-title win">关 卡 完 成</div>' +
      '<div class="res-sub">' + esc(res.level.name) + ' · 第 ' + res.wave + ' 波</div>' +
      starsHtml(res.stars) +
      '<div class="res-grid">' +
        '<div><span>击杀</span><b>' + res.kills + '</b></div>' +
        '<div><span>得分</span><b>' + res.score + '</b></div>' +
        '<div><span>本局金币</span><b>+' + res.coins + '</b></div>' +
        '<div><span>剩余生命</span><b>' + res.hp + ' / ' + res.maxHp + '</b></div>' +
      '</div>' +
      '<div class="res-note">' + (res.first ? '🎉 <b>首次通关</b>！本关金币已按每一波发放，共 +' + (res.waveCoins || 0) + ' 金币。' : '本关<b>之前已经通关</b>，重复挑战不再发放金币（本局金币 +0）。') + '</div>' +
      '<div class="btns"><button class="btn" data-act="levels">返回关卡列表</button>' +
      '<button class="btn ghost" data-act="replay">再来一次</button></div>' +
      '<div class="auto-tip"><span id="autoNum">4</span> 秒后自动返回关卡列表…</div>';
    startAuto(4, goLevels);
  } else if (res.mode === 'campaign'){
    box.innerHTML =
      '<div class="res-title lose">挑 战 失 败</div>' +
      '<div class="res-sub">' + esc(res.level.name) + ' · 倒在第 ' + res.wave + ' 波</div>' +
      '<div class="res-grid">' +
        '<div><span>击杀</span><b>' + res.kills + '</b></div>' +
        '<div><span>得分</span><b>' + res.score + '</b></div>' +
        '<div><span>本局金币</span><b>+' + res.coins + '</b></div>' +
        '<div><span>最高分</span><b>' + Save.data.best + '</b></div>' +
      '</div>' +
      '<div class="res-note">去商店升级装备，或者换个皮肤技能再来！</div>' +
      '<div class="btns"><button class="btn" data-act="replay">重新挑战</button>' +
      '<button class="btn ghost" data-act="levels">返回关卡列表</button>' +
      '<button class="btn ghost" data-act="shop">商店</button></div>';
    stopAuto();
  } else {
    const isBest = res.wave >= res.best && res.wave > 0;
    box.innerHTML =
      '<div class="res-title ' + (isBest ? 'win' : 'lose') + '">挑 战 结 束</div>' +
      '<div class="res-sub">' + esc(res.tier.name) + '</div>' +
      (isBest ? '<div class="new-record">🏆 新纪录！</div>' : '') +
      '<div class="res-grid">' +
        '<div><span>到达波次</span><b>' + res.wave + '</b></div>' +
        '<div><span>历史最好</span><b>' + res.best + '</b></div>' +
        '<div><span>击杀</span><b>' + res.kills + '</b></div>' +
        '<div><span>本局金币</span><b>+' + res.coins + '</b></div>' +
      '</div>' +
      '<div class="res-note">得分 ' + res.score + ' · 难度档收益 ×' + res.tier.coinMul + ' · 其中每波结算 +' + (res.waveCoins || 0) + ' 金币</div>' +
      '<div class="btns"><button class="btn" data-act="replay">再来一局</button>' +
      '<button class="btn ghost" data-act="diff">返回难度选择</button>' +
      '<button class="btn ghost" data-act="shop">商店</button></div>';
    stopAuto();
  }
  show('result');
}
function startAuto(sec, fn){
  stopAuto(); autoLeft = sec;
  const num = $('autoNum');
  autoTimer = setInterval(() => {
    autoLeft--;
    if (num) num.textContent = autoLeft;
    if (autoLeft <= 0){ stopAuto(); fn(); }
  }, 1000);
}
function stopAuto(){ if (autoTimer){ clearInterval(autoTimer); autoTimer = null; } }

/* ---------------- 联机合作 ----------------
   网络层见 js/net.js；引擎侧由 Game.startCoop 接管。
   Net.on.* 一律用追加订阅（Net.onXxx / push），绝不覆盖 game.js 已注册的 relay 回调。 */
function netSupported(){ return typeof Net !== 'undefined' && !!Net && typeof Net.available === 'function'; }
function netAvailable(){ return netSupported() && Net.available(); }
function netHint(){ return (netSupported() && Net.FILE_HINT) ? Net.FILE_HINT : '请通过服务端地址打开（http://IP:8080）'; }
function cleanNetCode(v){ return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); }
function netNameValue(){
  const el = $('netName');
  let n = el ? String(el.value || '').trim() : '';
  if (!n){ try { n = localStorage.getItem('bg2d_net_name') || ''; } catch(e){} }
  if (!n) n = '方块' + Math.floor(100 + Math.random() * 900);
  if (el && !el.value) el.value = n;
  return n;
}
function storeNetName(n){ try { localStorage.setItem('bg2d_net_name', n); } catch(e){} }
function netUrlValue(){
  const el = $('netUrl');
  const v = el ? String(el.value || '').trim() : '';
  if (v) return v;
  return (netSupported() && Net.autoUrl) ? Net.autoUrl() : '';
}
function fillNetSelects(){
  const lv = $('netLevel');
  if (lv && (!lv.options || !lv.options.length) && typeof LEVELS !== 'undefined'){
    let html = '';
    for (let i = 0; i < LEVELS.length; i++) html += '<option value="' + LEVELS[i].id + '">第 ' + LEVELS[i].id + ' 关 · ' + esc(LEVELS[i].name) + '</option>';
    lv.innerHTML = html;
    if (lv.value !== '1') lv.value = '1';
  }
  const tr = $('netTier');
  if (tr && (!tr.options || !tr.options.length) && typeof DIFFICULTIES !== 'undefined'){
    let html = '';
    for (let i = 0; i < DIFFICULTIES.length; i++) html += '<option value="' + DIFFICULTIES[i].id + '">' + esc(DIFFICULTIES[i].name) + '</option>';
    tr.innerHTML = html;
    if (tr.value !== '1') tr.value = '1';
  }
}
function netConfig(){
  if (netMode === 'endless'){
    const tr = $('netTier');
    const t = +((tr && tr.value) || 1);
    return { mode: 'endless', tier: Math.max(1, Math.min(4, t || 1)) };
  }
  const lv = $('netLevel');
  const maxLv = (typeof LEVELS !== 'undefined' && LEVELS.length) ? LEVELS.length : 100;
  const n = +((lv && lv.value) || 1);
  return { mode: 'campaign', level: Math.max(1, Math.min(maxLv, n || 1)) };
}
function netConfigText(cfg){
  cfg = cfg || {};
  if (cfg.mode === 'endless'){
    let nm = '第' + (+cfg.tier || 1) + '档';
    try {
      if (typeof DIFFICULTIES !== 'undefined'){
        const d = DIFFICULTIES.filter(x => x.id === +cfg.tier)[0];
        if (d) nm = d.name;
      }
    } catch(e){}
    return '🔥 合作难度 · ' + nm;
  }
  let ln = '第' + (+cfg.level || 1) + '关';
  try {
    if (typeof LEVELS !== 'undefined'){
      const l = LEVELS.filter(x => x.id === +cfg.level)[0];
      if (l) ln = '第' + l.id + '关 · ' + l.name;
    }
  } catch(e){}
  return '🏁 合作战役 · ' + ln;
}
function goNet(){
  Game.stop();
  show('net');
  renderNet();
}
function updateNetStatus(){
  const st = netSupported() ? Net.status() : 'off';
  const can = netAvailable();
  let text;
  if (!can) text = netHint();
  else if (st === 'online') text = (Net.roomCode() ? ('已连接 · 房间 ' + Net.roomCode() + ' · ' + (Net.players() || []).length + ' 人') : '已连接服务器，可创建 / 加入房间') + (netStatusMsg ? (' · ' + netStatusMsg) : '');
  else if (st === 'connecting') text = netStatusMsg || '正在连接服务器…';
  else if (st === 'error') text = netStatusMsg || '连接失败：无法连接服务器';
  else text = netStatusMsg || '未连接 · 输入服务器地址后点击创建 / 加入';
  const el = $('netStatus');
  if (el){
    el.textContent = '● ' + text;
    el.classList.toggle('ok', can && st === 'online');
    el.classList.toggle('bad', can && st === 'error');
    el.classList.toggle('warn', can && st === 'connecting');
  }
  const lat = netSupported() ? (Net.latency() || 0) : 0;
  const top = $('netPingTop');
  if (top) top.textContent = (can && st === 'online') ? (lat ? (lat + ' ms') : '--') : '--';
  const rp = $('netRoomPing');
  if (rp) rp.textContent = lat ? (lat + ' ms') : '检测中…';
}
function renderNet(){
  fillNetSelects();
  const urlEl = $('netUrl');
  if (urlEl){
    // 只填一次：优先 ?server= 参数（App 注入），其次是上次保存的 localStorage 值
    if (!urlEl.value && netSupported() && Net.savedUrl){
      const saved = Net.savedUrl();
      if (saved) urlEl.value = saved;
    }
    const au = (netSupported() && Net.autoUrl) ? Net.autoUrl() : '';
    urlEl.placeholder = '自动：' + (au || 'ws://192.168.1.5:8080/ws');
  }
  const nameEl = $('netName');
  if (nameEl && !nameEl.value){ try { nameEl.value = localStorage.getItem('bg2d_net_name') || ''; } catch(e){} }
  const codeEl = $('netCode');
  if (codeEl && netSupported() && Net.parseHash){
    const h = Net.parseHash();
    if (h && h.join && codeEl.value !== h.join) codeEl.value = h.join;
  }
  renderNetRoom();
  updateNetStatus();
  renderNetHud();
}
function netPlayerRow(p, meId){
  const isMe = p.id === meId;
  const ico = p.host ? '👑' : (p.ready ? '✅' : '⏳');
  const tag = p.host ? '房主' : (p.ready ? '已准备' : '未准备');
  return '<div class="net-player' + (isMe ? ' me' : '') + ((p.ready || p.host) ? ' ready' : '') + '">' +
    '<span class="np-ico">' + ico + '</span>' +
    '<span class="np-name">' + esc(p.name || '玩家') + (isMe ? '（我）' : '') + '</span>' +
    '<span class="np-tag' + (p.host ? ' host' : (p.ready ? '' : ' wait')) + '">' + tag + '</span>' +
  '</div>';
}
function renderNetRoom(){
  const roomEl = $('netRoom'), formEl = $('netForm');
  const online = netAvailable() && Net.status() === 'online';
  const inRoom = !!(online && Net.roomCode());
  if (roomEl) roomEl.classList.toggle('on', inRoom);
  if (formEl) formEl.classList.toggle('hide', inRoom);
  updateNetStatus();
  if (!inRoom) return;
  const players = (Net.players && Net.players()) || [];
  const myId = (Net.myId && Net.myId()) || '';
  const me = players.filter(p => p.id === myId)[0] || {};
  const amHost = !!(Net.isHost && Net.isHost());
  const codeEl = $('netRoomCode');
  if (codeEl) codeEl.textContent = Net.roomCode();
  const cnt = $('netPlayerCount');
  if (cnt) cnt.textContent = players.length + ' / 6 人';
  const list = $('netPlayers');
  if (list){
    list.innerHTML = players.map(p => netPlayerRow(p, myId)).join('') ||
      '<div class="net-player"><span class="np-name">等待玩家加入…</span></div>';
  }
  const role = $('netRoleTxt');
  if (role) role.textContent = amHost ? '房主' : '队员';
  const hostBox = $('netHostBox');
  if (hostBox) hostBox.classList.toggle('hide', !amHost);
  const startBtn = $('netStartBtn');
  if (startBtn){
    startBtn.classList.toggle('hide', !amHost);
    startBtn.textContent = players.length < 2 ? '🚀 开始游戏（单人也能试跑）' : '🚀 开始游戏';
  }
  const readyBtn = $('netReadyBtn');
  if (readyBtn){
    readyBtn.classList.toggle('hide', amHost);
    readyBtn.textContent = me.ready ? '✋ 取消准备' : '✅ 我准备好了';
    readyBtn.classList.toggle('on', !!me.ready);
  }
  const modeBtns = document.querySelectorAll('#netModes [data-act="net-mode"]');
  for (let i = 0; i < modeBtns.length; i++) modeBtns[i].classList.toggle('on', modeBtns[i].getAttribute('data-id') === netMode);
  const lvWrap = $('netLevelWrap'), trWrap = $('netTierWrap');
  if (lvWrap) lvWrap.classList.toggle('hide', netMode !== 'campaign');
  if (trWrap) trWrap.classList.toggle('hide', netMode !== 'endless');
  const cfgEl = $('netRoomCfg');
  if (cfgEl) cfgEl.textContent = amHost ? ('当前选择：' + netConfigText(netConfig())) : '';
  const guestNote = $('netGuestNote');
  if (guestNote && !amHost){
    let rc = null; try { rc = (Net.config && Net.config()) || null; } catch(e){}
    guestNote.textContent = rc ? ('等待房主开始…房间设置：' + netConfigText(rc) + '（以房主开始时的选择为准）') : '等待房主选择模式并开始游戏…准备好了先点上面的按钮。';
  }
}
function renderNetHud(){
  const el = $('netHud');
  if (!el) return;
  const isCoop = netSupported() && !!(Net.roomCode && Net.roomCode()) &&
    !!(typeof Game !== 'undefined' && typeof Game.netRole === 'function' && Game.netRole());
  if (!isCoop){ el.classList.remove('on'); return; }
  const lat = (Net.latency && Net.latency()) || 0;
  const players = (Net.players && Net.players()) || [];
  const codeEl = $('netHudCode');
  if (codeEl) codeEl.textContent = '房间 ' + Net.roomCode();
  const pingEl = $('netHudPing');
  if (pingEl){ pingEl.textContent = lat ? (lat + 'ms') : '--'; pingEl.classList.toggle('bad', lat > 200); }
  const psEl = $('netHudPlayers');
  if (psEl) psEl.textContent = players.map(p => p.name).join(' · ') || '...';
  el.classList.add('on');
}
function copyNetCode(){
  const c = (netSupported() && Net.roomCode) ? Net.roomCode() : '';
  if (!c) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      const p = navigator.clipboard.writeText(c);
      if (p && p.then) p.then(() => toastMsg('📋 房间码已复制：' + c)).catch(() => {});
      return;
    }
  } catch(e){}
  try {
    const ta = document.createElement('textarea');
    ta.value = c; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toastMsg('📋 房间码已复制：' + c);
  } catch(e){ /* 复制失败静默 */ }
}
function netDoCreate(){
  netPendingConfig = null;
  if (!netAvailable()){ netStatusMsg = netHint(); toastMsg(netHint()); updateNetStatus(); return; }
  const name = netNameValue(); storeNetName(name);
  const netUrlInput = $('netUrl');
  const netUrl = netUrlValue();
  // 只填一次：记住用户真正填写的地址；空输入不要把当前页面地址当成 PC 地址存下来
  if (netSupported() && Net.saveUrl && netUrlInput && String(netUrlInput.value || '').trim()){
    Net.saveUrl(netUrl);
  }
  const step = (Net.status() === 'online') ? Promise.resolve({ ok: true }) : Net.connect(netUrl);
  step.then(c => {
    if (!c.ok) throw new Error(c.err || '连接失败');
    return Net.createRoom(name, netConfig());
  }).then(r => {
    if (!r || !r.ok) throw new Error((r && r.err) || '创建房间失败');
    netStatusMsg = '';
    toastMsg('🎉 房间已创建：' + r.code + '，把房间码发给队友吧');
    if (cur === 'net') renderNet(); else renderNetHud();
  }).catch(e => {
    netStatusMsg = (e && e.message) ? e.message : String(e);
    toastMsg('创建失败：' + netStatusMsg);
    updateNetStatus();
  });
}
function netDoJoin(){
  netPendingConfig = null;
  if (!netAvailable()){ netStatusMsg = netHint(); toastMsg(netHint()); updateNetStatus(); return; }
  const codeEl = $('netCode');
  const code = cleanNetCode(codeEl ? codeEl.value : '');
  if (codeEl) codeEl.value = code;
  if (code.length !== 4){ toastMsg('请输入 4 位房间码（字母 / 数字）'); return; }
  const name = netNameValue(); storeNetName(name);
  const netUrlInput = $('netUrl');
  const netUrl = netUrlValue();
  // 只填一次：记住用户真正填写的地址；空输入不要把当前页面地址当成 PC 地址存下来
  if (netSupported() && Net.saveUrl && netUrlInput && String(netUrlInput.value || '').trim()){
    Net.saveUrl(netUrl);
  }
  const step = (Net.status() === 'online') ? Promise.resolve({ ok: true }) : Net.connect(netUrl);
  step.then(c => {
    if (!c.ok) throw new Error(c.err || '连接失败');
    return Net.joinRoom(name, code);
  }).then(r => {
    if (!r || !r.ok) throw new Error((r && r.err) || '加入房间失败');
    netStatusMsg = '';
    toastMsg('🔗 已加入房间 ' + (Net.roomCode() || code));
    if (cur === 'net') renderNet(); else renderNetHud();
  }).catch(e => {
    netStatusMsg = (e && e.message) ? e.message : String(e);
    toastMsg('加入失败：' + netStatusMsg);
    updateNetStatus();
  });
}
function netReady(){
  if (!netAvailable() || !Net.roomCode()) return;
  const players = (Net.players && Net.players()) || [];
  const me = players.filter(p => p.id === Net.myId())[0];
  const v = !(me && me.ready);
  const ok = Net.ready(v);
  if (!ok) toastMsg('准备状态发送失败，连接可能已断开');
  if (cur === 'net') renderNetRoom();
}
function netStartHost(){
  if (!netAvailable() || !Net.roomCode()) return;
  if (!Net.isHost()){ toastMsg('只有房主可以开始游戏'); return; }
  if (typeof Game === 'undefined' || typeof Game.startCoop !== 'function'){ toastMsg('引擎暂不支持联机合作（Game.startCoop 未实现）'); return; }
  const cfg = netConfig();
  netPendingConfig = cfg;
  if (Net.send) Net.send({ k: 'netcfg', config: cfg });   // 先把最终模式同步给队友（服务器 start 只带创建时的 config）
  if (!Net.startGame || !Net.startGame(cfg)){ toastMsg('开始指令发送失败，请检查连接'); return; }
  // 关键顺序：先广播 start 再启动本地引擎。这样 host 引擎 startCoop 里发的 setup（随机障碍/世界尺寸）
  // 会排在 start 之后到达客户端，客户端已进入 RUN，能正确接收并由快照同步。
  if (!onCoopStart(cfg, true)) return;
  toastMsg('🚀 开始游戏！');
}
function onCoopStart(config, forceHost){
  if (!netAvailable()) return false;
  if (typeof Game === 'undefined' || typeof Game.startCoop !== 'function'){
    toastMsg('引擎暂不支持联机合作（Game.startCoop 未实现）');
    return false;
  }
  if (typeof Game.netRole === 'function' && Game.netRole()) return true;   // 已经在联机局中
  if (!forceHost && Game.state && Game.state() === 'playing'){
    toastMsg('你正在单人对局中，未进入联机对局');
    return false;
  }
  const role = (forceHost || (Net.isHost && Net.isHost())) ? 'host' : 'client';
  const cfg = config || ((Net.config && Net.config()) || netConfig());
  const info = { code: Net.roomCode(), myId: Net.myId(), players: Net.players() };
  let ok = false;
  try { ok = Game.startCoop({ role: role, config: cfg, net: info }); } catch(e){ ok = false; }
  if (!ok){ toastMsg('进入联机对局失败，请重试'); return false; }
  netStarted = true;
  renderNetHud();
  show(null);
  return true;
}
function bindNet(){
  if (typeof Net === 'undefined' || !Net.on) return;
  const onStatus = function(st, msg){
    if (st === 'online') netStatusMsg = (msg && /重连|恢复/.test(msg)) ? msg : '';
    else netStatusMsg = msg || '';
    if (cur === 'net') renderNetRoom();
    updateNetStatus();
    renderNetHud();
  };
  const onPeer = function(evt){
    evt = evt || {};
    if (evt.ev === 'join' && evt.name) toastMsg('👋 ' + evt.name + ' 加入了房间');
    if (evt.ev === 'leave' && evt.name) toastMsg('🚪 ' + evt.name + ' 离开了房间');
    if (cur === 'net') renderNetRoom();
    renderNetHud();
  };
  const onStart = function(config){
    onCoopStart(netPendingConfig || config);   // 优先用房主开始时 relay 过来的最终 config
  };
  const onErr = function(msg){
    netStatusMsg = msg || '';
    toastMsg('⚠️ 联机：' + (msg || '发生错误'));
    updateNetStatus();
    if (cur === 'net') renderNetRoom();
  };
  const onRelay = function(from, data){
    if (data && data.k === 'netcfg' && data.config) netPendingConfig = data.config;   // 追加订阅：不影响 game.js 的 relay
  };
  const onRoom = function(){ if (cur === 'net') renderNetRoom(); };
  if (Net.onStatus) Net.onStatus(onStatus); else Net.on.status.push(onStatus);
  if (Net.onPeer) Net.onPeer(onPeer); else Net.on.peer.push(onPeer);
  if (Net.onStart) Net.onStart(onStart); else Net.on.start.push(onStart);
  if (Net.onErr) Net.onErr(onErr); else Net.on.err.push(onErr);
  if (Net.onRelay) Net.onRelay(onRelay); else Net.on.relay.push(onRelay);
  if (Net.onRoom) Net.onRoom(onRoom); else Net.on.room.push(onRoom);
}
/* ---------------- 事件 ---------------- */
function onAct(act, id, el){
  Game.sfx.unlock();
  switch(act){
    case 'install': if (typeof PWA !== 'undefined' && PWA && PWA.install) PWA.install(); break;
    case 'menu': goMenu(); break;
    case 'levels': goLevels(); break;
    case 'diff': goDiff(); break;
    case 'shop': goShop(); break;
    case 'br': goBR(); break;
    case 'book': goBook(); break;
    case 'pack': {
      try { goPack(); }
      catch(e){ toastMsg('打开材质包失败：' + ((e && e.message) ? e.message : '未知错误')); }
      break;
    }
    case 'pack-sample': installPackText(JSON.stringify(samplePack())); break;
    case 'pack-on': {
      if (Save.setActivePack(id)){
        if (Game.sfx && Game.sfx.pickup) Game.sfx.pickup();
        toastMsg('已启用材质包');
      } else toastMsg('启用失败：材质包不存在');
      renderPack();
      break;
    }
    case 'pack-off': {
      Save.setActivePack(null);
      toastMsg('已停用材质包');
      renderPack();
      break;
    }
    case 'pack-del': {
      if (Save.removePack(id)) toastMsg('已删除材质包');
      else toastMsg('删除失败：材质包不存在');
      renderPack();
      break;
    }
    case 'pack-style': {
      if (Save.setCharacterStyle(id)){
        if (Game.sfx && Game.sfx.blip) Game.sfx.blip(600, 1200, 0.08, 'sine', 0.06);
        toastMsg('已切换角色样式');
      } else toastMsg('切换失败：该样式不存在');
      renderPack();
      break;
    }
    case 'net': goNet(); break;
    case 'net-create': netDoCreate(); break;
    case 'net-join': netDoJoin(); break;
    case 'net-ready': netReady(); break;
    case 'net-start': netStartHost(); break;
    case 'net-copy': copyNetCode(); break;
    case 'net-mode': {
      netMode = (id === 'endless') ? 'endless' : 'campaign';
      renderNetRoom();
      Game.sfx.blip(600, 900, 0.06, 'sine', 0.05);
      break;
    }
    case 'net-leave': {
      if (netSupported()){ try { Net.disconnect(); } catch(e){} }
      netStatusMsg = '';
      netPendingConfig = null;
      toastMsg('已退出联机房间');
      renderNet();
      break;
    }
    case 'book-filter': {
      selectedBookFilter = (id === 'own' || id === 'lock') ? id : 'all';
      renderBook();
      Game.sfx.blip(600, 900, 0.06, 'sine', 0.05);
      break;
    }
    case 'sel-br': {
      const mid = +id;
      if (typeof BR_MAPS !== 'undefined' && BR_MAPS.some(m => m.id === mid)){
        selectedMap = mid; renderBR(); Game.sfx.blip(600, 900, 0.06, 'sine', 0.05);
      }
      break;
    }
    case 'start-br': {
      if (Game.startBR(selectedMap)) show(null);
      else toastMsg('起飞失败，请再试一次');
      break;
    }
    case 'replay-br': {
      const r = lastRunRes;
      const mid = (r && r.mode === 'br' && r.map && r.map.id) ? r.map.id : selectedMap;
      selectedMap = mid;
      if (Game.startBR(mid)) show(null);
      else toastMsg('起飞失败，请再试一次');
      break;
    }
    case 'play-level': playLevel(+id); break;
    case 'play-tier': playTier(selTier); break;
    case 'sel-tier': selTier = +id; renderDiff(); Game.sfx.blip(600, 900, 0.06, 'sine', 0.05); break;
    case 'tab': shopTab = id; renderShop(); break;
    case 'buy-up': {
      const r = Save.buyUpgrade(id);
      if (r === 'ok'){ Game.sfx.pickup(); toastMsg('升级成功！'); }
      else if (r === 'poor'){ Game.sfx.blip(200, 120, 0.16, 'sawtooth', 0.08); toastMsg('金币不够，去打关卡赚金币吧'); }
      else toastMsg('已经满级了');
      renderShop(); break;
    }
    case 'buy-skin': {
      const r = Save.buySkin(id);
      if (r === 'ok'){ Game.sfx.win(); toastMsg('购买成功，已自动装备！'); }
      else if (r === 'poor'){ Game.sfx.blip(200, 120, 0.16, 'sawtooth', 0.08); toastMsg('金币不够，去难度关卡刷金币吧'); }
      renderShop(); break;
    }
    case 'equip-skin': {
      if (Save.equipSkin(id)){ Game.sfx.blip(700, 1200, 0.1, 'sine', 0.07); toastMsg('已装备 ' + getSkin(id).name); }
      renderShop(); break;
    }
    case 'replay': {
      const r = lastRunRes;
      if (!r) return goLevels();
      if (r.mode === 'campaign') playLevel(r.level.id);
      else playTier(r.tierId);
      break;
    }
    case 'resume': if (Game.state() === 'paused') Game.resume(); show(null); break;
    case 'quit': {
      const r = Game.run();
      Game.stop();
      if (r && r.mode === 'campaign') goLevels();
      else if (r && r.mode === 'br') goBR();
      else if (r) goDiff();
      else goMenu();
      break;
    }
    case 'quit-levels': Game.stop(); goLevels(); break;
    case 'quit-diff': Game.stop(); goDiff(); break;
  }
}
function toMenuFromGame(){ Game.stop(); goMenu(); }
function toastMsg(msg){
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 1100);
}
function bind(){
  document.body.addEventListener('click', e => {
    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    e.preventDefault();
    onAct(el.getAttribute('data-act'), el.getAttribute('data-id'), el);
  });
  Game.events.onWin = res => { res.win = true; showResult(res); };
  Game.events.onLose = res => { res.win = false; showResult(res); };
  Game.events.onPause = paused => {
    if (paused) show('pause');
    else { show(null); }
  };
  if (Game && Game.events){
    Game.events.onDex = function(key){
      let nm = key || '未知怪物';
      try { const be = enemyBook()[key]; if (be && be.name) nm = be.name; } catch(err){}
      toastMsg('📖 图鉴新增：' + nm);
      if (cur === 'book') renderBook();
      else if (cur === 'menu') renderMenu();
    };
  }
  const lvSel = $('netLevel');
  if (lvSel) lvSel.addEventListener('change', () => { if (cur === 'net') renderNetRoom(); });
  const trSel = $('netTier');
  if (trSel) trSel.addEventListener('change', () => { if (cur === 'net') renderNetRoom(); });
  const codeInput = $('netCode');
  if (codeInput) codeInput.addEventListener('input', () => { codeInput.value = cleanNetCode(codeInput.value); });
  const nameInput = $('netName');
  if (nameInput) nameInput.addEventListener('change', () => { storeNetName(netNameValue()); });
  const packFile = $('packFile');
  if (packFile) packFile.addEventListener('change', onPackFilePicked);
  bindNet();
}


/* ---------------- 移动端适配 ---------------- */
function isTouchDevice(){
  try {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
      !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  } catch(e){ return false; }
}
function isFullscreen(){
  try { return !!(document.fullscreenElement || document.webkitFullscreenElement); } catch(e){ return false; }
}
function toggleFull(){
  try {
    if (isFullscreen()){
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex){ const p = ex.call(document); if (p && p.catch) p.catch(function(){}); }
    } else {
      const el = document.documentElement;
      const rq = el.requestFullscreen || el.webkitRequestFullscreen;
      if (rq){ const p = rq.call(el); if (p && p.catch) p.catch(function(){}); }
    }
  } catch(e){ /* 全屏失败时静默 */ }
}
function updateViewport(){
  const touch = isTouchDevice();
  if (document.body) document.body.classList.toggle('touch', touch);
  const rot = $('rotate');
  if (rot) rot.classList.toggle('on', touch && window.innerHeight > window.innerWidth);
  const bf = $('btnFull');
  if (bf){
    const fs = isFullscreen();
    bf.textContent = fs ? '🗗' : '⛶';
    bf.title = fs ? '退出全屏' : '全屏';
  }
}
function bindViewport(){
  const bf = $('btnFull');
  if (bf) bf.addEventListener('click', e => { e.preventDefault(); toggleFull(); });
  window.addEventListener('resize', updateViewport);
  window.addEventListener('orientationchange', updateViewport);
  document.addEventListener('fullscreenchange', updateViewport);
  document.addEventListener('webkitfullscreenchange', updateViewport);
  if (window.matchMedia){
    try {
      const mq = window.matchMedia('(orientation: portrait)');
      if (mq.addEventListener) mq.addEventListener('change', updateViewport);
      else if (mq.addListener) mq.addListener(updateViewport);
    } catch(e){}
  }
  updateViewport();
}

/* ---------------- 启动 ---------------- */
function init(){
  bind();
  bindViewport();
  const hash = (location.hash || '').toLowerCase();
  const netHash = (typeof Net !== 'undefined' && Net.parseHash) ? Net.parseHash() : { screen: null, join: null };
  if (hash === '#br') goBR();
  else if (hash === '#book') goBook();
  else if (hash === '#pack') goPack();
  else if (netHash && netHash.screen === 'net'){
    const codeEl = $('netCode');
    if (codeEl && netHash.join) codeEl.value = netHash.join;   // #join=ABCD 深链预填房间码
    goNet();
    if (netHash.join && netAvailable() && Net.status() === 'online') netDoJoin();   // 已连接则直接加入
  }
  else goMenu();
  if (hash === '#br' || hash === '#book' || hash === '#pack' || (netHash && netHash.screen === 'net')) renderMenu();   // 深链进入时也刷新主菜单图鉴进度
}
return { init: init, show: show, goMenu: goMenu, goLevels: goLevels, goDiff: goDiff, goBR: goBR, goShop: goShop, goBook: goBook, goPack: goPack, goNet: goNet,
         refreshCoins: refreshCoins, toast: toastMsg,
         updateViewport: updateViewport, toggleFull: toggleFull, isTouchDevice: isTouchDevice };
})();
