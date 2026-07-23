/**
 * 正統網球計分(純函數,不碰網路/渲染):0/15/30/40 → Deuce/Adv → 局;先拿 MATCH_GAMES 局者勝。
 * Score 物件不可變 —— pointWon 回傳新物件,方便直接整包寫進 RTDB 同步。
 */
export type Side = 'left' | 'right';

/** 先拿幾局贏得整場 */
export const MATCH_GAMES = 3;

export interface Score {
  /** 本局內各方得分數(0..n;3=40,之後進 Deuce/Adv 邏輯) */
  pts: Record<Side, number>;
  /** 已拿下的局數 */
  games: Record<Side, number>;
  /** 本局發球方(每局輪替) */
  server: Side;
  /** 整場勝者;null = 進行中 */
  winner: Side | null;
  /** 每得一分 +1(接收端去重/判新用) */
  seq: number;
  /** 上一分得主(顯示快報用) */
  lastPointTo: Side | null;
}

export function otherSide(s: Side): Side {
  return s === 'left' ? 'right' : 'left';
}

export function initialScore(server: Side): Score {
  return {
    pts: { left: 0, right: 0 },
    games: { left: 0, right: 0 },
    server,
    winner: null,
    seq: 0,
    lastPointTo: null,
  };
}

/** to 方得一分,回傳新 Score(含局勝/場勝/換發判定) */
export function pointWon(s: Score, to: Side): Score {
  if (s.winner) return s;
  const from = otherSide(to);
  const p = s.pts[to] + 1;
  const q = s.pts[from];
  // 拿下一局:至少 4 分且領先 2 分(涵蓋 Deuce/Adv 規則)
  if (p >= 4 && p - q >= 2) {
    const games = { ...s.games, [to]: s.games[to] + 1 };
    return {
      pts: { left: 0, right: 0 },
      games,
      server: otherSide(s.server),
      winner: games[to] >= MATCH_GAMES ? to : null,
      seq: s.seq + 1,
      lastPointTo: to,
    };
  }
  return { ...s, pts: { ...s.pts, [to]: p }, seq: s.seq + 1, lastPointTo: to };
}

/** 該方目前分數的顯示文字(0/15/30/40/Adv) */
export function ptText(s: Score, side: Side): string {
  const LAB = ['0', '15', '30', '40'];
  const a = s.pts[side];
  const b = s.pts[otherSide(side)];
  if (a >= 3 && b >= 3) return a > b ? 'Adv' : '40';
  return LAB[Math.min(a, 3)];
}

export function isDeuce(s: Score): boolean {
  return s.pts.left >= 3 && s.pts.left === s.pts.right;
}
