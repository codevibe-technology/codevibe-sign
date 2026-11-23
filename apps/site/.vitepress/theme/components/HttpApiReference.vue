<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useData, withBase } from 'vitepress';

const { isDark } = useData();
const mountPoint = ref<HTMLElement>();

const customCss = `
.scalar-app.light-mode, .scalar-app.dark-mode, .light-mode .scalar-app, .dark-mode .scalar-app {
  --scalar-font: var(--vp-font-family-base);
  --scalar-font-code: var(--vp-font-family-mono);
  --scalar-heading-font: var(--vp-font-family-heading);
  --scalar-color-1: var(--vp-c-text-1);
  --scalar-color-2: var(--vp-c-text-2);
  --scalar-color-3: var(--vp-c-text-3);
  --scalar-color-accent: var(--vp-c-brand-1);
  --scalar-background-1: var(--vp-c-bg);
  --scalar-background-2: var(--vp-c-bg-alt);
  --scalar-background-3: var(--vp-c-bg-soft);
  --scalar-background-accent: var(--vp-c-brand-soft);
  --scalar-border-color: var(--vp-c-divider);
  --scalar-button-1: var(--vp-c-brand-1);
  --scalar-button-1-color: #ffffff;
  --scalar-button-1-hover: var(--vp-c-brand-2);
  --scalar-color-green: #0f766e;
  --scalar-color-blue: var(--cv-blue);
  --scalar-color-orange: #a14d0f;
  --scalar-color-yellow: #855d00;
  --scalar-color-red: #c2410c;
  --scalar-color-purple: #4f46e5;
  --scalar-sidebar-background-1: var(--vp-c-bg-alt);
  --scalar-sidebar-item-active-background: var(--vp-c-brand-soft);
  --scalar-sidebar-color-active: var(--vp-c-brand-1);
  --scalar-custom-header-height: var(--vp-nav-height);
}
.scalar-app .sidebar-search-placeholder {
  color: var(--vp-c-text-2);
}
/* The contact and licence links show only an icon; keep their names for screen readers. */
.scalar-app .icons-only a > span {
  display: inline;
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.dark .scalar-app {
  --scalar-color-green: var(--cv-teal);
  --scalar-color-blue: #6ea3f5;
  --scalar-color-orange: var(--cv-warm);
  --scalar-color-yellow: #facc15;
  --scalar-color-red: #f87171;
  --scalar-color-purple: #a5b4fc;
  --scalar-button-1-color: #0b1622;
}
`;

const configuration = (content: object) => ({
  content,
  theme: 'none',
  customCss,
  layout: 'modern',
  withDefaultFonts: false,
  hideDarkModeToggle: true,
  forceDarkModeState: isDark.value ? 'dark' : 'light',
  hideDownloadButton: false,
  documentDownloadType: 'both',
  defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
  showDeveloperTools: 'never',
  telemetry: false,
  persistAuth: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  metaData: { title: 'HTTP API reference' },
});

/** The reference styles itself from these body classes; keep them in step with the site. */
function applyColorMode(dark: boolean) {
  document.body.classList.toggle('dark-mode', dark);
  document.body.classList.toggle('light-mode', !dark);
}

let reference: { destroy(): void } | undefined;
let unmounted = false;

// The reference and the document are large and need the browser, so they load here, on this
// page only. It runs as its own Vue app with the head manager it expects.
onMounted(async () => {
  applyColorMode(isDark.value);
  const [{ createApiReference }, spec] = await Promise.all([
    import('@scalar/api-reference'),
    import('../../../../../packages/server/openapi.json'),
    import('@scalar/api-reference/style.css'),
  ]);
  if (unmounted || !mountPoint.value) return;
  reference = createApiReference(mountPoint.value, configuration(spec.default) as never);
});
watch(isDark, applyColorMode);
onUnmounted(() => {
  unmounted = true;
  reference?.destroy();
  document.body.classList.remove('dark-mode', 'light-mode');
});

const links = [
  { text: 'How the API works', href: withBase('/http-api') },
  { text: 'Run a local sandbox', href: withBase('/http-api/sandbox') },
];
</script>

<template>
  <div class="http-api">
    <section class="http-api__intro" aria-label="About this reference">
      <p>
        Every route of the server, with a <strong>Test Request</strong> button that calls your own
        server. Set the server URL under <em>Server</em>, then your API key under
        <em>Authentication</em>.
      </p>
      <nav aria-label="API downloads and guides">
        <a v-for="link in links" :key="link.href" :href="link.href">{{ link.text }}</a>
      </nav>
    </section>
    <div ref="mountPoint" class="http-api__reference" />
  </div>
</template>

<style scoped>
.http-api__intro {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 24px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.5;
}

.http-api__intro p {
  margin: 0;
  max-width: 720px;
}

.http-api__intro nav {
  display: flex;
  gap: 16px;
}

.http-api__intro a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  text-decoration: none;
}

.http-api__intro a:hover {
  text-decoration: underline;
}
</style>
