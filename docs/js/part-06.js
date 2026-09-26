
(function () {
    document.addEventListener("click", function (e) {
        const card = e.target.closest("#clips-grid .tile-clip");
        if (!card) return;

        const id =
            card.dataset.clipId ||
            card.dataset.clipid ||
            card.dataset.id ||
            card.getAttribute("data-clip-id") ||
            card.getAttribute("data-id");

        if (!id) return;

        e.preventDefault();
        e.stopPropagation();

        if (typeof openClip === "function") {
            openClip(id);
            return;
        }
        if (typeof openClipScreen === "function") {
            openClipScreen(id);
            return;
        }
        if (typeof playClip === "function") {
            playClip(id);
            return;
        }

        // Último recurso: si la tarjeta conserva una URL del clip.
        const url = card.dataset.url || card.getAttribute("data-url");
        if (url) window.location.href = url;
    }, true);
})();
