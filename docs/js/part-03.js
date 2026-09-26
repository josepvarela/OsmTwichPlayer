
(function(){
  const screen = document.getElementById('main-screen');
  const sidebar = document.getElementById('sidebar');
  if (!screen || !sidebar) return;

  function setSidebarState(active) {
    screen.classList.toggle('sidebar-active', active);
    screen.classList.toggle('sidebar-collapsed', !active);
    try { localStorage.setItem('sidebarCollapsed', active ? '0' : '1'); } catch(e) {}
  }

  // Mantenerla abierta al entrar y cerrarla al pasar el foco a contenido.
  setSidebarState(true);

  document.addEventListener('focusin', function(e) {
    if (!screen.contains(e.target)) return;
    if (e.target.closest('#sidebar')) {
      setSidebarState(true);
    } else if (e.target.closest('#content, .tile-stream, .tile-game, .tile-clip')) {
      setSidebarState(false);
    }
  });

  document.addEventListener('pointerdown', function(e) {
    if (!screen.contains(e.target)) return;
    if (e.target.closest('#sidebar')) {
      setSidebarState(true);
    } else if (e.target.closest('#content, .tile-stream, .tile-game, .tile-clip')) {
      setSidebarState(false);
    }
  });

  // Al volver a Inicio, mostrar la barra para recuperar la navegación.
  window.addEventListener('popstate', function(){ setSidebarState(true); });
})();
