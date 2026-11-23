<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { withBase } from 'vitepress';
import { clipFiles, clipSize, playsOnItsOwn } from '../help-clip';

const props = defineProps<{
  /** File stem under `public/clips/`. */
  name: string;
  /** What the clip shows, read out in place of the video and printed under it. */
  caption: string;
  /** A phone-shaped clip, shown narrower. */
  phone?: boolean;
}>();

const files = computed(() => clipFiles(props.name));
const size = computed(() => clipSize(props.phone ?? false));
const root = ref<HTMLElement | null>(null);
const video = ref<HTMLVideoElement | null>(null);
// The video is only put on the page once it is near the screen, so the files load lazily.
const near = ref(false);
const reduced = ref(false);
const playing = ref(false);
let observer: IntersectionObserver | undefined;
let motion: MediaQueryList | undefined;

const syncMotion = () => {
  reduced.value = motion?.matches ?? false;
  if (reduced.value) {
    video.value?.pause();
    playing.value = false;
  }
};

onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  syncMotion();
  motion.addEventListener('change', syncMotion);
  observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      near.value = true;
      observer?.disconnect();
    },
    { rootMargin: '200px 0px' },
  );
  if (root.value) observer.observe(root.value);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  motion?.removeEventListener('change', syncMotion);
});

const autoplay = computed(() => near.value && playsOnItsOwn(reduced.value));

async function play() {
  near.value = true;
  playing.value = true;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await video.value?.play().catch(() => {
    playing.value = false;
  });
}
</script>

<template>
  <figure ref="root" class="help-clip" :class="{ 'help-clip--phone': phone }">
    <div class="help-clip__frame" :style="{ aspectRatio: `${size.width} / ${size.height}` }">
      <video
        v-if="autoplay || playing"
        ref="video"
        class="help-clip__media"
        :width="size.width"
        :height="size.height"
        :poster="withBase(files.poster)"
        :autoplay="autoplay"
        muted
        loop
        playsinline
        preload="metadata"
        :aria-label="caption"
      >
        <source :src="withBase(files.webm)" type="video/webm" />
        <source :src="withBase(files.mp4)" type="video/mp4" />
      </video>
      <img
        v-else
        class="help-clip__media"
        :src="withBase(files.poster)"
        :width="size.width"
        :height="size.height"
        :alt="caption"
        loading="lazy"
        decoding="async"
      />
      <button
        v-if="reduced && !playing"
        type="button"
        class="help-clip__play"
        :aria-label="`Play the clip: ${caption}`"
        @click="play"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
        </svg>
      </button>
    </div>
    <figcaption class="help-clip__caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.help-clip {
  margin: 20px 0 28px;
}
.help-clip--phone {
  max-width: 300px;
}
.help-clip__frame {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  box-shadow: 0 6px 24px rgba(13, 27, 42, 0.08);
}
.help-clip__media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.help-clip__play {
  position: absolute;
  inset: 50% auto auto 50%;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin: -28px 0 0 -28px;
  border-radius: 50%;
  background: var(--cv-navy);
  color: #fff;
  box-shadow: 0 6px 20px rgba(13, 27, 42, 0.3);
  cursor: pointer;
}
.help-clip__play:hover {
  background: var(--cv-blue-dark);
}
.help-clip__play:focus-visible {
  outline: 3px solid var(--cv-teal);
  outline-offset: 3px;
}
.help-clip__caption {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
</style>
