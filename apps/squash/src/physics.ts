import {
  BACK_OUT_HEIGHT,
  COURT_LENGTH,
  COURT_WIDTH,
  FRONT_OUT_HEIGHT,
  GRAVITY,
  TIN_HEIGHT,
  clamp,
  otherPlayer,
  sideOutHeight,
  type PlayerId,
  type ShotSpec,
} from './game-types';

export type BallEvent =
  | { type: 'front'; x: number; z: number }
  | { type: 'side'; x: number; y: number; z: number }
  | { type: 'back'; x: number; z: number }
  | { type: 'floor'; x: number; y: number; bounce: number }
  | { type: 'fault'; winner: PlayerId; reason: string };

export interface PredictedIntercept {
  x: number;
  y: number;
  seconds: number;
}

export interface PredictedBounce {
  x: number;
  y: number;
  seconds: number;
  bounce: number;
}

export interface PredictedWallImpact {
  surface: 'front' | 'side' | 'back';
  x: number;
  y: number;
  z: number;
  seconds: number;
}

const FLOOR_RESTITUTION = 0.68;
const WALL_RESTITUTION = 0.9;
const MAX_BALL_AGE_SECONDS = 9;

export class SquashBall {
  active = false;
  x = 0;
  y = 7.1;
  z = 0.9;
  vx = 0;
  vy = 0;
  vz = 0;
  lastHitter: PlayerId | null = null;
  floorBounces = 0;
  frontHit = false;
  ageSeconds = 0;

  reset(x: number, y: number): void {
    this.active = false;
    this.x = x;
    this.y = y;
    this.z = 0.88;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.lastHitter = null;
    this.floorBounces = 0;
    this.frontHit = false;
    this.ageSeconds = 0;
  }

  strike(by: PlayerId, spec: ShotSpec): void {
    const quality = clamp(spec.quality, 0.12, 1);
    const weak = quality < 0.55;
    const targetX = weak ? spec.targetX * 0.25 : spec.targetX;
    const spread = (1 - quality) * 0.7;
    const randomizedTarget = clamp(
      targetX + (Math.random() * 2 - 1) * spread,
      -COURT_WIDTH * 0.43,
      COURT_WIDTH * 0.43,
    );

    let frontSpeed = 11.3;
    let wallHeight = 1.28;
    let lateralBoost = 0;
    if (spec.kind === 'drop') {
      frontSpeed = 7.2;
      wallHeight = 0.64;
    } else if (spec.kind === 'lob') {
      frontSpeed = 8.8;
      wallHeight = 3.55;
    } else if (spec.kind === 'boast') {
      frontSpeed = 8.9;
      wallHeight = 1.12;
      lateralBoost = this.x >= 0 ? -10.5 : 10.5;
    }
    if (weak) {
      frontSpeed *= 0.74;
      wallHeight = 1.52;
      lateralBoost *= 0.55;
    }

    const secondsToFront = Math.max(0.16, this.y / frontSpeed);
    this.vy = -frontSpeed;
    this.vx =
      spec.kind === 'boast'
        ? lateralBoost
        : (randomizedTarget - this.x) / secondsToFront;
    this.vz = (wallHeight - this.z + 0.5 * GRAVITY * secondsToFront ** 2) / secondsToFront;
    this.lastHitter = by;
    this.floorBounces = 0;
    this.frontHit = false;
    this.active = true;
    this.ageSeconds = 0;
  }

  update(dtSeconds: number): BallEvent[] {
    if (!this.active || !this.lastHitter) return [];
    const events: BallEvent[] = [];
    const steps = Math.max(1, Math.ceil(dtSeconds / (1 / 180)));
    const dt = dtSeconds / steps;

    for (let step = 0; step < steps && this.active; step += 1) {
      this.ageSeconds += dt;
      this.vz -= GRAVITY * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.z += this.vz * dt;
      const drag = Math.pow(0.998, dt * 60);
      this.vx *= drag;
      this.vy *= drag;

      if (this.y <= 0 && this.vy < 0) {
        this.y = 0;
        if (this.z < TIN_HEIGHT) {
          events.push(this.fail('下界板', this.lastHitter));
          continue;
        }
        if (this.z > FRONT_OUT_HEIGHT) {
          events.push(this.fail('前牆出界', this.lastHitter));
          continue;
        }
        this.vy = Math.abs(this.vy) * WALL_RESTITUTION;
        this.frontHit = true;
        events.push({ type: 'front', x: this.x, z: this.z });
      }

      const halfWidth = COURT_WIDTH / 2;
      if (Math.abs(this.x) >= halfWidth && Math.sign(this.vx) === Math.sign(this.x)) {
        this.x = Math.sign(this.x) * halfWidth;
        if (this.z > sideOutHeight(this.y)) {
          events.push(this.fail('側牆出界', this.lastHitter));
          continue;
        }
        this.vx *= -WALL_RESTITUTION;
        events.push({ type: 'side', x: this.x, y: this.y, z: this.z });
      }

      if (this.y >= COURT_LENGTH && this.vy > 0) {
        this.y = COURT_LENGTH;
        if (this.z > BACK_OUT_HEIGHT) {
          events.push(this.fail('後牆出界', this.lastHitter));
          continue;
        }
        this.vy *= -WALL_RESTITUTION;
        events.push({ type: 'back', x: this.x, z: this.z });
      }

      if (this.z <= 0 && this.vz < 0) {
        this.z = 0;
        if (!this.frontHit) {
          events.push(this.fail('未先碰前牆', this.lastHitter));
          continue;
        }
        this.floorBounces += 1;
        this.vz = Math.abs(this.vz) * FLOOR_RESTITUTION;
        this.vx *= 0.96;
        this.vy *= 0.96;
        events.push({ type: 'floor', x: this.x, y: this.y, bounce: this.floorBounces });
        if (this.floorBounces >= 2) {
          events.push(this.fail('第二次落地', this.lastHitter));
        }
      }

      if (this.ageSeconds > MAX_BALL_AGE_SECONDS) {
        events.push(this.fail('回合逾時', this.lastHitter));
      }
    }
    return events;
  }

  predictIntercept(maxSeconds = 2.2): PredictedIntercept {
    const clone = {
      x: this.x,
      y: this.y,
      z: this.z,
      vx: this.vx,
      vy: this.vy,
      vz: this.vz,
      frontHit: this.frontHit,
    };
    const dt = 1 / 90;
    for (let seconds = 0; seconds <= maxSeconds; seconds += dt) {
      clone.vz -= GRAVITY * dt;
      clone.x += clone.vx * dt;
      clone.y += clone.vy * dt;
      clone.z += clone.vz * dt;
      if (clone.y <= 0 && clone.vy < 0) {
        clone.y = 0;
        clone.vy = Math.abs(clone.vy) * WALL_RESTITUTION;
        clone.frontHit = true;
      }
      if (Math.abs(clone.x) >= COURT_WIDTH / 2) {
        clone.x = Math.sign(clone.x) * COURT_WIDTH / 2;
        clone.vx *= -WALL_RESTITUTION;
      }
      if (clone.y >= COURT_LENGTH && clone.vy > 0) {
        clone.y = COURT_LENGTH;
        clone.vy *= -WALL_RESTITUTION;
      }
      if (clone.z <= 0 && clone.vz < 0) {
        clone.z = 0;
        clone.vz = Math.abs(clone.vz) * FLOOR_RESTITUTION;
      }
      if (clone.frontHit && clone.z <= 1.15 && clone.y >= 1.1) {
        return {
          x: clamp(clone.x, -COURT_WIDTH / 2 + 0.35, COURT_WIDTH / 2 - 0.35),
          y: clamp(clone.y, 1, COURT_LENGTH - 0.35),
          seconds,
        };
      }
    }
    return {
      x: clamp(clone.x, -COURT_WIDTH / 2 + 0.35, COURT_WIDTH / 2 - 0.35),
      y: clamp(clone.y, 1, COURT_LENGTH - 0.35),
      seconds: maxSeconds,
    };
  }

  predictNextBounce(maxSeconds = 4): PredictedBounce | null {
    if (!this.active || !this.lastHitter) return null;
    const clone = {
      x: this.x,
      y: this.y,
      z: this.z,
      vx: this.vx,
      vy: this.vy,
      vz: this.vz,
      frontHit: this.frontHit,
      floorBounces: this.floorBounces,
    };
    const dt = 1 / 180;

    for (let seconds = dt; seconds <= maxSeconds; seconds += dt) {
      clone.vz -= GRAVITY * dt;
      clone.x += clone.vx * dt;
      clone.y += clone.vy * dt;
      clone.z += clone.vz * dt;
      const drag = Math.pow(0.998, dt * 60);
      clone.vx *= drag;
      clone.vy *= drag;

      if (clone.y <= 0 && clone.vy < 0) {
        clone.y = 0;
        if (clone.z < TIN_HEIGHT || clone.z > FRONT_OUT_HEIGHT) return null;
        clone.vy = Math.abs(clone.vy) * WALL_RESTITUTION;
        clone.frontHit = true;
      }

      if (Math.abs(clone.x) >= COURT_WIDTH / 2 && Math.sign(clone.vx) === Math.sign(clone.x)) {
        clone.x = Math.sign(clone.x) * COURT_WIDTH / 2;
        if (clone.z > sideOutHeight(clone.y)) return null;
        clone.vx *= -WALL_RESTITUTION;
      }

      if (clone.y >= COURT_LENGTH && clone.vy > 0) {
        clone.y = COURT_LENGTH;
        if (clone.z > BACK_OUT_HEIGHT) return null;
        clone.vy *= -WALL_RESTITUTION;
      }

      if (clone.z <= 0 && clone.vz < 0) {
        if (!clone.frontHit) return null;
        return {
          x: clamp(clone.x, -COURT_WIDTH / 2, COURT_WIDTH / 2),
          y: clamp(clone.y, 0, COURT_LENGTH),
          seconds,
          bounce: clone.floorBounces + 1,
        };
      }
    }
    return null;
  }

  predictNextWallImpact(maxSeconds = 2.5): PredictedWallImpact | null {
    if (!this.active || !this.lastHitter || this.frontHit) return null;
    const clone = {
      x: this.x,
      y: this.y,
      z: this.z,
      vx: this.vx,
      vy: this.vy,
      vz: this.vz,
    };
    const dt = 1 / 180;

    for (let seconds = dt; seconds <= maxSeconds; seconds += dt) {
      clone.vz -= GRAVITY * dt;
      clone.x += clone.vx * dt;
      clone.y += clone.vy * dt;
      clone.z += clone.vz * dt;
      const drag = Math.pow(0.998, dt * 60);
      clone.vx *= drag;
      clone.vy *= drag;

      if (clone.y <= 0 && clone.vy < 0) {
        if (clone.z < TIN_HEIGHT || clone.z > FRONT_OUT_HEIGHT) return null;
        return {
          surface: 'front',
          x: clamp(clone.x, -COURT_WIDTH / 2, COURT_WIDTH / 2),
          y: 0,
          z: clone.z,
          seconds,
        };
      }

      if (Math.abs(clone.x) >= COURT_WIDTH / 2 && Math.sign(clone.vx) === Math.sign(clone.x)) {
        clone.x = Math.sign(clone.x) * COURT_WIDTH / 2;
        if (clone.z > sideOutHeight(clone.y)) return null;
        return {
          surface: 'side',
          x: clone.x,
          y: clamp(clone.y, 0, COURT_LENGTH),
          z: clone.z,
          seconds,
        };
      }

      if (clone.y >= COURT_LENGTH && clone.vy > 0) {
        if (clone.z > BACK_OUT_HEIGHT) return null;
        return {
          surface: 'back',
          x: clamp(clone.x, -COURT_WIDTH / 2, COURT_WIDTH / 2),
          y: COURT_LENGTH,
          z: clone.z,
          seconds,
        };
      }

      if (clone.z <= 0 && clone.vz < 0) return null;
    }
    return null;
  }

  private fail(reason: string, hitter: PlayerId): BallEvent {
    this.active = false;
    return { type: 'fault', winner: otherPlayer(hitter), reason };
  }
}
