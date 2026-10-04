package com.blockgunner2d.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Minimal loopback HTTP/1.1 server (pure Java, zero third-party dependencies).
 *
 * The game is shipped in the APK assets; serving it over http://127.0.0.1:<port>/
 * keeps Service Worker, WebSocket and same-origin storage working exactly like
 * on a real web server (file:// would break all of them).
 *
 * Only binds to 127.0.0.1. When the base port is occupied it tries base+1 ... +99.
 */
public class LocalHttpServer {

    /** Supplies asset bytes for a request path (e.g. "/index.html"); null = 404. */
    public interface ResourceProvider {
        byte[] read(String path);
    }

    public static final int DEFAULT_PORT = 8080;
    private static final int PORT_TRIES = 100;
    private static final int SOCKET_TIMEOUT_MS = 8000;
    private static final int MAX_HEADER_BYTES = 8192;

    private final int basePort;
    private final ResourceProvider provider;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final AtomicBoolean running = new AtomicBoolean(false);

    private ServerSocket serverSocket;
    private Thread acceptThread;
    private volatile int port = -1;

    public LocalHttpServer(int basePort, ResourceProvider provider) {
        this.basePort = basePort > 0 ? basePort : DEFAULT_PORT;
        this.provider = provider;
    }

    /** Binds the first free loopback port and starts serving. Returns the port. */
    public synchronized int start() throws IOException {
        if (running.get()) {
            return port;
        }
        IOException lastError = null;
        for (int candidate = basePort; candidate < basePort + PORT_TRIES; candidate++) {
            ServerSocket socket = null;
            try {
                socket = new ServerSocket();
                socket.setReuseAddress(true);
                socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), candidate), 16);
            } catch (IOException e) {
                lastError = e;
                if (socket != null) {
                    try { socket.close(); } catch (IOException ignored) { }
                }
                continue;
            }
            serverSocket = socket;
            port = candidate;
            break;
        }
        if (serverSocket == null) {
            throw new IOException("no free port in " + basePort + "-" + (basePort + PORT_TRIES - 1), lastError);
        }
        running.set(true);
        acceptThread = new Thread(new Runnable() {
            public void run() {
                acceptLoop();
            }
        }, "blockgunner-http");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return port;
    }

    public int getPort() {
        return port;
    }

    public boolean isRunning() {
        return running.get();
    }

    /** Stops accepting connections and closes the listening socket. */
    public synchronized void stop() {
        running.set(false);
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (IOException ignored) { }
            serverSocket = null;
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running.get()) {
            Socket socket;
            try {
                socket = serverSocket.accept();
            } catch (IOException e) {
                if (!running.get()) {
                    return;
                }
                try { Thread.sleep(20); } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return;
                }
                continue;
            }
            try {
                pool.execute(new SocketTask(socket));
            } catch (RuntimeException e) {
                try { socket.close(); } catch (IOException ignored) { }
            }
        }
    }

    private final class SocketTask implements Runnable {
        private final Socket socket;

        SocketTask(Socket socket) {
            this.socket = socket;
        }

        public void run() {
            handle(socket);
        }
    }

    private void handle(Socket socket) {
        try {
            socket.setSoTimeout(SOCKET_TIMEOUT_MS);
            InputStream in = socket.getInputStream();
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.length() == 0) {
                return;
            }
            String header;
            while ((header = readLine(in)) != null && header.length() > 0) {
                // drain request headers; this minimal server needs none of them
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                writeError(socket, 400, "Bad Request");
                return;
            }
            String method = parts[0];
            boolean head = "HEAD".equalsIgnoreCase(method);
            if (!head && !"GET".equalsIgnoreCase(method)) {
                writeError(socket, 405, "Method Not Allowed");
                return;
            }
            String path = normalizePath(parts[1]);
            if (path == null) {
                writeError(socket, 400, "Bad Request");
                return;
            }
            byte[] body = provider == null ? null : provider.read(path);
            if (body == null) {
                writeError(socket, 404, "Not Found");
                return;
            }
            writeResponse(socket, 200, "OK", mimeType(path), cacheControl(path), body, head);
        } catch (Exception e) {
            // client disconnected / timed out: nothing useful to do
        } finally {
            try { socket.close(); } catch (IOException ignored) { }
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(128);
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') {
                break;
            }
            if (c != '\r') {
                buffer.write(c);
            }
            if (buffer.size() > MAX_HEADER_BYTES) {
                break;
            }
        }
        if (c == -1 && buffer.size() == 0) {
            return null;
        }
        return new String(buffer.toByteArray(), "UTF-8");
    }

    /** Normalises a request target to an absolute asset path, or null if unsafe. */
    static String normalizePath(String target) {
        if (target == null) {
            return null;
        }
        try {
            String t = target;
            int cut = t.indexOf('?');
            if (cut >= 0) {
                t = t.substring(0, cut);
            }
            cut = t.indexOf('#');
            if (cut >= 0) {
                t = t.substring(0, cut);
            }
            t = URLDecoder.decode(t.replace("+", "%2B"), "UTF-8");
            if (t.indexOf('\0') >= 0) {
                return null;
            }
            if (t.indexOf("..") >= 0) {
                return null;
            }
            if (t.length() == 0) {
                t = "/";
            }
            if (t.charAt(0) != '/') {
                t = "/" + t;
            }
            if (t.endsWith("/")) {
                t = t + "index.html";
            }
            if (t.equals("/")) {
                t = "/index.html";
            }
            return t;
        } catch (Exception e) {
            return null;
        }
    }

    static String mimeType(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".txt") || p.endsWith(".md")) return "text/plain; charset=utf-8";
        if (p.endsWith(".map")) return "application/json; charset=utf-8";
        return "application/octet-stream";
    }

    static String cacheControl(String path) {
        String p = path.toLowerCase();
        // 代码类资源每次校验：App/PWA 更新后刷新一次即可拿到新版本
        if (p.endsWith(".html") || p.endsWith(".htm") || p.endsWith(".js") || p.endsWith(".mjs")
                || p.endsWith(".css") || p.endsWith(".webmanifest")) {
            return "no-cache, must-revalidate";
        }
        if (p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".gif")
                || p.endsWith(".svg") || p.endsWith(".ico") || p.endsWith(".webp") || p.endsWith(".bmp")) {
            return "public, max-age=300";
        }
        return "public, max-age=3600";
    }

    private void writeError(Socket socket, int code, String reason) throws IOException {
        byte[] body = reason.getBytes("UTF-8");
        writeResponse(socket, code, reason, "text/plain; charset=utf-8", "no-cache", body, false);
    }

    private void writeResponse(Socket socket, int code, String reason, String contentType,
                               String cacheControl, byte[] body, boolean head) throws IOException {
        OutputStream out = socket.getOutputStream();
        StringBuilder headBuf = new StringBuilder(256);
        headBuf.append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        headBuf.append("Content-Type: ").append(contentType).append("\r\n");
        headBuf.append("Content-Length: ").append(body.length).append("\r\n");
        headBuf.append("Cache-Control: ").append(cacheControl).append("\r\n");
        headBuf.append("X-Content-Type-Options: nosniff\r\n");
        headBuf.append("Connection: close\r\n\r\n");
        out.write(headBuf.toString().getBytes("UTF-8"));
        if (!head) {
            out.write(body);
        }
        out.flush();
    }
}