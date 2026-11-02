// Light/dark: data-theme on <html> (DESIGN.md rule 5). index.html sets it
// before first paint; this module only switches and remembers it.
export type Theme = 'light' | 'dark';
const KEY = 'stillwater-theme';

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: still switches for this visit */
  }
}
