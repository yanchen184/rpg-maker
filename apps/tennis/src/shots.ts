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

/** 球種:挑高球/平抽/普通球 */
export type ShotKind = 'lob' | 'drive' | 'normal';

// 各球種參數:弧頂高度(px)/球速(px/s)/飛行時長 clamp。
// 網高 NET_H=46:drive 弧頂只有 48~62,過網點離弧頂稍遠就真的掛網 —— 風險換速度。
export const KIND = {
  lob: { apex: [225, 270], speed: 500, minMs: 1150, maxMs: 1800 },
  normal: { apex: [110, 150], speed: 700, minMs: 700, maxMs: 1200 },
  drive: { apex: [48, 62], speed: 950, minMs: 450, maxMs: 750 },
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
    const deep = o.kind === 'drive' ? 70 : 25; // 深度超框量(過發球線 = 長失誤)
    const wide = o.kind === 'drive' ? 40 : 15; // 縱向超框量(越中線/邊線 = 寬失誤)
    x1 =
      o.by === 'left'
        ? rand(netX + 40, netX + SERVICE_LINE_DIST - 8 + deep)
        : rand(netX - SERVICE_LINE_DIST + 8 - deep, netX - 40);
    y1 = o.serveBox === 'top' ? rand(top + 30 - wide, midY - 20 + wide) : rand(midY + 20 - wide, bottom - 30 + wide);
  } else {
    const dy = o.y0 - o.ownerY;
    y1 = Math.max(200, Math.min(800, (COURT.top + COURT.bottom) / 2 + dy * 4 + rand(-90, 90)));
    x1 =
      o.by === 'left'
        ? o.kind === 'drive'
          ? rand(1020, 1300)
          : rand(840, 1250)
        : o.kind === 'drive'
          ? rand(200, 480)
          : rand(250, 660);
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
    serveBox: o.serveBox ?? null,
  };
}
