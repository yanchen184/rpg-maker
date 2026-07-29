import type { CapacitorConfig } from '@capacitor/cli';

/**
 * iOS 打包設定。webDir 吃 vite build 的產物,所以打包前一定要跑 `npm run build:ios -w tennis`
 * (它會帶 CAP_BUILD=1 讓 vite base 切成相對路徑,再 cap sync)。
 *
 * 直接 build 一般 web 版再 sync 會拿到 base='/' 的 index.html,在 App 內素材全 404。
 */
const config: CapacitorConfig = {
  appId: 'app.yanchen.tennis',
  appName: '網球對戰',
  webDir: 'dist',
  ios: {
    // 球場是橫向 canvas,背景給深色才不會在瀏海/安全區露出白邊。
    backgroundColor: '#0d1b2a',
    contentInset: 'never',
  },
};

export default config;
