/** What the search box shows before anything is typed; built in the site config. */
export interface SearchStart {
  popular: { text: string; link: string; hint?: string }[];
  api: { text: string; link: string; method?: string; hint?: string }[];
}

const KEY = 'cvsign-docs-recent-searches';
const LIMIT = 5;

/** Recent searches live in this browser only; storage may be blocked, so every access is guarded. */
export function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function rememberSearch(text: string): void {
  const query = text.trim().slice(0, 64);
  if (!query) return;
  try {
    const next = [query, ...readRecent().filter((item) => item !== query)].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage is unavailable (private mode or blocked); search still works without history.
  }
}

export function forgetSearches(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
