# rpg-maker 專案規則

- 本專案狀態頁在 `https://html.yanchen.app/rpg-maker/`。之後有實質更新(功能完成、驗收狀態變、進度推進)要回去更新該頁再用 `/html-deploy` 推一次(對外狀態有變才推,不是每次 commit 都推)。
- 本 repo 是 npm workspaces monorepo:引擎在 `packages/engine/`(`@rpg-maker/engine`,直接供 TS 源碼)、素材管線在 `packages/asset-pipeline/tools/`、遊戲本體在 `apps/escape-room/`、共用素材庫在 repo 根 `assets/`。改引擎行為先想「這是引擎通用還是遊戲語意」——遊戲語意(如互動鍵分派)放 apps 層。
- 素材生成走 `tools/gen-queue.sh`(相容 wrapper,本體在 `packages/asset-pipeline/tools/gen-queue.sh`,吃 `RPG_PROJECT_ROOT` 或 cwd;codex CLI 單一序列 queue);codex `-i` 參考圖必須用 `--image=<file>` 單 token 寫法,`-i <file> <prompt>` 會把 prompt 吃掉當檔名。
- 髮色/衣色 overlay 不要用生圖模型畫(對齊不可控,已兩敗),用 `packages/asset-pipeline/tools/make-hair-overlay.py` 程式化換色。
