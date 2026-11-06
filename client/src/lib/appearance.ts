const STORAGE_KEY = 'sv-dispatch-settings-v1';

export type AppearancePrefs = {
  themeMode?: 'dark' | 'light';
  primaryColor?: string;
  fontSize?: string;
  layoutWidth?: string;
  sidebarStyle?: string;
};

export function readAppearancePrefs(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AppearancePrefs;
  } catch {
    return {};
  }
}

/** Applies theme / font / primary color from settings (server or local cache). */
export function applyAppearancePrefs(prefs: AppearancePrefs) {
  const root = document.documentElement;
  const theme = prefs.themeMode === 'light' ? 'light' : 'dark';
  const font = (prefs.fontSize || 'Medium').toLowerCase();
  root.dataset.theme = theme;
  root.dataset.fontSize = font;
  root.dataset.layoutWidth = prefs.layoutWidth === 'Contained' ? 'contained' : 'full';
  root.dataset.sidebar = (prefs.sidebarStyle || 'Compact').toLowerCase();
  if (prefs.primaryColor) root.style.setProperty('--ops-primary', prefs.primaryColor);
  root.classList.toggle('theme-light', theme === 'light');
}

export function applyStoredAppearance() {
  applyAppearancePrefs(readAppearancePrefs());
}
