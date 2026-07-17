# rpg-maker 專案規則

- 本專案狀態頁在 `https://html.yanchen.app/rpg-maker/`。之後有實質更新(功能完成、驗收狀態變、進度推進)要回去更新該頁再用 `/html-deploy` 推一次(對外狀態有變才推,不是每次 commit 都推)。
- 素材生成走 `tools/gen-queue.sh`(codex CLI 單一序列 queue);codex `-i` 參考圖必須用 `--image=<file>` 單 token 寫法,`-i <file> <prompt>` 會把 prompt 吃掉當檔名。
- 髮色/衣色 overlay 不要用生圖模型畫(對齊不可控,已兩敗),用 `tools/make-hair-overlay.py` 程式化換色。
