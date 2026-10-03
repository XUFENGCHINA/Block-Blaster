package com.blockgunner2d.app;

import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Serves APK assets (assets/ root) to the local loopback HTTP server.
 * Assets are read once and cached in memory (the whole game is only a few hundred KB).
 */
public class AssetResourceProvider implements LocalHttpServer.ResourceProvider {

        private final AssetManager assets;
    private final ConcurrentHashMap<String, byte[]> cache = new ConcurrentHashMap<String, byte[]>();

    public AssetResourceProvider(AssetManager assets) {
        this.assets = assets;
    }

    public byte[] read(String path) {
        if (path == null) {
            return null;
        }
        String key = path;
        if (key.startsWith("/")) {
            key = key.substring(1);
        }
        if (key.length() == 0) {
            key = "index.html";
        }
        if (key.indexOf("..") >= 0) {
            return null;
        }
        byte[] hit = cache.get(key);
        if (hit != null) {
            return hit;
        }
        InputStream in = null;
        try {
            in = assets.open(key, AssetManager.ACCESS_STREAMING);
            ByteArrayOutputStream out = new ByteArrayOutputStream(16384);
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            byte[] data = out.toByteArray();
            cache.put(key, data);
            return data;
        } catch (IOException e) {
            return null;
        } finally {
            if (in != null) {
                try { in.close(); } catch (IOException ignored) { }
            }
        }
    }
}