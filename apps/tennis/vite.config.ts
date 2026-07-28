import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 素材庫在 repo root 的 assets/(跨遊戲共用)。
// tennis 獨立掛 ts.yanchen.app 根路徑,base 用 '/'(絕對路徑載 assets,不受頁面深度影響)。
// 多頁 entry:對戰主頁 index.html + sprite 展示廊 sprite-gallery.html 都要進 build。
export default defineConfig({
  publicDir: '../../assets',
  base: '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'sprite-gallery.html'),
      },
    },
  },
  server: { port: 5174 },
});
