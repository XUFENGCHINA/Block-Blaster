package com.blockgunner2d.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.IOException;

/**
 * Block Gunner 2D Android shell.
 *
 * Ships the web game inside the APK and serves it from a loopback HTTP server
 * (http://127.0.0.1:<port>/) so that Service Worker / WebSocket / deep links all
 * behave like on a normal web host.
 *
 * Server-address entry (never long-press: players hold the screen while playing):
 *   - a small "⚙ 联机" button, visible only on the game main menu / pause screen,
 *     refreshed by polling Game.state() once per second;
 *   - the hardware MENU key;
 *   - the in-game "联机合作" page input (works even without the two entries above).
 * The value is stored in SharedPreferences and passed to the page as ?server=ip:port,
 * where the page also persists it in localStorage['bg2d_net_url'].
 */
public class MainActivity extends Activity {

    private static final String PREFS = "block_gunner_2d";
    private static final String KEY_SERVER = "server_url";
    private static final int BASE_PORT = 8080;
    private static final long STATE_POLL_MS = 1000L;

    /** Returns 'show' only on the main menu / pause screen; otherwise the raw game state. */
    private static final String STATE_JS =
            "(function(){try{"
            + "var st=(typeof Game!=='undefined'&&Game&&typeof Game.state==='function')?String(Game.state()):'idle';"
            + "var menu=!!(document.getElementById('scrMenu')&&document.getElementById('scrMenu').classList.contains('on'));"
            + "var pause=!!(document.getElementById('scrPause')&&document.getElementById('scrPause').classList.contains('on'));"
            + "if(pause||(menu&&st!=='playing'))return 'show';"
            + "return st;"
            + "}catch(e){return 'idle';}})()";

    private WebView web;
    private LocalHttpServer server;
    private int port = -1;
    private boolean systemUiHidden = false;
    private AlertDialog serverDialog;
    private Button connectButton;
    private Handler uiHandler;
    private boolean statePolling = false;

    private final Runnable statePoller = new Runnable() {
        public void run() {
            pollGameState();
            if (statePolling && uiHandler != null) {
                uiHandler.postDelayed(this, STATE_POLL_MS);
            }
        }
    };

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
        uiHandler = new Handler(Looper.getMainLooper());

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
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (web != null) {
                    web.clearHistory(); // BACK always means "leave fullscreen / exit app"
                }
                injectServerParam();
                pollGameState();
            }
        });

        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        connectButton = new Button(this);
        connectButton.setText("⚙ 联机");
        connectButton.setTextSize(12f);
        connectButton.setAllCaps(false);
        connectButton.setTextColor(0xFF9DF0FF);
        GradientDrawable buttonBg = new GradientDrawable();
        buttonBg.setColor(0xCC0E1A2E);
        buttonBg.setStroke(dp(1), 0xFF2B6E86);
        buttonBg.setCornerRadius(dp(8));
        connectButton.setBackground(buttonBg);
        connectButton.setPadding(dp(12), 0, dp(12), 0);
        connectButton.setVisibility(View.GONE);
        connectButton.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                showServerDialog();
            }
        });
        FrameLayout.LayoutParams buttonLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, dp(34));
        buttonLp.gravity = Gravity.TOP | Gravity.LEFT;
        buttonLp.leftMargin = dp(10);
        buttonLp.topMargin = dp(10);
        root.addView(connectButton, buttonLp);
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

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void loadGame() {
        if (web == null) {
            return;
        }
        if (port <= 0) {
            web.loadUrl("file:///android_asset/index.html");
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
                + "var v=decodeURIComponent(m[1].replace(/\\+/g,' '));if(!v)return;"
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

    /** Polls the page once per second and shows the "⚙ 联机" button only in menu/pause. */
    private void pollGameState() {
        if (web == null || connectButton == null) {
            return;
        }
        try {
            web.evaluateJavascript(STATE_JS, new ValueCallback<String>() {
                public void onReceiveValue(String value) {
                    String state = value == null ? "" : value.replace("\"", "").trim();
                    boolean show = "show".equals(state);
                    updateConnectButton(show);
                }
            });
        } catch (Throwable ignored) {
            // WebView not ready yet
        }
    }

    private void updateConnectButton(boolean show) {
        if (connectButton == null) {
            return;
        }
        connectButton.setVisibility(show ? View.VISIBLE : View.GONE);
        if (!show && serverDialog != null && serverDialog.isShowing()) {
            serverDialog.dismiss(); // 进入游戏后自动关掉设置框，避免挡住操作
        }
    }

    private void startStatePolling() {
        if (statePolling || uiHandler == null) {
            return;
        }
        statePolling = true;
        uiHandler.post(statePoller);
    }

    private void stopStatePolling() {
        statePolling = false;
        if (uiHandler != null) {
            uiHandler.removeCallbacks(statePoller);
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
        builder.setTitle("联机：电脑的服务端地址");
        builder.setMessage("填电脑的 192.168.x.x:8080（在电脑上运行 server\\启动服务端.bat 后，日志里会显示这个地址）。"
                + "手机与电脑要在同一 WiFi；也可以进游戏主菜单 → 🌐 联机合作，在页面里直接填。"
                + "地址会自动记住，下次不用再填。");
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

    /** MENU key: same dialog, but never while a round is running. */
    private void showServerDialogIfIdle() {
        if (web == null) {
            showServerDialog();
            return;
        }
        try {
            web.evaluateJavascript(
                    "(function(){try{return (typeof Game!=='undefined'&&Game&&typeof Game.state==='function')?String(Game.state()):'idle';}catch(e){return 'idle';}})()",
                    new ValueCallback<String>() {
                        public void onReceiveValue(String value) {
                            String v = value == null ? "" : value.replace("\"", "").trim().toLowerCase();
                            if ("playing".equals(v)) {
                                Toast.makeText(MainActivity.this, "游戏中不打开联机设置：先暂停或回主菜单再按菜单键", Toast.LENGTH_SHORT).show();
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
        startStatePolling();
    }

    @Override
    protected void onPause() {
        stopStatePolling();
        super.onPause();
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
        stopStatePolling();
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