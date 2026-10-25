// Keep in sync with themeBootstrapScript in packages/ui/src/lib/theme.tsx.
(function () {
  try {
    var p = JSON.parse(localStorage.getItem("agentic-hub.theme") || '"system"');
    var r = p === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : p;
    document.documentElement.dataset.theme = r;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
