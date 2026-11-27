// Vercel Serverless Function: renueva la sesión OAuth de Twitch.
// El refresh_token se recibe por HTTPS y el client_secret permanece en variables
// de entorno del servidor. Twitch rota refresh_token, por eso se devuelve el nuevo.
module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "method_not_allowed" }));
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  const refreshToken = body.refresh_token;

  if (!clientId || !clientSecret) {
    res.statusCode = 500;
    return res.end(JSON.stringify({
      error: "missing_credentials",
      message: "Faltan TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET en el servidor."
    }));
  }
  if (!refreshToken || typeof refreshToken !== "string") {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "bad_request", message: "Falta refresh_token." }));
  }

  try {
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      res.statusCode = tokenRes.status || 502;
      return res.end(JSON.stringify({
        error: data.error || "refresh_failed",
        message: data.message || "Twitch no pudo renovar la sesión."
      }));
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_in: data.expires_in || 14400,
      token_type: data.token_type || "bearer",
      scope: data.scope || []
    }));
  } catch (error) {
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: "network_error", message: String(error) }));
  }
};
