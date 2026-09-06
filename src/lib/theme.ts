export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'comms-web-theme';

export function readThemePreference(): ThemePreference {
	if (typeof localStorage === 'undefined') return 'system';
	const value = localStorage.getItem(THEME_STORAGE_KEY);
	return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function systemPrefersDark(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(preference: ThemePreference = readThemePreference()): ResolvedTheme {
	if (preference === 'light' || preference === 'dark') return preference;
	return systemPrefersDark() ? 'dark' : 'light';
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.theme = theme;
	document.documentElement.style.colorScheme = theme;
	document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function persistThemePreference(preference: ThemePreference): void {
	localStorage.setItem(THEME_STORAGE_KEY, preference);
	applyResolvedTheme(resolveTheme(preference));
}

/** Flip between light and dark (leaves system mode once the user toggles). */
export function toggleResolvedTheme(): ResolvedTheme {
	const next: ResolvedTheme = resolveTheme() === 'dark' ? 'light' : 'dark';
	persistThemePreference(next);
	return next;
}
