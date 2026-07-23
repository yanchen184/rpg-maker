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
  /** 每得一分 +1(接收端去重/判新用;發球失誤也 +1 讓兩端同步失誤狀態) */
  seq: number;
  /** 上一分得主(顯示快報用;發球失誤更新時為 null) */
  lastPointTo: Side | null;
  /** 本分已失誤的發球數(0 = 第一發,1 = 第二發;二發再失誤 = 雙誤失分) */
  faults: number;
}

/** 球場上/下半區(發球站位與對角發球區用) */
export type CourtHalf = 'top' | 'bottom';

export function otherHalf(h: CourtHalf): CourtHalf {
  return h === 'top' ? 'bottom' : 'top';
}

/**
 * 發球站位半區:依局內總分奇偶輪替(正統 deuce/ad court)。
 * 左方面向 +x,右手邊是畫面下方;右方面向 -x,右手邊是畫面上方 —— 偶數分都站自己的右半區。
 */
export function serveHalf(server: Side, s: Score): CourtHalf {
  const even = (s.pts.left + s.pts.right) % 2 === 0;
  return server === 'left' ? (even ? 'bottom' : 'top') : even ? 'top' : 'bottom';
}

/**
 * 發球失誤一次:第一發失誤 → 記 fault 換第二發(lastPointTo 置 null,快報顯示失誤而非得分);
 * 第二發再失誤(雙誤)→ 接球方得分。純函數,方便單測與兩端一致。
 */
export function faultCommitted(s: Score, receiver: Side): Score {
  if (s.winner) return s;
  const f = (s.faults ?? 0) + 1;
  if (f >= 2) return pointWon({ ...s, faults: 0 }, receiver);
  return { ...s, faults: f, seq: s.seq + 1, lastPointTo: null };
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
    faults: 0,
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
      faults: 0,
    };
  }
  return { ...s, pts: { ...s.pts, [to]: p }, seq: s.seq + 1, lastPointTo: to, faults: 0 };
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
