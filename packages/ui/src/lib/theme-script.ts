// Server-safe: no React imports, so layouts can inline this before hydration.
export const THEME_STORAGE_KEY = "agentic-hub.theme";

/**
 * Inline script for <head> that applies the stored theme before first paint,
 * avoiding a flash on load. Dark is the default when nothing is stored.
 */
export const themeBootstrapScript = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})||'"system"');var r=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.dataset.theme=r;}catch(e){document.documentElement.dataset.theme="dark";}})();`;
