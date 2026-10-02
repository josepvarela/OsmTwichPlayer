// Servidor de desarrollo local: sirve los archivos estáticos y emula
// las funciones serverless de /api igual que lo hace Vercel en producción.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

// Carga variables de entorno de .env*.local sin dependencias externas.
for (const name of [".env.local", ".env.development.local", ".env"]) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

    // Funciones serverless en /api/*
    if (pathname.startsWith("/api/")) {
      const fnPath = path.join(root, pathname + ".js");
      if (!fnPath.startsWith(path.join(root, "api")) || !fs.existsSync(fnPath)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      try {
        const mod = await import(pathToFileURL(fnPath).href + `?t=${Date.now()}`);
        const handler = mod.default || mod;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return await handler(req, res);
      } catch (err) {
        console.error(err);
        res.writeHead(500);
        return res.end(JSON.stringify({ error: String(err) }));
      }
    }

    // Archivos estáticos con cleanUrls (como en vercel.json)
    if (pathname === "/") pathname = "/index.html";
    let filePath = path.join(root, pathname);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    if (!path.extname(filePath) && fs.existsSync(filePath + ".html")) {
      filePath += ".html";
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const extension = path.extname(filePath).toLowerCase();
    const isImmutableAsset = [".js", ".css", ".png", ".jpg", ".svg", ".ico"].includes(extension);
    res.writeHead(200, {
      "Content-Type": MIME[extension] || "application/octet-stream",
      "Cache-Control": isImmutableAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  })
  .listen(port, () => {
    console.log(`OsmTwich dev server → http://localhost:${port}`);
  });
