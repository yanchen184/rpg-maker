/**
 * 網球:確定性飛行 —— 一顆球的整段軌跡由 Shot 事件的參數完全決定,
 * 兩端 client 各自用「server 時間」代入同一組公式,不逐幀同步位置也能看到同一顆球。
 *
 * 軌跡分三段:
 *   flying  u∈[0,1]  地面投影從 (x0,y0) 直線到 (x1,y1),高度 h = 4·ARC_H·u·(1-u) 拋物線
 *   bounce  落地後小彈跳 BOUNCE_MS,沿原方向續行 BOUNCE_DIST 比例距離,apex BOUNCE_H
 *   dead    彈跳結束,死球(等接球判定/清場)
 */
import { Container, Graphics } from 'pixi.js';
import type { Side } from './scoring';

export interface Shot {
  /** 同一分內遞增;接收端用 (seq,t0) 去重 */
  seq: number;
  by: Side;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 擊球時刻(server 時間 ms) */
  t0: number;
  /** 飛行時長 ms */
  flightMs: number;
}

export type BallPhase = 'flying' | 'bounce' | 'dead';

const ARC_H = 120;
const BOUNCE_MS = 450;
const BOUNCE_DIST = 0.25;
const BOUNCE_H = 30;

export class Ball {
  view = new Container();
  /** 地面投影座標(判接球距離/深度排序用) */
  gx = 0;
  gy = 0;
  phase: BallPhase = 'dead';
  private shot: Shot | null = null;
  private ballG: Graphics;
  private shadowG: Graphics;

  constructor() {
    this.shadowG = new Graphics().ellipse(0, 0, 10, 5).fill({ color: 0x000000, alpha: 0.35 });
    this.ballG = new Graphics()
      .circle(0, 0, 9)
      .fill(0xd8ff3f)
      .circle(0, 0, 9)
      .stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
    this.view.addChild(this.shadowG, this.ballG);
    this.view.visible = false;
  }

  get currentShot(): Shot | null {
    return this.shot;
  }

  /** 開始播放一段擊球軌跡(同 seq+t0 的重複事件忽略,避免自己送的 shot echo 回來重播) */
  play(shot: Shot): void {
    if (this.shot && this.shot.seq === shot.seq && this.shot.t0 === shot.t0) return;
    this.shot = shot;
    this.phase = 'flying';
    this.view.visible = true;
  }

  clear(): void {
    this.shot = null;
    this.phase = 'dead';
    this.view.visible = false;
  }

  /** 依 server 時間推進;回傳當前段落 */
  update(serverNow: number): BallPhase {
    const s = this.shot;
    if (!s) return 'dead';
    const u = Math.max(0, (serverNow - s.t0) / s.flightMs);
    let h = 0;
    if (u <= 1) {
      this.phase = 'flying';
      this.gx = s.x0 + (s.x1 - s.x0) * u;
      this.gy = s.y0 + (s.y1 - s.y0) * u;
      h = 4 * ARC_H * u * (1 - u);
    } else {
      const v = (serverNow - s.t0 - s.flightMs) / BOUNCE_MS;
      const vv = Math.min(1, v);
      this.gx = s.x1 + (s.x1 - s.x0) * BOUNCE_DIST * vv;
      this.gy = s.y1 + (s.y1 - s.y0) * BOUNCE_DIST * vv;
      if (v <= 1) {
        this.phase = 'bounce';
        h = 4 * BOUNCE_H * v * (1 - v);
      } else {
        this.phase = 'dead';
      }
    }
    this.view.x = this.gx;
    this.view.y = this.gy;
    this.view.zIndex = this.gy;
    this.ballG.y = -h - 4;
    // 球越高影子越淡越小,增加高度感
    const hk = Math.min(1, h / ARC_H);
    this.shadowG.alpha = 1 - hk * 0.6;
    this.shadowG.scale.set(1 - hk * 0.45);
    return this.phase;
  }
}
