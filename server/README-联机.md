# 方块枪神 2D · 联机服务端使用说明

零依赖 Node 服务端：**静态托管游戏本体 + 自己实现的 WebSocket 房间中继**。
不需要 `npm install`，只用 Node 内置模块（http / crypto / fs / path / os）。

---

## 1. 启动服务端

| 平台 | 操作 |
| --- | --- |
| Windows | 双击 `server\启动服务端.bat` |
| Windows（命令行） | `node server\server.js` |
| Linux / macOS | `sh server/start-server.sh` |

启动后控制台会打印：

- 本机访问地址：`http://127.0.0.1:8080/`
- 局域网访问地址：`http://192.168.x.x:8080/`（每个网卡一条）
- WebSocket 地址：`ws://192.168.x.x:8080/ws`
- 手机联机方法、防火墙提示、内网穿透提示

常用参数（命令行优先于 `config.json`，环境变量次之）：

```bash
node server/server.js --port=8080 --host=0.0.0.0
node server/server.js --port=8081 --public-url=https://xxxx.ngrok-free.app
PORT=9000 node server/server.js
```

`server/config.json` 字段：

```json
{
  "port": 8080,                // 监听端口
  "host": "0.0.0.0",           // 0.0.0.0 = 允许局域网访问
  "maxPlayers": 6,             // 每个房间最多人数
  "maxRooms": 200,             // 服务器最多房间数
  "publicUrl": "",             // 内网穿透后的公网地址，填这里会打印在启动横幅里
  "tunnel": { "provider": "none", "note": "把公网地址填到 publicUrl" }
}
```

可选字段：`heartbeat.idleMs`（空闲多久发 ping，默认 30000）、`heartbeat.pongTimeoutMs`（多久没 pong 断开，默认 60000）、`maxMessageBytes`（单条消息上限，默认 2MB）。

> 注意：服务端把 `server/` 的上一级（项目根目录）作为网站根，`index.html`、`js/`、`style.css` 会被直接托管，手机打开地址即可游玩。

---

## 2. 局域网联机（同一 WiFi，最简单）

1. 电脑和手机/其他电脑连**同一个 WiFi 或同一个路由器**。
2. 电脑启动服务端，记下横幅里的局域网地址，例如 `http://192.168.1.5:8080/`。
3. 手机浏览器打开该地址，进入游戏后点主菜单「🌐 联机合作」。
4. 一台设备点「创建房间」，拿到 **4 位房间码**（如 `K7Q2`）；
   其他设备输入昵称 + 房间码，点「加入房间」。房主点「开始游戏」。
5. 分享更省事：直接把 `http://192.168.1.5:8080/#join=K7Q2` 发给好友，打开会自动进入联机页并填好房间码。

### Windows 放行端口

- 第一次运行时 Windows 防火墙会弹窗：勾选「专用网络」和「公用网络」，点「允许访问」。
- 没弹窗或误点了取消：控制面板 → Windows Defender 防火墙 → 高级设置 → 入站规则 → 新建规则 →
  端口 → TCP → 特定本地端口 `8080` → 允许连接 → 三个网络都勾选 → 命名 `Block Gunner 2D`。
- 查看本机 IP：`ipconfig`，找「IPv4 地址」；手机与电脑 IP 前三段应相同（如都是 `192.168.1.x`）。

---

## 3. 外网联机（手动工具方案；推荐先看第 4 节「内置穿透」）

家庭宽带通常没有公网 IP，用下面任意一种穿透工具把本机 `8080` 暴露到公网。
**三种方式都同时转发 HTTP 和 WebSocket（同一个 TCP 端口），不用额外配置 `/ws`。**
穿透成功后，把公网地址（`https://` 或 `http://`，**不要带结尾斜杠**）填进 `server/config.json` 的 `publicUrl` 再重启服务端，
这样启动横幅会显示分享地址；不填也不影响游玩，直接把穿透地址发给好友即可。

### 方案 A：frp（自建服务器 / 有云主机，最稳定）

公网服务器上运行 `frps`：

```ini
# frps.ini（放在公网服务器）
[common]
bind_port = 7000
token = 换成你自己的密码
```

启动：`./frps -c frps.ini`

游戏电脑上运行 `frpc`：

```ini
# frpc.ini（放在运行游戏的电脑，和 frpc 可执行文件同目录）
[common]
server_addr = 你的公网服务器IP
server_port = 7000
token = 换成你自己的密码

[block-gunner]
type = tcp
local_ip = 127.0.0.1
local_port = 8080
remote_port = 8080
```

启动：`frpc -c frpc.ini`（Windows 用 `frpc.exe -c frpc.ini`）

然后 `publicUrl` 填 `http://你的公网服务器IP:8080`。
记得在云服务器安全组/防火墙放行 `7000`（frp 控制端口）和 `8080`（游戏端口）。

### 方案 B：ngrok（免服务器，最快）

1. 到 <https://ngrok.com> 注册并下载 ngrok，复制自己的 authtoken。
2. 本机执行：

```bash
ngrok config add-authtoken <你的 authtoken>
ngrok http 8080
```

3. 终端会显示 `Forwarding  https://xxxx.ngrok-free.app -> http://localhost:8080`，
   把 `https://xxxx.ngrok-free.app` 填进 `publicUrl`（免费版每次重启地址会变，重新填即可）。
4. 好友直接打开该地址就能玩；也可以发 `https://xxxx.ngrok-free.app/#join=房间码`。

### 方案 C：cloudflared（免费、无需注册的快速隧道）

```bash
# 安装 cloudflared 后，一条命令即可（Windows 用 cloudflared.exe）
cloudflared tunnel --url http://localhost:8080
```

终端会输出类似 `https://random-words.trycloudflare.com` 的地址，填进 `publicUrl` 即可。
（更稳定的固定域名需要 Cloudflare 账号：`cloudflared tunnel login` → `cloudflared tunnel create block-gunner` → 配置 DNS。）

### 穿透后怎么让玩家进来

- 把 `http://公网地址:端口/` 或 `https://公网地址/` 直接发给好友：打开即玩。
- 深链分享房间：`http://公网地址/#join=房间码`，页面会跳到联机页并自动填好房间码。
- 房主先「创建房间」拿到 4 位码，再发深链最方便。
- 服务端会自动识别 `https` 对应 `wss`：客户端在 `https` 页面上会用 `wss://公网地址/ws` 连接。

---

## 4. 内置穿透（v1.1 新增，推荐先用它）

服务端自带三层自动穿透，默认 `--tunnel=auto` 按顺序尝试，任何一步失败都会自动降级，不会卡住服务：

| 优先级 | 方式 | 说明 |
| --- | --- | --- |
| 1 | **UPnP / NAT-PMP 自动端口映射** | 纯 Node 实现，1~2 秒探测路由器；需要路由器开启 UPnP / NAT-PMP |
| 2 | **cloudflared / ngrok / frpc** | 自动检测本机已安装的工具，起子进程并从输出抓公网 URL |
| 3 | 都没有 | 打印清晰指引；**局域网模式完全不受影响** |

### 4.1 一键怎么用（普通玩家看这里）

- Windows 双击 `server\启动服务端.bat`；Linux / macOS 执行 `sh server/start-server.sh`。两者默认就是自动穿透。
- 或者命令行：`node server/server.js --tunnel=auto`
- 只用 UPnP / NAT-PMP：`node server/server.js --tunnel=upnp`
- 完全关闭穿透（只玩局域网）：`node server/server.js --tunnel=off`
- 指定某个工具（只走工具穿透，不再尝试 UPnP）：`node server/server.js --tunnel=auto --tunnel-tool=cloudflared`

启动后控制台会打印「本机 / 局域网 / 公网」三段地址（都带 `#join=房间码` 深链示例）；穿透结果稍后单独打印一行。

界面 / 脚本也可以直接调：

- `GET /netinfo`：返回 `{ port, lan:[{ip,url}], local, public:{url,method,ok}, tunnel:{provider,state,log} }`
- `POST /tunnel/start`：重新尝试一键穿透（可带 JSON `{ "tool": "cloudflared" }` 强制执行某个工具）
- `POST /tunnel/stop`：停止穿透并删除 UPnP 端口映射

### 4.2 UPnP 成功率与路由器设置

- 家用路由器出厂大多开启 UPnP，**成功率约 50%~70%**；但光猫桥接、二级路由、公司 / 校园网、运营商 CGNAT（大内网）通常无效。
- 失败时的日志长这样：`UPnP/NAT-PMP 失败（约 1.7 秒）：未发现 IGD…`，此时服务照常可用，只是公网直连没有建立。
- 打开路由器 UPnP：浏览器进路由器管理页（常见 `192.168.1.1` / `192.168.0.1`）→「高级设置 / NAT 转发 / 安全」→ 找到 **UPnP** 开关 → 开启并保存；部分光猫需要超级管理员账号。
- NAT-PMP 是苹果 / 部分路由器的自动映射协议，服务端会在 UPnP 失败后自动尝试（网关 UDP 5351），无需额外配置。
- 成功后服务端会自动 `AddPortMapping`（TCP，外部端口 = 内部端口）；退出时（Ctrl+C）自动 `DeletePortMapping` 删除映射。

### 4.3 cloudflared / ngrok / frpc 装在哪里

| 工具 | 安装方式 | 检测位置（Windows） |
| --- | --- | --- |
| **cloudflared（推荐）** | `winget install --id Cloudflare.cloudflared`，或到 Cloudflare 官网下载 | PATH、`C:\Program Files\cloudflared\`、`%LOCALAPPDATA%\cloudflared\` |
| ngrok | 下载 ngrok.exe 后执行 `ngrok config add-authtoken <token>` | PATH、`C:\ngrok\`、`%USERPROFILE%\ngrok\` |
| frpc | 从 frp 项目下载，需自己有公网 frps 服务器 | PATH、`C:\frp\`、`%USERPROFILE%\frp\` |

- 三个都装也可以，默认按 cloudflared → ngrok → frpc 顺序尝试；想指定就加 `--tunnel-tool=ngrok`。
- frpc 的公网地址会从同目录 `frpc.ini` 的 `server_addr` + `remote_port` 推断（例如 `http://你的服务器IP:8080`）。
- 也可以只把可执行文件放进上表目录、不配 PATH，重跑服务端即可自动发现。

### 4.4 怎么确认穿透成功

1. 看控制台：出现 `UPnP/NAT-PMP 成功（…ms）：http://…` 或 `cloudflared 已就绪：https://…`，以及 `分享给朋友：…/#join=房间码`。
2. 浏览器打开公网地址能看到游戏首页；打开 `公网地址/healthz` 返回 `{"ok":true,...}`。
3. 本机访问 `http://127.0.0.1:8080/netinfo`：`public.ok` 为 `true` 且 `public.url` 就是公网地址。
4. 最可靠：手机关掉 WiFi 用 4G/5G 流量打开公网地址，能进游戏即成功。
5. 成功后地址会自动写回 `server/config.json` 的 `publicUrl`；游戏内「联机」页也会通过 `/netinfo` 读取。

> 自检说明：UPnP 映射成功后服务端会尝试访问 `http://<外网IP>:<端口>/healthz`；很多路由器不支持 NAT 回环（内网访问外网 IP 失败），这**不代表映射失败**，请用手机流量验证。

### 4.5 怎么把公网地址发给朋友

- 建房拿到 4 位房间码后，把整条深链复制出去即可，例如：

  `https://xxxx.trycloudflare.com/#join=K7Q2`

  朋友打开会自动进入联机页并填好房间码。
- 也可以只发域名根地址，让朋友自己输房间码：`https://xxxx.trycloudflare.com/`
- 免费隧道（cloudflared 快速隧道 / ngrok 免费版）**每次重启地址都可能变**，重启后重新复制新深链即可；UPnP 的地址则跟家里公网 IP 走。
- 安全提醒：穿透开启后公网可访问，房间码是唯一门槛；不玩时请 Ctrl+C 关掉服务端（会自动删除 UPnP 映射、结束穿透进程）。

## 5. 常见故障排查

| 现象 | 原因 / 解决 |
| --- | --- |
| 手机完全打不开网页（一直转圈/超时） | 不在同一 WiFi；电脑 IP 填错；Windows 防火墙没放行 TCP 8080；路由器开了「AP 隔离 / 访客网络」 |
| 本机能开、别人打不开 | 服务端 `host` 必须是 `0.0.0.0`；检查 `netstat -ano \| findstr :8080` 是否有监听；防火墙入站规则 |
| 能进页面但进不了房间 / 一直「连接中」 | **WebSocket 被拦截**：代理/公司网络/校园网屏蔽 ws；穿透工具没转发 TCP；换成 ngrok / cloudflared 试；确认地址里没有多余路径，`/ws` 由服务端自动使用 |
| 创建房间报「房间不存在或已解散」 | 房间码输入错误（区分字母数字）；房主已退出，房间自动解散 |
| 房间进不去提示「房间已满」 | 每房间最多 6 人（`config.json` 可改 `maxPlayers`） |
| 玩一会儿掉线 | 心跳机制：30 秒无数据发 ping，60 秒无 pong 断开；弱网/切后台会触发，重新加入即可 |
| `EADDRINUSE` 端口被占用 | 换端口：`node server.js --port=8081`，或结束占用 8080 的进程 |
| 穿透地址能打开但 WS 报错 | 确认穿透的是 **TCP/HTTP 8080 原始端口**；frp 需 `type = tcp`，不要只做 http 反代而丢掉 Upgrade 头 |

---

## 6. 联机协议速查（已冻结）

WebSocket 文本帧，JSON 消息；房间码 4 位大写字母+数字；每房间最多 6 人；**房主断开则房间解散**。

| 方向 | 消息 |
| --- | --- |
| C→S | `{t:'create', name, config}` → S→C `{t:'room', code, id, host:true, players:[{id,name,host,ready}]}` |
| C→S | `{t:'join', name, code}` → S→C `{t:'room', code, id, host:false, players:[...], config}`，失败 `{t:'err', msg}` |
| S→C | `{t:'peer', ev:'join'\|'leave'\|'ready', id, name, ready}` |
| C→S | `{t:'ready', v}`；`{t:'start'}` → 房间内广播 `{t:'start', config}` |
| C→S | `{t:'relay', data}` → 同房间其他人收到 `{t:'relay', from:id, data}` |
| C→S | `{t:'ping', ts}` → S→C `{t:'pong', ts}`；`{t:'leave'}` |

服务端还支持协议级 ping/pong（opcode 9/10）、分片消息（opcode 1/2/0）、64 位长度、以及非法消息回 `{t:'err'}` 不崩溃。

健康检查：`http://127.0.0.1:8080/healthz` 返回房间数、连接数、运行时长等信息。

## 7. 目录

```
server/
├── server.js            服务端主程序（静态托管 + WebSocket + 房间中继 + 穿透 API）
├── config.json          端口 / 房间上限 / publicUrl / tunnel 等配置
├── upnp.js              UPnP IGD + NAT-PMP 自动端口映射（纯 Node，新增）
├── tunnel.js            一键联动 cloudflared / ngrok / frpc（新增）
├── selftest-tunnel.js   内置穿透自测脚本（新增）
├── 启动服务端.bat        Windows 双击启动（纯 ASCII，无 BOM）
├── start-server.sh       Linux / macOS 启动脚本
└── README-联机.md        本文件
```