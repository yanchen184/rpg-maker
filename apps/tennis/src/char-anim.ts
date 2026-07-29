/**
 * 網球角色旗艦動畫狀態機。
 *
 * ready/run 是持續循環；擊球、發球、分腿墊步與賽果反應是一次性動作。
 * 一次性動作結束後會自動回到最新的移動狀態，不再靠容器旋轉或頭頂符號假裝演出。
 */
import { AnimatedSprite, Container, Text, type Texture } from 'pixi.js';

export type CharacterAction =
  | 'strained'
  | 'smash'
  | 'forehand'
  | 'backhand'
  | 'serve'
  | 'slice'
  | 'lob'
  | 'celebrate'
  | 'dejected'
  | 'fault'
  | 'splitstep'
  | 'brake';

type LocomotionKind = 'ready' | 'run';

export interface CharacterActionAssets {
  strained: Texture[];
  smash: Texture[];
  forehand: Texture[];
  backhand: Texture[];
  serve: Texture[];
  locomotion: Texture[];
  ready: Texture[];
  special: Texture[];
  reactions: Texture[];
}

const ACTION_FPS: Record<CharacterAction, number> = {
  strained: 28,
  smash: 48,
  forehand: 48,
  backhand: 48,
  serve: 48,
  slice: 36,
  lob: 36,
  celebrate: 24,
  dejected: 18,
  fault: 20,
  splitstep: 28,
  brake: 28,
};

const CONTACT_FRAME: Record<CharacterAction, number> = {
  strained: 11,
  smash: 20,
  forehand: 26,
  backhand: 21,
  serve: 20,
  slice: 10,
  lob: 10,
  celebrate: 0,
  dejected: 0,
  fault: 0,
  splitstep: 0,
  brake: 0,
};

const LOOP_FPS: Record<LocomotionKind, number> = {
  ready: 10,
  run: 24,
};

const ANCHOR_Y: Record<CharacterAction | LocomotionKind, number> = {
  strained: 0.933,
  smash: 0.933,
  forehand: 0.933,
  backhand: 0.933,
  serve: 0.933,
  slice: 0.933,
  lob: 0.933,
  celebrate: 0.933,
  dejected: 0.933,
  fault: 0.933,
  splitstep: 0.933,
  brake: 0.933,
  ready: 0.933,
  run: 0.933,
};

export class CharAnim {
  private actionSprite: AnimatedSprite | null = null;
  private actionKind: CharacterAction | null = null;
  private loopSprite: AnimatedSprite | null = null;
  private loopKind: LocomotionKind | null = null;
  private loopFacing = 1;
  private desiredMoving = false;
  private desiredFacing = 1;
  private host: Container | null = null;
  private baseVisibility: Array<{
    child: Container;
    visible: boolean;
    renderable: boolean;
    alpha: number;
  }> = [];

  constructor(
    private getView: () => Container | null,
    private assets: CharacterActionAssets,
    private scale: number,
  ) {}

  /**
   * 更新角色的底層循環。一次性動作播放中只記住最新狀態，結束後再切換，
   * 避免跑動輸入把擊球動畫蓋掉。
   */
  setLocomotion(moving: boolean, facing = 1): void {
    this.desiredMoving = moving;
    this.desiredFacing = facing || 1;
    if (!this.actionSprite) this.syncLoop();
  }

  /**
   * 播放一次性全身動作。
   * fromContact=true 用在球已經離拍的網路／物理事件，直接從接觸幀接續收拍；
   * false 用在發球蓄力、揮空與賽果反應，會從第一幀完整播放。
   */
  action(kind: CharacterAction, facing = 1, fromContact = true): void {
    const view = this.ensureHost();
    if (!view) return;
    this.destroySprite(this.actionSprite);
    this.actionSprite = null;
    this.actionKind = null;
    this.destroySprite(this.loopSprite);
    this.loopSprite = null;
    this.loopKind = null;
    this.hideBase(view);

    const sprite = this.buildSprite(this.framesForAction(kind, facing), kind, facing);
    sprite.loop = false;
    sprite.onComplete = () => {
      if (this.actionSprite !== sprite) return;
      this.destroySprite(sprite);
      this.actionSprite = null;
      this.actionKind = null;
      this.syncLoop();
    };
    view.addChild(sprite);
    this.actionSprite = sprite;
    this.actionKind = kind;
    sprite.gotoAndPlay(fromContact ? CONTACT_FRAME[kind] : 0);
  }

  get acting(): boolean {
    return !!this.actionSprite;
  }

  get rendering(): boolean {
    return !!this.actionSprite || !!this.loopSprite;
  }

  isAction(kind: CharacterAction): boolean {
    return this.actionKind === kind && !!this.actionSprite;
  }

  update(_dtSec: number): void {
    const view = this.getView();
    if (view !== this.host) {
      this.detachFromHost();
      this.host = view;
      if (!this.actionSprite) this.syncLoop();
    }
    if (!this.actionSprite || !this.actionKind) return;
    const frame = this.actionSprite.currentFrame;
    if (this.actionKind === 'serve') {
      this.actionSprite.y = frame >= 12 && frame <= 24 ? -Math.sin(((frame - 12) / 12) * Math.PI) * 18 : 0;
    } else if (this.actionKind === 'celebrate') {
      this.actionSprite.y = frame >= 4 && frame <= 9 ? -Math.sin(((frame - 4) / 5) * Math.PI) * 20 : 0;
    } else if (this.actionKind === 'splitstep') {
      this.actionSprite.y = frame >= 2 && frame <= 8 ? -Math.sin(((frame - 2) / 6) * Math.PI) * 10 : 0;
    } else {
      this.actionSprite.y = 0;
    }
  }

  private framesForAction(kind: CharacterAction, facing: number): Texture[] {
    if (kind === 'strained') return facing < 0 ? this.assets.strained.slice(0, 18) : this.assets.strained.slice(18, 36);
    if (kind === 'slice') return this.assets.special.slice(0, 18);
    if (kind === 'lob') return this.assets.special.slice(18, 36);
    if (kind === 'celebrate') return this.assets.reactions.slice(0, 12);
    if (kind === 'dejected') return this.assets.reactions.slice(12, 24);
    if (kind === 'fault') return this.assets.reactions.slice(24, 36);
    if (kind === 'splitstep') return this.assets.ready.slice(24, 36);
    if (kind === 'brake') return this.assets.locomotion.slice(30, 42);
    return this.assets[kind];
  }

  private framesForLoop(kind: LocomotionKind): Texture[] {
    return kind === 'run' ? this.assets.locomotion.slice(0, 30) : this.assets.ready.slice(0, 24);
  }

  private buildSprite(frames: Texture[], kind: CharacterAction | LocomotionKind, facing: number): AnimatedSprite {
    const sprite = new AnimatedSprite(frames);
    sprite.anchor.set(0.5, ANCHOR_Y[kind]);
    sprite.scale.set(this.scale * 1.45);
    if (this.shouldMirror(kind, facing)) sprite.scale.x *= -1;
    sprite.animationSpeed =
      (kind === 'ready' || kind === 'run' ? LOOP_FPS[kind] : ACTION_FPS[kind]) / 60;
    return sprite;
  }

  private shouldMirror(kind: CharacterAction | LocomotionKind, facing: number): boolean {
    if (kind === 'strained') return false;
    if (kind === 'backhand') return facing > 0;
    if (kind === 'ready') return facing > 0;
    return facing < 0;
  }

  private syncLoop(): void {
    if (this.actionSprite) return;
    const view = this.ensureHost();
    if (!view) return;
    const nextKind: LocomotionKind = this.desiredMoving ? 'run' : 'ready';
    if (this.loopSprite && this.loopKind === nextKind && this.loopFacing === this.desiredFacing) return;
    this.destroySprite(this.loopSprite);
    this.hideBase(view);
    const sprite = this.buildSprite(this.framesForLoop(nextKind), nextKind, this.desiredFacing);
    sprite.loop = true;
    view.addChild(sprite);
    sprite.play();
    this.loopSprite = sprite;
    this.loopKind = nextKind;
    this.loopFacing = this.desiredFacing;
  }

  private ensureHost(): Container | null {
    const view = this.getView();
    if (view === this.host) return view;
    this.detachFromHost();
    this.host = view;
    return view;
  }

  private hideBase(view: Container): void {
    if (this.baseVisibility.length > 0) return;
    this.baseVisibility = view.children
      .filter((child) => child !== this.actionSprite && child !== this.loopSprite && !(child instanceof Text))
      .map((child) => ({
        child: child as Container,
        visible: child.visible,
        renderable: child.renderable,
        alpha: child.alpha,
      }));
    for (const item of this.baseVisibility) {
      item.child.visible = false;
      item.child.renderable = false;
      item.child.alpha = 0;
    }
  }

  private restoreBase(): void {
    for (const item of this.baseVisibility) {
      if (!item.child.destroyed) {
        item.child.visible = item.visible;
        item.child.renderable = item.renderable;
        item.child.alpha = item.alpha;
      }
    }
    this.baseVisibility = [];
  }

  private destroySprite(sprite: AnimatedSprite | null): void {
    if (!sprite || sprite.destroyed) return;
    sprite.parent?.removeChild(sprite);
    sprite.destroy();
  }

  private detachFromHost(): void {
    this.destroySprite(this.actionSprite);
    this.destroySprite(this.loopSprite);
    this.actionSprite = null;
    this.actionKind = null;
    this.loopSprite = null;
    this.loopKind = null;
    this.restoreBase();
    this.host = null;
  }
}
