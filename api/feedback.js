// Vercel Serverless Function: recibe comentarios de la app y los publica como
// issue en GitHub. El token NUNCA va en la app: vive solo en las variables de
// entorno de Vercel.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   GITHUB_FEEDBACK_TOKEN  token (fine-grained) con permiso "Issues: Read and write" SOLO en el repo
//   GITHUB_FEEDBACK_REPO   "usuario/repositorio"
const hits = new Map(); // límite por IP, en memoria (best effort por instancia)
const WINDOW_MS = 60 * 1000;

function clip(v, n) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }

  const token = process.env.GITHUB_FEEDBACK_TOKEN;
  const repo = process.env.GITHUB_FEEDBACK_REPO;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo || "")) {
    res.status(500).json({ error: "not_configured" });
    return;
  }

  const ip = clip((req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown", 64);
  const now = Date.now();
  for (const [k, t] of hits) if (now - t > WINDOW_MS) hits.delete(k);
  if (hits.has(ip)) { res.status(429).json({ error: "rate_limited" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};
  const message = String(body.message == null ? "" : body.message).replace(/\r/g, "").trim().slice(0, 500);
  if (message.length < 5) { res.status(400).json({ error: "message" }); return; }
  const d = body.device && typeof body.device === "object" ? body.device : {};

  hits.set(ip, now);

  // Bloque de código largo: evita menciones (@usuario) y formato inyectado.
  const fence = "````";
  const text = message.split(fence).join("'''");
  const issueBody = [
    fence,
    text,
    fence,
    "",
    "| Dato | Valor |",
    "|---|---|",
    "| Plataforma | " + clip(d.platform, 40) + " |",
    "| Modelo del TV | " + clip(d.model, 60) + " |",
    "| Firmware | " + clip(d.firmware, 60) + " |",
    "| Tizen | " + clip(d.tizen, 20) + " |",
    "| Pantalla | " + clip(d.screen, 20) + " |",
    "| User agent | " + clip(d.ua, 200).replace(/\|/g, "/") + " |"
  ].join("\n");

  const title = "Comentario: " + clip(message, 60) + (clip(d.model, 40) ? " [" + clip(d.model, 40) + "]" : "");
  try {
    const r = await fetch("https://api.github.com/repos/" + repo + "/issues", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "osmtwich-feedback"
      },
      body: JSON.stringify({ title, body: issueBody, labels: ["feedback"] })
    });
    if (!r.ok) { hits.delete(ip); res.status(502).json({ error: "github_" + r.status }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    hits.delete(ip);
    res.status(502).json({ error: "network" });
  }
};
