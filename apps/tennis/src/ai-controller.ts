/**
 * AI 球員腦:不碰渲染/網路,每幀吃感知(球/比分)吐移動與出手意圖。
 * 行為:輪到自己發球就發(帶思考延遲)、來球先反應延遲再追預測落點、
 * 球進拍距且高度夠才揮(跟人類同一套 RACKET_REACH / HIT_H_MAX 規則)。
 * 失誤來源是自然的:反應延遲 + 落點預估誤差 + 腳程追不上快球,不靠作弊骰失誤。
 */
import type { Shot } from './ball';
import type { Score, Side } from './scoring';
import { RACKET_REACH, HIT_H_MAX, SWING_COOLDOWN_MS, type ShotKind } from './shots';

/** AI 每幀感知(座標同球場世界座標) */
export interface AiSense {
  shot: Shot | null;
  ballX: number;
  ballY: number;
  ballH: number;
  ballPhase: string;
  score: Score | null;
  /** server 時間 ms(跟球軌跡同一時間軸) */
  now: number;
}

export type AiIntent =
  | { type: 'serve'; kind: ShotKind }
  | { type: 'hit'; kind: ShotKind; x0: number; y0: number };

interface AiOpts {
  /** 腳程 px/s(玩家是 220) */
  speed?: number;
  /** 對手擊球後的反應延遲 ms */
  reactMs?: number;
  /** 落點預估誤差半徑 px */
  errPx?: number;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** 發球/回擊選球種:普通為主,偶爾冒險平抽或吊高 */
function pickKind(): ShotKind {
  const r = Math.random();
  return r < 0.2 ? 'lob' : r < 0.38 ? 'drive' : 'normal';
}

export class AiController {
  x: number;
  y: number;
  dir = 'down';

  private readonly home: { x: number; y: number };
  private readonly speed: number;
  private readonly reactMs: number;
  private readonly errPx: number;
  private readonly xMin: number;
  private readonly xMax: number;

  private serveAt = 0; // 預定發球時刻;0 = 未排
  private nextSwingAt = 0; // 揮拍冷卻結束時刻
  private seenShotKey = ''; // 已反應過的來球(換球才重骰延遲/誤差)
  private reactUntil = 0;
  private err = { x: 0, y: 0 };

  constructor(
    readonly side: Side,
    opts: AiOpts = {},
  ) {
    this.home = side === 'left' ? { x: 350, y: 500 } : { x: 1150, y: 500 };
    this.x = this.home.x;
    this.y = this.home.y;
    this.speed = opts.speed ?? 240;
    this.reactMs = opts.reactMs ?? 240;
    this.errPx = opts.errPx ?? 34;
    // 活動範圍鎖自己半場(網前 710/790、場端與上下邊線)
    this.xMin = side === 'left' ? 75 : 795;
    this.xMax = side === 'left' ? 705 : 1425;
  }

  /** 每幀:推進位置,回傳出手意圖(揮拍那幀非 null) */
  tick(dtSec: number, s: AiSense): AiIntent | null {
    if (!s.score || s.score.winner) {
      this.moveToward(this.home, dtSec);
      return null;
    }

    const sh = s.shot;
    if (!sh) {
      // 空場:輪到自己就排一個發球時刻(裝作思考),否則回位等接發
      if (s.score.server === this.side) {
        if (!this.serveAt) this.serveAt = s.now + rand(900, 1700);
        if (s.now >= this.serveAt) {
          this.serveAt = 0;
          return { type: 'serve', kind: pickKind() };
        }
      } else {
        this.serveAt = 0;
      }
      this.moveToward(this.home, dtSec);
      return null;
    }

    this.serveAt = 0;
    if (sh.by === this.side) {
      // 自己剛打的球在飛:退回中位站位
      this.moveToward(this.home, dtSec);
      return null;
    }

    // 來球:第一次看到才骰反應延遲與落點誤差(整段飛行內固定,免抖動)
    const key = `${sh.seq}-${sh.t0}`;
    if (key !== this.seenShotKey) {
      this.seenShotKey = key;
      this.reactUntil = s.now + this.reactMs;
      this.err = { x: rand(-this.errPx, this.errPx), y: rand(-this.errPx, this.errPx) };
    }
    if (s.now < this.reactUntil) return null;

    const target = {
      x: Math.max(this.xMin, Math.min(this.xMax, sh.x1 + this.err.x)),
      y: Math.max(95, Math.min(905, sh.y1 - 12 + this.err.y)),
    };
    this.moveToward(target, dtSec);

    // 出手判定:跟人類同規則(拍距 + 球高 + 冷卻),球死了就追不回
    if (
      s.ballPhase !== 'dead' &&
      s.ballH <= HIT_H_MAX &&
      Math.hypot(s.ballX - this.x, s.ballY - this.y) <= RACKET_REACH &&
      s.now >= this.nextSwingAt
    ) {
      this.nextSwingAt = s.now + SWING_COOLDOWN_MS;
      return { type: 'hit', kind: pickKind(), x0: s.ballX, y0: s.ballY };
    }
    return null;
  }

  private moveToward(t: { x: number; y: number }, dtSec: number): void {
    const dx = t.x - this.x;
    const dy = t.y - this.y;
    const len = Math.hypot(dx, dy);
    if (len < 3) return;
    const step = Math.min(len, this.speed * dtSec);
    this.x += (dx / len) * step;
    this.y += (dy / len) * step;
    this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }
}
