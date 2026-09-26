

// v45: fondo de la miniatura de la tarjeta actualmente enfocada.
(function(){
    const BG_ID = "focus-background";

    function bgEl() {
        return document.getElementById(BG_ID);
    }

    function getThumb(card) {
        if (!card) return "";
        const img = card.querySelector("img");
        return img ? (img.currentSrc || img.src || "") : "";
    }

    function showFocusedCardBackground(card) {
        const bg = bgEl();
        if (!bg) return;
        const src = getThumb(card);
        if (!src) return;

        // En el perfil usamos también el propio fondo de #results-screen.
        // Esto hace que el cambio funcione igual con foco por teclado/mando
        // que con mouse, sin depender del orden de las capas del elemento
        // #focus-background.
        const results = document.getElementById("results-screen");
        const isProfile = results && results.classList.contains("active");
        const safeSrc = src.replace(/"/g, '\\"');
        bg.style.backgroundImage = `url("${safeSrc}")`;
        bg.style.backgroundColor = "#0f0f12";
        bg.classList.add("visible");

        if (isProfile) {
            results.style.backgroundImage = `url("${safeSrc}")`;
            results.style.backgroundSize = "cover";
            results.style.backgroundPosition = "center center";
            results.style.backgroundAttachment = "fixed";
        }
    }

    function hideFocusedCardBackground() {
        const bg = bgEl();
        if (!bg) return;

        // En el perfil, si no hay una tarjeta seleccionada, dejar el fondo
        // completamente neutro. La miniatura solo aparece mientras una
        // tarjeta tenga el foco.
        const results = document.getElementById("results-screen");
        if (results && results.classList.contains("active")) {
            results.style.backgroundImage = "";
            results.style.backgroundSize = "";
            results.style.backgroundPosition = "";
            results.style.backgroundAttachment = "";
        }

        bg.classList.remove("visible");
        bg.style.backgroundImage = "";
        bg.style.backgroundColor = "";
    }

    function findFocusedCard() {
        return document.querySelector(
            ".tile-stream.focused, .tile-game.focused, .tile-clip.focused, " +
            ".search-result-item.focused, .result-card.focused, .channel-card.focused, " +
            ".game-card.focused, .stream-card.focused"
        );
    }

    function bindCards() {
        const cards = document.querySelectorAll(
            ".tile-stream, .tile-game, .tile-clip, .search-result-item, " +
            ".result-card, .channel-card, .game-card, .stream-card"
        );
        cards.forEach(card => {
            if (card.dataset.v45BgBound === "1") return;
            card.dataset.v45BgBound = "1";
            card.addEventListener("mouseenter", () => showFocusedCardBackground(card));
            card.addEventListener("focus", () => showFocusedCardBackground(card), true);
            card.addEventListener("mouseleave", () => {
                if (!card.classList.contains("focused") && document.activeElement !== card) {
                    hideFocusedCardBackground();
                }
            });
            card.addEventListener("blur", () => {
                requestAnimationFrame(() => {
                    const focused = findFocusedCard();
                    if (focused) showFocusedCardBackground(focused);
                    else hideFocusedCardBackground();
                });
            }, true);
        });
        const focused = findFocusedCard();
        if (focused) showFocusedCardBackground(focused);
    }

    // Expuesto para que las funciones de navegación actualicen el fondo inmediatamente.
    window.updateFocusBackground = showFocusedCardBackground;
    window.hideFocusBackground = hideFocusedCardBackground;

    document.addEventListener("DOMContentLoaded", bindCards);
    window.addEventListener("load", bindCards);

    // v65: MutationObserver eliminado.
})();

