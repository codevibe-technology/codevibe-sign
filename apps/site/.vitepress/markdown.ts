import type { MarkdownRenderer } from 'vitepress';

const NOTE = ' (opens in a new tab)';

/**
 * Adds a screen reader note to links that leave the site. VitePress already gives them
 * `target="_blank"`; links to the site's own host are kept in the same tab.
 */
export function externalLinks(md: MarkdownRenderer, { siteHost }: { siteHost: string }) {
  md.core.ruler.push('codevibe-external-links', (state) => {
    for (const block of state.tokens) {
      const children = block.children;
      if (!children) continue;
      for (let i = 0; i < children.length; i++) {
        const token = children[i]!;
        if (token.type !== 'link_open') continue;
        const href = token.attrGet('href') ?? '';
        if (!/^https?:\/\//i.test(href)) continue;
        if (new URL(href).hostname === siteHost) continue;
        let depth = 0;
        for (let j = i + 1; j < children.length; j++) {
          const next = children[j]!;
          if (next.type === 'link_open') depth++;
          if (next.type !== 'link_close') continue;
          if (depth-- > 0) continue;
          const note = new state.Token('html_inline', '', 0);
          note.content = `<span class="cv-sr-only">${NOTE}</span>`;
          children.splice(j, 0, note);
          break;
        }
      }
    }
  });
}
