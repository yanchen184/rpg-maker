/**
 * 球拍:掛在玩家身側,揮拍時朝網掃出一道弧線(220ms)。
 * 純呈現物件 —— 擊中判定在 main(拍距 + 球高 + 揮拍時間窗),這裡只管畫。
 */
import { Container, Graphics } from 'pixi.js';

export const SWING_MS = 220;

export class Racket {
  view = new Container();
  /** 1 = 朝右揮(左半場玩家),-1 = 朝左揮 */
  private facing: 1 | -1;
  private swingT = -1; // 揮拍動畫已播秒數;<0 = 未在揮
  private arm: Container;

  constructor(facing: 1 | -1) {
    this.facing = facing;
    this.arm = new Container();
    const g = new Graphics();
    // 柄(從手心往外)+ 橢圓拍面 + 網紋
    g.moveTo(0, 0).lineTo(22, 0).stroke({ color: 0x7a4a22, width: 4 });
    g.ellipse(33, 0, 12, 9).fill({ color: 0xe8e2d0, alpha: 0.9 });
    g.ellipse(33, 0, 12, 9).stroke({ color: 0x333333, width: 2 });
    g.moveTo(25, -4).lineTo(41, -4).stroke({ color: 0x999999, width: 1, alpha: 0.8 });
    g.moveTo(24, 0).lineTo(42, 0).stroke({ color: 0x999999, width: 1, alpha: 0.8 });
    g.moveTo(25, 4).lineTo(41, 4).stroke({ color: 0x999999, width: 1, alpha: 0.8 });
    this.arm.addChild(g);
    this.view.addChild(this.arm);
    this.arm.scale.x = facing;
    this.arm.rotation = this.restRotation();
  }

  private restRotation(): number {
    // 預備姿勢:拍頭朝上前方(掉到正值會像拍子拖地)。
    // scale.x 鏡像後同一 rotation 對右方是點對稱不是鏡像,角度要乘 facing 才左右對稱。
    return this.facing * -0.55;
  }

  swing(): void {
    this.swingT = 0;
  }

  get swinging(): boolean {
    return this.swingT >= 0;
  }

  /** 每幀跟隨主人位置 + 推進揮拍動畫 */
  update(dtSec: number, ownerX: number, ownerY: number): void {
    this.view.x = ownerX + this.facing * 13;
    this.view.y = ownerY - 24;
    this.view.zIndex = ownerY + 1;
    if (this.swingT < 0) return;
    this.swingT += dtSec;
    const p = this.swingT / (SWING_MS / 1000);
    if (p >= 1) {
      this.swingT = -1;
      this.arm.rotation = this.restRotation();
      return;
    }
    // 由後往前掃:-100° → +80°,前段快後段收(easeOut);乘 facing 讓右方鏡像對稱
    const e = 1 - (1 - p) * (1 - p);
    this.arm.rotation = this.facing * (-1.75 + e * 3.15);
  }
}
