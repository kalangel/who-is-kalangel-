import { defineConfig } from 'vite'

// base: './' — сборка одинаково работает и на GitHub Pages в подпапке
// (kalangel.github.io/who-is-kalangel-/), и позже на своём домене.
// Все ссылки между языковыми страницами — относительные.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    rollupOptions: {
      // Пути относительно root проекта — так не нужен @types/node ради __dirname.
      input: {
        root: 'index.html',
        en: 'en/index.html',
        ru: 'ru/index.html',
        de: 'de/index.html',
      },
    },
  },
})
