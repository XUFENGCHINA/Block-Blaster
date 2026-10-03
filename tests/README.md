# 方块枪神 2D · 测试脚手架（tests/）

独立验证用的 Node 脚本 + DOM/Canvas 桩，**只写 tests/ 目录，不修改任何业务代码**。

## 快速运行

在项目根目录 `D:\工作文件夹\block-gunner-2d` 下执行：

```
& "C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" tests/run-tests.js
```

默认行为：

1. `desktop` profile 跑第 1-7、9-19 组用例；
2. 自动 spawn 一个 `--profile=mobile` 子进程跑第 8 组（移动端路径）；
3. 默认带 Edge headless 冒烟（第 9 组，约 6 秒）；
4. 终端输出逐条结果与汇总，并把完整结果写入 `tests/last-results.json`。

## 常用参数

| 参数 | 说明 |
| --- | --- |
| `--strict` | 依赖未完成/缺功能不再 SKIP 而是 FAIL（验收最终跑法） |
| `--no-browser` | 跳过 Edge 冒烟，快速迭代用 |
| `--no-mobile` | 不 spawn mobile 子进程 |
| `--profile=mobile` | 只跑 mobile profile（父进程会自动带上此参数） |
| `--only=G3.2,G4.2` | 只跑指定用例 id，或传组号如 `--only=7` |
| `--seed=20250501` | 覆盖随机种子；每个用例在基种上再派生独立种子，失败可复现 |
| `--json` | 末尾打印 `@@RESULT_JSON@@` 行（父子进程通信/CI 用） |
| `--edge=路径` | 覆盖 Edge 可执行文件路径 |
| `--no-browser --no-mobile` | 纯 Node 最小回归，约 1 秒 |

## 用例分组

| 组 | 用例 | 内容 | profile |
| --- | --- | --- | --- |
| 1 | G1.1-G1.3 | BR 三张图开局：世界尺寸、敌人数量/间距/不卡墙、出生点安全、pistol_s 弹匣 | desktop |
| 1 | G1.4 | HUD 集成：`#brChip` 非 BR 隐藏、`#brLeft` 剩余敌人、`#hudWeapon` | desktop |
| 2 | G2.1/G2.2 | 拾取换枪（旧枪留原地可换回）、匕首 kind=melee 且开火不耗弹 | desktop |
| 3 | G3.1 | 匕首近战方向性：正面 30px 命中、背后不掉血 | desktop |
| 3 | G3.2 | BR 大世界鼠标瞄准应补偿摄像机偏移（修复后 PASS） | desktop |
| 4 | G4.1 | 地图1 杀光胜利：onWin/win/kills=total、首胜 +320、重复 0 | desktop |
| 4 | G4.2/G4.3 | 地图2/3 首胜 +600/+1100、重复 0、Save.brWins 递增 | desktop |
| 5 | G5.1 | 摄像机四角夹紧、玩家始终在镜头内、地图中央居中 | desktop |
| 6 | G6.1/G6.2 | 玩家被 bounds 限制、子弹飞出世界回收 | desktop |
| 7 | G7.1 | 战役第1关通关、每波金币、重复通关不发金币、3 星 | desktop |
| 7 | G7.2 | 障碍物挡子弹（含无遮挡命中的对照） | desktop |
| 7 | G7.3 | 难度4 外挂生效（speed/shield/9 项）、每波金币 x4 | desktop |
| 7 | G7.4 | 第 8 关 BOSS 通关（bossSeen、wave=2、3 星） | desktop |
| 8 | G8.1 | 移动端：matchMedia coarse + 竖屏、#rotate 显隐、触屏控件、goBR→start-br 进入 playing、3 张地图卡 | mobile |
| 9 | G9.1 | Edge headless 冒烟：主菜单 + `#br` 直入 BR 页 dump-dom 无 NAVERR/JS 报错、CDP 真实点击进入 BR | desktop || 10 | G10.1-G10.3 | 50 条 ENEMY 静态校验：字段/类型/tier>=2、TRAITS 10 条、远程与 BOSS 规则、与文档分布一致性 | desktop |
| 11 | G11.1 | 50 个 key 各 spawn 并跑 60 帧不报错，数值与数据一致 | desktop |
| 12 | G12.1-G12.10 | 10 个个体特性各一条可观测断言（summon/regen/shield/steal/blink/berserk/revive/aimbot/homing/wallhack） | desktop |
| 13 | G13.1 | 投放覆盖 50/50，静态扫描与 Game.dexCoverage() 一致，输出 tests/dex-coverage.json | desktop |
| 14 | G14.1-G14.2 | 图鉴收录：生成不收录；首次击杀解锁 0->1 且 onDex 一次；每次击杀递增；重载持久 | desktop |
| 15 | G15.1 | 图鉴界面：50 卡 / ??? / 筛选自洽 / 进度文本 / 主菜单进度 | desktop |
| 16 | G16.1-G16.2 | 100 关数据（id 连续 / 字段 / 波次 key / 每 10 关 BOSS / 首通总额 43188）与关卡页 100 卡 | desktop |
| 17 | G17.1-G17.6 | 联机主机引擎：setup / 10Hz 快照 / 远程输入 / 敌人选最近目标 / 倒地复活 / 全员判负 / 金币与胜负广播 | desktop |
| 18 | G18.1-G18.5 | 联机客户端引擎：50ms 输入上传 / setup+snap 重建与插值 / coins-win-lose 事件 / 主机权威（不本地发波次金币） | desktop |
| 19 | G19.1 | 玩家倒地 6 秒复活（队友存活时不判负） | desktop |

## 独立脚本（服务端 / 双浏览器端到端）

`
# 真实 server/server.js + 3 个 WebSocket 客户端（create/join/relay/peer/start/leave/非法消息 + 静态托管）
& "...\node.exe" tests/run-server-tests.js

# 真实 server + 两个无头 Edge（真实 js/net.js/ui.js/game.js）：建房 -> 加入 -> 开局双方 playing；file:// 离线检查
& "...\node.exe" tests/e2e-coop.js
`

结果分别写入 `tests/last-server-results.json` 与 `tests/last-e2e-results.json`；脚本结束时会杀掉自己启动的服务端/浏览器进程。

> Node 单测（run-tests.js）不加载真实 `js/net.js`，联机引擎用例使用 mock Net（`available()=false`），以免影响离线 UI 用例；真实 Net 的行为由上述两个独立脚本覆盖。
## 实现说明

- 用 `vm.runInThisContext` 依次加载 `js/data.js`、`js/game.js`、`js/ui.js`，在 ui.js 末尾追加：

  ```js
  ;globalThis.__X = { Game, UI, Save, LEVELS, DIFFICULTIES, ENEMY, WEAPONS, BR_MAPS, waveCoinReward, levelWaveCoins };
  ```

- DOM/Canvas 全部自建桩：`getElementById` 带 style/classList/innerHTML/textContent/appendChild/addEventListener/getBoundingClientRect/querySelector/closest；`document.querySelectorAll('.coin-num')` 返回数组；`canvas.getContext('2d')` 用 Proxy 吞掉所有绘制调用。
- 可控时钟：`requestAnimationFrame` 回调入队，由 `step(ms)` 手动推进（默认 60fps 切片）；`setTimeout/setInterval` 走虚拟时钟；`performance.now()` 返回虚拟时间；定时器句柄带 `unref/ref` 以兼容 Node 内部（undici/WebSocket）。
- 异常隔离：若产品 rAF 主循环回调抛错，异常记入当前用例，测试会自动把主循环补回队列，避免一个 bug 连锁污染其余用例（浏览器真实行为是主循环就此停摆，这点也会作为产品风险看待）。
- 随机源：每个用例用 `mulberry32(baseSeed + index*7919)` 重设 `Math.random`，失败可用 `--seed` + `--only` 精确复现。

## 失败复现 / 附加工具

- `tests/diag-browser-aim.js`：G3.2 的真实 Edge 最小复现（走 CDP，不依赖 DOM 桩）：

  ```
  & "C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" tests/diag-browser-aim.js
  ```

  脚本会把 BR 玩家放到地图中央、鼠标指向玩家右侧 300px，然后打印 `aim` 与 `cos(aim)`。修复前输出 ≈ -0.38（缺陷）；Lead 修复摄像机补偿后输出 ≈ 1.00，已通过。

## 约束

- 测试只读业务代码（`js/*.js`、`index.html`、`style.css`）。
- 运行时唯一写入的业务外文件：`tests/last-results.json`。