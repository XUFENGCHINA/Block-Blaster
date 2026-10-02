# tests/REPORT.md · 方块枪神 2D 独立验证报告（第 4 轮：100 关 + 联机合作，全绿）

- 日期：2026-10-02 21:04
- 环境：Windows / Node v24.21.0 / Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）/ headless
- 命令（项目根目录）：

  ```
  & "...\node.exe" tests/run-tests.js --strict
  & "...\node.exe" tests/run-server-tests.js
  & "...\node.exe" tests/e2e-coop.js
  ```

- 原始结果：`tests/last-results.json`（53 条）、`tests/last-server-results.json`（17 条）、`tests/last-e2e-results.json`（9 条）
- 模式：`--strict`、确定性种子 `20250501`

## 一、结果总览

| 层 | 结果 | 说明 |
| --- | --- | --- |
| Node 单测/回归 | **PASS 52 / FAIL 0 / SKIP 1** | 53 条；SKIP 为 desktop 跳 G8.1，mobile 子进程 PASS |
| 服务端集成 | **PASS 17 / FAIL 0** | 真实 `server/server.js` + 3 个 WebSocket 客户端 + 静态托管 |
| 双无头浏览器 E2E | **PASS 9 / FAIL 0** | 真实 server + 两个 Edge，建房/加入/开局进入 playing |
| 旧回归 | 41 条全绿 | 大逃杀/战役/难度/特性/图鉴/移动端/浏览器冒烟无退化 |
| file:// 离线 | PASS | 真实 Edge：`Net.available()===false`、`status==='off'`、无报错 |

**结论：第 4 轮全部通过；F3/F4/F5 三个联机问题已修复并回归验证；100 关数据、联机引擎、服务端、双浏览器端到端四层均无遗留缺陷。**

## 二、F3/F4/F5 修复验证（上轮预验证发现）

| 编号 | 问题 | 本轮验证用例 | 结果 |
| --- | --- | --- | --- |
| F3 | `winRun()` 未广播 `ev:win`，客户端赢局不结算 | G17.6：清完第 1 关两波，mock Net 必须收到 `ev:win` | PASS（同时收到 coins 50） |
| F4 | `applySnapshot` 把 `s[2]`（hp）当 coins，冻结格式 `s:[score,kills,hp,maxHp,coins]` | G18.2：快照 `s:[7,3,88,100,55]`，断言 `RUN.coins===55`、`hpSync===88` | PASS |
| F5 | client 仍本地跑 `updateWave/updateEnemies`，会自己发波次金币/生成敌人 | G18.5：应用 `w:[1,0,0,1,0], e:[]` 快照后步进 3 秒，不得本地结算、发金币或生成非 ghost 敌人 | PASS |

Lead 特别要求保留的两条防退化断言已在 G18.2/G18.5 固化为长期回归。

## 三、100 关数据与界面

| 用例 | 结果 | 关键证据 |
| --- | --- | --- |
| G16.1 100 关数据 | PASS | LEVELS=100、id 连续 1..100、字段/obs/starHp/波次敌人 key 全合法；每 10 关最后一波含 BOSS（10 关）；第 1 关仍 108；100 关首通总额独立累加 = 43188 |
| G16.2 100 关界面 | PASS | 关卡页渲染 100 张卡；默认第 1 关解锁、第 100 关锁定 |

## 四、联机引擎（mock Net，Node 单测）

| 用例 | 结果 | 关键证据 |
| --- | --- | --- |
| G17.1 主机 setup/快照 | PASS | `setup{obs,world,bounds}` 广播；10Hz（1s 内 10 帧）；p/e/b/eb/pk/w/s 元组长度与冻结格式一致 |
| G17.2 远程输入 | PASS | 远程玩家按键移动、开火命中并消耗弹匣 |
| G17.3 敌人目标选择 | PASS | 敌人选择最近的远程玩家（300 -> 238） |
| G17.4 远程倒地/复活 | PASS | 中弹倒地 hp=0，6 秒后半血复活 |
| G17.5 全员倒地判负 | PASS | 玩家+远程全倒 -> `onLose` + 广播 `ev:lose` |
| G17.6 金币/胜负广播 | PASS | 第 1 波广播 `ev:coins=50`；通关广播 `ev:win` |
| G18.1 客户端输入上传 | PASS | 每 50ms 一条 `{k:'in',mx,my,aim,fire,...}`（300ms 内 5 条） |
| G18.2 客户端重建/插值 | PASS | setup 更新 world/obs/bounds；snap 重建 ghost 敌人/子弹/敌弹/拾取物；远程与自己插值到快照目标；`snap s[4] -> coins` |
| G18.3 客户端事件 | PASS | `ev:coins` 入账 +77；`ev:down` 仅提示；`ev:win` 结算 |
| G18.4 客户端判负 | PASS | `ev:lose` -> state=over |
| G18.5 主机权威 | PASS | 快照后步进 3 秒：客户端不本地结算、不发波次金币、不生成非 ghost 敌人 |
| G19.1 玩家倒地复活 | PASS | 队友存活时玩家倒地 6 秒后半血复活，不直接判负 |

## 五、服务端（真实进程 + 3 客户端）

真实启动 `server/server.js`（随机空闲端口），用 Node 内置 WebSocket 客户端完成 17 项：

- S1-S3：服务启动、`GET /index.html` 200 且含「方块枪神」、`/js/game.js` 200。
- S4-S8：3 客户端连接 `/ws`；create 返回 4 位房间码 + host 标记；join 2/3 人且 peer join 广播。
- S9-S11：relay 双向到达其他两人、不回发发送者；ready 广播；start 广播给 3 人且带 config。
- S12-S14：ping->pong 原样 ts；非法消息回 err 且不崩、连接仍可用。
- S15-S17：leave 清理 + peer leave；房主断开后房间解散/清理；联机测试后静态托管仍正常。

## 六、双无头 Edge 端到端（真实服务端 + 真实 net.js/ui.js/game.js）

| 用例 | 结果 | 关键证据 |
| --- | --- | --- |
| E1 | PASS | 真实服务端启动，静态页 200 |
| E2 | PASS | host 输入昵称点「创建房间」，拿到 4 位房间码（`Net.roomCode()`） |
| E3 | PASS | client 用 `#net` 页面输入房间码加入，host 看到 2 人 |
| E4/E5 | PASS | host 点开始后双方 `Game.state()==='playing'`，角色分别为 host / client |
| E6/E7 | PASS | host `remotes.length===1`；client 收到快照后重建 1 个远程玩家；两端 `#netHud` 显示 |
| E8 | PASS | 双端 `window.onerror/unhandledrejection` 均为空 |
| E9 | PASS | 同一浏览器导航到 `file://`：`Net.available()===false`、`status==='off'`、页面有离线提示且无报错 |

## 七、回归与方法说明

- 旧 41 条（大逃杀/战役/难度/特性/图鉴/移动端/Edge 冒烟）在 `--strict` 下全绿；新增 G16-G19 后合计 53 条。
- Node 桩对 `js/net.js` 采用 mock Net（`available()=false`，并补齐 `on.room/onRoom` 等 UI 需要的字段），避免影响离线 UI；真实 Net 的行为由服务端集成 + 双浏览器 E2E 独立覆盖。
- 服务端测试使用 Node 24 内置 `WebSocket` 客户端与 `http`，未引入第三方依赖。
- 测试完已确认无残留 `server.js` / node 进程（taskkill 树清理）。

## 八、可疑点 / 低风险观察

1. Node 单测的 mock Net 与真实 `js/net.js` 是两套实现；真实 Net 的 API 形状由 E2E 覆盖，但 `Net` 细节（重连/延迟显示）未在 Node 层逐项断言，可后续按需补。
2. 房主「单人也能试跑」按钮允许 1 人开局（UI 文案已说明），端到端测试走的是 2 人路径，未视为缺陷。
3. 服务端 S16 接受 `peer leave` 广播或连接关闭两种解散表现，当前实测为广播 `peer leave`。

## 九、结论

- **第 4 轮验收全部通过**：100 关（数据+界面）、联机引擎（主机/客户端/倒地/广播）、服务端 3 人房间、双浏览器端到端、file:// 离线、旧回归，全绿。
- 复跑命令：

  ```
  & "...\node.exe" tests/run-tests.js --strict
  & "...\node.exe" tests/run-server-tests.js
  & "...\node.exe" tests/e2e-coop.js
  ```

- 产物：`tests/run-tests.js`、`tests/run-server-tests.js`、`tests/e2e-coop.js`、`tests/README.md`、`tests/REPORT.md`、`tests/last-results.json`、`tests/last-server-results.json`、`tests/last-e2e-results.json`、`tests/dex-coverage.json`、`tests/diag-browser-aim.js`。
- 测试只写入 `tests/`，未修改 `js/*.js`、`index.html`、`style.css`、`server/*`。

## 附录、历史轮次

- 第 1 轮：发现 G3.2（BR 大世界鼠标瞄准未补偿摄像机偏移）等。
- 第 2 轮：Lead 修复瞄准/magSize/G.br，复跑全绿。
- 第 3 轮：50 怪数据/特性/投放/图鉴；先发现击杀计数与 tier 口径问题，Lead 修复后 38 PASS / 0 FAIL。
- 第 4 轮准备阶段发现 F3/F4/F5，本轮全部关闭。