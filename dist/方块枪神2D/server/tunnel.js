#!/usr/bin/env node
'use strict';
/*
 * ============================================================
 *  方块枪神 2D · 一键联动本机内网穿透工具
 * ============================================================
 *  零 npm 依赖，只检测/启动本机已有工具：
 *    1) cloudflared   cloudflared tunnel --url http://127.0.0.1:<port>
 *    2) ngrok         ngrok http <port>
 *    3) frpc          frpc -c frpc.ini（地址从 frpc.ini 的 server_addr + remote_port 推断）
 *
 *  启动子进程后从 stdout/stderr 正则抓公网 URL
 *  （https://*.trycloudflare.com、https://*.ngrok-free.app 等），
 *  写回 config.json 的 publicUrl 并打印。
 *
 *  什么都不装也可以：上层会打印清晰指引，局域网模式照常可用。
 * ============================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const TOOL_ORDER = ['cloudflared', 'ngrok', 'frpc'];

const TOOL_DEFS = {
  cloudflared: {
    name: 'cloudflared',
    label: 'cloudflared（Cloudflare 免费隧道，无需注册）',
    bins: ['cloudflared'],
    args: function (port) { return ['tunnel', '--url', 'http://127.0.0.1:' + port, '--no-autoupdate']; },
    urlPatterns: [/https?:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i],
    installHint: '安装：Windows 执行 winget install --id Cloudflare.cloudflared，或下载 cloudflared.exe 放到 C:\\Program Files\\cloudflared\\ 后重跑服务端。'
  },
  ngrok: {
    name: 'ngrok',
    label: 'ngrok（需先配置 authtoken）',
    bins: ['ngrok'],
    args: function (port) { return ['http', '127.0.0.1:' + port, '--log=stdout']; },
    urlPatterns: [
      /https?:\/\/[a-z0-9][a-z0-9-]*\.ngrok-free\.app/i,
      /https?:\/\/[a-z0-9][a-z0-9-]*\.ngrok(?:-free)?\.(?:app|io|dev|com)/i
    ],
    installHint: '安装：下载 ngrok.exe 放到 C:\\ngrok\\，执行 ngrok config add-authtoken <你的 token>，再重跑服务端。'
  },
  frpc: {
    name: 'frpc',
    label: 'frpc（需要你自己的公网 frps 服务器）',
    bins: ['frpc'],
    args: function () { return ['-c', 'frpc.ini']; },
    urlPatterns: [/https?:\/\/[^\s"'<>]+/i],
    installHint: '安装：把 frpc.exe 和 frpc.ini 放同一目录（如 C:\\frp\\），并在 frpc.ini 配好 server_addr / remote_port。'
  }
};

/* ---------------------------- 基础工具 ---------------------------- */

function hhmmss() {
  const d = new Date();
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function isFile(p) {
  try { return !!p && fs.statSync(p).isFile(); } catch (e) { return false; }
}

function candidateFileNames(name) {
  if (process.platform === 'win32') return [name + '.exe', name + '.cmd', name + '.bat', name];
  return [name];
}

function whichSync(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const file of candidateFileNames(name)) {
      const p = path.join(dir, file);
      if (isFile(p)) return p;
    }
  }
  return null;
}

function toolCommonDirs(name) {
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || '';
    const up = process.env['USERPROFILE'] || '';
    const pd = process.env['ProgramData'] || '';
    const dirs = [];
    if (name === 'cloudflared') {
      if (local) dirs.push(path.join(local, 'cloudflared'));
      dirs.push(path.join(pf, 'cloudflared'), path.join(pf86, 'cloudflared'));
      if (up) dirs.push(path.join(up, 'cloudflared'), path.join(up, '.cloudflared'));
    } else if (name === 'ngrok') {
      if (up) dirs.push(path.join(up, 'ngrok'));
      dirs.push('C:\\ngrok');
      if (local) dirs.push(path.join(local, 'ngrok'));
      dirs.push(path.join(pf, 'ngrok'));
    } else if (name === 'frpc') {
      if (up) dirs.push(path.join(up, 'frp'));
      dirs.push('C:\\frp', path.join(pf, 'frp'), path.join(pf86, 'frp'));
    }
    if (pd) dirs.push(path.join(pd, 'chocolatey', 'bin'));
    if (up) dirs.push(path.join(up, 'scoop', 'shims'));
    return dirs;
  }
  return ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/snap/bin', path.join(os.homedir(), 'bin')];
}

/* 查找工具：支持环境变量强制指定（便于测试 / 自定义安装位置） */
function findTool(name) {
  const def = TOOL_DEFS[name];
  if (!def) return null;

  const specific = process.env['BG_TUNNEL_BIN_' + name.toUpperCase()];
  if (isFile(specific)) return specific;
  const generic = process.env.BG_TUNNEL_BIN;
  if (isFile(generic)) {
    const base = path.basename(generic).toLowerCase();
    if (base.indexOf(name) >= 0 || /\.(js|cjs|mjs)$/i.test(base)) return generic;
  }

  for (const binName of def.bins) {
    const hit = whichSync(binName);
    if (hit) return hit;
  }
  for (const dir of toolCommonDirs(name)) {
    for (const file of candidateFileNames(name)) {
      const p = path.join(dir, file);
      if (isFile(p)) return p;
    }
  }
  return null;
}

function detectTools() {
  const out = [];
  for (const name of TOOL_ORDER) {
    const p = findTool(name);
    if (p) out.push({ name: name, path: p, label: TOOL_DEFS[name].label });
  }
  return out;
}

/* ---------------------------- URL 抓取 ---------------------------- */

function sanitizeUrl(raw) {
  let s = String(raw || '').trim().replace(/^[<'"(]+/, '');
  s = s.replace(/[)\]}>.,;:'"\\]+$/, '');
  s = s.replace(/\/+$/, '');
  return s;
}

function extractUrl(text, toolName) {
  if (!text) return null;
  const def = TOOL_DEFS[toolName];
  const patterns = (def && def.urlPatterns) || [];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m) {
      const u = sanitizeUrl(m[0]);
      if (/^https?:\/\//i.test(u)) return u;
    }
  }
  const generic = String(text).match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const raw of generic) {
    const u = sanitizeUrl(raw);
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(u)) continue;
    if (/ngrok\.com|cloudflare\.com|github\.com|golang\.org/i.test(u)) continue;
    return u;
  }
  return null;
}

/* ---------------------------- config 写回 ---------------------------- */

function writeConfigPublicUrl(configPath, url, provider) {
  try {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { cfg = {}; }
    if (!cfg || typeof cfg !== 'object') cfg = {};
    const clean = sanitizeUrl(url);
    cfg.publicUrl = clean;
    cfg.tunnel = Object.assign(
      { auto: true, prefer: 'upnp', externalPort: 0, keepAlive: true },
      cfg.tunnel || {},
      { provider: provider || (cfg.tunnel && cfg.tunnel.provider) || 'none', state: 'running', updatedAt: new Date().toISOString() }
    );
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, configPath);
    return true;
  } catch (e) {
    return false;
  }
}

/* frpc 输出里一般没有公网 URL，从同目录 frpc.ini 推断 */
function parseFrpcIniUrl(binPath) {
  try {
    const ini = path.join(path.dirname(binPath), 'frpc.ini');
    if (!isFile(ini)) return null;
    const text = fs.readFileSync(ini, 'utf8');
    const server = /^\s*server_addr\s*=\s*([^\s#;]+)/mi.exec(text);
    let remote = null;
    const re = /^\s*remote_port\s*=\s*(\d+)/gmi;
    let m;
    while ((m = re.exec(text))) remote = m[1];
    if (server && remote) return 'http://' + String(server[1]).replace(/\/+$/, '') + ':' + remote;
  } catch (e) {}
  return null;
}

/* ---------------------------- 子进程启动 ---------------------------- */

function spawnToolProcess(toolName, binPath, port) {
  const def = TOOL_DEFS[toolName];
  const args = def.args(port);
  const opts = { windowsHide: true, env: process.env };
  if (toolName === 'frpc') opts.cwd = path.dirname(binPath);

  if (/\.(js|cjs|mjs)$/i.test(binPath)) {
    return spawn(process.execPath, [binPath].concat(args), opts);
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(binPath)) {
    // .cmd / .bat 需要 cmd.exe 转一层；显式拼命令行，避免 shell:true 的安全告警
    const comspec = process.env.ComSpec || 'cmd.exe';
    const quote = function (s) {
      s = String(s);
      if (s === '') return '""';
      return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s;
    };
    const line = quote(binPath) + (args.length ? ' ' + args.map(quote).join(' ') : '');
    return spawn(comspec, ['/d', '/s', '/c', line], Object.assign({}, opts, { windowsVerbatimArguments: true }));
  }
  return spawn(binPath, args, opts);
}

function waitExit(child, timeoutMs) {
  return new Promise(function (resolve) {
    if (!child || child.exitCode !== null) { resolve({ ok: true }); return; }
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      resolve({ ok: false, error: '停止超时' });
    }, timeoutMs);
    child.once('exit', function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: true });
    });
  });
}

/* ---------------------------- 穿透管理器 ---------------------------- */

class TunnelManager {
  /*
   * options: { port, configPath, keepAlive, writeConfig, urlTimeoutMs, onLog }
   *   - onLog(line) 会把每条日志同时交给主程序打印
   */
  constructor(options) {
    const opts = options || {};
    this.port = parseInt(opts.port, 10) || 8080;
    this.configPath = opts.configPath || path.join(__dirname, 'config.json');
    this.onLog = typeof opts.onLog === 'function' ? opts.onLog : function () {};
    this.onPublic = typeof opts.onPublic === 'function' ? opts.onPublic : function () {};
    this.keepAlive = opts.keepAlive !== false;
    this.writeConfig = opts.writeConfig !== false;
    this.urlTimeoutMs = Math.max(3000, parseInt(opts.urlTimeoutMs, 10) || parseInt(process.env.BG_TUNNEL_URL_TIMEOUT_MS, 10) || 20000);
    this.upnp = opts.upnp || require('./upnp');

    this.logs = [];
    this.state = 'off';        // off | starting | running | failed | stopped
    this.provider = null;      // upnp | natpmp | cloudflared | ngrok | frpc
    this.public = null;        // { url, method, ok, externalIp, externalPort, check }
    this.child = null;
    this.childTool = null;
    this.childStartedAt = 0;
    this.childRestarts = 0;
    this.upnpResult = null;    // UPnP/NAT-PMP 映射句柄（stop 时删除）
    this._stopped = false;
    this._startPromise = null;
    this._generation = 0;
  }

  log(message) {
    const line = '[' + hhmmss() + '] ' + message;
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
    try { this.onLog(line); } catch (e) {}
  }

  getInfo() {
    return { provider: this.provider, state: this.state, log: this.logs.slice(-80) };
  }

  getPublic() {
    return this.public ? Object.assign({}, this.public) : null;
  }

  setPublic(pub) {
    this.public = pub ? Object.assign({}, pub) : null;
    try { this.onPublic(this.public); } catch (e) {}
  }

  /* 启动穿透（幂等；失败绝不 reject） */
  start(options) {
    const opts = options || {};
    if (this._startPromise) return this._startPromise;
    if (this.state === 'running' && this.public) {
      return Promise.resolve({ ok: true, url: this.public.url, provider: this.provider, state: this.state, reused: true });
    }
    this._stopped = false;
    this._generation++;
    const gen = this._generation;
    const self = this;
    this._startPromise = this._doStart(opts, gen).then(function (r) {
      self._startPromise = null;
      return r;
    }, function (e) {
      self._startPromise = null;
      self.state = 'failed';
      self.log('穿透启动异常（已忽略）：' + (e && e.message ? e.message : e));
      return { ok: false, state: 'failed', message: e && e.message ? e.message : String(e) };
    });
    return this._startPromise;
  }

  async _doStart(opts, gen) {
    const mode = String(opts.mode || 'auto').toLowerCase();
    const forcedTool = TOOL_DEFS[opts.tool] ? opts.tool : null;
    const prefer = opts.prefer === 'tool' ? 'tool' : 'upnp';

    this.state = 'starting';
    this.provider = null;
    this.setPublic(null);
    this.log('穿透模式 ' + mode + (forcedTool ? '（指定工具 ' + forcedTool + '）' : '') + '，优先 ' + (prefer === 'tool' ? '本机工具' : 'UPnP/NAT-PMP'));

    if (mode === 'off') {
      this.state = 'off';
      this.log('穿透已关闭（--tunnel=off），仅本机 / 局域网可用。');
      return { ok: false, state: 'off', provider: null, message: 'tunnel off' };
    }

    // 注意：这里必须惰性执行，UPnP 失败后才轮到本机工具（不能并发抢跑）
    const tryUpnp = () => this._tryUpnp(gen);
    const tryTools = () => this._tryTools(forcedTool, gen);

    let ok = false;
    if (mode === 'upnp') {
      ok = await tryUpnp();
    } else if (forcedTool) {
      ok = await tryTools();
    } else if (prefer === 'tool') {
      ok = await tryTools();
      if (!ok && !this._stopped && gen === this._generation) ok = await tryUpnp();
    } else {
      ok = await tryUpnp();
      if (!ok && !this._stopped && gen === this._generation) ok = await tryTools();
    }

    if (this._stopped || gen !== this._generation) {
      return { ok: false, state: this.state, provider: this.provider, message: '已取消' };
    }
    if (ok) {
      this.state = 'running';
      return { ok: true, url: this.public ? this.public.url : null, provider: this.provider, state: this.state };
    }

    this.state = 'failed';
    this.log('所有自动穿透方式都不可用。');
    this.log('局域网模式仍然可用：把「局域网」地址发给同一 WiFi 下的朋友就能联机，不受影响。');
    this.log('想要外网联机请看 server/README-联机.md 的「内置穿透」章节（推荐 cloudflared，免费且不用注册）。');
    return { ok: false, state: 'failed', provider: this.provider, message: '未找到可用的穿透方式（UPnP/NAT-PMP 与本机穿透工具都不可用）' };
  }

  async _tryUpnp(gen) {
    this.log('UPnP/NAT-PMP：开始探测网关（秒级超时，失败自动降级）…');
    const started = Date.now();
    let result = null;
    try {
      result = await this.upnp.openPortMapping({
        port: this.port,
        internalPort: this.port,
        externalPort: this.port,
        selfCheck: true
      });
    } catch (e) {
      result = { ok: false, error: e && e.message ? e.message : String(e) };
    }
    if (this._stopped || gen !== this._generation) return false;
    const cost = Date.now() - started;

    if (result && result.ok) {
      this.provider = result.method === 'natpmp' ? 'natpmp' : 'upnp';
      this.upnpResult = result;
      const url = result.url || null;
      this.setPublic({
        url: url,
        method: this.provider,
        ok: true,
        externalIp: result.externalIp || null,
        externalPort: result.externalPort || null,
        check: result.check || null
      });
      if (url) {
        if (this.writeConfig && writeConfigPublicUrl(this.configPath, url, this.provider)) {
          this.log('已把公网地址写回 server/config.json 的 publicUrl。');
        }
        this.log('UPnP/NAT-PMP 成功（' + cost + 'ms）：' + url + '（TCP ' + this.port + ' → ' + (result.internalIp || '') + ':' + (result.internalPort || this.port) + '）');
        this.log('分享给朋友：' + url + '/#join=房间码');
      } else {
        this.log('UPnP/NAT-PMP 映射成功（' + cost + 'ms），但没取到外网 IP；请用手机流量访问 http://<路由器 WAN IP>:' + (result.externalPort || this.port) + '/ 验证。');
      }
      if (result.check && result.check.attempted) {
        this.log('外网自检：' + (result.check.ok ? '通过' : '未通过 — ' + result.check.detail));
      } else if (result.check && result.check.detail) {
        this.log('外网自检：未执行 — ' + result.check.detail);
      }
      this.state = 'running';
      return true;
    }

    const msg = result && (result.message || result.error) ? (result.message || result.error) : '未知错误';
    this.log('UPnP/NAT-PMP 失败（' + cost + 'ms）：' + msg);
    this.log('提示：多数家用路由器需要先在管理页打开「UPnP」开关；公司/校园网或运营商 CGNAT 环境下 UPnP 往往不可用，建议改用 cloudflared / ngrok。');
    return false;
  }

  async _tryTools(forcedTool, gen) {
    let tools = detectTools();
    if (forcedTool) {
      tools = tools.filter(function (t) { return t.name === forcedTool; });
      if (!tools.length) {
        this.log('未检测到 ' + forcedTool + '（PATH 和常见安装目录里都没有）。');
        this.log(TOOL_DEFS[forcedTool].installHint);
        return false;
      }
    } else if (!tools.length) {
      this.log('未检测到 cloudflared / ngrok / frpc。');
      this.log('推荐装 cloudflared（免费、不用注册）：' + TOOL_DEFS.cloudflared.installHint);
      return false;
    }

    for (const tool of tools) {
      if (this._stopped || gen !== this._generation) return false;
      this.log('检测到 ' + tool.name + '：' + tool.path);
      const ok = await this._startToolProcess(tool.name, gen);
      if (ok) return true;
    }
    return false;
  }

  _startToolProcess(name, gen) {
    const self = this;
    const def = TOOL_DEFS[name];
    return new Promise(function (resolve) {
      const bin = findTool(name);
      if (!bin) {
        self.log('找不到 ' + name + ' 可执行文件。');
        resolve(false);
        return;
      }
      let args = [];
      try { args = def.args(self.port); } catch (e) { args = []; }
      self.provider = name;
      self.state = 'starting';
      self.log('正在启动 ' + def.label + ' …');
      self.log('命令：' + bin + ' ' + args.join(' '));

      let child;
      try {
        child = spawnToolProcess(name, bin, self.port);
      } catch (e) {
        self.log(def.label + ' 启动失败：' + e.message);
        resolve(false);
        return;
      }
      self.child = child;
      self.childTool = name;
      self.childStartedAt = Date.now();

      let settled = false;
      let buffer = '';
      let urlTimer = null;

      function finish(ok, url, message) {
        if (settled) return;
        settled = true;
        if (urlTimer) clearTimeout(urlTimer);
        if (ok) {
          self.setPublic({ url: url, method: name, ok: true });
          self.state = 'running';
          if (self.writeConfig && writeConfigPublicUrl(self.configPath, url, name)) {
            self.log('已把公网地址写回 server/config.json 的 publicUrl。');
          }
          self.log(def.label + ' 已就绪：' + url);
          self.log('分享给朋友：' + url + '/#join=房间码');
          resolve(true);
        } else {
          self.log(def.label + ' 失败：' + message);
          resolve(false);
        }
      }

      function onData(chunk) {
        const text = chunk.toString('utf8');
        buffer = (buffer + text).slice(-65536);
        for (const rawLine of text.split(/\r?\n/)) {
          const s = rawLine.trim();
          if (!s) continue;
          if (/trycloudflare\.com|ngrok|Forwarding|started tunnel|Registered tunnel|Error|ERR|fatal|failed|错误|失败/i.test(s)) {
            self.log('[' + name + '] ' + s.slice(0, 300));
          }
        }
        if (!settled) {
          const url = extractUrl(buffer, name);
          if (url) finish(true, url, '');
        }
      }

      if (child.stdout) child.stdout.on('data', onData);
      if (child.stderr) child.stderr.on('data', onData);

      child.on('error', function (err) {
        if (!settled) finish(false, null, '进程错误：' + err.message);
      });

      child.on('exit', function (code, signal) {
        if (self.child === child) self.child = null;
        if (!settled) {
          const tail = buffer.trim() ? buffer.trim().split(/\r?\n/).slice(-2).join(' | ').slice(0, 240) : '';
          finish(false, null, '提前退出（code=' + code + (signal ? ', signal=' + signal : '') + '）' + (tail ? '；最后输出：' + tail : ''));
          return;
        }
        if (self._stopped || gen !== self._generation) return;
        const uptime = Date.now() - self.childStartedAt;
        self.log(def.label + ' 进程已退出（code=' + code + (signal ? ', signal=' + signal : '') + '）。');
        if (self.keepAlive && uptime > 5000 && self.childRestarts < 2) {
          self.childRestarts++;
          self.log('keepAlive 生效：2 秒后自动重启（第 ' + self.childRestarts + ' 次）…');
          setTimeout(function () {
            if (self._stopped || gen !== self._generation) return;
            self._startToolProcess(name, gen).then(function (ok) {
              if (!ok) {
                self.state = 'failed';
                self.log('自动重启失败，隧道已断开。');
              }
            });
          }, 2000);
        } else {
          self.state = 'failed';
          self.log('隧道已断开；可重启服务端或在游戏「联机」页重新一键开启。');
        }
      });

      urlTimer = setTimeout(function () {
        if (settled) return;
        finish(false, null, '在 ' + Math.round(self.urlTimeoutMs / 1000) + ' 秒内没有从输出里识别到公网地址');
        self._killChild(child);
      }, self.urlTimeoutMs);

      if (name === 'frpc') {
        const iniUrl = parseFrpcIniUrl(bin);
        if (iniUrl) {
          setTimeout(function () { if (!settled) finish(true, iniUrl, ''); }, 1200);
        }
      }
    });
  }

  _killChild(child) {
    if (!child || child.exitCode !== null) return;
    try { child.kill(); } catch (e) {}
    if (process.platform === 'win32' && child.pid) {
      setTimeout(function () {
        if (child.exitCode !== null) return;
        try {
          execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, function () {});
        } catch (e) {}
      }, 500);
    } else {
      setTimeout(function () {
        if (child.exitCode === null) { try { child.kill('SIGKILL'); } catch (e) {} }
      }, 1000);
    }
  }

  /* 停止穿透：删除端口映射 + 关闭子进程 */
  async stop(reason) {
    this._stopped = true;
    this._generation++;
    const tasks = [];

    if (this.upnpResult && typeof this.upnpResult.close === 'function') {
      const handle = this.upnpResult;
      this.upnpResult = null;
      this.log('正在删除 UPnP/NAT-PMP 端口映射…');
      tasks.push(Promise.race([
        handle.close().then(function (r) { return r || { ok: true }; }, function (e) { return { ok: false, error: e.message }; }),
        delay(1200).then(function () { return { ok: false, error: '超时' }; })
      ]));
    }
    if (this.child) {
      const child = this.child;
      this.log('正在停止 ' + (this.childTool || '穿透工具') + ' …');
      this._killChild(child);
      tasks.push(waitExit(child, 1500));
    }
    if (tasks.length) {
      try { await Promise.all(tasks); } catch (e) {}
    }

    this.child = null;
    this.childTool = null;
    this.childStartedAt = 0;
    this.state = 'stopped';
    this.setPublic(null);
    this.log('穿透已停止（' + (reason || '用户操作') + '）。局域网仍然可用。');
    return { ok: true, state: 'stopped', provider: this.provider };
  }
}

module.exports = {
  TOOL_ORDER: TOOL_ORDER,
  TOOL_DEFS: TOOL_DEFS,
  findTool: findTool,
  detectTools: detectTools,
  extractUrl: extractUrl,
  sanitizeUrl: sanitizeUrl,
  parseFrpcIniUrl: parseFrpcIniUrl,
  writeConfigPublicUrl: writeConfigPublicUrl,
  spawnToolProcess: spawnToolProcess,
  TunnelManager: TunnelManager
};