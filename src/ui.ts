/** 遊戲頁右上角控制面板(純 DOM,疊在 canvas 上):紙娃娃換裝 + 場景編輯模式 + 匯出 JSON */

export interface SlotGroup {
  /** player overlay 插槽名(hair / shirt / pants / hat …) */
  slot: string;
  title: string;
  /** name = manifest 層名(null = 原色/拿掉該層) */
  options: { label: string; name: string | null }[];
  /** 預設高亮的 name */
  active: string | null;
}

export interface UiOptions {
  groups: SlotGroup[];
  onSlot: (slot: string, name: string | null) => void;
  onEditToggle: (on: boolean) => void;
  exportJson: () => string;
}

/** 密碼輸入面板參數 */
export interface PasswordPrompt {
  /** 面板標題(如「保險箱密碼」) */
  title: string;
  /** 提示文字(如「輸入 3 位數字」) */
  hint?: string;
  /** 密碼長度(決定顯示幾格) */
  length: number;
  /** 送出時判定:回傳 true=正確(面板關閉),false=錯誤(抖動、清空重輸) */
  onSubmit: (code: string) => boolean;
  /** 取消/關閉(按 Esc 或叉叉) */
  onCancel: () => void;
}

export interface UiHandle {
  /** 更新背包計數顯示 */
  setBag: (count: number) => void;
  /** 門口提示:傳字串顯示「按 E 離開」浮條,傳 null 隱藏 */
  setExitPrompt: (text: string | null) => void;
  /** 線索/機關互動提示:靠近可互動物時顯示,傳 null 隱藏(位置比門口提示高一排) */
  setActionPrompt: (text: string | null) => void;
  /** 中央訊息(看線索內容、機關觸發回饋):傳字串顯示數秒後自動淡出,傳 null 立即隱藏 */
  showToast: (text: string, ms?: number) => void;
  /** 關卡 HUD:左上角顯示目前關卡名 + 目標提示 */
  setLevel: (info: { name: string; hint: string } | null) => void;
  /** 解謎進度:找到幾條線索 + 門是否解鎖(傳 null 或 cluesTotal=0 則隱藏) */
  setProgress: (p: { cluesSeen: number; cluesTotal: number; unlocked: boolean } | null) => void;
  /** 逃脫計時/步數 HUD(顯示在關卡名上方一排;傳 null 隱藏) */
  setStats: (s: { elapsedMs: number; steps: number } | null) => void;
  /** 線索筆記本開/關(Tab):open 時傳入已找到的線索清單 */
  setNotebook: (open: boolean, clues: { emoji: string; text: string }[]) => void;
  /** 筆記本是否開啟中 — main 用來 gate 遊戲操作 */
  isNotebookOpen: () => boolean;
  /** 開密碼輸入面板(置中 modal);開啟期間 isModalOpen() 為 true,main 應 gate 掉遊戲操作 */
  openPassword: (p: PasswordPrompt) => void;
  /** modal(密碼面板)是否開啟中 — main 用來 gate 遊戲鍵盤/移動 */
  isModalOpen: () => boolean;
  /** 過關/破關全螢幕畫面(傳 null 關閉);帶 stats 時多顯示一張成績單(用時/步數/評級) */
  showLevelComplete: (
    info: {
      title: string;
      body: string;
      onNext?: () => void;
      onRestart?: () => void;
      stats?: { elapsedMs: number; steps: number; grade: string };
      /**
       * 歷史最佳(全破畫面用)。isNew=本局刷新紀錄則打「新紀錄」徽章。
       * firstClear=首次通關(沒有前一次可對比,只打徽章不秀對比數字)。
       * 非首次時 elapsedMs/steps/grade 是「用來對比的舊紀錄」。
       */
      best?: {
        elapsedMs: number;
        steps: number;
        grade: string;
        isNew: boolean;
        firstClear?: boolean;
      };
    } | null,
  ) => void;
  /** 解謎關 vs 自由場景:解謎關收起換裝面板 + 開暗角氛圍;自由場景展開面板 + 關暗角 */
  setPuzzleMode: (on: boolean) => void;
  /** 開場簡報:進遊戲第一眼顯示密室逃脫前提 + 操作,按鈕/Enter/E 才開始(onStart) */
  showIntro: (onStart: () => void) => void;
  /** 開場簡報是否開啟中 — main 用來 gate 遊戲移動/互動 */
  isIntroOpen: () => boolean;
}

const BTN_CSS =
  'border:1px solid #4a3a26;border-radius:6px;padding:3px 8px;cursor:pointer;font:12px monospace;background:#2e2418;color:#e8dcc8';

/** 毫秒 → m:ss(逃脫用時,超過一小時才顯示 h:mm:ss) */
function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

export function buildUi(opts: UiOptions): UiHandle {
  // 暗角 vignette:四角壓暗,營造密室/解謎氛圍(蓋在 canvas 上、不擋操作)
  const vignette = document.createElement('div');
  vignette.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:8', 'pointer-events:none',
    'background:radial-gradient(ellipse 78% 78% at 50% 46%, transparent 52%, rgba(6,4,2,.55) 88%, rgba(4,2,1,.82) 100%)',
    'transition:opacity .6s', 'opacity:1',
  ].join(';');
  document.body.appendChild(vignette);

  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed', 'top:60px', 'right:12px', 'z-index:10',
    'background:rgba(20,14,8,.88)', 'border:1px solid #4a3a26', 'border-radius:10px',
    'padding:12px 14px', 'color:#e8dcc8', 'font:13px/1.6 monospace', 'user-select:none',
    'min-width:190px', 'max-height:calc(100vh - 72px)', 'overflow-y:auto',
    'transition:transform .28s ease, opacity .28s', 'transform-origin:top right',
  ].join(';');

  // 折疊切鈕(🎨):解謎關預設收起面板,把畫面還給遊戲;點一下展開換裝/編輯
  const toggleBtn = document.createElement('button');
  toggleBtn.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:11',
    'width:40px', 'height:40px', 'border:1px solid #4a3a26', 'border-radius:10px',
    'background:rgba(20,14,8,.9)', 'color:#e0a458', 'cursor:pointer',
    'font:20px/1 monospace', 'box-shadow:0 2px 10px rgba(0,0,0,.4)',
  ].join(';');
  let panelOpen = true;
  const renderPanel = () => {
    panel.style.transform = panelOpen ? 'scale(1)' : 'scale(.9)';
    panel.style.opacity = panelOpen ? '1' : '0';
    panel.style.pointerEvents = panelOpen ? 'auto' : 'none';
    toggleBtn.textContent = panelOpen ? '✕' : '🎨';
    toggleBtn.title = panelOpen ? '收起面板' : '打開換裝/編輯面板';
  };
  toggleBtn.onclick = () => {
    panelOpen = !panelOpen;
    renderPanel();
  };
  document.body.appendChild(toggleBtn);

  const title = (t: string, first = false) => {
    const el = document.createElement('div');
    el.textContent = t;
    el.style.cssText = `color:#e0a458;margin:${first ? 0 : 10}px 0 4px;font-weight:bold`;
    panel.appendChild(el);
    return el;
  };

  // 換裝插槽群組
  opts.groups.forEach((grp, gi) => {
    title(grp.title, gi === 0);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    panel.appendChild(row);
    const btns = new Map<string | null, HTMLButtonElement>();
    const mark = (active: string | null) => {
      for (const [name, b] of btns) {
        b.style.background = name === active ? '#e0a458' : '#2e2418';
        b.style.color = name === active ? '#1a1410' : '#e8dcc8';
      }
    };
    for (const o of grp.options) {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.style.cssText = BTN_CSS;
      b.onclick = () => {
        opts.onSlot(grp.slot, o.name);
        mark(o.name);
      };
      btns.set(o.name, b);
      row.appendChild(b);
    }
    mark(grp.active);
  });

  // 編輯模式
  title('場景');
  const editBtn = document.createElement('button');
  editBtn.style.cssText = `width:100%;${BTN_CSS};padding:5px 8px`;
  let editing = false;
  const renderEdit = () => {
    editBtn.textContent = editing ? '■ 編輯中(點家具拖曳)' : '▶ 進入編輯模式';
    editBtn.style.background = editing ? '#7ec97e' : '#2e2418';
    editBtn.style.color = editing ? '#1a1410' : '#e8dcc8';
  };
  renderEdit();
  editBtn.onclick = () => {
    editing = !editing;
    opts.onEditToggle(editing);
    renderEdit();
    exportBtn.style.display = editing ? 'block' : 'none';
  };
  panel.appendChild(editBtn);

  // 匯出
  const exportBtn = document.createElement('button');
  exportBtn.textContent = '複製場景 JSON';
  exportBtn.style.cssText = `display:none;width:100%;margin-top:6px;${BTN_CSS};padding:5px 8px`;
  exportBtn.onclick = async () => {
    const json = opts.exportJson();
    try {
      await navigator.clipboard.writeText(json);
      exportBtn.textContent = '✓ 已複製到剪貼簿';
    } catch {
      // clipboard 權限被擋(如非 https iframe)→ 退回下載檔案
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'office.json';
      a.click();
      URL.revokeObjectURL(a.href);
      exportBtn.textContent = '✓ 已下載 office.json';
    }
    setTimeout(() => (exportBtn.textContent = '複製場景 JSON'), 1600);
  };
  panel.appendChild(exportBtn);

  // 背包計數
  title('背包');
  const bag = document.createElement('div');
  bag.style.cssText = 'font-size:14px';
  const setBag = (count: number) => {
    bag.textContent = `🎒 撿到 ${count} 個`;
  };
  setBag(0);
  panel.appendChild(bag);

  const hint = document.createElement('div');
  hint.textContent = 'WASD 移動 · E 互動/看線索/開鎖門 · F 撿取 · G 上下車';
  hint.style.cssText = 'color:#a89878;margin-top:8px;font-size:11px';
  panel.appendChild(hint);

  document.body.appendChild(panel);
  renderPanel();

  // 解謎關 / 自由場景切換:解謎關收面板 + 開暗角,自由場景展開面板 + 關暗角
  const setPuzzleMode = (on: boolean) => {
    vignette.style.opacity = on ? '1' : '0';
    panelOpen = !on; // 解謎關預設收起,自由場景預設展開
    renderPanel();
  };

  // 門口互動提示:畫面下方置中浮條,靠近出口才顯示
  const exitPrompt = document.createElement('div');
  exitPrompt.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:48px', 'transform:translateX(-50%)',
    'z-index:10', 'background:rgba(20,14,8,.9)', 'border:1px solid #e0a458',
    'border-radius:8px', 'padding:8px 16px', 'color:#ffe0a8',
    'font:15px/1.4 monospace', 'user-select:none', 'pointer-events:none',
    'display:none', 'box-shadow:0 2px 12px rgba(0,0,0,.5)',
  ].join(';');
  document.body.appendChild(exitPrompt);
  const setExitPrompt = (text: string | null) => {
    if (text) {
      exitPrompt.textContent = text;
      exitPrompt.style.display = 'block';
    } else {
      exitPrompt.style.display = 'none';
    }
  };

  // 線索/機關互動提示:比門口提示高一排(避免兩條疊在一起)
  const actionPrompt = document.createElement('div');
  actionPrompt.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:96px', 'transform:translateX(-50%)',
    'z-index:10', 'background:rgba(20,14,8,.9)', 'border:1px solid #7ec9e0',
    'border-radius:8px', 'padding:7px 14px', 'color:#bfe8ff',
    'font:14px/1.4 monospace', 'user-select:none', 'pointer-events:none',
    'display:none', 'box-shadow:0 2px 12px rgba(0,0,0,.5)',
  ].join(';');
  document.body.appendChild(actionPrompt);
  const setActionPrompt = (text: string | null) => {
    if (text) {
      actionPrompt.textContent = text;
      actionPrompt.style.display = 'block';
    } else {
      actionPrompt.style.display = 'none';
    }
  };

  // 中央 toast:看線索內容 / 機關觸發回饋,幾秒後自動淡出
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed', 'left:50%', 'top:38%', 'transform:translate(-50%,-50%)',
    'z-index:12', 'background:rgba(20,14,8,.95)', 'border:2px solid #e0a458',
    'border-radius:12px', 'padding:18px 26px', 'color:#ffe8c8', 'max-width:min(80vw,520px)',
    'font:16px/1.6 monospace', 'user-select:none', 'pointer-events:none', 'text-align:center',
    'display:none', 'box-shadow:0 6px 30px rgba(0,0,0,.6)', 'white-space:pre-wrap',
    'transition:opacity .3s', 'opacity:0',
  ].join(';');
  document.body.appendChild(toast);
  let toastTimer = 0;
  const showToast = (text: string, ms = 3000) => {
    toast.textContent = text;
    toast.style.display = 'block';
    // 觸發 transition
    requestAnimationFrame(() => (toast.style.opacity = '1'));
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.style.opacity = '0';
      window.setTimeout(() => (toast.style.display = 'none'), 300);
    }, ms);
  };

  // 關卡 HUD(左上角):目前關卡 + 目標
  const hud = document.createElement('div');
  hud.style.cssText = [
    'position:fixed', 'top:12px', 'left:12px', 'z-index:10',
    'background:rgba(20,14,8,.88)', 'border:1px solid #4a3a26', 'border-radius:10px',
    'padding:10px 14px', 'color:#e8dcc8', 'font:13px/1.5 monospace', 'user-select:none',
    'max-width:260px', 'display:none',
  ].join(';');
  // 逃脫計時/步數:放在關卡名上方(等寬字對齊,秒數跳動不推擠版面)
  const hudStats = document.createElement('div');
  hudStats.style.cssText =
    'font-size:13px;color:#ffd27a;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #4a3a26;letter-spacing:.5px;display:none';
  const hudName = document.createElement('div');
  hudName.style.cssText = 'color:#e0a458;font-weight:bold;font-size:15px;margin-bottom:3px';
  const hudHint = document.createElement('div');
  hudHint.style.cssText = 'color:#c8bca8;font-size:12px';
  const hudProgress = document.createElement('div');
  hudProgress.style.cssText =
    'margin-top:7px;padding-top:7px;border-top:1px solid #4a3a26;font-size:12px;color:#d8cbb2;display:none';
  hud.append(hudStats, hudName, hudHint, hudProgress);
  document.body.appendChild(hud);
  const setStats = (s: { elapsedMs: number; steps: number } | null) => {
    if (!s) {
      hudStats.style.display = 'none';
      return;
    }
    hudStats.textContent = `⏱ ${fmtTime(s.elapsedMs)}   👣 ${s.steps}`;
    hudStats.style.display = 'block';
  };
  const setLevel = (info: { name: string; hint: string } | null) => {
    if (!info) {
      hud.style.display = 'none';
      return;
    }
    hudName.textContent = info.name;
    hudHint.textContent = info.hint;
    hud.style.display = 'block';
  };
  // 解謎進度:找到幾條線索 + 門是否已解鎖,讓玩家有「接近答案」的手感
  const setProgress = (p: { cluesSeen: number; cluesTotal: number; unlocked: boolean } | null) => {
    if (!p || p.cluesTotal === 0) {
      hudProgress.style.display = 'none';
      return;
    }
    const dots = '●'.repeat(p.cluesSeen) + '○'.repeat(Math.max(0, p.cluesTotal - p.cluesSeen));
    const lock = p.unlocked ? '<span style="color:#8ad86e">🔓 門已解鎖</span>' : '🔒 門上鎖';
    // 收集到第一條線索後,才提示 Tab 可翻筆記本 —— 避免一開始就塞太多字
    const tabHint =
      p.cluesSeen > 0 && !p.unlocked
        ? '<br><span style="font-size:11px;color:#8a7a60">按 Tab 翻線索筆記本</span>'
        : '';
    hudProgress.innerHTML = `線索 <span style="color:#ffd27a">${dots}</span> ${p.cluesSeen}/${p.cluesTotal} · ${lock}${tabHint}`;
    hudProgress.style.display = 'block';
  };

  // ── 線索筆記本(Tab 開關):把找過的線索留存,方便玩家回頭對照數字 ──
  const notebook = document.createElement('div');
  notebook.style.cssText = [
    'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%) scale(.92)',
    'z-index:19', 'width:min(440px,86vw)', 'max-height:70vh', 'overflow-y:auto',
    'background:rgba(28,20,12,.97)', 'border:2px solid #e0a458', 'border-radius:14px',
    'padding:20px 22px', 'color:#e8dcc8', 'font:14px/1.6 monospace',
    'box-shadow:0 10px 50px rgba(0,0,0,.75)', 'display:none', 'opacity:0',
    'transition:opacity .18s, transform .18s', 'user-select:none',
  ].join(';');
  const nbTitle = document.createElement('div');
  nbTitle.style.cssText =
    'color:#e0a458;font-weight:bold;font-size:17px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center';
  nbTitle.innerHTML = '<span>📖 線索筆記本</span><span style="font-size:11px;color:#8a7a60">Tab 關閉</span>';
  const nbList = document.createElement('div');
  notebook.append(nbTitle, nbList);
  document.body.appendChild(notebook);
  let notebookOpen = false;
  const renderNotebook = (clues: { emoji: string; text: string }[]) => {
    if (clues.length === 0) {
      nbList.innerHTML =
        '<div style="color:#8a7a60;text-align:center;padding:16px 0">還沒找到任何線索。<br>靠近發亮的物件按 E 收集。</div>';
      return;
    }
    nbList.innerHTML = clues
      .map(
        (c) =>
          `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid #3a2c1a"><span style="font-size:20px;flex:0 0 auto">${c.emoji}</span><span>${c.text}</span></div>`,
      )
      .join('');
  };
  const setNotebook = (open: boolean, clues: { emoji: string; text: string }[]) => {
    notebookOpen = open;
    if (open) {
      renderNotebook(clues);
      notebook.style.display = 'block';
      requestAnimationFrame(() => {
        notebook.style.opacity = '1';
        notebook.style.transform = 'translate(-50%,-50%) scale(1)';
      });
    } else {
      notebook.style.opacity = '0';
      notebook.style.transform = 'translate(-50%,-50%) scale(.92)';
      setTimeout(() => {
        if (!notebookOpen) notebook.style.display = 'none';
      }, 180);
    }
  };
  const isNotebookOpen = () => notebookOpen;

  // ── 密碼輸入 modal(置中,含數字鍵盤)──
  let modalOpen = false;
  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:20', 'display:none',
    'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,.6)', 'backdrop-filter:blur(2px)',
  ].join(';');
  const box = document.createElement('div');
  box.style.cssText = [
    'background:#211a10', 'border:2px solid #e0a458', 'border-radius:14px',
    'padding:22px 24px', 'min-width:280px', 'color:#e8dcc8',
    'font:14px/1.5 monospace', 'box-shadow:0 8px 40px rgba(0,0,0,.7)', 'text-align:center',
  ].join(';');
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const pwTitle = document.createElement('div');
  pwTitle.style.cssText = 'color:#e0a458;font-weight:bold;font-size:18px;margin-bottom:4px';
  const pwHint = document.createElement('div');
  pwHint.style.cssText = 'color:#c8bca8;font-size:12px;margin-bottom:14px';
  const pwDisplay = document.createElement('div');
  pwDisplay.style.cssText =
    'font-size:30px;letter-spacing:12px;min-height:40px;color:#ffe8c8;margin-bottom:14px;transition:transform .06s';
  const pad = document.createElement('div');
  pad.style.cssText = 'display:grid;grid-template-columns:repeat(3,60px);gap:8px;justify-content:center';
  box.append(pwTitle, pwHint, pwDisplay, pad);

  let pwState = { code: '', length: 3, onSubmit: (_: string) => false, onCancel: () => {} };
  const renderPwDisplay = () => {
    const shown = pwState.code.padEnd(pwState.length, '·');
    pwDisplay.textContent = shown.split('').join(' ');
  };
  const shake = () => {
    pwDisplay.animate(
      [
        { transform: 'translateX(0)' }, { transform: 'translateX(-8px)' },
        { transform: 'translateX(8px)' }, { transform: 'translateX(-6px)' },
        { transform: 'translateX(6px)' }, { transform: 'translateX(0)' },
      ],
      { duration: 260 },
    );
    pwDisplay.style.color = '#ff8a7a';
    window.setTimeout(() => (pwDisplay.style.color = '#ffe8c8'), 320);
  };
  const closePw = () => {
    modalOpen = false;
    overlay.style.display = 'none';
  };
  const pressDigit = (d: string) => {
    if (pwState.code.length >= pwState.length) return;
    pwState.code += d;
    renderPwDisplay();
    if (pwState.code.length === pwState.length) {
      // 湊滿自動送出
      window.setTimeout(submitPw, 120);
    }
  };
  const backspacePw = () => {
    pwState.code = pwState.code.slice(0, -1);
    renderPwDisplay();
  };
  const submitPw = () => {
    if (pwState.code.length !== pwState.length) return;
    const ok = pwState.onSubmit(pwState.code);
    if (ok) {
      closePw();
    } else {
      shake();
      pwState.code = '';
      renderPwDisplay();
    }
  };
  // 數字鍵盤 1-9,0,⌫,✓
  const padKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];
  for (const k of padKeys) {
    const b = document.createElement('button');
    b.textContent = k;
    b.style.cssText =
      'height:48px;border:1px solid #4a3a26;border-radius:8px;cursor:pointer;font:20px monospace;background:#2e2418;color:#e8dcc8';
    b.onmousedown = (e) => e.preventDefault(); // 不搶焦點
    b.onclick = () => {
      if (k === '⌫') backspacePw();
      else if (k === '✓') submitPw();
      else pressDigit(k);
    };
    pad.appendChild(b);
  }
  const openPassword = (p: PasswordPrompt) => {
    pwState = { code: '', length: p.length, onSubmit: p.onSubmit, onCancel: p.onCancel };
    pwTitle.textContent = p.title;
    pwHint.textContent = p.hint ?? `輸入 ${p.length} 位數字`;
    renderPwDisplay();
    modalOpen = true;
    overlay.style.display = 'flex';
  };
  // modal 專屬鍵盤:數字 / Backspace / Enter / Esc(捕獲階段攔截,不讓遊戲 window 監聽收到)
  window.addEventListener(
    'keydown',
    (e) => {
      if (!modalOpen) return;
      if (e.key >= '0' && e.key <= '9') {
        pressDigit(e.key);
      } else if (e.key === 'Backspace') {
        backspacePw();
      } else if (e.key === 'Enter') {
        submitPw();
      } else if (e.key === 'Escape') {
        closePw();
        pwState.onCancel();
      }
      e.stopPropagation();
      e.preventDefault();
    },
    true, // capture:早於遊戲的 window keydown
  );
  const isModalOpen = () => modalOpen;

  // ── 過關/破關全螢幕 ──
  const completeOverlay = document.createElement('div');
  completeOverlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:22', 'display:none',
    'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:18px',
    'background:rgba(10,7,4,.92)', 'color:#ffe8c8', 'font:16px/1.6 monospace', 'text-align:center',
  ].join(';');
  const cTitle = document.createElement('div');
  cTitle.style.cssText = 'color:#e0a458;font-weight:bold;font-size:34px';
  const cBody = document.createElement('div');
  cBody.style.cssText = 'max-width:min(80vw,480px);color:#e8dcc8';
  // 成績單:用時 / 步數 / 評級(帶 stats 才顯示)。評級字色隨等級變(S 金、A 綠…)
  const cStats = document.createElement('div');
  cStats.style.cssText = [
    'display:none', 'margin-top:4px', 'padding:14px 22px',
    'background:rgba(40,28,16,.7)', 'border:1px solid #6a5334', 'border-radius:12px',
    'font:15px/1.9 monospace', 'color:#e8dcc8', 'min-width:210px',
  ].join(';');
  const GRADE_COLOR: Record<string, string> = {
    S: '#ffd35a', A: '#8ad86e', B: '#7ec9e0', C: '#c8b79a',
  };
  // 歷史最佳紀錄行(全破畫面用):破紀錄時整行金色 + 🏆 徽章
  const cBest = document.createElement('div');
  cBest.style.cssText = 'display:none;font-size:13px;color:#a89878;margin-top:-6px';
  const cBtn = document.createElement('button');
  cBtn.style.cssText =
    'margin-top:8px;padding:10px 24px;border:1px solid #e0a458;border-radius:8px;cursor:pointer;font:16px monospace;background:#e0a458;color:#1a1410;font-weight:bold';
  // 破關「再玩一次」次要按鈕:破關畫面是死路,沒它玩家只能改網址重來
  const cRestart = document.createElement('button');
  cRestart.style.cssText =
    'margin-top:2px;padding:8px 20px;border:1px solid #7a6547;border-radius:8px;cursor:pointer;font:14px monospace;background:transparent;color:#c8b79a';
  cRestart.textContent = '↻ 再玩一次';
  completeOverlay.append(cTitle, cBody, cStats, cBest, cBtn, cRestart);
  document.body.appendChild(completeOverlay);
  const showLevelComplete = (
    info: {
      title: string;
      body: string;
      onNext?: () => void;
      onRestart?: () => void;
      stats?: { elapsedMs: number; steps: number; grade: string };
      best?: {
        elapsedMs: number;
        steps: number;
        grade: string;
        isNew: boolean;
        firstClear?: boolean;
      };
    } | null,
  ) => {
    if (!info) {
      completeOverlay.style.display = 'none';
      return;
    }
    cTitle.textContent = info.title;
    cBody.textContent = info.body;
    if (info.stats) {
      const gc = GRADE_COLOR[info.stats.grade] ?? '#c8b79a';
      cStats.innerHTML = [
        `<div>⏱ 用時　<span style="color:#ffe8c8">${fmtTime(info.stats.elapsedMs)}</span></div>`,
        `<div>👣 步數　<span style="color:#ffe8c8">${info.stats.steps}</span></div>`,
        `<div>🏅 評級　<span style="color:${gc};font-weight:bold;font-size:22px">${info.stats.grade}</span></div>`,
      ].join('');
      cStats.style.display = 'block';
    } else {
      cStats.style.display = 'none';
    }
    if (info.best) {
      const b = info.best;
      if (b.firstClear) {
        cBest.innerHTML = `<span style="color:#ffd35a;font-weight:bold">🏆 首次通關 · 已記錄!</span>`;
      } else if (b.isNew) {
        cBest.innerHTML = `<span style="color:#ffd35a;font-weight:bold">🏆 新紀錄!</span> 前一次最佳 ${fmtTime(b.elapsedMs)} · ${b.steps} 步 · ${b.grade}`;
      } else {
        cBest.innerHTML = `🏆 最佳紀錄　${fmtTime(b.elapsedMs)} · ${b.steps} 步 · ${b.grade}`;
      }
      cBest.style.display = 'block';
    } else {
      cBest.style.display = 'none';
    }
    if (info.onNext) {
      cBtn.style.display = 'block';
      cBtn.textContent = '前往下一關 ▶';
      cBtn.onclick = () => {
        completeOverlay.style.display = 'none';
        info.onNext?.();
      };
    } else {
      cBtn.style.display = 'none';
    }
    if (info.onRestart) {
      cRestart.style.display = 'block';
      cRestart.onclick = () => {
        completeOverlay.style.display = 'none';
        info.onRestart?.();
      };
    } else {
      cRestart.style.display = 'none';
    }
    completeOverlay.style.display = 'flex';
  };

  // ── 開場簡報(進遊戲第一眼):框住「密室逃脫」前提 + 操作,按鈕才開始 ──
  const introOverlay = document.createElement('div');
  introOverlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:24', 'display:none',
    'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:16px',
    'background:rgba(8,6,4,.95)', 'color:#e8dcc8', 'font:15px/1.7 monospace', 'text-align:center',
  ].join(';');
  const introInner = document.createElement('div');
  introInner.style.cssText = 'max-width:min(86vw,460px);padding:0 20px';
  introInner.innerHTML = [
    '<div style="font-size:34px;font-weight:bold;color:#e0a458;margin-bottom:4px">🔐 密室逃脫</div>',
    '<div style="color:#8a7a60;margin-bottom:18px">數字解謎 · 逐關脫逃</div>',
    '<div style="text-align:left;line-height:1.9">',
    '你被鎖在一連串房間裡。每一關的門都上了<b>數字密碼鎖</b>,',
    '線索藏在房間的物件與機關中。',
    '<br><br>',
    '<span style="color:#ffd27a">WASD</span> 移動 · ',
    '<span style="color:#ffd27a">E</span> 靠近發亮物件看線索 / 開鎖門 · ',
    '<span style="color:#ffd27a">Tab</span> 翻線索筆記本',
    '<br><br>找齊線索、算出密碼,打開每一道門逃出去。',
    '</div>',
  ].join('');
  const introBtn = document.createElement('button');
  introBtn.style.cssText =
    'margin-top:8px;padding:12px 32px;border:1px solid #e0a458;border-radius:8px;cursor:pointer;font:16px monospace;background:#e0a458;color:#1a1410;font-weight:bold';
  introBtn.textContent = '開始逃脫 ▶';
  introOverlay.append(introInner, introBtn);
  document.body.appendChild(introOverlay);
  let introOpen = false;
  const showIntro = (onStart: () => void) => {
    introOpen = true;
    introOverlay.style.display = 'flex';
    const start = () => {
      introOpen = false;
      introOverlay.style.display = 'none';
      window.removeEventListener('keydown', onKey, true);
      onStart();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        start();
      }
    };
    introBtn.onclick = start;
    window.addEventListener('keydown', onKey, true); // capture:別讓遊戲 window 也收到
  };
  const isIntroOpen = () => introOpen;

  return {
    setBag,
    setExitPrompt,
    setActionPrompt,
    showToast,
    setLevel,
    setProgress,
    setStats,
    setNotebook,
    isNotebookOpen,
    openPassword,
    isModalOpen,
    showLevelComplete,
    setPuzzleMode,
    showIntro,
    isIntroOpen,
  };
}
