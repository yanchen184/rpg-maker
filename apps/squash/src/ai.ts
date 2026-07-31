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

export interface AiDecision {
  moveX: number;
  moveY: number;
  shot: ShotKind | null;
}

interface AiTuning {
  speed: number;
  reach: number;
  reactionMs: number;
  predictionError: number;
}

const T_X = 0;
const T_Y = 5.55;

const AI_TUNING: Record<AiLevel, AiTuning> = {
  easy: { speed: 3.55, reach: 1.08, reactionMs: 520, predictionError: 0.44 },
  normal: { speed: 4.25, reach: 1.22, reactionMs: 420, predictionError: 0.2 },
  hard: { speed: 4.8, reach: 1.3, reactionMs: 330, predictionError: 0.08 },
};

export function decideAi(
  self: CourtPlayer,
  opponent: CourtPlayer,
  ball: SquashBall,
  selfId: PlayerId,
  now: number,
  level: AiLevel,
): AiDecision {
  const tuning = AI_TUNING[level];
  let targetX = T_X;
  let targetY = T_Y;
  let shot: ShotKind | null = null;

  if (ball.active && ball.lastHitter !== selfId) {
    const predicted = ball.predictIntercept();
    const errorSeed = Math.sin(now * 0.0017 + (selfId === 'you' ? 1.3 : 4.7));
    targetX = clamp(predicted.x + errorSeed * tuning.predictionError, -2.8, 2.8);
    targetY = clamp(predicted.y + errorSeed * tuning.predictionError * 0.45, 0.8, COURT_LENGTH - 0.45);
    const close = distance(self.x, self.y, ball.x, ball.y);
    if (
      close <= tuning.reach &&
      ball.z <= 1.55 &&
      ball.floorBounces <= 1 &&
      now - self.lastSwingAt >= tuning.reactionMs
    ) {
      if (opponent.y < 4.7 && Math.random() < 0.45) shot = 'lob';
      else if (opponent.y > 6.7 && Math.random() < 0.4) shot = 'drop';
      else if (Math.abs(opponent.x) > 1.55 && Math.random() < 0.32) shot = 'boast';
      else shot = 'drive';
    }
  }

  const deltaX = targetX - self.x;
  const deltaY = targetY - self.y;
  const length = Math.hypot(deltaX, deltaY);
  return {
    moveX: length > 0.08 ? deltaX / length : 0,
    moveY: length > 0.08 ? deltaY / length : 0,
    shot,
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

export function aiTargetWallX(opponent: CourtPlayer, level: AiLevel): number {
  const scatter = level === 'easy' ? 0.62 : level === 'normal' ? 0.35 : 0.2;
  return clamp(-opponent.x * 0.9 + (Math.random() * 2 - 1) * scatter, -2.65, 2.65);
}
