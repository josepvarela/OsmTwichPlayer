
/* v52: Buscar pertenece a #nav-list; no necesita manejadores paralelos. */
(function () {
    const search = document.getElementById("search-nav-item");
    if (!search) return;
    search.addEventListener("focus", () => search.classList.add("focused"));
    search.addEventListener("blur", () => search.classList.remove("focused"));
})();
