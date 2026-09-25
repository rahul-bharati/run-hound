// Applies the saved theme before first paint (no flash of the wrong theme). An external file because the CSP
// allows no inline scripts. Mirrors ThemeProvider in src/lib/theme.tsx (same storage key).
(function () {
  var theme = "system";
  try {
    theme = localStorage.getItem("fernway.theme") || "system";
  } catch (e) {}
  var dark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
