import { COURT_LENGTH, COURT_WIDTH, clamp, distance, type CourtPlayer, type ShotKind } from './game-types';
import type { SquashBall } from './physics';

export interface AiDecision {
  moveX: number;
  moveY: number;
  shot: ShotKind | null;
}

const T_X = 0;
const T_Y = 5.55;

export function decideAi(
  ai: CourtPlayer,
  human: CourtPlayer,
  ball: SquashBall,
  now: number,
): AiDecision {
  let targetX = T_X;
  let targetY = T_Y;
  let shot: ShotKind | null = null;

  if (ball.active && ball.lastHitter === 'you') {
    const predicted = ball.predictIntercept();
    targetX = predicted.x;
    targetY = predicted.y;
    const close = distance(ai.x, ai.y, ball.x, ball.y);
    if (
      close <= 1.22 &&
      ball.z <= 1.55 &&
      ball.floorBounces <= 1 &&
      now - ai.lastSwingAt >= 420
    ) {
      if (human.y < 4.7 && Math.random() < 0.45) shot = 'lob';
      else if (human.y > 6.7 && Math.random() < 0.4) shot = 'drop';
      else if (Math.abs(human.x) > 1.55 && Math.random() < 0.32) shot = 'boast';
      else shot = 'drive';
    }
  }

  const deltaX = targetX - ai.x;
  const deltaY = targetY - ai.y;
  const length = Math.hypot(deltaX, deltaY);
  return {
    moveX: length > 0.08 ? deltaX / length : 0,
    moveY: length > 0.08 ? deltaY / length : 0,
    shot,
  };
}

export function moveAi(ai: CourtPlayer, decision: AiDecision, dtSeconds: number): void {
  const speed = 4.25;
  ai.x = clamp(ai.x + decision.moveX * speed * dtSeconds, -COURT_WIDTH / 2 + 0.38, COURT_WIDTH / 2 - 0.38);
  ai.y = clamp(ai.y + decision.moveY * speed * dtSeconds, 0.75, COURT_LENGTH - 0.42);
  if (Math.abs(decision.moveX) > 0.05) ai.facing = Math.sign(decision.moveX);
}

export function aiTargetWallX(human: CourtPlayer): number {
  return clamp(-human.x * 0.9 + (Math.random() * 2 - 1) * 0.35, -2.65, 2.65);
}
