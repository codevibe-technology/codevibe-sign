<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useData, useRouter, withBase } from 'vitepress';
// The stock modal, imported by its file so the alias that points here does not catch it.
import VPLocalSearchBox from 'vitepress/dist/client/theme-default/components/VPLocalSearchBox.vue';
import { readRecent, rememberSearch, forgetSearches, type SearchStart } from '../search';

const emit = defineEmits<{ (e: 'close'): void }>();

interface Item {
  id: string;
  kind: 'recent' | 'link';
  text: string;
  hint?: string;
  method?: string;
  link?: string;
}

const { theme } = useData();
const router = useRouter();
const start = computed(() => (theme.value.searchStart ?? { popular: [], api: [] }) as SearchStart);

const shell = shallowRef<HTMLElement | null>(null);
const searchInput = shallowRef<HTMLInputElement | null>(null);
const query = ref('');
const recent = ref<string[]>([]);
const active = ref(-1);

const sections = computed(() => {
  const list: { title: string; kind: string; items: Item[] }[] = [];
  if (recent.value.length) {
    list.push({
      title: 'Recent searches',
      kind: 'recent',
      items: recent.value.map((text, i) => ({
        id: `search-start-recent-${i}`,
        kind: 'recent',
        text,
      })),
    });
  }
  list.push({
    title: 'Popular',
    kind: 'popular',
    items: start.value.popular.map((entry, i) => ({
      id: `search-start-popular-${i}`,
      kind: 'link',
      text: entry.text,
      link: entry.link,
      ...(entry.hint ? { hint: entry.hint } : {}),
    })),
  });
  list.push({
    title: 'API reference',
    kind: 'api',
    items: start.value.api.map((entry, i) => ({
      id: `search-start-api-${i}`,
      kind: 'link',
      text: entry.text,
      link: entry.link,
      ...(entry.method ? { method: entry.method } : {}),
      ...(entry.hint ? { hint: entry.hint } : {}),
    })),
  });
  return list;
});

const items = computed(() => sections.value.flatMap((section) => section.items));
const visible = computed(() => shell.value !== null && query.value.trim() === '');

function syncInputAria() {
  const input = searchInput.value;
  if (!input) return;
  if (visible.value) {
    const item = items.value[active.value];
    const section = sections.value.find((s) => s.items.includes(item!));
    if (item && section) {
      input.setAttribute('aria-controls', `search-start-list-${section.kind}`);
      input.setAttribute('aria-activedescendant', item.id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
}

function setQuery(text: string) {
  const input = searchInput.value;
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

function choose(item: Item) {
  if (item.kind === 'recent') {
    setQuery(item.text);
    return;
  }
  if (item.link) {
    router.go(withBase(item.link));
    emit('close');
  }
}

function move(step: number) {
  const count = items.value.length;
  if (!count) return;
  active.value =
    active.value < 0 ? (step > 0 ? 0 : count - 1) : (active.value + step + count) % count;
  syncInputAria();
  void nextTick(() =>
    document.getElementById(items.value[active.value]!.id)?.scrollIntoView({ block: 'nearest' }),
  );
}

/** Runs before the stock handlers: on an empty query the arrows and Enter move through this list. */
function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  const typed = query.value.trim();
  if (!visible.value) {
    if (event.key === 'Enter' && typed) rememberSearch(typed);
    return;
  }
  if (event.target instanceof HTMLButtonElement) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopImmediatePropagation();
    move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter' && active.value >= 0) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const item = items.value[active.value];
    if (item) choose(item);
  }
}

function onInput() {
  query.value = searchInput.value?.value ?? '';
  active.value = -1;
  if (!visible.value) searchInput.value?.removeAttribute('aria-activedescendant');
  syncInputAria();
}

/** A result chosen with the pointer counts as a search worth remembering. */
function onResultClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const typed = query.value.trim();
  if (typed && target?.closest('.VPLocalSearchBox .results a')) rememberSearch(typed);
}

function clearRecent() {
  forgetSearches();
  recent.value = [];
  active.value = -1;
  searchInput.value?.focus();
}

onMounted(async () => {
  await nextTick();
  // The stock modal marks its whole overlay as a button around the search field; it is a dialog.
  const overlay = document.querySelector<HTMLElement>('.VPLocalSearchBox');
  if (overlay) {
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.removeAttribute('aria-expanded');
    overlay.removeAttribute('aria-haspopup');
    // Key hints name their keys with aria-label, which a kbd element may not carry; use text.
    for (const key of overlay.querySelectorAll<HTMLElement>('kbd[aria-label]')) {
      const name = document.createElement('span');
      name.className = 'cv-sr-only';
      name.textContent = key.getAttribute('aria-label') ?? '';
      key.removeAttribute('aria-label');
      key.append(name);
    }
  }
  shell.value = document.querySelector<HTMLElement>('.VPLocalSearchBox .shell');
  searchInput.value = document.querySelector<HTMLInputElement>('#localsearch-input');
  recent.value = readRecent();
  query.value = searchInput.value?.value ?? '';
  searchInput.value?.addEventListener('input', onInput);
  window.addEventListener('keydown', onKeydown, true);
  document.addEventListener('click', onResultClick, true);
  syncInputAria();
});

onBeforeUnmount(() => {
  searchInput.value?.removeEventListener('input', onInput);
  window.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('click', onResultClick, true);
});
</script>

<template>
  <VPLocalSearchBox @close="emit('close')" />
  <Teleport v-if="shell" :to="shell">
    <div v-show="visible" class="search-start">
      <section v-for="section in sections" :key="section.kind" class="search-start__section">
        <div class="search-start__head">
          <h2 :id="`search-start-${section.kind}`" class="search-start__title">
            {{ section.title }}
          </h2>
          <button
            v-if="section.kind === 'recent'"
            type="button"
            class="search-start__clear"
            @click="clearRecent"
          >
            Clear
          </button>
        </div>
        <ul
          :id="`search-start-list-${section.kind}`"
          role="listbox"
          :aria-labelledby="`search-start-${section.kind}`"
          class="search-start__list"
        >
          <li
            v-for="item in section.items"
            :id="item.id"
            :key="item.id"
            role="option"
            :aria-selected="items[active]?.id === item.id"
            class="search-start__item"
            :class="{ 'is-active': items[active]?.id === item.id }"
            @mouseenter="active = items.indexOf(item)"
            @click="choose(item)"
          >
            <span
              v-if="item.kind === 'recent'"
              class="search-start__icon vpi-search"
              aria-hidden="true"
            />
            <span
              v-else-if="item.method"
              class="api-method"
              :data-method="item.method.toLowerCase()"
              >{{ item.method }}</span
            >
            <span v-else class="search-start__icon vpi-arrow-right" aria-hidden="true" />
            <span class="search-start__text">{{ item.text }}</span>
            <span v-if="item.hint" class="search-start__hint">{{ item.hint }}</span>
          </li>
        </ul>
      </section>
      <p class="search-start__tip">
        Search covers guides, endpoints and field names. Try
        <button type="button" class="search-start__example" @click="setQuery('idempotency')">
          idempotency
        </button>
        or
        <button type="button" class="search-start__example" @click="setQuery('expiresInDays')">
          expiresInDays</button
        >.
      </p>
    </div>
  </Teleport>
</template>
