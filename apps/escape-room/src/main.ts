import { Application, Container, Text } from 'pixi.js';
import {
  setAssetBase,
  loadManifest,
  loadFrames,
  sheetExists,
  aabbOverlap,
  buildScene,
  loadScene,
  redrawDoors,
  Player,
  SceneEditor,
  type DoorOpening,
  type Aabb,
} from '@rpg-maker/engine';
import { buildUi, type SlotGroup } from './ui';
import { AnimatedSprite } from 'pixi.js';
import { Net } from './net';
import { RemotePlayer } from './remote-player';

// 引擎不綁 Vite:把素材根路徑(dev=/、GitHub Pages=./)注入給引擎的 fetch/Assets.load 用
setAssetBase(import.meta.env.BASE_URL);

async function boot() {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#1a1410',
    antialias: false,
    roundPixels: true,
  });
  document.getElementById('app')!.appendChild(app.canvas);

  const manifest = await loadManifest();
  if (location.hash === '#preview') {
    await previewMode(app, manifest);
  } else {
    await sceneMode(app, manifest);
  }
  hideLoading();
}

/** 首屏載入畫面(index.html 的 #loading):場景與角色都 build 完後淡出移除 */
function hideLoading() {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('hide');
  // 等 CSS transition(.45s)跑完再從 DOM 拔掉,避免蓋住 canvas 互動
  window.setTimeout(() => el.remove(), 500);
}

/** 素材預覽:所有已生好的素材排格子、播動畫 */
async function previewMode(app: Application, manifest: Awaited<ReturnType<typeof loadManifest>>) {
  const grid = new Container();
  app.stage.addChild(grid);
  // 依素材數自動縮格子,全部塞進一屏(canvas 不捲動)
  const count = Object.keys(manifest.assets).length;
  const cols = Math.max(1, Math.ceil(Math.sqrt((count * app.screen.width) / app.screen.height)));
  const rows = Math.ceil(count / cols);
  const cell = Math.min(
    Math.floor(app.screen.width / cols),
    Math.floor(app.screen.height / rows),
  );
  let i = 0;
  for (const [name, def] of Object.entries(manifest.assets)) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * cell + cell / 2;
    const cy = row * cell + cell / 2;
    const label = new Text({
      text: name,
      style: { fill: 0xd8c8a8, fontSize: 13, fontFamily: 'monospace' },
    });
    label.anchor.set(0.5, 0);
    label.x = cx;
    label.y = cy + cell / 2 - 24;
    grid.addChild(label);
    if (await sheetExists(def)) {
      const frames = await loadFrames(name, def);
      const sp = new AnimatedSprite(frames);
      sp.animationSpeed = def.fps / 60;
      sp.play();
      sp.anchor.set(0.5);
      const fit = (cell - 48) / Math.max(sp.width, sp.height);
      sp.scale.set(fit);
      sp.x = cx;
      sp.y = cy - 10;
      grid.addChild(sp);
    } else {
      label.text = `${name}\n(生成中…)`;
    }
    i++;
  }
}

/** 場景模式:office 房間 + 可操作角色,踩到出入口切場景 */
/** 解謎關卡定義:每關一個場景 JSON + 顯示名 + 目標提示。門的 exit.to 串起下一關。 */
interface LevelDef {
  scene: string;
  name: string;
  hint: string;
}
const LEVELS: LevelDef[] = [
  { scene: 'level1', name: '第 1 關 · 辦公室', hint: '找到門上密碼,離開房間' },
  { scene: 'level2', name: '第 2 關 · 倉庫', hint: '兩張紙條各藏一半密碼' },
  { scene: 'level3', name: '第 3 關 · 控制室', hint: '踩下踏板,再算出密碼' },
  { scene: 'level4', name: '第 4 關 · 機房', hint: '合上雙保險絲,再算出密碼' },
  { scene: 'level5', name: '第 5 關 · 檔案室', hint: '撿起鑰匙卡,再輸入檔案編號' },
];
// 起始場景:預設第 1 關;開發時可用 ?scene=level3 直接跳關驗證(玩家不會手打此參數)
const FIRST_SCENE =
  new URLSearchParams(location.search).get('scene') ?? LEVELS[0].scene;

async function sceneMode(app: Application, manifest: Awaited<ReturnType<typeof loadManifest>>) {
  let built = await buildScene(await loadScene(FIRST_SCENE), manifest);
  app.stage.addChild(built.root);

  // ── 解謎狀態(跨關保留:照 bagCount 的 closure 模式,switchScene 不碰它就會留著)──
  const puzzleState = {
    /** 已解鎖的門(以目標場景名 exit.to 記);redrawDoors 用它決定門畫紅或綠 */
    unlocked: new Set<string>(),
    /** 已觸發的機關 flag(device.setFlag) */
    flags: new Set<string>(),
    /** 已看過的線索 id(避免 toast 洗頻,可重看) */
    seenClues: new Set<string>(),
    /** 目前所在關卡(場景名) */
    curScene: FIRST_SCENE,
  };
  const levelOf = (scene: string): LevelDef | undefined => LEVELS.find((l) => l.scene === scene);

  // ── 逃脫計時/步數(整場一份;過關結算與破關成績單用)──
  // elapsedMs 只在遊戲進行時累加(開場簡報/密碼面板/筆記本/過關畫面暫停時不計,對玩家公平)。
  // steps 由玩家實際位移距離換算(每 STEP_DIST 場景像素算一步),避免「原地狂按」灌步數。
  const STEP_DIST = 42;
  const run = {
    elapsedMs: 0,
    steps: 0,
    running: false, // 開場簡報按下開始 / 除錯跳關後才轉 true
    finished: false, // 破關後凍結,不再累加
    moveAcc: 0, // 位移累加器,滿 STEP_DIST 進一步
    lastX: 0,
    lastY: 0,
  };
  // 每關「應花時間」預算(秒);逐關遞增(後面關較難)。總預算決定評級門檻。
  const LEVEL_PAR_SEC = [45, 60, 75, 90, 105];
  const parTotalMs = LEVEL_PAR_SEC.reduce((a, b) => a + b, 0) * 1000;
  /** 依用時 vs 預算給評級:≤預算 S、≤1.5× A、≤2.2× B、其餘 C */
  const gradeFor = (elapsedMs: number): string => {
    const r = elapsedMs / parTotalMs;
    if (r <= 1) return 'S';
    if (r <= 1.5) return 'A';
    if (r <= 2.2) return 'B';
    return 'C';
  };
  const dbgWin = window as unknown as Record<string, unknown>;
  dbgWin.__run = () => ({ ...run, grade: gradeFor(run.elapsedMs) });

  // ── 最佳紀錄(localStorage 持久化;閉合「破自己紀錄」的重玩循環)──
  const BEST_KEY = 'rpg-escape-best';
  interface BestRecord {
    elapsedMs: number;
    steps: number;
    grade: string;
  }
  const loadBest = (): BestRecord | null => {
    try {
      const raw = localStorage.getItem(BEST_KEY);
      if (!raw) return null;
      const b = JSON.parse(raw) as Partial<BestRecord>;
      if (typeof b.elapsedMs !== 'number' || typeof b.steps !== 'number') return null;
      return { elapsedMs: b.elapsedMs, steps: b.steps, grade: String(b.grade ?? gradeFor(b.elapsedMs)) };
    } catch {
      return null; // localStorage 被擋 / JSON 壞掉 → 當作沒有紀錄,不擋破關畫面
    }
  };
  const saveBest = (r: BestRecord): void => {
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(r));
    } catch {
      /* 隱私模式等 localStorage 不可寫 → 靜默略過,紀錄僅本局有效 */
    }
  };
  dbgWin.__best = () => loadBest();

  // 角色(紙娃娃層,素材未生成時場景仍可看)
  let player: Player | null = null;
  const walkDef = manifest.assets['char-body-walk'];
  const idleDef = manifest.assets['char-body-idle'];
  const charReady =
    !!walkDef && !!idleDef && (await sheetExists(walkDef)) && (await sheetExists(idleDef));
  // 換裝插槽群組:sheet(walk+idle)已落地的變體才進選單
  const slotDefs: { slot: string; title: string; none: string; variants: [string, string][] }[] = [
    {
      slot: 'hair',
      title: '髮色',
      none: '原色',
      variants: [
        ['金', 'char-hair-blonde'],
        ['粉', 'char-hair-pink'],
        ['銀', 'char-hair-silver'],
      ],
    },
    {
      slot: 'shirt',
      title: '上衣',
      none: '原色',
      variants: [
        ['紅', 'char-shirt-red'],
        ['藍', 'char-shirt-blue'],
        ['綠', 'char-shirt-green'],
      ],
    },
    {
      slot: 'pants',
      title: '褲子',
      none: '原色',
      variants: [
        ['棕', 'char-pants-brown'],
        ['綠', 'char-pants-green'],
      ],
    },
    {
      slot: 'hat',
      title: '帽子',
      none: '無',
      variants: [['棒球帽', 'char-hat-cap']],
    },
  ];
  const groups: SlotGroup[] = [];
  if (charReady) {
    for (const def of slotDefs) {
      const options: SlotGroup['options'] = [{ label: def.none, name: null }];
      for (const [label, name] of def.variants) {
        const w = manifest.assets[`${name}-walk`];
        const i = manifest.assets[`${name}-idle`];
        if (w && i && (await sheetExists(w)) && (await sheetExists(i))) options.push({ label, name });
      }
      if (options.length > 1) groups.push({ slot: def.slot, title: def.title, options, active: null });
    }
    player = await Player.create(manifest, ['char-body'], 0.55);
    const hairGrp = groups.find((g) => g.slot === 'hair');
    const defaultHair = hairGrp?.options.find((o) => o.name === 'char-hair-blonde')?.name ?? null;
    if (defaultHair) {
      await player.setOverlay(manifest, 'hair', defaultHair);
      hairGrp!.active = defaultHair;
    }
    player.x = built.data.spawn.x;
    player.y = built.data.spawn.y;
    built.objectLayer.addChild(player.view);
  }
  // 控制面板:髮色切換 + 場景編輯
  let editor = new SceneEditor(app, built);

  // 驗收/除錯用:曝露角色與編輯器
  const dbg = window as unknown as Record<string, unknown>;
  dbg.__player = player;
  dbg.__built = built;
  dbg.__editor = editor;
  const ui = buildUi({
    groups,
    onSlot: (slot, name) => void player?.setOverlay(manifest, slot, name),
    onEditToggle: (on) => editor.setEnabled(on),
    exportJson: () => editor.exportJson(),
  });

  // 初始關卡 HUD;若起始場景不是解謎關(如自由 office),不顯示 HUD
  const initLevel = levelOf(built.data.name);
  ui.setLevel(
    initLevel
      ? {
          name: initLevel.name,
          hint: initLevel.hint,
          step: LEVELS.indexOf(initLevel) + 1,
          total: LEVELS.length,
        }
      : null,
  );
  ui.setPuzzleMode(!!initLevel); // 解謎關收面板+開暗角;自由場景展開面板+關暗角

  // 計時起點:按下「開始逃脫」那刻才啟動(除錯跳關無簡報 → 直接啟動)
  const startRun = () => {
    run.running = true;
    if (player) {
      run.lastX = player.x;
      run.lastY = player.y;
    }
  };
  // 開場簡報:正常從第 1 關進場才顯示(?scene= 除錯跳關時跳過,不擋除錯)
  const jumpedViaParam = new URLSearchParams(location.search).has('scene');
  if (initLevel && built.data.name === LEVELS[0].scene && !jumpedViaParam) {
    ui.showIntro(startRun);
  } else if (initLevel) {
    startRun(); // 除錯跳關:沒有簡報,直接開始計時
  }

  // 背包:撿到的物品計數 + 持有物品 id 集合(跨場景保留;解謎鎖門的 needItems 查它)
  let bagCount = 0;
  const heldItems = new Set<string>();
  const PICKUP_RANGE = 90; // 角色與物品距離小於此才能撿(場景像素)
  const INTERACT_RANGE = 100; // 線索/開關互動距離
  const DOOR_RANGE = 110; // 門互動距離(比 aabb 重疊寬鬆,站門口附近就能按 E)
  let pickupHandled = false;
  dbg.__bag = () => bagCount;
  dbg.__held = () => [...heldItems];
  dbg.__puzzle = () => ({
    scene: built.data.name,
    unlocked: [...puzzleState.unlocked],
    flags: [...puzzleState.flags],
    held: [...heldItems],
    seenClues: [...puzzleState.seenClues],
  });
  // 撿取最近且在範圍內的地上物品:先播撿取動作(彎腰),動作到一半才真的入袋
  const tryPickup = () => {
    if (!player || player.inAction) return;
    let best: (typeof built.pickups)[number] | null = null;
    let bestD = PICKUP_RANGE;
    for (const pk of built.pickups) {
      const d = Math.hypot(pk.data.x - player.x, pk.data.y - player.y);
      if (d < bestD) {
        bestD = d;
        best = pk;
      }
    }
    if (!best) return;
    const target = best;
    player.pickupAction(); // 彎腰動作 + ✨ 泡泡
    // 動作到「最深(彎下去)」那刻才把物品收走,視覺上像撿起來
    window.setTimeout(() => {
      if (!built.pickups.includes(target)) return; // 場景已切換等情況,保險
      target.sprite.destroy();
      built.pickups = built.pickups.filter((p) => p !== target);
      bagCount++;
      heldItems.add(target.data.id);
      ui.setBag(bagCount);
      // 撿到鑰匙可能解某扇 needItems 門 → 重畫
      for (const ex of built.data.exits ?? []) {
        if (ex.lock && isExitOpen(ex)) puzzleState.unlocked.add(ex.to);
      }
      redrawBuiltDoors();
    }, 280);
  };
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f' && !pickupHandled) {
      pickupHandled = true;
      tryPickup();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'f') pickupHandled = false;
  });

  // 門口離開:站在出口 zone 內按 E 才切場景(靠近時畫面下方顯示提示)
  const SCENE_LABEL: Record<string, string> = {
    office: '辦公室',
    outdoor: '戶外',
    cabin: '小木屋',
    storage: '倉庫',
    level1: '辦公室',
    level2: '倉庫',
    level3: '控制室',
    win: '出口',
  };
  const sceneLabel = (to: string) => levelOf(to)?.name ?? SCENE_LABEL[to] ?? to;

  // 門鎖是否已解:沒 lock = 通行;有 code 已解鎖;有 needFlags/needItems 全滿足才通
  const isExitOpen = (ex: NonNullable<typeof built.data.exits>[number]): boolean => {
    if (!ex.lock) return true;
    if (puzzleState.unlocked.has(ex.to)) return true;
    const flagsOk = (ex.lock.needFlags ?? []).every((f) => puzzleState.flags.has(f));
    const itemsOk = (ex.lock.needItems ?? []).every((i) => heldItems.has(i));
    // 沒有 code、只靠 flag/item 的門:條件滿足即視為已開
    if (!ex.lock.code && (ex.lock.needFlags || ex.lock.needItems)) return flagsOk && itemsOk;
    return false;
  };

  // 正在播放開門動畫的門(null = 沒有);由 ticker 每幀推進 progress
  let doorOpening: DoorOpening | null = null;
  const DOOR_ANIM_SEC = 0.9; // 開門動畫時長(鎖解開→門板滑開,拉長讓玩家看得清)
  dbg.__doorAnim = () => (doorOpening ? { ...doorOpening } : null); // 除錯:讀開門動畫進度

  const redrawBuiltDoors = () => {
    if (!built.doorGraphics) return;
    const bottomExits = (built.data.exits ?? []).filter(
      (ex) => ex.zone.y >= built.data.size.h - 80,
    );
    redrawDoors(built.doorGraphics, built.data, bottomExits, puzzleState.unlocked, doorOpening);
  };

  // 更新左上角解謎進度:本場景線索找到幾條 + 底部鎖門是否已解鎖
  const refreshProgress = () => {
    const clues = built.clues;
    const lockedExit = (built.data.exits ?? []).find(
      (ex) => ex.lock && ex.zone.y >= built.data.size.h - 80,
    );
    if (clues.length === 0 && !lockedExit) {
      ui.setProgress(null);
      return;
    }
    const seen = clues.filter((c) => puzzleState.seenClues.has(c.data.id)).length;
    const unlocked = lockedExit ? puzzleState.unlocked.has(lockedExit.to) : false;
    ui.setProgress({ cluesSeen: seen, cluesTotal: clues.length, unlocked });
  };

  // 解鎖一扇門:記到 puzzleState、播開門動畫(門板滑開+掛鎖掉落),動畫完再定格成綠門
  const unlockExit = (to: string) => {
    puzzleState.unlocked.add(to);
    refreshProgress();
    // 只對「底部有畫門」的出口播動畫;非底門(無 doorGraphics)直接定格
    const isBottomDoor = (built.data.exits ?? []).some(
      (ex) => ex.to === to && ex.zone.y >= built.data.size.h - 80,
    );
    if (!built.doorGraphics || !isBottomDoor) {
      redrawBuiltDoors();
      return;
    }
    let elapsed = 0;
    doorOpening = { to, progress: 0 };
    const step = (tk: { deltaMS: number }) => {
      elapsed += tk.deltaMS / 1000;
      const p = Math.min(1, elapsed / DOOR_ANIM_SEC);
      doorOpening = { to, progress: p };
      redrawBuiltDoors();
      if (p >= 1) {
        app.ticker.remove(step);
        doorOpening = null;
        redrawBuiltDoors(); // 定格成靜態綠門把
      }
    };
    app.ticker.add(step);
  };

  refreshProgress(); // 初始關卡的進度(0 條線索 + 上鎖)先顯示

  // 目前站在門口的出口(每幀由 ticker 更新);curClue/curDevice 同理
  let curExit: NonNullable<typeof built.data.exits>[number] | null = null;
  let curClue: (typeof built.clues)[number] | null = null;
  let curDevice: (typeof built.devices)[number] | null = null;
  let exitHandled = false;

  // 開鎖門:靠近鎖門按 E → 若已滿足條件直接開,否則(有 code)開密碼面板
  const tryOpenLockedExit = (ex: NonNullable<typeof built.data.exits>[number]) => {
    if (isExitOpen(ex)) {
      void switchScene(ex.to, ex.spawn);
      return;
    }
    const lock = ex.lock!;
    // 前置條件:有 needFlags/needItems 卻沒滿足 → 先擋,不讓輸密碼(密碼對也沒用)
    const flagsOk = (lock.needFlags ?? []).every((f) => puzzleState.flags.has(f));
    const itemsOk = (lock.needItems ?? []).every((i) => heldItems.has(i));
    if (!flagsOk || !itemsOk) {
      ui.showToast(lock.hint ?? '這扇門還打不開,先找找機關或鑰匙', 2400);
      return;
    }
    if (lock.code) {
      // 走到這裡代表 needFlags/needItems 都已滿足;此時的 hint 不該再喊「先接電源」,
      // 有前置條件的門顯示「已解除前置、請輸密碼」,單純密碼門才沿用場景 hint
      const gated = (lock.needFlags?.length ?? 0) > 0 || (lock.needItems?.length ?? 0) > 0;
      const panelHint = gated
        ? `前置已解除 · 輸入 ${lock.code.length} 位密碼`
        : lock.hint ?? `輸入 ${lock.code.length} 位密碼`;
      ui.openPassword({
        title: '🔒 門鎖',
        hint: panelHint,
        length: lock.code.length,
        onSubmit: (code) => {
          if (code === lock.code) {
            unlockExit(ex.to);
            ui.showToast('🔓 喀噠——門開了!', 1600);
            return true;
          }
          return false;
        },
        onCancel: () => {},
      });
    }
  };

  // E 鍵分派:modal 開著時交給 modal;否則依「門 > 線索 > 機關」優先序互動
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'e' || exitHandled) return;
    exitHandled = true;
    if (ui.isModalOpen() || switching) return;
    if (curExit) {
      if (curExit.lock) tryOpenLockedExit(curExit);
      else void switchScene(curExit.to, curExit.spawn);
    } else if (curClue) {
      ui.showToast(`${curClue.data.emoji}  ${curClue.data.text}`, 4200);
      puzzleState.seenClues.add(curClue.data.id);
      refreshProgress();
    } else if (curDevice) {
      triggerDevice(curDevice);
    } else {
      // 附近沒有可互動物 → E 當打招呼(引擎已不綁 E 鍵,由遊戲層分派)
      player?.greet();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'e') exitHandled = false;
  });

  // Tab:開/關線索筆記本(把本關找過的線索留存,方便回頭對照數字)
  const seenCluesInScene = () =>
    built.clues
      .filter((c) => puzzleState.seenClues.has(c.data.id))
      .map((c) => ({ emoji: c.data.emoji, text: c.data.text }));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault(); // 別讓 Tab 跑去切換瀏覽器焦點
    if (ui.isModalOpen() || switching) return;
    ui.setNotebook(!ui.isNotebookOpen(), seenCluesInScene());
  });

  // 觸發機關:開關 = toggle flag;踩板由 ticker 自動觸發(這裡也支援按 E 當開關)
  const triggerDevice = (dev: (typeof built.devices)[number]) => {
    if (dev.active) return; // 已觸發不重複(單向:觸發後維持)
    dev.active = true;
    puzzleState.flags.add(dev.data.setFlag);
    dev.sprite.text = dev.data.kind === 'switch' ? '🟢' : dev.sprite.text;
    // 機關觸發 → 光暈轉綠常亮,標示「這個已完成」
    dev.halo.clear();
    dev.halo.circle(0, 0, 40).fill({ color: 0x8ad86e, alpha: 0.3 });
    dev.halo.circle(0, 0, 30).fill({ color: 0x8ad86e, alpha: 0.4 });
    dev.halo.circle(0, 0, 30).stroke({ color: 0xffffff, alpha: 0.6, width: 2.5 });
    dev.halo.alpha = 1;
    dev.halo.scale.set(1);
    ui.showToast(dev.data.hint ?? '喀噠——某處起了變化', 2000);
    // 觸發後可能滿足某扇門的 flag 條件 → 重畫門讓玩家看到變化
    for (const ex of built.data.exits ?? []) {
      if (ex.lock && isExitOpen(ex)) puzzleState.unlocked.add(ex.to);
    }
    redrawBuiltDoors();
  };

  // 載具:G 上/下車;上車後角色隱身、車帶著人以車速移動
  let riding: (typeof built.vehicles)[number] | null = null;
  const RIDE_RANGE = 110; // 上車距離
  const DEFAULT_VEHICLE_SPEED = 380; // 車比人(220)快
  const vehKeys = new Set<string>();
  let rideHandled = false;
  dbg.__riding = () => (riding ? riding.data.id : null);
  const enterVehicle = () => {
    if (!player) return;
    let best: (typeof built.vehicles)[number] | null = null;
    let bestD = RIDE_RANGE;
    for (const v of built.vehicles) {
      const d = Math.hypot(v.x - player.x, v.y - player.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (!best) return;
    riding = best;
    player.view.visible = false; // 人坐進車裡,先隱身(基本版)
  };
  const exitVehicle = () => {
    if (!player || !riding) return;
    // 角色落回車旁(車正下方一點,避免疊在車上)
    player.x = riding.x;
    player.y = riding.y + 60;
    player.view.visible = true;
    riding = null;
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'g' && !rideHandled) {
      rideHandled = true;
      if (riding) exitVehicle();
      else enterVehicle();
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      vehKeys.add(k);
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'g') rideHandled = false;
    vehKeys.delete(k);
  });
  // 車移動:讀方向鍵,吃碰撞牆(沿牆滑),更新車 sprite + 讓角色座標跟車
  const updateVehicle = (dtSec: number) => {
    if (!riding || !player) return;
    let dx = 0;
    let dy = 0;
    if (vehKeys.has('w') || vehKeys.has('arrowup')) dy -= 1;
    if (vehKeys.has('s') || vehKeys.has('arrowdown')) dy += 1;
    if (vehKeys.has('a') || vehKeys.has('arrowleft')) dx -= 1;
    if (vehKeys.has('d') || vehKeys.has('arrowright')) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      const speed = riding.data.speed ?? DEFAULT_VEHICLE_SPEED;
      const step = (speed * dtSec) / len;
      const half = { w: 60, h: 30 }; // 車底碰撞框(約車身)
      const canMove = (nx: number, ny: number): boolean => {
        const box: Aabb = { x: nx, y: ny - half.h / 2, w: half.w, h: half.h };
        return !built.colliders.some((c) => aabbOverlap(box, c));
      };
      const nx = riding.x + dx * step;
      if (canMove(nx, riding.y)) riding.x = nx;
      const ny = riding.y + dy * step;
      if (canMove(riding.x, ny)) riding.y = ny;
    }
    riding.sprite.x = riding.x;
    riding.sprite.y = riding.y;
    riding.sprite.zIndex = riding.y;
    // 角色跟著車(座標同步,view 雖隱身但保持位置正確,下車才對)
    player.x = riding.x;
    player.y = riding.y;
  };

  // 鏡頭:整個房間置中、縮放至可視範圍
  const fit = () => {
    const d = built.data;
    const totalH = d.size.h + d.wallHeight;
    const s = Math.min(app.screen.width / d.size.w, app.screen.height / totalH) * 0.92;
    built.root.scale.set(s);
    built.root.x = (app.screen.width - d.size.w * s) / 2;
    built.root.y = (app.screen.height - totalH * s) / 2 + d.wallHeight * s;
  };
  fit();
  window.addEventListener('resize', fit);

  // ── 多人連線:把本地玩家位置廣播到 Firebase RTDB,渲染同場景的其他玩家 ──
  let net: Net | null = null;
  const remotes = new Map<string, RemotePlayer>();
  // 正在建立中的 remote(避免 async 建立期間同一 id 重複建)
  const remoteBuilding = new Set<string>();
  const PLAYER_SCALE = 0.55;
  try {
    net = new Net();
    dbg.__net = () => ({
      id: net?.clientId,
      name: net?.name,
      peers: net ? Object.keys(net.peers).length : 0,
      shown: remotes.size,
    });
  } catch (e) {
    console.warn('多人連線初始化失敗(單機仍可玩):', e);
  }
  // 每幀對帳:依 net.peers 增/刪/更新 remote sprite,只顯示與本地同場景者
  const syncRemotes = (dtSec: number) => {
    if (!net) return;
    const sceneName = built.data.name;
    const peers = net.peers;
    // 移除:已離線、或跑到別的場景的 remote
    for (const [id, rp] of remotes) {
      const st = peers[id];
      if (!st || st.scene !== sceneName) {
        built.objectLayer.removeChild(rp.view);
        rp.destroy();
        remotes.delete(id);
      }
    }
    // 新增/更新:同場景的 peer
    for (const [id, st] of Object.entries(peers)) {
      if (st.scene !== sceneName) continue;
      const rp = remotes.get(id);
      if (rp) {
        rp.onUpdate(st);
      } else if (!remoteBuilding.has(id)) {
        remoteBuilding.add(id);
        void RemotePlayer.create(manifest, PLAYER_SCALE, st).then((newRp) => {
          remoteBuilding.delete(id);
          // 建立期間可能已切場景/該 peer 已離線 → 再確認一次才掛上
          if (!net || net.peers[id]?.scene !== built.data.name) {
            newRp.destroy();
            return;
          }
          remotes.set(id, newRp);
          built.objectLayer.addChild(newRp.view);
        });
      }
    }
    // 插值移動所有 remote
    for (const rp of remotes.values()) rp.update(dtSec);
  };
  // 切場景時清掉所有 remote(objectLayer 會被銷毀重建)
  const clearRemotes = () => {
    for (const rp of remotes.values()) rp.destroy();
    remotes.clear();
    remoteBuilding.clear();
  };

  // 場景切換:換裝狀態跟著 Player 實例保留
  let switching = false;
  // 門一解開就切場景 → 玩家沒有「我剛破了一關」的成就感。這裡插一層過關慶祝:
  // 非最後一關 → 顯示「第 N 關 解開!」+ 本關線索數 + 「前往下一關」鈕,按了才真的載下一關;
  // 最後一關 → 直接走全破畫面。ex.to === 'win' 的死路照舊。
  const switchScene = async (to: string, spawn: { x: number; y: number }) => {
    // 破關:最後一關的門通往 'win' → 顯示破關畫面,不載場景
    if (to === 'win') {
      const cluesFound = puzzleState.seenClues.size;
      run.finished = true; // 凍結計時,成績單定格
      const grade = gradeFor(run.elapsedMs);
      // 最佳紀錄:用時較短算刷新(時間是逃脫的主指標);破紀錄前先留舊值給畫面對比
      const prevBest = loadBest();
      const isNew = !prevBest || run.elapsedMs < prevBest.elapsedMs;
      const thisRun: BestRecord = { elapsedMs: run.elapsedMs, steps: run.steps, grade };
      if (isNew) saveBest(thisRun);
      // 破紀錄且有舊紀錄 → 秀「前一次最佳」對比;沒破 → 秀現有最佳;首次通關 → 秀本局當新紀錄
      const bestForCard:
        | (BestRecord & { isNew: boolean; firstClear?: boolean })
        | undefined = isNew
        ? prevBest
          ? { ...prevBest, isNew: true } // 破了舊紀錄:徽章 + 對比舊值
          : { ...thisRun, isNew: true, firstClear: true } // 首次通關:徽章,無對比
        : prevBest
          ? { ...prevBest, isNew: false } // 沒破:顯示現有最佳
          : undefined;
      ui.showLevelComplete({
        title: '🎉 全部過關!',
        body: `你解開了全部 ${LEVELS.length} 道門,一路蒐集 ${cluesFound} 條線索,成功脫逃!`,
        stats: { elapsedMs: run.elapsedMs, steps: run.steps, grade },
        best: bestForCard,
        // 破關是死路 —— 重載到乾淨首頁重玩(去掉 ?scene= 除錯參數,狀態全歸零)
        onRestart: () => {
          location.href = location.pathname;
        },
      });
      return;
    }
    // 從解謎關的門走向下一個解謎關 → 先慶祝剛破的這關,按鈕才載下一關
    const fromLv = levelOf(puzzleState.curScene);
    const toLv = levelOf(to);
    if (fromLv && toLv) {
      const idx = LEVELS.indexOf(fromLv) + 1;
      const cluesThisLevel = seenCluesInScene().length;
      const clueLine =
        cluesThisLevel > 0
          ? `本關蒐集了 ${cluesThisLevel} 條線索。`
          : '你靠推理直接破解了密碼!';
      switching = true; // 慶祝期間鎖住輸入,避免又按 E 觸發別的
      ui.showLevelComplete({
        title: `✅ 第 ${idx} 關 解開!`,
        body: `${clueLine}\n下一關:${toLv.name}`,
        // 過關中途顯示累計用時/步數(不給評級 —— 評級留到全破才揭曉),讓玩家感覺時間在跑
        stats: { elapsedMs: run.elapsedMs, steps: run.steps, grade: gradeFor(run.elapsedMs) },
        onNext: () => {
          switching = false;
          void loadAndSwap(to, spawn);
        },
      });
      return;
    }
    void loadAndSwap(to, spawn);
  };
  const loadAndSwap = async (to: string, spawn: { x: number; y: number }) => {
    switching = true;
    clearRemotes(); // 舊場景 objectLayer 即將銷毀,先清遠端玩家 sprite
    // 切場景先強制下車(舊場景的車 sprite 會被銷毀,riding 不能懸空)
    if (riding && player) {
      player.view.visible = true;
      riding = null;
    }
    try {
      const next = await buildScene(await loadScene(to), manifest);
      if (player) built.objectLayer.removeChild(player.view);
      editor.destroy();
      app.stage.removeChild(built.root);
      built.root.destroy({ children: true });
      built = next;
      app.stage.addChild(built.root);
      if (player) {
        player.x = spawn.x;
        player.y = spawn.y;
        built.objectLayer.addChild(player.view);
        run.lastX = player.x; // 換關 teleport 後重設步數基準,避免補算跨關大位移
        run.lastY = player.y;
      }
      editor = new SceneEditor(app, built);
      dbg.__built = built;
      dbg.__editor = editor;
      fit();

      // 進入新關卡:更新解謎狀態、HUD、依已解鎖狀態重畫門、播過關提示
      puzzleState.curScene = to;
      const lv = levelOf(to);
      ui.setLevel(
        lv
          ? { name: lv.name, hint: lv.hint, step: LEVELS.indexOf(lv) + 1, total: LEVELS.length }
          : null,
      );
      ui.setPuzzleMode(!!lv); // 解謎關收面板+開暗角;自由場景展開+關暗角
      ui.setNotebook(false, []); // 換關把筆記本關掉(避免顯示上一關的線索)
      redrawBuiltDoors();
      refreshProgress();
      if (lv) {
        const idx = LEVELS.indexOf(lv);
        ui.showToast(`${lv.name}\n${lv.hint}`, 2600);
        void idx;
      }
    } finally {
      switching = false;
    }
  };

  let haloClock = 0;
  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    // 互動光暈呼吸:未觸發的線索/機關脈動放大,吸引玩家注意;已觸發的機關維持綠色常亮
    haloClock += dt;
    const pulse = 0.85 + Math.sin(haloClock * 2.6) * 0.15; // 0.70~1.00
    for (const c of built.clues) {
      c.halo.alpha = c.data.id && curClue?.data.id === c.data.id ? 1 : pulse;
      c.halo.scale.set(pulse);
    }
    for (const dev of built.devices) {
      if (dev.active) continue;
      dev.halo.alpha = pulse;
      dev.halo.scale.set(pulse);
    }
    const uiPaused = ui.isModalOpen() || ui.isNotebookOpen() || ui.isIntroOpen();
    // 逃脫計時/步數:遊戲進行中(未暫停、未破關、未切場景慶祝)才累加
    if (run.running && !run.finished && !uiPaused && !switching) {
      run.elapsedMs += t.deltaMS;
      if (player) {
        run.moveAcc += Math.hypot(player.x - run.lastX, player.y - run.lastY);
        run.lastX = player.x;
        run.lastY = player.y;
        while (run.moveAcc >= STEP_DIST) {
          run.moveAcc -= STEP_DIST;
          run.steps++;
        }
      }
      ui.setStats({ elapsedMs: run.elapsedMs, steps: run.steps });
    } else if (player && run.running) {
      // 暫停期間玩家位置可能被 teleport/切場景改動,重設基準避免暫停後補算大位移
      run.lastX = player.x;
      run.lastY = player.y;
    }
    if (riding) {
      // 騎乘中:只由車帶人移動,角色不自走(不跑 player.update,避免方向鍵人車搶控)
      updateVehicle(dt);
    } else if (!uiPaused) {
      player?.update(dt, built.colliders);
    }
    // 互動偵測:門口 / 線索 / 機關。優先序 門 > 線索 > 機關(同時靠近時 E 先給門)
    if (player && !switching && !riding && !uiPaused) {
      // 門:aabb 重疊 OR 站在門口附近(放寬,避免被牆碰撞箱擋住差幾 px 就觸發不到)
      let foundExit: typeof curExit = null;
      let exitD = DOOR_RANGE;
      for (const ex of built.data.exits ?? []) {
        if (aabbOverlap(player.aabb, ex.zone)) {
          foundExit = ex;
          break;
        }
        const d = Math.hypot(ex.zone.x - player.x, ex.zone.y - player.y);
        if (d < exitD) {
          exitD = d;
          foundExit = ex;
        }
      }
      // 線索(距離判定)
      let foundClue: typeof curClue = null;
      let clueD = INTERACT_RANGE;
      for (const c of built.clues) {
        const d = Math.hypot(c.data.x - player.x, c.data.y - player.y);
        if (d < clueD) {
          clueD = d;
          foundClue = c;
        }
      }
      // 機關:踩板(踩上去自動觸發)vs 開關(靠近按 E)
      let foundDevice: typeof curDevice = null;
      let devD = INTERACT_RANGE;
      for (const dev of built.devices) {
        const d = Math.hypot(dev.data.x - player.x, dev.data.y - player.y);
        if (dev.data.kind === 'plate' && d < 60 && !dev.active) {
          triggerDevice(dev); // 踩板:踏上即觸發,不用按鍵
        }
        if (dev.data.kind === 'switch' && d < devD && !dev.active) {
          devD = d;
          foundDevice = dev;
        }
      }

      curExit = foundExit;
      curClue = foundExit ? null : foundClue;
      curDevice = foundExit || foundClue ? null : foundDevice;

      // 提示浮條:門用金色 exitPrompt,線索/機關用藍色 actionPrompt
      if (foundExit) {
        const locked = foundExit.lock && !isExitOpen(foundExit);
        ui.setExitPrompt(
          locked
            ? `🔒 按 E ${foundExit.lock?.code ? '輸入密碼' : '嘗試開門'}`
            : `按 E 前往「${sceneLabel(foundExit.to)}」`,
        );
        ui.setActionPrompt(null);
      } else {
        ui.setExitPrompt(null);
        ui.setActionPrompt(
          foundClue
            ? `按 E 查看${foundClue.data.emoji}`
            : foundDevice
              ? `按 E 操作${foundDevice.data.emoji}`
              : null,
        );
      }
    } else if (player) {
      curExit = null;
      curClue = null;
      curDevice = null;
    }
    // 多人:廣播自己 + 對帳/渲染其他玩家(切場景中不推,避免場景名跳動)
    if (net && player && !switching) {
      net.push({ x: player.x, y: player.y, dir: player.dir, scene: built.data.name });
      syncRemotes(dt);
    }
  });
}

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#e88">${e?.stack ?? e}</pre>`;
});
