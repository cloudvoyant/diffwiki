// Inline no-flash script for <head>. Restores color-mode and theme from
// localStorage before the browser paints the first frame, preventing the
// white-flash-then-dark flicker on hard reload.
//
// Usage in __root.tsx (Phase 3):
//   import { THEME_INIT_SCRIPT } from '@/components/theme-script'
//   // inside createRootRoute head() or the RootLayout <head>:
//   <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
//
// The script must be a plain synchronous JS string — no import/export
// syntax — because it runs as an inline <script> before module evaluation.

export const THEME_INIT_SCRIPT = `try {
  var root = document.documentElement;
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  function applyMode() {
    var mode = localStorage.getItem("diffwiki:color-mode") || "system";
    var dark = mode === "dark" || (mode === "system" && mq.matches);
    root.classList.toggle("dark", dark);
  }
  applyMode();
  // Live-follow the OS while the preference is 'system'.
  mq.addEventListener("change", function() {
    var mode = localStorage.getItem("diffwiki:color-mode") || "system";
    if (mode === "system") applyMode();
  });
  var theme = localStorage.getItem("diffwiki:theme");
  if (theme) {
    var toRemove = [];
    root.classList.forEach(function(cls) {
      if (cls.indexOf("theme-") === 0) toRemove.push(cls);
    });
    for (var i = 0; i < toRemove.length; i++) root.classList.remove(toRemove[i]);
    root.classList.add("theme-" + theme);
  }
} catch (e) { /* localStorage unavailable — non-fatal */ }`;
