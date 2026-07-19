# rpg-maker

RPG Maker 概念的 2D 房間引擎:場景由「獨立模組化素材」以 JSON 資料拼裝而成,每一張素材都是連續幀動畫(沒有靜止圖),角色走紙娃娃分層系統。

![Office room](docs/images/office-room.png)

## 特色

- **場景即資料**:房間定義在 `assets/scenes/office.json`,移動冰箱 / 窗戶 / 桌子 = 改一行 JSON 座標,不用重畫任何圖。
- **全素材動畫化**:地板木紋光影、百葉窗、螢幕代碼捲動、咖啡機蒸氣、盆栽搖曳……每個素材都是 sprite sheet 連續幀(家具 2×2、角色 4×4)。
- **紙娃娃角色**:身體 / 髮型分層疊加,WASD / 方向鍵移動、牆與家具碰撞、站立有呼吸 idle 動畫。髮色由 `tools/make-hair-overlay.py` 從 body sheet 程式化換色生成(blonde / pink / silver),逐像素天生對齊。
- **遊戲內控制面板**(右上角):髮色即時切換(原色 / 金 / 粉 / 銀)+ 場景編輯模式(點家具拖曳、匯出場景 JSON)。
- **y-sort 遮擋**:角色走到桌子後面會被正確遮住;`flat`(地毯)與 `z` 覆寫(檯面小物)另有排序規則。
- **素材管線**:`tools/gen-queue.sh` 走 codex CLI 依 `assets/prompts/*.txt` 生圖、自動去背、落地 `assets/raw/`,單一序列 queue 不吃爆資源。

| 站立(呼吸) | 走路(紙娃娃髮層) |
|---|---|
| ![Idle](docs/images/paper-doll.png) | ![Walk](docs/images/paper-doll-walk.png) |

## 快速開始

```bash
npm install
npm run dev        # http://localhost:5173/         → office 場景 + 可操作角色
                   # http://localhost:5173/#preview → 全素材動畫預覽格
```

操作:WASD / 方向鍵移動。

## 紙娃娃系統:換髮色、加衣服 / 褲子 / 帽子層

角色由多層 `AnimatedSprite` 疊成,每一層 = **walk + idle 兩張 4×4 sprite sheet**(列 = 方向 下/左/右/上,欄 = 該方向 4 幀),所有層與 body sheet 同尺寸、同姿勢,疊起來天生逐像素對齊。

**目前已有的層**:

| 層 | manifest 名稱 | 狀態 |
|---|---|---|
| 身體(必備,含預設衣著) | `char-body-walk` / `char-body-idle` | ✅ |
| 髮色 ×3 | `char-hair-{blonde,pink,silver}-{walk,idle}` | ✅ 遊戲右上角面板即時切換 |
| 衣服 / 褲子 / 帽子 | — | 素材尚未生成,系統已支援(照下面步驟加) |

**runtime 換裝 API**(`src/player.ts`):

```ts
await player.setOverlay(manifest, 'hair', 'char-hair-pink'); // 換該插槽素材
await player.setOverlay(manifest, 'hair', null);             // 拿掉該層
```

插槽名(`'hair'` / `'outfit'` / `'hat'`…)自訂,同插槽再呼叫即為「換裝」。

**加一層新衣物(以外套為例)三步**:

1. **生 sheet**:在 `assets/prompts/` 加 `char-jacket-walk.txt` / `char-jacket-idle.txt`(拿 `char-hair-walk.txt` 當範本;prompt 重點:只畫外套、其餘全透明、與參考圖同姿勢,參考圖餵 body sheet),跑 `tools/gen-queue.sh` 落地 `assets/raw/char-jacket-{walk,idle}_sheet.png`。
2. **註冊 manifest**:`assets/manifest.json` 加兩條 entry(`grid: [4,4]`、fps walk 8 / idle 4、`kind: "character-layer"`)。
3. **掛上角色**:`player.setOverlay(manifest, 'outfit', 'char-jacket')`;要進 UI 面板就照 `src/main.ts` 的 `hairs` 陣列同樣模式加一排按鈕。

> 髮色不要用生圖模型畫 overlay(對齊不可控):`python3 tools/make-hair-overlay.py <body_sheet> <out_sheet> [blonde|pink|silver]` 程式化換色即可。

## 移動 / 新增家具

**移動家具(免寫 code)**:開遊戲 → 右上角「▶ 進入編輯模式」→ 點家具(綠色高亮)拖曳 → 「複製場景 JSON」→ 整份貼回 `assets/scenes/office.json` 存檔,新版面即永久生效。拖曳期間 y-sort 遮擋與碰撞箱即時跟動,角色當場撞得到新位置。

**手改 JSON**:`assets/scenes/office.json` 的 `objects` 每行一件:

```jsonc
{ "asset": "fridge", "x": 1420, "y": 85 }
// 可選欄位:
//   flip: true   → 水平鏡翻
//   scale: 1.2   → 在 manifest 基準縮放上再乘
//   z: 200       → y-sort 覆寫(檯面小物:y 比檯子小、又要畫在檯子上面時用)
```

`x, y` 是素材錨點座標(家具預設錨點 = 底部中心)。再放一台既有家具 = 多加一行;刪掉 = 移除那行。

**新增全新素材種類**(如「飲水機」):

1. `assets/prompts/water-dispenser.txt` 寫生圖 prompt(參考既有家具 txt 的規格:2×2 連續動畫幀、透明背景),跑 `tools/gen-queue.sh` 落地 `assets/raw/water-dispenser_sheet.png`。
2. `assets/manifest.json` 註冊:`sheet`、`grid: [2,2]`、`fps`、`anchor`(落地家具用 `[0.5,1]`)、`scale`、要擋路就加 `collider: { "w": …, "h": … }`(以錨點為中心的 AABB,螢幕像素);地毯類加 `"flat": true`。
3. `office.json` 的 `objects` 加一行擺進房間。

## 架構

- `src/scene.ts` — 讀場景 JSON,鋪地板 / 牆、擺物件、建碰撞箱、y-sort
- `src/player.ts` — 紙娃娃角色(多層 AnimatedSprite 疊加、四向 walk/idle、碰撞滑牆)
- `src/assets.ts` — manifest 載入、sheet 切幀
- `assets/manifest.json` — 素材註冊表(sheet 路徑、格數、fps、錨點、縮放、碰撞箱)
- `assets/scenes/office.json` — 房間定義(尺寸、地板 / 牆素材、物件清單、出生點)

技術棧:PixiJS v8 + Vite + TypeScript。
