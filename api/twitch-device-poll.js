// Vercel Serverless Function: segundo paso del Device Code Grant Flow.
// El front-end llama esto cada pocos segundos con el device_code hasta que
// el usuario aprueba el login desde su celular (o hasta que expira).
//
// Mientras el usuario no aprobó todavía, Twitch responde con
// {"status":400,"message":"authorization_pending"} — eso NO es un error
// real, así que lo devolvemos tal cual para que el front-end siga esperando.

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    const deviceCode = req.query && req.query.device_code;

    if (!clientId || !deviceCode) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: "bad_request", message: "Falta device_code." }));
    }

    try {
        const body = new URLSearchParams({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            scope: "chat:edit user:read:follows",
        });
        if (clientSecret) body.set("client_secret", clientSecret);

        const r = await fetch("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
        const data = await r.json();

        if (r.ok && data.access_token) {
            // Aprovechamos para traer los datos del usuario ahora mismo y
            // no tener que hacer una segunda ida y vuelta desde el TV.
            try {
                const userRes = await fetch("https://api.twitch.tv/helix/users", {
                    headers: { "Client-Id": clientId, "Authorization": `Bearer ${data.access_token}` },
                });
                const userData = await userRes.json();
                const user = (userData.data && userData.data[0]) || {};
                data.login = user.login || null;
                data.display_name = user.display_name || null;
                data.profile_image_url = user.profile_image_url || null;
                data.user_id = user.id || null;
            } catch (_) { /* no crítico */ }
        }

        res.statusCode = r.status;
        return res.end(JSON.stringify(data));
    } catch (err) {
        res.statusCode = 502;
        return res.end(JSON.stringify({ error: "network_error", message: String(err) }));
    }
};
