
// ============================================================
// OsmTwich - App para Samsung Tizen
// ============================================================

const TWITCH_PARENT = window.location.hostname || "localhost";

// --- Credenciales de la Twitch API ---
// El client_secret NUNCA va en el frontend. El token se obtiene desde
// /api/twitch-token (función serverless) que lee TWITCH_CLIENT_ID y
// TWITCH_CLIENT_SECRET de las variables de entorno del servidor.
// TWITCH_CLIENT_ID se rellena en tiempo de ejecución con la respuesta del endpoint.
let TWITCH_CLIENT_ID = "";
// Cuando la app corre servida desde GitHub Pages (sin backend propio),
// las funciones /api/* no existen ahí: apuntamos siempre al backend real en Vercel.
const API_BASE = "https://osmtwich2.vercel.app";
const TWITCH_TOKEN_ENDPOINT = `${API_BASE}/api/twitch-token`;

let twitchAppToken = null;   // token de la app (sin usuario) — para datos públicos
let twitchTokenExpiresAt = 0;

// --- Navegación del sidebar (todo público, sin login) ---
const NAV_ITEMS = [
    { id: "search",           label: "Buscar" },
    { id: "seguidosChannels", label: "Canales seguidos" },
    { id: "featured",         label: "Destacados" },
    { id: "topStreamers",     label: "Streamers top" },
    { id: "topGames",         label: "Juegos top" },
    { id: "account",          label: "Opciones" }
];

// --- Login con Twitch (OAuth) ---
// Redirección completa a la pantalla oficial de Twitch para PC/celular/
// navegador, y Device Code Flow con QR para TV. Twitch NUNCA permite pedir
// usuario y contraseña dentro de una app de terceros (sería indistinguible
// de phishing), así que ambos caminos terminan en la página real de Twitch.
// chat:read es obligatorio para poder LEER el chat por IRC con el usuario
// logueado (sin este scope, Twitch corta la conexión de chat apenas se usa
// el token, aunque el resto de la API funcione bien). chat:edit habilita
// además poder enviar mensajes.
const TWITCH_SCOPES = "chat:read chat:edit user:read:follows";
const TWITCH_AUTH_STORAGE_KEY = "osmtwich_user";
let twitchUser = null;       // {access_token, refresh_token, expires_at, user_id, login, display_name, profile_image_url}
let deviceFlowState = null;  // {device_code, interval, expiresAt, timer}

// --- Barra lateral: canales seguidos (en vivo + resto) ---
let followedSidebarItems = [];   // lista plana combinada (en vivo primero), para navegación con control remoto
let followedFocusIndex = 0;
let followedRefreshTimer = null;

// --- Estado general ---
let currentScreen = "main";
let focusZone = "nav";     // nav | content | search-keyboard | login
let navIndex = 0;          // 0..n = items del menú (Buscar incluido)
let contentRowId = "featured";
let contentTileIndex = 0;
// Se pone en false en cuanto el usuario mueve el foco por su cuenta (teclado
// o mando). Mientras sea true, sabemos que el foco actual sigue siendo el
// que la app puso automáticamente al iniciar, así que aún podemos
// reubicarlo en "Canales seguidos" cuando esa fila termine de cargar.
let contentRowIdWasChangedByUser = false;

// --- Estado de pantallas de grid simple (juego / resultados de búsqueda) ---
let gridFocusIndex = 0;
let resultsFocusZone = "grid"; // watch | grid
let resultsActionFocus = "watch"; // watch | follow — cuál de los dos botones de la barra de acciones tiene el foco
let resultsContentSection = "vods"; // vods | clips
let profileAccentPending = 0;

// --- Estado del reproductor ---
let twitchPlayer = null;
let autoplayRetryInterval = null;
let playbackType = null;      // "live" | "vod"
let currentChannelLogin = null;
let profileChatOpen = false; // chat abierto desde el perfil (canal offline)
let profileChatLogin = null;
let currentVideoId = null;
let currentPlayerGameId = null;
let currentPlayerGameName = null;

// Twitch permite reproducir con sonido sin más trámite dentro de su propio
// iframe una vez que hubo un clic/tecla real del usuario en la página (por
// eso, al volver de la pestaña de un anuncio, el stream sigue solo y con
// sonido: ese clic en el anuncio ya "activó" el permiso). Replicamos esa
// misma idea: en cuanto ocurre el primer gesto real en toda la app, dejamos
// de forzar el silencio inicial del reproductor.
let hasUserActivation = false;
function markUserActivation(e) {
    if (e && e.isTrusted === false) return;
    hasUserActivation = true;
}
document.addEventListener("pointerdown", markUserActivation, { capture: true, passive: true });
document.addEventListener("keydown", markUserActivation, { capture: true, passive: true });
let controlsVisible = false;
// Ventana de supresión: al mostrar la barra de controles con el mando, el
// foco cae en ctrl-play (o ctrl-chat, etc.) para poder navegar con las
// flechas. Distintos mandos/TVs, además del keydown, disparan un "click"
// nativo (a veces sintético/fantasma) sobre el elemento que queda con foco.
// En vez de una bandera booleana que un solo handler podía consumir y dejar
// pasar el resto, se usa un timestamp: CUALQUIER click o Enter/OK que llegue
// dentro de esta ventana, sin importar qué listener lo reciba primero, se
// descarta. Se captura en fase de "capture" sobre toda la barra para que
// nada la esquive.
let controlsSuppressUntil = 0;
const CONTROLS_SUPPRESS_MS = 700; // v65
function armControlsSuppression() {
    controlsSuppressUntil = Date.now() + CONTROLS_SUPPRESS_MS;
}
function isControlsActionSuppressed() {
    return Date.now() < controlsSuppressUntil;
}
let controlFocusIndex = 0;
let availableQualities = [];
let qualityIndex = 0;
const CONTROL_ACTIONS = ["rewind", "play", "forward", "mute", "quality", "chat", "chat-layout", "chat-send", "refresh"];
let playerInfoFocusIndex = 0;
let playerInfoHasGame = false;
let playerReturnScreen = "main";
let playerInfoReturn = false;
let playerInfoReturnScreen = "player";
let playerReturnGridFocusIndex = 0;
let playerReturnResultsFocusZone = "grid";
let playerReturnMainFocusZone = "content";
let playerReturnMainRowId = "featured";
let playerReturnMainTileIndex = 0;
let playerPlaybackStarted = false;
// Navegación horizontal unificada: perfil -> juego -> controles de reproducción.
// La posición se mantiene en una sola secuencia para el mando.

// ---- Íconos SVG planos (mismo estilo: formas blancas sólidas sobre fondo transparente) ----
const ICON_SVG = {
    play:      '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause:     '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    rewind:    '<svg viewBox="0 0 24 24"><path d="M11.5 12 20 5v14zM2 12l8.5-7v14z"/></svg>',
    forward:   '<svg viewBox="0 0 24 24"><path d="M12.5 12 4 5v14zM22 12l-8.5-7v14z"/></svg>',
    refresh:   '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z"/></svg>',
    volumeOn:  '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03z"/><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
    volumeOff: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M19.73 12 22 9.73l-1.41-1.41L18.32 10.6l-2.27-2.28-1.41 1.41L16.9 12l-2.26 2.27 1.41 1.41 2.27-2.27 2.27 2.27L22 14.27z"/></svg>',
    quality:   '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.3 7.3 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.41h-3.84a.5.5 0 0 0-.5.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.66 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.05.3-.08.63-.08.94s.02.64.07.94L2.78 14.5a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.37.29.6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.5.41h3.84c.25 0 .45-.17.5-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.23.08.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>',
    chat:      '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM6 8h12v2H6zm0-3h12v2H6zm0 6h8v2H6z"/></svg>',
    chatLayout: '<svg viewBox="0 0 24 24"><path d="M4 5a1 1 0 0 1 1-1h6v2H6v4H4V5zm10-1h5a1 1 0 0 1 1 1v5h-2V6h-4V4zM4 14h2v4h5v2H5a1 1 0 0 1-1-1v-5zm14 0h2v5a1 1 0 0 1 1 1h-5v-2h4v-4zM9 9h6v6H9z"/></svg>',
    chatSend:  '<svg viewBox="0 0 24 24"><path d="M2 21 23 12 2 3v7l15 2-15 2v7z"/></svg>'
};

function setCtrlIcon(action, key) {
    const el = document.getElementById(`ctrl-${action}`);
    if (el) el.innerHTML = ICON_SVG[key];
}

function initControlIcons() {
    setCtrlIcon("rewind", "rewind");
    setCtrlIcon("forward", "forward");
    setCtrlIcon("mute", isMuted ? "volumeOff" : "volumeOn");
    updateQualityCtrlLabel(); // texto ("Auto"/"1080p"/...) en vez del engranaje fijo
    setCtrlIcon("chat", "chat");
    setCtrlIcon("chat-layout", "chatLayout");
    setCtrlIcon("chat-send", "chatSend");
    setCtrlIcon("refresh", "refresh");
    // Al abrir el reproductor se asume reproduciendo, así que se muestra
    // el botón de pausa y se oculta el de play.
    updatePlayPauseVisibility(true);
}

// Un único botón central permanente: cambia entre icono Play y Pause según el estado.
function updatePlayPauseVisibility(isPlaying) {
    // Un único botón permanente en la posición central:
    // reproduce cuando está pausado y pausa cuando está reproduciendo.
    const playBtn = document.getElementById("ctrl-play");
    if (!playBtn) return;
    playBtn.innerHTML = isPlaying ? ICON_SVG.pause : ICON_SVG.play;
    playBtn.setAttribute("aria-label", isPlaying ? "Pausar" : "Reproducir");
}


// ============================================================
// Inicialización
// ============================================================
window.onload = function () {
    twitchUser = loadStoredTwitchUser();
    buildNav();
    setupSearchInput();
    setupPlayerControls();
    bindPlayerAreaCenterClick();
    setupPlayerInfoNavigation();
    setupChatUI();
    initSections();

    // Iniciar con foco en la primera tarjeta de "Canales seguidos" (si aún
    // no hay tarjetas ahí, cae a la primera fila disponible).
    setTimeout(() => {
        focusFirstAvailableRow("seguidosChannels");
    }, 150);

    window.addEventListener("keydown", handleKeyDown, true);

    if (twitchUser) startFollowedAutoRefresh();
};

function buildNav() {
    const list = document.getElementById("nav-list");
    if (!list) return;
    list.innerHTML = "";

    // SVG inline: no depende de que la fuente del dispositivo tenga el glifo.
    const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;width:100%;height:100%"';
    const NAV_ICONS = {
        search: '<svg ' + SVG_ATTRS + '><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
        seguidosChannels: '<svg ' + SVG_ATTRS + '><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M3 10h5M3 15h5"/></svg>',
        featured: '<svg ' + SVG_ATTRS + '><path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3z"/></svg>',
        topGames: '<svg ' + SVG_ATTRS + '><path d="M6 11h4M8 9v4"/><path d="M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.7 7.3A2.6 2.6 0 0 0 4.6 19c.8 0 1.5-.3 2-.9L9 15h6l2.4 3.1c.5.6 1.2.9 2 .9a2.6 2.6 0 0 0 2.6-3.1l-.7-7.3a4 4 0 0 0-4-3.6z"/></svg>',
        topStreamers: '<svg ' + SVG_ATTRS + '><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>',
        account: '<svg ' + SVG_ATTRS + '><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.29l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
    };

    NAV_ITEMS.forEach((item, i) => {
        const li = document.createElement("li");
        li.id = item.id === "search" ? "search-nav-item" : "";
        li.dataset.index = String(i);
        li.dataset.id = item.id;
        li.tabIndex = 0;
        li.innerHTML =
            '<span class="nav-icon" aria-hidden="true">' +
            (NAV_ICONS[item.id] || "•") +
            '</span><span class="nav-label">' +
            item.label +
            '</span>';

        li.addEventListener("mouseenter", () => {
            if (item.id !== "search") hoverSelectSection(item.id);
            else setActiveSection(null);
        });

        li.addEventListener("click", () => {
            setFocus("nav", i);
            selectNavItem();
        });

        list.appendChild(li);
    });

    // Si hay sesión iniciada, el ítem "Cuenta" muestra el nombre y la foto
    // de perfil del usuario en vez del ícono genérico.
    if (twitchUser) {
        const accountLi = list.querySelector('li[data-id="account"]');
        if (accountLi) {
            const label = accountLi.querySelector('.nav-label');
            if (label) label.textContent = twitchUser.display_name || twitchUser.login || "Cuenta";
            const icon = accountLi.querySelector('.nav-icon');
            if (icon && twitchUser.profile_image_url) {
                icon.innerHTML = `<img class="nav-account-avatar" src="${twitchUser.profile_image_url}" alt="">`;
            }
        }
    }
}

// ============================================================
// Secciones: todas se construyen y cargan en paralelo
// ============================================================
function initSections() {
    // Canales seguidos: SIEMPRE la primera sección (con o sin sesión)
    buildSectionSkeleton("seguidosChannels", "Canales seguidos");

    if (twitchUser) {
        loadSeguidosChannels();
    } else {
        const track = document.getElementById("track-seguidosChannels");
        if (track) {
            track.innerHTML = `<div class="tile-loading">Inicia sesión para ver canales seguidos</div>`;
        }
    }

    buildSectionSkeleton("featured", "Transmisiones destacadas");
    buildSectionSkeleton("topStreamers", "Streamers más vistos ahora");
    buildSectionSkeleton("topGames", "Juegos más vistos");
    setActiveSection("seguidosChannels");

    loadFeatured();
    loadTopStreamers();
    loadTopGames();
}

// Agrega o saca en caliente la fila de "Canales seguidos" cuando se inicia
// o cierra sesión, sin recargar la página.
function syncFollowedHomeSections() {
    const container = document.getElementById("sections");
    if (!container) return;

    if (twitchUser) {
        const track = document.getElementById("track-seguidosChannels");
        if (track && !document.querySelector('.section-row[data-section-id="seguidosChannels"] .tile-stream')) {
            loadSeguidosChannels();
        }
    } else {
        const track = document.getElementById("track-seguidosChannels");
        if (track) {
            track.innerHTML = `<div class="tile-loading">Inicia sesión para ver canales seguidos</div>`;
        }
    }
}

// Ícono de corazón para el encabezado de "Seguidos en vivo".
const HEART_ICON_HTML = '<svg class="section-title-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.35-9.33-8.2C1.02 10.6 1 8.28 2.44 6.5 4.06 4.5 7.1 4.24 9 6.06L12 9l3-2.94c1.9-1.82 4.94-1.56 6.56.44 1.44 1.78 1.42 4.1-.23 6.3C18.7 16.65 12 21 12 21z"/></svg>';

function buildSectionSkeleton(id, title, iconHtml = "", prepend = false) {
    const container = document.getElementById("sections");
    const row = document.createElement("div");
    row.className = "section-row";
    row.dataset.sectionId = id;
    row.innerHTML = `
        <div class="section-header">
            <h2 class="section-title">${iconHtml}${title}</h2>
        </div>
        <div class="tile-track" id="track-${id}"><div class="tile-loading">Cargando…</div></div>
    `;
    if (prepend && container.firstChild) container.insertBefore(row, container.firstChild);
    else container.appendChild(row);
    row.addEventListener("mouseenter", () => hoverSelectSection(id));

    const track = row.querySelector(".tile-track");
    enableDragScroll(track);
    addScrollButtons(row, track);
    return row;
}

function addScrollButtons(row, track) {
    const left = document.createElement("div");
    left.className = "scroll-btn left";
    left.textContent = "‹";
    left.addEventListener("click", () => track.scrollBy({ left: -track.clientWidth * 0.8, behavior: "smooth" }));

    const right = document.createElement("div");
    right.className = "scroll-btn right";
    right.textContent = "›";
    right.addEventListener("click", () => track.scrollBy({ left: track.clientWidth * 0.8, behavior: "smooth" }));

    row.appendChild(left);
    row.appendChild(right);
}

function enableDragScroll(track) {
    let isDown = false, startX = 0, scrollStart = 0, moved = 0;

    const onDown = (x) => { isDown = true; startX = x; scrollStart = track.scrollLeft; moved = 0; track.classList.add("dragging"); };
    const onMove = (x) => { if (!isDown) return; const dx = x - startX; moved = Math.max(moved, Math.abs(dx)); track.scrollLeft = scrollStart - dx; };
    const onUp = () => { isDown = false; track.classList.remove("dragging"); };

    track.addEventListener("mousedown", (e) => onDown(e.pageX));
    window.addEventListener("mousemove", (e) => { if (isDown) { e.preventDefault(); onMove(e.pageX); } });
    window.addEventListener("mouseup", onUp);

    track.addEventListener("touchstart", (e) => onDown(e.touches[0].pageX), { passive: true });
    track.addEventListener("touchmove", (e) => onMove(e.touches[0].pageX), { passive: true });
    track.addEventListener("touchend", onUp);

    track.addEventListener("click", (e) => { if (moved > 6) { e.stopPropagation(); e.preventDefault(); } }, true);
}

// ============================================================
// Manejo del control remoto
// ============================================================
function handleKeyDown(e) {
    const keyCode = e.keyCode || ({ArrowLeft:37, ArrowRight:39, ArrowUp:38, ArrowDown:40, Enter:13, " ":32, Escape:27}[e.key] || 0);

    // El overlay de cuenta/login tiene prioridad absoluta: "atrás" lo cierra
    // en vez de disparar la navegación general de la pantalla de fondo.
    if (document.getElementById("account-overlay")?.classList.contains("visible")) {
        handleAccountOverlayKeys(keyCode, e);
        return;
    }

    if (currentScreen === "player") {
        handlePlayerScreenKeys(keyCode, e);
        return; // el reproductor maneja su propio "atrás"
    }

    // ATRÁS (10009 en TV real, Esc=27 útil en navegador)
    if (keyCode === 10009 || keyCode === 27) {
        e.preventDefault();
        goBack();
        return;
    }

    if (currentScreen === "main") {
        if (!document.activeElement || document.activeElement === document.body) restoreMainFocus(focusZone === "content" ? navIndexForRow(contentRowId) : navIndex);
        handleMainScreenKeys(keyCode, e);
    } else if (currentScreen === "game" || currentScreen === "results") {
        handleGridScreenKeys(keyCode);
    }
    // search: el <input> real maneja el tipeo por sí solo (ver setupSearchInput)
}

function handleMainScreenKeys(keyCode, e) {

    // BACK/ATRÁS: únicamente funciona cuando el foco está en una tarjeta.
    if (keyCode === 27 || keyCode === 461 || keyCode === 10009 ||
        e?.key === "Escape" || e?.key === "BrowserBack") {
        if (typeof focusZone === "undefined" || focusZone !== "content") {
            return;
        }
    }

    const code = keyCode || ({ArrowLeft:37, ArrowRight:39, ArrowUp:38, ArrowDown:40, Enter:13, " ":32, Escape:27}[e?.key] || 0);
    const searchOverlay = document.getElementById("home-search-overlay");
    if (searchOverlay?.classList.contains("visible")) {
        const searchInput = document.getElementById("home-search-input");
        const searchSubmit = document.getElementById("home-search-submit");
        const searchClose = document.getElementById("home-search-close");
        const searchItems = [searchInput, searchSubmit, searchClose].filter(Boolean);
        const currentIndex = Math.max(0, searchItems.indexOf(document.activeElement));
        if (code === 27) { e.preventDefault(); closeHomeSearch(); return; }
        if (code === 37 || code === 39) {
            e.preventDefault();
            const delta = code === 37 ? -1 : 1;
            const nextIndex = (currentIndex + delta + searchItems.length) % searchItems.length;
            searchItems[nextIndex].focus({ preventScroll: true });
            searchItems.forEach(el => el.classList?.remove("focused"));
            if (searchItems[nextIndex].tagName === "BUTTON") searchItems[nextIndex].classList.add("focused");
            return;
        }
        if (code === 13 && document.activeElement === searchSubmit) { e.preventDefault(); searchSubmit.click(); return; }
        if (code === 13 && document.activeElement === searchClose) { e.preventDefault(); closeHomeSearch(); return; }
        return;
    }
    if ([37, 38, 39, 40].includes(code)) contentRowIdWasChangedByUser = true;
    switch (code) {
        case 37: // izquierda
            if (focusZone === "content") {
                if (contentTileIndex > 0) focusContentTile(contentRowId, contentTileIndex - 1);
                else setFocus("nav", navIndexForRow(contentRowId));
            }
            break;
        case 39: // derecha
            if (focusZone === "nav") {
                const item = NAV_ITEMS[navIndex];
                if (item && item.id !== "search") focusContentZone(item.id, 0);
            } else if (focusZone === "content") {
                if (contentTileIndex + 1 < getRowTileCount(contentRowId)) focusContentTile(contentRowId, contentTileIndex + 1);
            }
            break;
        case 38: // arriba
            if (focusZone === "nav") setFocus("nav", Math.max(0, navIndex - 1));
            else if (focusZone === "content") moveContentRow(-1);
            else if (focusZone === "followed") {
                if (followedFocusIndex > 0) setFocus("followed", followedFocusIndex - 1);
                else setFocus("nav", NAV_ITEMS.length - 1);
            }
            break;
        case 40: // abajo
            if (focusZone === "nav") {
                if (navIndex >= NAV_ITEMS.length - 1 && followedSidebarItems.length) setFocus("followed", 0);
                else setFocus("nav", Math.min(NAV_ITEMS.length - 1, navIndex + 1));
            } else if (focusZone === "content") moveContentRow(1);
            else if (focusZone === "followed") setFocus("followed", Math.min(followedSidebarItems.length - 1, followedFocusIndex + 1));
            break;
        case 13: // Enter/OK
            if (focusZone === "nav") selectNavItem();
            else if (focusZone === "content") selectContentTile();
            else if (focusZone === "followed") {
                const it = followedSidebarItems[followedFocusIndex];
                if (it) openChannel(it.login);
            }
            break;
    }
}

// Barra de acciones del perfil (Ver en vivo + Seguir): ambos botones son
// navegables con izquierda/derecha y activables con Enter, igual que el
// resto de la interfaz para mando/teclado.
function getResultsActionEls() {
    const watchBtn = document.getElementById("channel-watch-btn");
    const followBtn = document.getElementById("channel-follow-btn");
    const chatBtn = document.getElementById("channel-chat-btn");
    return {
        watchBtn,
        followBtn,
        chatBtn,
        watchVisible: !!watchBtn && !watchBtn.classList.contains("hidden"),
        followVisible: !!followBtn && !followBtn.classList.contains("hidden"),
        chatVisible: !!chatBtn && !chatBtn.classList.contains("hidden")
    };
}

function focusResultsAction(preferred) {
    const { watchBtn, followBtn, chatBtn, watchVisible, followVisible, chatVisible } = getResultsActionEls();
    if (!watchVisible && !followVisible && !chatVisible) return false;
    const order = ["watch", "follow", "chat"];
    const visible = { watch: watchVisible, follow: followVisible, chat: chatVisible };
    if (!order.includes(preferred) || !visible[preferred]) {
        preferred = order.find(k => visible[k]) || "watch";
    }

    resultsFocusZone = "watch";
    resultsActionFocus = preferred;
    if (watchBtn) watchBtn.classList.remove("focused");
    if (followBtn) followBtn.classList.remove("focused");
    if (chatBtn) chatBtn.classList.remove("focused");
    const targets = { watch: watchBtn, follow: followBtn, chat: chatBtn };
    const target = targets[preferred];
    if (!target) return false;
    target.focus({preventScroll:true});
    target.classList.add("focused");
    return true;
}

// Navegación simple en grid (pantallas de juego y resultados de búsqueda)
function handleGridScreenKeys(keyCode) {
    if (currentScreen === "results") {
        const { watchBtn, followBtn, chatBtn, watchVisible, followVisible, chatVisible } = getResultsActionEls();
        const sectionTiles = resultsContentSection === "clips"
            ? Array.from(document.querySelectorAll("#clips-grid .tile-clip"))
            : Array.from(document.querySelectorAll("#results-grid .tile-stream"));

        if (resultsFocusZone === "watch" && (watchVisible || followVisible || chatVisible)) {
            const actionOrder = ["watch", "follow", "chat"].filter(k =>
                ({ watch: watchVisible, follow: followVisible, chat: chatVisible })[k]
            );
            if (keyCode === 40) {
                resultsFocusZone = "grid";
                resultsContentSection = "vods";
                if (watchBtn) watchBtn.classList.remove("focused");
                if (followBtn) followBtn.classList.remove("focused");
                if (chatBtn) chatBtn.classList.remove("focused");
                gridFocusIndex = 0;
                focusProfileSection("vods", 0);
            } else if ((keyCode === 37 || keyCode === 39) && actionOrder.length > 1) {
                const curIdx = actionOrder.indexOf(resultsActionFocus);
                const dir = keyCode === 39 ? 1 : -1;
                const nextIdx = Math.max(0, Math.min(actionOrder.length - 1, (curIdx < 0 ? 0 : curIdx) + dir));
                focusResultsAction(actionOrder[nextIdx]);
            } else if (keyCode === 13) {
                const targets = { watch: watchBtn, follow: followBtn, chat: chatBtn };
                const target = targets[resultsActionFocus] || watchBtn;
                target && target.click();
            }
            return;
        }

        if (resultsContentSection === "vods" && keyCode === 40) {
            const clips = document.querySelectorAll("#clips-grid .tile-clip");
            if (clips.length) {
                resultsContentSection = "clips";
                gridFocusIndex = Math.min(gridFocusIndex, clips.length - 1);
                focusProfileSection("clips", gridFocusIndex);
                return;
            }
        }
        if (resultsContentSection === "clips" && keyCode === 38) {
            const vods = document.querySelectorAll("#results-grid .tile-stream");
            if (vods.length) {
                // Si existen VODs, volver a la fila superior conservando la columna.
                resultsContentSection = "vods";
                gridFocusIndex = Math.min(gridFocusIndex, vods.length - 1);
                focusProfileSection("vods", gridFocusIndex);
                return;
            }

            // Si no hay VODs, Clips es la primera fila de contenido.
            // Al pulsar arriba, devolver el foco a la barra de acciones cuando está disponible.
            if (watchVisible || followVisible || chatVisible) {
                document.querySelectorAll("#clips-grid .focused").forEach(t => t.classList.remove("focused"));
                focusResultsAction(resultsActionFocus);
                if (window.hideFocusBackground) window.hideFocusBackground();
                return;
            }
        }

        if (!sectionTiles.length) {
            if (keyCode === 38 && (watchVisible || followVisible || chatVisible)) {
                focusResultsAction(resultsActionFocus);
            }
            return;
        }
        const isCarousel = true;
        switch (keyCode) {
            case 37: if (gridFocusIndex > 0) gridFocusIndex--; break;
            case 39: if (gridFocusIndex + 1 < sectionTiles.length) gridFocusIndex++; break;
            case 38:
                if (resultsContentSection === "vods" && (watchVisible || followVisible || chatVisible)) {
                    sectionTiles[gridFocusIndex]?.classList.remove("focused");
                    focusResultsAction(resultsActionFocus);
                    return;
                }
                break;
            case 13:
                sectionTiles[gridFocusIndex]?.click();
                return;
            default: return;
        }
        sectionTiles.forEach(t => t.classList.remove("focused"));
        const target = sectionTiles[Math.max(0, Math.min(gridFocusIndex, sectionTiles.length - 1))];
        target.classList.add("focused");

        // Actualizar siempre el fondo al mover el foco con mando/teclado.
        // No dependemos únicamente del evento focus porque el blur de la
        // tarjeta anterior puede ejecutarse después y restaurar otro fondo.
        if (window.updateFocusBackground) {
            window.updateFocusBackground(target);
        }

        // IMPORTANTE: no usar scrollIntoView aquí porque puede desplazar
        // toda la pantalla de perfil (portada, avatar y datos del canal).
        // Solo movemos horizontalmente la fila de tarjetas.
        target.focus({preventScroll:true});
        const profileTrack = target.closest(".profile-track");
        if (profileTrack) {
            const tr = target.getBoundingClientRect();
            const rr = profileTrack.getBoundingClientRect();
            const margin = 18;

            if (tr.right > rr.right - margin) {
                profileTrack.scrollBy({
                    left: tr.right - (rr.right - margin),
                    behavior: "smooth"
                });
            } else if (tr.left < rr.left + margin) {
                profileTrack.scrollBy({
                    left: -((rr.left + margin) - tr.left),
                    behavior: "smooth"
                });
            }
        }
        return;
    }

    const gridId = "game-screen-grid";
    const tiles = Array.from(document.querySelectorAll(`#${gridId} .tile-stream, #${gridId} .tile-game, #${gridId} .tile-vod`));
    if (!tiles.length) return;
    const cols = getGridColumnCount(tiles);
    switch (keyCode) {
        case 37: if (gridFocusIndex % cols > 0) gridFocusIndex--; break;
        case 39: if (gridFocusIndex % cols < cols - 1 && gridFocusIndex + 1 < tiles.length) gridFocusIndex++; break;
        case 38: if (gridFocusIndex - cols >= 0) gridFocusIndex -= cols; break;
        case 40: if (gridFocusIndex + cols < tiles.length) gridFocusIndex += cols; break;
        case 13: tiles[gridFocusIndex]?.click(); return;
        default: return;
    }
    gridFocusIndex = Math.max(0, Math.min(gridFocusIndex, tiles.length - 1));
    tiles.forEach(t => t.classList.remove("focused"));
    const target = tiles[gridFocusIndex];
    target.classList.add("focused");
    if (window.updateFocusBackground) window.updateFocusBackground(target);
    target.focus({preventScroll:true});
}

function focusProfileSection(section, index=0) {
    resultsContentSection = section;

    document.querySelectorAll(
        "#results-grid .tile-stream.focused, #clips-grid .tile-clip.focused"
    ).forEach(t => t.classList.remove("focused"));

    const selector = section === "clips"
        ? "#clips-grid .tile-clip"
        : "#results-grid .tile-stream";

    const tiles = Array.from(document.querySelectorAll(selector));
    if (!tiles.length) return;

    gridFocusIndex = Math.max(0, Math.min(index, tiles.length - 1));
    const tile = tiles[gridFocusIndex];

    tile.classList.add("focused");

    if (window.updateFocusBackground) {
        window.updateFocusBackground(tile);
    }

    // IMPORTANTE:
    // No scrollIntoView(), porque puede mover la portada y la información
    // del perfil. Solo se desplaza horizontalmente el carrusel.
    tile.focus({preventScroll:true});

    const track = tile.closest("#results-grid, #clips-grid");
    if (!track) return;

    const visibleLeft = track.scrollLeft;
    const visibleRight = visibleLeft + track.clientWidth;
    const tileLeft = tile.offsetLeft;
    const tileRight = tileLeft + tile.offsetWidth;

    // La primera tarjeta permanece visible mientras haya espacio.
    // Solo avanzamos cuando el foco llega al último elemento visible.
    const edge = 10;

    if (tileRight > visibleRight - edge) {
        const amount = tileRight - (visibleRight - edge);
        track.scrollBy({
            left: amount,
            behavior: "smooth"
        });
    } else if (tileLeft < visibleLeft + edge) {
        const amount = tileLeft - (visibleLeft + edge);
        track.scrollBy({
            left: amount,
            behavior: "smooth"
        });
    }
}

// Calcula el número real de columnas de un grid responsivo contando
// cuántos elementos comparten la misma fila (mismo offsetTop) que el
// primero. Necesario porque .tile-grid usa auto-fit, así que el número
// de columnas cambia según el ancho de pantalla y no puede asumirse fijo.
function getGridColumnCount(tiles) {
    if (!tiles.length) return 1;
    const firstTop = tiles[0].offsetTop;
    let count = 0;
    for (const t of tiles) {
        if (Math.abs(t.offsetTop - firstTop) > 2) break;
        count++;
    }
    return Math.max(1, count);
}

function focusGrid(gridId) {
    const tiles = document.querySelectorAll(`#${gridId} .tile-stream, #${gridId} .tile-game, #${gridId} .tile-vod`);
    gridFocusIndex = 0;
    tiles.forEach(t => t.classList.remove("focused"));
    if (tiles[0]) { tiles[0].classList.add("focused"); tiles[0].focus({ preventScroll: true }); }
}

// ============================================================
// Foco visual — sidebar
// ============================================================
function setFocus(zone, index) {
    document.querySelectorAll("#nav-list li.focused, #followed-live-list li.focused, #followed-offline-list li.focused, .search-icon.focused")
        .forEach(el => el.classList.remove("focused"));
    document.querySelectorAll(".tile-stream.focused, .tile-game.focused, .tile-clip.focused")
        .forEach(el => el.classList.remove("focused"));

    focusZone = zone;

    if (zone === "nav") {
        const max = NAV_ITEMS.length - 1;
        navIndex = Math.max(0, Math.min(Number(index) || 0, max));
        const el = document.querySelector(`#nav-list li[data-index="${navIndex}"]`);
        if (!el) return;
        el.classList.add("focused");
        el.focus({ preventScroll: true });

        const item = NAV_ITEMS[navIndex];
        if (item && item.id !== "search") setActiveSection(item.id, true);
        else setActiveSection(null);
    } else if (zone === "followed") {
        if (!followedSidebarItems.length) { setFocus("nav", NAV_ITEMS.length - 1); return; }
        const max = followedSidebarItems.length - 1;
        followedFocusIndex = Math.max(0, Math.min(Number(index) || 0, max));
        const el = document.querySelector(`#followed-live-list li[data-flat-index="${followedFocusIndex}"], #followed-offline-list li[data-flat-index="${followedFocusIndex}"]`);
        if (!el) return;
        el.classList.add("focused");
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "nearest" });
        setActiveSection(null);
    }
}

// ============================================================
// Foco visual — contenido (filas deslizables)
// ============================================================
function focusContentZone(rowId, tileIndex) {
    document.querySelectorAll("#nav-list li.focused, #search-nav-item.focused").forEach(el => el.classList.remove("focused"));
    document.querySelectorAll("#nav-list li.selected").forEach(el => el.classList.remove("selected"));
    focusZone = "content";
    focusContentTile(rowId, tileIndex);
}

function focusContentTile(rowId, tileIndex) {
    document.querySelectorAll(".tile-stream.focused, .tile-game.focused").forEach(el => el.classList.remove("focused"));
    const tiles = getRowTiles(rowId);
    if (!tiles.length) return;
    const idx = Math.max(0, Math.min(tileIndex, tiles.length - 1));
    const tile = tiles[idx];
    tile.classList.add("focused");
    if (window.updateFocusBackground) window.updateFocusBackground(tile);
    // Solo desplaza la fila cuando la tarjeta ya no es visible.
    const row = tile.closest(".row, .carousel-row, .content-row, #results-grid, #clips-grid, #home-content");
    if (row) {
        const rr = row.getBoundingClientRect();
        const tr = tile.getBoundingClientRect();
        const margin = 12;
        if (tr.right > rr.right - margin) {
            row.scrollBy({left: tr.right - (rr.right - margin), behavior: "smooth"});
        } else if (tr.left < rr.left + margin) {
            row.scrollBy({left: -((rr.left + margin) - tr.left), behavior: "smooth"});
        }
    }
    tile.focus({ preventScroll: true });
    const track = tile.closest(".tile-track");
    if (track) {
        const tileLeft = tile.offsetLeft;
        const tileRight = tileLeft + tile.offsetWidth;
        const viewLeft = track.scrollLeft;
        const viewRight = viewLeft + track.clientWidth;
        if (tileLeft < viewLeft) track.scrollTo({ left: Math.max(0, tileLeft - 24), behavior: "smooth" });
        else if (tileRight > viewRight) track.scrollTo({ left: Math.min(track.scrollWidth - track.clientWidth, tileRight - track.clientWidth + 24), behavior: "smooth" });
    }
    contentRowId = rowId;
    contentTileIndex = idx;
    setActiveSection(rowId, true);
}

// Enfoca la primera tarjeta de "Canales seguidos"; si esa fila todavía no
// tiene tarjetas (por ejemplo, sin sesión iniciada), cae a la primera fila
// que sí tenga contenido. Se usa tanto al iniciar la app como al presionar
// "atrás" desde Inicio, para que el punto de partida sea siempre el mismo.
function focusFirstAvailableRow(preferredRowId = "seguidosChannels") {
    const rows = getVisibleRowIds();
    const targetRowId = getRowTileCount(preferredRowId) > 0
        ? preferredRowId
        : (rows.find(id => getRowTileCount(id) > 0) || preferredRowId);
    setActiveSection(targetRowId, true);
    focusContentZone(targetRowId, 0);
}

function moveContentRow(delta) {
    const rows = getVisibleRowIds();
    const pos = rows.indexOf(contentRowId);
    const newPos = Math.max(0, Math.min(rows.length - 1, pos + delta));
    const newRowId = rows[newPos];
    const tileCount = getRowTileCount(newRowId);
    const idx = tileCount ? Math.min(contentTileIndex, tileCount - 1) : 0;
    focusContentTile(newRowId, idx);
}

function getVisibleRowIds() {
    return Array.from(document.querySelectorAll(".section-row")).map(r => r.dataset.sectionId);
}

function getRowTiles(rowId) {
    const track = document.querySelector(`.section-row[data-section-id="${rowId}"] .tile-track`);
    return track ? Array.from(track.querySelectorAll(".tile-stream, .tile-game")) : [];
}

function getRowTileCount(rowId) {
    return getRowTiles(rowId).length;
}

function navIndexForRow(rowId) {
    const i = NAV_ITEMS.findIndex(n => n.id === rowId);
    return i === -1 ? 0 : i;
}

// ============================================================
// Selección de sección — por hover o por foco de control remoto
// ============================================================
function setActiveSection(id, alignSecond) {
    document.querySelectorAll(".section-row").forEach(row => {
        const isActive = id !== null && row.dataset.sectionId === id;
        row.classList.toggle("active-section", isActive);
        row.classList.toggle("dimmed", id !== null && !isActive);
    });
    document.querySelectorAll("#nav-list li").forEach(li => {
        // Mantiene una selección contextual en el menú aunque el foco real esté en
        // una tarjeta. Solo el elemento con .focused muestra el recuadro de foco.
        const shouldMarkSelected = id !== null && li.dataset.id === id;
        li.classList.toggle("selected", shouldMarkSelected);
    });
    // El desplazamiento siempre es suave, tanto al moverse entre tarjetas/
    // secciones con flechas como al navegar desde la barra lateral, para que
    // subir y bajar sigan la misma regla y no se sienta brusco en un sentido.
    if (alignSecond && id !== null) alignSectionAsSecond(id, "smooth");
}

// Desplaza #content para que, al enfocar una sección, sea la fila ANTERIOR
// a la enfocada la que quede pegada al borde superior del área visible
// (la enfocada queda como "segunda"). Si la enfocada es la primera fila,
// no hay anterior: se usa ella misma como referencia para llevar el scroll
// arriba del todo.
// El cálculo se hace en el siguiente frame porque enfocar una tarjeta puede
// colapsar/expandir la barra lateral (ver listener de "focusin" más abajo),
// lo que cambia el ancho/margen de #content; si medimos antes de que ese
// cambio de layout se aplique, el delta sale mal y el salto queda desfasado
// (por eso antes solo se veía bien con la barra abierta).
function alignSectionAsSecond(id, behavior) {
    requestAnimationFrame(() => {
        const content = document.getElementById("content");
        if (!content) return;
        const rows = Array.from(document.querySelectorAll(".section-row"));
        const idx = rows.findIndex(row => row.dataset.sectionId === id);
        if (idx === -1) return;

        // Fila de referencia: la anterior a la enfocada (o la propia si es la primera).
        const referenceRow = rows[idx - 1] || rows[idx];
        const contentRect = content.getBoundingClientRect();
        const rowRect = referenceRow.getBoundingClientRect();
        const topSafeMargin = parseFloat(getComputedStyle(content).paddingTop) || 0;

        // Delta para mover la fila de referencia al borde superior + margen
        // (funciona con barra cerrada/abierta).
        const delta = rowRect.top - contentRect.top - topSafeMargin;
        const targetScrollTop = Math.max(0, Math.min(
            content.scrollHeight - content.clientHeight,
            content.scrollTop + delta
        ));
        scrollIntoViewGuarded(content, null, targetScrollTop, behavior || "smooth");
    });
}

let suppressHoverUntil = 0;

function hoverSelectSection(id) {
    if (Date.now() < suppressHoverUntil) return;
    contentRowIdWasChangedByUser = true;
    setActiveSection(id);
}

function scrollIntoViewGuarded(el, opts, scrollTopOverride, behavior) {
    // El guard de hover solo hace falta tras un salto animado (desde el
    // sidebar); un salto instantáneo no necesita bloquear el hover porque
    // no hay animación en curso que el mouse pueda pisar.
    const effectiveBehavior = behavior || "smooth";
    suppressHoverUntil = Date.now() + (effectiveBehavior === "auto" ? 0 : 800);
    if (scrollTopOverride !== undefined) {
        el.scrollTo({ top: scrollTopOverride, behavior: effectiveBehavior });
    } else {
        el.scrollIntoView(opts);
    }
}

// ============================================================
// Selección de item del sidebar
// ============================================================
function selectNavItem() {
    const item = NAV_ITEMS[navIndex];
    if (!item) return;

    if (item.id === "search") {
        openSearch();
        return;
    }
    if (item.id === "account") {
        openAccountOverlay();
        return;
    }
    if (item.id === "seguidosChannels" && !twitchUser) {
        openAccountOverlay();
        return;
    }

    focusContentZone(item.id, 0);
}

function selectContentTile() {
    const tiles = getRowTiles(contentRowId);
    const tile = tiles[contentTileIndex];
    if (!tile) return;
    if (tile.dataset.kind === "vod" || tile.dataset.videoId) {
        openVod(tile.dataset.videoId, tile.dataset.channel, tile.dataset.title || tile.querySelector(".stream-title")?.textContent || "");
    } else if (tile.dataset.gameId) {
        openGameScreen(tile.dataset.gameId, tile.dataset.game, tile.dataset.boxArt || "");
    } else if (tile.dataset.channel) {
        // Las tarjetas de "Canales seguidos" (desconectados) deben ir al
        // perfil, igual que el clic con mouse (openFollowedChannel), no
        // directo al reproductor.
        if (tile.classList.contains("tile-followed-offline")) {
            openFollowedChannel(tile.dataset.channel);
        } else {
            openChannel(tile.dataset.channel);
        }
    }
}

// ============================================================
// Construcción de tiles
// ============================================================
function buildStreamTile(s, profileImageUrl = "") {
    const el = document.createElement("div");
    el.className = currentScreen === "game" ? "tile-stream game-stream-card" : "tile-stream";
    el.tabIndex = -1;
    el.dataset.channel = s.user_login;

    const thumb = (s.thumbnail_url || "")
        .replace("{width}", "320").replace("{height}", "180");
    if (currentScreen === "game" && thumb) {
        el.style.setProperty("--stream-thumb", `url("${thumb.replace(/"/g, '\\"')}")`);
    }

    const profileAvatar = profileImageUrl
        ? `<img class="streamer-profile-avatar" src="${profileImageUrl}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
        : "";

    el.innerHTML = `
        <span class="live-badge">EN VIVO</span>
        <span class="viewer-badge">${Number(s.viewer_count || 0).toLocaleString("es")}</span>
        <img src="${thumb}" alt="${escapeHtml(s.user_name || s.user_login || "")}" loading="lazy" decoding="async">
        ${profileAvatar}
        <div class="overlay">
            <div class="stream-title">${escapeHtml(s.user_name || s.user_login || "")}</div>
            <div class="stream-meta">${escapeHtml(s.game_name || "")}</div>
        </div>
    `;
    el.addEventListener("click", () => openChannel(s.user_login));
    return el;
}


async function getStreamerProfileMap(streams) {
    const logins = [...new Set(
        streams.map(s => s.user_login).filter(Boolean)
    )];

    const map = new Map();
    if (!logins.length) return map;

    // La API de Twitch (/users) solo acepta hasta 100 "login" por
    // petición: si se piden más, Twitch responde con error y no se
    // carga ninguna foto de perfil. Se divide en bloques de 100 para
    // que esto nunca falle, sin importar cuántos streamers se muestren
    // (por ejemplo, al sumar todas las filas "por juego" de la pantalla
    // principal).
    const CHUNK_SIZE = 100;
    for (let i = 0; i < logins.length; i += CHUNK_SIZE) {
        const chunk = logins.slice(i, i + CHUNK_SIZE);
        try {
            const params = chunk
                .map(login => `login=${encodeURIComponent(login)}`)
                .join("&");
            const response = await helixGet(`users?${params}`);
            (response.data || []).forEach(user => {
                map.set(String(user.login).toLowerCase(), user.profile_image_url || "");
            });
        } catch (error) {
            console.warn("No se pudieron cargar las fotos de perfil:", error);
        }
    }
    return map;
}

function buildGameTile(g) {
    const el = document.createElement("div");
    el.className = "tile-game";
    el.tabIndex = -1;
    el.dataset.gameId = g.id;
    el.dataset.game = g.name;
    const boxArt = g.box_art_url.replace("{width}", "190").replace("{height}", "253");
    el.dataset.boxArt = boxArt;
    const viewers = Number.isFinite(Number(g.viewer_count))
        ? `${Number(g.viewer_count).toLocaleString("es")} espectadores`
        : "";
    el.innerHTML = `
        <img src="${boxArt}" alt="${escapeHtml(g.name)}" loading="lazy" decoding="async">
        <div class="game-name">${escapeHtml(g.name)}</div>
        <div class="game-viewers">${viewers}</div>
    `;
    el.addEventListener("click", () => openGameScreen(g.id, g.name));
    return el;
}

function buildVodTile(v) {
    const el = document.createElement("div");
    el.className = "tile-stream tile-vod";
    el.tabIndex = -1;
    el.dataset.videoId = v.id;
    el.dataset.channel = v.user_login;
    el.dataset.title = v.title || "";
    el.dataset.kind = "vod";
    const thumb = (v.thumbnail_url || "")
        .replace("%{width}", "320").replace("%{height}", "180");
    const date = new Date(v.created_at).toLocaleDateString("es");
    const views = v.view_count != null ? `${Number(v.view_count).toLocaleString("es")} visualizaciones` : "";
    const meta = [date, views].filter(Boolean).join(" · ");
    el.innerHTML = `
        <span class="viewer-badge">${v.duration || ""}</span>
        <div class="profile-card-title">${escapeHtml(v.title || "(sin título)")}</div>
        <img src="${thumb}" alt="${escapeHtml(v.title || "VOD")}" loading="lazy" decoding="async" onerror="this.style.opacity=0">
        <div class="profile-card-meta">${meta}</div>
    `;
    el.addEventListener("click", () => openVod(v.id, v.user_login, v.title));
    return el;
}

function buildClipTile(c) {
    const el = document.createElement("div");
    el.className = "tile-stream tile-clip";
    el.tabIndex = -1;
    el.dataset.clipId = c.id;
    el.dataset.channel = c.broadcaster_name || "";
    const thumb = c.thumbnail_url || "";
    const title = c.title || "Clip";
    const creator = c.creator_name || "";
    el.innerHTML = `
        <div class="profile-card-title">${escapeHtml(title)}</div>
        <img class="clip-thumb" src="${thumb}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" onerror="this.style.opacity=0">
        <div class="profile-card-meta">${escapeHtml(creator)}</div>
    `;
    el.addEventListener("click", () => openClip(c.id, c.broadcaster_login));
    return el;
}

// ============================================================
// Carga de secciones (en paralelo)
// ============================================================
async function loadFeatured() {
    const track = document.getElementById("track-featured");
    // Twitch no tiene una API de "destacados" oficiales — mostramos los
    // streams en español más vistos ahora mismo como destacados.
    const streams = await fetchTopStreams(8, "es");
    track.innerHTML = "";
    if (!streams.length) { track.innerHTML = '<div class="tile-loading">No se pudieron cargar transmisiones en español.</div>'; return; }
    const profileMap = await getStreamerProfileMap(streams);
    streams.forEach(s => {
        const profile = profileMap.get(String(s.user_login || "").toLowerCase()) || "";
        track.appendChild(buildStreamTile(s, profile));
    });
    if (focusZone === "content" && contentRowId === "featured") focusContentTile("featured", contentTileIndex);
}

async function loadTopGames() {
    const track = document.getElementById("track-topGames");
    const games = await fetchTopGames(18);
    track.innerHTML = "";
    if (!games.length) {
        track.innerHTML = '<div class="tile-loading">No se pudieron cargar juegos.</div>';
        removeGameStreamSections();
        return;
    }

    // La API de /games/top no devuelve espectadores. Los calculamos
    // sumando los espectadores de los streams activos de cada juego, y de
    // paso reutilizamos esos mismos streams para armar, más abajo, una
    // sección de transmisiones por cada juego.
    const gamesWithStreams = await Promise.all(games.map(async g => {
        try {
            const streams = await fetchStreamsByGame(g.id, 100);
            const viewerCount = streams.reduce((total, s) => total + (Number(s.viewer_count) || 0), 0);
            return { ...g, viewer_count: viewerCount, streams };
        } catch (_) {
            return { ...g, viewer_count: 0, streams: [] };
        }
    }));

    gamesWithStreams.forEach(g => track.appendChild(buildGameTile(g)));
    if (focusZone === "content" && contentRowId === "topGames") focusContentTile("topGames", contentTileIndex);

    await buildGameStreamSections(gamesWithStreams);
}

// Crea, en la pantalla de inicio, una sección con las transmisiones en vivo
// de cada juego del top (una fila por juego). Estas filas son solo de
// contenido: no se agregan como ítems de la barra lateral (#nav-list).
async function buildGameStreamSections(games) {
    removeGameStreamSections();

    const MAX_STREAMS_PER_GAME = 12;
    const gamesWithLiveStreams = games.filter(g => (g.streams || []).length);
    if (!gamesWithLiveStreams.length) return;

    // Se piden los perfiles de todos los streamers mostrados en una sola
    // llamada (en vez de una por juego) para no multiplicar peticiones.
    const shownStreams = gamesWithLiveStreams.flatMap(g => g.streams.slice(0, MAX_STREAMS_PER_GAME));
    const profileMap = await getStreamerProfileMap(shownStreams);

    gamesWithLiveStreams.forEach(g => {
        const sectionId = `game-${g.id}`;
        buildSectionSkeleton(sectionId, g.name);
        const row = document.querySelector(`.section-row[data-section-id="${sectionId}"]`);
        if (row) row.dataset.gameSection = "1";
        const gameTrack = document.getElementById(`track-${sectionId}`);
        if (!gameTrack) return;
        gameTrack.innerHTML = "";
        g.streams.slice(0, MAX_STREAMS_PER_GAME).forEach(s => {
            const profile = profileMap.get(String(s.user_login || "").toLowerCase()) || "";
            gameTrack.appendChild(buildStreamTile(s, profile));
        });
    });
}

function removeGameStreamSections() {
    document.querySelectorAll('.section-row[data-game-section="1"]').forEach(row => {
        if (focusZone === "content" && contentRowId === row.dataset.sectionId) {
            focusContentTile(getVisibleRowIds()[0] || "featured", 0);
        }
        row.remove();
    });
}

async function loadTopStreamers() {
    const track = document.getElementById("track-topStreamers");
    const streams = await fetchTopStreams(12);
    track.innerHTML = "";
    if (!streams.length) { track.innerHTML = '<div class="tile-loading">No se pudieron cargar streamers.</div>'; return; }
    const profileMap = await getStreamerProfileMap(streams);
    streams.forEach(s => {
        const profile = profileMap.get(String(s.user_login || "").toLowerCase()) || "";
        track.appendChild(buildStreamTile(s, profile));
    });
    if (focusZone === "content" && contentRowId === "topStreamers") focusContentTile("topStreamers", contentTileIndex);
}

// Si una fila se borra (porque quedó vacía) mientras el foco del control
// remoto/teclado seguía apuntando a ella —ya sea con una tarjeta enfocada
// (zona "content") o con el propio ítem del menú resaltado antes de entrar
// (zona "nav", como pasa justo al cargar la pantalla principal)—, hay que
// reubicar el foco en la primera fila que sí exista. Sin esto, el menú
// podía quedar señalando una sección ya eliminada.
function redirectRowFocusIfRemoved(rowId) {
    const fallback = getVisibleRowIds()[0] || "featured";
    if (focusZone === "content" && contentRowId === rowId) {
        focusContentTile(fallback, 0);
    } else if (focusZone === "nav" && NAV_ITEMS[navIndex] && NAV_ITEMS[navIndex].id === rowId) {
        setFocus("nav", navIndexForRow(fallback));
    }
}

// Fila "Canales seguidos": primero los seguidos que están EN VIVO ahora
// (misma tarjeta grande de siempre, ordenados por audiencia), y a
// continuación los que están desconectados, con la portada del canal
// (o su foto de perfil si no tiene portada configurada) como miniatura y
// una etiqueta "OFFLINE" en la tarjeta, en vez de la fila aparte que había
// antes para "Seguidos en vivo".
async function loadSeguidosChannels() {
    const row = document.querySelector('.section-row[data-section-id="seguidosChannels"]');
    const track = document.getElementById("track-seguidosChannels");
    if (!row || !track) return;

    const [liveStreams, channels] = await Promise.all([fetchFollowedLiveStreams(), fetchFollowedChannels()]);
    if (!twitchUser) return; // la sesión pudo cerrarse mientras esperábamos la respuesta

    if (!liveStreams.length && !channels.length) {
        row.remove();
        redirectRowFocusIfRemoved("seguidosChannels");
        return;
    }

    const liveIds = new Set(liveStreams.map(s => s.user_id));
    const offline = channels.filter(c => !liveIds.has(c.broadcaster_id));
    const sortedLive = liveStreams.slice().sort((a, b) => Number(b.viewer_count || 0) - Number(a.viewer_count || 0));

    const [profileMap, coverMap, offlineAvatarMap, lastLiveMap] = await Promise.all([
        getStreamerProfileMap(sortedLive),
        fetchUserCoverImagesByLogin(offline.map(c => c.broadcaster_login)),
        fetchUserAvatarsByLogin(offline.map(c => c.broadcaster_login)),
        fetchLastLiveByUserIds(offline.map(c => c.broadcaster_id))
    ]);

    // Desconectados ordenados por última vez en vivo (más reciente primero);
    // los que no tienen ninguna transmisión guardada (sin VODs) quedan al
    // final, ordenados por nombre.
    const offlineSorted = offline.slice().sort((a, b) => {
        const ta = lastLiveMap.get(a.broadcaster_id);
        const tb = lastLiveMap.get(b.broadcaster_id);
        if (ta && tb) return new Date(tb) - new Date(ta);
        if (ta && !tb) return -1;
        if (!ta && tb) return 1;
        return (a.broadcaster_name || a.broadcaster_login)
            .localeCompare(b.broadcaster_name || b.broadcaster_login, "es");
    });

    track.innerHTML = "";
    sortedLive.forEach(s => {
        const profile = profileMap.get(String(s.user_login || "").toLowerCase()) || "";
        track.appendChild(buildStreamTile(s, profile));
    });
    offlineSorted.forEach(c => track.appendChild(buildOfflineFollowedTile(
        c,
        coverMap.get(c.broadcaster_login) || "",
        offlineAvatarMap.get(c.broadcaster_login) || "",
        formatLastLiveLabel(lastLiveMap.get(c.broadcaster_id))
    )));

    if (focusZone === "content" && contentRowId === "seguidosChannels") {
        focusContentTile("seguidosChannels", contentTileIndex);
    } else if (focusZone === "content" && !contentRowIdWasChangedByUser) {
        // Las tarjetas de "Canales seguidos" tardaron en llegar y, mientras
        // tanto, el foco inicial había caído en otra fila por no encontrar
        // contenido todavía. Ahora que ya hay tarjetas, movemos el foco ahí
        // (solo si el usuario no navegó manualmente mientras tanto).
        focusFirstAvailableRow("seguidosChannels");
    }
}

// Tarjeta para un canal seguido que está desconectado: misma medida que las
// tarjetas de stream en vivo, pero con la portada/foto de perfil del canal
// como miniatura y una etiqueta "OFFLINE" en vez de "EN VIVO". Al tocarla
// se abre su perfil (como si se buscara el nombre), no el reproductor, ya
// que el canal no está en vivo.
function buildOfflineFollowedTile(channel, coverUrl, avatarUrl, lastLiveLabel) {
    const el = document.createElement("div");
    el.className = "tile-stream tile-followed-offline";
    el.tabIndex = -1;
    el.dataset.channel = channel.broadcaster_login;
    const name = channel.broadcaster_name || channel.broadcaster_login;
    el.title = name;
    el.setAttribute("aria-label", name);
    const profileAvatar = avatarUrl
        ? `<img class="streamer-profile-avatar" src="${avatarUrl}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
        : "";
    el.innerHTML = `
        <span class="offline-badge">OFFLINE</span>
        <img src="${coverUrl}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.style.visibility='hidden'">
        ${profileAvatar}
        <div class="overlay">
            <div class="stream-title">${escapeHtml(name)}</div>
            <div class="stream-meta">${escapeHtml(lastLiveLabel || "")}</div>
        </div>
    `;
    el.addEventListener("click", () => openFollowedChannel(channel.broadcaster_login));
    return el;
}

// Última vez que un canal seguido (desconectado) transmitió en vivo: Twitch
// no expone esto directamente, así que se aproxima con la fecha del VOD más
// reciente (type=archive) de ese canal.
async function fetchLastLiveByUserIds(userIds) {
    const map = new Map();
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return map;
    await Promise.all(unique.map(async (id) => {
        try {
            const data = await helixGet(`videos?user_id=${encodeURIComponent(id)}&type=archive&first=1`);
            const v = (data.data || [])[0];
            if (v && v.created_at) map.set(id, v.created_at);
        } catch (e) { /* sin dato para este canal, se deja fuera del mapa */ }
    }));
    return map;
}

// Texto corto tipo "hace 3 días" para mostrar debajo del nombre del canal
// desconectado.
function formatLastLiveLabel(iso) {
    if (!iso) return "Sin transmisiones recientes";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "Sin transmisiones recientes";
    const diffMs = Math.max(0, Date.now() - then);
    const minute = 60000, hour = 3600000, day = 86400000, month = day * 30, year = day * 365;
    let text;
    if (diffMs < hour) {
        const m = Math.max(1, Math.round(diffMs / minute));
        text = `hace ${m} min`;
    } else if (diffMs < day) {
        const h = Math.round(diffMs / hour);
        text = `hace ${h} h`;
    } else if (diffMs < day * 2) {
        text = "ayer";
    } else if (diffMs < month) {
        const d = Math.round(diffMs / day);
        text = `hace ${d} días`;
    } else if (diffMs < year) {
        const mo = Math.round(diffMs / month);
        text = `hace ${mo} ${mo === 1 ? "mes" : "meses"}`;
    } else {
        const y = Math.round(diffMs / year);
        text = `hace ${y} ${y === 1 ? "año" : "años"}`;
    }
    return `Última vez en vivo: ${text}`;
}

// Clic en una tarjeta de "Canales seguidos": por diseño esta fila solo
// contiene canales desconectados, pero volvemos a chequear en el momento
// (pudo empezar a transmitir justo antes del refresco automático de 60s).
// Si sigue desconectado, abrimos su perfil en vez del reproductor.
// ---- Chat desde el perfil de un canal (visible cuando está offline) ----
// Reutiliza el mismo #chat-panel del reproductor: se lo mueve dentro de
// #results-screen (a la derecha, fondo oscuro semitransparente, igual que
// en el reproductor) y se conecta el WebSocket de chat normal.
function openProfileChat(login) {
    if (!login) return;
    const panel = document.getElementById("chat-panel");
    const resultsScreen = document.getElementById("results-screen");
    if (!panel || !resultsScreen) return;
    if (panel.parentElement !== resultsScreen) resultsScreen.appendChild(panel);
    panel.classList.remove("hidden-chat");
    panel.classList.add("profile-chat-mode");
    document.getElementById("chat-messages").innerHTML = "";
    profileChatOpen = true;
    profileChatLogin = login;
    connectChat(login);
    loadChatCosmetics(login);
    const btn = document.getElementById("channel-chat-btn");
    if (btn) btn.textContent = "✕ Cerrar chat";
    document.getElementById("profile-chat-input")?.focus();
}

function closeProfileChat() {
    const panel = document.getElementById("chat-panel");
    if (profileChatOpen) disconnectChat();
    profileChatOpen = false;
    profileChatLogin = null;
    if (panel) {
        panel.classList.add("hidden-chat");
        panel.classList.remove("profile-chat-mode");
    }
    const btn = document.getElementById("channel-chat-btn");
    if (btn) btn.textContent = "💬 Chatear";
}

function toggleProfileChat(login) {
    if (profileChatOpen) closeProfileChat();
    else openProfileChat(login);
}

(function setupProfileChatInput() {
    const input = document.getElementById("profile-chat-input");
    if (!input) return;
    input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const text = input.value.trim();
        input.value = "";
        if (!text || !profileChatLogin) return;
        if (twitchUser && chatSocket && chatSocket.readyState === WebSocket.OPEN) {
            chatSocket.send(`PRIVMSG #${profileChatLogin.toLowerCase()} :${text}`);
            appendChatMessage({
                tags: { "display-name": twitchUser.display_name || twitchUser.login, color: "#9146FF" },
                text
            });
        } else if (twitchUser) {
            appendSystemMessage("No se pudo enviar: el chat no está conectado en este momento.");
        } else {
            appendSystemMessage("Para enviar mensajes al chat necesitas iniciar sesión con Twitch.");
        }
    });
})();

async function openFollowedChannel(login) {
    if (!login) return;
    const streams = await fetchStreamsByLogin(login);
    if (streams[0]) {
        openChannel(login);
        return;
    }
    if (currentScreen === "main") rememberMainFocusForReturn();
    runSearch(login);
}

// ============================================================
// Pantalla dedicada: streams en vivo de un juego
// ============================================================
async function openGameScreen(gameId, gameName, gameBoxArt = "") {
    if (window.clearFocusBackground) window.clearFocusBackground();
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById("game-screen").classList.add("active");
    currentScreen = "game";
    document.getElementById("game-screen-title").textContent = gameName;
    const gameViewersEl = document.getElementById("game-screen-viewers");
    if (gameViewersEl) gameViewersEl.textContent = "";
    const coverEl = document.getElementById("game-screen-cover");
    if (coverEl) {
        coverEl.src = gameBoxArt || "";
        coverEl.alt = gameName ? `Portada de ${gameName}` : "";
        coverEl.style.visibility = gameBoxArt ? "visible" : "hidden";
    }
    const grid = document.getElementById("game-screen-grid");
    grid.innerHTML = '<div class="tile-loading">Cargando…</div>';

    if (!gameBoxArt) {
        try {
            const gameData = await helixGet(`games?id=${encodeURIComponent(gameId)}`);
            const game = (gameData.data || [])[0];
            if (game?.box_art_url) {
                gameBoxArt = game.box_art_url.replace("{width}", "220").replace("{height}", "293");
                if (coverEl) {
                    coverEl.src = gameBoxArt;
                    coverEl.alt = `Portada de ${gameName}`;
                    coverEl.style.visibility = "visible";
                }
            }
        } catch (_) {}
    }

    const streams = await fetchStreamsByGame(gameId, 20);
    grid.innerHTML = "";
    if (!streams.length) {
        if (gameViewersEl) gameViewersEl.textContent = "0 espectadores";
        grid.innerHTML = '<div class="tile-loading">No hay transmisiones en vivo de este juego ahora.</div>';
        return;
    }

    const totalViewers = streams.reduce((total, s) => total + (Number(s.viewer_count) || 0), 0);
    if (gameViewersEl) {
        gameViewersEl.textContent = `${totalViewers.toLocaleString("es")} espectadores`;
    }

    const profileMap = await getStreamerProfileMap(streams);
    streams.forEach(s => {
        const profile = profileMap.get(String(s.user_login || "").toLowerCase()) || "";
        const card = buildStreamTile(s, profile);
        const thumb = (s.thumbnail_url || "").replace("{width}", "320").replace("{height}", "180");
        card.classList.add("game-stream-card");
        card.style.setProperty("--stream-thumb", `url("${thumb}")`);
        grid.appendChild(card);
    });
    focusGrid("game-screen-grid");
}

// ============================================================
// Pantalla de resultados de búsqueda (en vivo + VODs recientes)
// ============================================================
async function runSearch(login) {
    if (window.clearFocusBackground) window.clearFocusBackground();
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById("results-screen").classList.add("active");
    currentScreen = "results";
    resultsContentSection = "vods";

    const resultsScreen = document.getElementById("results-screen");
    resultsScreen.style.setProperty("--channel-accent", "#18a8e8");
    // El perfil comienza con fondo neutro; solo una tarjeta enfocada
    // puede colocar su miniatura como fondo.
    resultsScreen.style.backgroundImage = "";
    resultsScreen.style.backgroundSize = "";
    resultsScreen.style.backgroundPosition = "";
    resultsScreen.style.backgroundAttachment = "";
    const profileBg = document.getElementById("focus-background");
    if (profileBg) {
        profileBg.style.backgroundImage = "";
        profileBg.style.backgroundColor = "";
        profileBg.classList.remove("visible");
    }
    document.getElementById("channel-name").textContent = login;
    document.getElementById("channel-substat").textContent = "";
    document.getElementById("channel-followers").textContent = "";
    document.getElementById("channel-description").textContent = "";
    document.getElementById("channel-follow-btn").classList.add("hidden");
    document.getElementById("channel-chat-btn").classList.add("hidden");
    closeProfileChat(); // el perfil que se buscaba antes pudo haber dejado el chat abierto
    document.getElementById("channel-avatar").src = "";
    document.getElementById("channel-banner").style.backgroundImage = "";
    document.getElementById("channel-live-badge").innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>Buscando…</span>';
    document.getElementById("channel-live-badge").classList.remove("is-live");
    document.getElementById("channel-watch-btn").classList.add("hidden");
    document.getElementById("results-error").classList.add("hidden");
    const grid = document.getElementById("results-grid");
    const clipsGrid = document.getElementById("clips-grid");
    grid.innerHTML = '<div class="tile-loading">Cargando…</div>';
    clipsGrid.innerHTML = '<div class="tile-loading">Cargando…</div>';

    const user = await fetchUserByLogin(login);
    if (!user) {
        document.getElementById("channel-live-badge").innerHTML = '<span>CANAL NO ENCONTRADO</span>';
        const err = document.getElementById("results-error");
        err.textContent = `No se encontró el canal "${login}".`;
        err.classList.remove("hidden");
        grid.innerHTML = "";
        clipsGrid.innerHTML = "";
        return;
    }

    const [liveStreams, videos, clips] = await Promise.all([
        helixGet(`streams?user_id=${user.id}`),
        helixGet(`videos?user_id=${user.id}&type=archive&first=12`),
        fetchClipsByBroadcaster(user.id, 12)
    ]);
    const live = (liveStreams.data || [])[0];
    const vods = videos.data || [];
    const clipList = clips || [];

    document.getElementById("channel-name").textContent = user.display_name || login;
    document.getElementById("channel-avatar").src = user.profile_image_url || "";
    const banner = user.offline_image_url || "";
    const channelBanner = document.getElementById("channel-banner");
    channelBanner.style.backgroundImage = banner ? `url("${banner}")` : "";
    document.getElementById("channel-description").textContent = user.description || "";
    document.getElementById("channel-substat").textContent = "";

    // Cantidad de seguidores + botón seguir/dejar de seguir: Twitch exige un
    // token de usuario real para esto (ni siquiera el total funciona ya con
    // el token de la app), así que solo se muestran con sesión iniciada.
    loadChannelFollowInfo(user);

    // Si existe portada, usar su color destacado; si no, obtenerlo de la foto de perfil.
    setChannelAccentFromImage(banner || user.profile_image_url || "");
    if (!banner) setChannelBannerFromImage(user.profile_image_url || "");

    const badge = document.getElementById("channel-live-badge");
    const watchBtn = document.getElementById("channel-watch-btn");
    const chatBtn = document.getElementById("channel-chat-btn");
    if (live) {
        badge.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>EN VIVO</span>';
        badge.classList.add("is-live");
        watchBtn.classList.remove("hidden");
        watchBtn.onclick = () => openChannel(login);
        chatBtn.classList.add("hidden");
        focusResultsAction("watch");
    } else {
        badge.innerHTML = '<span>OFFLINE</span>';
        badge.classList.remove("is-live");
        watchBtn.classList.add("hidden");
        // El canal está offline: ofrecemos chatear igual, en un panel a la
        // derecha del propio perfil (no hay reproductor que mostrar).
        chatBtn.classList.remove("hidden");
        chatBtn.textContent = "💬 Chatear";
        chatBtn.onclick = () => toggleProfileChat(user.login || login);
        focusResultsAction("chat");
    }

    document.getElementById("vods-title").textContent = vods.length ? "VODs recientes" : "";
    grid.innerHTML = "";
    if (vods.length) vods.forEach(v => grid.appendChild(buildVodTile(v)));
    else grid.innerHTML = '<div class="tile-loading">Este canal no tiene VODs recientes.</div>';

    document.getElementById("clips-title").textContent = clipList.length ? "Clips destacados" : "";
    clipsGrid.innerHTML = "";
    if (clipList.length) clipList.forEach(c => clipsGrid.appendChild(buildClipTile(c)));
    else clipsGrid.innerHTML = '<div class="tile-loading">Este canal no tiene clips destacados.</div>';

    gridFocusIndex = 0;
    if (resultsFocusZone === "watch" && !watchBtn.classList.contains("hidden")) {
        document.querySelectorAll("#results-grid .focused, #clips-grid .focused").forEach(t => t.classList.remove("focused"));
        focusResultsAction(resultsActionFocus);
    } else if (vods.length) {
        focusProfileSection("vods", 0);
    }
}

function setChannelBannerFromImage(url) {
    const root = document.getElementById("results-screen");
    const banner = document.getElementById("channel-banner");
    if (!url || !root || !banner) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        try {
            const c = document.createElement("canvas");
            const ctx = c.getContext("2d", {willReadFrequently:true});
            c.width = 24; c.height = 24;
            ctx.drawImage(img, 0, 0, c.width, c.height);
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            let r=0,g=0,b=0,n=0;
            for (let i=0;i<data.length;i+=4) {
                if (data[i+3] < 120) continue;
                r += data[i]; g += data[i+1]; b += data[i+2]; n++;
            }
            if (!n) return;
            r=Math.round(r/n); g=Math.round(g/n); b=Math.round(b/n);
            const max=Math.max(r,g,b), min=Math.min(r,g,b);
            if (max-min < 18) { r=Math.min(255,r+18); b=Math.min(255,b+30); }
            const accent=`rgb(${r}, ${g}, ${b})`;
            root.style.setProperty("--channel-accent", accent);
            banner.style.backgroundImage = `linear-gradient(180deg, rgba(${r},${g},${b},.88), rgba(15,15,18,.98))`;
            banner.style.backgroundColor = accent;
        } catch (_) {}
    };
    img.src = url;
}

function setChannelAccentFromImage(url) {
    const root = document.getElementById("results-screen");
    if (!url || !root) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        try {
            const c = document.createElement("canvas");
            const ctx = c.getContext("2d", {willReadFrequently:true});
            c.width = 24; c.height = 24;
            ctx.drawImage(img, 0, 0, c.width, c.height);
            const data = ctx.getImageData(0, 0, c.width, c.height).data;
            let r=0,g=0,b=0,n=0;
            for (let i=0;i<data.length;i+=4) {
                const a=data[i+3]; if (a < 120) continue;
                r += data[i]; g += data[i+1]; b += data[i+2]; n++;
            }
            if (n) {
                r=Math.round(r/n); g=Math.round(g/n); b=Math.round(b/n);
                const max = Math.max(r,g,b), min = Math.min(r,g,b);
                if (max-min < 18) { r=Math.min(255,r+24); b=Math.min(255,b+42); }
                const accent = `rgb(${r}, ${g}, ${b})`;
                root.style.setProperty("--channel-accent", accent);
                // No usar el color destacado como fondo general del perfil.
                // El color sigue disponible en --channel-accent para otros
                // elementos, pero el fondo solo cambia al enfocar una tarjeta.
                const bg = document.getElementById("focus-background");
                if (bg && !findFocusedCard()) {
                    bg.classList.remove("visible");
                    bg.style.backgroundImage = "";
                    bg.style.backgroundColor = "";
                }
            }
        } catch (_) {}
    };
    img.src = url;
}

// ============================================================
// Twitch API — token de app y llamadas Helix
// ============================================================
let tokenRequestInFlight = null;

async function getAppToken() {
    // Reutiliza el token mientras le quede al menos 1 minuto de vida.
    if (twitchAppToken && twitchTokenExpiresAt - Date.now() > 60000) return twitchAppToken;
    // Evita disparar varias peticiones de token en paralelo al arrancar.
    if (tokenRequestInFlight) return tokenRequestInFlight;

    tokenRequestInFlight = (async () => {
        try {
            const res = await fetch(TWITCH_TOKEN_ENDPOINT, { cache: "no-store" });
            const data = await res.json();
            if (!res.ok || !data.access_token) {
                console.error("Twitch token error:", data.message || res.status);
                return null;
            }
            twitchAppToken = data.access_token;
            TWITCH_CLIENT_ID = data.client_id || TWITCH_CLIENT_ID;
            twitchTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
            return twitchAppToken;
        } catch (e) {
            console.error(e);
            return null;
        } finally {
            tokenRequestInFlight = null;
        }
    })();

    return tokenRequestInFlight;
}

async function helixGet(path) {
    const token = await getAppToken();
    if (!token) return { data: [] };
    try {
        const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
            headers: { "Client-Id": TWITCH_CLIENT_ID, "Authorization": `Bearer ${token}` }
        });
        if (res.status === 401) {
            // Token caducado o revocado: descártalo y reintenta una vez.
            twitchAppToken = null;
            twitchTokenExpiresAt = 0;
            const fresh = await getAppToken();
            if (!fresh) return { data: [] };
            const retry = await fetch(`https://api.twitch.tv/helix/${path}`, {
                headers: { "Client-Id": TWITCH_CLIENT_ID, "Authorization": `Bearer ${fresh}` }
            });
            return await retry.json();
        }
        return await res.json();
    } catch (e) { console.error(e); return { data: [] }; }
}

// ============================================================
// Login con Twitch — Authorization Code (redirección) para PC/celular/
// navegador, y Device Code (QR) para TV. En ambos casos el usuario y
// contraseña se escriben SIEMPRE en la pantalla real de Twitch, nunca
// dentro de esta app.
// ============================================================
function loadStoredTwitchUser() {
    try {
        const raw = localStorage.getItem(TWITCH_AUTH_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return (parsed && parsed.access_token) ? parsed : null;
    } catch (e) { return null; }
}

function saveTwitchUser(user) {
    twitchUser = user;
    try { localStorage.setItem(TWITCH_AUTH_STORAGE_KEY, JSON.stringify(user)); } catch (e) {}
    buildNav();
    syncFollowedHomeSections();
    startFollowedAutoRefresh();
}

function clearTwitchUser() {
    twitchUser = null;
    try { localStorage.removeItem(TWITCH_AUTH_STORAGE_KEY); } catch (e) {}
    buildNav();
    syncFollowedHomeSections();
}

function randomOAuthState() {
    try {
        return Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
        return String(Date.now()) + Math.random().toString(16).slice(2);
    }
}

async function helixGetAsUser(path) {
    if (!twitchUser || !twitchUser.access_token) return { data: [] };
    // Asegura que TWITCH_CLIENT_ID ya esté disponible antes de pedir nada:
    // si se pide con el Client-Id vacío, Twitch devuelve 401 y eso se
    // confundía con un token vencido, cerrando la sesión sin motivo real
    // (pasaba sobre todo justo después de recargar la página).
    if (!TWITCH_CLIENT_ID) await getAppToken();
    if (!TWITCH_CLIENT_ID) return { data: [] }; // sin conexión con Twitch: no tocar la sesión guardada
    try {
        const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
            headers: { "Client-Id": TWITCH_CLIENT_ID, "Authorization": `Bearer ${twitchUser.access_token}` }
        });
        if (res.status === 401) {
            // Token vencido/revocado: cerramos sesión localmente.
            clearTwitchUser();
            return { data: [] };
        }
        return await res.json();
    } catch (e) { console.error(e); return { data: [] }; }
}

async function fetchFollowedLiveStreams() {
    if (!twitchUser || !twitchUser.user_id) return [];
    const data = await helixGetAsUser(`streams/followed?user_id=${encodeURIComponent(twitchUser.user_id)}&first=20`);
    return data.data || [];
}

// Todos los canales seguidos (en vivo o no) — para la sección "Canales
// seguidos" de la barra lateral. Requiere el scope user:read:follows.
async function fetchFollowedChannels() {
    if (!twitchUser || !twitchUser.user_id) return [];
    const data = await helixGetAsUser(`channels/followed?user_id=${encodeURIComponent(twitchUser.user_id)}&first=100`);
    return data.data || [];
}

// "channels/followed" y "streams/followed" no traen foto de perfil, así
// que se completa con una consulta aparte a "users" (hasta 100 por llamada).
async function fetchUserAvatarsByLogin(logins) {
    const map = new Map();
    const unique = [...new Set(logins.filter(Boolean))].slice(0, 100);
    if (!unique.length) return map;
    const query = unique.map(l => `login=${encodeURIComponent(l)}`).join("&");
    const data = await helixGetAsUser(`users?${query}`);
    (data.data || []).forEach(u => map.set(u.login, u.profile_image_url));
    return map;
}

// Portada de un canal desconectado para la tarjeta grande de "Canales
// seguidos": Twitch permite configurar una imagen de "fuera de línea"
// (offline_image_url) pensada justo para este uso; si el canal no tiene una
// propia, se usa la foto de perfil como respaldo para no dejar la tarjeta
// vacía.
async function fetchUserCoverImagesByLogin(logins) {
    const map = new Map();
    const unique = [...new Set(logins.filter(Boolean))].slice(0, 100);
    if (!unique.length) return map;
    const query = unique.map(l => `login=${encodeURIComponent(l)}`).join("&");
    const data = await helixGetAsUser(`users?${query}`);
    (data.data || []).forEach(u => map.set(u.login, u.offline_image_url || u.profile_image_url || ""));
    return map;
}

// ============================================================
// Perfil de canal: cantidad de seguidores + botón seguir/dejar de seguir
// ============================================================
// Twitch quitó de su API la posibilidad de seguir/dejar de seguir canales
// desde apps de terceros (los endpoints se dieron de baja en 2021), así que
// el botón no puede cambiar la relación real dentro de la app: solo puede
// avisar y abrir el canal en Twitch para que el usuario lo confirme ahí. Por
// el mismo motivo, "Get Channel Followers" ahora exige un token de usuario
// real (ni el token de la app alcanza para el total), así que la cantidad de
// seguidores y el botón solo aparecen con sesión de Twitch iniciada.
async function loadChannelFollowInfo(user) {
    const followersEl = document.getElementById("channel-followers");
    const btn = document.getElementById("channel-follow-btn");
    if (!twitchUser) { followersEl.textContent = ""; btn.classList.add("hidden"); return; }

    const [followerData, followingData] = await Promise.all([
        helixGetAsUser(`channels/followers?broadcaster_id=${encodeURIComponent(user.id)}`),
        helixGetAsUser(`channels/followed?user_id=${encodeURIComponent(twitchUser.user_id)}&broadcaster_id=${encodeURIComponent(user.id)}`)
    ]);
    // La sesión pudo cerrarse, o el usuario pudo navegar a otro canal, mientras esperábamos.
    if (!twitchUser || document.getElementById("channel-name").textContent !== (user.display_name || user.login)) return;

    if (typeof followerData.total === "number") {
        followersEl.textContent = `${followerData.total.toLocaleString("es")} seguidores`;
    }

    const isFollowing = (followingData.data || []).length > 0;
    const displayName = user.display_name || user.login;
    btn.classList.remove("hidden");
    btn.classList.toggle("is-following", isFollowing);
    btn.textContent = isFollowing ? "Siguiendo ✓" : "+ Seguir";
    btn.onclick = () => handleFollowButtonClick(user.login, displayName, isFollowing);
}

function handleFollowButtonClick(login, displayName, isFollowing) {
    const warning = isFollowing
        ? `Twitch ya no permite dejar de seguir canales desde apps de terceros: hay que confirmarlo en Twitch. ¿Abrir el canal de ${displayName} en Twitch para dejar de seguirlo?`
        : `Twitch ya no permite seguir canales desde apps de terceros: hay que confirmarlo en Twitch. ¿Abrir el canal de ${displayName} en Twitch para seguirlo?`;
    if (!confirm(warning)) return;
    window.open(`https://www.twitch.tv/${encodeURIComponent(login)}`, "_blank", "noopener");
}

// ============================================================
// Barra lateral: sección "En vivo" + "Canales seguidos"
// ============================================================
function followedItemHtml(item, flatIndex) {
    const avatarSrc = item.avatar ? escapeHtml(item.avatar) : "";
    return `<li data-flat-index="${flatIndex}" data-login="${escapeHtml(item.login)}" tabindex="0">
        <span class="followed-avatar-wrap">
            <img class="followed-avatar" src="${avatarSrc}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            ${item.live ? '<span class="followed-live-dot" aria-hidden="true"></span>' : ""}
        </span>
        <span class="followed-name">${escapeHtml(item.name)}</span>
        ${item.live ? `<span class="followed-meta">${item.viewers.toLocaleString("es")}</span>` : ""}
    </li>`;
}

function wireFollowedListEvents() {
    document.querySelectorAll("#followed-live-list li[data-login], #followed-offline-list li[data-login]").forEach(li => {
        li.addEventListener("click", () => openChannel(li.dataset.login));
        li.addEventListener("mouseenter", () => setFocus("followed", Number(li.dataset.flatIndex)));
    });
}

async function renderFollowedSidebar() {
    const section = document.getElementById("followed-section");
    if (!section) return;

    if (!twitchUser) {
        section.hidden = true;
        followedSidebarItems = [];
        if (followedRefreshTimer) { clearInterval(followedRefreshTimer); followedRefreshTimer = null; }
        if (focusZone === "followed") setFocus("nav", NAV_ITEMS.length - 1);
        return;
    }
    section.hidden = false;

    const [liveStreams, followedChannels] = await Promise.all([
        fetchFollowedLiveStreams(),
        fetchFollowedChannels()
    ]);
    if (!twitchUser) return; // la sesión pudo cerrarse mientras se esperaban las respuestas

    const liveIds = new Set(liveStreams.map(s => s.user_id));
    const liveItemsRaw = liveStreams
        .slice()
        .sort((a, b) => Number(b.viewer_count || 0) - Number(a.viewer_count || 0));
    const offlineItemsRaw = followedChannels.filter(c => !liveIds.has(c.broadcaster_id));

    const avatarMap = await fetchUserAvatarsByLogin([
        ...liveItemsRaw.map(s => s.user_login),
        ...offlineItemsRaw.map(c => c.broadcaster_login)
    ]);

    const liveItems = liveItemsRaw.map(s => ({
        login: s.user_login, name: s.user_name || s.user_login,
        avatar: avatarMap.get(s.user_login) || null,
        live: true, viewers: Number(s.viewer_count || 0)
    }));
    const offlineItems = offlineItemsRaw.map(c => ({
        login: c.broadcaster_login, name: c.broadcaster_name || c.broadcaster_login,
        avatar: avatarMap.get(c.broadcaster_login) || null,
        live: false, viewers: 0
    }));

    followedSidebarItems = [...liveItems, ...offlineItems];

    const liveList = document.getElementById("followed-live-list");
    const offlineList = document.getElementById("followed-offline-list");
    const liveHeading = document.getElementById("followed-live-heading");
    const offlineHeading = document.getElementById("followed-offline-heading");
    if (!liveList || !offlineList || !liveHeading || !offlineHeading) return;

    liveHeading.style.display = liveItems.length ? "" : "none";
    liveList.innerHTML = liveItems.map((it, i) => followedItemHtml(it, i)).join("");

    if (!followedChannels.length) {
        offlineHeading.style.display = "none";
        offlineList.innerHTML = '<li class="followed-empty-hint">Todavía no seguís ningún canal.</li>';
    } else {
        offlineHeading.style.display = offlineItems.length ? "" : "none";
        offlineList.innerHTML = offlineItems.map((it, i) => followedItemHtml(it, liveItems.length + i)).join("");
    }

    wireFollowedListEvents();
}

function startFollowedAutoRefresh() {
    if (followedRefreshTimer) clearInterval(followedRefreshTimer);
    followedRefreshTimer = setInterval(() => {
        // v64: no refrescar si no hay usuario, la app está en segundo plano
        // (document.hidden) o el usuario está viendo el reproductor: evita
        // llamadas a la API y trabajo de red/DOM innecesario en TV.
        if (!twitchUser || document.hidden || currentScreen === "player") return;
        loadSeguidosLive();
        loadSeguidosChannels();
    }, 60000);
}

// ---- Redirección (PC / celular / navegador) ----
async function startRedirectLogin() {
    await getAppToken(); // asegura que TWITCH_CLIENT_ID ya esté disponible
    if (!TWITCH_CLIENT_ID) {
        renderAccountOverlay("qr-error", "No se pudo preparar el login (sin conexión con Twitch).");
        return;
    }
    const state = randomOAuthState();
    // sessionStorage (no cookie): sobrevive la ida y vuelta a id.twitch.tv sin
    // depender de las reglas de SameSite en redirecciones cross-site.
    try { sessionStorage.setItem("tw_oauth_state", state); } catch (e) {}
    // OJO: esta URL debe coincidir EXACTO con la registrada como
    // "OAuth Redirect URL" en Twitch Developer Console para esta app,
    // sea cual sea el dominio desde el que se sirve el HTML.
    const redirectUri = `${API_BASE}/api/twitch-auth-callback`;
    const params = new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: TWITCH_SCOPES,
        state
    });
    location.href = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

// ---- QR / Device Code Flow (TV) ----
function stopDeviceLogin() {
    if (deviceFlowState && deviceFlowState.timer) clearTimeout(deviceFlowState.timer);
    deviceFlowState = null;
}

async function startDeviceLogin() {
    stopDeviceLogin();
    renderAccountOverlay("qr-loading");
    await getAppToken();
    try {
        const res = await fetch(`${API_BASE}/api/twitch-device-start?scopes=${encodeURIComponent(TWITCH_SCOPES)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data.device_code) {
            renderAccountOverlay("qr-error", data.message || "No se pudo iniciar el login por QR.");
            return;
        }
        deviceFlowState = {
            device_code: data.device_code,
            interval: Math.max(2, Number(data.interval) || 5) * 1000,
            expiresAt: Date.now() + (Number(data.expires_in) || 1800) * 1000,
            timer: null
        };
        renderAccountOverlay("qr", { verification_uri: data.verification_uri, user_code: data.user_code });
        deviceFlowState.timer = setTimeout(pollDeviceLogin, deviceFlowState.interval);
    } catch (e) {
        renderAccountOverlay("qr-error", "No se pudo conectar con Twitch.");
    }
}

async function pollDeviceLogin() {
    if (!deviceFlowState) return;
    if (Date.now() > deviceFlowState.expiresAt) {
        deviceFlowState = null;
        renderAccountOverlay("qr-error", "El código QR expiró. Probá de nuevo.");
        return;
    }
    const current = deviceFlowState;
    try {
        const res = await fetch(`${API_BASE}/api/twitch-device-poll?device_code=${encodeURIComponent(current.device_code)}`, { cache: "no-store" });
        const data = await res.json();

        if (res.ok && data.access_token) {
            deviceFlowState = null;
            saveTwitchUser({
                access_token: data.access_token,
                refresh_token: data.refresh_token || null,
                expires_at: Date.now() + (Number(data.expires_in) || 14400) * 1000,
                user_id: data.user_id || null,
                login: data.login || null,
                display_name: data.display_name || data.login || null,
                profile_image_url: data.profile_image_url || null
            });
            renderAccountOverlay("logged-in");
            return;
        }

        const msg = String(data.message || "");
        if (msg === "authorization_pending" || msg === "") {
            current.timer = setTimeout(pollDeviceLogin, current.interval);
            return;
        }
        // "authorization_declined", "expired_token", "invalid device code", etc.
        deviceFlowState = null;
        renderAccountOverlay("qr-error", "No se pudo completar el login (" + msg + ").");
    } catch (e) {
        current.timer = setTimeout(pollDeviceLogin, current.interval);
    }
}

function logoutTwitch() {
    stopDeviceLogin();
    clearTwitchUser();
    renderAccountOverlay("logged-out");
}

// ---- Overlay de cuenta: UI y navegación ----
function openAccountOverlay() {
    const overlay = document.getElementById("account-overlay");
    overlay?.classList.add("visible");
    overlay?.setAttribute("aria-hidden", "false");
    renderAccountOverlay(twitchUser ? "logged-in" : "logged-out");
}

function closeAccountOverlay() {
    stopDeviceLogin();
    const overlay = document.getElementById("account-overlay");
    overlay?.classList.remove("visible");
    overlay?.setAttribute("aria-hidden", "true");
    const accountIndex = NAV_ITEMS.findIndex(item => item.id === "account");
    if (currentScreen === "main" && accountIndex >= 0) {
        navIndex = accountIndex;
        setFocus("nav", accountIndex);
    }
    window.focus();
}

function wireAccountButtons() {
    document.querySelectorAll("#account-box [data-action]").forEach(btn => {
        btn.tabIndex = 0;
        btn.addEventListener("click", () => handleAccountAction(btn.dataset.action, btn));
    });
}

function focusFirstAccountButton() {
    const first = document.querySelector("#account-box [data-nav-btn]");
    if (!first) return;
    document.querySelectorAll("#account-box [data-nav-btn]").forEach(b => b.classList.remove("focused"));
    first.classList.add("focused");
    setTimeout(() => first.focus({ preventScroll: true }), 20);
}

function handleAccountAction(action, btn) {
    if (action === "redirect") return startRedirectLogin();
    if (action === "qr") return startDeviceLogin();
    if (action === "logout") return logoutTwitch();
    if (action === "close") return closeAccountOverlay();
    if (action === "reload-app") return window.location.reload();
    if (action === "open-channel") {
        const login = btn && btn.dataset ? btn.dataset.login : "";
        closeAccountOverlay();
        if (login) openChannel(login);
        return;
    }
    if (action === "view-profile") {
        const login = (btn && btn.dataset ? btn.dataset.login : "") || (twitchUser && twitchUser.login) || "";
        if (currentScreen === "main") rememberMainFocusForReturn();
        closeAccountOverlay();
        if (login) runSearch(login);
        return;
    }
}

function renderAccountOverlay(state, extra) {
    const resolvedState = state || (twitchUser ? "logged-in" : "logged-out");
    if (resolvedState === "logged-in") { renderLoggedInAccount(); return; }

    const box = document.getElementById("account-box");
    if (!box) return;

    if (resolvedState === "qr-loading") {
        box.innerHTML = `<h2>Preparando código QR…</h2><p class="account-hint">Un momento.</p>`;
    } else if (resolvedState === "qr") {
        const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(extra.verification_uri);
        box.innerHTML = `
            <h2>Iniciá sesión desde tu celular</h2>
            <img class="account-qr" src="${qrUrl}" alt="Código QR para iniciar sesión en Twitch">
            <div class="account-code">${escapeHtml(extra.user_code || "")}</div>
            <p class="account-hint">Escaneá el código con la cámara, o entrá a twitch.tv/activate en cualquier dispositivo y escribí el código. Esta pantalla se actualiza sola.</p>
            <button class="account-btn" data-nav-btn data-action="close">Cancelar</button>`;
    } else if (resolvedState === "qr-error") {
        box.innerHTML = `
            <h2>No se pudo iniciar sesión</h2>
            <p class="account-error">${escapeHtml(extra || "")}</p>
            <button class="account-btn primary" data-nav-btn data-action="qr">Reintentar con QR</button>
            <button class="account-btn" data-nav-btn data-action="redirect">Iniciar sesión (redirigir)</button>
            <button class="account-btn" data-nav-btn data-action="close">Cerrar</button>`;
    } else {
        box.innerHTML = `
            <h2>Iniciar sesión con Twitch</h2>
            <p class="account-hint">Necesario para chatear con tu nombre y ver tus canales seguidos que están en vivo. Siempre inicias sesión en la pantalla real de Twitch, nunca acá.</p>
            <button class="account-btn primary" data-nav-btn data-action="redirect">Iniciar sesión</button>
            <button class="account-btn" data-nav-btn data-action="qr">Iniciar sesión con QR (TV)</button>
            <button class="account-btn" data-nav-btn data-action="reload-app">🔄 Recargar app</button>
            <button class="account-btn" data-nav-btn data-action="close">Cancelar</button>`;
    }
    wireAccountButtons();
    focusFirstAccountButton();
}

async function renderLoggedInAccount() {
    const box = document.getElementById("account-box");
    if (!box) return;
    const u = twitchUser;
    if (!u) { renderAccountOverlay("logged-out"); return; }

    box.innerHTML = `
        ${u.profile_image_url ? `<img class="account-avatar" src="${u.profile_image_url}" alt="">` : ""}
        <div class="account-name">${escapeHtml(u.display_name || u.login || "")}</div>
        <p class="account-hint">Sesión iniciada. Ya podés chatear con tu nombre.</p>
        <button class="account-btn" data-nav-btn data-action="view-profile" data-login="${escapeHtml(u.login || "")}">Ver perfil</button>
        <button class="account-btn" data-nav-btn data-action="reload-app">🔄 Recargar app</button>
        <button class="account-btn" data-nav-btn data-action="logout">Cerrar sesión</button>
        <button class="account-btn" data-nav-btn data-action="close">Cerrar</button>`;
    wireAccountButtons();
    focusFirstAccountButton();
}

function handleAccountOverlayKeys(keyCode, e) {
    if (keyCode === 27 || keyCode === 461 || keyCode === 10009) {
        e.preventDefault();
        closeAccountOverlay();
        return;
    }
    const btns = Array.from(document.querySelectorAll("#account-box [data-nav-btn]"));
    if (!btns.length) return;
    let idx = btns.indexOf(document.activeElement);
    if (idx === -1) idx = btns.findIndex(b => b.classList.contains("focused"));
    if (idx === -1) idx = 0;

    if (keyCode === 38 || keyCode === 40) {
        e.preventDefault();
        const delta = keyCode === 38 ? -1 : 1;
        const next = (idx + delta + btns.length) % btns.length;
        btns.forEach(b => b.classList.remove("focused"));
        btns[next].classList.add("focused");
        btns[next].focus({ preventScroll: true });
        return;
    }
    if (keyCode === 13) {
        e.preventDefault();
        btns[idx]?.click();
    }
}

async function fetchTopStreams(n, language) {
    const langParam = language ? `&language=${encodeURIComponent(language)}` : "";
    const data = await helixGet(`streams?first=${n}${langParam}`);
    return data.data || [];
}

async function fetchTopGames(n) {
    const data = await helixGet(`games/top?first=${n}`);
    return data.data || [];
}

async function fetchStreamsByGame(gameId, n) {
    const data = await helixGet(`streams?game_id=${gameId}&first=${n}`);
    return data.data || [];
}

// Datos en vivo (título, juego actual, etc.) de un canal específico —
// usado en el reproductor para mostrar el título del stream y el juego actual.
async function fetchStreamsByLogin(channelLogin) {
    const data = await helixGet(`streams?user_login=${encodeURIComponent(channelLogin)}`);
    return data.data || [];
}

async function fetchUserByLogin(login) {
    const data = await helixGet(`users?login=${encodeURIComponent(login)}`);
    return (data.data || [])[0] || null;
}

async function fetchClipsByBroadcaster(broadcasterId, n=12) {
    if (!broadcasterId) return [];
    const data = await helixGet(`clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=${n}`);
    return data.data || [];
}

// ============================================================
// Sugerencias de canales mientras se escribe en el buscador de inicio
// (home-search-input). Usa search/channels de Helix con el token de
// app (no requiere sesión de Twitch iniciada).
// ============================================================
let homeSearchSuggestions = [];   // resultados actuales [{broadcaster_login, display_name, thumbnail_url, is_live}, ...]
let homeSearchSuggestionIndex = -1; // -1 = ninguna resaltada (foco sigue en el input)
let homeSearchSuggestionsSeq = 0;   // evita que una respuesta vieja pise una más nueva
let homeSearchDebounceTimer = null;

async function fetchChannelSuggestions(query) {
    const data = await helixGet(`search/channels?query=${encodeURIComponent(query)}&first=8`);
    return data.data || [];
}

function renderHomeSearchSuggestions() {
    const box = document.getElementById("home-search-suggestions");
    const input = document.getElementById("home-search-input");
    if (!box) return;

    if (!homeSearchSuggestions.length) {
        box.innerHTML = "";
        box.classList.remove("visible");
        input?.setAttribute("aria-expanded", "false");
        input?.removeAttribute("aria-activedescendant");
        return;
    }

    box.innerHTML = homeSearchSuggestions.map((ch, i) => `
        <li class="home-search-suggestion-item${i === homeSearchSuggestionIndex ? " active" : ""}"
            data-index="${i}" role="option" id="home-search-suggestion-${i}"
            aria-selected="${i === homeSearchSuggestionIndex ? "true" : "false"}">
            <img class="home-search-suggestion-avatar" src="${ch.thumbnail_url || ""}" alt="" loading="lazy">
            <span class="home-search-suggestion-name">${escapeHtml(ch.display_name || ch.broadcaster_login)}</span>
            ${ch.is_live ? '<span class="home-search-suggestion-live">EN VIVO</span>' : ""}
        </li>
    `).join("");
    box.classList.add("visible");
    input?.setAttribute("aria-expanded", "true");
    if (homeSearchSuggestionIndex >= 0) {
        input?.setAttribute("aria-activedescendant", `home-search-suggestion-${homeSearchSuggestionIndex}`);
        box.querySelector(".active")?.scrollIntoView({ block: "nearest" });
    } else {
        input?.removeAttribute("aria-activedescendant");
    }
}

function clearHomeSearchSuggestions() {
    homeSearchSuggestions = [];
    homeSearchSuggestionIndex = -1;
    homeSearchSuggestionsSeq++; // invalida cualquier respuesta pendiente
    renderHomeSearchSuggestions();
}

function moveHomeSearchSuggestion(delta) {
    if (!homeSearchSuggestions.length) return;
    const max = homeSearchSuggestions.length - 1;
    let next = homeSearchSuggestionIndex + delta;
    if (next < -1) next = max;       // desde el input hacia arriba: va al final de la lista
    else if (next > max) next = -1;  // desde el final hacia abajo: vuelve al input
    homeSearchSuggestionIndex = next;
    renderHomeSearchSuggestions();
}

function chooseHomeSearchSuggestion(index) {
    const ch = homeSearchSuggestions[index];
    if (!ch) return;
    clearHomeSearchSuggestions();
    closeHomeSearch();
    runSearch(ch.broadcaster_login);
}

function scheduleHomeSearchSuggestions(rawValue) {
    if (homeSearchDebounceTimer) clearTimeout(homeSearchDebounceTimer);
    const value = rawValue.trim();
    if (!value) { clearHomeSearchSuggestions(); return; }
    homeSearchDebounceTimer = setTimeout(async () => {
        const seq = ++homeSearchSuggestionsSeq;
        const results = await fetchChannelSuggestions(value);
        if (seq !== homeSearchSuggestionsSeq) return; // llegó tarde, ya no aplica
        homeSearchSuggestions = results;
        homeSearchSuggestionIndex = -1;
        renderHomeSearchSuggestions();
    }, 250);
}

// ============================================================
// Búsqueda manual — input real (PC) / teclado nativo de Tizen (TV)
// ============================================================
function setupSearchInput() {
    const input = document.getElementById("search-input");
    const submitBtn = document.getElementById("search-submit-btn");
    const homeInput = document.getElementById("home-search-input");
    const homeSubmit = document.getElementById("home-search-submit");
    const homeClose = document.getElementById("home-search-close");

    const submit = (sourceInput) => {
        const value = sourceInput.value.trim().toLowerCase();
        if (value) {
            clearHomeSearchSuggestions();
            closeHomeSearch();
            runSearch(value);
        }
    };

    input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); submit(input); }
    });
    input?.addEventListener("change", () => submit(input));
    submitBtn?.addEventListener("click", () => submit(input));

    homeInput?.addEventListener("input", () => scheduleHomeSearchSuggestions(homeInput.value));

    homeInput?.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
            if (homeSearchSuggestions.length) { e.preventDefault(); moveHomeSearchSuggestion(1); }
        } else if (e.key === "ArrowUp") {
            if (homeSearchSuggestions.length) { e.preventDefault(); moveHomeSearchSuggestion(-1); }
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (homeSearchSuggestionIndex >= 0) chooseHomeSearchSuggestion(homeSearchSuggestionIndex);
            else submit(homeInput);
        }
        // Nota: "Escape"/atrás ya cierra todo el buscador vía los listeners
        // de captura en document (ver scripts "search-back-*"), que se
        // ejecutan antes que este y siempre limpian las sugerencias
        // (clearHomeSearchSuggestions se llama desde closeHomeSearch).
    });

    document.getElementById("home-search-suggestions")?.addEventListener("click", (e) => {
        const item = e.target.closest("[data-index]");
        if (item) chooseHomeSearchSuggestion(Number(item.dataset.index));
    });
    document.getElementById("home-search-suggestions")?.addEventListener("mousemove", (e) => {
        const item = e.target.closest("[data-index]");
        if (item) {
            const i = Number(item.dataset.index);
            if (i !== homeSearchSuggestionIndex) { homeSearchSuggestionIndex = i; renderHomeSearchSuggestions(); }
        }
    });

    homeSubmit?.addEventListener("click", () => submit(homeInput));
    homeClose?.addEventListener("click", closeHomeSearch);
    [homeSubmit, homeClose].forEach(btn => {
        btn?.addEventListener("focus", () => btn.classList.add("focused"));
        btn?.addEventListener("blur", () => btn.classList.remove("focused"));
    });
}

function openSearch() {
    document.getElementById("main-screen")?.classList.add("search-dim-content");
    // El buscador vive ahora dentro de la pantalla de inicio.
    if (currentScreen !== "main") {
        document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
        document.getElementById("main-screen").classList.add("active");
        currentScreen = "main";
    }
    const overlay = document.getElementById("home-search-overlay");
    const input = document.getElementById("home-search-input");
    document.getElementById("main-screen")?.classList.add("home-search-open");
    overlay?.classList.add("visible");
    overlay?.setAttribute("aria-hidden", "false");
    clearHomeSearchSuggestions();
    if (input) { input.value = ""; setTimeout(() => input.focus({ preventScroll: true }), 30); }
}

function closeHomeSearch() {
    const main = document.getElementById("main-screen");
    const overlay = document.getElementById("home-search-overlay");

    /* Limpiar TODOS los estados usados por las distintas versiones del buscador. */
    main?.classList.remove(
        "search-dim-content",
        "home-search-open",
        "search-open",
        "search-active"
    );

    overlay?.classList.remove("visible", "active", "open");
    overlay?.setAttribute("aria-hidden", "true");
    overlay?.removeAttribute("style");
    clearHomeSearchSuggestions();
    const searchIndex = NAV_ITEMS.findIndex(item => item.id === "search");
    if (currentScreen === "main" && searchIndex >= 0) {
        navIndex = searchIndex;
        setFocus("nav", searchIndex);
    }
}


// ============================================================
// Reproductor — usa la Twitch Embed JS API (Twitch.Player), no un
// iframe simple. Esto permite controlar play/pause, calidad y
// (para VODs) el avance/retroceso desde el control remoto.
// ============================================================
function stopAutoplayRetry() {
    if (autoplayRetryInterval) clearInterval(autoplayRetryInterval);
    autoplayRetryInterval = null;
}

// Destruye por completo el Twitch.Player (y su iframe). Se usa solo al
// salir de la pantalla del reproductor (Inicio/Atrás) o si algo salió mal
// al crearlo — NO se llama en cada cambio de canal/VOD (ver createPlayer).
function destroyPlayer() {
    playerPlaybackStarted = false;
    const target = document.getElementById("twitch-player-target");
    if (target) target.innerHTML = "";
    twitchPlayer = null;
    playerListenersBound = false;
    availableQualities = [];
    qualityIndex = 0;
    chapterList = [];
    hideQualityPanel();
    updateQualityCtrlLabel();
    stopProgressLoop();
    stopAutoplayRetry();
    clearControlsAutoHide();

    disconnectChat();
}

// Evita que el <iframe> del Twitch.Player pueda robar el foco del control
// remoto. Antes esto se corregía recién DESPUÉS del evento PLAYING (con un
// setTimeout), dejando una ventana en la que, si el usuario presionaba una
// tecla mientras el iframe tenía el foco, esa tecla no llegaba nunca a
// handleKeydown (un iframe de otro origen no deja burbujear su keydown al
// documento padre) sino al reproductor interno de Twitch, que tiene sus
// propios atajos de teclado (por ej. togglear play/pause) — eso se sentía
// como "se pausa al mostrar los controles". Ahora se ataca en el origen:
// el iframe queda con tabindex="-1" (no es alcanzable por Tab/foco
// programático normal) y, por las dudas algo lo enfoque igual, un listener
// de "focus" lo devuelve al instante a los controles de OsmTwich.
let iframeFocusGuardObserver = null;
function guardPlayerIframeFocus() {
    const container = document.getElementById("twitch-player-target");
    if (!container) return;
    const applyGuard = (iframe) => {
        if (!iframe || iframe.dataset.focusGuarded === "1") return;
        iframe.dataset.focusGuarded = "1";
        iframe.setAttribute("tabindex", "-1");
        iframe.addEventListener("focus", () => {
            if (currentScreen !== "player") return;
            const playBtn = document.getElementById("ctrl-play");
            try { iframe.blur(); } catch (_) {}
            if (playBtn) {
                try { playBtn.focus({ preventScroll: true }); } catch (_) { playBtn.focus(); }
            }
        });
    };
    const existing = container.querySelector("iframe");
    if (existing) applyGuard(existing);
    if (iframeFocusGuardObserver) iframeFocusGuardObserver.disconnect();
    iframeFocusGuardObserver = new MutationObserver(() => {
        const iframe = container.querySelector("iframe");
        if (iframe) applyGuard(iframe);
    });
    iframeFocusGuardObserver.observe(container, { childList: true });
}

let twitchSdkPromise = null;

function ensureTwitchSDK() {
    if (window.Twitch && typeof window.Twitch.Player === "function") {
        return Promise.resolve();
    }
    if (twitchSdkPromise) return twitchSdkPromise;

    twitchSdkPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src*="embed.twitch.tv/embed/v1.js"]');
        if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("No se pudo cargar Twitch Embed")), { once: true });
            const timer = setInterval(() => {
                if (window.Twitch && typeof window.Twitch.Player === "function") {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
            setTimeout(() => {
                clearInterval(timer);
                if (!(window.Twitch && typeof window.Twitch.Player === "function")) {
                    reject(new Error("Twitch Embed no está disponible"));
                }
            }, 10000);
            return;
        }

        const script = document.createElement("script");
        script.src = "https://embed.twitch.tv/embed/v1.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar Twitch Embed"));
        document.head.appendChild(script);
    });

    return twitchSdkPromise;
}

// Se registran una sola vez por Twitch.Player real (no en cada cambio de
// canal/VOD, ver más abajo por qué).
let playerListenersBound = false;
let playerAutoplayAttempts = 0;
let playerAutoplayStarted = false;
let playerUnmuteAttempted = false;

function refreshQualities() {
    if (!twitchPlayer) return;
    try {
        availableQualities = twitchPlayer.getQualities() || [];
        const current = twitchPlayer.getQuality();
        const idx = availableQualities.findIndex(q => q.group === current);
        if (idx !== -1) qualityIndex = idx;
    } catch (err) { /* la lista de calidades a veces tarda en poblarse */ }
    updateQualityCtrlLabel();
}

function requestAutoplay(forceMuted) {
    try {
        if (!twitchPlayer || !twitchPlayer.play) return;
        if (forceMuted) {
            twitchPlayer.setMuted(true);
            isMuted = true;
            syncMuteIcon();
        }
        const result = twitchPlayer.play();
        if (result && typeof result.catch === "function") {
            result.catch(() => {
                // El navegador bloqueó la reproducción con sonido: forzamos
                // silencio para que al menos arranque el video.
                if (!forceMuted) requestAutoplay(true);
            });
        }
    } catch (err) {}
}

// Se llama cada vez que se abre o se cambia de contenido (stream/VOD/clip),
// tanto si el Twitch.Player es nuevo como si se reutilizó uno existente.
// Autoplay: se arranca siempre silenciado para garantizar que el video se
// vea al instante (igual que twitch.tv), y una vez que la reproducción ya
// está en marcha se intenta activar el sonido si hubo un gesto real del
// usuario en la app (clic, toque o tecla) al abrir el canal.
function kickAutoplay() {
    stopAutoplayRetry();
    playerAutoplayAttempts = 0;
    playerAutoplayStarted = false;
    playerUnmuteAttempted = false;

    setTimeout(() => requestAutoplay(true), 150);
    // Segundo intento explícito tras 2 s, solicitado para verificar el
    // "autoclic" de reproducción. No cambia la pantalla ni el foco.
    setTimeout(() => {
        try {
            if (!twitchPlayer) return;
            const paused = typeof twitchPlayer.isPaused === "function" ? twitchPlayer.isPaused() : false;
            if (paused || !playerAutoplayStarted) requestAutoplay(true);
        } catch (err) {}
    }, 2000);
    autoplayRetryInterval = setInterval(() => {
        playerAutoplayAttempts++;
        requestAutoplay(true);
        if (playerAutoplayAttempts >= 12) stopAutoplayRetry();
    }, 700);
}

// Los listeners del ciclo de vida del reproductor (calidad, foco, mostrar
///ocultar controles, etc.) se registran una única vez por instancia real
// de Twitch.Player, no en cada apertura de canal/VOD — si se reutiliza el
// mismo player (ver createPlayer) esta función no hace nada la segunda vez.
function bindPlayerLifecycleListeners() {
    if (playerListenersBound || !twitchPlayer) return;
    playerListenersBound = true;

    // getQualities() suele venir vacío justo en READY — se reintenta en PLAYING también.
    twitchPlayer.addEventListener(Twitch.Player.READY, refreshQualities);
    twitchPlayer.addEventListener(Twitch.Player.READY, syncMuteIcon);
    twitchPlayer.addEventListener(Twitch.Player.READY, () => setTimeout(() => requestAutoplay(true), 100));
    twitchPlayer.addEventListener(Twitch.Player.PLAYING, () => {
        playerAutoplayStarted = true;
        playerPlaybackStarted = true;
        // El video ya está reproduciéndose en silencio: activar sonido en
        // este punto (a diferencia de arrancar sin sonido desde cero) sí
        // suele estar permitido, incluso en TV, cuando hubo un gesto real
        // del usuario al abrir el canal.
        if (hasUserActivation && !playerUnmuteAttempted) {
            playerUnmuteAttempted = true;
            try {
                twitchPlayer.setMuted(false);
                isMuted = false;
                syncMuteIcon();
            } catch (err) {}
        }
    });
    twitchPlayer.addEventListener(Twitch.Player.PLAYING, refreshQualities);
    twitchPlayer.addEventListener(Twitch.Player.PLAYING, startProgressLoop);
    twitchPlayer.addEventListener(Twitch.Player.PLAYING, () => { if (qualityPanelVisible) hideQualityPanel(); });
    twitchPlayer.addEventListener(Twitch.Player.PLAYING, stopAutoplayRetry);
    // Los controles arrancan ocultos al abrir el stream/VOD (ver
    // goToPlayerScreen); este listener solo se asegura de que, si el
    // usuario los había mostrado con el mando antes de cambiar de
    // contenido, se vuelvan a ocultar apenas arranca la reproducción para
    // no tapar el video. Al pausar, vuelven a mostrarse.
    twitchPlayer.addEventListener(Twitch.Player.PLAYING, hideControls);
    twitchPlayer.addEventListener(Twitch.Player.PLAYING, () => updatePlayPauseVisibility(true));
    twitchPlayer.addEventListener(Twitch.Player.PAUSE, showControls);
    twitchPlayer.addEventListener(Twitch.Player.PAUSE, () => updatePlayPauseVisibility(false));

    // El foco permanece en los controles de OsmTwich.
    // El iframe de Twitch es de otro origen y no debe recibir el foco del
    // mando: si lo recibe, las flechas dejan de ser controlables desde aquí.
    twitchPlayer.addEventListener(Twitch.Player.PLAYING, () => {
        setTimeout(() => {
            if (currentScreen !== "player") return;
            if (document.activeElement && document.activeElement.tagName === "IFRAME") {
                const playBtn = document.getElementById("ctrl-play");
                if (playBtn) { try { playBtn.focus({preventScroll:true}); } catch (_) { playBtn.focus(); } }
            }
        }, 0);
    });
}

async function createPlayer(options) {
    playerPlaybackStarted = false;
    availableQualities = [];
    qualityIndex = 0;
    chapterList = [];
    hideQualityPanel();
    stopProgressLoop();
    stopAutoplayRetry();

    try {
        await ensureTwitchSDK();
    } catch (err) {
        console.error("Twitch Embed:", err);
        destroyPlayer();
        const target = document.getElementById("twitch-player-target");
        if (target) {
            target.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#fff;background:#000;font-size:20px;padding:30px;text-align:center">No se pudo cargar el reproductor de Twitch.<br>Comprueba la conexión a Internet y vuelve a pulsar Actualizar.</div>';
        }
        return;
    }

    if (typeof Twitch === "undefined" || typeof Twitch.Player !== "function") return;

    // Twitch exige que "parent" coincida con el dominio real que aloja la app.
    // En una app Tizen/web normal hostname está disponible; en file:// se usa
    // localhost como fallback, aunque para producción debe servirse por HTTP/HTTPS.
    const parentHost = window.location.hostname || "localhost";

    // Reutilizar el mismo Twitch.Player (mismo iframe) en vez de destruirlo
    // y crear uno nuevo en cada apertura es la clave para que el autoplay
    // sea confiable en TV: un iframe recién creado arranca "desde cero" sin
    // ningún historial de interacción, y algunos navegadores de TV son más
    // estrictos con eso que con la regla estándar de "el mute siempre
    // permite autoplay". Un player que ya viene reproduciendo mantiene ese
    // contexto activado al cambiar de contenido.
    // Los clips no tienen un método documentado para cambiarlos en caliente
    // sobre un player existente, así que para ese caso puntual se sigue
    // recreando el iframe.
    const isClip = "clip" in options;
    let reused = false;
    if (twitchPlayer && !isClip) {
        try {
            if ("channel" in options) {
                twitchPlayer.setChannel(options.channel);
                reused = true;
            } else if ("video" in options) {
                twitchPlayer.setVideo(options.video, 0);
                reused = true;
            }
        } catch (err) {
            reused = false;
        }
    }

    if (!reused) {
        destroyPlayer();
        try {
            twitchPlayer = new Twitch.Player("twitch-player-target", Object.assign({
                width: "100%",
                height: "100%",
                parent: [parentHost],
                autoplay: true,
                // Siempre arranca silenciado. Muchos navegadores de TV solo permiten
                // autoplay programático (llamado desde un setTimeout/interval, no
                // dentro del gesto real del usuario) cuando el video está muteado;
                // si se intenta sin sonido primero, la reproducción puede quedar
                // bloqueada de forma silenciosa y sin ningún evento de error,
                // dejando el video detenido hasta que el usuario pulsa Play a mano.
                // Igual que hace el propio twitch.tv con sus previews, arrancamos
                // siempre en silencio para garantizar que el video se vea al
                // instante, y recién después intentamos activar el sonido.
                muted: true,
                controls: false
            }, options));
        } catch (err) {
            console.error("Twitch Player:", err);
            twitchPlayer = null;
            return;
        }
    }

    bindPlayerLifecycleListeners();
    guardPlayerIframeFocus();
    kickAutoplay();
}

// Al hacer click en el nombre del streamer (en la información inferior del reproductor), en vez de
// salir a twitch.tv en una pestaña externa, o de saltar directo al vivo, se
// abre el canal como si se hubiera buscado su nombre en el buscador: perfil
// del canal + VODs recientes (misma pantalla que runSearch/"results-screen").

// Al hacer click en el nombre del juego (junto al reproductor), se abre la
// pantalla dedicada a ese juego con sus streams en vivo (misma pantalla que
// al tocar un juego desde "Juegos más vistos" — openGameScreen).

// Actualiza el bloque de info sobre el reproductor: nombre del streamer,
// título del stream/VOD, el juego actual (clickeable, si se conoce) y,
// para streams en vivo, el número de espectadores junto al juego.
function setPlayerInfo(displayName, title, gameName, gameId, viewerCount, profileImageUrl) {
    document.getElementById("player-channel-name").textContent = displayName || "";
    document.getElementById("player-stream-title").textContent = title || "";
    const avatar = document.getElementById("player-profile-image");
    avatar.src = profileImageUrl || "";
    avatar.alt = displayName ? `Foto de perfil de ${displayName}` : "";
    const gameRow = document.getElementById("player-game-row");
    const gameEl = document.getElementById("player-game-name");
    const viewersEl = document.getElementById("player-game-viewers");
    playerInfoHasGame = !!gameId && !!gameName;
    document.getElementById("player-game-action").disabled = !playerInfoHasGame;
    currentPlayerGameId = gameId || null;
    currentPlayerGameName = gameName || null;
    if (gameName) {
        gameEl.textContent = gameName;
        viewersEl.textContent = (typeof viewerCount === "number")
            ? `${viewerCount.toLocaleString("es")} espectadores`
            : "";
        gameRow.classList.remove("hidden");
    } else {
        gameEl.textContent = "";
        viewersEl.textContent = "";
        gameRow.classList.add("hidden");
    }
}

async function rememberMainFocusForReturn() {
    playerReturnMainFocusZone = focusZone || "content";
    playerReturnMainRowId = contentRowId || "featured";
    playerReturnMainTileIndex = Number.isFinite(contentTileIndex) ? contentTileIndex : 0;
    playerReturnGridFocusIndex = Number.isFinite(gridFocusIndex) ? gridFocusIndex : 0;
}

function restoreHomeFocusAfterReturn() {
    // Restaurar foco físico y visual después de volver desde un stream/perfil.
    // Si veníamos navegando por las tarjetas, regresamos a la misma tarjeta.
    requestAnimationFrame(() => {
        if (playerReturnMainFocusZone === "content" && getRowTileCount(playerReturnMainRowId) > 0) {
            focusContentZone(playerReturnMainRowId, playerReturnMainTileIndex);
        } else {
            restoreMainFocus(Number.isFinite(navIndex) ? navIndex : 0);
        }
        setTimeout(() => {
            if (focusZone === "content") {
                const tiles = getRowTiles(playerReturnMainRowId);
                tiles[playerReturnMainTileIndex]?.focus({preventScroll:true});
            } else {
                const el = document.querySelector(`#nav-list li[data-index="${navIndex}"]`);
                el?.focus({preventScroll:true});
            }
        }, 50);
    });
}

async function openChannel(channelLogin) {
    if (!channelLogin) return;
    playerInfoReturn = false;
    playerReturnScreen = currentScreen;
    if (currentScreen === "main") rememberMainFocusForReturn();
    playerReturnGridFocusIndex = gridFocusIndex;
    playerReturnResultsFocusZone = resultsFocusZone;
    playbackType = "live";
    currentChannelLogin = channelLogin;
    currentVideoId = null;

    // La pantalla del reproductor debe quedar visible ANTES de crear el
    // Twitch.Player: si el contenedor todavía está oculto (display:none),
    // el navegador puede negarse a arrancar el vídeo aunque sea en
    // silencio, y el autoplay se queda a medias hasta un play manual.
    goToPlayerScreen();

    createPlayer({ channel: channelLogin });
    connectChat(channelLogin);
    loadChatCosmetics(channelLogin); // emotes de 7TV + badges reales de este canal
    // El chat se conecta en segundo plano (para que ya tenga mensajes
    // cargados), pero el panel queda oculto hasta que el usuario lo pida
    // con el botón de chat (ver goToPlayerScreen).
    // Mostramos el login mientras se consultan los datos en vivo del canal.
    setPlayerInfo(channelLogin, "", "", null, null, "");

    document.getElementById("ctrl-rewind").classList.add("disabled");
    document.getElementById("ctrl-forward").classList.add("disabled");
    document.getElementById("progress-track").classList.add("is-live");
    document.getElementById("progress-elapsed").innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>EN VIVO</span>';
    document.getElementById("progress-remaining").textContent = "";

    // Nombre del streamer + título del stream + juego actual, vía Helix.
    const streams = await fetchStreamsByLogin(channelLogin);
    const live = streams[0];
    // Si el usuario ya navegó a otro canal mientras esto cargaba, no pisamos su info.
    if (currentChannelLogin !== channelLogin) return;
    if (live) {
        const user = await fetchUserByLogin(channelLogin);
        if (currentChannelLogin !== channelLogin) return;
        setPlayerInfo(
            live.user_name || channelLogin,
            live.title || "",
            live.game_name || "",
            live.game_id || null,
            live.viewer_count,
            user?.profile_image_url || ""
        );
    } else {
        setPlayerInfo(channelLogin, "", "", null, null, "");
    }
}

async function openClip(clipId, channelLogin) {
    if (!clipId) return;
    playerInfoReturn = false;
    playerReturnScreen = currentScreen;
    if (currentScreen === "main") rememberMainFocusForReturn();
    playerReturnGridFocusIndex = gridFocusIndex;
    playerReturnResultsFocusZone = resultsFocusZone;
    playbackType = "live";
    currentChannelLogin = channelLogin || null;
    currentVideoId = null;
    // Ver comentario en openChannel: la pantalla debe estar visible antes
    // de instanciar el Twitch.Player para que el autoplay (silenciado)
    // funcione sin necesitar un play manual.
    goToPlayerScreen();
    createPlayer({ clip: clipId });
    disconnectChat();
    document.getElementById("chat-messages").innerHTML = "";
    setPlayerInfo(channelLogin || "", "", "", null, null, "");
    document.getElementById("ctrl-rewind").classList.add("disabled");
    document.getElementById("ctrl-forward").classList.add("disabled");
    document.getElementById("progress-track").classList.add("is-live");
    document.getElementById("progress-elapsed").innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>CLIP</span>';
    document.getElementById("progress-remaining").textContent = "";
}

async function openVod(videoId, channelLogin, title) {
    if (!videoId) return;
    playerInfoReturn = false;
    playerReturnScreen = currentScreen;
    if (currentScreen === "main") rememberMainFocusForReturn();
    playerReturnGridFocusIndex = gridFocusIndex;
    playerReturnResultsFocusZone = resultsFocusZone;
    playbackType = "vod";
    currentChannelLogin = channelLogin;
    currentVideoId = videoId;

    // Ver comentario en openChannel: la pantalla debe estar visible antes
    // de instanciar el Twitch.Player para que el autoplay (silenciado)
    // funcione sin necesitar un play manual.
    goToPlayerScreen();

    createPlayer({ video: videoId });
    // Twitch no tiene chat "en vivo" para un VOD, pero sí guarda cada
    // mensaje con el segundo del video en que se escribió — lo repetimos
    // sincronizado con el avance del reproductor (ver startVodChatReplay).
    startVodChatReplay(videoId, 0);
    loadChatCosmetics(channelLogin); // emotes de 7TV del canal (badges: ver nota en renderVodFragments)
    // La API de Helix para videos no incluye el juego asociado al VOD,
    // así que ese dato queda vacío aquí (se oculta si no hay valor).
    setPlayerInfo(channelLogin, title || "", "", null, null, "");

    document.getElementById("ctrl-rewind").classList.remove("disabled");
    document.getElementById("ctrl-forward").classList.remove("disabled");
    document.getElementById("progress-track").classList.remove("is-live");
    document.getElementById("progress-elapsed").textContent = "00:00";
    document.getElementById("progress-remaining").textContent = "";

    // Twitch puede tardar un poco en exponer la duración del VOD.
    // Refrescamos varias veces para que el tiempo aparezca aunque READY llegue antes.
    [250, 750, 1500, 2500].forEach(delay => setTimeout(() => {
        if (currentVideoId === videoId && twitchPlayer) updateProgressUI();
    }, delay));

    // Nombre para mostrar (con mayúsculas/formato reales) del streamer del VOD.
    const user = await fetchUserByLogin(channelLogin);
    if (currentVideoId !== videoId) return;
    if (user && user.display_name) {
        setPlayerInfo(user.display_name, title || "", "", null, null, user.profile_image_url || "");
    }
}

function goToPlayerScreen() {
    if (window.clearFocusBackground) window.clearFocusBackground();
    // Si el chat había quedado abierto desde el perfil de un canal offline,
    // lo devolvemos a su lugar dentro del reproductor (connectChat de más
    // abajo se encarga de reconectarlo al canal/VOD que se está abriendo).
    if (profileChatOpen) closeProfileChat();
    const chatPanel = document.getElementById("chat-panel");
    const playerArea = document.getElementById("player-area");
    if (chatPanel && playerArea && chatPanel.parentElement !== playerArea) {
        playerArea.appendChild(chatPanel);
    }
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById("player-screen").classList.add("active");
    currentScreen = "player";
    // Al entrar a un stream/VOD no se muestra nada encima del video: ni la
    // barra de controles ni el chat. Se ocultan aquí de forma explícita
    // (además de no mostrarlos al crear el reproductor) para que lo único
    // visible al abrir sea el contenido. El usuario puede volver a mostrarlos
    // con el mando (flecha abajo para los controles, botón de chat para el chat).
    hideControls();
    const chatPanelInit = document.getElementById("chat-panel");
    if (chatPanelInit) {
        chatPanelInit.classList.add("hidden-chat");
        chatPanelInit.setAttribute("aria-hidden", "true");
        chatPanelInit.style.pointerEvents = "none";
    }
    hideQualityPanel();

    // El reproductor se inicia en silencio desde Twitch Embed.
    // No dependemos de un "autoclic" artificial sobre el iframe.
}

// Acción del botón/zona de play centrado sobre el video: reanuda si está
// pausado (mismo comportamiento de siempre, se llame por clic, Enter/OK o
// mando a distancia).
// El botón grande de play centrado se quitó: ahora un clic/toque en el
// centro del área del video alterna play/pausa directamente, y desde el
// mando se usa el botón Play/Pausa de la barra de controles (flecha arriba
// para mostrarla si está oculta).
// Nota: este clic ya NO alterna play/pausa. En TV, el propio control
// remoto suele emular un clic sobre el elemento que tiene el foco al
// pulsar OK — así que alternar play/pausa acá causaba pausas inesperadas
// justo al mostrar los controles. Un toque/clic en el video ahora solo
// se asegura de que los controles estén visibles.
let playerAreaClickBound = false;
function bindPlayerAreaCenterClick() {
    if (playerAreaClickBound) return;
    const area = document.getElementById("player-area");
    if (!area) return;
    playerAreaClickBound = true;
    // Sin capa por delante del iframe (una capa transparente ahí bloqueaba
    // toques que debían llegar al video/reproductor de Twitch). Este
    // listener va directo sobre #player-area: los toques que caen dentro
    // del iframe de Twitch no burbujean hasta acá (origen cruzado), así que
    // solo se dispara con toques en el margen/fondo del área del reproductor,
    // sin interceptar nunca el iframe.
    // La barra de controles, el panel de chat y el panel de calidad son
    // hijos de #player-area, así que un toque sobre cualquiera de ellos
    // (botones, input de chat, lista de calidad) burbujea hasta acá. Antes
    // se procesaba igual y se llamaba a e.preventDefault() sin distinguir
    // el origen, lo que en touch bloqueaba el clic sintético del botón real
    // (los controles no respondían al tacto) y podía robarle el foco/tacto
    // al chat. Ahora se ignoran esos toques por completo para que cada
    // elemento maneje los suyos.
    const isInsideOwnUi = (target) => !!(target && target.closest &&
        target.closest("#player-controls-bar, #chat-panel, #quality-panel"));
    const handlePlayerTouch = () => {
        if (!twitchPlayer) return;
        if (isControlsActionSuppressed()) return;
        let paused = false;
        try { paused = !!twitchPlayer.isPaused(); } catch (err) {}
        if (paused) {
            playVideo(true);
            showControls(false);
        } else if (controlsVisible) {
            hideControls();
        } else {
            showControls(false);
        }
    };
    area.addEventListener("click", (e) => {
        if (isInsideOwnUi(e.target)) return;
        handlePlayerTouch();
    });
    area.addEventListener("touchend", (e) => {
        if (isInsideOwnUi(e.target)) return;
        e.preventDefault();
        handlePlayerTouch();
    }, { passive: false });
}
bindPlayerAreaCenterClick();

// ---- Acciones de navegación desde la información del stream ----
function getPlayerNavigationItems() {
    const items = [];
    const profile = document.getElementById("player-profile-action");
    const game = document.getElementById("player-game-action");
    if (profile && !profile.classList.contains("disabled")) items.push({type:"info", index:0, el:profile});
    if (game && playerInfoHasGame && !game.classList.contains("disabled") && !game.classList.contains("hidden")) {
        items.push({type:"info", index:1, el:game});
    }
    const seekTrack = document.getElementById("progress-track");
    if (seekTrack && !seekTrack.classList.contains("is-live")) {
        items.push({type:"seek", el:seekTrack});
    }
    CONTROL_ACTIONS.forEach((action) => {
        const el = document.getElementById(`ctrl-${action}`);
        if (el && !el.classList.contains("disabled") && !el.classList.contains("hidden")) {
            items.push({type:"control", action, el});
        }
    });
    return items;
}

function clearPlayerNavigationFocus() {
    document.querySelectorAll("#player-profile-action.focused, #player-game-action.focused, #progress-track.focused, .ctrl-btn.focused")
        .forEach(el => el.classList.remove("focused"));
}


function getCurrentPlayerNavigationIndex() {
    const items = getPlayerNavigationItems();
    const active = document.activeElement;
    const idx = items.findIndex(item => item.el === active);
    if (idx >= 0) return idx;
    const activeCtrl = items.find(item => item.type === "control" && item.action === CONTROL_ACTIONS[controlFocusIndex]);
    if (activeCtrl) return items.indexOf(activeCtrl);
    const activeInfo = items.find(item => item.type === "info" && item.index === playerInfoFocusIndex);
    return activeInfo ? items.indexOf(activeInfo) : 0;
}

function focusPlayerNavigationIndex(index) {
    const items = getPlayerNavigationItems();
    if (!items.length) return;
    index = Math.max(0, Math.min(index, items.length - 1));
    const item = items[index];
    clearPlayerNavigationFocus();
    if (item.type === "info") {
        playerInfoFocusIndex = item.index;
        item.el.focus();
        item.el.classList.add("focused");
        return;
    }
    if (item.type === "seek") {
        item.el.focus();
        item.el.classList.add("focused");
        controlsVisible = true;
        document.getElementById("player-controls-bar")?.classList.add("visible");
        return;
    }
    controlFocusIndex = CONTROL_ACTIONS.indexOf(item.action);
    controlsVisible = true;
    document.getElementById("player-controls-bar")?.classList.add("visible");
    item.el.focus();
    item.el.classList.add("focused");
}

function updatePlayerInfoFocus() {
    const profile = document.getElementById("player-profile-action");
    const game = document.getElementById("player-game-action");
    profile?.classList.toggle("focused", playerInfoFocusIndex === 0 && document.activeElement === profile);
    game?.classList.toggle("focused", playerInfoFocusIndex === 1 && playerInfoHasGame && document.activeElement === game);
}

async function activatePlayerInfo(index) {
    if (index === 0 && currentChannelLogin) {
        try { if (twitchPlayer) twitchPlayer.pause(); } catch (_) {}
        playerInfoReturn = true;
        playerInfoReturnScreen = "player";
        const login = String(currentChannelLogin).trim();
        if (!login) return;
        await runSearch(login);
        return;
    }
    if (index === 1 && currentPlayerGameId && currentPlayerGameName) {
        try { if (twitchPlayer) twitchPlayer.pause(); } catch (_) {}
        playerInfoReturn = true;
        playerInfoReturnScreen = "player";
        openGameScreen(currentPlayerGameId, currentPlayerGameName);
    }
}

function setupPlayerInfoNavigation() {
    const profile = document.getElementById("player-profile-action");
    const game = document.getElementById("player-game-action");
    [profile, game].forEach((btn, index) => {
        if (!btn) return;
        btn.addEventListener("click", () => activatePlayerInfo(index));
        btn.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                activatePlayerInfo(index);
            }
        });
        btn.addEventListener("focus", () => {
            playerInfoFocusIndex = index;
            updatePlayerInfoFocus();
        });
    });
}

// ---- Barra de controles, navegable con el control remoto ----
function setupPlayerControls() {
    initControlIcons();
    setupProgressBarSeek();

    // En algunos mandos Tizen el OK llega al documento y el foco visual
    // permanece sobre el control. Capturamos ese caso explícitamente.
    const chatLayoutBtn = document.getElementById("ctrl-chat-layout");
    if (chatLayoutBtn) {
        chatLayoutBtn.addEventListener("keydown", (e) => {
            const code = e.keyCode || e.which;
            if (code === 13 || code === 23 || e.key === "Enter" || e.key === "OK") {
                e.preventDefault();
                e.stopPropagation();
                if (isControlsActionSuppressed()) return;
                if (twitchPlayer) cycleChatLayout();
            }
        }, true);
    }
    CONTROL_ACTIONS.forEach((action) => {
        const btn = document.getElementById(`ctrl-${action}`);
        btn.addEventListener("click", () => {
            if (isControlsActionSuppressed()) return;
            runControlAction(action);
        });
        btn.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            if (isControlsActionSuppressed()) return;
            runControlAction(action);
        });
        btn.addEventListener("focus", () => {
            controlsVisible = true;
            document.getElementById("player-controls-bar").classList.add("visible");
            controlFocusIndex = CONTROL_ACTIONS.indexOf(action);
            updateControlsFocus();
            scheduleControlsAutoHide();
        });
    });
    // Blindaje adicional en fase de captura: cualquier click o Enter/OK
    // (incluido uno sintético o disparado por un elemento que no pasa por los
    // listeners de arriba) que llegue mientras la ventana de supresión está
    // activa se detiene aquí, antes de que alcance al botón.
    const controlsBar = document.getElementById("player-controls-bar");
    if (controlsBar) {
        controlsBar.addEventListener("click", (e) => {
            if (isControlsActionSuppressed()) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }, true);
        controlsBar.addEventListener("keydown", (e) => {
            const isActivate = e.key === "Enter" || e.key === " " ||
                               e.keyCode === 13 || e.keyCode === 23;
            if (!isActivate) return;
            if (isControlsActionSuppressed()) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }, true);
    }
}

let controlsAutoHideTimer = null;
const CONTROLS_AUTO_HIDE_MS = 4000;

// Reinicia la cuenta regresiva para ocultar la barra de controles sola.
// No oculta mientras el video está pausado (ahí conviene que se queden
// visibles) ni mientras hay un panel de calidad o el compositor de chat
// abiertos encima.
function scheduleControlsAutoHide() {
    if (controlsAutoHideTimer) return;
    controlsAutoHideTimer = setTimeout(() => {
        controlsAutoHideTimer = null;
        if (currentScreen !== "player" || !controlsVisible) return;
        if (qualityPanelVisible || document.getElementById("chat-composer")) return;
        let paused = false;
        try { paused = !!(twitchPlayer && twitchPlayer.isPaused()); } catch (err) {}
        if (paused) return;
        hideControls();
    }, CONTROLS_AUTO_HIDE_MS);
}

function clearControlsAutoHide() {
    if (controlsAutoHideTimer) { clearTimeout(controlsAutoHideTimer); controlsAutoHideTimer = null; }
}

function showControls(focusPlay = true) {
    // v65: armar la supresión SIEMPRE, no solo la primera vez.
    armControlsSuppression();
    controlsVisible = true;
    controlFocusIndex = CONTROL_ACTIONS.indexOf("play");
    const bar = document.getElementById("player-controls-bar");
    const playBtn = document.getElementById("ctrl-play");
    bar?.classList.add("visible");
    if (focusPlay && playBtn) {
        // v65: el foco se aplica en el siguiente frame para que la
        // supresión ya esté activa cuando el mando dispare su click sintético.
        requestAnimationFrame(() => {
            try { playBtn.focus({preventScroll:true}); } catch (_) { playBtn.focus(); }
            playBtn.classList.add("focused");
        });
    }
    updateControlsFocus();
    scheduleControlsAutoHide();
}

function hideControls() {
    controlsVisible = false;
    clearControlsAutoHide();
    document.getElementById("player-controls-bar").classList.remove("visible");
    clearPlayerNavigationFocus();
}

function updateControlsFocus() {
    const activeAction = CONTROL_ACTIONS[controlFocusIndex];
    document.querySelectorAll(".ctrl-btn.focused").forEach(b => b.classList.remove("focused"));
    const el = document.getElementById(`ctrl-${activeAction}`);
    if (el && !el.classList.contains("hidden") && document.activeElement === el) el.classList.add("focused");
}

function moveControlFocus(delta) {
    const items = getPlayerNavigationItems();
    if (!items.length) return;
    let current = getCurrentPlayerNavigationIndex();
    current = (current + delta + items.length) % items.length;
    focusPlayerNavigationIndex(current);
}

function handlePlayerScreenKeys(keyCode, e) {
    const activeEl = document.activeElement;
    // Cualquier tecla manejada acá mientras los controles están visibles
    // reinicia la cuenta para el auto-ocultado: el usuario sigue interactuando.
    if (controlsVisible) scheduleControlsAutoHide();
    if ((keyCode === 13 || keyCode === 23) &&
        activeEl?.id === "ctrl-chat-layout") {
        e.preventDefault();
        e.stopPropagation();
        if (twitchPlayer) cycleChatLayout();
        return;
    }

    const targetTag = e.target.tagName;
    if (document.getElementById("chat-composer")) {
        if (keyCode === 10009 || keyCode === 27) { e.preventDefault(); closeChatComposer(); }
        return;
    }
    if (targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "A") {
        if (keyCode === 10009 || keyCode === 27) { e.preventDefault(); goBack(); }
        return;
    }

    if (keyCode === 13) {
        const active = document.activeElement;
        if (active?.id === "ctrl-chat") {
            e.preventDefault(); e.stopPropagation();
            if (isControlsActionSuppressed()) return;
            runControlAction("chat"); return;
        }
    }

    if (qualityPanelVisible) {
        if (keyCode === 38) { qualityPanelFocusIndex = Math.max(0, qualityPanelFocusIndex - 1); updateQualityPanelFocus(); return; }
        if (keyCode === 40) { qualityPanelFocusIndex = Math.min(availableQualities.length - 1, qualityPanelFocusIndex + 1); updateQualityPanelFocus(); return; }
        if (keyCode === 13) { selectQuality(qualityPanelFocusIndex); return; }
        if (keyCode === 10009 || keyCode === 27) { e.preventDefault(); hideQualityPanel(); return; }
        return;
    }
    // Izquierda/derecha recorren una única secuencia: foto de perfil, juego y controles.
    // Excepción: si el foco está en la barra de progreso, izquierda/derecha
    // avanzan/retroceden el video en vez de mover el foco a otro elemento.
    const current = getCurrentPlayerNavigationIndex();
    const items = getPlayerNavigationItems();
    const focusedItem = items[current];
    if ((keyCode === 37 || keyCode === 39) && focusedItem?.type === "seek") {
        e.preventDefault();
        seekBy(keyCode === 37 ? -5 : 5);
        return;
    }
    if (keyCode === 37) {
        e.preventDefault();
        focusPlayerNavigationIndex((current - 1 + items.length) % items.length);
        return;
    }
    if (keyCode === 39) {
        e.preventDefault();
        focusPlayerNavigationIndex((current + 1) % items.length);
        return;
    }
    if (keyCode === 38) {
        e.preventDefault();
        // Arriba siempre garantiza que la barra de controles esté visible,
        // con el foco en el botón de Play/Pausa.
        showControls(true);
        return;
    }
    if (keyCode === 40) {
        e.preventDefault();
        if (focusedItem?.type === "info") {
            const firstControlIndex = items.findIndex(item => item.type === "control");
            if (firstControlIndex >= 0) focusPlayerNavigationIndex(firstControlIndex);
            return;
        }
        hideControls();
        return;
    }
    if (keyCode === 13 || keyCode === 23) {
        e.preventDefault();
        e.stopPropagation();
        if (isControlsActionSuppressed()) return;
        if (focusedItem?.type === "info") activatePlayerInfo(focusedItem.index);
        else if (focusedItem?.type === "control") runControlAction(focusedItem.action);
        else if (twitchPlayer) togglePlayPause(true);
        return;
    }
    if (keyCode === 10009 || keyCode === 27) { e.preventDefault(); goBack(); return; }

    // Sin foco definido, mostrar controles y arrancar en el botón activo de play/pause.
    if (!focusedItem) showControls();
}

function runControlAction(action) {
    const btn = document.getElementById(`ctrl-${action}`);
    if (action === "chat-layout") {
        cycleChatLayout();
        return;
    }
    if (!twitchPlayer) return;
    if (btn && btn.classList.contains("disabled")) return;

    switch (action) {
        case "play": togglePlayPause(true); break;
        case "rewind": seekBy(-10); break;
        case "forward": seekBy(10); break;
        case "quality": toggleQualityPanel(); break;
        case "chat": toggleChat(); break;
        case "chat-layout": cycleChatLayout(); break;
        case "chat-send": openChatComposer(); break;
        case "refresh": refreshPlayer(); break;
        case "mute": toggleMute(); break;
    }
}

function playVideo(userGesture = false) {
    if (!twitchPlayer) return;
    try {
        if (userGesture) {
            try { twitchPlayer.setMuted(false); isMuted = false; syncMuteIcon(); } catch (e) {}
        }
        twitchPlayer.play();
        updatePlayPauseVisibility(true);
    } catch (e) { /* no-op */ }
}

function pauseVideo() {
    if (!twitchPlayer) return;
    try { twitchPlayer.pause(); updatePlayPauseVisibility(false); } catch (e) { /* no-op */ }
}

function togglePlayPause(userGesture = false) {
    if (!twitchPlayer) return;
    try {
        if (twitchPlayer.isPaused()) playVideo(userGesture);
        else pauseVideo();
    } catch (e) { /* no-op */ }
}

// ---- Silenciar / activar sonido ----
let isMuted = false;

function toggleMute() {
    if (!twitchPlayer) return;
    try {
        isMuted = !twitchPlayer.getMuted();
        twitchPlayer.setMuted(isMuted);
    } catch (e) { /* no-op */ }
    setCtrlIcon("mute", isMuted ? "volumeOff" : "volumeOn");
}

function syncMuteIcon() {
    if (!twitchPlayer) return;
    try { isMuted = !!twitchPlayer.getMuted(); } catch (e) { /* no-op */ }
    setCtrlIcon("mute", isMuted ? "volumeOff" : "volumeOn");
}

function seekBy(seconds) {
    if (!twitchPlayer || playbackType !== "vod") return;
    try {
        const t = twitchPlayer.getCurrentTime() || 0;
        twitchPlayer.seek(Math.max(0, t + seconds));
        updateProgressUI();
    } catch (e) { /* no-op */ }
}

// ---- Barra de progreso: arrastrable/clicable con el mouse (y touch) ----
// Antes era puramente decorativa (pointer-events:none): solo mostraba el
// avance, no dejaba saltar a un punto del video.
function setupProgressBarSeek() {
    const track = document.getElementById("progress-track");
    const fill = document.getElementById("progress-fill");
    if (!track || !fill) return;
    let dragging = false;

    function seekToClientX(clientX) {
        if (!twitchPlayer || playbackType !== "vod") return;
        const rect = track.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        try {
            const duration = twitchPlayer.getDuration() || 0;
            if (!duration) return;
            twitchPlayer.seek(ratio * duration);
            // Refresco visual inmediato: no esperamos al próximo tick del
            // loop de progreso para que el arrastre se sienta fluido.
            fill.style.width = `${ratio * 100}%`;
            document.getElementById("progress-elapsed").textContent = formatTimeHMS(ratio * duration);
        } catch (e) { /* no-op */ }
    }

    track.addEventListener("mousedown", (e) => {
        if (playbackType !== "vod") return;
        dragging = true;
        track.classList.add("seeking");
        seekToClientX(e.clientX);
        e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        seekToClientX(e.clientX);
    });
    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        track.classList.remove("seeking");
    });

    track.addEventListener("touchstart", (e) => {
        if (playbackType !== "vod" || !e.touches[0]) return;
        dragging = true;
        track.classList.add("seeking");
        seekToClientX(e.touches[0].clientX);
    }, { passive: true });
    track.addEventListener("touchmove", (e) => {
        if (!dragging || !e.touches[0]) return;
        seekToClientX(e.touches[0].clientX);
    }, { passive: true });
    track.addEventListener("touchend", () => {
        dragging = false;
        track.classList.remove("seeking");
    });

    // Foco (control remoto/teclado): las flechas izquierda/derecha las
    // maneja handlePlayerScreenKeys cuando el foco está en esta barra
    // (ver el tipo "seek" en getPlayerNavigationItems).
    track.addEventListener("focus", () => {
        controlsVisible = true;
        document.getElementById("player-controls-bar")?.classList.add("visible");
    });
}

// ---- Panel de calidad: lista real, no un ciclo a ciegas ----
let qualityPanelVisible = false;
let qualityPanelFocusIndex = 0;

function toggleQualityPanel() {
    // Antes, pulsar el engranaje siempre volvía a abrir el panel aunque ya
    // estuviera abierto; ahora una segunda pulsación lo cierra.
    if (qualityPanelVisible) hideQualityPanel();
    else showQualityPanel();
}

function showQualityPanel() {
    if (!twitchPlayer) return;
    try { availableQualities = twitchPlayer.getQualities() || availableQualities; } catch (e) { /* no-op */ }
    if (!availableQualities.length) return;

    let current = null;
    try { current = twitchPlayer.getQuality(); } catch (e) { /* no-op */ }
    qualityIndex = Math.max(0, availableQualities.findIndex(q => (q.group || q.quality || q.name) === current));
    qualityPanelFocusIndex = qualityIndex;

    const list = document.getElementById("quality-list");
    list.innerHTML = availableQualities.map((q, i) => {
        const label = q.name || q.label || q.group || q.quality || `Calidad ${i+1}`;
        return `<div class="quality-item ${i === qualityIndex ? "active" : ""}" data-index="${i}" tabindex="-1"><span>${escapeHtml(label)}</span>${i === qualityIndex ? "<span>✓</span>" : ""}</div>`;
    }).join("");
    list.querySelectorAll(".quality-item").forEach(el => {
        el.addEventListener("click", () => selectQuality(Number(el.dataset.index)));
    });
    const first = list.querySelector(`.quality-item[data-index="${qualityPanelFocusIndex}"]`);
    if (first) first.focus();

    document.getElementById("quality-panel").classList.remove("hidden");
    qualityPanelVisible = true;
    updateQualityPanelFocus();
}

function hideQualityPanel() {
    document.getElementById("quality-panel").classList.add("hidden");
    qualityPanelVisible = false;
}

function updateQualityPanelFocus() {
    document.querySelectorAll("#quality-list .quality-item").forEach(el => el.classList.remove("focused"));
    const el = document.querySelector(`#quality-list .quality-item[data-index="${qualityPanelFocusIndex}"]`);
    if (el) {
        el.classList.add("focused");
        el.scrollIntoView({ block: "nearest" });
    }
}

function selectQuality(index) {
    qualityIndex = index;
    const q = availableQualities[index];
    if (q && twitchPlayer) {
        const qualityValue = q.group || q.quality || q.name;
        try { twitchPlayer.setQuality(qualityValue); } catch (e) { console.warn("No se pudo cambiar la calidad", e); }
    }
    hideQualityPanel();
    updateQualityCtrlLabel();
}

// Etiqueta corta para mostrar en el botón del engranaje en vez del ícono
// fijo: "Auto", "1080p", "720p", etc. (se recorta el framerate del nombre
// que da Twitch, p. ej. "1080p60" -> "1080p", para que quede compacto).
function qualityShortLabel(q) {
    if (!q) return "Auto";
    const raw = q.group || q.quality || q.name || "";
    if (/^auto$/i.test(raw) || /^auto$/i.test(q.name || "")) return "Auto";
    const match = String(q.name || raw).match(/^(\d+p)/i);
    return match ? match[1] : (q.name || raw || "Auto");
}

// Pinta el nombre de la calidad actual en el botón, reemplazando el
// ícono de engranaje fijo, para que se vea de un vistazo qué calidad
// está activa sin tener que abrir el panel.
function updateQualityCtrlLabel() {
    const el = document.getElementById("ctrl-quality");
    if (!el) return;
    const q = availableQualities[qualityIndex];
    el.textContent = qualityShortLabel(q);
    el.classList.add("ctrl-btn-quality");
}

function toggleChat() {
    const panel = document.getElementById("chat-panel");
    if (!panel) return;
    const hidden = !panel.classList.contains("hidden-chat");
    panel.classList.toggle("hidden-chat", hidden);
    panel.setAttribute("aria-hidden", hidden ? "true" : "false");
    panel.style.pointerEvents = hidden ? "none" : "auto";
    const btn = document.getElementById("ctrl-chat");
    if (btn) btn.setAttribute("aria-label", hidden ? "Mostrar chat" : "Ocultar chat");
}

function refreshPlayer() {
    if (playbackType === "live" && currentChannelLogin) openChannel(currentChannelLogin);
    else if (playbackType === "vod" && currentVideoId) openVod(currentVideoId, currentChannelLogin);
}

// ---- Barra de progreso: LIVE en directo, tiempo restante en VODs ----
let progressInterval = null;

function startProgressLoop() {
    stopProgressLoop();
    updateProgressUI();
    // En vivo no hay un tiempo de reproducción que tenga sentido mostrar
    // (no es un contador de avance sobre una duración total), así que no
    // hace falta refrescar cada segundo — solo para VODs.
    if (playbackType === "live") return;
    progressInterval = setInterval(updateProgressUI, 1000);
}

function stopProgressLoop() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = null;
}

function formatTimeHMS(totalSeconds) {
    const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateProgressUI() {
    if (!twitchPlayer) return;
    const track = document.getElementById("progress-track");
    const fill = document.getElementById("progress-fill");
    const elapsedEl = document.getElementById("progress-elapsed");
    const remainingEl = document.getElementById("progress-remaining");

    if (playbackType === "live") {
        document.querySelector("#progress-elapsed .live-dot")?.style.setProperty("display", "inline-block");
        // Es un stream en vivo: no mostramos ningún tiempo de reproducción,
        // solo la etiqueta "EN VIVO" y la barra llena.
        track.classList.add("is-live");
        fill.style.width = "100%";
        elapsedEl.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>EN VIVO</span>';
        remainingEl.textContent = "";
        return;
    }

    track.classList.remove("is-live");
    document.querySelector("#progress-elapsed .live-dot")?.style.setProperty("display", "none");
    try {
        const current = twitchPlayer.getCurrentTime() || 0;
        const duration = twitchPlayer.getDuration() || 0;
        const pct = duration ? Math.min(100, (current / duration) * 100) : 0;
        fill.style.width = `${pct}%`;
        elapsedEl.textContent = formatTimeHMS(current);
        remainingEl.textContent = duration ? formatTimeHMS(duration) : "";
    } catch (e) { /* no-op */ }

    syncVodChatWithPlayback();
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================
// Chat propio — se conecta directo al IRC de Twitch por WebSocket
// de forma ANÓNIMA (login "justinfanXXXXX", sin contraseña). Esto es
// una función oficial y documentada de Twitch para lectura pública de
// chat, no un atajo no autorizado — el chat de Twitch ES un servidor
// IRC y siempre permitió espectadores anónimos de solo lectura.
//
// Por eso construimos nuestra propia interfaz (fondo semi-transparente
// sin afectar el texto, tamaños, marcas de hora, etc.) en vez de usar
// el iframe de chat de Twitch, que no permite ese nivel de control.
//
// LÍMITE HONESTO: como es una conexión anónima de solo lectura, esta
// app no puede ENVIAR mensajes al chat real — eso requeriría que inicies
// sesión con tu cuenta de Twitch (OAuth), y ese flujo de login lo
// quitamos antes a pedido tuyo. El cuadro de texto está para que la
// interfaz se sienta completa, pero al enviar te avisa de esta limitación.
// ============================================================
let chatSocket = null;
let chatMessages = [];
const MAX_CHAT_MESSAGES = 150;
let chatCurrentChannel = null;   // canal al que "deberíamos" estar conectados
let chatReconnectTimer = null;
let chatReconnectAttempts = 0;
// Vigía de conexión: si Twitch nunca confirma la conexión (numérico
// 001/376, ver markChatConnected) dentro de este tiempo, el WebSocket
// puede quedar "colgado" sin abrirse ni cerrarse nunca (pasa en algunos
// navegadores/WebView de TV), y antes eso dejaba el chat mostrando
// "Conectando al chat…" para siempre, sin ningún error que disparara el
// reintento automático — solo un recargar de página completo lo
// destrababa. Se fuerza un cierre + reintento si tarda demasiado.
let chatConnectTimer = null;
const CHAT_CONNECT_TIMEOUT_MS = 4000; // v66: antes 8000, reintenta más agresivo

// ============================================================
// Emotes de 7TV + badges reales de Twitch para el chat
// ============================================================
// 7TV es un servicio de emotes de terceros muy usado en Twitch (no es de
// Twitch ni requiere login): cada canal puede tener su propio set de
// emotes ahí, además de un set global. La API es pública y no necesita
// credenciales. Si un canal no tiene 7TV vinculado, la API simplemente
// devuelve 404 — no es un error, se trata como "sin emotes de 7TV".
let sevenTvGlobalEmotes = null;          // Map nombre -> url (cache para toda la sesión)
let sevenTvGlobalEmotesPromise = null;
let sevenTvChannelEmotes = new Map();    // Map nombre -> url, del canal actualmente abierto
let sevenTvChannelToken = 0;             // invalida cargas de canal viejas si se cambia rápido

function sevenTvEmoteUrl(emote) {
    return `https://cdn.7tv.app/emote/${emote.id}/2x.webp`;
}

async function loadSevenTvGlobalEmotes() {
    if (sevenTvGlobalEmotes) return sevenTvGlobalEmotes;
    if (sevenTvGlobalEmotesPromise) return sevenTvGlobalEmotesPromise;
    sevenTvGlobalEmotesPromise = (async () => {
        const map = new Map();
        try {
            const res = await fetch("https://7tv.io/v3/emote-sets/global");
            if (res.ok) {
                const data = await res.json();
                (data.emotes || []).forEach(e => map.set(e.name, sevenTvEmoteUrl(e)));
            }
        } catch (e) {
            console.warn("No se pudieron cargar los emotes globales de 7TV:", e);
        }
        sevenTvGlobalEmotes = map;
        return map;
    })();
    return sevenTvGlobalEmotesPromise;
}

async function loadSevenTvChannelEmotes(broadcasterId) {
    const myToken = ++sevenTvChannelToken;
    sevenTvChannelEmotes = new Map(); // limpia mientras carga el canal nuevo
    if (!broadcasterId) return;
    try {
        const res = await fetch(`https://7tv.io/v3/users/twitch/${encodeURIComponent(broadcasterId)}`);
        if (!res.ok) return; // 404 = el canal no tiene 7TV vinculado, no es un error
        const data = await res.json();
        if (myToken !== sevenTvChannelToken) return; // el usuario ya cambió de canal
        const map = new Map();
        (data?.emote_set?.emotes || []).forEach(e => map.set(e.name, sevenTvEmoteUrl(e)));
        if (myToken === sevenTvChannelToken) sevenTvChannelEmotes = map;
    } catch (e) {
        console.warn("No se pudieron cargar los emotes de 7TV del canal:", e);
    }
}

// Reemplaza en un fragmento de texto plano (sin emotes nativos de Twitch)
// las palabras que coincidan con un emote de 7TV, por imagen. El resto se
// escapa normalmente. El set del canal tiene prioridad sobre el global,
// igual que hace 7TV en su propia extensión.
function renderTextWith7tv(text) {
    if (!text) return "";
    return text.split(/(\s+)/).map(token => {
        if (!token || /^\s+$/.test(token)) return token;
        const url = sevenTvChannelEmotes.get(token) || (sevenTvGlobalEmotes && sevenTvGlobalEmotes.get(token));
        if (url) return `<img class="chat-emote" src="${url}" alt="${escapeHtml(token)}" title="${escapeHtml(token)}">`;
        return escapeHtml(token);
    }).join("");
}

// ---- Badges reales de Twitch (globales + del canal) ----
// Antes se mostraba siempre el mismo ícono de texto (STR/MOD/VIP/SUB) para
// cualquier canal. Esto trae las imágenes reales que configura Twitch,
// incluyendo las versiones/tiers propias de cada canal (ej. sub badges
// personalizados), igual que se ven en la web oficial.
let twitchGlobalBadges = null;          // Map "set_id/version" -> url (cache para toda la sesión)
let twitchGlobalBadgesPromise = null;
let twitchChannelBadges = new Map();    // Map "set_id/version" -> url, del canal actual

function indexBadgeSets(setsArr, map) {
    (setsArr || []).forEach(set => {
        (set.versions || []).forEach(v => {
            map.set(`${set.set_id}/${v.id}`, v.image_url_2x || v.image_url_1x || v.image_url_4x);
        });
    });
}

async function loadTwitchGlobalBadges() {
    if (twitchGlobalBadges) return twitchGlobalBadges;
    if (twitchGlobalBadgesPromise) return twitchGlobalBadgesPromise;
    twitchGlobalBadgesPromise = (async () => {
        const map = new Map();
        try {
            const data = await helixGet("chat/badges/global");
            indexBadgeSets(data.data, map);
        } catch (e) {
            console.warn("No se pudieron cargar los badges globales:", e);
        }
        twitchGlobalBadges = map;
        return map;
    })();
    return twitchGlobalBadgesPromise;
}

async function loadTwitchChannelBadges(broadcasterId) {
    twitchChannelBadges = new Map();
    if (!broadcasterId) return;
    try {
        const data = await helixGet(`chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`);
        const map = new Map();
        indexBadgeSets(data.data, map);
        twitchChannelBadges = map;
    } catch (e) {
        console.warn("No se pudieron cargar los badges del canal:", e);
    }
}

// Arma el HTML de los badges de un mensaje a partir del tag IRC "badges"
// (formato "set1/version1,set2/version2..."). El set del canal tiene
// prioridad (ahí viven los sub badges personalizados de cada streamer),
// y si no está cargado/encontrado cae al set global.
function renderRealBadges(badgesRaw) {
    if (!badgesRaw) return "";
    return badgesRaw.split(",").filter(Boolean).map(pair => {
        const url = twitchChannelBadges.get(pair) || (twitchGlobalBadges && twitchGlobalBadges.get(pair));
        if (!url) return "";
        const setId = pair.split("/")[0];
        return `<img class="chat-real-badge" src="${url}" alt="${escapeHtml(setId)}" title="${escapeHtml(setId)}">`;
    }).join("");
}

// Se llama al abrir un canal (en vivo o VOD): trae en paralelo los
// emotes de 7TV y los badges reales para ESE canal. Los globales solo se
// piden una vez por sesión (quedan en cache). No bloquea nada de la UI:
// mientras carga, el chat sigue mostrando los mensajes con el badge de
// texto de respaldo (ver ROLE_BADGE_LABELS) hasta que esto termine.
async function loadChatCosmetics(channelLogin) {
    if (!channelLogin) return;
    loadTwitchGlobalBadges(); // no se espera: corre en paralelo, se cachea sola
    loadSevenTvGlobalEmotes();
    const user = await fetchUserByLogin(channelLogin);
    const broadcasterId = user?.id || null;
    await Promise.all([
        loadSevenTvChannelEmotes(broadcasterId),
        loadTwitchChannelBadges(broadcasterId)
    ]);
    // Si llegó después de que ya se pintaron mensajes (o el usuario sigue
    // en el mismo canal), repinta para que se vean las imágenes reales.
    if (currentChannelLogin === channelLogin) renderChatMessages(false);
}

// ---- Repetición del chat en VODs ----
// Twitch no reenvía el chat en vivo para un video ya grabado, pero sí
// guarda cada mensaje con su "content_offset_seconds" (segundo del video
// en que se escribió) a través del endpoint público de comentarios. Lo
// usamos para reconstruir el chat y mostrarlo sincronizado con el avance
// del reproductor, igual que hace la propia web de Twitch.
let vodChatComments = [];      // mensajes ya traídos, ordenados por offset
let vodChatPlayedIndex = 0;    // hasta qué índice ya se mostró
let vodChatNextCursor = null;  // paginación de la API
let vodChatLoading = false;
let vodChatEnded = false;      // ya no hay más páginas que traer
let vodChatToken = 0;          // invalida cargas viejas si se cambia de VOD

function connectChat(channelLogin) {
    disconnectChat(); // cierra cualquier conexión anterior y cancela reintentos pendientes
    chatCurrentChannel = channelLogin;
    chatReconnectAttempts = 0;
    chatMessages = [];
    // Feedback inmediato: antes la pantalla de chat quedaba vacía y en
    // silencio hasta que llegaba el primer mensaje del canal (podía tardar
    // según la actividad del chat), lo que se sentía como si no cargara.
    // Se muestra un aviso de "conectando" que se saca solo apenas el
    // servidor de Twitch confirma la conexión (ver markChatConnected).
    chatMessages.push({ system: true, connecting: true, text: "Conectando al chat…" });
    renderChatMessages();
    openChatSocket();
}

// Saca el aviso de "Conectando al chat…" apenas Twitch confirma que la
// conexión IRC quedó lista (numérico 001/376), sin esperar a que llegue
// el primer mensaje real (un canal con poca actividad podía tardar mucho
// en mostrar señales de vida).
function markChatConnected() {
    clearChatConnectTimeout(); // ya llegó la confirmación, no hace falta forzar nada
    const hadPlaceholder = chatMessages.some(m => m.connecting);
    if (!hadPlaceholder) return;
    chatMessages = chatMessages.filter(m => !m.connecting);
    renderChatMessages();
}

function armChatConnectTimeout() {
    clearChatConnectTimeout();
    chatConnectTimer = setTimeout(() => {
        chatConnectTimer = null;
        if (!chatCurrentChannel) return;
        console.warn("Chat: sin confirmación de Twitch tras el tiempo de espera, se reintenta");
        if (chatSocket) {
            try {
                chatSocket.onmessage = null;
                chatSocket.onclose = null;
                chatSocket.onerror = null;
                chatSocket.close();
            } catch (e) { /* no-op */ }
            chatSocket = null;
        }
        scheduleChatReconnect();
    }, CHAT_CONNECT_TIMEOUT_MS);
}

function clearChatConnectTimeout() {
    if (chatConnectTimer) { clearTimeout(chatConnectTimer); chatConnectTimer = null; }
}

// Separado de connectChat para poder reabrir la conexión sola (reconexión
// automática) sin repetir el reseteo de mensajes/estado cada vez.
function openChatSocket() {
    if (!chatCurrentChannel) return;
    const channelLogin = chatCurrentChannel;

    try {
        chatSocket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    } catch (e) {
        console.warn("No se pudo conectar al chat:", e);
        scheduleChatReconnect();
        return;
    }
    armChatConnectTimeout();

    chatSocket.onopen = () => {
        chatReconnectAttempts = 0; // conexión sana: reinicia el backoff
        // v66: orden según la spec de Twitch — capacidades primero,
        // autenticación después, CAP END y por último JOIN.
        chatSocket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
        if (twitchUser && twitchUser.access_token && twitchUser.login) {
            // Con sesión iniciada nos conectamos como el usuario real, lo que
            // permite además enviar mensajes (ver openChatComposer).
            chatSocket.send(`PASS oauth:${twitchUser.access_token}`);
            chatSocket.send(`NICK ${twitchUser.login.toLowerCase()}`);
        } else {
            const nick = "justinfan" + Math.floor(10000 + Math.random() * 89999);
            chatSocket.send(`NICK ${nick}`);
        }
        // CAP END: sin esto, un servidor IRC estricto puede quedar
        // esperando indefinidamente a que termine la negociación de
        // capacidades antes de mandar el 001 de bienvenida — esto podía
        // dejar la conexión "colgada" para siempre (ver markChatConnected).
        chatSocket.send("CAP END");
        chatSocket.send(`JOIN #${channelLogin.toLowerCase()}`);
    };
    chatSocket.onmessage = (evt) => {
        evt.data.split("\r\n").filter(Boolean).forEach(line => {
            // v66: cualquier línea del canal (no solo 001/376) es señal de
            // que la conexión ya está viva; antes podía tardar de más si
            // el numérico de bienvenida se demoraba.
            markChatConnected();
            handleIrcLine(line);
        });
    };
    chatSocket.onerror = (evt) => {
        console.warn("Error de conexión al chat:", evt);
    };
    chatSocket.onclose = (evt) => {
        clearChatConnectTimeout();
        chatSocket = null;
        // Si seguimos "queriendo" estar en un canal (no fue un cierre
        // intencional desde disconnectChat), intentamos reconectar solos:
        // antes, cualquier corte de conexión (red inestable, Twitch
        // reiniciando la conexión, etc.) dejaba el chat mudo para siempre
        // hasta reabrir el canal manualmente.
        if (chatCurrentChannel) scheduleChatReconnect(evt);
    };
}

function scheduleChatReconnect(closeEvt) {
    if (chatReconnectTimer || !chatCurrentChannel) return;
    chatReconnectAttempts++;
    if (chatReconnectAttempts === 1) {
        // Info de diagnóstico: código/motivo real del cierre que manda el
        // navegador (y, si Twitch lo indicó, el "reason" del servidor).
        // Código+razón visibles en consola y en el chat para poder
        // identificar la causa exacta si vuelve a pasar.
        const code = closeEvt?.code;
        const reason = closeEvt?.reason;
        console.warn("Chat WebSocket cerrado", { code, reason, wasClean: closeEvt?.wasClean });
        const detalle = code ? ` (código ${code}${reason ? `: ${reason}` : ""})` : "";
        appendSystemMessage(`Se perdió la conexión con el chat, reconectando…${detalle}`);
    }
    // Backoff simple: 2s, 4s, 8s, 16s, tope de 30s entre intentos.
    const delay = Math.min(30000, 2000 * Math.pow(2, chatReconnectAttempts - 1));
    chatReconnectTimer = setTimeout(() => {
        chatReconnectTimer = null;
        if (chatCurrentChannel) openChatSocket();
    }, delay);
}

function disconnectChat() {
    chatCurrentChannel = null; // deja de "querer" reconectarse
    if (chatReconnectTimer) { clearTimeout(chatReconnectTimer); chatReconnectTimer = null; }
    clearChatConnectTimeout();
    chatReconnectAttempts = 0;
    if (chatSocket) {
        try {
            chatSocket.onmessage = null;
            chatSocket.onclose = null;
            chatSocket.onerror = null;
            chatSocket.close();
        } catch (e) { /* no-op */ }
        chatSocket = null;
    }
    stopVodChatReplay();
}

function handleIrcLine(line) {
    if (line.startsWith("PING")) {
        chatSocket?.send("PONG :tmi.twitch.tv");
        return;
    }
    // Numérico 001 (bienvenida) / 376 (fin del MOTD): confirma que el
    // servidor de Twitch ya aceptó la conexión, incluso antes de que
    // llegue el primer PRIVMSG del canal.
    if (/^(@\S+ )?:\S+ (001|376) /.test(line)) {
        markChatConnected();
        return;
    }
    if (line.includes("NOTICE") && /login authentication failed/i.test(line)) {
        // El token de sesión venció o fue revocado: volvemos a modo lectura.
        appendSystemMessage("Tu sesión de Twitch venció. Volvés a modo solo lectura — iniciá sesión de nuevo desde \"Cuenta\".");
        clearTwitchUser();
        connectChat(currentChannelLogin);
        return;
    }
    const parsed = parseIrcLine(line);
    if (!parsed) return;

    if (parsed.command === "PRIVMSG") {
        appendChatMessage(parsed);
    }
}

function parseIrcLine(line) {
    let tags = {};
    let rest = line;
    if (line.startsWith("@")) {
        const spaceIdx = line.indexOf(" ");
        const tagStr = line.slice(1, spaceIdx);
        rest = line.slice(spaceIdx + 1);
        tagStr.split(";").forEach(pair => {
            const eq = pair.indexOf("=");
            if (eq === -1) return;
            tags[pair.slice(0, eq)] = pair.slice(eq + 1);
        });
    }
    // rest ahora es algo como: :user!user@user.tmi.twitch.tv PRIVMSG #canal :mensaje
    const match = rest.match(/^:(\S+) (\S+) (#\S+) :(.*)$/);
    if (!match) return null;
    const [, prefix, command, , text] = match;
    return { tags, command, text };
}

function appendSystemMessage(text) {
    const m = { system: true, text };
    chatMessages.push(m);
    if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
    appendChatMessageDom(m, true);
}

function appendChatMessage(parsed) {
    const tags = parsed.tags;
    const displayName = tags["display-name"] || "usuario";
    const color = tags["color"] || "#9146FF";
    const badgesList = (tags["badges"] || "").split(",").map(b => b.split("/")[0]);
    // Badge de texto de respaldo: se usa mientras los badges reales todavía
    // no terminaron de cargar (ver loadChatCosmetics), o si por lo que sea
    // no se encuentra la imagen para ese set/versión puntual.
    const roleBadge = badgesList.includes("broadcaster") ? "broadcaster"
        : badgesList.includes("moderator") ? "mod"
        : badgesList.includes("vip") ? "vip"
        : (badgesList.includes("subscriber") || badgesList.includes("founder")) ? "sub"
        : null;

    const msg = {
        name: displayName,
        color,
        roleBadge,
        badgesRaw: tags["badges"] || "",
        text: parsed.text,
        emotes: tags["emotes"] || "",
        ts: Date.now()
    };
    chatMessages.push(msg);
    if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
    appendChatMessageDom(msg, true);
}

function renderMessageText(text, emotesTag) {
    if (!emotesTag) return renderTextWith7tv(text);
    const ranges = [];
    emotesTag.split("/").forEach(part => {
        const [id, positions] = part.split(":");
        if (!positions) return;
        positions.split(",").forEach(pos => {
            const [start, end] = pos.split("-").map(Number);
            ranges.push({ id, start, end });
        });
    });
    ranges.sort((a, b) => a.start - b.start);
    const chars = Array.from(text);
    let result = "";
    let cursor = 0;
    ranges.forEach(r => {
        // Los tramos SIN emote nativo de Twitch pasan por 7TV, por si hay
        // alguna palabra ahí que matchee con un emote de 7TV.
        if (r.start > cursor) result += renderTextWith7tv(chars.slice(cursor, r.start).join(""));
        result += `<img class="chat-emote" src="https://static-cdn.jtvnw.net/emoticons/v2/${r.id}/default/dark/2.0" alt="">`;
        cursor = r.end + 1;
    });
    if (cursor < chars.length) result += renderTextWith7tv(chars.slice(cursor).join(""));
    return result;
}

const ROLE_BADGE_LABELS = { broadcaster: "STR", mod: "MOD", vip: "VIP", sub: "SUB" };

// HTML de un solo mensaje, compartido entre el repintado completo
// (renderChatMessages) y el agregado incremental (appendChatMessageDom).
function chatMessageHtml(m, showTs) {
    if (m.system) return `<div class="chat-system">${escapeHtml(m.text)}</div>`;
    const ts = showTs ? `<span class="chat-ts">${new Date(m.ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}</span>` : "";
    // Badges reales (imágenes de Twitch) si ya cargaron para este canal;
    // si todavía no hay nada cargado, se usa el badge de texto viejo
    // como respaldo para no dejar el mensaje sin ninguna marca de rol.
    const realBadges = m.badgesRaw !== undefined ? renderRealBadges(m.badgesRaw) : "";
    const badge = realBadges || (m.roleBadge ? `<span class="chat-badge ${m.roleBadge}">${ROLE_BADGE_LABELS[m.roleBadge]}</span>` : "");
    // Los mensajes en vivo traen texto+tags de Twitch (renderMessageText);
    // los de la repetición de VOD traen fragments/plainBody crudos de la
    // API de comentarios y se arman recién acá (en cada pintado), para
    // que si los emotes de 7TV del canal terminan de cargar después de
    // haber recibido los comentarios, el siguiente repintado ya los
    // muestre en vez de quedar pegado al texto plano.
    const textHtml = (m.fragments !== undefined || m.plainBody !== undefined)
        ? renderVodFragments(m.fragments, m.plainBody)
        : renderMessageText(m.text, m.emotes);
    return `<div class="chat-msg">${ts}${badge}<span class="chat-name" style="color:${m.color}">${escapeHtml(m.name)}</span><span class="chat-name">: </span><span class="chat-text">${textHtml}</span></div>`;
}

// Repintado completo: se usa solo cuando hace falta reconstruir todo el
// historial (abrir un canal, terminar de cargar emotes/badges del canal,
// repetición de VOD, etc.). Para cada mensaje individual que llega en
// vivo se usa appendChatMessageDom (más abajo), mucho más liviano.
function renderChatMessages(autoScroll) {
    const container = document.getElementById("chat-messages");
    const showTs = false;
    container.innerHTML = chatMessages.map(m => chatMessageHtml(m, showTs)).join("");
    if (autoScroll !== false) container.scrollTop = container.scrollHeight;
}

// Agrega solo el mensaje nuevo al DOM en vez de reconstruir el chat
// entero cada vez (antes, en un chat muy activo, cada mensaje volvía a
// pintar hasta los 150 mensajes del historial completo, lo que costaba
// cada vez más rendimiento cuantos más mensajes llegaban por segundo).
function appendChatMessageDom(m, autoScroll) {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = chatMessageHtml(m, false);
    const node = wrap.firstElementChild;
    if (node) container.appendChild(node);
    while (container.children.length > MAX_CHAT_MESSAGES) container.removeChild(container.firstChild);
    if (autoScroll !== false) container.scrollTop = container.scrollHeight;
}

function roleBadgeFromV5Badges(badgesArr) {
    const ids = (badgesArr || []).map(b => b._id);
    if (ids.includes("broadcaster")) return "broadcaster";
    if (ids.includes("moderator")) return "mod";
    if (ids.includes("vip")) return "vip";
    if (ids.includes("subscriber") || ids.includes("founder")) return "sub";
    return null;
}

function renderVodFragments(fragments, plainBody) {
    // Nota: los badges de la API de comentarios de VODs solo traen el
    // set_id (sin versión), así que no alcanza para armar la imagen real
    // del badge (ver api/vod-comments.js) — por eso la repetición de VOD
    // sigue usando el badge de texto (roleBadgeFromV5Badges). Los emotes
    // de 7TV del canal SÍ se pueden aplicar igual que en el chat en vivo.
    if (!fragments || !fragments.length) return renderTextWith7tv(plainBody || "");
    return fragments.map(f => {
        if (f.emoticon && f.emoticon.emoticon_id) {
            return `<img class="chat-emote" src="https://static-cdn.jtvnw.net/emoticons/v2/${f.emoticon.emoticon_id}/default/dark/2.0" alt="">`;
        }
        return renderTextWith7tv(f.text || "");
    }).join("");
}

function stopVodChatReplay() {
    vodChatToken++; // invalida cualquier carga en curso de la repetición anterior
    vodChatComments = [];
    vodChatPlayedIndex = 0;
    vodChatNextCursor = null;
    vodChatLoading = false;
    vodChatEnded = false;
}

async function startVodChatReplay(videoId, startOffsetSeconds) {
    stopVodChatReplay();
    const myToken = vodChatToken;
    chatMessages = [];
    renderChatMessages();
    appendSystemMessage("Cargando repetición del chat…");
    await loadVodChatFrom(videoId, startOffsetSeconds || 0, myToken);
    if (myToken !== vodChatToken) return; // el usuario ya cambió de video
    // Saca el aviso de "cargando" inicial si ya hay mensajes reales.
    if (vodChatComments.length) chatMessages = chatMessages.filter(m => !m.system);
    renderChatMessages();
}

async function loadVodChatFrom(videoId, offsetSeconds, myToken) {
    vodChatLoading = true;
    try {
        // Ver api/vod-comments.js: pedimos SIEMPRE a través de nuestro propio
        // proxy, nunca directo a api.twitch.tv/v5/... desde el navegador,
        // porque esa API no manda cabeceras CORS para sitios de terceros y
        // el fetch directo fallaba siempre (era la causa real del error
        // "No se pudo cargar la repetición del chat").
        let url = `${API_BASE}/api/vod-comments?videoId=${encodeURIComponent(videoId)}&offset=${Math.max(0, Math.floor(offsetSeconds))}`;
        let cursor = null;
        let fetchedAny = false;
        let hadError = false;
        // Trae varias páginas seguidas hasta juntar ~2 minutos de adelanto
        // sobre el punto pedido, para no golpear la API en cada tick del
        // reproductor. Tope de páginas por llamada como salvaguarda.
        for (let i = 0; i < 6; i++) {
            const res = await fetch(url, { cache: "no-store" });
            if (myToken !== vodChatToken) return; // se canceló (cambio de video)
            if (!res.ok) { hadError = true; vodChatEnded = true; break; }
            const data = await res.json();
            if (data.error) { hadError = true; vodChatEnded = true; break; }
            fetchedAny = true;
            (data.comments || []).forEach(c => {
                vodChatComments.push({
                    offset: c.content_offset_seconds || 0,
                    name: c.commenter?.display_name || c.commenter?.name || "usuario",
                    color: c.message?.user_color || "#9146FF",
                    roleBadge: roleBadgeFromV5Badges(c.message?.user_badges),
                    // No se arma el HTML acá: los comentarios de VOD suelen
                    // llegar ANTES de que terminen de cargar los emotes de
                    // 7TV del canal (loadChatCosmetics corre en paralelo y
                    // necesita 2 pedidos de red). Si se horneaba el HTML en
                    // este momento, esos mensajes quedaban con el texto
                    // plano para siempre aunque los emotes llegaran después.
                    // Guardamos los datos crudos y armamos el HTML recién al
                    // pintar (ver renderChatMessages), igual que ya se hace
                    // con los mensajes del chat en vivo.
                    fragments: c.message?.fragments,
                    plainBody: c.message?.body
                });
            });
            cursor = data._next || null;
            const lastOffset = vodChatComments.length ? vodChatComments[vodChatComments.length - 1].offset : offsetSeconds;
            if (!cursor) { vodChatEnded = true; break; }
            if (lastOffset - offsetSeconds > 120) break; // ya tenemos suficiente margen
            url = `${API_BASE}/api/vod-comments?videoId=${encodeURIComponent(videoId)}&cursor=${encodeURIComponent(cursor)}`;
        }
        vodChatComments.sort((a, b) => a.offset - b.offset);
        vodChatNextCursor = cursor;
        if (!fetchedAny && hadError && myToken === vodChatToken && !vodChatComments.length) {
            appendSystemMessage("Este video no tiene chat guardado o Twitch no permite verlo desde acá.");
        }
    } catch (e) {
        console.warn("No se pudo cargar la repetición del chat:", e);
        if (myToken === vodChatToken && !vodChatComments.length) appendSystemMessage("No se pudo cargar la repetición del chat.");
        vodChatEnded = true;
    } finally {
        vodChatLoading = false;
    }
}

function appendVodChatMessage(comment) {
    const msg = {
        name: comment.name,
        color: comment.color,
        roleBadge: comment.roleBadge,
        fragments: comment.fragments,
        plainBody: comment.plainBody,
        ts: Date.now()
    };
    chatMessages.push(msg);
    if (chatMessages.length > MAX_CHAT_MESSAGES) chatMessages.shift();
    appendChatMessageDom(msg, true);
}

// Se llama en cada tick del progreso del VOD (ver updateProgressUI) para
// ir "soltando" los mensajes de chat a medida que el video los alcanza.
function syncVodChatWithPlayback() {
    if (!twitchPlayer || playbackType !== "vod" || !currentVideoId) return;
    const myToken = vodChatToken;
    let current = 0;
    try { current = twitchPlayer.getCurrentTime() || 0; } catch (e) { return; }

    // Si el usuario saltó bastante hacia adelante o atrás (rebobinar,
    // arrastrar la barra), el buffer ya no sirve: se reconstruye desde ahí.
    const nextPending = vodChatComments[vodChatPlayedIndex];
    const lastShown = vodChatPlayedIndex > 0 ? vodChatComments[vodChatPlayedIndex - 1].offset : null;
    const jumped =
        (nextPending && current + 20 < nextPending.offset) ||
        (lastShown !== null && current < lastShown - 20);
    if (jumped) {
        chatMessages = [];
        vodChatComments = [];
        vodChatPlayedIndex = 0;
        vodChatEnded = false;
        renderChatMessages();
        loadVodChatFrom(currentVideoId, current, myToken);
        return;
    }

    let shown = false;
    while (vodChatPlayedIndex < vodChatComments.length && vodChatComments[vodChatPlayedIndex].offset <= current) {
        appendVodChatMessage(vodChatComments[vodChatPlayedIndex]);
        vodChatPlayedIndex++;
        shown = true;
    }
    if (shown) return;

    // Sin mensajes nuevos que mostrar: si el buffer se está por acabar,
    // pide la siguiente tanda por adelantado.
    const lastBuffered = vodChatComments.length ? vodChatComments[vodChatComments.length - 1].offset : current;
    if (!vodChatLoading && !vodChatEnded && lastBuffered - current < 30) {
        loadVodChatFrom(currentVideoId, lastBuffered + 1, myToken);
    }
}

let chatLayoutIndex = 0;
// Orden fijo: los 3 tamaños a la DERECHA y luego los 3 tamaños a la IZQUIERDA.
// La secuencia siempre vuelve a empezar por grande derecha.
const CHAT_LAYOUTS = [
    { cls: "chat-large",             label: "Chat grande derecha" },
    { cls: "chat-medium",            label: "Chat mediano derecha" },
    { cls: "chat-small",             label: "Chat pequeño derecha" },
    { cls: "chat-large chat-left",   label: "Chat grande izquierda" },
    { cls: "chat-medium chat-left",  label: "Chat mediano izquierda" },
    { cls: "chat-small chat-left",   label: "Chat pequeño izquierda" }
];

function applyChatLayout() {
    const panel = document.getElementById("chat-panel");
    panel.classList.remove("chat-large", "chat-medium", "chat-small", "chat-left");
    panel.classList.add(...CHAT_LAYOUTS[chatLayoutIndex].cls.split(" "));
    const btn = document.getElementById("ctrl-chat-layout");
    if (btn) btn.title = CHAT_LAYOUTS[chatLayoutIndex].label;
}

function cycleChatLayout() {
    chatLayoutIndex = (chatLayoutIndex + 1) % CHAT_LAYOUTS.length;
    applyChatLayout();

    // Garantiza que el nuevo tamaño sea visible incluso después de que
    // el chat haya cambiado de posición.
    const panel = document.getElementById("chat-panel");
    if (panel) {
        panel.style.width = "";
        panel.style.height = "";
        panel.style.right = "";
        panel.style.left = "";
        panel.offsetWidth;
        // No forzar un ancho fijo aquí: el CSS ya define el ancho del
        // composer con var(--chat-current-width) y lo limita en pantallas
        // pequeñas (min(..., 88vw)). Fijarlo por JS pisaba ese límite
        // responsive y provocaba que el chat se desbordara al cambiar
        // de tamaño/posición.
        const composer = document.getElementById("chat-composer");
        if (composer) composer.style.width = "";
    }
}

function setupChatUI() {
    applyChatLayout();
}

// ---- Compositor de mensaje ----
function openChatComposer() {
    const area = document.getElementById("player-area");
    if (!area || document.getElementById("chat-composer")) return;
    const wrap = document.createElement("div");
    wrap.id = "chat-composer";
    wrap.innerHTML = '<div class="chat-composer-card" role="dialog" aria-label="Enviar mensaje al chat"><input id="chat-composer-input" type="text" maxlength="500" placeholder="Chatea" autocomplete="off"><div class="chat-composer-hint">OK: enviar · Atrás: cancelar</div></div>';
    area.appendChild(wrap);
    const chat = document.getElementById("chat-panel");
    if (chat && wrap) wrap.style.width = `${Math.round(chat.getBoundingClientRect().width)}px`;
    const input = document.getElementById("chat-composer-input");
    input.focus();
    const finish = () => {
        const text = input.value.trim();
        if (text) {
            if (twitchUser && chatSocket && chatSocket.readyState === WebSocket.OPEN && currentChannelLogin) {
                chatSocket.send(`PRIVMSG #${currentChannelLogin.toLowerCase()} :${text}`);
                // Twitch no nos devuelve nuestro propio PRIVMSG por esta
                // conexión, así que lo pintamos nosotros mismos al toque.
                appendChatMessage({
                    tags: { "display-name": twitchUser.display_name || twitchUser.login, color: "#9146FF" },
                    text
                });
            } else if (twitchUser) {
                appendSystemMessage("No se pudo enviar: el chat no está conectado en este momento.");
            } else {
                appendSystemMessage("Para enviar mensajes al chat necesitas iniciar sesión con Twitch.");
            }
        }
        closeChatComposer();
    };
    input.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); finish(); }
        else if (e.key === "Escape") { e.preventDefault(); closeChatComposer(); }
    });
}
function closeChatComposer() { document.getElementById("chat-composer")?.remove(); window.focus(); }

function restoreMainFocus(preferredIndex = 0) {
    const max = NAV_ITEMS.length - 1;
    const idx = Math.max(0, Math.min(Number.isFinite(preferredIndex) ? preferredIndex : 0, max));
    setFocus("nav", idx);
    const navEl = document.querySelector(`#nav-list li[data-index="${idx}"]`);
    navEl?.focus();
    setTimeout(() => { navEl?.focus({preventScroll:true}); }, 30);
}

// ============================================================
// Botón "Inicio" — visible en toda pantalla, vuelve directo al
// home sin importar en qué pantalla estés.
// ============================================================
function goHome() {
    if (window.clearFocusBackground) window.clearFocusBackground();
    if (profileChatOpen) closeProfileChat();
    if (currentScreen === "player") destroyPlayer();
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById("main-screen").classList.add("active");
    currentScreen = "main";
    restoreMainFocus(1);
}

// ============================================================
// Navegación "atrás"
// ============================================================
function goBack() {
    if (currentScreen === "player") {
        playerInfoReturn = false;
        destroyPlayer();
        document.getElementById("player-screen").classList.remove("active");
        const previous = playerReturnScreen || "main";
        const previousMap = { main: "main-screen", search: "search-screen", results: "results-screen", game: "game-screen" };
        const targetId = previousMap[previous] || "main-screen";
        document.getElementById(targetId).classList.add("active");
        currentScreen = previous;
        if (previous === "results") {
            resultsContentSection = "vods";
            resultsFocusZone = playerReturnResultsFocusZone || "grid";
            gridFocusIndex = Math.max(0, playerReturnGridFocusIndex);
            const tiles = Array.from(document.querySelectorAll("#results-grid .tile-stream"));
            document.querySelectorAll("#results-grid .tile-stream.focused, #clips-grid .tile-clip.focused")
                .forEach(t => t.classList.remove("focused"));
            if (resultsFocusZone === "watch" && focusResultsAction(resultsActionFocus)) {
                // el foco ya quedó en el botón correspondiente
            } else if (tiles[gridFocusIndex]) {
                tiles[gridFocusIndex].focus({preventScroll:true});
                tiles[gridFocusIndex].classList.add("focused");
                tiles[gridFocusIndex].scrollIntoView({behavior:"smooth", inline:"center", block:"nearest"});
            }
        } else if (previous === "game") {
            focusGrid("game-screen-grid");
            gridFocusIndex = Math.max(0, playerReturnGridFocusIndex);
            const tiles = Array.from(document.querySelectorAll("#game-screen-grid .tile-stream, #game-screen-grid .tile-game, #game-screen-grid .tile-vod"));
            tiles.forEach(t => t.classList.remove("focused"));
            if (tiles[gridFocusIndex]) tiles[gridFocusIndex].classList.add("focused");
        } else if (previous === "search") {
            document.getElementById("search-input")?.focus();
        } else {
            restoreHomeFocusAfterReturn();
        }

    } else if (currentScreen === "search") {
        document.getElementById("search-screen").classList.remove("active");
        document.getElementById("main-screen").classList.add("active");
        currentScreen = "main";
        closeHomeSearch();

    } else if ((currentScreen === "game" || currentScreen === "results") && playerInfoReturn && twitchPlayer && playerInfoReturnScreen === "player") {
        // El usuario llegó aquí desde la información del reproductor.
        // Conservamos el player vivo y regresamos exactamente a él, sin pasar por Inicio.
        if (profileChatOpen) closeProfileChat();
        const chatPanelBack = document.getElementById("chat-panel");
        const playerAreaBack = document.getElementById("player-area");
        if (chatPanelBack && playerAreaBack && chatPanelBack.parentElement !== playerAreaBack) {
            playerAreaBack.appendChild(chatPanelBack);
            chatPanelBack.classList.remove("hidden-chat");
            connectChat(currentChannelLogin);
        }
        document.getElementById(currentScreen === "game" ? "game-screen" : "results-screen").classList.remove("active");
        document.getElementById("player-screen").classList.add("active");
        currentScreen = "player";
        playerInfoReturn = false;
        playerInfoReturnScreen = "player";
        showControls();
        const navItems = getPlayerNavigationItems();
        if (navItems.length) {
            const idx = Math.min(navItems.length - 1, Math.max(0, getCurrentPlayerNavigationIndex()));
            focusPlayerNavigationIndex(idx);
        }
        setTimeout(() => window.focus(), 0);
    } else if (currentScreen === "game" || currentScreen === "results") {
        if (profileChatOpen) closeProfileChat();
        const wasGame = currentScreen === "game";
        document.getElementById(wasGame ? "game-screen" : "results-screen").classList.remove("active");
        document.getElementById("main-screen").classList.add("active");
        currentScreen = "main";
        if (wasGame) {
            restoreMainFocus(navIndexForRow("topGames"));
        } else {
            restoreHomeFocusAfterReturn();
        }

    } else if (currentScreen === "main") {
        // Restablece la navegación de la pantalla principal: el foco vuelve
        // siempre a la primera tarjeta de "Canales seguidos", dejando
        // arriba/abajo/izquierda/derecha funcionando de forma predecible
        // desde ese punto de partida.
        focusFirstAvailableRow("seguidosChannels");
    }
}

