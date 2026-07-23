/**
 * 網球:確定性飛行 —— 一顆球的整段軌跡由 Shot 事件的參數完全決定,
 * 兩端 client 各自用「server 時間」代入同一組公式,不逐幀同步位置也能看到同一顆球。
 *
 * 高度軸(z)是真實物理量:h = 4·apexH·u·(1-u) 拋物線,呈現上球隨高度縮放
 * (越高越大,過頂點才變小下降)、影子留在地面越高越淡。
 *
 * 軌跡分段:
 *   flying  u∈[0,1]  地面投影從 (x0,y0) 直線到 (x1,y1),高度按拋物線
 *   (掛網)過網瞬間高度 < NET_H → 球貼網掉落 NET_DROP_MS 後死球
 *   bounce  落地後小彈跳 BOUNCE_MS,沿原方向續行 BOUNCE_DIST 比例距離
 *   dead    死球(等接球判定/清場)
 */
import { Container, Graphics } from 'pixi.js';
import type { Side } from './scoring';
import { COURT } from './court';

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
  /** 飛行最高點(px):挑高球大、平抽小 —— 決定過不過得了網 */
  apexH: number;
}

export type BallPhase = 'flying' | 'bounce' | 'dead';

/** 網的實體高度(px):過網瞬間球高低於此 = 掛網 */
export const NET_H = 46;
const BOUNCE_MS = 450;
const BOUNCE_DIST = 0.25;
const BOUNCE_H = 30;
const NET_DROP_MS = 300;

/** 這球過網瞬間的進度 u(0..1);沒跨網回 null(如打太歪根本沒到網) */
export function netCrossU(shot: Shot): number | null {
  const { netX } = COURT;
  if ((shot.x0 - netX) * (shot.x1 - netX) >= 0) return null;
  return (netX - shot.x0) / (shot.x1 - shot.x0);
}

/** 飛行途中高度(px) */
export function flightH(shot: Shot, u: number): number {
  return 4 * shot.apexH * u * (1 - u);
}

/** 掛網判定(純函數,兩端確定性一致):過網瞬間高度不足 */
export function shotHitsNet(shot: Shot): boolean {
  const u = netCrossU(shot);
  return u !== null && flightH(shot, u) < NET_H;
}

export class Ball {
  view = new Container();
  /** 地面投影座標(判接球距離/深度排序用) */
  gx = 0;
  gy = 0;
  /** 當前球高(px,揮拍可及判定用) */
  h = 0;
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
    const netU = shotHitsNet(s) ? netCrossU(s) : null;
    let h = 0;

    if (netU !== null && u >= netU) {
      // 掛網:球停在網前一點,從網頂自由落體掉地
      const dir = s.x0 < COURT.netX ? -1 : 1;
      this.gx = COURT.netX + dir * 10;
      this.gy = s.y0 + (s.y1 - s.y0) * netU;
      const v = (serverNow - s.t0 - s.flightMs * netU) / NET_DROP_MS;
      if (v <= 1) {
        this.phase = 'bounce';
        h = NET_H * (1 - v) * (1 - v);
      } else {
        this.phase = 'dead';
      }
    } else if (u <= 1) {
      this.phase = 'flying';
      this.gx = s.x0 + (s.x1 - s.x0) * u;
      this.gy = s.y0 + (s.y1 - s.y0) * u;
      h = flightH(s, u);
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

    this.h = h;
    this.view.x = this.gx;
    this.view.y = this.gy;
    this.view.zIndex = this.gy;
    this.ballG.y = -h - 4;
    // 高度感:球越高越大(近鏡頭),影子越淡越小
    this.ballG.scale.set(1 + h / 220);
    const hk = Math.min(1, h / 180);
    this.shadowG.alpha = 1 - hk * 0.6;
    this.shadowG.scale.set(1 - hk * 0.45);
    return this.phase;
  }
}
