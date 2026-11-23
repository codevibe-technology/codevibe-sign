import DefaultTheme from 'vitepress/theme';
import { useRoute, type Theme } from 'vitepress';
import { nextTick, onMounted, watch } from 'vue';
import HomePage from './components/HomePage.vue';
import ComingSoon from './components/ComingSoon.vue';
import ApiTryIt from './components/ApiTryIt.vue';
import { applySavedLanguage, watchExternalLinks, watchLanguageTabs } from './enhance';
import './style.css';
import './api.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomePage', HomePage);
    app.component('ComingSoon', ComingSoon);
    app.component('ApiTryIt', ApiTryIt);
  },
  setup() {
    const route = useRoute();
    onMounted(() => {
      watchLanguageTabs();
      watchExternalLinks();
      applySavedLanguage();
    });
    watch(
      () => route.path,
      () => nextTick(applySavedLanguage),
    );
  },
} satisfies Theme;
