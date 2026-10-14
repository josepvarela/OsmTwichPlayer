# OsmTwich

Cliente no oficial de Twitch para Samsung Tizen TV, Android TV y navegador. Optimizado para control remoto.

## ✨ Qué tiene

- Sidebar navegable con D-pad
- Canales seguidos, destacados, top streamers y juegos top
- Reproductor con autoplay, calidades y seek en VODs
- Chat propio con emotes de Twitch y 7TV, badges reales y repetición en VODs
- Login con Twitch (redirección o QR)
- Ajustes de tema, tamaño de texto, color y tarjetas
- Panel de ajustes del reproductor: calidad, tamaño/posición del chat
- Modo `perf-lite` para TVs de gama baja

Samsung TV: descargá el .wgt desde Releases e instalalo con Tizen Studio.

El .wgt viene sin firmar. Para instalarlo en un TV real hay que firmarlo con tu certificado (Certificate Manager).

🛠 Desarrollo
Todo vive en index.html (HTML + CSS + JS, sin frameworks). El backend serverless está en Vercel (/api/*) y maneja el token de Twitch y el proxy de comentarios de VODs.

⚖️ Aviso
No está afiliado ni respaldado por Twitch ni Samsung. Twitch, sus emotes y su logo son marcas de Twitch Interactive, Inc.
