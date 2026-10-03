// ============================================================================
//  方块枪神 2D · Windows 启动器（Launcher.cs）
//  .NET Framework 4.0 / C# 4 语法，Windows 自带 csc.exe 可直接离线编译：
//    csc /nologo /target:winexe /codepage:65001 /out:dist\方块枪神2D.exe
//        /reference:System.dll /reference:System.Core.dll
//        /reference:System.Drawing.dll /reference:System.Windows.Forms.dll
//        packaging\exe\Launcher.cs
//
//  功能：
//    · 一键启动本地联机服务 node server/server.js（端口被占用自动 8080→8081→…）
//    · 轮询 /healthz 就绪后用 Edge / Chrome --app 打开无边框游戏窗口
//    · 显示局域网 / 公网 / 房间码深链地址，一键复制联机地址
//    · 停止服务只结束本启动器拉起的 node 进程，关闭窗口自动清理
//    · 可选开机自启（HKCU\Software\Microsoft\Windows\CurrentVersion\Run）
//    · 无头自检：方块枪神2D.exe --selftest [--port=18080]
//        起服务 → /healthz 返回 200 → 停止 → 端口释放 → 写日志 → 退出码 0/PASS
// ============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace BlockGunner2D
{
    internal sealed class LauncherOptions
    {
        public bool SelfTest;
        public bool AutoStart;
        public bool NoBrowser;
        public int Port;
        public int ReadyTimeoutMs;
        public string GameRoot;
        public string LogFile;

        public LauncherOptions()
        {
            ReadyTimeoutMs = 30000;
        }

        public static LauncherOptions Parse(string[] args)
        {
            LauncherOptions o = new LauncherOptions();
            if (args == null) return o;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i] == null ? "" : args[i];
                string low = a.ToLowerInvariant();
                if (low == "--selftest" || low == "--self-test" || low == "--dry-run")
                {
                    o.SelfTest = true;
                }
                else if (low == "--autostart" || low == "--auto-start")
                {
                    o.AutoStart = true;
                    o.NoBrowser = true;
                }
                else if (low == "--no-browser")
                {
                    o.NoBrowser = true;
                }
                else if (low.StartsWith("--port="))
                {
                    int p;
                    if (int.TryParse(a.Substring(7), NumberStyles.Integer, CultureInfo.InvariantCulture, out p)
                        && p > 0 && p <= 65535) o.Port = p;
                }
                else if (low == "--port" && i + 1 < args.Length)
                {
                    int p;
                    if (int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out p)
                        && p > 0 && p <= 65535) { o.Port = p; i++; }
                }
                else if (low.StartsWith("--root="))
                {
                    o.GameRoot = a.Substring(7);
                }
                else if (low.StartsWith("--log="))
                {
                    o.LogFile = a.Substring(6);
                }
                else if (low.StartsWith("--timeout="))
                {
                    int t;
                    if (int.TryParse(a.Substring(10), NumberStyles.Integer, CultureInfo.InvariantCulture, out t)
                        && t >= 1000) o.ReadyTimeoutMs = t;
                }
            }
            return o;
        }
    }

    internal sealed class GameServer : IDisposable
    {
        private Process _proc;
        private readonly StringBuilder _log;
        private readonly object _logLock;

        public string GameRoot { get; private set; }
        public string ServerJs { get; private set; }
        public string NodePath { get; private set; }
        public int Port { get; private set; }

        public GameServer(string gameRoot, string nodePath)
        {
            GameRoot = gameRoot;
            NodePath = nodePath;
            ServerJs = Path.Combine(gameRoot, "server", "server.js");
            _log = new StringBuilder();
            _logLock = new object();
        }

        public bool Running
        {
            get
            {
                Process p = _proc;
                if (p == null) return false;
                try { return !p.HasExited; }
                catch { return false; }
            }
        }

        public int ProcessId
        {
            get
            {
                Process p = _proc;
                if (p == null) return 0;
                try { return p.Id; }
                catch { return 0; }
            }
        }

        // ------------------------------------------------------------------
        // 路径与进程发现
        // ------------------------------------------------------------------

        public static string GetExeDir()
        {
            try
            {
                Assembly a = Assembly.GetEntryAssembly();
                if (a != null && !String.IsNullOrEmpty(a.Location))
                {
                    string d = Path.GetDirectoryName(a.Location);
                    if (!String.IsNullOrEmpty(d)) return d;
                }
            }
            catch { }
            try
            {
                string d2 = Path.GetDirectoryName(Application.ExecutablePath);
                if (!String.IsNullOrEmpty(d2)) return d2;
            }
            catch { }
            return Environment.CurrentDirectory;
        }

        // exe 放在 dist\ 时游戏文件在 dist\方块枪神2D\；开发时也允许 exe 与 server\ 同级。
        public static string ResolveGameRoot(string overrideRoot)
        {
            if (!String.IsNullOrEmpty(overrideRoot)) return overrideRoot;
            string exeDir = GetExeDir();
            string sub = Path.Combine(exeDir, "方块枪神2D");
            if (File.Exists(Path.Combine(sub, "server", "server.js"))) return sub;
            if (File.Exists(Path.Combine(exeDir, "server", "server.js"))) return exeDir;
            return sub;
        }

        public static string FindNode()
        {
            string env = Environment.GetEnvironmentVariable("BG_NODE");
            if (!String.IsNullOrEmpty(env) && File.Exists(env)) return env;

            List<string> cand = new List<string>();
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!String.IsNullOrEmpty(pf)) cand.Add(Path.Combine(pf, @"nodejs\node.exe"));
            if (!String.IsNullOrEmpty(pf86)) cand.Add(Path.Combine(pf86, @"nodejs\node.exe"));
            if (!String.IsNullOrEmpty(local)) cand.Add(Path.Combine(local, @"Programs\nodejs\node.exe"));
            cand.Add(@"C:\Program Files\nodejs\node.exe");
            cand.Add(@"C:\Program Files (x86)\nodejs\node.exe");
            for (int i = 0; i < cand.Count; i++)
            {
                if (File.Exists(cand[i])) return cand[i];
            }

            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (!String.IsNullOrEmpty(pathEnv))
            {
                string[] dirs = pathEnv.Split(';');
                for (int i = 0; i < dirs.Length; i++)
                {
                    string d = dirs[i].Trim().Trim('"');
                    if (d.Length == 0) continue;
                    try
                    {
                        string f = Path.Combine(d, "node.exe");
                        if (File.Exists(f)) return f;
                    }
                    catch { }
                }
            }
            return null;
        }

        // ------------------------------------------------------------------
        // 端口与健康检查
        // ------------------------------------------------------------------

        public static bool IsPortFree(int port)
        {
            if (port <= 0 || port > 65535) return false;
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Any, port);
                listener.Start();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (listener != null)
                {
                    try { listener.Stop(); }
                    catch { }
                }
            }
        }

        public static int ChoosePort(int preferred, int attempts)
        {
            if (preferred <= 0) preferred = 8080;
            if (attempts <= 0) attempts = 20;
            int last = preferred + attempts - 1;
            if (last > 65535) last = 65535;
            for (int p = preferred; p <= last; p++)
            {
                if (IsPortFree(p)) return p;
            }
            return 0;
        }

        public static bool CheckHealth(int port, int timeoutMs, out string body)
        {
            body = null;
            HttpWebResponse resp = null;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(
                    "http://127.0.0.1:" + port.ToString(CultureInfo.InvariantCulture) + "/healthz");
                req.Method = "GET";
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.Proxy = null;
                req.KeepAlive = false;
                req.UserAgent = "BlockGunner2D-Launcher";
                resp = (HttpWebResponse)req.GetResponse();
                if ((int)resp.StatusCode != 200) return false;
                using (Stream s = resp.GetResponseStream())
                using (StreamReader r = new StreamReader(s, Encoding.UTF8))
                {
                    body = r.ReadToEnd();
                }
                return !String.IsNullOrEmpty(body) && body.IndexOf("\"ok\"", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (resp != null)
                {
                    try { resp.Close(); }
                    catch { }
                }
            }
        }

        public static bool TcpConnect(int port, int timeoutMs)
        {
            TcpClient c = null;
            try
            {
                c = new TcpClient();
                IAsyncResult ar = c.BeginConnect(IPAddress.Loopback, port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(timeoutMs, false)) return false;
                c.EndConnect(ar);
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (c != null)
                {
                    try { c.Close(); }
                    catch { }
                }
            }
        }

        public static string Shorten(string s, int max)
        {
            if (s == null) return "";
            s = s.Replace("\r", " ").Replace("\n", " ").Trim();
            if (s.Length <= max) return s;
            return s.Substring(0, max) + "…";
        }

        // ------------------------------------------------------------------
        // 启动 / 等待就绪 / 停止
        // ------------------------------------------------------------------

        public bool Start(int preferredPort, out string error)
        {
            error = null;
            if (Running) return true;
            if (_proc != null) Stop();

            if (String.IsNullOrEmpty(NodePath))
            {
                error = "未找到 Node.js（node.exe）。\n\n联机功能需要 Node.js LTS，请从 https://nodejs.org/ 安装后重试；\n只玩单机可直接用浏览器打开游戏目录里的 index.html。";
                return false;
            }
            if (!File.Exists(NodePath))
            {
                error = "Node.js 路径不存在：" + NodePath;
                return false;
            }
            if (!File.Exists(ServerJs))
            {
                error = "未找到服务端脚本：\n" + ServerJs + "\n\n请确认 dist\\方块枪神2D\\ 目录完整（重新运行 packaging\\exe\\打包EXE.bat 可重新打包）。";
                return false;
            }

            int port = ChoosePort(preferredPort, 20);
            if (port == 0)
            {
                error = "从端口 " + preferredPort + " 起连续 20 个端口都被占用。\n请先关闭占用端口的程序再试。";
                return false;
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = NodePath;
            psi.Arguments = QuoteArg(ServerJs) + " --port=" + port.ToString(CultureInfo.InvariantCulture);
            psi.WorkingDirectory = GameRoot;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;

            Process p = new Process();
            p.StartInfo = psi;
            p.OutputDataReceived += new DataReceivedEventHandler(OnNodeOutput);
            p.ErrorDataReceived += new DataReceivedEventHandler(OnNodeError);

            try
            {
                if (!p.Start())
                {
                    error = "node 进程启动失败。";
                    try { p.Dispose(); }
                    catch { }
                    return false;
                }
            }
            catch (Exception ex)
            {
                error = "启动 node 失败：" + ex.Message;
                try { p.Dispose(); }
                catch { }
                return false;
            }

            Port = port;
            _proc = p;
            try { p.BeginOutputReadLine(); }
            catch { }
            try { p.BeginErrorReadLine(); }
            catch { }
            return true;
        }

        public bool WaitHealthy(int timeoutMs, out long elapsedMs, out string body)
        {
            Stopwatch sw = Stopwatch.StartNew();
            body = null;
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                Process p = _proc;
                if (p == null) break;
                bool exited = false;
                try { exited = p.HasExited; }
                catch { }
                if (exited)
                {
                    Thread.Sleep(150);
                    string b;
                    if (CheckHealth(Port, 600, out b)) { body = b; elapsedMs = sw.ElapsedMilliseconds; return true; }
                    break;
                }
                string hb;
                if (CheckHealth(Port, 700, out hb))
                {
                    body = hb;
                    elapsedMs = sw.ElapsedMilliseconds;
                    return true;
                }
                Thread.Sleep(250);
            }
            elapsedMs = sw.ElapsedMilliseconds;
            return false;
        }

        // 只结束本启动器拉起的 node 进程，绝不按名字杀其它 node。
        public void Stop()
        {
            Process p = _proc;
            _proc = null;
            if (p == null) return;
            try
            {
                if (!p.HasExited) p.Kill();
            }
            catch { }
            try { p.WaitForExit(5000); }
            catch { }
            try { p.Dispose(); }
            catch { }
        }

        public string LogTail(int maxChars)
        {
            lock (_logLock)
            {
                if (_log.Length == 0) return "";
                if (maxChars <= 0 || maxChars >= _log.Length) return _log.ToString();
                return _log.ToString(_log.Length - maxChars, maxChars);
            }
        }

        private static string QuoteArg(string s)
        {
            if (String.IsNullOrEmpty(s)) return "\"\"";
            if (s.IndexOf(' ') < 0 && s.IndexOf('\t') < 0 && s.IndexOf('"') < 0) return s;
            return "\"" + s.Replace("\"", "\\\"") + "\"";
        }

        private void OnNodeOutput(object sender, DataReceivedEventArgs e)
        {
            AppendLog(e == null ? null : e.Data);
        }

        private void OnNodeError(object sender, DataReceivedEventArgs e)
        {
            AppendLog(e == null ? null : e.Data);
        }

        private void AppendLog(string line)
        {
            if (line == null) return;
            lock (_logLock)
            {
                _log.AppendLine(line);
                if (_log.Length > 60000)
                {
                    _log.Remove(0, _log.Length - 40000);
                }
            }
        }

        public void Dispose()
        {
            Stop();
            GC.SuppressFinalize(this);
        }
    }
    internal static class NetInfo
    {
        public static string GetLanIPv4()
        {
            try
            {
                NetworkInterface[] nics = NetworkInterface.GetAllNetworkInterfaces();
                string best = null;
                string virt = null;
                string any = null;
                for (int i = 0; i < nics.Length; i++)
                {
                    NetworkInterface ni = nics[i];
                    try
                    {
                        if (ni.OperationalStatus != OperationalStatus.Up) continue;
                        if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                        if (ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                        bool isVirtual = IsVirtualName(ni.Name + " " + ni.Description);
                        UnicastIPAddressInformationCollection addrs = ni.GetIPProperties().UnicastAddresses;
                        foreach (UnicastIPAddressInformation a in addrs)
                        {
                            if (a == null || a.Address == null) continue;
                            if (a.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                            string ip = a.Address.ToString();
                            if (ip.StartsWith("127.") || ip.StartsWith("169.254.")) continue;
                            bool isPrivate = ip.StartsWith("192.168.") || ip.StartsWith("10.") || IsPrivate172(ip);
                            if (isPrivate)
                            {
                                if (!isVirtual)
                                {
                                    if (best == null) best = ip;
                                }
                                else
                                {
                                    if (virt == null) virt = ip;
                                }
                            }
                            else
                            {
                                if (any == null) any = ip;
                            }
                        }
                    }
                    catch { }
                }
                if (best != null) return best;
                if (virt != null) return virt;
                if (any != null) return any;
            }
            catch { }
            return "127.0.0.1";
        }

        private static bool IsVirtualName(string s)
        {
            if (String.IsNullOrEmpty(s)) return false;
            string v = s.ToLowerInvariant();
            string[] keys = new string[] {
                "virtual", "vmware", "hyper-v", "vethernet", "wsl", "loopback",
                "docker", "virtualbox", "tap-", "tun", "radmin", "tailscale", "zerotier"
            };
            for (int i = 0; i < keys.Length; i++)
            {
                if (v.IndexOf(keys[i], StringComparison.Ordinal) >= 0) return true;
            }
            return false;
        }

        private static bool IsPrivate172(string ip)
        {
            string[] p = ip.Split('.');
            if (p.Length != 4) return false;
            int a;
            int b;
            if (!int.TryParse(p[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out a)) return false;
            if (!int.TryParse(p[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out b)) return false;
            return a == 172 && b >= 16 && b <= 31;
        }

        // 读取 server/config.json 里的 publicUrl 与 port（不依赖 JSON 库）。
        public static void ReadServerConfig(string gameRoot, out string publicUrl, out int port)
        {
            publicUrl = "";
            port = 0;
            try
            {
                string file = Path.Combine(gameRoot, "server", "config.json");
                if (!File.Exists(file)) return;
                string text = File.ReadAllText(file, Encoding.UTF8);
                Match m = Regex.Match(text, "\"publicUrl\"\\s*:\\s*\"([^\"]*)\"");
                if (m.Success) publicUrl = m.Groups[1].Value.Trim();
                Match mp = Regex.Match(text, "\"port\"\\s*:\\s*(\\d{2,5})");
                if (mp.Success)
                {
                    int v;
                    if (int.TryParse(mp.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)
                        && v >= 1 && v <= 65535) port = v;
                }
            }
            catch { }
        }
    }

    internal static class BrowserLauncher
    {
        public static string FindBrowser()
        {
            List<string> cand = new List<string>();
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!String.IsNullOrEmpty(pf86)) cand.Add(Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"));
            if (!String.IsNullOrEmpty(pf)) cand.Add(Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"));
            if (!String.IsNullOrEmpty(pf)) cand.Add(Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"));
            if (!String.IsNullOrEmpty(pf86)) cand.Add(Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"));
            if (!String.IsNullOrEmpty(local)) cand.Add(Path.Combine(local, @"Google\Chrome\Application\chrome.exe"));
            cand.Add(@"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe");
            cand.Add(@"C:\Program Files\Microsoft\Edge\Application\msedge.exe");
            for (int i = 0; i < cand.Count; i++)
            {
                try
                {
                    if (File.Exists(cand[i])) return cand[i];
                }
                catch { }
            }
            return null;
        }

        public static bool OpenApp(string url, out string error)
        {
            error = null;
            string browser = FindBrowser();
            try
            {
                if (browser != null)
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = browser;
                    psi.Arguments = "--app=" + url + " --window-size=1280,760";
                    psi.UseShellExecute = false;
                    Process.Start(psi);
                    return true;
                }
                Process.Start(url);
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }
    }

    internal static class AutoStartRegistry
    {
        private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ValueName = "BlockGunner2D";

        public static bool IsEnabled()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKeyPath, false))
                {
                    if (k == null) return false;
                    object v = k.GetValue(ValueName);
                    return v != null && Convert.ToString(v).Length > 0;
                }
            }
            catch
            {
                return false;
            }
        }

        public static void SetEnabled(bool enabled)
        {
            using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKeyPath))
            {
                if (k == null) throw new InvalidOperationException("无法打开 HKCU 的 Run 注册表项");
                if (enabled)
                {
                    string exe = GameServer.GetExeDir();
                    string full = Path.Combine(exe, "方块枪神2D.exe");
                    if (File.Exists(full)) exe = full;
                    else
                    {
                        try
                        {
                            Assembly a = Assembly.GetEntryAssembly();
                            if (a != null && !String.IsNullOrEmpty(a.Location)) exe = a.Location;
                        }
                        catch { }
                    }
                    string cmd = "\"" + exe + "\" --autostart --no-browser";
                    k.SetValue(ValueName, cmd, RegistryValueKind.String);
                }
                else
                {
                    try { k.DeleteValue(ValueName, false); }
                    catch { }
                }
            }
        }
    }
    internal sealed class MainForm : Form
    {
        private readonly LauncherOptions _opt;
        private readonly GameServer _server;
        private readonly string _lanIp;
        private readonly string _publicUrl;
        private readonly int _configPort;

        private Label _statusLabel;
        private Label _lanLabel;
        private Label _pubLabel;
        private Label _deepLabel;
        private Label _localLabel;
        private Label _nodeLabel;
        private Button _startButton;
        private Button _copyButton;
        private Button _netButton;
        private Button _stopButton;
        private CheckBox _autoStartBox;
        private bool _suppressAutoStart;
        private bool _closing;
        private bool _starting;

        public MainForm(LauncherOptions opt)
        {
            _opt = opt;
            string gameRoot = GameServer.ResolveGameRoot(opt.GameRoot);
            string nodePath = GameServer.FindNode();
            _server = new GameServer(gameRoot, nodePath);
            _lanIp = NetInfo.GetLanIPv4();
            string pubUrl;
            int cfgPort;
            NetInfo.ReadServerConfig(gameRoot, out pubUrl, out cfgPort);
            _publicUrl = pubUrl;
            _configPort = cfgPort > 0 ? cfgPort : 8080;
            BuildUi(gameRoot, nodePath);
            UpdateUrls();
            SetStatus("未启动（点「开始游戏」一键启动联机服务并打开窗口）", Color.DimGray);
        }

        private void BuildUi(string gameRoot, string nodePath)
        {
            Text = "方块枪神 2D";
            ClientSize = new Size(700, 500);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Font;
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            Icon = LoadAppIcon();
            try { BackColor = Color.FromArgb(246, 248, 251); }
            catch { }

            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.Padding = new Padding(14, 10, 14, 10);
            root.ColumnCount = 1;
            root.RowCount = 5;
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42F));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 30F));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 162F));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 56F));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            Controls.Add(root);

            Label title = new Label();
            title.Text = "方块枪神 2D · Windows 启动器";
            title.Font = new Font("Microsoft YaHei UI", 14F, FontStyle.Bold, GraphicsUnit.Point);
            title.Dock = DockStyle.Fill;
            title.TextAlign = ContentAlignment.MiddleLeft;
            root.Controls.Add(title, 0, 0);

            _statusLabel = new Label();
            _statusLabel.Dock = DockStyle.Fill;
            _statusLabel.TextAlign = ContentAlignment.MiddleLeft;
            _statusLabel.Font = new Font(Font, FontStyle.Bold);
            _statusLabel.AutoEllipsis = true;
            root.Controls.Add(_statusLabel, 0, 1);

            GroupBox box = new GroupBox();
            box.Text = "联机地址（同一 Wi-Fi / 局域网内的玩家用局域网地址）";
            box.Dock = DockStyle.Fill;
            root.Controls.Add(box, 0, 2);

            TableLayoutPanel grid = new TableLayoutPanel();
            grid.Dock = DockStyle.Fill;
            grid.Padding = new Padding(10, 4, 10, 4);
            grid.ColumnCount = 2;
            grid.RowCount = 4;
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100F));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            for (int r = 0; r < 4; r++)
            {
                grid.RowStyles.Add(new RowStyle(SizeType.Percent, 25F));
            }
            box.Controls.Add(grid);

            _lanLabel = AddInfoRow(grid, 0, "局域网");
            _pubLabel = AddInfoRow(grid, 1, "公网");
            _deepLabel = AddInfoRow(grid, 2, "房间码深链");
            _localLabel = AddInfoRow(grid, 3, "本机联机页");

            FlowLayoutPanel buttons = new FlowLayoutPanel();
            buttons.Dock = DockStyle.Fill;
            buttons.FlowDirection = FlowDirection.LeftToRight;
            buttons.WrapContents = false;
            buttons.Padding = new Padding(0, 10, 0, 0);
            root.Controls.Add(buttons, 0, 3);

            _startButton = MakeButton("开始游戏", 112, true);
            _startButton.Click += OnStartClick;
            _copyButton = MakeButton("复制联机地址", 126, false);
            _copyButton.Click += OnCopyClick;
            _netButton = MakeButton("打开联机页", 112, false);
            _netButton.Click += OnNetClick;
            _stopButton = MakeButton("停止服务", 100, false);
            _stopButton.Click += OnStopClick;
            buttons.Controls.Add(_startButton);
            buttons.Controls.Add(_copyButton);
            buttons.Controls.Add(_netButton);
            buttons.Controls.Add(_stopButton);

            TableLayoutPanel foot = new TableLayoutPanel();
            foot.Dock = DockStyle.Fill;
            foot.ColumnCount = 1;
            foot.RowCount = 2;
            foot.RowStyles.Add(new RowStyle(SizeType.Absolute, 30F));
            foot.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            root.Controls.Add(foot, 0, 4);

            _autoStartBox = new CheckBox();
            _autoStartBox.Text = "开机自动启动服务（只写当前用户注册表，无需管理员）";
            _autoStartBox.AutoSize = true;
            _autoStartBox.CheckedChanged += OnAutoStartChanged;
            foot.Controls.Add(_autoStartBox, 0, 0);

            _nodeLabel = new Label();
            _nodeLabel.Dock = DockStyle.Fill;
            _nodeLabel.AutoEllipsis = true;
            _nodeLabel.ForeColor = Color.Gray;
            if (String.IsNullOrEmpty(nodePath))
            {
                _nodeLabel.Text = "未找到 Node.js —— 单机可直接用浏览器打开 index.html；联机需要安装 Node.js LTS（https://nodejs.org/）。";
            }
            else
            {
                _nodeLabel.Text = "Node.js：" + nodePath + "\n游戏目录：" + gameRoot;
            }
            foot.Controls.Add(_nodeLabel, 0, 1);

            _suppressAutoStart = true;
            try { _autoStartBox.Checked = AutoStartRegistry.IsEnabled(); }
            catch { }
            _suppressAutoStart = false;

            Shown += OnFormShown;
            FormClosing += OnFormClosing;
        }

        private static Button MakeButton(string text, int width, bool primary)
        {
            Button b = new Button();
            b.Text = text;
            b.Width = width;
            b.Height = 34;
            b.Margin = new Padding(0, 0, 10, 0);
            b.UseVisualStyleBackColor = true;
            if (primary)
            {
                b.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold, GraphicsUnit.Point);
                b.BackColor = Color.FromArgb(42, 120, 214);
                b.ForeColor = Color.White;
                b.FlatStyle = FlatStyle.Flat;
                b.FlatAppearance.BorderSize = 0;
            }
            return b;
        }

        private static Label AddInfoRow(TableLayoutPanel grid, int row, string key)
        {
            Label k = new Label();
            k.Text = key + "：";
            k.Dock = DockStyle.Fill;
            k.TextAlign = ContentAlignment.MiddleLeft;
            k.ForeColor = Color.FromArgb(90, 90, 90);
            grid.Controls.Add(k, 0, row);

            Label v = new Label();
            v.Dock = DockStyle.Fill;
            v.TextAlign = ContentAlignment.MiddleLeft;
            v.AutoEllipsis = true;
            grid.Controls.Add(v, 1, row);
            return v;
        }

        private static Icon LoadAppIcon()
        {
            try
            {
                Icon ic = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (ic != null) return ic;
            }
            catch { }
            return null;
        }
        // ------------------------------------------------------------------
        // 状态与地址显示
        // ------------------------------------------------------------------

        private void SetStatus(string text, Color color)
        {
            if (_statusLabel == null) return;
            _statusLabel.Text = "状态：" + text;
            _statusLabel.ForeColor = color;
        }

        private void UpdateUrls()
        {
            int port = _server.Running ? _server.Port : _configPort;
            if (_lanLabel != null) _lanLabel.Text = "http://" + _lanIp + ":" + port + "/";
            if (_pubLabel != null)
            {
                if (!String.IsNullOrEmpty(_publicUrl))
                {
                    _pubLabel.Text = _publicUrl.TrimEnd('/') + "/";
                }
                else
                {
                    _pubLabel.Text = "未配置（可在 server/config.json 填 publicUrl；联机服务端开启内网穿透后会自动写回）";
                }
            }
            if (_deepLabel != null)
            {
                _deepLabel.Text = "http://" + _lanIp + ":" + port + "/#join=房间码（把「房间码」换成房主屏幕上的 4 位码，手机可直接打开）";
            }
            if (_localLabel != null) _localLabel.Text = "http://127.0.0.1:" + port + "/#net（联机大厅）";
        }

        private void Ui(Action action)
        {
            if (_closing || IsDisposed) return;
            try
            {
                if (InvokeRequired) BeginInvoke(action);
                else action();
            }
            catch (ObjectDisposedException) { }
            catch (InvalidOperationException) { }
        }

        // ------------------------------------------------------------------
        // 按钮事件
        // ------------------------------------------------------------------

        private void OnFormShown(object sender, EventArgs e)
        {
            if (_opt.AutoStart)
            {
                StartAndOpen("");
            }
            else
            {
                SetStatus("未启动（点「开始游戏」一键启动联机服务并打开窗口）", Color.DimGray);
            }
        }

        private void OnStartClick(object sender, EventArgs e)
        {
            StartAndOpen("");
        }

        private void OnNetClick(object sender, EventArgs e)
        {
            StartAndOpen("#net");
        }

        private void StartAndOpen(string hash)
        {
            if (_closing) return;
            if (_starting)
            {
                SetStatus("正在启动服务，请稍候…", Color.DarkOrange);
                return;
            }
            if (_server.Running)
            {
                if (!_opt.NoBrowser) OpenWithBrowser(hash);
                else SetStatus("服务运行中，端口 " + _server.Port + "（已跳过打开浏览器）", Color.SeaGreen);
                return;
            }

            _starting = true;
            _startButton.Enabled = false;
            string error;
            int preferred = _opt.Port > 0 ? _opt.Port : _configPort;
            if (!_server.Start(preferred, out error))
            {
                _starting = false;
                _startButton.Enabled = true;
                SetStatus("启动失败：" + FirstLine(error), Color.Firebrick);
                MessageBox.Show(this, error, "方块枪神 2D · 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            int port = _server.Port;
            SetStatus("正在启动服务… node PID " + _server.ProcessId + "，端口 " + port, Color.DarkOrange);
            UpdateUrls();

            string wantHash = hash == null ? "" : hash;
            Thread worker = new Thread(delegate()
            {
                long ms;
                string body;
                bool ok = _server.WaitHealthy(_opt.ReadyTimeoutMs, out ms, out body);
                if (ok)
                {
                    Ui(delegate()
                    {
                        _starting = false;
                        _startButton.Enabled = true;
                        SetStatus("服务运行中，端口 " + port + "（node PID " + _server.ProcessId + "，健康检查 " + ms + " ms）", Color.SeaGreen);
                        UpdateUrls();
                        if (!_opt.NoBrowser) OpenWithBrowser(wantHash);
                    });
                }
                else
                {
                    string tail = _server.LogTail(1600);
                    _server.Stop();
                    Ui(delegate()
                    {
                        _starting = false;
                        _startButton.Enabled = true;
                        SetStatus("启动失败：服务在 " + (_opt.ReadyTimeoutMs / 1000) + " 秒内未就绪", Color.Firebrick);
                        UpdateUrls();
                        MessageBox.Show(this,
                            "服务没有在限定时间内就绪（端口 " + port + "）。\n\nnode 输出：\n" + GameServer.Shorten(tail, 1200),
                            "方块枪神 2D · 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    });
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void OpenWithBrowser(string hash)
        {
            string url = "http://127.0.0.1:" + _server.Port + "/" + (String.IsNullOrEmpty(hash) ? "" : hash);
            string error;
            if (BrowserLauncher.OpenApp(url, out error))
            {
                SetStatus("服务运行中，端口 " + _server.Port + "，已打开游戏窗口", Color.SeaGreen);
            }
            else
            {
                SetStatus("服务已启动，但打开浏览器失败：" + FirstLine(error), Color.DarkOrange);
                MessageBox.Show(this,
                    "服务已启动，但未能打开 Edge/Chrome：\n" + error + "\n\n可点「复制联机地址」后手动粘贴到浏览器。",
                    "方块枪神 2D", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OnCopyClick(object sender, EventArgs e)
        {
            int port = _server.Running ? _server.Port : _configPort;
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("方块枪神 2D 联机地址");
            sb.AppendLine("局域网: http://" + _lanIp + ":" + port + "/");
            if (!String.IsNullOrEmpty(_publicUrl))
            {
                sb.AppendLine("公网: " + _publicUrl.TrimEnd('/') + "/");
            }
            else
            {
                sb.AppendLine("公网: 未配置（server/config.json 的 publicUrl 为空）");
            }
            sb.AppendLine("本机: http://127.0.0.1:" + port + "/");
            sb.AppendLine("联机页: http://127.0.0.1:" + port + "/#net");
            sb.AppendLine("房间码深链: http://" + _lanIp + ":" + port + "/#join=ABCD（把 ABCD 换成游戏内 4 位房间码）");
            if (!_server.Running) sb.AppendLine("（服务当前未启动，请先点「开始游戏」）");
            string text = sb.ToString();
            if (TrySetClipboard(text))
            {
                SetStatus("已复制联机地址到剪贴板", Color.SeaGreen);
            }
            else
            {
                SetStatus("复制失败：剪贴板被其它程序占用，请重试", Color.Firebrick);
            }
        }

        private static bool TrySetClipboard(string text)
        {
            for (int i = 0; i < 5; i++)
            {
                try
                {
                    Clipboard.SetText(text);
                    return true;
                }
                catch
                {
                    Thread.Sleep(120);
                }
            }
            return false;
        }

        private void OnStopClick(object sender, EventArgs e)
        {
            if (!_server.Running)
            {
                SetStatus("服务未运行，无需停止", Color.DimGray);
                return;
            }
            int port = _server.Port;
            _server.Stop();
            _starting = false;
            _startButton.Enabled = true;
            SetStatus("服务已停止，端口 " + port + " 已释放", Color.DimGray);
            UpdateUrls();
            if (!_opt.AutoStart)
            {
                MessageBox.Show(this,
                    "服务已停止，本启动器拉起的 node 进程已结束，端口 " + port + " 已释放。",
                    "方块枪神 2D", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        private void OnAutoStartChanged(object sender, EventArgs e)
        {
            if (_suppressAutoStart) return;
            try
            {
                bool on = _autoStartBox.Checked;
                AutoStartRegistry.SetEnabled(on);
                SetStatus(on ? "已设置开机自启：登录后自动启动联机服务" : "已取消开机自启", Color.DimGray);
            }
            catch (Exception ex)
            {
                _suppressAutoStart = true;
                _autoStartBox.Checked = !_autoStartBox.Checked;
                _suppressAutoStart = false;
                MessageBox.Show(this, "写入注册表失败：" + ex.Message, "方块枪神 2D", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            _closing = true;
            try { _server.Stop(); }
            catch { }
        }

        private static string FirstLine(string s)
        {
            if (String.IsNullOrEmpty(s)) return "";
            int i = s.IndexOf('\n');
            string one = i < 0 ? s : s.Substring(0, i);
            return one.Trim();
        }
    }
    // ----------------------------------------------------------------------
    //  无头自检： 方块枪神2D.exe --selftest [--port=18080]
    //  起服务 → /healthz 200 → 停止 → 端口释放 → 对照 node 未被误杀
    //  结果写入 %TEMP%\block-gunner-2d-selftest.txt，退出码 0=PASS / 1=FAIL
    // ----------------------------------------------------------------------
    internal static class SelfTest
    {
        public static int Run(LauncherOptions opt)
        {
            StringBuilder log = new StringBuilder();
            int checks = 0;
            int failed = 0;
            string exePath = "";
            try
            {
                Assembly a = Assembly.GetEntryAssembly();
                if (a != null) exePath = a.Location;
            }
            catch { }
            string gameRoot = GameServer.ResolveGameRoot(opt.GameRoot);

            log.AppendLine("方块枪神 2D 启动器自检 (self-test)");
            log.AppendLine("time     : " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            log.AppendLine("exe      : " + exePath);
            log.AppendLine("gameRoot : " + gameRoot);
            log.AppendLine("------------------------------------------------------------");

            Action<string, bool, string> report = delegate(string name, bool ok, string detail)
            {
                checks++;
                if (!ok) failed++;
                string line = "[" + checks.ToString(CultureInfo.InvariantCulture) + "] " + (ok ? "PASS" : "FAIL") + "  " + name;
                if (!String.IsNullOrEmpty(detail)) line += "  -> " + GameServer.Shorten(detail, 220);
                log.AppendLine(line);
            };

            string node = GameServer.FindNode();
            report("找到 node.exe", !String.IsNullOrEmpty(node), node == null ? "未找到 Node.js" : node);

            string serverJs = Path.Combine(gameRoot, "server", "server.js");
            report("找到 server/server.js", File.Exists(serverJs), serverJs);

            int port = opt.Port > 0 ? opt.Port : 18080;
            report("自检端口 " + port + " 空闲", GameServer.IsPortFree(port), null);

            Process bystander = null;
            int bystanderPid = 0;
            if (!String.IsNullOrEmpty(node) && File.Exists(node))
            {
                try
                {
                    ProcessStartInfo bpsi = new ProcessStartInfo();
                    bpsi.FileName = node;
                    bpsi.Arguments = "-e \"setTimeout(function(){},60000)\"";
                    bpsi.UseShellExecute = false;
                    bpsi.CreateNoWindow = true;
                    bpsi.RedirectStandardOutput = true;
                    bpsi.RedirectStandardError = true;
                    bystander = new Process();
                    bystander.StartInfo = bpsi;
                    bystander.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { };
                    bystander.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { };
                    bystander.Start();
                    bystander.BeginOutputReadLine();
                    bystander.BeginErrorReadLine();
                    bystanderPid = bystander.Id;
                    Thread.Sleep(300);
                    report("创建无关的对照 node 进程 (PID " + bystanderPid + ")", !bystander.HasExited, null);
                }
                catch (Exception ex)
                {
                    report("创建无关的对照 node 进程", false, ex.Message);
                }
            }

            GameServer srv = new GameServer(gameRoot, node);
            bool started = false;
            string startError = null;
            if (!String.IsNullOrEmpty(node) && File.Exists(node) && File.Exists(serverJs) && GameServer.IsPortFree(port))
            {
                started = srv.Start(port, out startError);
            }
            report("启动 node server/server.js", started,
                started ? ("PID " + srv.ProcessId + "，端口 " + srv.Port) : (startError == null ? "前置条件不满足" : startError));

            int serverPid = srv.ProcessId;
            if (started)
            {
                long ms;
                string body;
                bool healthy = srv.WaitHealthy(opt.ReadyTimeoutMs, out ms, out body);
                report("/healthz 返回 200", healthy,
                    healthy ? (ms + " ms，" + body) : ("等待 " + opt.ReadyTimeoutMs + " ms 超时；node 输出：" + srv.LogTail(400)));

                report("TCP 端口可连接", GameServer.TcpConnect(srv.Port, 1000), "127.0.0.1:" + srv.Port);

                srv.Stop();
                Thread.Sleep(400);

                report("停止后 node 进程已退出 (PID " + serverPid + ")", !ProcessExists(serverPid), null);
                report("停止后端口已释放", GameServer.IsPortFree(srv.Port), null);
                report("无关的对照 node 进程未被误杀 (PID " + bystanderPid + ")",
                    bystander != null && ProcessExists(bystanderPid), null);
            }

            if (bystander != null)
            {
                try
                {
                    if (!bystander.HasExited) bystander.Kill();
                }
                catch { }
                try { bystander.Dispose(); }
                catch { }
            }

            bool pass = started && failed == 0;
            log.AppendLine("------------------------------------------------------------");
            log.AppendLine("RESULT: " + (pass ? "PASS" : "FAIL") + "  (" + (checks - failed) + "/" + checks + " checks passed)");
            WriteLog(opt.LogFile, log.ToString());
            return pass ? 0 : 1;
        }

        public static string WriteLog(string requestedPath, string text)
        {
            List<string> cand = new List<string>();
            if (!String.IsNullOrEmpty(requestedPath)) cand.Add(requestedPath);
            try { cand.Add(Path.Combine(Path.GetTempPath(), "block-gunner-2d-selftest.txt")); }
            catch { }
            try { cand.Add(Path.Combine(GameServer.GetExeDir(), "selftest-result.txt")); }
            catch { }
            for (int i = 0; i < cand.Count; i++)
            {
                try
                {
                    string dir = Path.GetDirectoryName(cand[i]);
                    if (!String.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                    File.WriteAllText(cand[i], text, new UTF8Encoding(false));
                    return cand[i];
                }
                catch { }
            }
            return "(无法写入自检日志)";
        }

        private static bool ProcessExists(int pid)
        {
            if (pid <= 0) return false;
            try
            {
                Process p = Process.GetProcessById(pid);
                if (p == null) return false;
                bool alive = !p.HasExited;
                p.Dispose();
                return alive;
            }
            catch
            {
                return false;
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            LauncherOptions opt = LauncherOptions.Parse(args);

            if (opt.SelfTest)
            {
                try
                {
                    return SelfTest.Run(opt);
                }
                catch (Exception ex)
                {
                    try { SelfTest.WriteLog(opt.LogFile, "selftest crashed:\n" + ex.ToString()); }
                    catch { }
                    return 2;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Application.Run(new MainForm(opt));
                return 0;
            }
            catch (Exception ex)
            {
                try
                {
                    MessageBox.Show("启动器发生错误：\n" + ex.Message, "方块枪神 2D", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                catch { }
                return 3;
            }
        }
    }
}