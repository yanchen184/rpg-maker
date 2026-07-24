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
  private trail: Graphics; // 揮拍殘影弧:單幀截圖也看得出「正在揮」

  constructor(facing: 1 | -1) {
    this.facing = facing;
    this.trail = new Graphics();
    this.view.addChild(this.trail);
    this.arm = new Container();
    const g = new Graphics();
    // 柄(root 往內縮 4px 藏進拳頭,握起來不是「貼著手」)+ 橢圓拍面 + 網紋
    g.moveTo(-4, 0).lineTo(22, 0).stroke({ color: 0x7a4a22, width: 4 });
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

  /** 每幀跟隨主人位置 + 推進揮拍動畫(dir = 主人面向,右手持拍:錨點釘在該方向拳頭的實測像素) */
  update(dtSec: number, ownerX: number, ownerY: number, dir: string = 'down'): void {
    if (this.swingT >= 0) {
      // 揮拍中:抬到肩高朝網掃出大弧(-120° → +86°),前段快後段收(easeOut)
      this.view.x = ownerX + this.facing * 18;
      this.view.y = ownerY - 58;
      this.view.zIndex = ownerY + 1;
      this.swingT += dtSec;
      const p = this.swingT / (SWING_MS / 1000);
      if (p < 1) {
        const e = 1 - (1 - p) * (1 - p);
        this.arm.rotation = this.facing * (-2.1 + e * 3.6);
        // 殘影弧:只留跟在拍頭後面的一段(彗星尾),畫全弧會像套在身上的呼拉圈
        const vis = (ee: number): number =>
          this.facing === 1 ? -2.1 + ee * 3.6 : Math.PI + 2.1 - ee * 3.6;
        this.trail.clear();
        this.trail
          .arc(0, 0, 40, vis(Math.max(0, e - 0.4)), vis(e), this.facing === -1)
          .stroke({ color: 0xffffff, width: 12, alpha: 0.35 });
        this.trail
          .arc(0, 0, 40, vis(Math.max(0, e - 0.15)), vis(e), this.facing === -1)
          .stroke({ color: 0xffffff, width: 5, alpha: 0.9 });
        return;
      }
      this.swingT = -1; // 收拍,落回下面的持拍姿勢
      this.trail.clear();
    }
    // 平時:右手持拍、拍頭朝上的預備姿勢(網球員拿拍樣)。
    // 錨點 = 各方向 idle 圖實測的拳頭位置(相對玩家錨點);phi = 拍柄指向的視覺角。
    // down 正面右手在畫面左;up 背面在畫面右;面右時右手是近側(畫前),面左時在遠側(藏身後)。
    let hx: number;
    let hy: number;
    let phi: number;
    let front = true;
    switch (dir) {
      case 'up': // 背面:拳頭在畫面右,拍頭朝右上舉到肩旁
        hx = 18;
        hy = -45;
        phi = -0.85;
        break;
      case 'right': // 面朝右:右手近側,拍頭朝行進方向斜上(預備姿)
        hx = -4;
        hy = -46;
        phi = -0.85;
        break;
      case 'left': // 面朝左:右手遠側,拍在身後、拍頭從左肩後探出朝上
        hx = 3;
        hy = -45;
        phi = -2.3;
        front = false;
        break;
      default: // 正面(down):拳頭在畫面左,拍頭朝左上舉到肩旁
        hx = -15;
        hy = -40;
        phi = -2.3;
    }
    this.view.x = ownerX + hx;
    this.view.y = ownerY + hy;
    this.view.zIndex = front ? ownerY + 1 : ownerY - 1;
    this.arm.rotation = this.rotFromVisual(phi);
  }
}
