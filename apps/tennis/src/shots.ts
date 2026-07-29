/**
 * 擊球規則共用層:球種參數與出球公式。人類(鍵盤)與 AI 共用同一套,
 * 保證「AI 打出來的球」跟玩家打的走同一物理與風險(drive 貼網會真的掛網)。
 */
import { COURT } from './court';
import type { Shot } from './ball';
import type { CourtHalf, Side } from './scoring';

/** 拍子可及半徑:球(地面投影)離玩家多近才打得到 */
export const RACKET_REACH = 95;
/** 球高超過這個就搆不到(挑高球過頂要退後等它降) */
export const HIT_H_MAX = 150;
/** 揮拍判定窗:揮下去後這段時間內球進可及範圍就算擊中 */
export const SWING_WINDOW_MS = 150;
/** 揮拍冷卻:亂揮會空窗 */
export const SWING_COOLDOWN_MS = 350;

/** 球種:挑高球/平抽/普通球 + 兩式招式球(殺球/切球) */
export type ShotKind = 'lob' | 'drive' | 'normal' | 'smash' | 'slice';

/** 招式球:要氣力才打得出來,一般揮拍鍵打不到 */
export const SPECIAL_KINDS: readonly ShotKind[] = ['smash', 'slice'];

/** 殺球門檻:球高至少要到這裡(高球才殺得下去,低球只能平抽) */
export const SMASH_MIN_H = 82;

/** 切球落點:壓在對方發球線前這個範圍內(貼網小球,逼對手往前跑) */
export const SLICE_DEPTH = [55, 205] as const;

/** 氣力上限與每秒回充 —— 人類與 AI 共用同一組,招式對雙方都是有限資源 */
export const ENERGY_MAX = 100;
export const ENERGY_REGEN = 22;

/** 招式耗氣:AI 與玩家同價,AI 打了殺球一樣有一段時間閃不了身 */
export const COST = { dash: 30, smash: 40, slice: 25 } as const;

/**
 * 閃身:位移距離 / 持續秒數 / 期間拍子可及倍率 / 倍率尾勁 / 冷卻。
 *
 * 2026-07-29 平衡:實測 AI 閃身「撲了就救到」的成功率高達 95%(hard 95.1% / normal 94.6%),
 * 等於一顆「我要接到這球」按鈕 —— 太無腦。降倍率沒用(AI 只在 gap ≤ dashable 時才撲,
 * 縮拍距只是讓它改成「不撲」,成功率照樣近 100%),真正有效的是這兩把:
 *   1. 冷卻 520 → 780ms:連續快球第二顆閃不了,救球密度直接下降。
 *   2. 尾勁 0.22 → 0.10 秒:撲過去後拍子加成很快退掉,晚到就搆不到 ——
 *      預估落點的誤差終於會轉成真正的失手,而不是被長尾勁兜回來。
 * 兩把都是「機制」不是「加價」:耗氣仍是 30,人與 AI 同一組常數。
 */
export const DASH_DIST = 165;
export const DASH_SEC = 0.16;
export const DASH_REACH_MUL = 1.85;
export const DASH_REACH_TAIL = 0.1;
export const DASH_COOLDOWN_MS = 780;

/**
 * 發球站位:輪到誰發球,人就站這裡 —— 底線後方 × 該半區(deuce/ad)正中央。
 * 人類與 AI 共用:兩邊都直接就位,不用自己走過去,發球才有「就位 → 開球」的儀式節奏。
 */
export const SERVE_SPOT_Y = { top: 330, bottom: 670 } as const;
export function serveSpot(server: Side, half: CourtHalf): { x: number; y: number } {
  return { x: server === 'left' ? 350 : 1150, y: SERVE_SPOT_Y[half] };
}

/** 瞄準:目標落點(世界座標)。有瞄散布收窄、沒瞄走大範圍隨機 —— 控制權換給打者 */
export interface ShotAim {
  x?: number;
  y?: number;
}

// 各球種參數:弧頂高度(px)/球速(px/s)/飛行時長 clamp。
// 網高 NET_H=46:drive 弧頂只有 48~62,過網點離弧頂稍遠就真的掛網 —— 風險換速度。
// smash 弧頂 52~64:比 drive 還平但仍高於網高 46 —— 殺球該險,不該必掛網。
// slice 走另一路:弧頂高但飛得慢又近,落地即止,靠「落點貼網」逼人不是靠速度。
export const KIND = {
  lob: { apex: [225, 270], speed: 500, minMs: 1150, maxMs: 1800 },
  normal: { apex: [110, 150], speed: 700, minMs: 700, maxMs: 1200 },
  drive: { apex: [48, 62], speed: 950, minMs: 450, maxMs: 750 },
  smash: { apex: [52, 64], speed: 1320, minMs: 260, maxMs: 460 },
  slice: { apex: [120, 155], speed: 430, minMs: 620, maxMs: 1000 },
} as const;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export interface MakeShotOpts {
  by: Side;
  kind: ShotKind;
  /** 擊球點(觸拍位置) */
  x0: number;
  y0: number;
  /** 擊球者身位 y:拍球相對關係(擊球點偏身上/下方)決定回球縱向 */
  ownerY: number;
  prevSeq: number;
  /** 擊球時刻(server 時間 ms) */
  t0: number;
  /** 發球才帶:必須落進的對角發球區;一般對打省略 */
  serveBox?: CourtHalf | null;
  /** 對打瞄準(發球分支忽略,發球落點由 serveBox 散布決定) */
  aim?: ShotAim | null;
}

/** 發球區深度:發球線在 netX ± 這個距離 */
export const SERVICE_LINE_DIST = 300;

/** 發球落點是否進對角發球區(非發球一律 true;裁定與測試共用的純函數) */
export function serveLandsIn(shot: Shot): boolean {
  if (!shot.serveBox) return true;
  const { netX, top, bottom } = COURT;
  const midY = (top + bottom) / 2;
  const xOk =
    shot.by === 'left'
      ? shot.x1 >= netX && shot.x1 <= netX + SERVICE_LINE_DIST
      : shot.x1 >= netX - SERVICE_LINE_DIST && shot.x1 <= netX;
  const yOk = shot.serveBox === 'top' ? shot.y1 >= top && shot.y1 <= midY : shot.y1 > midY && shot.y1 <= bottom;
  return xOk && yOk;
}

/** 出球:落點帶隨機散布,球種決定弧頂/球速;回傳確定性軌跡參數 */
export function makeShot(o: MakeShotOpts): Shot {
  const k = KIND[o.kind];
  let x1: number;
  let y1: number;
  if (o.serveBox) {
    // 發球:瞄對角發球區(網到發球線 × 上/下半區)。散布刻意略超框 ——
    // 貼線冒險,偏出去就是真的一發失誤;drive 發球快但超框量最大。
    const { netX, top, bottom } = COURT;
    const midY = (top + bottom) / 2;
    const fast = o.kind === 'drive' || o.kind === 'smash';
    const deep = fast ? 70 : 25; // 深度超框量(過發球線 = 長失誤)
    const wide = fast ? 40 : 15; // 縱向超框量(越中線/邊線 = 寬失誤)
    x1 =
      o.by === 'left'
        ? rand(netX + 40, netX + SERVICE_LINE_DIST - 8 + deep)
        : rand(netX - SERVICE_LINE_DIST + 8 - deep, netX - 40);
    // 發球區本來就在網前,切球發球再往前壓沒有戰術意義,落點沿用一般發球散布

    y1 = o.serveBox === 'top' ? rand(top + 30 - wide, midY - 20 + wide) : rand(midY + 20 - wide, bottom - 30 + wide);
  } else {
    // 對打:有瞄準 → 目標點 + 小散布(drive 快但散布大,風險換速度);
    // 沒瞄 → 原本的大範圍隨機(等於「隨便回一拍」)
    // smash 跟 drive 一樣散布大(打得越狠越難控);slice 是精細活,散布最小
    const spread = o.kind === 'drive' || o.kind === 'smash' ? 80 : o.kind === 'slice' ? 38 : 55;
    const dy = o.y0 - o.ownerY;
    if (o.aim?.y != null) {
      y1 = Math.max(190, Math.min(810, o.aim.y + rand(-spread, spread)));
    } else {
      y1 = Math.max(200, Math.min(800, (COURT.top + COURT.bottom) / 2 + dy * 4 + rand(-90, 90)));
    }
    const xLo = o.by === 'left' ? COURT.netX + 70 : COURT.left + 25;
    const xHi = o.by === 'left' ? COURT.right - 25 : COURT.netX - 70;
    if (o.kind === 'slice') {
      // 切球:深度不給玩家決定 —— 一律吊在對方網前(發球線內),瞄準只剩左右路。
      // 這才是招式的取捨:換來對手非跑上網不可,代價是你放棄了打深的權利。
      const near = rand(SLICE_DEPTH[0], SLICE_DEPTH[1]);
      x1 = o.by === 'left' ? COURT.netX + near : COURT.netX - near;
      if (o.aim?.y != null) y1 = Math.max(190, Math.min(810, o.aim.y + rand(-spread, spread)));
    } else if (o.aim?.x != null) {
      x1 = Math.max(xLo, Math.min(xHi, o.aim.x + rand(-spread, spread)));
    } else {
      const deepBall = o.kind === 'drive' || o.kind === 'smash';
      x1 =
        o.by === 'left'
          ? deepBall
            ? rand(1020, 1300)
            : rand(840, 1250)
          : deepBall
            ? rand(200, 480)
            : rand(250, 660);
    }
  }
  const dist = Math.hypot(x1 - o.x0, y1 - o.y0);
  const flightMs = Math.max(k.minMs, Math.min(k.maxMs, (dist / k.speed) * 1000));
  return {
    seq: o.prevSeq + 1,
    by: o.by,
    x0: o.x0,
    y0: o.y0,
    x1,
    y1,
    t0: o.t0,
    flightMs,
    apexH: rand(k.apex[0], k.apex[1]),
    kind: o.kind,
    serveBox: o.serveBox ?? null,
  };
}
