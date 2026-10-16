# 交接文档 · 方块枪神 2D / Block Blaster 2D

> 给接手者的最短路径：先读本文件 → 再读 `CHANGELOG.md` 与 `README.md` → 跑一次测试 → 看「待办」。
> **v1.1.4 已完成并通过全部验收，但尚未提交/打 tag/推送**（按工程约定由负责人统一提交，见第 4 节）。

## 1. 项目是什么

俯视角方块枪战网页游戏（**零第三方依赖**，纯 HTML5 Canvas + 原生 JS）。
仓库：https://github.com/XUFENGCHINA/Block-Blaster ｜ 本地：`D:\工作文件夹\block-gunner-2d`
许可证：**AGPL-3.0**（`LICENSE` 661 行原文，**任何人不要再改法律文件**）。

已实现内容：100 个战役关卡、50 种怪物 + 怪物图鉴（10 种个体特性）、大逃杀（3 张大地图/房屋捡枪）、难度关卡 4 档（敌人外挂）、装备商店（8 升级 + 8 带技能皮肤）、联机合作（主机权威 + 10Hz 快照）、内置内网穿透（UPnP/NAT-PMP + cloudflared/ngrok/frpc + frpc.toml）、材质包系统（.bgpack）、手机触屏适配、PWA / Windows EXE / Android APK 三端打包。

## 2. 当前状态（核对于 2026-10-06 11:05）

| 项目 | 值 |
| --- | --- |
| git HEAD | `71b91b5`（未变；**v1.1.4 的改动全部在工作区，未提交**） |
| 版本 tag | `v1.1.0` / `v1.1.1` / `v1.1.3`（`v1.1.2` 已按要求合并删除；**`v1.1.4` 待负责人打**） |
| 代码版本号 | **1.1.4**（README / manifest.webmanifest / AndroidManifest versionName / android/tools/build-apk.ps1） |
| 安装包 | `dist\方块枪神2D.apk`（149,122 B，versionCode **6**、versionName **1.1.4**，debug 签名，aapt2 badging 已核对）、`dist\方块枪神2D.exe`（53,760 B，selftest PASS） |
| 测试 | `node tests/run-tests.js --strict` → **52 PASS / 0 FAIL / 1 profile skip**；`tests/run-server-tests.js` → 17/17；`tests/e2e-coop.js` → 9/9；**`tests/acceptance-menu-114.js`（新增验收矩阵）→ 全部通过 + 反向对照通过** |
| SW 缓存 | `bg2d-v6` → **`bg2d-v7`** |
| 磁盘 | C: 44.8 GB 可用、D: 128.5 GB（%TEMP% 里 DSH 自己的 `dsh-workspace-changes-*` 快照约 14 GB，非本项目产物，勿乱删） |

**v1.1.4 改动的文件**（工作区，未提交）：

| 文件 | 内容 |
| --- | --- |
| `index.html` / `style.css` / `js/ui.js` | 从 tag `v1.1.3` 冻结后只加三件事：诊断行、`fitMenu()` 溢出兜底、`.menu-scroll` 样式（**不含** v1.2.0 斜切改版） |
| `android/.../MainActivity.java` | `setTextZoom(100)`（根因修复）+ `setLoadWithOverviewMode(true)` + `setInitialScale(0)` + console→logcat + WebView<80 提示 |
| `AndroidManifest.xml` / `android/tools/build-apk.ps1` | versionCode 5→6、versionName 1.1.3→1.1.4、aapt2 `--version-code/--version-name`；顺带修掉「native 工具写 stderr（javac deprecation）在管道里调用时被 `$ErrorActionPreference='Stop'` 当成致命错误」的构建中断 |
| `manifest.webmanifest` / `sw.js` / `README.md` / `CHANGELOG.md` | 版本链路 + 1.1.4 正式段落 |
| `tests/acceptance-menu-114.js`（新增） / `tests/README.md` | 真实 Edge + CDP 的验收矩阵脚本与说明 |
| `android/app/src/main/assets/**`、`dist/方块枪神2D/**`、`dist/*.apk`、`dist/*.exe` | 由 `sync-assets.ps1` / 打包脚本重新生成的产物 |

## 3. 待办

### ① v1.1.4 补丁：手机端「🎨 材质包」按钮点不动 —— ✅ 已完成（待负责人提交/tag/push）

- **根因**：Android System WebView 跟随系统「字体大小」放大网页文本；本项目 UI 全用 em → 布局变高 → 最后一行被 `#stage{overflow:hidden}` 挤出屏幕 → 点击落不到按钮。
- **已交付**：
  1. 资源从 tag `v1.1.3` 冻结（`git show v1.1.3:index.html` 等），未夹带未完成的斜切改版；
  2. Android：`setTextZoom(100)` + `setLoadWithOverviewMode(true)` + `setInitialScale(0)`；WebView 内核 < Chrome 80 弹窗提示；console 转发 logcat；
  3. Web：`js/ui.js` 的 `fitMenu()`——7 个入口必须都在 `#stage` 内且中心 `elementFromPoint` 命中自身，同时标题 / 副标题 / 入口下面的说明小字完整可见、左下角诊断行不被压住；否则把 `.menu-grid` 字号按 4% 步长缩到最低 62%，仍溢出则 `.menu-left.menu-scroll` 退化为可滚动；主菜单 / 窗口缩放 / 转屏 / 首屏 200ms 各校准一次；竖屏遮罩 `#rotate.on` 时不做缩放；
  4. 诊断行（主菜单左下角，`pointer-events:none`）：`v1.1.4 · 视口 · dpr · WebView/Chrome 内核 · 菜单自适应比例`；
  5. 版本 1.1.4 / versionCode 6 / `sw.js` CACHE_NAME +1 / CHANGELOG 正式段落 / 重出 APK+EXE / `aapt2 dump badging` 核对。
- **验收证据**（`tests/acceptance-menu-114.js`，真实 Edge + CDP，把 `fitStage()` 写入的 `#stage` 字号乘上比例来等价模拟 textZoom；每组先 `dispatchEvent(resize)` 重置基准字号，避免比例累乘）：

  | 视口 | 字体×1.0 | ×1.3 | ×1.5 |
  | --- | --- | --- | --- |
  | 960×540 | 菜单 100% | 88% | 76% |
  | 740×360 | 100% | 84% | 72% |
  | 390×844 | 100% | 76% | 64% |

  9 个组合全部：7 个入口在屏内、中心 `elementFromPoint` 命中自身、无需滚动、说明小字不被裁切、诊断行内容正确，并用**真实鼠标事件**点「🎨 材质包」成功进入材质包页（9×8 = 72 条断言全绿）。
  压力用例 640×360 字体×2.0 → 缩到 62% 下限并触发 `.menu-scroll` 滚动兜底（符合设计）。
  反向对照：把菜单字号钉回 100%（等价关掉兜底）后，960×540 字体×1.5 时 pack 底 619 > stage 底 540、中心不命中 —— 证明矩阵确实抓得住原缺陷。
  目视复核截图（仓库外，仅供查看）：`D:\工作文件夹\_wip\v1.1.4-menu-960x540-font1.0.png` / `...font1.5.png`。
- **残余风险**：无真机自动化，手机侧结论来自 CDP 等价模拟；建议装一次 `dist\方块枪神2D.apk`，看主菜单诊断行是否显示 `菜单 100%`（显示 100% = 原生 `setTextZoom` 生效；显示更小 % = Web 兜底在补偿，也都点得动）。

### ② v1.2.0 功能：主菜单斜切改版（用户设计稿）—— 未开始

- 左侧斜切（平行四边形）按钮栏 + 右侧大图区（斜线分割）；按钮悬停**变大 + 变白**（含选中态）；右侧大图显示当前材质包背景；原信息面板改为浮在大图上的半透明卡片，材质包 `panels.mode=hide/replace/keep` 行为保留；7 个入口全部保留。
- **硬性要求：自带溢出韧性**（`overflow-y:auto` + 检测溢出自动缩小），并跑①的验收矩阵。
- 属于新功能 → **minor 版本 v1.2.0**。
- **半成品存放位置**（从 v1.1.4 冻结中移出，别丢）：
  - `git stash list` → `stash@{0}: wip v1.2.0 主菜单斜切改版（未完成，从 v1.1.4 冻结中移出）`
  - 补丁备份：`D:\工作文件夹\_wip\block-gunner-2d-v1.2.0-menu-skew.patch`（含 index.html / style.css / js/ui.js 三个文件的完整改动）
  - 该 WIP 里的 `fitMenu()` 当时绑的是 `.menu-slant` 类，v1.1.4 的实现按 v1.1.3 的 `.menu-btns button[data-act]` 通用写法重写过，1.2.0 可直接复用 v1.1.4 这版。

## 4. 工程约定（务必遵守）

1. **版本纪律**：修 bug 升 patch（1.1.x）、加功能升 minor（1.x.0）；**每次发版必须先写 CHANGELOG 正式段落**；Android **versionCode 必须递增**（否则装不上）；每次发版 **`sw.js` 的 CACHE_NAME 必须 +1**（否则老用户拿旧资源）；改完必须重出 APK/EXE 并用 `aapt2 dump badging` 验证。
2. **冻结发版**：patch 版必须从上一个 tag 冻结资源（`git show v1.1.3:<file>` / `git restore --source=v1.1.3`），不能把未完成的新功能一起带出去（v1.1.4 就是这么做的）。
3. **禁止事项**：不改 `LICENSE`（AGPL-3.0，曾误改为 MIT 已恢复）；不把 `server/frpc.toml`（含 token）与 `*.keystore` 提交（`.gitignore` 已排除）；不提交 `材质包/` 与 `*.bgpack`（含第三方版权素材）；队友**不要自己 push/tag**，由负责人统一提交。
4. **缓存策略**（v1.1.3 起）：本地服务器对 HTML/CSS/JS 发 `Cache-Control: no-cache`；SW 对 HTML/CSS/JS 走 network-first + 离线回退；EXE 使用独立配置目录 `%LOCALAPPDATA%\BlockGunner2D\profile`（彻底重置就删这个目录）。
5. **临时文件**：浏览器测试用的 `--user-data-dir` 必须用完删除（`tests/acceptance-menu-114.js` / `e2e-coop.js` 都在结束时 rmrf），APK 构建的 `%TEMP%\blockgunner-apk-build` 也建议用完删（留 ~1 MB）。曾堆到 59 GB 把 C 盘顶爆并**导致一个队友进程崩溃**。
6. **版权提醒**：用户自用材质包用了碧蓝档案素材（© NEXON/Yostar），仅本地留存、不入库。
7. **验收门禁**：涉及主菜单布局 / 字号 / 移动端的改动，必须跑 `tests/acceptance-menu-114.js`（3 视口 × 字体 1.0/1.3/1.5 + 真实点击 + 反向对照），光跑 `run-tests.js` 不够。

## 5. 环境与离线构建链

| 用途 | 工具 |
| --- | --- |
| Node | `C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（系统另有 `C:\Program Files\nodejs\node.exe`） |
| Python + Pillow | `...\dependencies\python\python.exe` |
| Edge | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| EXE | Windows 自带 `C:\WINDOWS\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 编译 `packaging/exe/Launcher.cs` |
| APK | 手工链路（**无 Gradle/AGP**）：`aapt2 → javac(JDK8) → d8(Zulu17) → aapt add → zipalign → apksigner`；JDK8 `D:\Program Files\Zulu\zulu-8`、SDK `C:\Users\XUFEN\AppData\Local\Android\Sdk`（build-tools 36.0.0 / android-34）；**中文路径下 native 工具会失败，构建脚本已自动在 ASCII 路径（`%TEMP%\blockgunner-apk-build`）暂存** |

常用命令：`node server/server.js`（联机 + 穿透）、`desktop\启动游戏.bat`、`packaging\exe\打包EXE.bat`、`android\同步资源.bat`、`android\构建APK.bat`、`node tests/run-tests.js --strict`、`node tests/run-server-tests.js`、`node tests/e2e-coop.js`、`node tests/acceptance-menu-114.js`。

## 6. 目录速览

```
index.html / style.css / sw.js / manifest.webmanifest / icons/
js/    data.js(数据/存档) levels100.js(9~100关生成) game.js(引擎) ui.js(界面) net.js(联机) pwa.js
server/ server.js(WS中继+静态托管) upnp.js(自动映射) tunnel.js(工具联动) frpc.toml.example config.json
android/  WebView 壳 + 内置 Java HTTP 服务器 + 手工构建链（tools/build-apk.ps1 已带 versionCode 6）
desktop/  Windows 无边框窗口启动器（run-desktop.js）
packaging/ EXE 源码/打包脚本/材质包格式文档(TEXTURE-PACK.md)
tools/    make-pack.py（材质包打包）+ 材质包示例/
tests/    53 条主用例 + 服务端 17 + 双浏览器 E2E 9 + acceptance-menu-114.js（主菜单验收矩阵）
preview/  10 张界面预览图
```

## 7. 已知问题 / 风险

- 手机端按钮点不动 → ① 已修（原生 + Web 双层），**但缺真机复验**，见 3.①残余风险。
- 大材质包（背景 data URI > 1.5M 字符）必须走 Blob URL（已在 v1.1.2 修复，勿回退成直接写 CSS 变量）。
- APK 为 debug 签名（自用/测试 OK；正式分发需换正式 keystore + 放 CI Secrets）。
- 无真机自动化测试：手机相关问题只能靠 CDP 触屏/字号模拟 + 用户实机反馈；`tests/acceptance-menu-114.js` 是无头 Edge 默认 `maxTouchPoints=10`，脚本已用 `Page.addScriptToEvaluateOnNewDocument` 改成 0，否则窄屏纵向会被「请旋转手机」遮罩挡住测量。
- 竖屏（`#rotate.on`）时 `fitMenu()` 不做缩放：遮罩本来就盖住整屏，真机 APK 也已锁横屏。
- 用户环境 GitHub 访问需开 STEAM++ 加速；push/tag 偶发 `Connection was reset`，重试即可。