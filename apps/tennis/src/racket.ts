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
    // 初始姿勢由第一次 update() 依面向擺好,先給正面持拍角
    this.arm.rotation = this.rotFromVisual(Math.PI - 0.68);
  }

  swing(): void {
    this.swingT = 0;
  }

  get swinging(): boolean {
    return this.swingT >= 0;
  }

  /**
   * 把「想要的視覺角 φ」換算成 arm.rotation。
   * arm.scale.x = facing 固定(揮拍弧線靠它鏡像);Pixi 先 scale 後 rotate,
   * scale.x=-1 時柄從 +x 翻到 -x,視覺角 = rotation + π → rotation 要扣 π。
   */
  private rotFromVisual(phi: number): number {
    return this.facing === 1 ? phi : phi - Math.PI;
  }

  /** 每幀跟隨主人位置 + 推進揮拍動畫(dir = 主人面向,右手持拍:錨點跟面向換邊) */
  update(dtSec: number, ownerX: number, ownerY: number, dir: string = 'down'): void {
    if (this.swingT >= 0) {
      // 揮拍中:轉身朝網出手,手回網側(真實網球本來就側身擊球,220ms 內是一個轉身動作)
      this.view.x = ownerX + this.facing * 17;
      this.view.y = ownerY - 36;
      this.view.zIndex = ownerY + 1;
      this.swingT += dtSec;
      const p = this.swingT / (SWING_MS / 1000);
      if (p < 1) {
        // 由後往前掃:-100° → +80°,前段快後段收(easeOut);乘 facing 讓右方鏡像對稱
        const e = 1 - (1 - p) * (1 - p);
        this.arm.rotation = this.facing * (-1.75 + e * 3.15);
        return;
      }
      this.swingT = -1; // 收拍,落回下面的持拍姿勢
    }
    // 平時:右手持拍,握拍手跟角色面向換邊(正面=畫面左、背面=畫面右、側身=身體前/後緣)
    let hx: number;
    let front = true;
    switch (dir) {
      case 'up': // 背對鏡頭:右手在畫面右
        hx = 17;
        break;
      case 'right': // 面朝右:右手在遠側,拍子被身體半擋
        hx = 7;
        front = false;
        break;
      case 'left': // 面朝左:右手在近側
        hx = -7;
        break;
      default: // 正面(down):右手在畫面左
        hx = -17;
    }
    this.view.x = ownerX + hx;
    this.view.y = ownerY - 36;
    this.view.zIndex = front ? ownerY + 1 : ownerY - 1;
    // 拍頭朝斜下外側(自然垂手持拍):錨在身體右緣時朝右下,左緣時朝左下;側身角度立一點
    const sideOn = dir === 'left' || dir === 'right';
    const tilt = sideOn ? 1.0 : 0.68;
    this.arm.rotation = this.rotFromVisual(hx >= 0 ? tilt : Math.PI - tilt);
  }
}
