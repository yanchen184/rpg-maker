import { defineConfig } from 'vite';

// 素材庫在 repo root 的 assets/(跨遊戲共用):manifest、場景 JSON、sprite sheet 都以 BASE_URL 根提供
// base 用相對路徑,dev 是 /、GitHub Pages 掛 /rpg-maker/ 子路徑都通(fetch 端一律走 setAssetBase 注入的 base)
export default defineConfig({
  publicDir: '../../assets',
  base: './',
  server: { port: 5173 },
});
