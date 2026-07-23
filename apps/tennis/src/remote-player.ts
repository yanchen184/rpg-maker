/**
 * 對手的顯示 sprite:同一套 char-body 素材依朝向渲染,頭上掛名牌。
 * 不吃鍵盤、不做碰撞,只跟著網路狀態插值移動;emote() 顯示揮拍等 emoji 泡泡。
 */
import { AnimatedSprite, Container, Text, Texture } from 'pixi.js';
import { loadFrames } from '@rpg-maker/engine';
import type { Manifest } from '@rpg-maker/engine';
import type { PlayerState } from './net-tennis';

const DIRS = ['down', 'left', 'right', 'up'];

export class RemotePlayer {
  view = new Container();
  private sprite: AnimatedSprite;
  private walk: Texture[];
  private idle: Texture[];
  private label: Text;
  private curDir = 'down';
  private curMoving = false;
  private targetX = 0;
  private targetY = 0;
  private bubble: Text | null = null;
  private bubbleLeft = 0;

  private constructor(walk: Texture[], idle: Texture[], scale: number, name: string) {
    this.walk = walk;
    this.idle = idle;
    this.sprite = new AnimatedSprite(idle.slice(0, 4));
    this.sprite.anchor.set(0.5, 1);
    this.sprite.scale.set(scale);
    this.sprite.animationSpeed = 4 / 60;
    this.sprite.play();
    this.view.addChild(this.sprite);
    this.label = new Text({
      text: name,
      style: { fontSize: 20, fill: 0xffe08a, stroke: { color: 0x1a1410, width: 4 } },
    });
    this.label.anchor.set(0.5, 1);
    this.label.y = -this.sprite.height - 6;
    this.view.addChild(this.label);
  }

  static async create(manifest: Manifest, scale: number, st: PlayerState, name: string): Promise<RemotePlayer> {
    const walk = await loadFrames('char-body-walk', manifest.assets['char-body-walk']);
    const idle = await loadFrames('char-body-idle', manifest.assets['char-body-idle']);
    const rp = new RemotePlayer(walk, idle, scale, name);
    rp.targetX = st.x;
    rp.targetY = st.y;
    rp.view.x = st.x;
    rp.view.y = st.y;
    rp.applyDir(st.dir, false);
    return rp;
  }

  /** 收到網路更新:設目標座標與朝向;是否走動由座標是否變化推斷 */
  onUpdate(st: PlayerState): void {
    const moved = Math.hypot(st.x - this.targetX, st.y - this.targetY) > 1;
    this.targetX = st.x;
    this.targetY = st.y;
    this.applyDir(st.dir, moved);
  }

  /** 頭上短暫顯示 emoji 泡泡(對手揮拍 🎾 等) */
  emote(emoji: string, durSec = 0.6): void {
    if (!this.bubble) {
      this.bubble = new Text({ style: { fontSize: 40, fill: 0xffffff } });
      this.bubble.anchor.set(0.5, 1);
      this.view.addChild(this.bubble);
    }
    this.bubble.text = emoji;
    this.bubble.y = -this.sprite.height - 30;
    this.bubble.visible = true;
    this.bubbleLeft = durSec;
  }

  private applyDir(dir: string, moving: boolean): void {
    if (dir === this.curDir && moving === this.curMoving) return;
    this.curDir = dir;
    this.curMoving = moving;
    const row = Math.max(0, DIRS.indexOf(dir));
    const src = moving ? this.walk : this.idle;
    this.sprite.textures = src.slice(row * 4, row * 4 + 4);
    this.sprite.animationSpeed = (moving ? 14 : 4) / 60; // 球場上的步頻是跑不是走
    this.sprite.play();
  }

  /** 每幀:位置向目標插值(網路更新是離散的,插值讓移動平滑) */
  update(dtSec: number): void {
    const k = Math.min(1, dtSec * 12);
    this.view.x += (this.targetX - this.view.x) * k;
    this.view.y += (this.targetY - this.view.y) * k;
    this.view.zIndex = this.view.y;
    if (this.curMoving && Math.hypot(this.targetX - this.view.x, this.targetY - this.view.y) < 2) {
      this.applyDir(this.curDir, false);
    }
    if (this.bubbleLeft > 0) {
      this.bubbleLeft -= dtSec;
      if (this.bubbleLeft <= 0 && this.bubble) this.bubble.visible = false;
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
