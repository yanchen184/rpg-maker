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
  /** 開密碼輸入面板(置中 modal);開啟期間 isModalOpen() 為 true,main 應 gate 掉遊戲操作 */
  openPassword: (p: PasswordPrompt) => void;
  /** modal(密碼面板)是否開啟中 — main 用來 gate 遊戲鍵盤/移動 */
  isModalOpen: () => boolean;
  /** 過關/破關全螢幕畫面(傳 null 關閉) */
  showLevelComplete: (info: { title: string; body: string; onNext?: () => void } | null) => void;
}

const BTN_CSS =
  'border:1px solid #4a3a26;border-radius:6px;padding:3px 8px;cursor:pointer;font:12px monospace;background:#2e2418;color:#e8dcc8';

export function buildUi(opts: UiOptions): UiHandle {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:10',
    'background:rgba(20,14,8,.88)', 'border:1px solid #4a3a26', 'border-radius:10px',
    'padding:12px 14px', 'color:#e8dcc8', 'font:13px/1.6 monospace', 'user-select:none',
    'min-width:190px', 'max-height:calc(100vh - 24px)', 'overflow-y:auto',
  ].join(';');

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
  const hudName = document.createElement('div');
  hudName.style.cssText = 'color:#e0a458;font-weight:bold;font-size:15px;margin-bottom:3px';
  const hudHint = document.createElement('div');
  hudHint.style.cssText = 'color:#c8bca8;font-size:12px';
  hud.append(hudName, hudHint);
  document.body.appendChild(hud);
  const setLevel = (info: { name: string; hint: string } | null) => {
    if (!info) {
      hud.style.display = 'none';
      return;
    }
    hudName.textContent = info.name;
    hudHint.textContent = info.hint;
    hud.style.display = 'block';
  };

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
  const cBtn = document.createElement('button');
  cBtn.style.cssText =
    'margin-top:8px;padding:10px 24px;border:1px solid #e0a458;border-radius:8px;cursor:pointer;font:16px monospace;background:#e0a458;color:#1a1410;font-weight:bold';
  completeOverlay.append(cTitle, cBody, cBtn);
  document.body.appendChild(completeOverlay);
  const showLevelComplete = (
    info: { title: string; body: string; onNext?: () => void } | null,
  ) => {
    if (!info) {
      completeOverlay.style.display = 'none';
      return;
    }
    cTitle.textContent = info.title;
    cBody.textContent = info.body;
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
    completeOverlay.style.display = 'flex';
  };

  return {
    setBag,
    setExitPrompt,
    setActionPrompt,
    showToast,
    setLevel,
    openPassword,
    isModalOpen,
    showLevelComplete,
  };
}
