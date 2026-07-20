import { AnimatedSprite, Container, Text, Texture } from 'pixi.js';
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
  private scale = 1;
  /** 具名 overlay 插槽(hair / outfit ...),可 runtime 換 */
  private overlays = new Map<string, LayerAnim>();
  /** 轉身過渡:純轉向(移動中改方向)時,先頓一下再邁步的剩餘秒數 */
  private turnLock = 0;
  /** 轉身頓挫時長(秒);太長會頓住不跟手,90ms 約一個 beat */
  private static readonly TURN_LOCK_SEC = 0.09;
  /** 打招呼:頭上 👋 氣泡的剩餘秒數 + 氣泡本體 */
  private greetLeft = 0;
  private greetBubble: Text | null = null;
  private greetHandled = false;
  private static readonly GREET_SEC = 1.0;

  static async create(manifest: Manifest, layerNames: string[], scale: number): Promise<Player> {
    const p = new Player();
    p.scale = scale;
    for (const name of layerNames) {
      const layer = await p.buildLayer(manifest, name);
      if (!layer) continue;
      p.layers.push(layer);
      p.view.addChild(layer.sprite);
    }
    p.bindKeys();
    return p;
  }

  private async buildLayer(manifest: Manifest, name: string): Promise<LayerAnim | null> {
    const walkDef = manifest.assets[`${name}-walk`];
    const idleDef = manifest.assets[`${name}-idle`];
    if (!walkDef || !idleDef) {
      console.warn(`紙娃娃層 ${name} 缺 walk/idle sheet,略過`);
      return null;
    }
    const walk = await loadFrames(`${name}-walk`, walkDef);
    const idle = await loadFrames(`${name}-idle`, idleDef);
    const row = DIRS.indexOf(this.dir);
    const src = this.moving ? walk : idle;
    const sp = new AnimatedSprite(src.slice(row * 4, row * 4 + 4));
    sp.anchor.set(0.5, 1);
    sp.scale.set(this.scale);
    sp.animationSpeed = (this.moving ? 8 : 4) / 60;
    sp.play();
    return { sprite: sp, walk, idle };
  }

  /** 換 overlay 插槽的素材(如 hair 換色);name 傳 null = 拿掉該層 */
  async setOverlay(manifest: Manifest, slot: string, name: string | null): Promise<void> {
    const old = this.overlays.get(slot);
    if (old) {
      this.view.removeChild(old.sprite);
      const i = this.layers.indexOf(old);
      if (i >= 0) this.layers.splice(i, 1);
      old.sprite.destroy();
      this.overlays.delete(slot);
    }
    if (!name) return;
    const layer = await this.buildLayer(manifest, name);
    if (!layer) return;
    this.overlays.set(slot, layer);
    this.layers.push(layer);
    this.view.addChild(layer.sprite);
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
    // 純轉身(移動中只改方向)→ 先頓一下再邁步;起步/停步不頓
    const turning = moving && this.moving && dir !== this.dir;
    this.moving = moving;
    this.dir = dir;
    const row = DIRS.indexOf(dir);
    for (const l of this.layers) {
      const src = moving ? l.walk : l.idle;
      const fps = moving ? 8 : 4;
      l.sprite.textures = src.slice(row * 4, row * 4 + 4);
      l.sprite.animationSpeed = fps / 60;
      if (turning) {
        // 定格在該方向首幀(靜止站姿),鎖到期才由 update 放行邁步
        l.sprite.gotoAndStop(0);
      } else {
        l.sprite.play();
      }
    }
    this.turnLock = turning ? Player.TURN_LOCK_SEC : 0;
  }

  /** 打招呼:頭上冒 👋 氣泡並定格站姿一下(純程式,不需招手素材) */
  greet() {
    if (this.greetLeft > 0) return; // 招呼中不重複觸發
    this.greetLeft = Player.GREET_SEC;
    if (!this.greetBubble) {
      this.greetBubble = new Text({
        text: '👋',
        style: { fontSize: 48, fill: 0xffffff },
      });
      this.greetBubble.anchor.set(0.5, 1);
      // 角色原點在腳底(anchor 0.5,1),頭頂約在 -身高;氣泡放頭頂上方
      this.greetBubble.y = -this.spriteHeight() - 8;
      this.view.addChild(this.greetBubble);
    }
    this.greetBubble.visible = true;
    // 定格:停在當前方向 idle/walk 首幀(靜止站姿),更像「停下來打招呼」
    const row = DIRS.indexOf(this.dir);
    for (const l of this.layers) {
      l.sprite.textures = l.idle.slice(row * 4, row * 4 + 4);
      l.sprite.gotoAndStop(0);
    }
    this.moving = false; // 招呼期間視為靜止,交回 update 後由 setAnim 復原
  }

  /** 角色縮放後的顯示高度(取 body 那層) */
  private spriteHeight(): number {
    const body = this.layers[0]?.sprite;
    return body ? body.height : 200 * this.scale;
  }

  get aabb(): Aabb {
    return { x: this.x, y: this.y - this.collider.h / 2, w: this.collider.w, h: this.collider.h };
  }

  update(dtSec: number, colliders: Aabb[]) {
    // 打招呼:E 觸發一次(按住不連發);招呼期間定格、不移動
    const greetKey = this.keys.has('e');
    if (greetKey && !this.greetHandled) this.greet();
    this.greetHandled = greetKey;
    if (this.greetLeft > 0) {
      this.greetLeft -= dtSec;
      if (this.greetLeft <= 0) {
        this.greetLeft = 0;
        if (this.greetBubble) this.greetBubble.visible = false;
        // 恢復動畫播放(招呼時 gotoAndStop 停住了),下方 setAnim 會依實際狀態重設
        for (const l of this.layers) l.sprite.play();
      } else {
        // 招呼中:定住位置,只更新 view 座標(角色可能剛移動到此)
        this.view.x = this.x;
        this.view.y = this.y;
        this.view.zIndex = this.y;
        return;
      }
    }

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

    // 轉身鎖:到期後從定格首幀放行邁步(只放行一次,避免每幀重呼 play)
    if (this.turnLock > 0) {
      this.turnLock -= dtSec;
      if (this.turnLock <= 0) {
        this.turnLock = 0;
        for (const l of this.layers) l.sprite.play();
      }
    }

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
