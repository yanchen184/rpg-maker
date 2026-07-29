import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 素材庫在 repo root 的 assets/(跨遊戲共用)。
// tennis 獨立掛 ts.yanchen.app 根路徑,base 用 '/'(絕對路徑載 assets,不受頁面深度影響)。
// 多頁 entry:對戰主頁 index.html + sprite 展示廊 sprite-gallery.html 都要進 build。
//
// iOS(Capacitor)例外:App 內是從本地檔案系統載入(capacitor:// scheme),
// '/' 會被解成「裝置根目錄」而不是 App 的 web 根,素材全部 404 —— 所以打 iOS 包時
// 用 CAP_BUILD=1 切成相對路徑 './'。web 版不帶這個變數,行為完全不變。
export default defineConfig({
  publicDir: '../../assets',
  base: process.env.CAP_BUILD ? './' : '/',
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
