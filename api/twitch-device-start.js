// Vercel Serverless Function: primer paso del "Device Code Grant Flow" de
// Twitch (login por QR pensado para TV / dispositivos sin teclado cómodo).
// Solo necesita el client_id — Twitch no exige client_secret en este paso.

module.exports = async function handler(req, res) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    const clientId = process.env.TWITCH_CLIENT_ID;
    if (!clientId) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: "missing_credentials" }));
    }

    const scopes = (req.query && req.query.scopes) || "chat:read chat:edit user:read:follows";

    try {
        const r = await fetch("https://id.twitch.tv/oauth2/device", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: clientId, scopes }),
        });
        const data = await r.json();
        res.statusCode = r.status;
        return res.end(JSON.stringify(data));
    } catch (err) {
        res.statusCode = 502;
        return res.end(JSON.stringify({ error: "network_error", message: String(err) }));
    }
};
