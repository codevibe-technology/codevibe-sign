const LANGUAGE_KEY = 'cvsign-docs-language';
const NEW_TAB_NOTE = ' (opens in a new tab)';

/** Tab labels that name a language; picking one picks it in every group on the page. */
const LANGUAGE_LABELS = new Set(['curl', 'Node.js', 'Python', 'Go']);

function readLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

function saveLanguage(label: string) {
  try {
    localStorage.setItem(LANGUAGE_KEY, label);
  } catch {
    // Without storage the choice still applies to this page.
  }
}

const labelOf = (input: HTMLInputElement) => input.nextElementSibling?.textContent?.trim() ?? '';

let syncing = false;

/** Selects the tab with this label in every code group that has one. */
export function selectLanguage(label: string, root: ParentNode = document) {
  if (!LANGUAGE_LABELS.has(label)) return;
  syncing = true;
  try {
    for (const input of root.querySelectorAll<HTMLInputElement>('.vp-code-group .tabs input')) {
      if (labelOf(input) === label && !input.checked) input.click();
    }
  } finally {
    syncing = false;
  }
}

export function watchLanguageTabs() {
  document.addEventListener('change', (event) => {
    const input = event.target;
    if (syncing || !(input instanceof HTMLInputElement) || !input.closest('.vp-code-group .tabs')) {
      return;
    }
    const label = labelOf(input);
    if (!LANGUAGE_LABELS.has(label)) return;
    saveLanguage(label);
    // Keep the group the reader clicked in place while the others switch.
    const group = input.closest('.vp-code-group');
    const before = group?.getBoundingClientRect().top ?? 0;
    selectLanguage(label);
    const after = group?.getBoundingClientRect().top ?? 0;
    if (after !== before) window.scrollBy(0, after - before);
  });
}

export function applySavedLanguage() {
  const label = readLanguage();
  if (label) selectLanguage(label);
}

/**
 * Links that leave the site open in a new tab, say so to screen readers, and pass no referrer
 * or window handle. Links on sign.codevibe.in itself stay in the same tab.
 */
export function markExternalLinks(root: ParentNode = document, siteHost = 'sign.codevibe.in') {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let url: URL;
    try {
      url = new URL(link.href, window.location.href);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    const internal = url.host === window.location.host || url.hostname === siteHost;
    if (internal) {
      if (link.target === '_blank' && url.hostname === siteHost) link.removeAttribute('target');
      continue;
    }
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const label = link.getAttribute('aria-label');
    if (label) {
      if (!label.includes('new tab')) link.setAttribute('aria-label', `${label}${NEW_TAB_NOTE}`);
    } else if (!link.querySelector('.cv-sr-only')) {
      const note = document.createElement('span');
      note.className = 'cv-sr-only';
      note.textContent = NEW_TAB_NOTE;
      link.append(note);
    }
  }
}

/** Menus and panels render on demand, so new links are marked as they appear. */
export function watchExternalLinks() {
  let queued = false;
  markExternalLinks();
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      markExternalLinks();
    });
  }).observe(document.body, { childList: true, subtree: true });
}
