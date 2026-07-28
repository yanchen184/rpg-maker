# rpg-maker 專案規則

- 本專案狀態頁在 `https://html.yanchen.app/rpg-maker/`。之後有實質更新(功能完成、驗收狀態變、進度推進)要回去更新該頁再用 `/html-deploy` 推一次(對外狀態有變才推,不是每次 commit 都推)。
- 本 repo 是 npm workspaces monorepo:引擎在 `packages/engine/`(`@rpg-maker/engine`,直接供 TS 源碼)、素材管線在 `packages/asset-pipeline/tools/`、遊戲本體在 `apps/escape-room/`、共用素材庫在 repo 根 `assets/`。改引擎行為先想「這是引擎通用還是遊戲語意」——遊戲語意(如互動鍵分派)放 apps 層。
- 素材生成走 `tools/gen-queue.sh`(相容 wrapper,本體在 `packages/asset-pipeline/tools/gen-queue.sh`,吃 `RPG_PROJECT_ROOT` 或 cwd;codex CLI 單一序列 queue);codex `-i` 參考圖必須用 `--image=<file>` 單 token 寫法,`-i <file> <prompt>` 會把 prompt 吃掉當檔名。
- 髮色/衣色 overlay 不要用生圖模型畫(對齊不可控,已兩敗),用 `packages/asset-pipeline/tools/make-hair-overlay.py` 程式化換色。

## 部署(兩個獨立站,別搞混)

- **密室逃脫**:`apps/escape-room/` → GitHub Actions(`.github/workflows/deploy.yml`)push master 自動 build 推 gh-pages → `https://yanchen184.github.io/rpg-maker/`。vite base `./`。
- **網球 tennis**:`apps/tennis/` → **Cloudflare Pages 獨立站** → `https://ts.yanchen.app/`。vite base `/`(獨立站根路徑)、多頁 entry(`index.html` 對戰 + `sprite-gallery.html` 展示廊)。**tennis 已不掛 gh-pages 的 /tennis/ 子路徑**,deploy.yml 只 build 密室逃脫。
  - CF Pages build 設定(連 GitHub 自動 build):**Root directory** 留 repo 根(不是 apps/tennis,否則 workspace 依賴 @rpg-maker/engine 解不到);**Build command** `npm ci && npm run build -w tennis`;**Build output directory** `apps/tennis/dist`;**Node version** 22。engine 直供 TS 源碼(`exports: ./src/index.ts`,無 build step),tennis 的 tsc/vite 直接吃。
