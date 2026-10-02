const STORAGE_KEY = 'proxyConfig';

const DEFAULT_CONFIG = {
  enabled: false,
  protocol: 'http',
  host: '127.0.0.1',
  port: '7890',
  proxyDomains: ''
};

async function loadConfig() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Object.assign({}, DEFAULT_CONFIG, data[STORAGE_KEY] || {});
}

async function saveConfig(cfg) {
  await chrome.storage.local.set({ [STORAGE_KEY]: cfg });
}

function buildPacScript(cfg) {
  const lines = [];
  lines.push('function FindProxyForURL(url, host) {');
  lines.push('  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "DIRECT";');

  const proxy = cfg.protocol === 'socks5'
    ? `SOCKS5 ${cfg.host}:${cfg.port}`
    : `PROXY ${cfg.host}:${cfg.port}`;

  const matches = cfg.proxyDomains.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  for (const line of matches) {
    const esc = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    if (line.startsWith('*.')) {
      lines.push(`  if (shExpMatch(host, "${esc}")) return "${proxy}";`);
    } else {
      lines.push(`  if (host === "${esc}" || shExpMatch(host, "*.${esc}")) return "${proxy}";`);
    }
  }

  lines.push('  return "DIRECT";');
  lines.push('}');
  return lines.join('\n');
}

async function applyProxy(cfg) {
  if (cfg.enabled) {
    if (!cfg.host.trim() || !cfg.port.trim()) {
      throw new Error('请填写代理服务器地址和端口');
    }
    const pac = buildPacScript(cfg);
    await chrome.proxy.settings.set({
      value: { mode: 'pac_script', pacScript: { data: pac } },
      scope: 'regular'
    });
  } else {
    await chrome.proxy.settings.set({
      value: { mode: 'system' },
      scope: 'regular'
    });
  }
}

function fillForm(cfg) {
  document.getElementById('enabled').checked = cfg.enabled;
  document.querySelector(`input[name="protocol"][value="${cfg.protocol}"]`).checked = true;
  document.getElementById('host').value = cfg.host;
  document.getElementById('port').value = cfg.port;
  document.getElementById('proxyDomains').value = cfg.proxyDomains;
}

function setMsg(text, ok) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}

async function updateStatus() {
  const cfg = await loadConfig();
  const statusEl = document.getElementById('status');
  let detail = '';
  try {
    const res = await chrome.proxy.settings.get({});
    detail = res.value && res.value.mode === 'pac_script'
      ? '（PAC 脚本已生效）'
      : (res.value ? res.value.mode : '');
  } catch (e) { /* ignore */ }
  const on = cfg.enabled;
  statusEl.textContent = on ? '代理已启用 ' + detail : '代理已停用（浏览器走系统/直连）';
  statusEl.className = 'status ' + (on ? 'on' : 'off');
}

async function main() {
  const cfg = await loadConfig();
  fillForm(cfg);
  await updateStatus();

  document.getElementById('enabled').addEventListener('change', () => {
    document.getElementById('enabled').checked ? setMsg('点击“应用设置”后生效', true)
      : setMsg('点击“应用设置”后停用', false);
  });

  document.getElementById('applyBtn').addEventListener('click', async () => {
    const newCfg = {
      enabled: document.getElementById('enabled').checked,
      protocol: document.querySelector('input[name="protocol"]:checked').value,
      host: document.getElementById('host').value.trim(),
      port: document.getElementById('port').value.trim(),
      proxyDomains: document.getElementById('proxyDomains').value
    };
    try {
      await applyProxy(newCfg);
      await saveConfig(newCfg);
      await updateStatus();
      setMsg(newCfg.enabled ? '已生效：浏览器走代理，其余软件不受影响' : '代理已停用', true);
    } catch (e) {
      setMsg('应用失败：' + e.message, false);
    }
  });

  document.getElementById('disableBtn').addEventListener('click', async () => {
    const cfg = await loadConfig();
    cfg.enabled = false;
    try {
      await applyProxy(cfg);
      await saveConfig(cfg);
      fillForm(cfg);
      await updateStatus();
      setMsg('代理已停用', true);
    } catch (e) {
      setMsg('停用失败：' + e.message, false);
    }
  });

  chrome.proxy.onProxyError.addListener((details) => {
    setMsg('代理错误: ' + (details.error || '未知错误'), false);
  });
}

main();
