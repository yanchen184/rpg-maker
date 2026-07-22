/**
 * 遠端玩家的顯示 sprite:用同一套 char-body 素材依朝向渲染,頭上掛名牌。
 * 比本地 Player 精簡 —— 不吃鍵盤、不做碰撞、不換裝,只跟著網路狀態插值移動。
 */
import { AnimatedSprite, Container, Text, Texture } from 'pixi.js';
import { loadFrames } from '@rpg-maker/engine';
import type { Manifest } from '@rpg-maker/engine';
import type { PeerState } from './net';

const DIRS = ['down', 'left', 'right', 'up'];

export class RemotePlayer {
  view = new Container();
  private sprite: AnimatedSprite;
  private walk: Texture[];
  private idle: Texture[];
  private label: Text;
  private curDir = 'down';
  private curMoving = false;
  /** 目標座標(收到網路更新時設,實際位置向它插值以平滑) */
  private targetX = 0;
  private targetY = 0;

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

  static async create(manifest: Manifest, scale: number, st: PeerState): Promise<RemotePlayer> {
    const walkDef = manifest.assets['char-body-walk'];
    const idleDef = manifest.assets['char-body-idle'];
    const walk = await loadFrames('char-body-walk', walkDef);
    const idle = await loadFrames('char-body-idle', idleDef);
    const rp = new RemotePlayer(walk, idle, scale, st.name ?? '訪客');
    rp.targetX = st.x;
    rp.targetY = st.y;
    rp.view.x = st.x;
    rp.view.y = st.y;
    rp.applyDir(st.dir, false);
    return rp;
  }

  /** 收到網路更新:設目標座標與朝向;是否走動由座標是否變化推斷 */
  onUpdate(st: PeerState): void {
    const moved = Math.hypot(st.x - this.targetX, st.y - this.targetY) > 1;
    this.targetX = st.x;
    this.targetY = st.y;
    this.label.text = st.name ?? '訪客';
    this.applyDir(st.dir, moved);
  }

  private applyDir(dir: string, moving: boolean): void {
    if (dir === this.curDir && moving === this.curMoving) return;
    this.curDir = dir;
    this.curMoving = moving;
    const row = Math.max(0, DIRS.indexOf(dir));
    const src = moving ? this.walk : this.idle;
    this.sprite.textures = src.slice(row * 4, row * 4 + 4);
    this.sprite.animationSpeed = (moving ? 8 : 4) / 60;
    this.sprite.play();
  }

  /** 每幀:位置向目標插值(網路更新是離散的,插值讓移動平滑) */
  update(dtSec: number): void {
    const k = Math.min(1, dtSec * 12); // 插值速率
    this.view.x += (this.targetX - this.view.x) * k;
    this.view.y += (this.targetY - this.view.y) * k;
    this.view.zIndex = this.view.y;
    // 若已接近目標且原本標為移動 → 停下切 idle
    if (this.curMoving && Math.hypot(this.targetX - this.view.x, this.targetY - this.view.y) < 2) {
      this.applyDir(this.curDir, false);
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
