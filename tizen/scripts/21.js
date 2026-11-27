
(function () {
  "use strict";
  /*
   * No alinear cada nueva fila al borde superior. El contenido permanece
   * quieto mientras la tarjeta enfocada esté dentro de una zona segura;
   * solo se desplaza lo mínimo al acercarse al borde del viewport.
   */
  function revealFocusedTile(tile, content) {
    if (!tile || !content || !content.contains(tile)) return;
    var rect = content.getBoundingClientRect();
    var tileRect = tile.getBoundingClientRect();
    var scale = (content.offsetHeight ? rect.height / content.offsetHeight : 1) || 1;
    var safeTop = Math.max(42, Math.min(92, rect.height * 0.075));
    var safeBottom = Math.max(48, Math.min(104, rect.height * 0.09));
    var visibleTop = rect.top + safeTop * scale;
    var visibleBottom = rect.bottom - safeBottom * scale;
    var delta = 0;
    if (tileRect.top < visibleTop) delta = (tileRect.top - visibleTop) / scale;
    else if (tileRect.bottom > visibleBottom) delta = (tileRect.bottom - visibleBottom) / scale;
    if (Math.abs(delta) > 1) {
      var maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
      content.scrollTop = Math.max(0, Math.min(maxScroll, content.scrollTop + delta));
    }
  }
  window.revealTileVertically = function (tile) {
    var content = document.getElementById("content");
    revealFocusedTile(tile, content);
  };
  console.log("[OsmTwich 2.7.4] Seguidos 3x3 y foco con desplazamiento mínimo.");
})();
