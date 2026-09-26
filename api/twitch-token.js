// Vercel Serverless Function: emite un App Access Token de Twitch.
// El client_secret vive SOLO en variables de entorno del servidor.
// Nunca se envía al navegador.

let cached = { token: null, expiresAt: 0 };

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        error: "missing_credentials",
        message:
          "Faltan TWITCH_CLIENT_ID y/o TWITCH_CLIENT_SECRET en las variables de entorno.",
      })
    );
  }

  // Reutiliza el token mientras le quede al menos 1 minuto de vida.
  if (cached.token && cached.expiresAt - Date.now() > 60_000) {
    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        access_token: cached.token,
        client_id: clientId,
        expires_in: Math.floor((cached.expiresAt - Date.now()) / 1000),
      })
    );
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });

    const twitchRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await twitchRes.json();

    if (!twitchRes.ok || !data.access_token) {
      res.statusCode = twitchRes.status || 502;
      return res.end(
        JSON.stringify({
          error: "twitch_error",
          message: data.message || "Twitch rechazó las credenciales.",
        })
      );
    }

    cached = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };

    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        access_token: data.access_token,
        client_id: clientId,
        expires_in: data.expires_in,
      })
    );
  } catch (err) {
    res.statusCode = 502;
    return res.end(
      JSON.stringify({ error: "network_error", message: String(err) })
    );
  }
};
