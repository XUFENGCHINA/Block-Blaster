# 方块枪神 2D · 桌面端 & 手机桌面（PWA）

本项目**不依赖 Electron、不依赖任何 npm 包**：电脑端用系统自带的 Edge / Chrome
的「应用模式（app mode）」当外壳，手机端用 PWA「添加到主屏幕」独立运行。

---

## 一、电脑桌面端

### 启动（推荐）

双击：

```
desktop\启动游戏.bat
```

它会自动完成：

1. 后台启动 `node server\server.js`（默认端口 **8080**，被占用会自动试 8081、8082……直到 8099）；
2. 轮询 `http://127.0.0.1:实际端口/healthz`，服务就绪后才继续；
3. 用 **Edge 应用模式**开一个无地址栏窗口：`--app=http://127.0.0.1:端口/ --window-size=1280,760`；
   找不到 Edge 会依次回退 **Chrome**，再找不到就用系统默认浏览器。

打开的是 `http://127.0.0.1:端口/` 而不是 `file://`，所以联机、`#join=房间码`
深链、内网穿透都能正常用；游戏内「联机合作」的服务器地址会自动按当前网址填好。

### 启动（无控制台黑框）

双击：

```
desktop\启动游戏(无控制台).vbs
```

效果与上面一样，只是隐藏命令行窗口。

### 停止

双击：

```
desktop\停止游戏.bat
```

它会按 `desktop\.state\server.json` 里记录的进程号关闭服务端；
记录丢失时也会自动扫描 8080–8099 端口找到监听进程再关闭。

### 常见问题

- **端口被占用**：脚本自动换到 8081/8082…，无需手动改配置；
  实际端口以窗口标题/控制台输出和 `desktop\.state\server.json` 为准。
- **日志**：每个端口的服务端输出在 `desktop\logs\server-<端口>.log`。
- **手机连不进来**：手机和电脑连同一个 Wi-Fi；启动时控制台会打印
  `phone on the same Wi-Fi can open: http://192.168.x.x:8080/`，手机浏览器直接打开即可。
  首次运行如弹出 Windows 防火墙提示，请勾选「专用网络 + 公用网络」并允许。
- **不想自动开浏览器**（例如只想给手机当服务器）：
  `desktop\启动游戏.bat --no-browser`，或先设置环境变量 `BG_NO_BROWSER=1`。
- **只想看会用哪个浏览器开窗**：`desktop\启动游戏.bat --dry-run`。
- **换起始端口**：`desktop\启动游戏.bat --port=9000`。
- **必须装 Node.js 18+**：脚本会先找 PATH 里的 `node.exe`，再找常见安装目录。

> 提示：在电脑上直接打开游戏请务必用上面的脚本（走 `http://127.0.0.1`）。
> 直接双击 `index.html` 会用 `file://` 打开，联机功能不可用。

---

## 二、手机装到桌面（PWA）

先在电脑上运行桌面端（见上），然后：

### iOS（Safari）

1. 手机与电脑连同一个 Wi-Fi，Safari 打开 `http://电脑局域网IP:端口/`（例如 `http://192.168.1.5:8080/`）；
2. 点底部「分享」按钮 → **添加到主屏幕** → 添加；
3. 从主屏幕图标启动，配合 `orientation: landscape` 会自动横屏、无地址栏独立运行。

### Android（Chrome / Edge）

- 用 **https 地址**（例如 cloudflared / ngrok 等内网穿透给出的 `https://xxx` 公网地址）
  打开时，浏览器会认为满足 PWA 条件，主菜单会出现「📲 安装到桌面」；
  也可以从浏览器菜单选「安装应用 / 添加到主屏幕」。
- 直接访问 `http://192.168.x.x:8080` 时，浏览器出于安全限制**不会注册 Service Worker、也不会弹安装提示**，
  此时可用浏览器菜单的「添加到主屏幕」建一个快捷方式（打开的还是浏览器页面）。

### 电脑 Chrome / Edge

`http://127.0.0.1:端口/` 属于浏览器认可的**安全上下文**（localhost），
所以电脑上打开游戏后，主菜单会按条件显示「📲 安装到桌面」：
点一下即可把游戏装进电脑的独立应用窗口，离线也能打开。

### 安装按钮的显示条件

- 浏览器触发了 `beforeinstallprompt`（可安装）**或** iOS Safari（走「分享 → 添加到主屏幕」提示）；
- 已经处于独立窗口（standalone）运行时自动隐藏。

### 离线可玩

`sw.js` 会预缓存 `index.html`、`style.css`、全部 `js/*.js`、manifest 与三个图标；
安装后断网也能启动（页面导航网络优先、离线回退缓存；静态资源缓存优先）。

---

## 三、文件说明

| 路径 | 作用 |
| --- | --- |
| `desktop\启动游戏.bat` | 电脑端一键启动（纯 ASCII / 无 BOM） |
| `desktop\启动游戏(无控制台).vbs` | 隐藏控制台启动 |
| `desktop\停止游戏.bat` | 停止服务端 |
| `desktop\run-desktop.js` | 找空闲端口、起服务、轮询 `/healthz`、按 Edge→Chrome→默认浏览器开 app 窗口 |
| `desktop\stop-desktop.js` | 停服（状态文件 + 端口扫描兜底） |
| `desktop\.state\server.json` | 当前服务端端口 / PID（自动生成） |
| `desktop\logs\` | 服务端日志（自动生成） |
| `desktop\tools\make-icons.py` | 用 Pillow 重新生成 PWA 图标 |
| `desktop\tools\check-pwa.html` | 浏览器自检页：检查 manifest 字段、3 个图标 200、SW 注册状态 |
| `manifest.webmanifest` | PWA 清单（standalone / landscape / 192+512+maskable 图标） |
| `sw.js` | Service Worker 离线缓存 |
| `js\pwa.js` | SW 注册、安装事件、iOS 提示（`PWA.canInstall()/install()`） |
| `icons\icon-192.png`、`icon-512.png`、`icon-maskable-512.png` | 像素风图标（maskable 版四周留 20%+ 安全边距） |