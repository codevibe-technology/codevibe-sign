# Codevibe Sign website

The public website and documentation for Codevibe Sign, built with
[VitePress](https://vitepress.dev). The output is plain static files that any web server or
static host can serve.

## Commands

From the repository root:

```sh
pnpm --filter site dev       # local server with live reload
pnpm --filter site build     # static output in apps/site/.vitepress/dist
pnpm --filter site preview   # serve the built output
```

## Layout

| Path                                               | What it is                                               |
| -------------------------------------------------- | -------------------------------------------------------- |
| `index.md`                                         | The landing page; its sections live in `HomePage.vue`.   |
| `getting-started/`, `concepts/`, `guides/`, `api/` | Documentation pages.                                     |
| `.vitepress/config.ts`                             | Navigation, sidebar, SEO tags, sitemap and `robots.txt`. |
| `.vitepress/site.ts`                               | Site URL, GitHub URL and other constants.                |
| `.vitepress/theme/`                                | Brand colours, fonts and the landing page components.    |
| `public/`                                          | Favicon, logo mark and the OpenGraph image.              |
| `assets/og.svg`                                    | Source of `public/og.png`.                               |

## Domain

The domain is set in one place: `SITE_URL` in `.vitepress/site.ts`. Canonical links,
OpenGraph URLs, `sitemap.xml` and `robots.txt` are generated from it at build time.

## Pages for packages still being built

API pages and guides for packages that are not merged yet start with
`<ComingSoon pkg="..." />` and describe the planned API. When a package lands, replace the
planned sections with its README's API and remove the component.

## OpenGraph image

`public/og.png` (1200 × 630) is rendered from `assets/og.svg`. The lockup in it is paths; the
text uses Space Grotesk and Inter, so render it on a machine that has both installed (open it in
a browser at that size and screenshot it, or convert it with `sharp`) and save it over the PNG.

## Licence

Apache-2.0 © Codevibe
