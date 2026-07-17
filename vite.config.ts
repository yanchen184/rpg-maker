import { defineConfig } from 'vite';

// assets/ 當 publicDir:素材、manifest、場景 JSON 都以 BASE_URL 根提供(raw/...、manifest.json、scenes/...)
// base 用相對路徑,dev 是 /、GitHub Pages 掛 /rpg-maker/ 子路徑都通(fetch 端一律走 import.meta.env.BASE_URL)
export default defineConfig({
  publicDir: 'assets',
  base: './',
  server: { port: 5173 },
});
