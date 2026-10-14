# OsmTwich

Cliente no oficial de Twitch para Samsung Tizen TV, Android TV y navegador. Optimizado para control remoto.

## 📸 Capturas


<img width="1919" height="910" alt="image" src="https://github.com/user-attachments/assets/5abc6494-e44d-4c9a-b469-108c2488b219" />
<img width="1902" height="909" alt="image" src="https://github.com/user-attachments/assets/761bbb9f-f90a-4432-9ccf-76555ffe6a1d" />

<img width="1902" height="909" alt="image" src="https://github.com/user-attachments/assets/57213eb4-232b-47f0-b80b-7523b481610e" />
<img width="1915" height="903" alt="image" src="https://github.com/user-attachments/assets/c461a425-8817-4543-adcd-469b1f3b3350" />

<img width="1900" height="904" alt="image" src="https://github.com/user-attachments/assets/502d4d6f-0840-41a3-9f94-aa27c1c2ee46" />
<img width="1915" height="906" alt="image" src="https://github.com/user-attachments/assets/f5acab12-00ad-43b4-954d-7efa91fe7d0e" />

## ✨ Características

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
