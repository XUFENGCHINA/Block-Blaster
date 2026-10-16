# 交接文档 · 方块枪神 2D / Block Blaster 2D

> 给接手者的最短路径：先读本文件 → 再读 `CHANGELOG.md` 与 `README.md` → 跑一次验收矩阵 → 看「待办」。
> **v1.2.0 已完成、验收通过、已提交并推送（`origin/main` = `e265708`，tag `v1.2.0` 已推送）；手机端实机测试已由用户确认通过。**
> `v1.1.4` 是并入本版的修复基线（`93fb285`，未单独发 tag）。

## 1. 项目是什么

俯视角方块枪战网页游戏（**零第三方依赖**，纯 HTML5 Canvas + 原生 JS）。
仓库：https://github.com/XUFENGCHINA/Block-Blaster ｜ 本地：`D:\工作文件夹\block-gunner-2d`
许可证：**AGPL-3.0**（`LICENSE` 661 行原文，**任何人不要再改法律文件**）。

已实现内容：100 个战役关卡、50 种怪物 + 怪物图鉴（10 种个体特性）、大逃杀（3 张大地图/房屋捡枪）、难度关卡 4 档（敌人外挂）、装备商店（8 升级 + 8 带技能皮肤）、联机合作（主机权威 + 10Hz 快照）、内置内网穿透（UPnP/NAT-PMP + cloudflared/ngrok/frpc + frpc.toml）、材质包系统（.bgpack）、手机触屏适配、PWA / Windows EXE / Android APK 三端打包。

## 2. 当前状态（核对于 2026-10-16 21:20）

| 项目 | 值 |
| --- | --- |
| git HEAD | `e265708`（`feat: v1.2.0 主菜单斜切改版…`，**与 origin/main 同步，0 待推 0 落后**） |
| 版本 tag | `v1.1.0` / `v1.1.1` / `v1.1.3` / **`v1.2.0`（已推送，指向 `e265708`）**；`v1.1.2` 已按要求合并删除，`v1.1.4` 从未单独发版 |
| 代码版本号 | **1.2.0**（README / manifest.webmanifest / AndroidManifest versionName / android/tools/build-apk.ps1） |
| Android versionCode | **7**（v1.1.3 发出去的是 5；v1.1.4 用 6 但从未发版，直接跳到 7） |
| 安装包 | `dist\方块枪神2D.apk` + `dist\BlockGunner2D.apk`（同文件，153,218 B，versionCode **7**、versionName **1.2.0**，debug 签名，aapt2 badging 已核对）、`dist\方块枪神2D.exe`（53,760 B，selftest PASS）+ `dist\方块枪神2D\` 分发副本 |
| 测试 | `node tests/run-tests.js --strict` → **52 PASS / 0 FAIL / 1 profile skip**；`tests/run-server-tests.js` → 17/17；`tests/e2e-coop.js` → 9/9；**`tests/acceptance-menu.js`（发版门禁）→ 全部通过**（9 组视口×字号 + 压力 + 反向对照 + v1.2.0 改版 9 项） |
| 实机 | **手机 APK 已由用户实测通过**（2026-10-16） |
| SW 缓存 | `bg2d-v7` → **`bg2d-v8`** |
| 磁盘 | C: 约 43 GB 可用、D: 128 GB（%TEMP% 里 DSH 自己的 `dsh-workspace-changes-*` 快照约 14 GB，非本项目产物，勿乱删） |

**v1.2.0 发布内容（提交 `e265708`）**：

| 文件 | 内容 |
| --- | --- |
| `index.html` | 主菜单改为斜切结构（`.menu-item` + `.menu-slant` + 右侧 `#menuHeroPanels` 大图区）；诊断行改到 `#stage` 左下角；3 个次级入口标签收短为「🛒 商店 / 📖 图鉴 / 🎨 材质包」 |
| `style.css` | 斜切按钮（`skewX(-12deg)`）/ 悬停变大变白 / 常驻选中态 / 大图区 `clip-path` 斜线分割 + 材质包背景 / 面板玻璃卡片 / 面板三模式 / 斜切间隔修正 / `#diag` 样式 |
| `js/ui.js` | `fitMenu()` 溢出兜底按新结构重写（含"说明小字不裁切、诊断行不被压住"判据）；诊断行显隐跟随主菜单；点击后常驻选中态 `sel` + 触屏 `press` 反馈 |
| `android/.../MainActivity.java` | `setTextZoom(100)`（根因修复）+ `setLoadWithOverviewMode(true)` + `setInitialScale(0)` + console→logcat + WebView<80 弹窗提示 |
| `AndroidManifest.xml` / `android/tools/build-apk.ps1` | versionCode → 7、versionName → 1.2.0；build-apk.ps1 顺带修掉「native 工具写 stderr 在管道里被当成致命错误」的构建中断 |
| `manifest.webmanifest` / `sw.js` / `README.md` / `CHANGELOG.md` | 版本链路 + 1.2.0 正式段落（合并了原 1.1.4 内容，说明其从未单独发版） |
| `tests/acceptance-menu.js`（由 `acceptance-menu-114.js` 改名 + 扩充） / `tests/README.md` | 发版门禁脚本与说明 |
| `android/app/src/main/assets/**`、`dist/**` | 由 `sync-assets.ps1` / 打包脚本重新生成的产物 |

## 3. 待办

### ① 手机端「🎨 材质包」按钮点不动 —— ✅ 已完成（并入 1.2.0）

- **根因**：Android System WebView 跟随系统「字体大小」放大网页文本；本项目 UI 全用 em → 布局变高 → 最后一行被 `#stage{overflow:hidden}` 挤出屏幕 → 点击落不到按钮。
- **交付**：Android `setTextZoom(100)` + overview/initialScale；Web `fitMenu()` 自动缩放 + 左栏滚动兜底；诊断行；WebView<80 提示。
- **验证**：`tests/acceptance-menu.js` 9 组视口×字号全绿（960×540 / 740×360 / 390×844 × 字体 1.0/1.3/1.5），每组断言 7 入口在屏内、中心 `elementFromPoint` 命中自身、无需滚动、说明小字不裁切、诊断行正确，并用真实鼠标点「🎨 材质包」；反向对照证明关掉兜底确实溢出。
- **残余风险**：无真机自动化，手机侧结论来自 CDP 等价模拟。建议装一次 APK 看诊断行：显示 `菜单 100%` = 原生 `setTextZoom` 生效；显示更小 % = Web 兜底在补偿，两种都能点。

### ② v1.2.0 主菜单斜切改版 —— ✅ 已完成

- 左侧斜切按钮栏 + 右侧大图区（斜线分割）；悬停变大变白（含选中态，同时只有一项高亮）；7 个入口全保留；右侧大图显示当前材质包背景；原信息面板改为浮在大图上的半透明卡片；`panels.mode` 的 keep/hide/replace 全保留；自带溢出韧性（自动缩放 → 滚动兜底）。
- **验证**：验收矩阵第二部分 9 项全绿（斜切矩阵 ≈ tan12°、悬停宽度 269→285 / 背景亮度 0.98、常驻选中跟随点击、截面 polygon、示例包启用后大图区背景为包内图、三种面板模式）；目视复核截图在仓库外：`D:\工作文件夹\_wip\v1.2.0-menu-*.png`（默认 / 悬停 / 字体1.5 / 装包后）。

### ③ 下一版候选（未开工，按需挑）

- 真机复验 1.2.0（最好顺便试试：横屏/竖屏、刘海屏安全区、材质包大图在手机上的观感）。
- 主菜单在「字体放大 + 小屏」兜底档下，右侧信息卡片里的长文本仍会折行（如「移 动」「通关进 度」）——只在兜底档出现，可考虑给 `#menuRight` 加"紧凑档"：JS 在 `__bgMenuScale < 0.9` 时加类，把 `.keys` 变单列。
- 页面级 JS 错误提示（曾有一版把 `window.onerror` / `unhandledrejection` 画成红条，因 `unhandledrejection` 在 file:// / 弱网下噪音大而移除；若要做，建议只在主菜单显示且只收 `error`）。
- `preview/` 里的界面预览图仍是 1.1.x 的旧版式，需要时可重拍。

## 4. 工程约定（务必遵守）

1. **版本纪律**：修 bug 升 patch（1.1.x）、加功能升 minor（1.x.0）；**每次发版必须先写 CHANGELOG 正式段落**；Android **versionCode 必须递增**（否则装不上）；每次发版 **`sw.js` 的 CACHE_NAME 必须 +1**（否则老用户拿旧资源）；改完必须重出 APK/EXE 并用 `aapt2 dump badging` 验证。
2. **冻结发版**：patch 版必须从上一个 tag 冻结资源；本次 1.2.0 是把"已冻结验证过的 1.1.4 修复"与"斜切改版"合并发布（1.1.4 从未独立发版，用户明确要求跳过）。
3. **禁止事项**：不改 `LICENSE`（AGPL-3.0，曾误改为 MIT 已恢复）；不把 `server/frpc.toml`（含 token）与 `*.keystore` 提交（`.gitignore` 已排除）；不提交 `材质包/` 与 `*.bgpack`（含第三方版权素材）；队友**不要自己 push/tag**，由负责人统一提交。
4. **缓存策略**（v1.1.3 起）：本地服务器对 HTML/CSS/JS 发 `Cache-Control: no-cache`；SW 对 HTML/CSS/JS 走 network-first + 离线回退；EXE 使用独立配置目录 `%LOCALAPPDATA%\BlockGunner2D\profile`（彻底重置就删这个目录）。
5. **临时文件**：浏览器测试用的 `--user-data-dir` 必须用完删除（`tests/acceptance-menu.js` / `e2e-coop.js` 都在结束时 rmrf），APK 构建的 `%TEMP%\blockgunner-apk-build` 也建议用完删。曾堆到 59 GB 把 C 盘顶爆并**导致一个队友进程崩溃**。
6. **版权提醒**：用户自用材质包用了碧蓝档案素材（© NEXON/Yostar），仅本地留存、不入库。
7. **验收门禁**：涉及主菜单布局 / 字号 / 移动端的改动，必须跑 `node tests/acceptance-menu.js`；光跑 `run-tests.js` 不够。改了 `index.html`/`style.css`/`js/ui.js` 还要跑 `run-tests.js --strict` 与服务端/E2E。

## 5. 环境与离线构建链

| 用途 | 工具 |
| --- | --- |
| Node | `C:\Users\XUFEN\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（系统另有 `C:\Program Files\nodejs\node.exe`） |
| Python + Pillow | `...\dependencies\python\python.exe` |
| Edge | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| EXE | Windows 自带 `C:\WINDOWS\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 编译 `packaging/exe/Launcher.cs` |
| APK | 手工链路（**无 Gradle/AGP**）：`aapt2 → javac(JDK8) → d8(Zulu17) → aapt add → zipalign → apksigner`；JDK8 `D:\Program Files\Zulu\zulu-8`、SDK `C:\Users\XUFEN\AppData\Local\Android\Sdk`（build-tools 36.0.0 / android-34）；**中文路径下 native 工具会失败，构建脚本已自动在 ASCII 路径（`%TEMP%\blockgunner-apk-build`）暂存** |
| 无头浏览器测试 | 脚本自带 CDP：`tests/acceptance-menu.js`、`tests/e2e-coop.js`、`tests/diag-browser-aim.js`；无头 Edge 默认 `maxTouchPoints=10`，需要"非触屏"时要 `Page.addScriptToEvaluateOnNewDocument` 改写 |

常用命令：`node server/server.js`（联机 + 穿透）、`desktop\启动游戏.bat`、`packaging\exe\打包EXE.bat`、`android\同步资源.bat`、`android\构建APK.bat`、`node tests/run-tests.js --strict`、`node tests/run-server-tests.js`、`node tests/e2e-coop.js`、`node tests/acceptance-menu.js`。

## 6. 目录速览

```
index.html / style.css / sw.js / manifest.webmanifest / icons/
js/    data.js(数据/存档) levels100.js(9~100关生成) game.js(引擎) ui.js(界面) net.js(联机) pwa.js
server/ server.js(WS中继+静态托管) upnp.js(自动映射) tunnel.js(工具联动) frpc.toml.example config.json
android/  WebView 壳 + 内置 Java HTTP 服务器 + 手工构建链（tools/build-apk.ps1 带 versionCode 7）
desktop/  Windows 无边框窗口启动器（run-desktop.js）
packaging/ EXE 源码/打包脚本/材质包格式文档(TEXTURE-PACK.md)
tools/    make-pack.py（材质包打包）+ 材质包示例/
tests/    53 条主用例 + 服务端 17 + 双浏览器 E2E 9 + acceptance-menu.js（主菜单发版门禁）
preview/  10 张界面预览图（仍是 1.1.x 版式）
```

## 7. 已知问题 / 风险

- 手机端真机未复验（见 3.①残余风险）。
- 大材质包（背景 data URI > 1.5M 字符）必须走 Blob URL（v1.1.2 起修复，勿回退成直接写 CSS 变量）。
- APK 为 debug 签名（自用/测试 OK；正式分发需换正式 keystore + 放 CI Secrets）。
- 兜底档（字体放大 + 小屏）下右侧信息卡片会有折行，属观感问题；见 3.③。
- 竖屏（`#rotate.on`）时 `fitMenu()` 不做缩放：遮罩本来就盖住整屏，真机 APK 也已锁横屏。
- 无真机自动化测试：手机相关问题只能靠 CDP 触屏/字号模拟 + 用户实机反馈。
- 用户环境 GitHub 访问需开 STEAM++ 加速；push/tag 偶发 `Connection was reset`，重试即可。
