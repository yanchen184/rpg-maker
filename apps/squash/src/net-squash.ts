import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  type Database,
  type DatabaseReference,
} from 'firebase/database';
import { firebaseConfig, SQUASH_ROOT } from './firebase-config';
import type { PlayerId, ShotKind } from './game-types';

const SLOT_TTL_MS = 15_000;
const INPUT_HEARTBEAT_MS = 1_500;

export interface OnlineInput {
  moveX: number;
  moveY: number;
  targetX: number;
  dashSeq: number;
  hitSeq: number;
  hitKind: ShotKind | null;
  rematchSeq: number;
  sentAt: number;
}

export interface OnlinePlayerState {
  x: number;
  y: number;
  energy: number;
  facing: number;
  dashUntil: number;
  dashTailUntil: number;
}

export interface OnlineBallState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  lastHitter: PlayerId | null;
  floorBounces: number;
  frontHit: boolean;
  ageSeconds: number;
  serveSide: -1 | 1 | null;
  serveAwaitingBounce: boolean;
}

export interface OnlineMatchSnapshot {
  seq: number;
  sentAt: number;
  players: Record<PlayerId, OnlinePlayerState>;
  ball: OnlineBallState;
  scores: Record<PlayerId, number>;
  server: PlayerId;
  serveSide: -1 | 1;
  rally: number;
  lastQuality: number;
  pointPauseLeftMs: number;
  nextServeLeftMs: number;
  matchWinner: PlayerId | null;
}

interface SlotState {
  id: string;
  ts: number;
}

function makeClientId(): string {
  return `sq-${crypto.randomUUID().slice(0, 12)}`;
}

export function sanitizeRoom(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
}

export function makeRoomCode(): string {
  return Math.random().toString(36).slice(2, 8);
}

export class SquashNet {
  readonly clientId = makeClientId();
  readonly room: string;
  side: PlayerId | null = null;

  private readonly db: Database;
  private offset = 0;
  private selfRef: DatabaseReference | null = null;
  private lastInputKey = '';
  private lastInputAt = 0;
  private peerCache: SlotState | null = null;
  private snapshotCache: OnlineMatchSnapshot | null = null;
  private inputCache: OnlineInput | null = null;
  private _onPeer: (state: SlotState | null) => void = () => {};
  private _onSnapshot: (state: OnlineMatchSnapshot | null) => void = () => {};
  private _onRemoteInput: (state: OnlineInput | null) => void = () => {};

  constructor(room: string) {
    this.room = sanitizeRoom(room);
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    this.db = getDatabase(app);
    onValue(ref(this.db, '.info/serverTimeOffset'), (snapshot) => {
      this.offset = (snapshot.val() as number | null) ?? 0;
    });
  }

  set onPeer(handler: (state: SlotState | null) => void) {
    this._onPeer = handler;
    handler(this.peerCache);
  }

  set onSnapshot(handler: (state: OnlineMatchSnapshot | null) => void) {
    this._onSnapshot = handler;
    handler(this.snapshotCache);
  }

  set onRemoteInput(handler: (state: OnlineInput | null) => void) {
    this._onRemoteInput = handler;
    handler(this.inputCache);
  }

  now(): number {
    return Date.now() + this.offset;
  }

  private get base(): string {
    return `${SQUASH_ROOT}/${this.room}`;
  }

  async join(): Promise<PlayerId> {
    for (const side of ['you', 'ai'] as const) {
      const slotRef = ref(this.db, `${this.base}/players/${side}`);
      const result = await runTransaction(slotRef, (current: SlotState | null) => {
        const occupied =
          current?.id &&
          current.id !== this.clientId &&
          this.now() - (current.ts ?? 0) < SLOT_TTL_MS;
        if (occupied) return undefined;
        return { id: this.clientId, ts: { '.sv': 'timestamp' } };
      });
      const claimed = (result.snapshot.val() as SlotState | null)?.id === this.clientId;
      if (!result.committed || !claimed) continue;
      this.side = side;
      this.selfRef = slotRef;
      void onDisconnect(slotRef).remove();
      const ownInputRef = ref(this.db, `${this.base}/inputs/${side}`);
      void onDisconnect(ownInputRef).remove();
      this.watch(side);
      return side;
    }
    throw new Error('ROOM_FULL');
  }

  private watch(side: PlayerId): void {
    const other: PlayerId = side === 'you' ? 'ai' : 'you';
    onValue(ref(this.db, `${this.base}/players/${other}`), (snapshot) => {
      const value = snapshot.val() as SlotState | null;
      const live = value?.id && this.now() - (value.ts ?? 0) <= SLOT_TTL_MS ? value : null;
      this.peerCache = live;
      this._onPeer(live);
    });
    onValue(ref(this.db, `${this.base}/state`), (snapshot) => {
      this.snapshotCache = snapshot.val() as OnlineMatchSnapshot | null;
      this._onSnapshot(this.snapshotCache);
    });
    if (side === 'you') {
      onValue(ref(this.db, `${this.base}/inputs/ai`), (snapshot) => {
        this.inputCache = snapshot.val() as OnlineInput | null;
        this._onRemoteInput(this.inputCache);
      });
    }
  }

  heartbeat(): void {
    if (!this.selfRef) return;
    void set(this.selfRef, { id: this.clientId, ts: serverTimestamp() });
  }

  sendInput(input: Omit<OnlineInput, 'sentAt'>): void {
    if (!this.side) return;
    const key = JSON.stringify(input);
    const now = performance.now();
    if (key === this.lastInputKey && now - this.lastInputAt < INPUT_HEARTBEAT_MS) return;
    this.lastInputKey = key;
    this.lastInputAt = now;
    void set(ref(this.db, `${this.base}/inputs/${this.side}`), {
      ...input,
      sentAt: serverTimestamp(),
    });
  }

  sendSnapshot(snapshot: Omit<OnlineMatchSnapshot, 'sentAt'>): void {
    if (this.side !== 'you') return;
    void set(ref(this.db, `${this.base}/state`), {
      ...snapshot,
      sentAt: serverTimestamp(),
    });
  }

  async clearRoomState(): Promise<void> {
    if (this.side !== 'you') return;
    await Promise.all([
      remove(ref(this.db, `${this.base}/state`)),
      remove(ref(this.db, `${this.base}/inputs`)),
    ]);
  }
}
