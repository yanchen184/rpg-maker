import { defineConfig } from 'vite';

// 素材庫在 repo root 的 assets/(跨遊戲共用);base 用相對路徑,dev 與掛子路徑部署都通
export default defineConfig({
  publicDir: '../../assets',
  base: './',
  server: { port: 5174 },
});
