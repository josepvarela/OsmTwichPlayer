# OsmTwich

Cliente no oficial de Twitch para Samsung Tizen TV, Android TV y navegador. Optimizado para control remoto.

## 📸 Capturas

| | | |
|---|---|---|
| <img src="https://github.com/user-attachments/assets/5abc6494-e44d-4c9a-b469-108c2488b219" width="300" /> | <img src="https://github.com/user-attachments/assets/761bbb9f-f90a-4432-9ccf-76555ffe6a1d" width="300" /> | <img src="https://github.com/user-attachments/assets/98590a47-a3ee-4c7f-a081-2ec7484ffdbd" width="300" /> |
| <img src="https://github.com/user-attachments/assets/57213eb4-232b-47f0-b80b-7523b481610e" width="300" /> | <img src="https://github.com/user-attachments/assets/c461a425-8817-4543-adcd-469b1f3b3350" width="300" /> | <img src="https://github.com/user-attachments/assets/502d4d6f-0840-41a3-9f94-aa27c1c2ee46" width="300" /> |
| <img src="https://github.com/user-attachments/assets/1e8151a1-b02a-491f-8af1-7633e8fa5cde" width="300" /> | <img src="https://github.com/user-attachments/assets/5e1292ab-7749-4819-98e1-930dd1cf2435" width="300" /> | |

## ✨ Características

- Sidebar navegable con D-pad
- Canales seguidos, destacados, top streamers y juegos top
- Reproductor con autoplay, calidades y seek en VODs
- Chat propio con emotes de Twitch y 7TV, badges reales y repetición en VODs
- Login con Twitch (redirección o QR)
- Ajustes de tema, tamaño de texto, color y tarjetas
- Panel de ajustes del reproductor: calidad, tamaño/posición del chat
- Modo `perf-lite` para TVs de gama baja

## 📦 Instalación

**Samsung TV:** descargá el `.wgt` desde Releases e instalalo con Tizen Studio.

> El `.wgt` viene sin firmar. Para instalarlo en un TV real hay que firmarlo con tu certificado (Certificate Manager).

## 🛠 Desarrollo

Todo vive en `index.html` (HTML + CSS + JS, sin frameworks). El backend serverless está en Vercel (`/api/*`) y maneja el token de Twitch y el proxy de comentarios de VODs.

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE). Podés usarlo, copiarlo, modificarlo y distribuirlo libremente, siempre que incluyas el aviso de copyright y de licencia.

## ⚖️ Aviso

No está afiliado ni respaldado por Twitch ni Samsung. Twitch, sus emotes y su logo son marcas de Twitch Interactive, Inc.
