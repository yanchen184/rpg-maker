/**
 * 多人連線(presence):把本地玩家的位置/朝向/所在場景廣播到 Firebase RTDB,
 * 並訂閱其他玩家的狀態。只做「位置廣播」,不做權威伺服器 —— 每個 client 各自渲染別人。
 *
 * 資料結構(RTDB):
 *   rpg-maker/presence/<clientId> = { x, y, dir, scene, name, ts }
 * 離線時 onDisconnect 自動移除自己那筆。
 */
import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp,
  type Database,
} from 'firebase/database';
import { firebaseConfig, PRESENCE_ROOT } from './firebase-config';

/**
 * peer 存活門檻:超過這麼久沒心跳的 presence 視為死節點,不渲染。
 * 硬關分頁 / 當機時 onDisconnect 不一定觸發,會在 RTDB 留下永久 ghost,
 * 讀取端一律用 ts 過濾,才不會有陌生「訪客」卡在別人的解謎房間裡。
 * 心跳每 ~2s 一次(見 push()),30s = 容忍 ~15 次漏跳。
 */
const PEER_TTL_MS = 30_000;

export interface PeerState {
  x: number;
  y: number;
  /** 朝向:down / left / right / up */
  dir: string;
  /** 所在場景名(只渲染同場景的人) */
  scene: string;
  name: string;
  ts: number;
}

export interface LocalState {
  x: number;
  y: number;
  dir: string;
  scene: string;
}

/** 隨機 client id(每個分頁一個) */
function makeClientId(): string {
  const rand = Math.floor(performance.now() * 1000) % 100000;
  return `p-${rand}-${Math.floor(performance.timeOrigin) % 100000}`;
}

/** 隨機給個玩家名(訪客 xxx),之後可接輸入框 */
function makeName(id: string): string {
  return `訪客${id.slice(-4)}`;
}

export class Net {
  private db: Database;
  readonly clientId: string;
  readonly name: string;
  private selfRef;
  /** 其他玩家最新狀態(不含自己) */
  peers: Record<string, PeerState> = {};
  /** 節流:上次寫入的內容與時間 */
  private lastSent = '';
  private lastSentAt = 0;

  constructor() {
    const app = initializeApp(firebaseConfig);
    this.db = getDatabase(app);
    this.clientId = makeClientId();
    this.name = makeName(this.clientId);
    this.selfRef = ref(this.db, `${PRESENCE_ROOT}/${this.clientId}`);
    // 一連上就掛 onDisconnect:斷線/關頁自動清掉自己
    onDisconnect(this.selfRef).remove();
    // 訂閱全體 presence,濾掉自己
    const rootRef = ref(this.db, PRESENCE_ROOT);
    onValue(rootRef, (snap) => {
      const all = (snap.val() ?? {}) as Record<string, PeerState>;
      const nowMs = Date.now();
      const next: Record<string, PeerState> = {};
      for (const [id, st] of Object.entries(all)) {
        if (id === this.clientId || !st) continue;
        // ts 是伺服器時間(number);剛寫入時可能還是 serverTimestamp 佔位(非 number),
        // 那種視為剛上線放行,只擋「有明確舊時戳」的死節點。
        if (typeof st.ts === 'number' && nowMs - st.ts > PEER_TTL_MS) continue;
        next[id] = st;
      }
      this.peers = next;
    });
  }

  /** 廣播本地狀態(節流:內容有變、或每 2 秒心跳一次) */
  push(state: LocalState): void {
    const key = `${Math.round(state.x)},${Math.round(state.y)},${state.dir},${state.scene}`;
    const now = performance.now();
    if (key === this.lastSent && now - this.lastSentAt < 2000) return;
    this.lastSent = key;
    this.lastSentAt = now;
    void set(this.selfRef, {
      x: Math.round(state.x),
      y: Math.round(state.y),
      dir: state.dir,
      scene: state.scene,
      name: this.name,
      ts: serverTimestamp(),
    });
  }
}
