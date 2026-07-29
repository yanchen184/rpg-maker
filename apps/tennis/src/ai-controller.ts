/**
 * AI 球員腦:不碰渲染/網路,每幀吃感知(球/比分)吐移動與出手意圖。
 * 行為:輪到自己發球就發(帶思考延遲)、來球先反應延遲再追預測落點、
 * 球進拍距且高度夠才揮(跟人類同一套 RACKET_REACH / HIT_H_MAX 規則)。
 * 失誤來源是自然的:反應延遲 + 落點預估誤差 + 腳程追不上快球,不靠作弊骰失誤。
 */
import type { Shot } from './ball';
import { serveHalf, type Score, type Side } from './scoring';
import {
  RACKET_REACH,
  HIT_H_MAX,
  SWING_COOLDOWN_MS,
  SMASH_MIN_H,
  ENERGY_MAX,
  ENERGY_REGEN,
  COST,
  DASH_DIST,
  DASH_SEC,
  DASH_REACH_MUL,
  DASH_REACH_TAIL,
  DASH_COOLDOWN_MS,
  contactQuality,
  serveSpot,
  type ShotAim,
  type ShotKind,
} from './shots';

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
  | { type: 'hit'; kind: ShotKind; x0: number; y0: number; aim: ShotAim | null; quality: number }
  /** 閃身撲救:dx/dy 是這次衝刺的位移向量,交給呈現層播殘影/音效 */
  | { type: 'dash'; dx: number; dy: number }
  /** 就位發球:位置已在 controller 內套用,這個 intent 只是讓呈現層播傳送特效 */
  | { type: 'teleport'; x: number; y: number };

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
  /**
   * 招式意願(0 = 完全不用招式,維持舊手感)。
   * 只調「想不想用」,不調氣力價格 —— AI 與玩家吃同一組 COST/回充,不另外加罰。
   * 平衡由 AI 本來就有的反應延遲 / 落點誤差 / 腳程承擔:用錯時機就是失手。
   */
  special?: number;
}

export type AiLevel = 'easy' | 'normal' | 'hard';

/**
 * 難度預設:easy 腳慢眼慢誤差大不上網;hard 反應快誤差小、愛瞄空檔也愛上網壓迫。
 * special = 招式意願:easy 完全不用(手感不變)、normal 偶爾、hard 三招全開。
 */
export const AI_PRESETS: Record<AiLevel, Required<AiOpts>> = {
  easy: { speed: 185, reactMs: 400, errPx: 62, aimProb: 0.3, netAggro: 0, special: 0 },
  normal: { speed: 240, reactMs: 240, errPx: 34, aimProb: 0.7, netAggro: 0.35, special: 0.4 },
  hard: { speed: 290, reactMs: 140, errPx: 14, aimProb: 0.9, netAggro: 0.7, special: 0.85 },
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
  private special: number;
  private readonly xMin: number;
  private readonly xMax: number;

  /** 氣力:跟玩家同一組上限/回充/耗費,不另外加罰 */
  private energy = ENERGY_MAX;
  private dashLeft = 0; // 衝刺剩餘秒數
  private dashVx = 0;
  private dashVy = 0;
  private dashReachLeft = 0; // 拍子加成剩餘秒數(衝刺後再延續 DASH_REACH_TAIL)
  private nextDashAt = 0;
  private dashedForKey = ''; // 同一顆來球只撲一次,不連閃

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
    this.special = opts.special ?? 0.4;
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
    if (opts.special !== undefined) this.special = opts.special;
  }

  /** 現在的拍子可及半徑(閃身中放大;跟玩家同一條公式) */
  get reach(): number {
    return this.dashReachLeft > 0 ? RACKET_REACH * DASH_REACH_MUL : RACKET_REACH;
  }

  /** 氣力現值(debug / HUD 用) */
  get energyNow(): number {
    return this.energy;
  }

  /** 扣氣力;不夠就打不出來(跟玩家同價,不另外加罰) */
  private spend(cost: number): boolean {
    if (this.energy < cost) return false;
    this.energy -= cost;
    return true;
  }

  /** 在網前(截擊距離)? */
  get atNet(): boolean {
    return Math.abs(this.x - 750) < 160;
  }

  /**
   * 氣力回充 + 閃身位移推進。每幀最先跑,跟玩家同一組速率。
   * 衝刺中位置由 dashV 接管(蓋過 moveToward),但一樣鎖在自己半場範圍內。
   */
  private stepEnergy(dtSec: number): void {
    if (this.energy < ENERGY_MAX) {
      this.energy = Math.min(ENERGY_MAX, this.energy + ENERGY_REGEN * dtSec);
    }
    if (this.dashReachLeft > 0) this.dashReachLeft = Math.max(0, this.dashReachLeft - dtSec);
    if (this.dashLeft > 0) {
      const step = Math.min(dtSec, this.dashLeft);
      this.x = Math.max(this.xMin, Math.min(this.xMax, this.x + this.dashVx * step));
      this.y = Math.max(95, Math.min(905, this.y + this.dashVy * step));
      this.dashLeft -= step;
    }
  }

  /**
   * 要不要閃身撲救:預估落點超出腳程、但在「閃身位移 + 放大後拍距」內才值得撲。
   * 撲錯(落點誤差骗了它)就是白閃一次還噴氣力 —— 不給它預知真實落點的捷徑,
   * 判斷一律用帶誤差的預估點,跟它跑位用的是同一個數字。
   */
  private tryDash(s: AiSense, sh: Shot, key: string): AiIntent | null {
    if (this.special <= 0 || this.dashLeft > 0 || s.now < this.nextDashAt) return null;
    if (key === this.dashedForKey) return null; // 同一顆球只撲一次
    if (this.energy < COST.dash) return null;
    if (Math.random() >= this.special) return null;

    // 預估落點(含誤差)與剩餘時間 —— 用 AI 自己「以為」的落點,不是真值
    const tx = Math.max(this.xMin, Math.min(this.xMax, sh.x1 + this.err.x));
    const ty = Math.max(95, Math.min(905, sh.y1 - 12 + this.err.y));
    const dx = tx - this.x;
    const dy = ty - this.y;
    const gap = Math.hypot(dx, dy);
    const secLeft = (sh.t0 + sh.flightMs - s.now) / 1000;
    if (secLeft <= 0.05) return null;

    // 走路搆得到就別浪費氣力;超出「閃身位移 + 放大拍距」也救不回,不做無用功
    const walkable = this.speed * secLeft + RACKET_REACH;
    const dashable = this.speed * secLeft + DASH_DIST + RACKET_REACH * DASH_REACH_MUL;
    if (gap <= walkable || gap > dashable) return null;

    this.dashedForKey = key;
    this.energy -= COST.dash;
    this.nextDashAt = s.now + DASH_COOLDOWN_MS;
    const ux = dx / (gap || 1);
    const uy = dy / (gap || 1);
    this.dashVx = (ux * DASH_DIST) / DASH_SEC;
    this.dashVy = (uy * DASH_DIST) / DASH_SEC;
    this.dashLeft = DASH_SEC;
    this.dashReachLeft = DASH_SEC + DASH_REACH_TAIL;
    this.dir = Math.abs(ux) > Math.abs(uy) ? (ux > 0 ? 'right' : 'left') : uy > 0 ? 'down' : 'up';
    return { type: 'dash', dx: ux * DASH_DIST, dy: uy * DASH_DIST };
  }

  /** 每幀:推進位置,回傳出手意圖(揮拍那幀非 null) */
  tick(dtSec: number, s: AiSense): AiIntent | null {
    this.stepEnergy(dtSec);
    if (!s.score || s.score.winner) {
      this.moveToward(this.home, dtSec);
      return null;
    }

    const sh = s.shot;
    if (!sh) {
      this.approaching = false; // 這分結束/還沒開始:收掉上網狀態
      // 空場:輪到自己發球 → 直接就位到該半區的發球點(deuce/ad 依局內分數奇偶),
      // 到位才排發球時刻(裝作思考);否則回位等接發
      if (s.score.server === this.side) {
        const half = serveHalf(this.side, s.score);
        const spot = serveSpot(this.side, half);
        // 就位不用走 —— 跟玩家一樣直接傳送到發球點,省掉沒戲的跑位,
        // 到位後才排發球時刻(裝作調整呼吸),讓開球有「就位 → 停頓 → 出手」的節奏
        if (Math.abs(this.y - spot.y) > 2 || Math.abs(this.x - spot.x) > 2) {
          this.x = spot.x;
          this.y = spot.y;
          this.serveAt = s.now + rand(900, 1700);
          return { type: 'teleport', x: spot.x, y: spot.y };
        }
        if (!this.serveAt) this.serveAt = s.now + rand(900, 1700);
        if (s.now >= this.serveAt) {
          this.serveAt = 0;
          return { type: 'serve', kind: pickServeKind(s.score.faults ?? 0) };
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

    // 追不到的球:反應完就評估要不要閃身撲救(在跑位之前決定,撲出去這幀就位移)
    const dash = this.tryDash(s, sh, key);
    if (dash) return dash;

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

    // 出手判定:跟人類同規則(拍距 + 球高 + 冷卻),球死了就追不回。
    // 拍距用 this.reach —— 閃身中會放大,撲救的價值就在這裡兌現。
    if (
      s.ballPhase !== 'dead' &&
      s.ballH <= HIT_H_MAX &&
      Math.hypot(s.ballX - this.x, s.ballY - this.y) <= this.reach &&
      s.now >= this.nextSwingAt
    ) {
      this.nextSwingAt = s.now + SWING_COOLDOWN_MS;
      const kind = this.pickKind(s);
      const distance = Math.hypot(s.ballX - this.x, s.ballY - this.y);
      const quality = contactQuality({
        distance,
        reach: this.reach,
        ballH: s.ballH,
        dashTail: this.dashReachLeft > 0 && this.dashLeft <= 0,
      });
      // 招式球要收氣力(同價);氣力不足就自動退回一般球,不是打不出手
      if (kind === 'smash' || kind === 'slice') this.spend(COST[kind]);
      return { type: 'hit', kind, x0: s.ballX, y0: s.ballY, aim: this.pickAim(s), quality };
    }
    return null;
  }

  /**
   * 回擊選球種。招式優先(要氣力夠 + 骰過意願):
   * 球夠高就殺球(跟玩家同一條 SMASH_MIN_H 門檻);否則偶爾切球把對手吊上網。
   * 招式不成立才走原本的三檔:網前截擊快拍壓制,底線普通為主偶爾冒險。
   */
  private pickKind(s: AiSense): ShotKind {
    if (this.special > 0 && Math.random() < this.special) {
      if (s.ballH >= SMASH_MIN_H && this.energy >= COST.smash) return 'smash';
      // 切球用來把對手從底線拉上來:對手已經在網前就沒意義了
      const foeDeep = this.side === 'left' ? s.oppoX >= 1050 : s.oppoX <= 450;
      if (foeDeep && !this.atNet && this.energy >= COST.slice && Math.random() < 0.5) return 'slice';
    }
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
    if (this.dashLeft > 0) return; // 衝刺中位置由 stepEnergy 接管,別讓走路把它拉回來
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
