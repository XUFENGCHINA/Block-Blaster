package com.blockgunner2d.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * JVM smoke test for LocalHttpServer (runs without Android):
 * starts the server against a temp asset dir, fetches files over HTTP,
 * checks MIME type / 404 / traversal / occupied-port auto increment.
 */
public class LocalHttpServerTest {

    private static int failures = 0;

    private static void check(boolean condition, String message) {
        if (condition) {
            System.out.println("PASS " + message);
        } else {
            failures++;
            System.out.println("FAIL " + message);
        }
    }

    private static void makeDirs(File dir) {
        if (dir.isDirectory()) {
            return;
        }
        File parent = dir.getParentFile();
        if (parent != null) {
            makeDirs(parent);
        }
        dir.mkdirs();
    }

    private static void write(File file, String content) throws Exception {
        makeDirs(file.getParentFile());
        FileOutputStream out = new FileOutputStream(file);
        out.write(content.getBytes("UTF-8"));
        out.close();
    }

    private static int status(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(4000);
        c.setReadTimeout(4000);
        try {
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    private static String header(String url, String name) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(4000);
        c.setReadTimeout(4000);
        try {
            c.getResponseCode();
            return c.getHeaderField(name);
        } finally {
            c.disconnect();
        }
    }

    private static String body(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(4000);
        c.setReadTimeout(4000);
        try {
            c.getResponseCode();
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            in.close();
            return out.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }

    public static void main(String[] args) throws Exception {
        final File root = new File(System.getProperty("java.io.tmpdir"),
                "blockgunner-http-test-" + System.currentTimeMillis());
        makeDirs(root);
        write(new File(root, "index.html"), "<html>HELLO_LOCAL_SERVER</html>");
        write(new File(root, "js/game.js"), "console.log('game');");
        write(new File(root, "manifest.webmanifest"), "{}");

        LocalHttpServer.ResourceProvider provider = new LocalHttpServer.ResourceProvider() {
            public byte[] read(String path) {
                if (path == null || path.indexOf("..") >= 0) {
                    return null;
                }
                String rel = path.startsWith("/") ? path.substring(1) : path;
                File f = new File(root, rel);
                if (!f.isFile()) {
                    return null;
                }
                try {
                    FileInputStream in = new FileInputStream(f);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                    in.close();
                    return out.toByteArray();
                } catch (Exception e) {
                    return null;
                }
            }
        };

        LocalHttpServer server = new LocalHttpServer(18080, provider);
        int port = server.start();
        check(port >= 18080 && port < 18080 + 100, "server started on port " + port);
        check(server.isRunning(), "isRunning() is true after start");

        String base = "http://127.0.0.1:" + port;
        check(body(base + "/").indexOf("HELLO_LOCAL_SERVER") >= 0, "GET / serves index.html");
        check(body(base + "/index.html").indexOf("HELLO_LOCAL_SERVER") >= 0, "GET /index.html");
        check("console.log('game');".equals(body(base + "/js/game.js")), "GET /js/game.js");
        String jsType = header(base + "/js/game.js", "Content-Type");
        check(jsType != null && jsType.indexOf("application/javascript") == 0, "js Content-Type: " + jsType);
        String manifestType = header(base + "/manifest.webmanifest", "Content-Type");
        check(manifestType != null && manifestType.indexOf("application/manifest+json") == 0,
                "webmanifest Content-Type: " + manifestType);
        check(status(base + "/missing.txt") == 404, "404 for missing file");
        check(LocalHttpServer.normalizePath("/a/../b") == null, "normalizePath rejects ..");
        check("/index.html".equals(LocalHttpServer.normalizePath("/")), "normalizePath maps / to /index.html");
        check("/js/game.js".equals(LocalHttpServer.normalizePath("/js/game.js?x=1")), "normalizePath strips query");

        LocalHttpServer second = new LocalHttpServer(18080, provider);
        int port2 = second.start();
        check(port2 == port + 1, "occupied port auto-increments to " + port2);
        second.stop();
        check(!second.isRunning(), "second server stopped");

        server.stop();
        check(!server.isRunning(), "server stopped");

        System.out.println(failures == 0 ? "JVM_SERVER_TEST PASS" : ("JVM_SERVER_TEST FAIL (" + failures + ")"));
        System.exit(failures == 0 ? 0 : 1);
    }
}