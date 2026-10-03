/* ============================================================
   方块枪神 2D · PWA 模块（安装到桌面 / Service Worker 注册）
   - 仅在 https 或 localhost(127.0.0.1) 等安全上下文注册 SW
   - 保存 beforeinstallprompt 事件，供主菜单「📲 安装到桌面」调用
   - iOS 走 navigator.standalone 判断并提示「分享 → 添加到主屏幕」
   ============================================================ */
var PWA = (function () {
  'use strict';

  var deferredPrompt = null;
  var installed = false;
  var swRegistered = false;
  var lastInstallError = '';

  function isStandalone() {
    try {
      if (navigator.standalone === true) return true;                 // iOS 独立窗口
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
      return false;
    } catch (e) { return false; }
  }

  function isLocalhost() {
    var h = (location.hostname || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h === '';
  }

  function isSecure() {
    try {
      if (location.protocol === 'https:') return true;
      if (location.protocol === 'file:') return false;
      if (isLocalhost()) return true;
      return typeof window.isSecureContext === 'boolean' ? window.isSecureContext : false;
    } catch (e) { return false; }
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+ 桌面级 UA：Mac + 多点触控
    return /Mac/.test(navigator.platform || '') && (navigator.maxTouchPoints || 0) > 1;
  }

  function canInstall() {
    if (installed || isStandalone()) return false;
    return !!deferredPrompt || isIOS();
  }

  function toast(msg) {
    try {
      if (window.UI && UI.toast) { UI.toast(msg); return; }
    } catch (e) { /* ignore */ }
    try { console.log('[PWA] ' + msg); } catch (e2) { /* ignore */ }
  }

  function updateInstallButton() {
    var btn = document.getElementById('btnInstall');
    if (!btn) return;
    var show = canInstall();
    btn.classList.toggle('hide', !show);
    if (!show) return;
    if (deferredPrompt) btn.title = '一键安装，从桌面图标独立运行';
    else if (isIOS()) btn.title = 'iOS：Safari 底部「分享」→「添加到主屏幕」';
    else btn.title = '安装到桌面';
  }

  function install() {
    if (installed || isStandalone()) {
      toast('已经在桌面模式独立运行啦');
      updateInstallButton();
      return false;
    }
    if (deferredPrompt) {
      var ev = deferredPrompt;
      deferredPrompt = null;
      try {
        ev.prompt();
        if (ev.userChoice && ev.userChoice.then) {
          ev.userChoice.then(function (choice) {
            if (choice && choice.outcome === 'accepted') {
              installed = true;
              toast('安装成功，从桌面图标启动吧！');
            } else {
              toast('已取消安装，随时可以再点「📲 安装到桌面」');
            }
            updateInstallButton();
          }).catch(function (err) {
            lastInstallError = String(err && err.message ? err.message : err);
            updateInstallButton();
          });
        }
      } catch (e) {
        lastInstallError = String(e && e.message ? e.message : e);
        toast('安装请求失败，请用浏览器菜单里的「安装应用」');
      }
      updateInstallButton();
      return true;
    }
    if (isIOS()) {
      toast('Safari：点底部「分享」→「添加到主屏幕」，横屏打开即是全屏游戏');
      return false;
    }
    toast('当前环境不支持自动安装：请用 https 或本机地址打开，再从浏览器菜单选择「安装应用 / 添加到主屏幕」');
    return false;
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!isSecure()) {
      // 局域网 http://192.168.x.x 不是安全上下文，浏览器不允许注册 SW
      return;
    }
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (reg) {
      swRegistered = true;
      // 有新版本就后台更新，下次启动生效
      try { if (reg && reg.update) reg.update(); } catch (e) { /* ignore */ }
    }).catch(function (err) {
      swRegistered = false;
      var msg = String(err && err.message ? err.message : err);
      if (window.console && console.warn) console.warn('[PWA] Service Worker 注册失败：' + msg);
    });
  }

  function init() {
    installed = isStandalone();
    // 已装为独立应用后，浏览器不再触发 beforeinstallprompt，隐藏按钮
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      updateInstallButton();
    });
    window.addEventListener('appinstalled', function () {
      installed = true;
      deferredPrompt = null;
      toast('已安装到桌面！');
      updateInstallButton();
    });
    try {
      if (window.matchMedia) {
        var mq = window.matchMedia('(display-mode: standalone)');
        var onChange = function () { if (isStandalone()) { installed = true; updateInstallButton(); } };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    } catch (e) { /* ignore */ }

    registerServiceWorker();
    updateInstallButton();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', updateInstallButton);
    }
  }

  return {
    init: init,
    canInstall: canInstall,
    install: install,
    isStandalone: isStandalone,
    isIOS: isIOS,
    isSecure: isSecure,
    hasServiceWorker: function () { return swRegistered; },
    installError: function () { return lastInstallError; },
    promptEvent: function () { return deferredPrompt; },
    updateInstallButton: updateInstallButton
  };
})();

if (typeof window !== 'undefined') window.PWA = PWA;