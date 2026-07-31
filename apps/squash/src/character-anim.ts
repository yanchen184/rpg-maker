import { AnimatedSprite, Container, Graphics, type Texture } from 'pixi.js';

export type SquashAction =
  | 'forehand'
  | 'backhand'
  | 'reach'
  | 'celebrate'
  | 'dejected'
  | 'splitstep'
  | 'glance';

interface SquashAnimationAssets {
  actions: Texture[];
  backhand: Texture[];
  rearLoops: Texture[];
  reactions: Texture[];
}

const ACTION_FPS: Record<SquashAction, number> = {
  forehand: 36,
  backhand: 36,
  reach: 30,
  celebrate: 24,
  dejected: 18,
  splitstep: 28,
  glance: 12,
};

const CONTACT_FRAME: Record<SquashAction, number> = {
  forehand: 6,
  backhand: 6,
  reach: 6,
  celebrate: 0,
  dejected: 0,
  splitstep: 0,
  glance: 0,
};

export class SquashCharacterAnim {
  readonly view = new Container();
  private loopSprite: AnimatedSprite | null = null;
  private actionSprite: AnimatedSprite | null = null;
  private desiredMoving = false;
  private loopKind: 'ready' | 'run' | null = null;
  private idleSeconds = 0;
  private glanceAfter = 4 + Math.random() * 4;
  private playbackRate = 1;

  constructor(
    private assets: SquashAnimationAssets,
    private tint: number,
  ) {
    const shadow = new Graphics().ellipse(0, 0, 35, 10).fill({ color: 0x020609, alpha: 0.28 });
    shadow.y = 2;
    this.view.addChild(shadow);
    this.syncLoop();
  }

  setLocomotion(moving: boolean, _facing: number): void {
    this.desiredMoving = moving;
    if (moving) {
      this.idleSeconds = 0;
      if (this.actionSprite?.label === 'glance') this.stopAction();
    }
    if (!this.actionSprite) this.syncLoop();
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = rate;
    if (this.loopSprite) {
      this.loopSprite.animationSpeed = (this.loopKind === 'run' ? 24 : 10) / 60 * rate;
    }
    if (this.actionSprite) {
      const action = this.actionSprite.label as SquashAction;
      this.actionSprite.animationSpeed = ACTION_FPS[action] / 60 * rate;
    }
  }

  action(kind: SquashAction, facing: number, fromContact = false): void {
    this.stopAction();
    this.destroyLoop();
    const sprite = new AnimatedSprite(this.framesFor(kind));
    sprite.label = kind;
    sprite.anchor.set(0.5, 0.933);
    sprite.animationSpeed = ACTION_FPS[kind] / 60 * this.playbackRate;
    sprite.scale.set(1.94);
    sprite.tint = this.tint;
    if (this.shouldMirror(kind, facing)) sprite.scale.x *= -1;
    sprite.loop = false;
    sprite.onComplete = () => {
      if (this.actionSprite !== sprite) return;
      this.stopAction();
      this.idleSeconds = 0;
      this.glanceAfter = 4 + Math.random() * 4;
      this.syncLoop();
    };
    this.view.addChild(sprite);
    this.actionSprite = sprite;
    sprite.gotoAndPlay(fromContact ? CONTACT_FRAME[kind] : 0);
  }

  update(dtSeconds: number): void {
    if (!this.desiredMoving && !this.actionSprite) {
      this.idleSeconds += dtSeconds;
      if (this.idleSeconds >= this.glanceAfter) this.action('glance', -1);
    }
  }

  private framesFor(kind: SquashAction): Texture[] {
    if (kind === 'forehand') return this.assets.actions.slice(0, 12);
    if (kind === 'backhand') return this.assets.backhand;
    if (kind === 'reach') return this.assets.actions.slice(24, 36);
    if (kind === 'celebrate') return this.assets.reactions.slice(0, 12);
    if (kind === 'dejected') return this.assets.reactions.slice(12, 24);
    if (kind === 'splitstep') return this.assets.rearLoops.slice(0, 6);
    return this.assets.rearLoops.slice(6, 12);
  }

  private syncLoop(): void {
    const kind = this.desiredMoving ? 'run' : 'ready';
    if (this.loopSprite && this.loopKind === kind) {
      return;
    }
    this.destroyLoop();
    const frames = kind === 'run'
      ? this.assets.rearLoops.slice(12, 24)
      : this.assets.rearLoops.slice(0, 6);
    const sprite = new AnimatedSprite(frames);
    sprite.anchor.set(0.5, 0.933);
    sprite.animationSpeed = (kind === 'run' ? 24 : 10) / 60 * this.playbackRate;
    sprite.scale.set(1.94);
    sprite.tint = this.tint;
    sprite.loop = true;
    this.view.addChild(sprite);
    sprite.play();
    this.loopSprite = sprite;
    this.loopKind = kind;
  }

  private shouldMirror(kind: SquashAction, facing: number): boolean {
    if (kind === 'glance') return false;
    if (kind === 'forehand' || kind === 'backhand' || kind === 'reach' || kind === 'splitstep') {
      return false;
    }
    return facing < 0;
  }

  private stopAction(): void {
    if (!this.actionSprite) return;
    this.actionSprite.parent?.removeChild(this.actionSprite);
    this.actionSprite.destroy();
    this.actionSprite = null;
  }

  private destroyLoop(): void {
    if (!this.loopSprite) return;
    this.loopSprite.parent?.removeChild(this.loopSprite);
    this.loopSprite.destroy();
    this.loopSprite = null;
    this.loopKind = null;
  }
}
