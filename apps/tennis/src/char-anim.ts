/**
 * 角色程式化姿勢 + 正式網球 sprite 動作。
 *
 * 一般短動作仍用容器位移/旋轉;勉強救球與殺球改播完整逐格人物動畫，
 * 讓表情與全身動勢住在角色本身，不再靠頭頂 emoji 代替演出。
 */
import { AnimatedSprite, Container, type Texture } from 'pixi.js';

export type PoseKind = 'swing' | 'celebrate' | 'droop' | 'shrug' | 'splitstep' | 'dash' | 'smash';
export type CharacterAction = 'strained' | 'smash' | 'forehand' | 'backhand';

export interface CharacterActionAssets {
  strained: Texture[];
  smash: Texture[];
  forehand: Texture[];
  backhand: Texture[];
}

interface PoseState {
  kind: PoseKind;
  t: number;
  dur: number;
  facing: number;
}

const POSE_DUR: Record<PoseKind, number> = {
  swing: 0.22,
  celebrate: 0.9,
  droop: 0.8,
  shrug: 0.45,
  splitstep: 0.28,
  dash: 0.3,
  smash: 0.34,
};

const ACTION_FPS: Record<CharacterAction, number> = {
  strained: 28,
  smash: 48,
  forehand: 48,
  backhand: 48,
};

const CONTACT_FRAME: Record<CharacterAction, number> = {
  strained: 11,
  smash: 20,
  forehand: 26,
  backhand: 21,
};

export class CharAnim {
  private poseState: PoseState | null = null;
  private actionSprite: AnimatedSprite | null = null;
  private actionHost: Container | null = null;
  private hiddenChildren: Array<{ child: Container; visible: boolean }> = [];

  constructor(
    private getView: () => Container | null,
    private actionAssets: CharacterActionAssets,
    private scale: number,
  ) {}

  /** 播短姿勢;facing = 動作朝向(畫面右 +1 / 左 -1)。 */
  pose(kind: PoseKind, facing = 1): void {
    if (this.actionSprite) return;
    this.poseState = { kind, t: 0, dur: POSE_DUR[kind], facing };
  }

  /**
   * 播完整人物 sprite。
   * strained sheet 前 18 幀向左、後 18 幀向右;其餘各是一套 36 幀完整動作。
   */
  action(kind: CharacterAction, facing = 1): void {
    const view = this.getView();
    if (!view) return;
    this.clearAction();
    this.poseState = null;
    view.pivot.set(0, 0);
    view.rotation = 0;

    const source = this.actionAssets[kind];
    const frames =
      kind === 'strained'
        ? facing < 0
          ? source.slice(0, 18)
          : source.slice(18, 36)
        : source;
    const sprite = new AnimatedSprite(frames);
    sprite.anchor.set(0.5, 1);
    const actionScale = this.scale * (kind === 'strained' ? 1.25 : 1.45);
    sprite.scale.set(actionScale);
    const mirror =
      (kind === 'smash' && facing < 0) ||
      (kind === 'forehand' && facing < 0) ||
      (kind === 'backhand' && facing > 0);
    if (mirror) sprite.scale.x *= -1;
    sprite.animationSpeed = ACTION_FPS[kind] / 60;
    sprite.loop = false;

    this.hiddenChildren = view.children.map((child) => ({
      child: child as Container,
      visible: child.visible,
    }));
    for (const item of this.hiddenChildren) item.child.visible = false;
    view.addChild(sprite);
    this.actionSprite = sprite;
    this.actionHost = view;
    sprite.onComplete = () => this.clearAction();
    sprite.gotoAndPlay(CONTACT_FRAME[kind]);
  }

  get acting(): boolean {
    return !!this.actionSprite;
  }

  private clearAction(): void {
    if (this.actionSprite && !this.actionSprite.destroyed) {
      this.actionHost?.removeChild(this.actionSprite);
      this.actionSprite.destroy();
    }
    for (const item of this.hiddenChildren) {
      if (!item.child.destroyed) item.child.visible = item.visible;
    }
    this.actionSprite = null;
    this.actionHost = null;
    this.hiddenChildren = [];
  }

  update(dtSec: number): void {
    const view = this.getView();
    if (!view || this.actionSprite) return;
    if (!this.poseState) return;

    const ps = this.poseState;
    ps.t += dtSec;
    const p = Math.min(1, ps.t / ps.dur);
    let lift = 0;
    let rot = 0;
    let lunge = 0;
    if (ps.kind === 'swing') {
      const s = Math.sin(p * Math.PI);
      rot = s * 0.3 * ps.facing;
      lift = s * 8;
      lunge = s * 10 * ps.facing;
    } else if (ps.kind === 'splitstep') {
      lift = p < 0.6 ? Math.sin((p / 0.6) * Math.PI) * 10 : -Math.sin(((p - 0.6) / 0.4) * Math.PI) * 3;
    } else if (ps.kind === 'dash') {
      const s = Math.sin(p * Math.PI);
      lift = -s * 12;
      rot = s * 0.5 * ps.facing;
      lunge = s * 22 * ps.facing;
    } else if (ps.kind === 'smash') {
      const rise = Math.sin(Math.min(1, p / 0.4) * (Math.PI / 2));
      const drop = p < 0.4 ? 0 : Math.sin(((p - 0.4) / 0.6) * Math.PI);
      lift = rise * 20 - drop * 16;
      rot = drop * 0.34 * ps.facing;
      lunge = drop * 14 * ps.facing;
    } else if (ps.kind === 'celebrate') {
      lift = Math.abs(Math.sin(p * Math.PI * 2)) * 22 * (1 - p * 0.3);
      rot = Math.sin(p * Math.PI * 4) * 0.08;
    } else if (ps.kind === 'droop') {
      const sag = Math.sin(Math.min(1, p * 1.25) * Math.PI);
      lift = -sag * 8;
      rot = sag * 0.12 * ps.facing;
    } else {
      lift = -Math.sin(p * Math.PI) * 6;
    }
    view.pivot.y = lift;
    view.pivot.x = -lunge;
    view.rotation = rot;
    if (p >= 1) {
      this.poseState = null;
      view.pivot.set(0, 0);
      view.rotation = 0;
    }
  }
}
