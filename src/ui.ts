/** 遊戲頁右上角控制面板(純 DOM,疊在 canvas 上):髮色切換 + 場景編輯模式 + 匯出 JSON */

export interface UiOptions {
  /** 可用髮色:label 顯示文字,name 為 manifest 層名(null = 原色,拿掉 overlay) */
  hairs: { label: string; name: string | null }[];
  defaultHair: string | null;
  onHair: (name: string | null) => void;
  onEditToggle: (on: boolean) => void;
  exportJson: () => string;
}

export function buildUi(opts: UiOptions): void {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:10',
    'background:rgba(20,14,8,.88)', 'border:1px solid #4a3a26', 'border-radius:10px',
    'padding:12px 14px', 'color:#e8dcc8', 'font:13px/1.6 monospace', 'user-select:none',
    'min-width:190px',
  ].join(';');

  const title = (t: string, first = false) => {
    const el = document.createElement('div');
    el.textContent = t;
    el.style.cssText = `color:#e0a458;margin:${first ? 0 : 10}px 0 4px;font-weight:bold`;
    panel.appendChild(el);
    return el;
  };

  // 髮色
  title('髮色(紙娃娃)', true);
  const hairRow = document.createElement('div');
  hairRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
  panel.appendChild(hairRow);
  const hairBtns = new Map<string | null, HTMLButtonElement>();
  const markHair = (active: string | null) => {
    for (const [name, b] of hairBtns) {
      b.style.background = name === active ? '#e0a458' : '#2e2418';
      b.style.color = name === active ? '#1a1410' : '#e8dcc8';
    }
  };
  for (const h of opts.hairs) {
    const b = document.createElement('button');
    b.textContent = h.label;
    b.style.cssText =
      'border:1px solid #4a3a26;border-radius:6px;padding:3px 8px;cursor:pointer;font:12px monospace;background:#2e2418;color:#e8dcc8';
    b.onclick = () => {
      opts.onHair(h.name);
      markHair(h.name);
    };
    hairBtns.set(h.name, b);
    hairRow.appendChild(b);
  }
  markHair(opts.defaultHair);

  // 編輯模式
  title('場景');
  const editBtn = document.createElement('button');
  editBtn.style.cssText =
    'width:100%;border:1px solid #4a3a26;border-radius:6px;padding:5px 8px;cursor:pointer;font:12px monospace;background:#2e2418;color:#e8dcc8';
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
  exportBtn.style.cssText =
    'display:none;width:100%;margin-top:6px;border:1px solid #4a3a26;border-radius:6px;padding:5px 8px;cursor:pointer;font:12px monospace;background:#2e2418;color:#e8dcc8';
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

  const hint = document.createElement('div');
  hint.textContent = 'WASD / 方向鍵移動';
  hint.style.cssText = 'color:#a89878;margin-top:8px;font-size:11px';
  panel.appendChild(hint);

  document.body.appendChild(panel);
}
