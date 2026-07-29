/**
 * 觸控操作層:讓這款球場遊戲在手機上直接可玩(之後包 iOS 也吃同一套)。
 *
 * 設計原則 —— 不動遊戲邏輯,只補一個輸入來源:
 * 左手虛擬搖桿寫進 main.ts 那份 `held` 鍵集(等同「按住 WASD」),右手動作鍵直接呼叫
 * `onSwing` / `onDash`。因此瞄準、招式、冷卻、發球儀式全部沿用鍵盤那條路徑,
 * 手機與桌機在規則上不可能漂移 —— 手機不是另一套玩法,是另一組按鍵。
 */

/** 搖桿推到多遠才算「按住那個方向」(佔搖桿半徑比例);太小會誤觸、太大會鈍 */
const STICK_DEADZONE = 0.28;
/** 搖桿視覺半徑(px);拇指可及範圍,拉太大反而要挪手腕 */
const STICK_R = 56;

export interface TouchControlOpts {
  /** main.ts 的按鍵集合:瞄準與閃身方向讀這份 */
  held: Set<string>;
  /**
   * 走位:引擎 Player 自己持有一份鍵集(直接綁 window 鍵盤事件),與上面的 `held` 是兩份。
   * 所以搖桿要同時餵兩邊 —— 只餵 held 的話,人瞄得動卻走不動。
   */
  setMoveKey: (key: string, down: boolean) => void;
  onSwing: (kind: 'normal' | 'drive' | 'lob' | 'slice' | 'smash') => void;
  onDash: () => void;
  /** 球夠高就把 J 升級成殺球 —— 與鍵盤同一條判斷,不另立規則 */
  canSmash: () => boolean;
}

/**
 * 有沒有觸控:桌機不該被塞一堆半透明按鈕,所以要判斷。
 * 三個訊號取聯集(任一成立就算),因為單一訊號都會漏:
 *   - `pointer: coarse` / `maxTouchPoints`:真機最可靠,但桌面瀏覽器的裝置模擬常不打開
 *   - iOS/Android UA:補上「模擬器有手機 UA 卻沒開觸控」那一格
 * `?touch=1` / `?touch=0` 可強制開關 —— 給模擬器驗收用,也給誤判的裝置一條後路。
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches === true) return true;
  if (navigator.maxTouchPoints > 0) return true;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * 掛上觸控 UI。回傳解除函式(單頁切模式時可拆掉)。
 * 只在觸控裝置呼叫;桌機呼叫也不會壞,但沒必要。
 */
export function setupTouchControls(o: TouchControlOpts): () => void {
  // 手機版 HUD(記分板縮小、提示列移到上方、氣力槽讓開拇指區、直向轉橫提示)靠這個 class 生效。
  // CSS 那邊同時有 `@media (pointer: coarse)` 版本;真機兩條都中,模擬器只中這條。
  document.body.classList.add('touch-mode');

  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.innerHTML = `
    <div id="touch-stick"><div id="touch-stick-knob"></div></div>
    <div id="touch-btns">
      <button class="tbtn tbtn-sm" data-act="slice">切</button>
      <button class="tbtn tbtn-sm" data-act="lob">挑</button>
      <button class="tbtn tbtn-sm" data-act="drive">抽</button>
      <button class="tbtn tbtn-dash" data-act="dash">閃</button>
      <button class="tbtn tbtn-hit" data-act="normal">擊球</button>
    </div>`;
  document.body.appendChild(root);

  const stick = root.querySelector<HTMLElement>('#touch-stick')!;
  const knob = root.querySelector<HTMLElement>('#touch-stick-knob')!;

  /** 搖桿目前壓住的方向鍵;換方向時要把舊的放掉,否則會卡住一直往某邊走 */
  let stickKeys: string[] = [];
  const releaseStick = (): void => {
    for (const k of stickKeys) {
      o.held.delete(k);
      o.setMoveKey(k, false);
    }
    stickKeys = [];
  };
  const applyStick = (dx: number, dy: number): void => {
    const len = Math.hypot(dx, dy);
    const next: string[] = [];
    if (len >= STICK_R * STICK_DEADZONE) {
      // 用比例而非角度分區:斜推時兩個方向可以同時成立(跟鍵盤同時按 W+D 一樣)
      const nx = dx / len;
      const ny = dy / len;
      if (nx > 0.38) next.push('d');
      else if (nx < -0.38) next.push('a');
      if (ny > 0.38) next.push('s');
      else if (ny < -0.38) next.push('w');
    }
    for (const k of stickKeys) {
      if (next.includes(k)) continue;
      o.held.delete(k);
      o.setMoveKey(k, false);
    }
    for (const k of next) {
      o.held.add(k);
      o.setMoveKey(k, true);
    }
    stickKeys = next;
    // 旋鈕視覺:限制在搖桿半徑內,推到底就停在邊緣
    const clamp = len > STICK_R ? STICK_R / len : 1;
    knob.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`;
  };

  let stickId: number | null = null;
  let originX = 0;
  let originY = 0;

  const onStickDown = (e: PointerEvent): void => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    originX = r.left + r.width / 2;
    originY = r.top + r.height / 2;
    applyStick(e.clientX - originX, e.clientY - originY);
    e.preventDefault();
  };
  const onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    applyStick(e.clientX - originX, e.clientY - originY);
    e.preventDefault();
  };
  const onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    releaseStick();
    knob.style.transform = 'translate(0px, 0px)';
    e.preventDefault();
  };

  stick.addEventListener('pointerdown', onStickDown);
  stick.addEventListener('pointermove', onStickMove);
  stick.addEventListener('pointerup', onStickUp);
  stick.addEventListener('pointercancel', onStickUp);

  /**
   * 動作鍵走 pointerdown 而非 click:click 在行動瀏覽器有 ~300ms 延遲與二次觸發,
   * 對「球飛過來的那一刻要按下去」的遊戲是致命的。
   */
  const onBtnDown = (e: PointerEvent): void => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.tbtn');
    if (!btn) return;
    e.preventDefault();
    const act = btn.dataset.act;
    if (act === 'dash') o.onDash();
    else if (act === 'drive') o.onSwing(o.canSmash() ? 'smash' : 'drive');
    else if (act === 'lob') o.onSwing('lob');
    else if (act === 'slice') o.onSwing('slice');
    else o.onSwing('normal');
    btn.classList.add('on');
    setTimeout(() => btn.classList.remove('on'), 110);
  };
  root.addEventListener('pointerdown', onBtnDown);

  return () => {
    releaseStick();
    root.remove();
    document.body.classList.remove('touch-mode');
  };
}
