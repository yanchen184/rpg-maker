/**
 * AI 球員腦:不碰渲染/網路,每幀吃感知(球/比分)吐移動與出手意圖。
 * 行為:輪到自己發球就發(帶思考延遲)、來球先反應延遲再追預測落點、
 * 球進拍距且高度夠才揮(跟人類同一套 RACKET_REACH / HIT_H_MAX 規則)。
 * 失誤來源是自然的:反應延遲 + 落點預估誤差 + 腳程追不上快球,不靠作弊骰失誤。
 */
import type { Shot } from './ball';
import { serveHalf, type Score, type Side } from './scoring';
import { RACKET_REACH, HIT_H_MAX, SWING_COOLDOWN_MS, type ShotAim, type ShotKind } from './shots';

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
  /** 對手位置(瞄空檔用;拿不到給場中) */
  oppoX: number;
  oppoY: number;
}

export type AiIntent =
  | { type: 'serve'; kind: ShotKind }
  | { type: 'hit'; kind: ShotKind; x0: number; y0: number; aim: ShotAim | null };

export interface AiOpts {
  /** 腳程 px/s(玩家是 220) */
  speed?: number;
  /** 對手擊球後的反應延遲 ms */
  reactMs?: number;
  /** 落點預估誤差半徑 px */
  errPx?: number;
  /** 回擊瞄空檔的機率(其餘隨機回) */
  aimProb?: number;
  /** 打出深平抽後上網搶截的意願(0 = 從不上網) */
  netAggro?: number;
}

export type AiLevel = 'easy' | 'normal' | 'hard';

/** 難度預設:easy 腳慢眼慢誤差大不上網;hard 反應快誤差小、愛瞄空檔也愛上網壓迫 */
export const AI_PRESETS: Record<AiLevel, Required<AiOpts>> = {
  easy: { speed: 185, reactMs: 400, errPx: 62, aimProb: 0.3, netAggro: 0 },
  normal: { speed: 240, reactMs: 240, errPx: 34, aimProb: 0.7, netAggro: 0.35 },
  hard: { speed: 290, reactMs: 140, errPx: 14, aimProb: 0.9, netAggro: 0.7 },
};

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** 發球選球種:一發敢冒險平抽搶攻,二發(已有失誤)改保守確保進區 */
function pickServeKind(faults: number): ShotKind {
  const r = Math.random();
  if (faults > 0) return r < 0.15 ? 'lob' : 'normal';
  return r < 0.1 ? 'lob' : r < 0.45 ? 'drive' : 'normal';
}

export class AiController {
  x: number;
  y: number;
  dir = 'down';

  private readonly home: { x: number; y: number };
  private speed: number;
  private reactMs: number;
  private errPx: number;
  private aimProb: number;
  private netAggro: number;
  private readonly xMin: number;
  private readonly xMax: number;

  private serveAt = 0; // 預定發球時刻;0 = 未排
  private nextSwingAt = 0; // 揮拍冷卻結束時刻
  private seenShotKey = ''; // 已反應過的來球(換球才重骰延遲/誤差)
  private reactUntil = 0;
  private err = { x: 0, y: 0 };
  private ownShotKey = ''; // 自己出手的球(每球骰一次要不要上網)
  private approaching = false; // 上網中:自己的球在飛時往網前壓,搶下一拍截擊

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
    this.aimProb = opts.aimProb ?? 0.7;
    this.netAggro = opts.netAggro ?? 0.35;
    // 活動範圍鎖自己半場(網前 710/790、場端與上下邊線)
    this.xMin = side === 'left' ? 75 : 795;
    this.xMax = side === 'left' ? 705 : 1425;
  }

  /** 即時改難度(遊戲中 1/2/3 切換;只覆蓋有給的欄位) */
  configure(opts: AiOpts): void {
    if (opts.speed !== undefined) this.speed = opts.speed;
    if (opts.reactMs !== undefined) this.reactMs = opts.reactMs;
    if (opts.errPx !== undefined) this.errPx = opts.errPx;
    if (opts.aimProb !== undefined) this.aimProb = opts.aimProb;
    if (opts.netAggro !== undefined) this.netAggro = opts.netAggro;
  }

  /** 在網前(截擊距離)? */
  get atNet(): boolean {
    return Math.abs(this.x - 750) < 160;
  }

  /** 每幀:推進位置,回傳出手意圖(揮拍那幀非 null) */
  tick(dtSec: number, s: AiSense): AiIntent | null {
    if (!s.score || s.score.winner) {
      this.moveToward(this.home, dtSec);
      return null;
    }

    const sh = s.shot;
    if (!sh) {
      this.approaching = false; // 這分結束/還沒開始:收掉上網狀態
      // 空場:輪到自己發球 → 先走到正確站位半區(deuce/ad 依局內分數奇偶),
      // 到位才排發球時刻(裝作思考);否則回位等接發
      if (s.score.server === this.side) {
        const half = serveHalf(this.side, s.score);
        const spot = { x: this.home.x, y: half === 'top' ? 330 : 670 };
        this.moveToward(spot, dtSec);
        if (Math.abs(this.y - spot.y) < 40 && Math.abs(this.x - spot.x) < 60) {
          if (!this.serveAt) this.serveAt = s.now + rand(900, 1700);
          if (s.now >= this.serveAt) {
            this.serveAt = 0;
            return { type: 'serve', kind: pickServeKind(s.score.faults ?? 0) };
          }
        } else {
          this.serveAt = 0;
        }
      } else {
        this.serveAt = 0;
        this.moveToward(this.home, dtSec);
      }
      return null;
    }

    this.serveAt = 0;
    if (sh.by === this.side) {
      // 自己剛打的球在飛:網前戰術 — 打了夠深的平抽就有機會上網壓迫,搶下一拍截擊;
      // 否則退回中位站位。每球只骰一次(整段飛行內決定不變)。
      const key = `${sh.seq}-${sh.t0}`;
      if (key !== this.ownShotKey) {
        this.ownShotKey = key;
        const deep = this.side === 'left' ? sh.x1 >= 1120 : sh.x1 <= 380;
        if (!sh.serveBox && sh.apexH <= 75 && deep && Math.random() < this.netAggro) {
          this.approaching = true;
        }
      }
      if (this.approaching) {
        // 網前站位:貼近網但留揮拍空間,y 稍偏自己球的落點側封直線
        const spot = {
          x: this.side === 'left' ? 645 : 855,
          y: Math.max(340, Math.min(660, 500 + (sh.y1 - 500) * 0.3)),
        };
        this.moveToward(spot, dtSec);
      } else {
        this.moveToward(this.home, dtSec);
      }
      return null;
    }

    // 對手回的是挑高球(被過頂)、或球已經穿過自己身後 → 收掉上網狀態趕快退防(追落點)
    if (
      this.approaching &&
      (sh.apexH >= 180 ||
        (this.side === 'left' ? s.ballX < this.x - 45 : s.ballX > this.x + 45))
    ) {
      this.approaching = false;
    }

    // 來球:第一次看到才骰反應延遲與落點誤差(整段飛行內固定,免抖動)
    const key = `${sh.seq}-${sh.t0}`;
    if (key !== this.seenShotKey) {
      this.seenShotKey = key;
      this.reactUntil = s.now + this.reactMs;
      this.err = { x: rand(-this.errPx, this.errPx), y: rand(-this.errPx, this.errPx) };
    }
    if (s.now < this.reactUntil) return null;

    // 上網中且來球不是挑高 → 守在網前橫移攔截(截擊:球到落點前就出拍);
    // 否則追預測落點(含誤差)
    const target = this.approaching
      ? {
          x: this.side === 'left' ? 645 : 855,
          y: Math.max(95, Math.min(905, s.ballY + this.err.y * 0.5)),
        }
      : {
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
      return { type: 'hit', kind: this.pickKind(), x0: s.ballX, y0: s.ballY, aim: this.pickAim(s) };
    }
    return null;
  }

  /** 回擊選球種:網前截擊快拍壓制(不吊高);底線普通為主,偶爾冒險平抽或吊高 */
  private pickKind(): ShotKind {
    const r = Math.random();
    if (this.atNet) return r < 0.55 ? 'drive' : 'normal';
    return r < 0.2 ? 'lob' : r < 0.38 ? 'drive' : 'normal';
  }

  /** 回擊瞄準:依難度機率打對手站位的相反縱側(調動對手),偶爾補一拍深球;其餘不瞄(隨機回) */
  private pickAim(s: AiSense): ShotAim | null {
    if (Math.random() >= this.aimProb) return null;
    const aim: ShotAim = { y: s.oppoY <= 500 ? rand(650, 780) : rand(220, 350) };
    if (Math.random() < 0.35) {
      aim.x = this.side === 'left' ? rand(1180, 1310) : rand(190, 320); // 壓底線深球
    }
    return aim;
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
