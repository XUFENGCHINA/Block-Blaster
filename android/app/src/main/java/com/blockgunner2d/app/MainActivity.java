package com.blockgunner2d.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.IOException;

/**
 * Block Gunner 2D Android shell.
 *
 * Ships the web game inside the APK and serves it from a loopback HTTP server
 * (http://127.0.0.1:<port>/) so that Service Worker / WebSocket / deep links all
 * behave like on a normal web host. Long-press (or the MENU key) opens a dialog
 * to store the PC LAN server address; it is passed to the page as ?server=ip:port
 * and injected into the game net screen input (#netUrl).
 */
public class MainActivity extends Activity {

    private static final String PREFS = "block_gunner_2d";
    private static final String KEY_SERVER = "server_url";
    private static final int BASE_PORT = 8080;

    private WebView web;
    private LocalHttpServer server;
    private int port = -1;
    private boolean systemUiHidden = false;
    private AlertDialog serverDialog;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        hideSystemUi();

        web = new WebView(this);
        web.setBackgroundColor(0xFF04060B);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        web.setLongClickable(true);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            public boolean onLongClick(View v) {
                showServerDialogIfIdle();
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (web != null) {
                    web.clearHistory(); // BACK always means "leave fullscreen / exit app"
                }
                injectServerParam();
            }
        });

        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        server = new LocalHttpServer(BASE_PORT, new AssetResourceProvider(getAssets()));
        try {
            port = server.start();
        } catch (IOException e) {
            port = -1;
            Toast.makeText(this, "内置服务启动失败，改用 file:// 模式（联机不可用）", Toast.LENGTH_LONG).show();
        }
        loadGame();
    }

    private void loadGame() {
        if (web == null) {
            return;
        }
        if (port <= 0) {
            web.loadUrl("file:///android_asset/www/index.html");
            return;
        }
        String saved = getServerAddress();
        String url = "http://127.0.0.1:" + port + "/index.html";
        if (saved.length() > 0) {
            url = url + "?server=" + Uri.encode(saved);
        }
        web.loadUrl(url);
    }

    /** Reads ?server=ip:port from the page URL and fills the game net input. */
    private void injectServerParam() {
        if (web == null) {
            return;
        }
        String js = "(function(){try{"
                + "var m=/[?&]server=([^&]*)/.exec(location.search||'');"
                + "if(!m)return;"
                + "var v=decodeURIComponent(m[1]);if(!v)return;"
                + "var el=document.getElementById('netUrl');if(!el)return;"
                + "el.value=v;"
                + "try{el.dispatchEvent(new Event('change',{bubbles:true}));}"
                + "catch(e1){try{var ev=document.createEvent('HTMLEvents');"
                + "ev.initEvent('change',true,false);el.dispatchEvent(ev);}catch(e2){}}"
                + "}catch(e){}})();";
        try {
            web.evaluateJavascript(js, null);
        } catch (Throwable ignored) {
            // page not ready yet; onPageFinished will call us again
        }
    }

    private String getServerAddress() {
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        return sp.getString(KEY_SERVER, "");
    }

    private void setServerAddress(String value) {
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (value == null || value.length() == 0) {
            sp.edit().remove(KEY_SERVER).apply();
        } else {
            sp.edit().putString(KEY_SERVER, value).apply();
        }
    }

    private static String cleanAddress(String raw) {
        String v = raw == null ? "" : raw.trim();
        v = v.replace("http://", "").replace("https://", "")
             .replace("ws://", "").replace("wss://", "");
        int slash = v.indexOf('/');
        if (slash >= 0) {
            v = v.substring(0, slash);
        }
        return v.trim();
    }

    private void showServerDialog() {
        if (serverDialog != null && serverDialog.isShowing()) {
            return;
        }
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("例如 192.168.1.7:8080");
        input.setText(getServerAddress());
        input.setSelection(input.getText().length());

        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("联机：PC 服务端地址");
        builder.setMessage("同一 WiFi 下填电脑桌面端显示的局域网地址（IP:端口），留空则不预填；保存后自动重载。进入游戏「联机合作」时会自动填好。");
        builder.setView(input);
        builder.setPositiveButton("保存并重载", new DialogInterface.OnClickListener() {
            public void onClick(DialogInterface dialog, int which) {
                setServerAddress(cleanAddress(input.getText().toString()));
                loadGame();
            }
        });
        builder.setNegativeButton("取消", null);
        builder.setNeutralButton("清空", new DialogInterface.OnClickListener() {
            public void onClick(DialogInterface dialog, int which) {
                setServerAddress("");
                loadGame();
            }
        });
        serverDialog = builder.create();
        serverDialog.show();
    }

    /** Long-press / MENU opens the dialog only when the game is not running. */
    private void showServerDialogIfIdle() {
        if (web == null) {
            showServerDialog();
            return;
        }
        try {
            web.evaluateJavascript(
                    "(function(){try{return (window.Game&&Game.state)?String(Game.state()):'';}catch(e){return '';}})()",
                    new ValueCallback<String>() {
                        public void onReceiveValue(String value) {
                            String v = value == null ? "" : value.toLowerCase();
                            if (v.indexOf("playing") >= 0) {
                                Toast.makeText(MainActivity.this, "游戏中不打开联机设置：先暂停或回主菜单再长按", Toast.LENGTH_SHORT).show();
                            } else {
                                showServerDialog();
                            }
                        }
                    });
        } catch (Throwable t) {
            showServerDialog();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            showServerDialogIfIdle();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        if (serverDialog != null && serverDialog.isShowing()) {
            serverDialog.dismiss();
            return;
        }
        if (systemUiHidden) {
            showSystemUi();
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (systemUiHidden) {
            hideSystemUi();
        }
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        systemUiHidden = true;
    }

    @SuppressWarnings("deprecation")
    private void showSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        systemUiHidden = false;
    }

    @Override
    protected void onDestroy() {
        if (serverDialog != null) {
            try { serverDialog.dismiss(); } catch (Throwable ignored) { }
            serverDialog = null;
        }
        if (server != null) {
            server.stop();
            server = null;
        }
        if (web != null) {
            try { web.stopLoading(); } catch (Throwable ignored) { }
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}