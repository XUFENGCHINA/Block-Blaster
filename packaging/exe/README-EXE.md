# 方块枪神 2D · Windows EXE 打包说明

把游戏打包成**真正的 Windows EXE**：双击 `dist\方块枪神2D.exe` 打开启动器，
点「开始游戏」即自动拉起联机服务并用 Edge/Chrome 的 `--app` 无边框窗口进入游戏。
不依赖 Visual Studio、不联网，用 Windows 自带的 C# 编译器 `csc.exe` 离线编译。

## 1. 目录与产物

```
packaging/exe/
  Launcher.cs        WinForms 启动器源码（C# 4 语法，csc 直接编译）
  app.manifest       高 DPI / asInvoker 清单（内嵌进 EXE）
  make_icon.py       icons/icon-512.png → app.ico（需要 Python + Pillow）
  打包EXE.bat        一键打包脚本（纯 ASCII 无 BOM）
  verify-exe.ps1     全自动验证脚本（自检 + GUI 生灭周期 + 端口检查）
  README-EXE.md      本文件
  app.ico            由脚本生成的图标（已生成，可重新生成）

dist/                        打包输出目录
  方块枪神2D.exe              双击这个（约 52 KB，含图标与清单）
  方块枪神2D/                 游戏本体（EXE 会自动从这里找 server/server.js）
    index.html  style.css  sw.js  manifest.webmanifest
    js/  icons/  server/  desktop/
```

> EXE 与游戏目录必须保持这种相邻关系：`dist\方块枪神2D.exe` + `dist\方块枪神2D\`。
> 移动时请把两者一起移动。

## 2. 使用（双击 EXE）

| 控件 | 行为 |
| --- | --- |
| **开始游戏** | 后台启动 `node server/server.js --port=8080`；端口被占用会自动 8080→8081→…；轮询 `/healthz` 就绪后用 Edge（其次 Chrome）执行 `--app=http://127.0.0.1:端口/ --window-size=1280,760 --no-first-run --no-default-browser-check --user-data-dir=%LOCALAPPDATA%\BlockGunner2D\profile` 打开无边框游戏窗口 |
| **复制联机地址** | 把 `http://<局域网IP>:端口/`、公网地址（读 `server/config.json` 的 `publicUrl`）、本机地址与房间码深链示例写入剪贴板 |
| **打开联机页** | 服务没启动会先启动，然后用 `--app` 打开 `http://127.0.0.1:端口/#net` 联机大厅 |
| **停止服务** | 只结束**本启动器拉起的那个 node 进程**，释放端口，弹出提示；不会误杀其它 node |
| **清除缓存** | 删除 `%LOCALAPPDATA%\BlockGunner2D\profile` 并自动重启启动器；用于「更新后界面还是旧版」时彻底重置（请先关闭游戏窗口） |
| 关闭窗口 | 自动结束本启动器拉起的 node 进程（只杀自己的子进程） |
| 开机自启 | 勾选后写入 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`（值名 `BlockGunner2D`，命令带 `--autostart --no-browser`），无需管理员；取消勾选即删除 |

窗口里会显示：运行状态（含 node PID、端口、健康检查耗时）、局域网地址、公网地址、
房间码深链示例、Node.js 路径。

局域网联机：把「局域网」地址发给同一 Wi-Fi 下的手机/电脑即可；房主建好房间后，
把 `http://<局域网IP>:端口/#join=房间码` 发给朋友，打开会自动进入联机页并填好房间码。

## 3. 重新打包

在项目根目录双击或执行：

```bat
packaging\exe\打包EXE.bat
```

脚本会：

1. 定位 `C:\WINDOWS\Microsoft.NET\Framework64\v4.0.30319\csc.exe`（64 位找不到时回退 32 位）；
2. 若有 Python + Pillow，用 `icons/icon-512.png` 重新生成 `packaging/exe/app.ico`；
3. 用 csc 把 `Launcher.cs` 编译成 `dist\方块枪神2D.exe`
   （`/target:winexe /win32icon:… /win32manifest:…`，真正的窗口程序、无控制台黑框）；
4. 把 `js/ server/ desktop/ icons/`、`index.html style.css manifest.webmanifest sw.js`
   复制到 `dist\方块枪神2D\`；
5. 自动跑一次 `方块枪神2D.exe --selftest --port=18080` 并打印结果；
6. 打印「双击 dist\方块枪神2D.exe 即可」。

编译命令（等价，手动执行时参考）：

```bat
"%CSC%" /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 ^
  /out:"dist\方块枪神2D.exe" ^
  /win32icon:packaging\exe\app.ico ^
  /win32manifest:packaging\exe\app.manifest ^
  /reference:System.dll /reference:System.Core.dll ^
  /reference:System.Drawing.dll /reference:System.Windows.Forms.dll ^
  packaging\exe\Launcher.cs
```

依赖说明：

* **必需**：Windows 自带的 .NET Framework 4（`csc.exe`）——Win7 及以上都有；
* **可选**：Node.js（`C:\Program Files\nodejs\node.exe` 或 PATH 中），联机才需要；
* **可选**：Python 3 + Pillow，仅用于从 PNG 重新生成 `app.ico`；没有 Python 时
  直接用已生成的 `app.ico`，不影响编译与运行。

## 4. 为什么需要 Node

游戏本体是纯静态 HTML5，单机完全不需要 Node。
但联机（合作/大逃杀房间、WebSocket 中继、内网穿透）由 `server/server.js` 提供：
node 进程负责静态托管 + `/ws` 房间中继 + `/healthz` 健康检查。
启动器只做「拉起 node + 打开窗口 + 地址展示 + 进程清理」，不重复实现服务端逻辑。

* **没有 Node**：双击 EXE 后点开始游戏会弹出明确提示（不会闪退）；也可以直接
  用浏览器打开 `dist\方块枪神2D\index.html` 单机游玩，或安装 Node.js LTS 后再试。
* **有 Node**：可本机/局域网联机；公网联机需要 `server/config.json` 填 `publicUrl`，
  或让服务端的 UPnP/NAT-PMP 内网穿透成功（成功后会自动写回 `publicUrl`）。

## 5. 独立浏览器配置目录（缓存隔离 / 重置）

启动器打开 Edge / Chrome 时会带上：

```
--user-data-dir=%LOCALAPPDATA%\BlockGunner2D\profile --no-first-run --no-default-browser-check
```

- 好处 1：游戏的存档（localStorage）、Service Worker、HTTP 缓存全部放在这个**专用目录**里，
  与用户自己的浏览器完全隔离，不会被主浏览器缓存 / 清除数据影响，也不会互相污染；
- 好处 2：升级游戏后万一仍看到旧界面，删掉这个目录即可彻底重置（下次启动自动重建）；
- 注意：第一次启用独立目录时，之前存在系统浏览器默认配置里的游戏存档与已装材质包不会自动迁移，
  重新装一次材质包即可，之后不再受浏览器缓存影响。

**彻底重置**：关闭游戏窗口 → 删除 `%LOCALAPPDATA%\BlockGunner2D` 整个目录
（或在启动器里点「清除缓存」，会自动删除并重启）→ 重新点「开始游戏」。

## 6. 命令行参数（排障 / 自动化）

```
方块枪神2D.exe                          正常打开控制面板
方块枪神2D.exe --autostart               启动即拉起服务（不弹浏览器；开机自启用）
方块枪神2D.exe --port=8090               指定首选端口（占用仍会自动向上顺延）
方块枪神2D.exe --no-browser              只起服务，不打开 Edge/Chrome
方块枪神2D.exe --root=D:\...\游戏目录    手动指定游戏目录（默认 exe 同级的 方块枪神2D\）
方块枪神2D.exe --selftest                无窗口自检：起服务 → /healthz 200 → 停止 →
                                         端口释放 → 对照 node 未被误杀
方块枪神2D.exe --selftest --port=18080   自检用端口
方块枪神2D.exe --selftest --log=D:\x.txt 自检日志路径（默认 %TEMP%\block-gunner-2d-selftest.txt）
方块枪神2D.exe --timeout=45000           就绪等待毫秒数（默认 30000）
```

自检退出码：`0` = PASS，`1` = FAIL，`2` = 自检异常。日志末尾有 `RESULT: PASS/FAIL`。

全自动验证（推荐打包后跑一遍，会真实启动 GUI、点按钮、检查端口）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\exe\verify-exe.ps1
```

它会依次验证：EXE 存在且是 PE 文件 → `--selftest` 通过 → 启动 GUI 后窗口/标题正确、
node 监听端口、`http://127.0.0.1:8080/healthz` 返回 200 → 点「停止服务」后 node 退出、
端口释放 → 点「开始游戏」重新起来 → 关闭窗口后 node 被清理、端口释放。

## 7. 常见问题

* **首次启动 Windows 防火墙弹窗**：勾选「专用网络」允许访问，否则同一 Wi-Fi 下的
  手机连不上；不影响本机游玩。
* **8080 被占用**：启动器会自动换 8081、8082…，窗口状态栏和地址里显示的是实际端口。
* **公网地址显示「未配置」**：`server/config.json` 的 `publicUrl` 为空；在服务端
  开启内网穿透成功后会自动写回，也可以手动填写后重启服务。
* **没有 Edge/Chrome**：启动器会退回系统默认浏览器打开网址，功能不受影响（只是有地址栏）。
* **只结束自己的 node**：启动器只持有自己 `Process.Start` 返回的进程对象，
  停止/关窗都只 `Kill` 这一个 PID，不会按镜像名杀其它 node。
* **卸载**：删除 `dist\` 即可；如果勾过开机自启，先取消勾选（或删除注册表值
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\BlockGunner2D`）。