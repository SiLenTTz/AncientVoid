const THEME_KEY = "uacc.theme";

export type Theme = "dark" | "light";

/**
 * T1.6-2: `[data-theme="light"]` has existed in styles.css since P0 but was
 * unreachable — index.html hardcoded `data-theme="dark"` on `<html>` and
 * nothing ever changed it. This is the first real read/write path.
 */
export function getTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}
