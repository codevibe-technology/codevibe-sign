import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import HomePage from './components/HomePage.vue';
import ComingSoon from './components/ComingSoon.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomePage', HomePage);
    app.component('ComingSoon', ComingSoon);
  },
} satisfies Theme;
