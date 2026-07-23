/**
 * 網球連線層(Firebase RTDB):房間配對 + 三種同步資料。
 *
 * 資料結構:settings/rpg-maker-tennis/<room>/
 *   players/bottom|top = { id, x, y, dir, ts }   位置心跳(節流;onDisconnect 自清)
 *   shot               = Shot | null             最新一次擊球事件(確定性軌跡參數)
 *   score              = Score | null            計分快照(得分裁定方整包覆寫)
 *
 * 時間同步:球軌跡吃「server 時間」,用 RTDB 內建 `.info/serverTimeOffset` 校正本機時鐘,
 * 兩端 now() 各自對齊 Firebase server,不需要互相對錶。
 */
import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set,
  runTransaction,
  serverTimestamp,
  type Database,
  type DatabaseReference,
} from 'firebase/database';
import { firebaseConfig, TENNIS_ROOT } from './firebase-config';
import type { Shot } from './ball';
import type { Score, Side } from './scoring';
import { otherSide } from './scoring';

/** 槽位存活門檻:心跳每 ~2s,逾時視為死槽可被搶(硬關分頁 onDisconnect 不一定觸發) */
const SLOT_TTL_MS = 15_000;

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  dir: string;
  ts: number;
}

function makeClientId(): string {
  const rand = Math.floor(performance.now() * 1000) % 100000;
  return `p-${rand}-${Math.floor(performance.timeOrigin) % 100000}`;
}

export class TennisNet {
  readonly clientId: string;
  readonly room: string;
  side: Side | null = null;

  /**
   * 三個訂閱 channel 的 handler。Firebase 初始快照常在 join 後、場景資產還在載時就到,
   * 若 handler 那時還沒掛上會被吞掉且不再重送 —— 所以快照一律先快取,
   * handler 之後才掛上時立刻用快取重放一次(setter),不吃註冊時序。
   */
  private _onPeer: (st: PlayerState | null) => void = () => {};
  private _onShot: (shot: Shot | null) => void = () => {};
  private _onScore: (score: Score | null) => void = () => {};
  private peerCache: { seen: boolean; val: PlayerState | null } = { seen: false, val: null };
  private shotCache: { seen: boolean; val: Shot | null } = { seen: false, val: null };
  private scoreCache: { seen: boolean; val: Score | null } = { seen: false, val: null };

  set onPeer(fn: (st: PlayerState | null) => void) {
    this._onPeer = fn;
    if (this.peerCache.seen) fn(this.peerCache.val);
  }

  set onShot(fn: (shot: Shot | null) => void) {
    this._onShot = fn;
    if (this.shotCache.seen) fn(this.shotCache.val);
  }

  set onScore(fn: (score: Score | null) => void) {
    this._onScore = fn;
    if (this.scoreCache.seen) fn(this.scoreCache.val);
  }

  private db: Database;
  private offset = 0;
  private selfRef: DatabaseReference | null = null;
  private lastSent = '';
  private lastSentAt = 0;

  constructor(room: string) {
    const app = initializeApp(firebaseConfig);
    this.db = getDatabase(app);
    this.clientId = makeClientId();
    this.room = room;
    onValue(ref(this.db, '.info/serverTimeOffset'), (snap) => {
      this.offset = (snap.val() as number | null) ?? 0;
    });
  }

  /** 校正後的 server 時間(球軌跡的時間軸) */
  now(): number {
    return Date.now() + this.offset;
  }

  private get base(): string {
    return `${TENNIS_ROOT}/${this.room}`;
  }

  /** 搶槽位:先 bottom 後 top;transaction 防兩人同時搶同槽。都滿 → 丟錯 */
  async join(): Promise<Side> {
    for (const side of ['bottom', 'top'] as Side[]) {
      const r = ref(this.db, `${this.base}/players/${side}`);
      const res = await runTransaction(r, (cur: PlayerState | null) => {
        // 槽位有人且還活著 → 放棄這槽(回 undefined 中止)
        if (cur && cur.id && cur.id !== this.clientId && this.now() - (cur.ts ?? 0) < SLOT_TTL_MS) {
          return undefined;
        }
        return { id: this.clientId, x: 0, y: 0, dir: 'down', ts: { '.sv': 'timestamp' } };
      });
      const claimed = (res.snapshot.val() as PlayerState | null)?.id === this.clientId;
      if (res.committed && claimed) {
        this.side = side;
        this.selfRef = r;
        void onDisconnect(r).remove();
        this.watch(side);
        return side;
      }
    }
    throw new Error('房間已滿(已有兩位玩家)');
  }

  private watch(side: Side): void {
    const peerRef = ref(this.db, `${this.base}/players/${otherSide(side)}`);
    onValue(peerRef, (snap) => {
      const st = snap.val() as PlayerState | null;
      // 死槽視同無人(ts 是 server 時間,用校正後 now 比)
      const live = st && st.id && this.now() - (st.ts ?? 0) <= SLOT_TTL_MS ? st : null;
      this.peerCache = { seen: true, val: live };
      this._onPeer(live);
    });
    onValue(ref(this.db, `${this.base}/shot`), (snap) => {
      const shot = snap.val() as Shot | null;
      this.shotCache = { seen: true, val: shot };
      this._onShot(shot);
    });
    onValue(ref(this.db, `${this.base}/score`), (snap) => {
      const score = snap.val() as Score | null;
      this.scoreCache = { seen: true, val: score };
      this._onScore(score);
    });
  }

  /** 廣播本地位置(節流:內容有變、或每 2 秒心跳一次) */
  push(state: { x: number; y: number; dir: string }): void {
    if (!this.selfRef) return;
    const key = `${Math.round(state.x)},${Math.round(state.y)},${state.dir}`;
    const nowMs = performance.now();
    if (key === this.lastSent && nowMs - this.lastSentAt < 2000) return;
    this.lastSent = key;
    this.lastSentAt = nowMs;
    void set(this.selfRef, {
      id: this.clientId,
      x: Math.round(state.x),
      y: Math.round(state.y),
      dir: state.dir,
      ts: serverTimestamp(),
    });
  }

  sendShot(shot: Shot): void {
    void set(ref(this.db, `${this.base}/shot`), shot);
  }

  clearShot(): void {
    void set(ref(this.db, `${this.base}/shot`), null);
  }

  sendScore(score: Score): void {
    void set(ref(this.db, `${this.base}/score`), score);
  }
}
