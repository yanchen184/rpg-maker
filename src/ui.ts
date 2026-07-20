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

export interface UiHandle {
  /** 更新背包計數顯示 */
  setBag: (count: number) => void;
  /** 門口提示:傳字串顯示「按 E 離開」浮條,傳 null 隱藏 */
  setExitPrompt: (text: string | null) => void;
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
  hint.textContent = 'WASD / 方向鍵移動 · E 打招呼(門口=離開) · F 撿取 · G 上下車';
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

  return { setBag, setExitPrompt };
}
