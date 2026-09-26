// Vercel Serverless Function: paso final del "Authorization Code Grant Flow"
// de Twitch. Twitch redirige aquí después de que el usuario inicia sesión y
// autoriza la app en la pantalla OFICIAL de Twitch (nunca en la nuestra).
//
// El client_secret vive SOLO aquí en el servidor, igual que en
// twitch-token.js — nunca se expone al navegador.

function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function htmlPage(body) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>OsmTwich</title></head>
<body style="background:#0e0e10;color:#fff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
${body}
</body></html>`;
}

module.exports = async function handler(req, res) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    const query = req.query || {};
    const { code, state, error, error_description } = query;

    function fail(message) {
        res.statusCode = 200;
        return res.end(htmlPage(`
            <div style="text-align:center;max-width:420px;padding:24px;">
                <p>No se pudo iniciar sesión con Twitch.</p>
                <p style="color:#adadb8;font-size:14px;">${escapeHtml(message)}</p>
                <a href="/" style="color:#9146ff;">Volver a la app</a>
            </div>`));
    }

    if (error) return fail(error_description || error);
    if (!code) return fail("Falta el código de autorización.");
    if (!state) return fail("Falta el parámetro de estado (posible solicitud inválida). Intentá iniciar sesión de nuevo.");
    if (!clientId || !clientSecret) return fail("Faltan credenciales de Twitch en el servidor.");

    // Nota sobre CSRF: en vez de comparar "state" contra una cookie (que
    // Twitch puede no reenviar de forma confiable en la redirección de
    // vuelta, según las reglas de SameSite del navegador), la verificación
    // se hace del lado del cliente más abajo, comparando contra el valor
    // que guardamos en sessionStorage antes de salir hacia Twitch. Eso
    // sobrevive el ida y vuelta sin depender del comportamiento de cookies
    // entre sitios.

    const protocol = req.headers["x-forwarded-proto"] || "https";
    const redirectUri = `${protocol}://${req.headers.host}/api/twitch-auth-callback`;

    try {
        const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: "authorization_code",
                redirect_uri: redirectUri,
            }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
            return fail(tokenData.message || "Twitch rechazó el código de autorización.");
        }

        let user = {};
        try {
            const userRes = await fetch("https://api.twitch.tv/helix/users", {
                headers: { "Client-Id": clientId, "Authorization": `Bearer ${tokenData.access_token}` },
            });
            const userData = await userRes.json();
            user = (userData.data && userData.data[0]) || {};
        } catch (_) { /* seguimos igual: el login ya es válido sin estos datos extra */ }

        const payload = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token || null,
            expires_at: Date.now() + (tokenData.expires_in || 3600) * 1000,
            user_id: user.id || null,
            login: user.login || null,
            display_name: user.display_name || user.login || null,
            profile_image_url: user.profile_image_url || null,
        };

        res.statusCode = 200;
        return res.end(htmlPage(`
            <p id="tw-callback-msg">Iniciando sesión…</p>
            <script>
                (function () {
                    var expectedState = ${JSON.stringify(state)};
                    var errorBox =
                        '<div style="text-align:center;max-width:420px;padding:24px;">' +
                        '<p>No se pudo iniciar sesión con Twitch.</p>' +
                        '<p style="color:#adadb8;font-size:14px;">El estado de la autorización no coincide ' +
                        '(la sesión de login se abrió en otra pestaña, o venció). Intentá iniciar sesión de nuevo.</p>' +
                        '<a href="/" style="color:#9146ff;">Volver a la app</a></div>';
                    try {
                        var savedState = sessionStorage.getItem("tw_oauth_state");
                        sessionStorage.removeItem("tw_oauth_state");
                        if (!savedState || savedState !== expectedState) {
                            document.body.innerHTML = errorBox;
                            return;
                        }
                        localStorage.setItem("osmtwich_user", ${JSON.stringify(JSON.stringify(payload))});
                    } catch (e) {}
                    location.replace("/");
                })();
            </script>`));
    } catch (err) {
        return fail(String(err));
    }
};
