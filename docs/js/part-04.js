
(function () {
  const root = document.getElementById("main-screen");
  const search = document.getElementById("search-nav-item");
  if (!root || !search) return;

  function noBlurOnSearch() {
    const active = document.activeElement === search ||
                   search.matches(":hover") ||
                   root.classList.contains("search-active") ||
                   root.classList.contains("search-open");
    if (active) {
      root.classList.remove("sidebar-active");
      root.classList.remove("search-active", "search-open", "searching");
      const content = document.getElementById("content");
      if (content) content.style.filter = "none";
    }
  }

  search.addEventListener("focus", noBlurOnSearch);
  search.addEventListener("click", noBlurOnSearch);
})();
