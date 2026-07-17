import { defineConfig } from 'vite';

// assets/ 當 publicDir:素材、manifest、場景 JSON 都以根路徑提供(/raw/...、/manifest.json、/scenes/...)
export default defineConfig({
  publicDir: 'assets',
  server: { port: 5173 },
});
