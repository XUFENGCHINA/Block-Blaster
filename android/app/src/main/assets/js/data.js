/* ============================================================
   方块枪神 2D · 数据层
   敌人 / 外挂 / 难度档 / 障碍物 / 战役关卡 / 装备 / 皮肤 / 存档
   ============================================================ */
const CFG = { W: 960, H: 540, TAU: Math.PI * 2, ARENA: { l: 26, t: 26, r: 934, b: 514 } };

/* ---------------- 敌人 ---------------- */
const ENEMY = {
  chaser:  { name:'冲锋兵', size:30, hp:62,  speed:140, color:'#ff4d5e', dark:'#7d1220', score:12, contact:12 },
  shooter: { name:'枪手',   size:28, hp:48,  speed:106, color:'#b06cff', dark:'#3f1a76', score:18, contact:8,
             range:268, fireCd:1.55, bSpeed:330, bDmg:9 },
  splitter:{ name:'分裂体', size:36, hp:88,  speed:114, color:'#3ee06b', dark:'#12602c', score:22, contact:10, split:2 },
  tank:    { name:'重装',   size:52, hp:230, speed:66,  color:'#ff9f2e', dark:'#7c4104', score:45, contact:22 },
  mini:    { name:'碎片',   size:20, hp:22,  speed:180, color:'#8dffb8', dark:'#1c6338', score:6, contact:7 },
  sniper:  { name:'狙击手', size:26, hp:40,  speed:82,  color:'#4ad4ff', dark:'#0d4257', score:28, contact:8,
             range:430, fireCd:2.4, bSpeed:640, bDmg:16, charge:1.0 },
  bomber:  { name:'爆破兵', size:32, hp:72,  speed:124, color:'#ff6ad5', dark:'#731150', score:26, contact:10,
             boom:{ radius:118, dmg:26 } },
  boss:    { name:'方块之王', size:96, hp:1500, speed:54, color:'#ff3355', dark:'#57091a', score:400, contact:28,
             boss:true, range:330, fireCd:2.1, bSpeed:290, bDmg:11 }
};

/* ---------------- 怪物图鉴扩展：冲锋系 / 枪手系 ---------------- */
Object.assign(ENEMY, {
  chaser_fast:  { name:'迅捷冲锋兵', tier:'精锐', size:26, hp:46, speed:196, color:'#ff7a4d', dark:'#7a2a08', score:16, contact:10,
                  desc:'瘦小但极快，直线冲脸，别被它黏住。', where:'战役 · 难度 · 大逃杀' },
  chaser_armor: { name:'铁甲冲锋兵', tier:'精锐', size:38, hp:150, speed:112, color:'#c05a6a', dark:'#5c1a25', score:22, contact:15,
                  desc:'披着铁甲的冲锋兵，血厚移动慢。', where:'战役 · 难度 · 大逃杀' },
  chaser_rage:  { name:'狂暴冲锋兵', tier:'稀有', size:32, hp:110, speed:150, color:'#ff2d4d', dark:'#6b0a18', score:28, contact:16,
                  desc:'残血后移速暴涨，追击极其凶狠。', where:'战役 · 难度 · 大逃杀', traits:['berserk'] },
  chaser_blink: { name:'闪现刺客', tier:'史诗', size:28, hp:90, speed:170, color:'#b06cff', dark:'#3d1273', score:36, contact:18,
                  desc:'闪烁突进贴脸，出手前会有紫色闪光。', where:'难度 · 大逃杀', traits:['blink'] },
  chaser_shield: { name:'盾卫冲锋兵', tier:'稀有', size:36, hp:170, speed:118, color:'#4ad4ff', dark:'#0d4257', score:32, contact:14,
                  desc:'自带护盾，周期性挡下一次伤害。', where:'战役 · 难度 · 大逃杀', traits:['shield'] },
  chaser_regen: { name:'再生冲锋兵', tier:'稀有', size:34, hp:160, speed:124, color:'#3ee06b', dark:'#0f5227', score:30, contact:14,
                  desc:'持续自愈，打它要一次打疼。', where:'战役 · 难度 · 大逃杀', traits:['regen'] },
  chaser_giant: { name:'巨型冲锋兵', tier:'稀有', size:58, hp:300, speed:96, color:'#ff9f2e', dark:'#7c4104', score:44, contact:24,
                  desc:'大块头冲锋兵，撞一下很疼。', where:'战役 · 难度 · 大逃杀' },
  chaser_king:  { name:'冲锋之王', tier:'史诗', size:70, hp:430, speed:120, color:'#ff3355', dark:'#5a0a18', score:90, contact:26,
                  desc:'冲锋系首领，狂暴+自愈，血少了更危险。', where:'战役 · 难度 · 大逃杀', traits:['berserk','regen'] },
  shooter_rapid: { name:'速射枪手', tier:'精锐', size:26, hp:56, speed:118, color:'#c084ff', dark:'#3f1a76', score:24, contact:8,
                  desc:'射速很快但单发伤害低，别站着挨打。', where:'战役 · 难度 · 大逃杀', range:250, fireCd:0.75, bSpeed:360, bDmg:6 },
  shooter_heavy: { name:'重炮枪手', tier:'稀有', size:34, hp:96, speed:92, color:'#8a5cff', dark:'#2c1263', score:34, contact:10,
                  desc:'慢速重弹，一发入魂，注意走位。', where:'战役 · 难度 · 大逃杀', range:300, fireCd:2.0, bSpeed:420, bDmg:17 }
});
Object.assign(ENEMY, {
  shooter_aim:   { name:'神枪手', tier:'史诗', size:28, hp:88, speed:112, color:'#ffe066', dark:'#6b5300', score:40, contact:8,
                   desc:'预判你的走位开枪，几乎不会空枪。', where:'难度 · 大逃杀', range:330, fireCd:1.5, bSpeed:430, bDmg:13, traits:['aimbot'] },
  shooter_homing: { name:'追踪射手', tier:'史诗', size:30, hp:104, speed:104, color:'#ff6ad5', dark:'#731150', score:44, contact:9,
                   desc:'子弹会拐弯追着你跑，别指望绕柱躲。', where:'难度 · 大逃杀', range:290, fireCd:1.9, bSpeed:280, bDmg:11, traits:['homing'] },
  shooter_triple:{ name:'三连射手', tier:'稀有', size:32, hp:120, speed:100, color:'#a86bff', dark:'#2d1259', score:38, contact:10,
                   desc:'一次打出三发扇形弹幕。', where:'战役 · 难度 · 大逃杀', range:280, fireCd:1.9, bSpeed:330, bDmg:8, shots:3 },
  shooter_wall:  { name:'穿墙射手', tier:'史诗', size:30, hp:110, speed:106, color:'#7fe0ff', dark:'#0f4a63', score:46, contact:9,
                   desc:'子弹无视一切掩体，柱子后面也不安全。', where:'难度 · 大逃杀', range:320, fireCd:1.8, bSpeed:400, bDmg:12, traits:['wallhack'] },
  shooter_elite: { name:'精英枪手', tier:'精锐', size:30, hp:74, speed:116, color:'#9d7bff', dark:'#33206b', score:28, contact:9,
                   desc:'枪手中的老兵，血更厚射得更稳。', where:'战役 · 难度 · 大逃杀', range:280, fireCd:1.35, bSpeed:360, bDmg:10 },
  shooter_marksman:{ name:'精准射手', tier:'精锐', size:28, hp:78, speed:92, color:'#5cc8ff', dark:'#0b4a66', score:30, contact:9,
                   desc:'蓄力后打出一发高伤子弹，比狙击手更肉。', where:'战役 · 难度 · 大逃杀', range:400, fireCd:2.2, bSpeed:560, bDmg:14, charge:0.85 },
  shooter_sniper2:{ name:'精英狙击手', tier:'史诗', size:28, hp:64, speed:86, color:'#2ea8ff', dark:'#083a5c', score:52, contact:9,
                   desc:'蓄力更短的狙击手，伤害更高。', where:'难度 · 大逃杀', range:480, fireCd:2.0, bSpeed:760, bDmg:22, charge:0.7, traits:['aimbot'] },
  splitter_big:  { name:'巨型分裂体', tier:'稀有', size:52, hp:190, speed:104, color:'#31c95e', dark:'#12602c', score:42, contact:14,
                   desc:'死亡后裂成 3 个小碎片。', where:'战役 · 难度 · 大逃杀', split:3 },
  splitter_toxic:{ name:'剧毒分裂体', tier:'稀有', size:38, hp:120, speed:110, color:'#8ef04f', dark:'#2c5c0d', score:34, contact:12,
                   desc:'边打边回血的分裂体，越拖越难杀。', where:'战役 · 难度 · 大逃杀', split:2, traits:['regen'] },
  splitter_queen:{ name:'分裂女皇', tier:'传说', size:62, hp:360, speed:98, color:'#3ee06b', dark:'#0b3d1c', score:120, contact:18,
                   desc:'死亡时裂成 4 个碎片，还会不断召唤小怪。', where:'难度 · 大逃杀', split:4, traits:['summon'] },
  mini_fast:     { name:'狂暴碎片', tier:'精锐', size:18, hp:26, speed:250, color:'#a6ffcf', dark:'#1c6338', score:10, contact:9,
                   desc:'高速小碎片，成片冲上来很烦。', where:'战役 · 难度 · 大逃杀' },
  mini_boom:     { name:'自爆碎片', tier:'稀有', size:22, hp:34, speed:190, color:'#ff8f6a', dark:'#6b2208', score:14, contact:8,
                   desc:'贴到你就自爆，别让它近身。', where:'难度 · 大逃杀', boom:{ radius:76, dmg:16 } }
});
Object.assign(ENEMY, {
  tank_heavy:   { name:'超重装', tier:'史诗', size:64, hp:430, speed:60, color:'#ff8a1e', dark:'#6b3603', score:70, contact:26,
                  desc:'更厚更沉的装甲块，移动很慢但极难打死。', where:'战役 · 难度 · 大逃杀' },
  tank_fortress:{ name:'钢铁堡垒', tier:'传说', size:78, hp:720, speed:52, color:'#ffb03a', dark:'#5e3205', score:150, contact:30,
                  desc:'移动要塞，自带护盾，建议用暴击穿甲。', where:'难度 · 大逃杀', traits:['shield'] },
  tank_spike:   { name:'尖刺重装', tier:'稀有', size:54, hp:260, speed:70, color:'#ff6b2e', dark:'#6b2306', score:52, contact:32,
                  desc:'浑身尖刺，被它撞到掉血特别多。', where:'战役 · 难度 · 大逃杀' },
  tank_regen:   { name:'修复重装', tier:'史诗', size:56, hp:340, speed:64, color:'#6bd88f', dark:'#0f5227', score:76, contact:24,
                  desc:'边打边自我修复，拖久了就打不动了。', where:'难度 · 大逃杀', traits:['regen'] },
  tank_beast:   { name:'装甲巨兽', tier:'传说', size:86, hp:900, speed:58, color:'#ff5533', dark:'#5c1206', score:200, contact:34,
                  desc:'重装系首领，血厚且残血狂暴。', where:'难度 · 大逃杀', boss:true, range:300, fireCd:2.6, bSpeed:300, bDmg:14, traits:['berserk','regen'] },
  bomber_big:   { name:'大型爆破兵', tier:'稀有', size:44, hp:120, speed:110, color:'#ff5ab0', dark:'#6b0f45', score:40, contact:12,
                  desc:'爆炸范围更大，死亡时留下大坑。', where:'战役 · 难度 · 大逃杀', boom:{ radius:165, dmg:34 } },
  bomber_fast:  { name:'疾走爆破兵', tier:'稀有', size:30, hp:68, speed:196, color:'#ff9ad5', dark:'#6b1145', score:36, contact:10,
                  desc:'跑得飞快的爆破兵，跑慢一步就被炸。', where:'战役 · 难度 · 大逃杀', boom:{ radius:110, dmg:24 } },
  bomber_nuke:  { name:'核爆兵', tier:'史诗', size:48, hp:170, speed:96, color:'#ffd24a', dark:'#6b4b00', score:88, contact:14,
                  desc:'死亡即核爆，范围极大，务必远程点掉。', where:'难度 · 大逃杀', boom:{ radius:250, dmg:52 } },
  summoner:     { name:'召唤师', tier:'史诗', size:36, hp:150, speed:96, color:'#b06cff', dark:'#3d1273', score:78, contact:10,
                  desc:'不断召唤小碎片，优先秒掉它。', where:'难度 · 大逃杀', traits:['summon'] },
  necromancer:  { name:'亡灵法师', tier:'传说', size:40, hp:220, speed:90, color:'#8f6bff', dark:'#2a1266', score:130, contact:12,
                  desc:'召唤小弟 + 死后半血复活，非常难缠。', where:'难度 · 大逃杀', traits:['summon','revive'] },
  vampire:      { name:'吸血鬼', tier:'史诗', size:34, hp:140, speed:140, color:'#ff3d6e', dark:'#4a0418', score:72, contact:14,
                  desc:'打中你就会回血，别被它磨。', where:'难度 · 大逃杀', traits:['steal'] },
  healer:       { name:'治疗方块', tier:'稀有', size:32, hp:110, speed:100, color:'#7dffb1', dark:'#12633a', score:44, contact:8,
                  desc:'自带强力再生，越打越精神。', where:'战役 · 难度 · 大逃杀', traits:['regen'] }
});
Object.assign(ENEMY, {
  juggernaut:   { name:'主宰', tier:'传说', size:90, hp:1100, speed:60, color:'#ff2d55', dark:'#5a0a1c', score:260, contact:36,
                  desc:'终极装甲块，残血狂暴 + 自带护盾。', where:'难度 · 大逃杀', boss:true, range:320, fireCd:2.4, bSpeed:320, bDmg:15, traits:['berserk','shield'] },
  warlord:      { name:'战争领主', tier:'传说', size:88, hp:1000, speed:66, color:'#ff7a2e', dark:'#5c2606', score:240, contact:32,
                  desc:'召唤小弟，死后还会半血复活一次。', where:'难度 · 大逃杀', boss:true, range:300, fireCd:2.2, bSpeed:300, bDmg:13, traits:['summon','revive'] },
  boss_ice:     { name:'寒霜之王', tier:'传说', size:92, hp:1300, speed:52, color:'#8fe6ff', dark:'#0e4a63', score:280, contact:26,
                  desc:'远程冰弹覆盖，护盾常驻。', where:'难度 · 大逃杀', boss:true, range:360, fireCd:1.9, bSpeed:340, bDmg:12, shots:3, traits:['shield'] },
  boss_lava:    { name:'熔岩之王', tier:'传说', size:94, hp:1400, speed:56, color:'#ff6a1e', dark:'#5c1a04', score:300, contact:30,
                  desc:'死亡时会引发大爆炸，残血狂暴。', where:'难度 · 大逃杀', boss:true, range:300, fireCd:2.0, bSpeed:310, bDmg:14, boom:{ radius:260, dmg:60 }, traits:['berserk'] },
  boss_void:    { name:'虚空之王', tier:'传说', size:96, hp:1500, speed:58, color:'#a06bff', dark:'#2c0f5c', score:320, contact:28,
                  desc:'追踪弹 + 穿墙弹，躲哪里都会被打到。', where:'难度 · 大逃杀', boss:true, range:340, fireCd:2.0, bSpeed:300, bDmg:13, traits:['homing','wallhack'] },
  elite_champion:{ name:'冠军方块', tier:'史诗', size:52, hp:400, speed:120, color:'#ffd24a', dark:'#6b4b00', score:110, contact:22,
                  desc:'竞技场冠军，倒下后会半血重新站起来。', where:'难度 · 大逃杀', traits:['revive'] },
  mimic:        { name:'拟态方块', tier:'稀有', size:34, hp:130, speed:130, color:'#7fe0c0', dark:'#0f5244', score:48, contact:12,
                  desc:'忽闪忽现还会自愈，很难抓住。', where:'难度 · 大逃杀', traits:['blink','regen'] },
  assassin:     { name:'暗影刺客', tier:'史诗', size:30, hp:120, speed:210, color:'#7a5cff', dark:'#221064', score:82, contact:22,
                  desc:'瞬间闪现到你身后，残血时更快。', where:'难度 · 大逃杀', traits:['blink','berserk'] }
});

/* ---------------- 怪物特性（图鉴用，与难度档外挂实现共用） ---------------- */
const TRAITS = {
  regen:    { icon:'💊', name:'自愈',   desc:'每秒回复 1.5% 最大生命' },
  shield:   { icon:'🛡️', name:'护盾',   desc:'每 7 秒获得一层可挡 1 次伤害的护盾' },
  blink:    { icon:'✨', name:'瞬移',   desc:'每 4 秒闪现一段距离贴脸' },
  homing:   { icon:'🧲', name:'追踪弹', desc:'子弹会拐弯追着你跑' },
  wallhack: { icon:'👻', name:'穿墙',   desc:'子弹无视障碍物' },
  berserk:  { icon:'🔥', name:'狂暴',   desc:'残血时移速与射速 +40%' },
  revive:   { icon:'🔁', name:'复活',   desc:'死亡后以 50% 血量复活一次' },
  aimbot:   { icon:'🎯', name:'预判',   desc:'子弹预判走位，几乎不空枪' },
  summon:   { icon:'🥚', name:'召唤',   desc:'定期召唤小怪助战' },
  steal:    { icon:'🩸', name:'吸血',   desc:'命中玩家时回复自身生命' }
};

/* 早期 8 只怪补上图鉴字段 */
const ENEMY_META = {
  chaser:   { tier:'普通', desc:'最基础的方块敌人，直线冲过来用身体撞你。', where:'战役 · 难度 · 大逃杀' },
  shooter:  { tier:'普通', desc:'保持距离环绕走位，蓄力后开枪。', where:'战役 · 难度 · 大逃杀' },
  splitter: { tier:'普通', desc:'死亡后裂成 2 个小碎片，别在狭路里杀它。', where:'战役 · 难度 · 大逃杀' },
  tank:     { tier:'稀有', desc:'血厚移动慢的肉盾，撞人很疼。', where:'战役 · 难度 · 大逃杀' },
  mini:     { tier:'普通', desc:'分裂出来的小碎片，速度快但很脆。', where:'战役 · 难度 · 大逃杀' },
  sniper:   { tier:'稀有', desc:'蓄力一秒后射出极快的子弹。', where:'战役 · 难度 · 大逃杀' },
  bomber:   { tier:'精锐', desc:'死亡时会炸开一片，别贴脸杀。', where:'战役 · 难度 · 大逃杀' },
  boss:     { tier:'传说', desc:'第 8 关的最终 BOSS，召唤小弟并且三连发。', where:'战役 · 难度 · 大逃杀', boss:true }
};
for (const k in ENEMY_META){
  const e = ENEMY[k], m = ENEMY_META[k];
  if (!e) continue;
  if (!e.tier) e.tier = m.tier;
  if (!e.desc) e.desc = m.desc;
  if (!e.where) e.where = m.where;
  if (!e.traits) e.traits = [];
  if (m.boss) e.boss = true;
}
/* ---------------- 外挂（难度档给敌人开的挂） ---------------- */
const CHEATS = {
  speed:    { icon:'⚡', name:'加速挂',   desc:'敌人移动速度 +25%' },
  aimbot:   { icon:'🎯', name:'透视锁头', desc:'子弹预判走位，几乎不会空枪' },
  regen:    { icon:'💊', name:'无限回血', desc:'每秒回复 1.5% 最大生命' },
  homing:   { icon:'🧲', name:'追踪弹',   desc:'敌方子弹会拐弯追着你跑' },
  wallhack: { icon:'👻', name:'穿墙挂',   desc:'敌方子弹无视所有障碍物' },
  blink:    { icon:'✨', name:'瞬移挂',   desc:'每 4 秒闪光瞬移一段距离贴脸' },
  berserk:  { icon:'🔥', name:'狂暴外挂', desc:'残血时移速与射速 +40%，越打越凶' },
  revive:   { icon:'🔁', name:'复活挂',   desc:'大型敌人死亡后 50% 血量复活一次' },
  shield:   { icon:'🛡️', name:'护盾挂',   desc:'每 7 秒生成可挡 1 次伤害的护盾' }
};

/* ---------------- 难度档（无限关卡） ---------------- */
const DIFFICULTIES = [
  { id:1, name:'第一档 · 新兵', tag:'无外挂', color:'#3ee06b',
    baseCount:6, countStep:10, hpStep:0,    cheatKeys:[], coinMul:1,   scoreMul:1,
    brief:'每波敌人 +10 只，敌人不开任何外挂，纯拼枪法与走位。' },
  { id:2, name:'第二档 · 外挂初现', tag:'3 项外挂', color:'#ffd24a',
    baseCount:6, countStep:10, hpStep:0.10, cheatKeys:['speed','aimbot','regen'], coinMul:1.6, scoreMul:1.3,
    brief:'每波敌人 +10 只，每过一波全体敌人血量 +10%（有过渡提醒）。' },
  { id:3, name:'第三档 · 外挂狂魔', tag:'6 项外挂', color:'#ff8a3d',
    baseCount:6, countStep:20, hpStep:0.20, cheatKeys:['speed','aimbot','regen','homing','wallhack','blink'], coinMul:2.4, scoreMul:1.8,
    brief:'每波敌人 +20 只，每过一波全体敌人血量 +20%。' },
  { id:4, name:'第四档 · 地狱模式', tag:'9 项外挂 · 双倍', color:'#ff3355',
    baseCount:6, countStep:40, hpStep:0.40, cheatKeys:['speed','aimbot','regen','homing','wallhack','blink','berserk','revive','shield'],
    coinMul:4, scoreMul:3,
    brief:'第三档的双倍强度：每波敌人 +40 只，每过一波血量 +40%，外挂全开。' }
];

/* ---------------- 障碍物布局 ---------------- */
const OBSTACLES = {
  none:     [],
  pillars4: [ {x:238,y:118,w:66,h:66}, {x:656,y:118,w:66,h:66}, {x:238,y:356,w:66,h:66}, {x:656,y:356,w:66,h:66} ],
  cross:    [ {x:448,y:56,w:64,h:150}, {x:448,y:334,w:64,h:150}, {x:104,y:238,w:230,h:64}, {x:626,y:238,w:230,h:64} ],
  corners:  [ {x:96,y:96,w:168,h:46}, {x:696,y:96,w:168,h:46}, {x:96,y:398,w:168,h:46}, {x:696,y:398,w:168,h:46} ],
  corridor: [ {x:186,y:26,w:46,h:196}, {x:186,y:318,w:46,h:196}, {x:404,y:150,w:300,h:44}, {x:404,y:346,w:300,h:44} ],
  grid:     [ {x:186,y:110,w:44,h:120}, {x:186,y:310,w:44,h:120}, {x:458,y:60,w:44,h:120},
              {x:458,y:360,w:44,h:120}, {x:730,y:110,w:44,h:120}, {x:730,y:310,w:44,h:120} ],
  rooms:    [ {x:120,y:80,w:150,h:44}, {x:120,y:416,w:150,h:44}, {x:690,y:80,w:150,h:44}, {x:690,y:416,w:150,h:44},
              {x:400,y:150,w:160,h:40}, {x:400,y:350,w:160,h:40} ],
  arena:    [ {x:110,y:110,w:86,h:86}, {x:764,y:110,w:86,h:86}, {x:110,y:344,w:86,h:86}, {x:764,y:344,w:86,h:86} ],
  bossroom: [ {x:60,y:230,w:130,h:60}, {x:770,y:230,w:130,h:60}, {x:430,y:60,w:46,h:120}, {x:484,y:360,w:46,h:120} ]
};

/* ---------------- 战役关卡 ---------------- */
/* waves: [{ n:[['类型',数量], ...], hp:1.0 }]  stars:[3星,2星的剩余血量百分比] */
const LEVELS = [
  { id:1, name:'训练场', sub:'新兵第一课', obs:'none', starHp:[0.7,0.35],
    tip:'先熟悉走位与换弹节奏',
    waves:[ { n:[['chaser',4]] }, { n:[['chaser',7]] } ] },

  { id:2, name:'四方广场', sub:'柱子后面躲好', obs:'pillars4', starHp:[0.7,0.35],
    tip:'障碍物能挡子弹，善用掩体',
    waves:[ { n:[['chaser',6],['shooter',2]] }, { n:[['chaser',8],['shooter',3]] } ] },

  { id:3, name:'十字回廊', sub:'别被交叉火力夹住', obs:'cross', starHp:[0.7,0.35],
    tip:'紫色枪手会保持距离，优先点掉',
    waves:[ { n:[['chaser',7],['shooter',4],['chaser_fast',3]] }, { n:[['chaser',6],['shooter',4],['tank',1],['chaser_fast',4]] } ] },

  { id:4, name:'分裂巢穴', sub:'打碎它们会更多', obs:'corners', starHp:[0.7,0.35],
    tip:'绿色分裂体死后会裂成两个碎片',
    waves:[ { n:[['splitter',6],['chaser',6],['splitter_toxic',2]] }, { n:[['splitter',8],['shooter',4],['mini_fast',5]] } ] },

  { id:5, name:'重装禁区', sub:'橙色肉盾来了', obs:'corridor', starHp:[0.7,0.35],
    tip:'重装血厚，暴击子弹能穿透它的身体',
    waves:[ { n:[['tank',2],['chaser',8],['tank_spike',2]] }, { n:[['tank',3],['shooter',6],['tank_heavy',1]] } ] },

  { id:6, name:'火力网', sub:'狙击手已就位', obs:'grid', starHp:[0.7,0.35],
    tip:'蓝色狙击手蓄力后子弹极快，别站直线',
    waves:[ { n:[['shooter',8],['chaser',6],['shooter_rapid',3]] }, { n:[['shooter',10],['sniper',3],['chaser',8],['shooter_marksman',2]] } ] },

  { id:7, name:'爆破工厂', sub:'死亡就是爆炸', obs:'rooms', starHp:[0.7,0.35],
    tip:'粉色爆破兵死亡会炸开，别贴脸杀',
    waves:[ { n:[['bomber',6],['chaser',8],['bomber_fast',3]] }, { n:[['bomber',8],['tank',2],['sniper',3],['bomber_big',2]] } ] },

  { id:8, name:'方块之王', sub:'最终决战', obs:'bossroom', starHp:[0.6,0.3],
    tip:'BOSS 会召唤小弟，清完小弟再打本体',
    waves:[ { n:[['chaser',8],['shooter',4],['tank',2],['elite_champion',1],['shooter_elite',2]] }, { n:[['boss',1],['tank',2],['shooter',4],['chaser_king',1]], hp:1.0, boss:true } ] }
];

/* ---------------- 金币规则 ----------------
   1) 击杀敌人不掉金币（敌军身上没有钱）
   2) 战役关卡：只有【首次通关】才发金币，按每一波结算给到手；
      重复挑战（第 2 次及以后）本关一律 0 金币，星级照常记录
   3) 难度关卡（无限）：按每一波结算，并乘档位倍率（无限模式唯一收入来源） */
function waveCoinReward(o){
  if (o.mode === 'campaign'){
    if (!o.first) return 0;                                  // 重复挑战：不给金币
    return Math.round(30 + Math.min(o.levelId, 12) * 12 + Math.floor(o.levelId / 10) * 6 + o.wave * 8);     // 首次通关：每波金币
  }
  return Math.round((15 + o.wave * 10) * (o.mul || 1));
}
function levelFirstClearCoins(lv){ return levelWaveCoins(lv); }
function levelWaveCoins(lv){
  let sum = 0;
  for (let i = 1; i <= lv.waves.length; i++) sum += waveCoinReward({ mode: 'campaign', levelId: lv.id, wave: i, first: true });
  return sum;
}
/* ---------------- 装备升级 ---------------- */
const UPGRADES = [
  { id:'dmg',    icon:'🔫', name:'手枪伤害', desc:'每级 +3 点子弹伤害',        max:5, cost:[100,190,300,450,650] },
  { id:'rate',   icon:'⏱️', name:'扳机改造', desc:'每级射击间隔 -8%',          max:5, cost:[120,220,340,500,700] },
  { id:'mag',    icon:'📦', name:'扩容弹匣', desc:'每级弹匣 +2 发',            max:5, cost:[90,170,280,420,600] },
  { id:'reload', icon:'🔄', name:'快速换弹', desc:'每级换弹时间 -10%',         max:4, cost:[110,200,330,480] },
  { id:'crit',   icon:'🎯', name:'精准瞄具', desc:'每级暴击率 +3%',            max:5, cost:[140,240,380,540,760] },
  { id:'speed',  icon:'👟', name:'轻量装具', desc:'每级移动速度 +4%',          max:5, cost:[100,180,290,430,600] },
  { id:'hp',     icon:'🛡️', name:'防弹背心', desc:'每级生命上限 +15',          max:5, cost:[130,230,350,510,720] },
  { id:'dash',   icon:'💨', name:'冲刺模块', desc:'每级冲刺冷却 -10%',         max:4, cost:[150,260,400,560] }
];

/* ---------------- 皮肤（每个皮肤都有专属技能） ---------------- */
const SKINS = [
  { id:'classic', name:'经典青', price:0, color:'#35e0f5', dark:'#0a2c3a',
    skill:'稳如磐石', skillDesc:'受到的伤害降低 10%（新手友好）',
    mods(st){ st.dmgTaken *= 0.9; } },

  { id:'blaze', name:'烈焰红', price:600, color:'#ff5b4a', dark:'#4a1009',
    skill:'狂热', skillDesc:'每次击杀射速 +2%（最多 +20%），被击中后清零',
    mods(st){ st.rage = true; } },

  { id:'phantom', name:'幽灵紫', price:1000, color:'#a86bff', dark:'#2d1259',
    skill:'相位冲刺', skillDesc:'冲刺冷却 -35%，冲刺穿过的敌人受到 30 点伤害',
    mods(st){ st.dashCd *= 0.65; st.dashDamage = 30; } },

  { id:'emerald', name:'翡翠绿', price:1400, color:'#3ee06b', dark:'#0d3a1d',
    skill:'草木之息', skillDesc:'每清一波回复 25 点生命，血包效果 +50%',
    mods(st){ st.waveHeal += 25; st.healMul *= 1.5; } },

  { id:'gold', name:'暗金', price:1900, color:'#ffc23d', dark:'#4a3405',
    skill:'暴击大师', skillDesc:'暴击率 +10%，暴击伤害提高 25%',
    mods(st){ st.critChance += 0.10; st.critMul *= 1.25; } },

  { id:'frost', name:'霜白', price:2400, color:'#9fe9ff', dark:'#14415c',
    skill:'冰霜弹', skillDesc:'子弹有 30% 概率冻住敌人，减速 40% 持续 1.6 秒',
    mods(st){ st.frost = 0.30; } },

  { id:'lava', name:'熔岩橙', price:3000, color:'#ff7a2e', dark:'#4d1c05',
    skill:'熔岩爆裂', skillDesc:'暴击击杀会引发爆炸，对周围敌人造成 40 点伤害',
    mods(st){ st.critBoom = true; } },

  { id:'void', name:'血月黑', price:3800, color:'#ff3d6e', dark:'#2a0413',
    skill:'嗜血', skillDesc:'每次击杀回复 2 点生命，越战越勇',
    mods(st){ st.lifesteal = 2; } }
];

/* ---------------- 武器（大逃杀战利品） ---------------- */
const WEAPONS = {
  pistol_s: { name:'小手枪',     kind:'gun',   dmg:20, rate:0.24, mag:10, reload:0.95, spread:0.05,  bspeed:1000, rarity:'普通' },
  pistol:   { name:'手枪',       kind:'gun',   dmg:25, rate:0.20, mag:12, reload:1.00, spread:0.035, bspeed:1000, rarity:'普通' },
  pistol_r: { name:'速射手枪',   kind:'gun',   dmg:18, rate:0.12, mag:16, reload:1.05, spread:0.06,  bspeed:1050, rarity:'精良' },
  pistol_h: { name:'大口径手枪', kind:'gun',   dmg:38, rate:0.30, mag:8,  reload:1.15, spread:0.03,  bspeed:1150, rarity:'稀有' },
  knife:    { name:'匕首',       kind:'melee', dmg:52, rate:0.38, range:64, arc:1.35, rarity:'普通' }
};
const LOOT_POOL = [['pistol',26],['knife',24],['pistol_s',20],['pistol_r',18],['pistol_h',12]];
function randomWeapon(){
  let sum = 0; for (const q of LOOT_POOL) sum += q[1];
  let r = Math.random() * sum;
  for (const q of LOOT_POOL){ r -= q[1]; if (r <= 0) return q[0]; }
  return 'pistol';
}
function getWeapon(id){ return WEAPONS[id] || WEAPONS.pistol_s; }
/* ---------------- 大逃杀地图 ---------------- */
const BR_MAPS = [
  { id:1, name:'中型战场', size:'1800 x 1200', w:1800, h:1200, enemies:24, houses:10, reward:320,
    desc:'节奏最快，一局约 4 分钟，适合手机上玩' },
  { id:2, name:'大型战场', size:'2600 x 1700', w:2600, h:1700, enemies:38, houses:15, reward:600,
    desc:'标准大逃杀，房屋多、敌人散布广，要靠小地图找路' },
  { id:3, name:'超大地图', size:'3400 x 2200', w:3400, h:2200, enemies:56, houses:20, reward:1100,
    desc:'敌人非常多但很分散，捡枪探索加上逐个清剿，最耐玩' }
];
function getBRMap(id){ for (const m of BR_MAPS) if (m.id === id) return m; return BR_MAPS[0]; }
/* ---------------- 投放表：保证 50 种怪都有出场途径 ---------------- */
const ENDLESS_WAVES = [
  { w:1,  list:['chaser','chaser_fast','shooter','mini','mini_fast'] },
  { w:2,  list:['shooter_rapid','splitter','chaser_armor','bomber','shooter_elite'] },
  { w:3,  list:['splitter_toxic','chaser_rage','sniper','healer','bomber_fast'] },
  { w:4,  list:['tank','chaser_shield','tank_spike','bomber_big','mini_boom'] },
  { w:5,  list:['chaser_regen','chaser_giant','shooter_heavy','mimic','shooter_marksman'] },
  { w:6,  list:['tank_heavy','splitter_big','shooter_triple','elite_champion'] },
  { w:8,  list:['chaser_blink','shooter_aim','shooter_homing','tank_regen','vampire','summoner'] },
  { w:10, list:['shooter_wall','bomber_nuke','assassin','chaser_king'] },
  { w:12, list:['shooter_sniper2','splitter_queen','tank_fortress','necromancer'] }
];
const ENDLESS_BOSSES = ['boss','tank_beast','boss_ice','boss_lava','juggernaut','warlord','boss_void'];
const BR_POOLS = {
  1: [['chaser',22],['chaser_fast',12],['shooter',18],['shooter_rapid',10],['splitter',10],['bomber',8],
      ['mini_fast',8],['chaser_armor',7],['sniper',5],['healer',4],['mini',6],['bomber_fast',5]],
  2: [['chaser',16],['chaser_rage',9],['chaser_shield',8],['shooter',12],['shooter_elite',10],['shooter_heavy',7],
      ['shooter_triple',6],['splitter_big',7],['splitter_toxic',6],['tank',7],['tank_spike',5],['bomber_big',5],
      ['mini_boom',5],['mini_fast',5],['mimic',4],['shooter_marksman',6],['chaser_giant',4],['chaser_regen',4],['sniper',4]],
  3: [['chaser',10],['chaser_blink',6],['chaser_king',2],['assassin',4],['shooter_aim',5],['shooter_homing',5],
      ['shooter_wall',5],['shooter_sniper2',4],['splitter_queen',2],['tank_heavy',4],['tank_regen',4],
      ['tank_fortress',2],['bomber_nuke',3],['vampire',4],['summoner',4],['necromancer',2],
      ['juggernaut',1],['boss_ice',1],['boss_lava',1],['boss_void',1],['elite_champion',3],['mimic',3],
      ['healer',3],['chaser_fast',6],['shooter',8],['tank',4],['splitter',5]]
};
/* ---------------- 玩家基础数值 ---------------- */
const BASE = { hp:100, speed:276, damage:25, fireRate:0.2, mag:12, reload:1.0, critChance:0.16, critMul:2, dashCd:1.15 };

function buildStats(){
  const u = Save.data.upgrades;
  const st = {
    maxHp: BASE.hp + 15 * (u.hp || 0),
    speed: BASE.speed * (1 + 0.04 * (u.speed || 0)),
    damage: BASE.damage + 3 * (u.dmg || 0),
    fireRate: BASE.fireRate * Math.pow(0.92, u.rate || 0),
    mag: BASE.mag + 2 * (u.mag || 0),
    reload: BASE.reload * Math.pow(0.90, u.reload || 0),
    critChance: BASE.critChance + 0.03 * (u.crit || 0),
    critMul: BASE.critMul,
    dashCd: BASE.dashCd * Math.pow(0.90, u.dash || 0),
    rateMul: Math.pow(0.92, u.rate || 0), reloadMul: Math.pow(0.90, u.reload || 0), magAdd: 2 * (u.mag || 0), dmgAdd: 3 * (u.dmg || 0),
    dmgTaken: 1, waveHeal: 15, healMul: 1, rage: false, dashDamage: 0,
    frost: 0, critBoom: false, lifesteal: 0,
    color: '#35e0f5', dark: '#0a2c3a', skin: Save.data.skin
  };
  const skin = getSkin(Save.data.skin);
  if (skin){
    st.color = skin.color; st.dark = skin.dark;   // 皮肤颜色真正应用到角色
    if (skin.mods) skin.mods(st);
  }
  return st;
}
function getSkin(id){ for (const s of SKINS) if (s.id === id) return s; return SKINS[0]; }
function getUpgrade(id){ for (const u of UPGRADES) if (u.id === id) return u; return null; }

/* ---------------- 材质包：校验与规范化 ---------------- */
const PACK_MAX_BYTES = 4 * 1024 * 1024;
const PACK_TOO_BIG = '材质包过大（建议图片压缩到 1MB 内，单个存档上限 4MB）';
const PACK_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\))$/;
function packColor(v, fb){
  const c = v == null ? '' : String(v).trim();
  return PACK_COLOR_RE.test(c) ? c : fb;
}
function packImage(v){
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return /^data:image\//i.test(s) ? s : '';
}
function normalizePack(obj){
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok:false, err:'材质包格式不对：根节点必须是 JSON 对象' };
  if (obj.format != null && Number(obj.format) !== 1) return { ok:false, err:'不支持的材质包格式版本（format 应为 1）' };
  const name = String(obj.name == null ? '' : obj.name).trim();
  if (!name) return { ok:false, err:'材质包缺少 name（名称）' };
  if (!Array.isArray(obj.styles) || obj.styles.length === 0) return { ok:false, err:'材质包缺少 styles（至少需要 1 套角色样式）' };
  const styles = [];
  for (let i = 0; i < obj.styles.length; i++){
    const s = obj.styles[i];
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok:false, err:'styles[' + i + '] 必须是对象' };
    const sid = String(s.id == null ? '' : s.id).trim();
    const sname = String(s.name == null ? '' : s.name).trim();
    if (!sid) return { ok:false, err:'styles[' + i + '] 缺少 id' };
    if (!sname) return { ok:false, err:'styles[' + i + '] 缺少 name' };
    for (let j = 0; j < styles.length; j++) if (styles[j].id === sid) return { ok:false, err:'角色样式 id 重复：' + sid };
    const simg = packImage(s.image);
    if (simg.length > PACK_MAX_BYTES) return { ok:false, err:PACK_TOO_BIG };
    styles.push({
      id: sid.slice(0, 40),
      name: sname.slice(0, 40),
      color: packColor(s.color, '#35e0f5'),
      dark: packColor(s.dark, '#0a2c3a'),
      image: simg,
      glow: !!s.glow
    });
  }
  let panels = null;
  if (obj.panels && typeof obj.panels === 'object' && !Array.isArray(obj.panels)){
    const mode = obj.panels.mode == null ? 'keep' : String(obj.panels.mode);
    if (['hide', 'replace', 'keep'].indexOf(mode) < 0) return { ok:false, err:'panels.mode 只能是 hide / replace / keep' };
    const html = obj.panels.html == null ? '' : String(obj.panels.html);
    const image = packImage(obj.panels.image);
    if (image.length > PACK_MAX_BYTES) return { ok:false, err:PACK_TOO_BIG };
    if (mode === 'replace' && !html && !image) return { ok:false, err:'panels.mode=replace 需要提供 html 或 image 内容' };
    panels = { mode: mode, html: html.slice(0, 20000), image: image };
  }
  const background = packImage(obj.background);
  if (background.length > PACK_MAX_BYTES) return { ok:false, err:PACK_TOO_BIG };
  return { ok:true, pack: {
    format: 1,
    name: name.slice(0, 60),
    author: String(obj.author == null ? '' : obj.author).trim().slice(0, 60) || '匿名',
    version: String(obj.version == null ? '1.0' : obj.version).trim().slice(0, 20) || '1.0',
    background: background,
    panels: panels,
    styles: styles,
    installedAt: Date.now()
  } };
}

/* ---------------- 存档 ---------------- */
const SAVE_KEY = 'bg2d_save_v2';
const Save = {
  data: null,
  defaults(){
    return { coins:0, best:0, upgrades:{}, skins:['classic'], skin:'classic', levels:{}, endless:{}, br:{}, dex:{}, packs:{}, packActive:null, characterStyle:null,
             kills:0, runs:0, muted:false };
  },
  load(){
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch(e){ d = null; }
    if (!d) d = this.defaults();
    const def = this.defaults();
    for (const k in def) if (d[k] === undefined) d[k] = def[k];
    if (!d.skins || !d.skins.length) d.skins = ['classic'];
    if (!d.upgrades) d.upgrades = {};
    this.data = d;
    try { const old = +localStorage.getItem('bg2d_best') || 0; if (old > this.data.best) this.data.best = old; } catch(e){}
    return this.data;
  },
  save(){ try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch(e){} },
  addCoins(n){ this.data.coins = Math.max(0, Math.round(this.data.coins + n)); this.save(); },
  spend(n){ if (this.data.coins < n) return false; this.data.coins -= n; this.save(); return true; },
  lv(id){ return this.data.upgrades[id] || 0; },
  buyUpgrade(id){
    const u = getUpgrade(id); if (!u) return 'none';
    const lv = this.lv(id);
    if (lv >= u.max) return 'max';
    const cost = u.cost[lv];
    if (!this.spend(cost)) return 'poor';
    this.data.upgrades[id] = lv + 1;
    this.save();
    return 'ok';
  },
  hasSkin(id){ return this.data.skins.indexOf(id) >= 0; },
  buySkin(id){
    const s = getSkin(id);
    if (this.hasSkin(id)) return 'owned';
    if (!this.spend(s.price)) return 'poor';
    this.data.skins.push(id);
    this.data.skin = id;
    this.save();
    return 'ok';
  },
  equipSkin(id){ if (!this.hasSkin(id)) return false; this.data.skin = id; this.save(); return true; },
  levelStars(id){ const l = this.data.levels[id]; return l ? l.stars : 0; },
  setLevel(id, stars){
    const cur = this.data.levels[id];
    if (!cur || stars > cur.stars) this.data.levels[id] = { stars: stars };
    this.save();
  },
  levelUnlocked(i){ return i === 0 || this.levelStars(LEVELS[i - 1].id) > 0; },
  totalStars(){ let n = 0; for (const k in this.data.levels) n += this.data.levels[k].stars || 0; return n; },
  dexAdd(key){
    if (!key) return 0;
    const d = this.data.dex || (this.data.dex = {});
    d[key] = (d[key] || 0) + 1;
    this.save();
    return d[key];
  },
  dexCount(key){ const d = this.data.dex || {}; return d[key] || 0; },
  dexTotal(){ const d = this.data.dex || {}; let n = 0; for (const k in d) if (d[k] > 0 && ENEMY[k]) n++; return n; },
  dexKinds(){ let n = 0; for (const k in ENEMY) n++; return n; },  brWins(id){ const b = this.data.br || (this.data.br = {}); return b[id] || 0; },
  addBRWin(id){ const b = this.data.br || (this.data.br = {}); b[id] = (b[id] || 0) + 1; this.save(); },
  brFirstWin(id){ return this.brWins(id) === 0; },  endlessBest(tier){ return this.data.endless[tier] || 0; },
  setEndlessBest(tier, wave){ if (wave > this.endlessBest(tier)){ this.data.endless[tier] = wave; this.save(); } },
  /* ---------------- 材质包 ---------------- */
  packs(){ return this.data.packs || (this.data.packs = {}); },
  packList(){
    const m = this.packs(), out = [];
    for (const k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out.push(m[k]);
    out.sort(function(a, b){ return (b.installedAt || 0) - (a.installedAt || 0); });
    return out;
  },
  activePack(){
    const m = this.packs();
    return (this.data.packActive && m[this.data.packActive]) ? m[this.data.packActive] : null;
  },
  setActivePack(id){
    if (id == null || id === ''){
      this.data.packActive = null; this.data.characterStyle = null; this.save(); return true;
    }
    const m = this.packs();
    if (!m[id]) return false;
    this.data.packActive = id;
    const styles = m[id].styles || [];
    let found = false;
    for (let i = 0; i < styles.length; i++) if (styles[i].id === this.data.characterStyle){ found = true; break; }
    if (!found) this.data.characterStyle = styles.length ? styles[0].id : null;
    this.save();
    return true;
  },
  removePack(id){
    const m = this.packs();
    if (!m[id]) return false;
    delete m[id];
    if (this.data.packActive === id){ this.data.packActive = null; this.data.characterStyle = null; }
    this.save();
    return true;
  },
  setCharacterStyle(styleId){
    const p = this.activePack();
    if (!p || !p.styles) return false;
    for (let i = 0; i < p.styles.length; i++){
      if (p.styles[i].id === styleId){ this.data.characterStyle = styleId; this.save(); return true; }
    }
    return false;
  },
  characterStyle(){
    const p = this.activePack();
    if (!p || !p.styles || !p.styles.length) return null;
    for (let i = 0; i < p.styles.length; i++) if (p.styles[i].id === this.data.characterStyle) return p.styles[i];
    return p.styles[0];
  },
  characterStyleId(){
    const s = this.characterStyle();
    return s ? s.id : null;
  },
  installPack(obj){
    const v = normalizePack(obj);
    if (!v.ok) return v;
    const pack = v.pack, m = this.packs();
    const id = pack.name + '@' + pack.version;
    const old = m[id];
    m[id] = pack;
    try {
      const json = JSON.stringify(this.data);
      if (json.length > PACK_MAX_BYTES) throw new Error('too-big');
      localStorage.setItem(SAVE_KEY, json);
    } catch(e){
      if (old) m[id] = old; else delete m[id];
      return { ok:false, err:PACK_TOO_BIG };
    }
    return { ok:true, id: id, name: pack.name };
  }
};
Save.load();
