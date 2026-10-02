/* ============================================================
   战役关卡 9~100 关：程序化生成（需在 data.js 之后加载）
   关卡 = 主题名 + 波次 + 地形 + 敌人池（按关数分 5 个阶段）
   ============================================================ */
(function genLevels(){
  var A = '废土,锈铁,霓虹,熔炉,霜原,虚空,磁暴,钢铁,幽影,赤沙,焦土,黑潮'.split(',');
  var B = '前哨,工厂,回廊,巢穴,禁区,深渊,竞技场,试验场'.split(',');
  var OBS = 'pillars4,corners,cross,grid,rooms,corridor,arena,none'.split(',');
  var E = 'chaser,chaser_fast,shooter,shooter_rapid,splitter,mini_fast,chaser_armor,bomber,shooter_elite'.split(',');
  var M = 'sniper,shooter_marksman,splitter_toxic,tank,tank_spike,bomber_fast,chaser_rage,chaser_shield,healer,mimic'.split(',');
  var L = 'chaser_blink,shooter_triple,shooter_heavy,tank_heavy,bomber_big,vampire,summoner,chaser_giant,chaser_regen,shooter_aim,shooter_homing,mini_boom'.split(',');
  var F = 'chaser_king,assassin,shooter_wall,bomber_nuke,tank_regen,splitter_big,necromancer,elite_champion,shooter_sniper2,tank_fortress,splitter_queen'.split(',');
  var BS = 'boss,tank_beast,boss_ice,boss_lava,juggernaut,warlord,boss_void'.split(',');
  var TP = '敌人四面刷出，别被夹住;掩体挡子弹，绕着柱子打;先清远程怪再处理近战;炸弹兵死亡会炸，远程点掉;分裂体要一次打死;BOSS 波先清小弟再打本体;小心自爆碎片贴脸;这关有会瞬移的怪;带护盾的怪要连续输出;召唤师优先秒掉'.split(';');
  for (var n = 9; n <= 100; n++){
    var stage = n < 20 ? 0 : n < 40 ? 1 : n < 65 ? 2 : n < 90 ? 3 : 4;
    var pool = E.concat(stage >= 1 ? M : [], stage >= 2 ? L : [], stage >= 3 ? F : []);
    var isBoss = n % 10 === 0, wnum = isBoss ? 2 : (n % 5 === 0 ? 3 : 2);
    var budget = Math.round(6 + n * 0.42);
    var hp = +(1 + (n - 9) * 0.035).toFixed(2);
    var waves = [];
    for (var w = 1; w <= wnum; w++){
      var cnt = Math.max(4, Math.round(budget * (0.6 + w * 0.22)));
      var bk = {};
      for (var i = 0; i < cnt; i++){
        var k = pool[Math.floor(Math.random() * pool.length)];
        bk[k] = (bk[k] || 0) + 1;
      }
      waves.push({ n: Object.keys(bk).map(function(kk){ return [kk, bk[kk]]; }), hp: hp });
    }
    if (isBoss){
      var bi = (Math.floor(n / 10) - 1) % BS.length;
      waves[waves.length - 1].n.push([BS[bi], 1]);
      waves[waves.length - 1].n.push(['tank', 2 + Math.floor(n / 25)]);
    }
    LEVELS.push({
      id: n,
      name: A[(n * 7) % A.length] + B[(n * 5) % B.length],
      sub: '第 ' + n + ' 关 · ' + (isBoss ? ('BOSS · ' + BS[(Math.floor(n / 10) - 1) % BS.length]) : ('敌人强度 x' + hp)),
      obs: OBS[n % OBS.length],
      starHp: n >= 60 ? [0.85, 0.5] : [0.7, 0.35],
      tip: TP[n % TP.length],
      waves: waves
    });
  }
})();
