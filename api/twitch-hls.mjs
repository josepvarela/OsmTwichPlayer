// Proxy mínimo para el playlist maestro de Twitch (usher.ttvnw.net no envía CORS).
// Solo permite ese host; los segmentos de video NO pasan por aquí.
export default async function handler(req, res) {
  try {
    const raw = Array.isArray(req.query.u) ? req.query.u[0] : req.query.u;
    const u = new URL(String(raw || ""));
    if (u.protocol !== "https:" || u.hostname !== "usher.ttvnw.net") {
      res.status(400).send("host no permitido");
      return;
    }
    const r = await fetch(u.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "*/*",
        "Origin": "https://www.twitch.tv",
        "Referer": "https://www.twitch.tv/"
      }
    });
    const text = await r.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(r.status).send(text);
  } catch (e) {
    res.status(502).send("error: " + (e && e.message ? e.message : e));
  }
}
