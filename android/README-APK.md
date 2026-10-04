# 方块枪神 2D · Android APK（离线构建）

把整款网页游戏打包成**真正的 Android APK**：WebView 外壳 + **纯 Java 内置 HTTP 服务器**。
构建过程**完全离线**，不依赖 Gradle / AGP / npm，只用本机 JDK 与 Android SDK 工具链。

- 包名：`com.blockgunner2d.app`
- minSdk 21（Android 5.0+），targetSdk 33
- 横屏、全屏（沉浸式）、保持屏幕常亮、无 ActionBar
- 产物：`dist\方块枪神2D.apk`（同时保留一份 ASCII 名副本 `dist\BlockGunner2D.apk`）

---

## 一、一键构建

```
双击  android\构建APK.bat
```

或先手动同步网页资源、再构建：

```
双击  android\同步资源.bat        （从项目根目录复制 index.html / style.css / sw.js / manifest.webmanifest / js / icons 到 assets，避免维护两份）
双击  android\构建APK.bat
```

构建脚本会自动探测工具链（环境变量优先 + 常见安装目录回退）：

| 依赖 | 用途 | 说明 |
| --- | --- | --- |
| JDK 8 | `javac -bootclasspath android.jar -source/-target 1.8` | 环境变量 `JAVA_HOME`，或 `D:\Program Files\Zulu\zulu-8` 等 |
| JDK/JRE 11+ | 运行 `d8` / `apksigner`（build-tools 34+ 要求 Java 11+） | 例如 `D:\Program Files\Zulu\zulu-17`；脚本自动找 |
| Android SDK | platforms + build-tools | 环境变量 `ANDROID_HOME` / `ANDROID_SDK_ROOT`，或 `%LOCALAPPDATA%\Android\Sdk` 等 |
| build-tools | `aapt2 / aapt / d8 / zipalign / apksigner` | 会自动挑选一个五个工具齐全的版本（本机为 34.0.0 / 36.0.0，实际用了 36.0.0） |

> 不需要联网，不需要 Gradle。JDK 8 只负责编译；dex/sign 用高版本 Java 运行（脚本会分别探测）。

### 采用的构建链路（手工、无 AGP）

```
aapt2 compile --dir res -o compiled_res.zip
aapt2 link -o app-unsigned.apk -I android.jar --manifest AndroidManifest.xml \
      -R compiled_res.zip -A assets --java gen --min-sdk-version 21 --target-sdk-version 33
javac -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath android.jar -d classes <R.java + 源码>
d8 --min-api 21 --lib android.jar --output dex <classes>
aapt add app-unsigned.apk classes.dex
（修正 aapt2 在 Windows 上把 assets 路径写成反斜杠的问题：在 zip 名字段原地把 '\' 改成 '/'）
zipalign -f -p 4 app-unsigned.apk app-aligned.apk
apksigner sign --ks debug.keystore ... --out app-signed.apk app-aligned.apk
```

**为什么在 `%TEMP%` 里构建？** 本项目路径含中文（`工作文件夹`），而 Android 的
`aapt2` 等原生工具打不开非 ASCII 目录。脚本因此先把 `res / assets / java / AndroidManifest.xml`
复制到 `%TEMP%\blockgunner-apk-build`（纯 ASCII 路径）里完成全部工具调用，
最后只用 .NET/PowerShell 把签名好的 APK 复制回 `dist\`。
如果你的 SDK/JDK 安装路径含中文，原生工具仍可能失败，建议放到英文路径。

---

## 二、安装到手机

### USB 调试安装（推荐）

1. 手机开启「开发者选项 → USB 调试」，用数据线连电脑；
2. 执行：

```
C:\Users\XUFEN\AppData\Local\Android\Sdk\platform-tools\adb.exe install -r "dist\方块枪神2D.apk"
```

（构建结束时会直接打印这一行命令；`adb devices` 能看到设备即可。）

### 传文件安装

把 `dist\方块枪神2D.apk` 拷到手机（微信/QQ 传文件、数据线、网盘均可），
在文件管理器里点击安装；Android 8+ 会要求先允许「安装未知应用」。

> APK 使用 **debug keystore** 签名（`android\tools\debug.keystore`，密码 `android`），
> 适合自用/测试分发；上架应用商店需要换成你自己的正式签名。

---

## 三、为什么内置一个本地 HTTP 服务器？

网页游戏直接以 `file://` 打开会带来三个问题：Service Worker 不能注册、WebSocket 受限、
`localStorage` 来源异常。App 启动时用纯 Java `ServerSocket` 在
`http://127.0.0.1:8080/` 上把 APK 里的 `assets/` 服务出来（端口被占用自动 +1，最多试 100 个），
WebView 再打开这个地址，于是：

- Service Worker / 离线缓存正常（`127.0.0.1` 属于安全上下文）；
- 游戏内 WebSocket 联机、`#join=房间码` 深链正常；
- 存档 / 昵称的 `localStorage` 与网页版行为一致；
- `onDestroy` 时关闭服务器。

万一端口全部失败，会退化为 `file:///android_asset/www/index.html`（单机可玩，联机不可用），
并弹出提示。

---

## 四、手机连 PC / 其他设备联机

1. 电脑上双击 `desktop\启动游戏.bat`，记下控制台/窗口里的**局域网地址**，例如
   `http://192.168.1.7:8080/`（也就是 `192.168.1.7:8080`）；
   首次运行请在 Windows 防火墙弹窗里勾选「专用网络 + 公用网络」并允许。
2. 手机与电脑连**同一个 WiFi**。
3. 在 App 内填地址，三种入口任选：

   | 入口 | 说明 |
   | --- | --- |
   | **主菜单左上角「⚙ 联机」按钮** | 只在游戏主菜单 / 暂停时显示，进入游戏自动隐藏；点它填 `192.168.x.x:8080` |
   | **硬件 MENU 键** | 效果同上；游戏中按下只提示先暂停，不会打断操作 |
   | **游戏内「🌐 联机合作」页** | 直接在服务器地址输入框里填 `192.168.x.x:8080`，点创建/加入即可 |

   > 长按屏幕**不再**弹出设置框（玩家本来就要长时间按住屏幕操作摇杆/射击，长按会误触）。

4. **地址只需填一次**：保存后 App 写入 SharedPreferences，并通过
   `?server=192.168.1.7:8080` 传给页面；网页侧再持久化到
   `localStorage['bg2d_net_url']`（优先级：URL 参数 > localStorage > 当前页面地址）。
   下次打开 App、或者直接在手机浏览器/PWA 里玩，都会自动用这个地址；需要修改时再进上面任一入口即可。

---

## 五、安装材质包（.bgpack）

1. 把别人做好的 `.bgpack`（或 `.json`）传到手机存储：微信/QQ 保存到「文件」、数据线拷贝、浏览器下载都行。
2. 打开游戏 → 主菜单 → **🎨 材质包** → 点 **📁 选择 .bgpack 文件**。
3. App 会弹出**系统文件选择器**（SAF `ACTION_GET_CONTENT`，不需要任何存储权限）：
   - 选中后立即解析安装，成功会出现在「已安装材质包」列表里；
   - 系统选择器支持多选（`EXTRA_ALLOW_MULTIPLE`）；当前网页端一次安装一个包（读取第一个文件），多选时请逐个安装；
   - 点返回 / 取消不会崩溃，游戏继续运行。
4. 在列表里点 **启用** 使用；换包点另一个 **启用**，不用了可以 **停用** / **删除**。
   材质包只影响外观，**不会影响关卡进度、金币与图鉴存档**。

> 规格：单个 JSON 文本文件（图片以 data URI 内嵌），最大 4MB，建议背景图压到 1MB 内；
> 格式不对会给出提示。制作方法见 `packaging/TEXTURE-PACK.md`。

> **发版注意（PWA / 网页端）**：只要改动了 `index.html` / `style.css` / `js/*` 等网页资源，
> 就必须把 `sw.js` 里的 `CACHE_NAME` 版本号 +1（当前 `bg2d-v2`，下次 `bg2d-v3`），否则已安装
> PWA 会因「缓存优先」继续使用旧页面，新的材质包入口可能根本不出现。

## 六、已知限制

- **未在真机/模拟器实测**：当前构建环境没有 adb 设备、也没有 AVD，验证采用了
  `aapt2 dump badging` + `aapt list`（zip 内容）+ `apksigner verify` + JVM 单测。
  建议拿到手机后先 `adb install -r` 并打开确认；如真机安装失败请把 `adb logcat` 发回。
- **debug 签名**：自用没问题，正式分发需替换签名。
- **本地服务器端口变化会影响 localStorage 来源**：8080 通常空闲、端口固定；
  若被手机其它应用占用而变成 8081，存档/昵称不会跨端口共享。
- **Android 9+ 明文流量**：manifest 已设置 `android:usesCleartextTraffic="true"`，
  否则 `ws://192.168.x.x` 联机与本地 `http://127.0.0.1` 都会被拦。
- **依赖系统 WebView**：Android 5+ 自带，建议保持「Android System WebView / Chrome」为最新版。
- **锁定横屏、沉浸式全屏**：返回键第一次退出全屏、第二次才退出 App（有弹窗时先关弹窗）。
- **不包含 PC 服务端**：单机不需要；联机需要电脑或另一台设备运行 `server/server.js`。
- **APK 内游戏是打包时的快照**：网页版更新后需重新双击 `构建APK.bat`（会重新同步 assets）。
- 安装包约 0.13 MB；构建中间产物在 `%TEMP%\blockgunner-apk-build` 和 `android\app\src\main\assets\www`。

---

## 七、文件说明

| 路径 | 作用 |
| --- | --- |
| `android\构建APK.bat` | 一键构建（纯 ASCII / 无 BOM），产物到 `dist\方块枪神2D.apk` |
| `android\同步资源.bat` | 只同步网页资源到 `app\src\main\assets\www` |
| `android\tools\build-apk.ps1` | 构建主脚本（探测工具链、staging、aapt2→javac→d8→zipalign→apksigner、校验） |
| `android\tools\sync-assets.ps1` | 资源同步逻辑 |
| `android\tools\jvm-test\LocalHttpServerTest.java` | 内置 HTTP 服务器的 JVM 单测（跑在构建流程里） |
| `android\tools\debug.keystore` | 自动生成的 debug 签名（密码 `android`，首次构建生成） |
| `android\app\src\main\java\...\LocalHttpServer.java` | 纯 Java `ServerSocket` HTTP 服务器 |
| `android\app\src\main\java\...\AssetResourceProvider.java` | 把 `assets/` 根目录读给服务器（带内存缓存） |
| `android\app\src\main\java\...\MainActivity.java` | WebView 外壳、联机地址设置、返回键/全屏处理 |
| `android\app\src\main\AndroidManifest.xml` | 包名 / 权限 / 横屏 / NoActionBar 主题 |
| `android\app\src\main\assets\` | 由同步脚本生成的游戏副本（不要手改） |