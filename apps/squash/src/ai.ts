import {
  COURT_LENGTH,
  COURT_WIDTH,
  clamp,
  distance,
  type CourtPlayer,
  type PlayerId,
  type ShotKind,
} from './game-types';
import type { SquashBall } from './physics';

export type AiLevel = 'easy' | 'normal' | 'hard';
export type AiIntent = 'probe' | 'pressure' | 'defend' | 'finish' | 'change';

export interface AiDecision {
  moveX: number;
  moveY: number;
  shot: ShotKind | null;
  targetX: number;
  pace: number;
  intent: AiIntent;
  label: string;
}

export interface AiMemory {
  recentShots: ShotKind[];
  recentTargets: number[];
}

export interface AiMatchContext {
  rally: number;
  selfScore: number;
  opponentScore: number;
}

interface AiTuning {
  speed: number;
  reach: number;
  reactionMs: number;
  predictionError: number;
}

interface ShotPlan {
  shot: ShotKind;
  targetX: number;
  pace: number;
  intent: AiIntent;
  label: string;
}

interface ShotCandidate extends ShotPlan {
  safety: number;
}

const T_X = 0;
const T_Y = 5.55;

const AI_TUNING: Record<AiLevel, AiTuning> = {
  easy: { speed: 3.25, reach: 1.08, reactionMs: 610, predictionError: 0.44 },
  normal: { speed: 3.9, reach: 1.22, reactionMs: 500, predictionError: 0.2 },
  hard: { speed: 4.45, reach: 1.3, reactionMs: 410, predictionError: 0.08 },
};

export function createAiMemory(): AiMemory {
  return { recentShots: [], recentTargets: [] };
}

export function clearAiMemory(memory: AiMemory): void {
  memory.recentShots.length = 0;
  memory.recentTargets.length = 0;
}

export function rememberAiDecision(memory: AiMemory, decision: AiDecision): void {
  if (!decision.shot) return;
  memory.recentShots.push(decision.shot);
  memory.recentTargets.push(decision.targetX);
  if (memory.recentShots.length > 4) memory.recentShots.shift();
  if (memory.recentTargets.length > 4) memory.recentTargets.shift();
}

function planShot(
  self: CourtPlayer,
  opponent: CourtPlayer,
  ball: SquashBall,
  close: number,
  tuning: AiTuning,
  memory: AiMemory,
  context: AiMatchContext,
): ShotPlan {
  const stretched = close > tuning.reach * 0.9 || self.energy < 18;
  const opponentDeep = opponent.y > 6.45;
  const opponentForward = opponent.y < 4.35;
  const opponentOffT = distance(opponent.x, opponent.y, T_X, T_Y) > 1.55;
  const lateRally = context.rally >= 7;
  const underScorePressure = context.selfScore + 2 <= context.opponentScore;
  const left = -1;
  const right = 1;
  const oppositeSide = opponent.x >= 0 ? left : right;
  const ownSide = self.x >= 0 ? right : left;
  const candidates: ShotCandidate[] = [
    { shot: 'drive', targetX: left * 2.58, pace: 0.9, intent: 'probe', label: '左線壓深', safety: 0.9 },
    { shot: 'drive', targetX: right * 2.58, pace: 0.9, intent: 'probe', label: '右線壓深', safety: 0.9 },
    { shot: 'drive', targetX: oppositeSide * 1.88, pace: 1.06, intent: 'pressure', label: '交叉加速', safety: 0.72 },
    { shot: 'drop', targetX: left * 1.72, pace: 0.8, intent: 'finish', label: '左前小球', safety: 0.48 },
    { shot: 'drop', targetX: right * 1.72, pace: 0.8, intent: 'finish', label: '右前小球', safety: 0.48 },
    { shot: 'lob', targetX: left * 2.42, pace: 0.76, intent: 'change', label: '左後高吊', safety: 1 },
    { shot: 'lob', targetX: right * 2.42, pace: 0.76, intent: 'change', label: '右後高吊', safety: 1 },
    { shot: 'boast', targetX: -ownSide * 1.25, pace: 0.88, intent: 'change', label: '側牆變線', safety: 0.58 },
  ];
  if (self.y > 5.4 && ball.y > 5.7) {
    candidates.push({
      shot: 'glass',
      targetX: clamp(-opponent.x * 0.35, -1.2, 1.2),
      pace: 0.98,
      intent: 'defend',
      label: '後玻璃解圍',
      safety: 0.96,
    });
  }
  const previousShot = memory.recentShots.at(-1);
  const previousTarget = memory.recentTargets.at(-1) ?? 0;
  const ownRecoveryCost = distance(self.x, self.y, T_X, T_Y);
  const noise = tuning.predictionError * 2.4;
  let best: { candidate: ShotCandidate; score: number } | null = null;

  for (const candidate of candidates) {
    const bounce = ball.previewStrike(self.id, {
      kind: candidate.shot,
      targetX: candidate.targetX,
      pace: candidate.pace,
      quality: 1,
    });
    if (!bounce) continue;

    const opponentTravel = distance(opponent.x, opponent.y, bounce.x, bounce.y);
    const cornerPressure = Math.abs(bounce.x) * 0.42 + Math.abs(bounce.y - T_Y) * 0.24;
    const sideChange = Math.sign(candidate.targetX) !== Math.sign(previousTarget || candidate.targetX);
    const recentUses = memory.recentShots.filter((shot) => shot === candidate.shot).length;
    let score =
      opponentTravel * 1.65 +
      cornerPressure +
      candidate.safety * 0.7 -
      ownRecoveryCost * 0.24 -
      recentUses * 1.1 +
      (sideChange ? 0.7 : -0.25);

    if (opponentDeep && candidate.shot === 'drop') score += 4.2;
    if (opponentForward && candidate.shot === 'lob') score += 4.1;
    if (opponentForward && candidate.shot === 'glass') score += 2.4;
    if (candidate.shot === 'glass') score += 6.2;
    if (opponentOffT && candidate.intent === 'pressure') score += 2.8;
    if (context.rally < 4 && candidate.shot === 'drive') score += 1.6;
    if (lateRally && ['drop', 'boast'].includes(candidate.shot)) score += 3.2;
    if (lateRally && candidate.shot === 'lob') score -= 1.15;
    if (underScorePressure && ['drive', 'lob'].includes(candidate.shot)) score += 1.15;
    if (stretched) {
      score += candidate.safety * 4;
      if (['drop', 'boast'].includes(candidate.shot)) score -= 4.8;
      if (candidate.shot === 'lob') score += 2.5;
      if (candidate.shot === 'glass') score += 5.2;
    }
    if (previousShot === candidate.shot) score -= 1.5;
    score += (Math.random() * 2 - 1) * noise;

    if (!best || score > best.score) best = { candidate, score };
  }

  const selected = best?.candidate ?? candidates[0];
  if (stretched) {
    return {
      ...selected,
      pace:
        selected.shot === 'glass'
          ? selected.pace
          : Math.min(selected.pace, selected.shot === 'lob' ? 0.76 : 0.84),
      intent: 'defend',
      label:
        selected.shot === 'glass'
          ? '後玻璃解圍'
          : selected.shot === 'lob'
            ? '高吊重整'
            : '保守解圍',
    };
  }
  return selected;
}

export function decideAi(
  self: CourtPlayer,
  opponent: CourtPlayer,
  ball: SquashBall,
  selfId: PlayerId,
  now: number,
  level: AiLevel,
  memory: AiMemory,
  context: AiMatchContext,
): AiDecision {
  const tuning = AI_TUNING[level];
  let targetX = T_X;
  let targetY = T_Y;
  let plan: ShotPlan | null = null;

  if (ball.active && ball.lastHitter !== selfId) {
    const predicted = ball.predictIntercept();
    const errorSeed = Math.sin(now * 0.0017 + (selfId === 'you' ? 1.3 : 4.7));
    targetX = clamp(predicted.x + errorSeed * tuning.predictionError, -2.8, 2.8);
    targetY = clamp(
      predicted.y + errorSeed * tuning.predictionError * 0.45,
      0.8,
      COURT_LENGTH - 0.45,
    );
    const close = distance(self.x, self.y, ball.x, ball.y);
    const insideInterceptionWindow = distance(targetX, targetY, ball.x, ball.y) <= 0.58;
    if (
      close <= tuning.reach &&
      insideInterceptionWindow &&
      ball.z <= 1.55 &&
      ball.floorBounces <= 1 &&
      ball.ageSeconds >= tuning.reactionMs / 1000 &&
      now - self.lastSwingAt >= tuning.reactionMs
    ) {
      plan = planShot(self, opponent, ball, close, tuning, memory, context);
    }
  }

  const deltaX = targetX - self.x;
  const deltaY = targetY - self.y;
  const length = Math.hypot(deltaX, deltaY);
  return {
    moveX: length > 0.08 ? deltaX / length : 0,
    moveY: length > 0.08 ? deltaY / length : 0,
    shot: plan?.shot ?? null,
    targetX: plan?.targetX ?? 0,
    pace: plan?.pace ?? 1,
    intent: plan?.intent ?? 'probe',
    label: plan?.label ?? '回到 T 區',
  };
}

export function moveAi(
  player: CourtPlayer,
  decision: AiDecision,
  dtSeconds: number,
  level: AiLevel,
): void {
  const speed = AI_TUNING[level].speed;
  player.x = clamp(
    player.x + decision.moveX * speed * dtSeconds,
    -COURT_WIDTH / 2 + 0.38,
    COURT_WIDTH / 2 - 0.38,
  );
  player.y = clamp(
    player.y + decision.moveY * speed * dtSeconds,
    0.75,
    COURT_LENGTH - 0.42,
  );
  if (Math.abs(decision.moveX) > 0.05) player.facing = Math.sign(decision.moveX);
}

export function aiServeTarget(opponent: CourtPlayer, level: AiLevel): number {
  const scatter = level === 'easy' ? 0.46 : level === 'normal' ? 0.28 : 0.16;
  return clamp(-opponent.x * 0.72 + (Math.random() * 2 - 1) * scatter, -2.3, 2.3);
}
