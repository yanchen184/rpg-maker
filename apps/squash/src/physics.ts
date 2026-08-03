import {
  BACK_OUT_HEIGHT,
  COURT_LENGTH,
  COURT_WIDTH,
  FRONT_OUT_HEIGHT,
  GRAVITY,
  SERVICE_LINE_HEIGHT,
  SHORT_LINE_Y,
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
  serveSide: -1 | 1 | null = null;
  serveAwaitingBounce = false;

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
    this.serveSide = null;
    this.serveAwaitingBounce = false;
  }

  strike(by: PlayerId, spec: ShotSpec): void {
    const quality = clamp(spec.quality, 0.12, 1);
    const pace = clamp(spec.pace ?? 1, 0.72, 1.12);
    const weak = quality < 0.55;
    const targetX = weak ? spec.targetX * 0.25 : spec.targetX;
    const spread = (1 - quality) * 0.7;
    const randomizedTarget = clamp(
      targetX + (Math.random() * 2 - 1) * spread,
      -COURT_WIDTH * 0.43,
      COURT_WIDTH * 0.43,
    );
    // Manual aim is a real trajectory input, not just a reticle. Poor contact
    // drags ambitious targets toward the lower middle and adds vertical
    // scatter, preserving the existing "stretched return becomes weak" chain.
    const aimedFrontHeight = spec.targetZ === undefined
      ? null
      : clamp(
          spec.targetZ * (0.35 + quality * 0.65) + 0.78 * (1 - quality) +
            (Math.random() * 2 - 1) * (1 - quality) * 0.42,
          TIN_HEIGHT - 0.12,
          FRONT_OUT_HEIGHT + 0.12,
        );

    if (spec.serving && spec.serveSide) {
      // A serve is deliberately a little firmer than a neutral drive. This
      // creates a real, engine-level initiative for the server without making
      // the receiver artificially miss.
      const frontSpeed = 14;
      // Aim through the receiver's back quarter and closer to the side wall.
      // A legal serve should begin the positional contest, not arrive as a
      // neutral ball directly beside the receiver.
      const desiredBounceX = -spec.serveSide * 2.48;
      const desiredBounceY = 7.55;
      const secondsToFront = this.y / frontSpeed;
      const secondsFrontToBounce = desiredBounceY / (frontSpeed * WALL_RESTITUTION);
      const secondsToBounce = secondsToFront + secondsFrontToBounce;

      this.vy = -frontSpeed;
      this.vx = aimedFrontHeight === null
        ? (desiredBounceX - this.x) / secondsToBounce
        : (randomizedTarget - this.x) / secondsToFront;
      this.vz = aimedFrontHeight === null
        ? (-this.z + 0.5 * GRAVITY * secondsToBounce ** 2) / secondsToBounce
        : (aimedFrontHeight - this.z + 0.5 * GRAVITY * secondsToFront ** 2) / secondsToFront;
      this.lastHitter = by;
      this.floorBounces = 0;
      this.frontHit = false;
      this.active = true;
      this.ageSeconds = 0;
      this.serveSide = spec.serveSide;
      this.serveAwaitingBounce = true;
      return;
    }

    this.serveSide = null;
    this.serveAwaitingBounce = false;

    if (spec.kind === 'glass') {
      // A rear-glass boast has to cover two court lengths while staying below
      // the 2.13 m rear out line. Solve one ballistic arc across the complete
      // back-to-front journey; the previous split-time formula launched every
      // otherwise valid attempt over the rear out line.
      const rearSpeed = 20.8 * pace * (weak ? 0.94 : 1);
      const secondsToBack = Math.max(0.045, (COURT_LENGTH - this.y) / rearSpeed);
      const secondsBackToFront = COURT_LENGTH / (rearSpeed * WALL_RESTITUTION);
      const totalFlightSeconds = secondsToBack + secondsBackToFront;
      const desiredFrontHeight = aimedFrontHeight ?? (weak ? 0.8 : 1.05);

      this.vy = rearSpeed;
      this.vx = clamp((randomizedTarget - this.x) / secondsToBack, -5.8, 5.8);
      this.vz =
        (
          desiredFrontHeight -
          this.z +
          0.5 * GRAVITY * totalFlightSeconds ** 2
        ) /
        totalFlightSeconds;
      this.lastHitter = by;
      this.floorBounces = 0;
      this.frontHit = false;
      this.active = true;
      this.ageSeconds = 0;
      return;
    }

    let frontSpeed = 13.3;
    let desiredBounceY = 6.8;
    let shallowBounceY = 2.9;
    let lateralBoost = 0;
    if (spec.kind === 'drop') {
      frontSpeed = 7.75;
      desiredBounceY = 1.3;
      shallowBounceY = 1.8;
    } else if (spec.kind === 'lob') {
      frontSpeed = 15.1;
      desiredBounceY = 8.25;
      shallowBounceY = 3.2;
    } else if (spec.kind === 'boast') {
      frontSpeed = 10.2;
      desiredBounceY = 4.25;
      shallowBounceY = 2.2;
      lateralBoost = this.x >= 0 ? -9.15 : 9.15;
    }
    const depthRetention = clamp((quality - 0.15) / 0.42, 0, 1);
    desiredBounceY =
      shallowBounceY + (desiredBounceY - shallowBounceY) * depthRetention;
    frontSpeed *= 0.86 + depthRetention * 0.14;
    lateralBoost *= 0.65 + depthRetention * 0.35;
    frontSpeed *= pace;
    lateralBoost *= pace;

    const secondsToFront = Math.max(0.16, this.y / frontSpeed);
    const secondsFrontToBounce =
      desiredBounceY / (frontSpeed * WALL_RESTITUTION);
    const secondsToBounce = secondsToFront + secondsFrontToBounce;
    this.vy = -frontSpeed;
    this.vx =
      spec.kind === 'boast'
        ? lateralBoost
        : (randomizedTarget - this.x) / secondsToFront;
    // Solve the vertical launch speed from the intended first-bounce depth.
    // This keeps length drives and lobs deep while preserving genuinely short
    // drops; contact quality can still force any shot into the shallow zone.
    this.vz = aimedFrontHeight === null
      ? (-this.z + 0.5 * GRAVITY * secondsToBounce ** 2) / secondsToBounce
      : (aimedFrontHeight - this.z + 0.5 * GRAVITY * secondsToFront ** 2) / secondsToFront;
    if (spec.kind === 'drive') {
      // Drives trade clearance for pace. Poor contact and an aggressive pace
      // both raise the chance of clipping the tin. Trying to drive a ball below
      // roughly knee height is the dominant risk; a lob remains the safer
      // tactical answer. Solve the miss as a real trajectory so the normal
      // wall-fault engine and match log handle it.
      const lowBallPressure = clamp((0.55 - this.z) / 0.42, 0, 1);
      const tinRisk = clamp(
        0.015 +
          (1 - quality) * 0.07 +
          Math.max(0, pace - 0.9) * 0.06 +
          lowBallPressure * 0.12,
        0.02,
        0.18,
      );
      if (Math.random() < tinRisk) {
        const tinImpactHeight = TIN_HEIGHT - 0.04 - Math.random() * 0.07;
        this.vz =
          (
            tinImpactHeight -
            this.z +
            0.5 * GRAVITY * secondsToFront ** 2
          ) /
          secondsToFront;
      }
    }
    this.lastHitter = by;
    this.floorBounces = 0;
    this.frontHit = false;
    this.active = true;
    this.ageSeconds = 0;
  }

  previewStrike(by: PlayerId, spec: ShotSpec, maxSeconds = 4.5): PredictedBounce | null {
    const preview = new SquashBall();
    preview.x = this.x;
    preview.y = this.y;
    preview.z = this.z;
    preview.strike(by, spec);
    const dt = 1 / 120;
    for (let seconds = dt; seconds <= maxSeconds; seconds += dt) {
      for (const event of preview.update(dt)) {
        if (event.type === 'fault') return null;
        if (event.type === 'floor') {
          return {
            x: event.x,
            y: event.y,
            seconds,
            bounce: event.bounce,
          };
        }
      }
    }
    return null;
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
        if (this.serveAwaitingBounce && this.z < SERVICE_LINE_HEIGHT) {
          events.push(this.fail('發球低於發球線', this.lastHitter));
          continue;
        }
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
        if (this.serveAwaitingBounce && !this.frontHit) {
          events.push(this.fail('發球須先碰正面牆', this.lastHitter));
          continue;
        }
        if (this.z > sideOutHeight(this.y)) {
          events.push(this.fail('側牆出界', this.lastHitter));
          continue;
        }
        this.vx *= -WALL_RESTITUTION;
        events.push({ type: 'side', x: this.x, y: this.y, z: this.z });
      }

      if (this.y >= COURT_LENGTH && this.vy > 0) {
        this.y = COURT_LENGTH;
        if (this.serveAwaitingBounce && !this.frontHit) {
          events.push(this.fail('發球須先碰正面牆', this.lastHitter));
          continue;
        }
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
        if (this.serveAwaitingBounce && this.serveSide) {
          const landedOpposite = Math.sign(this.x) === -this.serveSide;
          const landedDeep = this.y >= SHORT_LINE_Y;
          if (!landedOpposite || !landedDeep) {
            events.push(this.fail('發球未落入對角後場', this.lastHitter));
            continue;
          }
          this.serveAwaitingBounce = false;
          this.serveSide = null;
        }
        this.floorBounces += 1;
        this.vz = Math.abs(this.vz) * FLOOR_RESTITUTION;
        this.vx *= 0.96;
        this.vy *= 0.96;
        events.push({ type: 'floor', x: this.x, y: this.y, bounce: this.floorBounces });
        if (this.floorBounces >= 2) {
          const winner = this.lastHitter;
          this.active = false;
          events.push({ type: 'fault', winner, reason: '第二次落地' });
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
      // Pick the first practical mid/back-court contact window. Waiting until
      // the ball is almost on the rear floor leaves less time than the
      // character's contact animation and turns every rally into two shots.
      if (clone.frontHit && clone.z <= 1.5 && clone.y >= 4.65) {
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
