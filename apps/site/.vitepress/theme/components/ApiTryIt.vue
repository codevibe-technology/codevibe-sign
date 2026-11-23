<script setup lang="ts">
import { computed, nextTick, reactive, ref, shallowRef, useId } from 'vue';
import { withBase } from 'vitepress';
import type { TryItModel, TryItResult } from '../../api/tryit';

const props = defineProps<{ operation: string }>();

type Mode = 'mock' | 'sandbox';
type TryIt = typeof import('../../api/tryit');

const id = useId();
const open = ref(false);
const loading = ref(false);
const sending = ref(false);
const mode = ref<Mode>('mock');
const model = shallowRef<TryItModel>();
const api = shallowRef<TryIt>();
const result = shallowRef<TryItResult>();
const failure = ref('');
const copied = ref(false);
const firstInput = ref<HTMLElement>();
const pageHost = ref('');

const input = reactive({
  path: {} as Record<string, string>,
  query: {} as Record<string, string>,
  body: '',
  baseUrl: 'http://localhost:3000',
  apiKey: '',
});

const sandboxReady = computed(() => api.value?.sandboxAvailable(pageHost.value) ?? false);
const canSend = computed(() => mode.value === 'mock' || sandboxReady.value);
const statusTone = computed(() => {
  const status = result.value?.status ?? 0;
  if (status >= 200 && status < 400) return 'ok';
  return status ? 'error' : 'none';
});
const requestLine = computed(() =>
  model.value && api.value
    ? `${model.value.method} ${api.value.requestPath(model.value, input)}`
    : '',
);

async function toggle() {
  open.value = !open.value;
  if (!open.value || model.value) return;
  loading.value = true;
  try {
    const loaded = await import('../../api/tryit');
    const found = loaded.modelFor(props.operation);
    api.value = loaded;
    model.value = found;
    pageHost.value = window.location.hostname;
    if (found) {
      for (const p of found.pathParams) input.path[p.name] = p.example;
      for (const p of found.queryParams) input.query[p.name] = p.example;
      input.body = found.body ?? '';
      if (loaded.sandboxAvailable(window.location.hostname)) {
        input.baseUrl = window.location.origin;
      }
    }
  } catch {
    failure.value = 'The request form could not load. Reload the page and try again.';
  } finally {
    loading.value = false;
  }
  await nextTick();
  firstInput.value?.focus();
}

async function send() {
  if (!model.value || !api.value || !canSend.value || sending.value) return;
  sending.value = true;
  failure.value = '';
  result.value = undefined;
  const started = performance.now();
  try {
    if (mode.value === 'mock') {
      await new Promise((resolve) => setTimeout(resolve, 180));
      result.value = {
        ...api.value.mockResponse(model.value, input),
        ms: Math.round(performance.now() - started),
      };
    } else {
      result.value = await api.value.sandboxResponse(model.value, input, {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        pageHostname: window.location.hostname,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      failure.value = 'The sandbox did not answer within 15 seconds.';
    } else if (error instanceof Error && error.name !== 'TypeError') {
      failure.value = error.message;
    } else {
      failure.value = `No answer from ${input.baseUrl}. Is the sandbox running, and does it allow this origin?`;
    }
  } finally {
    sending.value = false;
  }
}

function onBodyKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void send();
  }
}

async function copyResult() {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.body);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1600);
  } catch {
    copied.value = false;
  }
}

const sandboxGuide = withBase('/http-api/sandbox.html');
</script>

<template>
  <div class="tryit" :class="{ 'tryit--open': open }">
    <button
      type="button"
      class="tryit__toggle"
      :aria-expanded="open"
      :aria-controls="`${id}-panel`"
      @click="toggle"
    >
      <span class="tryit__toggle-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
        </svg>
      </span>
      {{ open ? 'Hide request form' : 'Try it' }}
      <span class="tryit__toggle-hint">mock or local sandbox, never live</span>
    </button>

    <div v-if="open" :id="`${id}-panel`" class="tryit__panel">
      <p v-if="loading" class="tryit__note">Loading the request form...</p>
      <p v-else-if="!model" class="tryit__note" role="alert">
        {{ failure || 'This route has no request form.' }}
      </p>
      <form v-else class="tryit__form" @submit.prevent="send">
        <fieldset class="tryit__modes">
          <legend class="tryit__label">Answer from</legend>
          <label class="tryit__mode">
            <input v-model="mode" type="radio" value="mock" :name="`${id}-mode`" />
            <span>Mock</span>
          </label>
          <label class="tryit__mode">
            <input v-model="mode" type="radio" value="sandbox" :name="`${id}-mode`" />
            <span>Local sandbox</span>
          </label>
        </fieldset>

        <p v-if="mode === 'mock'" class="tryit__note">
          Answered in your browser from the API description. Nothing leaves this page, and no key is
          needed.
        </p>
        <template v-else>
          <p v-if="!sandboxReady" class="tryit__note tryit__note--warn">
            This public page never sends requests to a server. Run the docs and a sandbox on your
            machine to call it from here, or copy the curl example.
            <a :href="sandboxGuide">Set up a local sandbox</a>
          </p>
          <template v-else>
            <p class="tryit__note">
              Calls a server on this machine. The key stays in this form and is never saved.
            </p>
            <label class="tryit__field">
              <span class="tryit__label">Sandbox URL</span>
              <input
                v-model="input.baseUrl"
                type="url"
                inputmode="url"
                spellcheck="false"
                autocomplete="off"
              />
            </label>
            <label v-if="model.needsKey" class="tryit__field">
              <span class="tryit__label">Sandbox API key</span>
              <input
                v-model="input.apiKey"
                type="password"
                spellcheck="false"
                autocomplete="off"
                placeholder="Printed when the sandbox starts"
              />
            </label>
          </template>
        </template>

        <div v-if="model.pathParams.length" class="tryit__group">
          <span class="tryit__label">Path</span>
          <label v-for="(p, index) in model.pathParams" :key="p.name" class="tryit__field">
            <code class="tryit__name">{{ p.name }}</code>
            <input
              :ref="index === 0 ? (el) => (firstInput = el as HTMLElement) : undefined"
              v-model="input.path[p.name]"
              type="text"
              spellcheck="false"
              autocomplete="off"
            />
          </label>
        </div>

        <div v-if="model.queryParams.length" class="tryit__group">
          <span class="tryit__label">Query</span>
          <label v-for="p in model.queryParams" :key="p.name" class="tryit__field">
            <code class="tryit__name">{{ p.name }}</code>
            <input
              v-model="input.query[p.name]"
              type="text"
              spellcheck="false"
              autocomplete="off"
              :placeholder="p.required ? 'required' : 'optional'"
            />
          </label>
        </div>

        <label v-if="model.body !== undefined" class="tryit__field tryit__field--body">
          <span class="tryit__label">Body <span class="tryit__muted">JSON</span></span>
          <textarea
            :ref="model.pathParams.length ? undefined : (el) => (firstInput = el as HTMLElement)"
            v-model="input.body"
            rows="10"
            spellcheck="false"
            autocomplete="off"
            @keydown="onBodyKeydown"
          />
        </label>

        <div class="tryit__actions">
          <code class="tryit__line">{{ requestLine }}</code>
          <button type="submit" class="tryit__send" :disabled="!canSend || sending">
            {{ sending ? 'Sending...' : mode === 'mock' ? 'Run mock request' : 'Send to sandbox' }}
          </button>
        </div>

        <div class="tryit__result" aria-live="polite">
          <p v-if="failure" class="tryit__note tryit__note--error" role="alert">{{ failure }}</p>
          <template v-if="result">
            <div class="tryit__status">
              <span class="tryit__pill" :data-tone="statusTone">
                {{ result.status }} {{ result.statusText }}
              </span>
              <span class="tryit__muted">
                {{ result.mock ? 'Mock answer' : 'From your sandbox' }} · {{ result.ms }} ms
              </span>
              <button type="button" class="tryit__copy" @click="copyResult">
                {{ copied ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <pre
              class="tryit__body"
              tabindex="0"
              aria-label="Response body"
            ><code>{{ result.body || '(empty body)' }}</code></pre>
          </template>
        </div>
      </form>
    </div>
  </div>
</template>
