/**
 * 本機對戰的連線層替身:跟 TennisNet 同一套介面(結構相容),但不碰 Firebase ——
 * send* 直接 echo 回本頁 handler。AI 模式/觀戰模式整場都在同一頁模擬,
 * main.ts 的同步接線一行都不用改,只是把雲換成迴音壁。
 */
import type { Shot } from './ball';
import type { Score, Side } from './scoring';
import type { PlayerState } from './net-tennis';

/** main.ts 依賴的連線層形狀(TennisNet 結構相容) */
export interface MatchNet {
  now(): number;
  join(): Promise<Side>;
  push(state: { x: number; y: number; dir: string }): void;
  sendShot(shot: Shot): void;
  clearShot(): void;
  sendScore(score: Score): void;
  onPeer: (st: PlayerState | null) => void;
  onShot: (shot: Shot | null) => void;
  onScore: (score: Score | null) => void;
}

export class LocalNet implements MatchNet {
  // 跟 TennisNet 同款快照快取:handler 晚掛上也吃得到最後狀態
  private _onShot: (shot: Shot | null) => void = () => {};
  private _onScore: (score: Score | null) => void = () => {};
  private shotCache: { seen: boolean; val: Shot | null } = { seen: false, val: null };
  private scoreCache: { seen: boolean; val: Score | null } = { seen: false, val: null };

  set onPeer(_fn: (st: PlayerState | null) => void) {
    // 本機模式沒有對端;AI 的位置由 main 直接餵給 RemotePlayer,不走 peer channel
  }

  set onShot(fn: (shot: Shot | null) => void) {
    this._onShot = fn;
    if (this.shotCache.seen) fn(this.shotCache.val);
  }

  set onScore(fn: (score: Score | null) => void) {
    this._onScore = fn;
    if (this.scoreCache.seen) fn(this.scoreCache.val);
  }

  now(): number {
    return Date.now();
  }

  join(): Promise<Side> {
    return Promise.resolve('left');
  }

  push(): void {
    // 本機模式沒有對端要同步位置
  }

  sendShot(shot: Shot): void {
    this.shotCache = { seen: true, val: shot };
    this._onShot(shot);
  }

  clearShot(): void {
    this.shotCache = { seen: true, val: null };
    this._onShot(null);
  }

  sendScore(score: Score): void {
    this.scoreCache = { seen: true, val: score };
    this._onScore(score);
  }
}
