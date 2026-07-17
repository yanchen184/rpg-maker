import { AnimatedSprite, Container, Texture } from 'pixi.js';
import { loadFrames } from './assets';
import { aabbOverlap } from './scene';
import type { Aabb, Manifest } from './types';

/**
 * 紙娃娃角色:由多個 layer(body / hair / outfit ...)疊成。
 * 每個 layer 有 walk 與 idle 兩張 sheet,皆為 4x4 grid:
 * 列 = 方向(0 下, 1 左, 2 右, 3 上),欄 = 該方向 4 幀。
 */
const DIRS = ['down', 'left', 'right', 'up'] as const;
export type Dir = (typeof DIRS)[number];

interface LayerAnim {
  sprite: AnimatedSprite;
  walk: Texture[]; // 16 幀
  idle: Texture[]; // 16 幀
}

export class Player {
  view = new Container();
  x = 0;
  y = 0;
  speed = 220;
  dir: Dir = 'down';
  moving = false;
  /** 腳底碰撞框 */
  collider = { w: 42, h: 22 };
  private layers: LayerAnim[] = [];
  private keys = new Set<string>();

  static async create(manifest: Manifest, layerNames: string[], scale: number): Promise<Player> {
    const p = new Player();
    for (const name of layerNames) {
      const walkDef = manifest.assets[`${name}-walk`];
      const idleDef = manifest.assets[`${name}-idle`];
      if (!walkDef || !idleDef) {
        console.warn(`紙娃娃層 ${name} 缺 walk/idle sheet,略過`);
        continue;
      }
      const walk = await loadFrames(`${name}-walk`, walkDef);
      const idle = await loadFrames(`${name}-idle`, idleDef);
      const sp = new AnimatedSprite(idle.slice(0, 4));
      sp.anchor.set(0.5, 1);
      sp.scale.set(scale);
      sp.animationSpeed = idleDef.fps / 60;
      sp.play();
      p.layers.push({ sprite: sp, walk, idle });
      p.view.addChild(sp);
    }
    p.bindKeys();
    return p;
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  private setAnim(moving: boolean, dir: Dir) {
    if (moving === this.moving && dir === this.dir) return;
    this.moving = moving;
    this.dir = dir;
    const row = DIRS.indexOf(dir);
    for (const l of this.layers) {
      const src = moving ? l.walk : l.idle;
      const fps = moving ? 8 : 4;
      l.sprite.textures = src.slice(row * 4, row * 4 + 4);
      l.sprite.animationSpeed = fps / 60;
      l.sprite.play();
    }
  }

  get aabb(): Aabb {
    return { x: this.x, y: this.y - this.collider.h / 2, w: this.collider.w, h: this.collider.h };
  }

  update(dtSec: number, colliders: Aabb[]) {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;

    const moving = dx !== 0 || dy !== 0;
    let dir = this.dir;
    if (dy > 0) dir = 'down';
    else if (dy < 0) dir = 'up';
    if (dx > 0) dir = 'right';
    else if (dx < 0) dir = 'left';
    this.setAnim(moving, dir);

    if (moving) {
      const len = Math.hypot(dx, dy);
      const step = (this.speed * dtSec) / len;
      // x/y 分開嘗試,撞牆時能沿牆滑
      const tryMove = (nx: number, ny: number): boolean => {
        const box: Aabb = { x: nx, y: ny - this.collider.h / 2, w: this.collider.w, h: this.collider.h };
        return !colliders.some((c) => aabbOverlap(box, c));
      };
      const nx = this.x + dx * step;
      if (tryMove(nx, this.y)) this.x = nx;
      const ny = this.y + dy * step;
      if (tryMove(this.x, ny)) this.y = ny;
    }

    this.view.x = this.x;
    this.view.y = this.y;
    this.view.zIndex = this.y;
  }
}
