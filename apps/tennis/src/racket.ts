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
      // 揮拍中:正手抽球「低到高」U 形弧——身側引拍(166°)沉到身前低點,向前上加速,收在對側肩上方(-57°)。
      // easeInOut:引拍慢 → 擊球區快 → 收拍減速(easeOut 會把節奏顛倒成引拍最快)。
      this.view.x = ownerX + this.facing * 6;
      this.view.y = ownerY - 42;
      this.swingT += dtSec;
      const p = this.swingT / (SWING_MS / 1000);
      if (p < 1) {
        const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) * (-2 * p + 2)) / 2;
        // 引拍段拍藏身後,掄出來才到身前,加一層「從身後帶出」的縱深
        this.view.zIndex = e < 0.22 ? ownerY - 1 : ownerY + 1;
        const phi = 2.9 - e * 3.9;
        this.arm.rotation = this.facing * phi;
        const vis = (ee: number): number =>
          this.facing === 1 ? 2.9 - ee * 3.9 : Math.PI - 2.9 + ee * 3.9;
        const v = vis(e);
        // 拍柄鎖在「伸出去的拳頭」上(離身 12px),不是釘在胸口——
        // 否則整支拍看起來繞角色公轉,握拍關係讀不出來。
        const fx = Math.cos(v) * 12;
        const fy = Math.sin(v) * 12;
        this.arm.position.set(fx, fy);
        this.trail.clear();
        // 殘影:拍頭端亮而實、尾端淡而細的彗星尾(畫全弧會像套在身上的呼拉圈)。
        // 起訖角相同的退化弧 Pixi 會畫成整圈,起手那幾幀要跳過。
        const tailLo = Math.max(0, e - 0.45);
        const tailHi = Math.max(0, e - 0.1);
        if (tailHi - tailLo > 0.01) {
          this.trail
            .arc(0, 0, 45, vis(tailLo), vis(tailHi), this.facing === 1)
            .stroke({ color: 0xffffff, width: 4, alpha: 0.22 });
        }
        if (e - Math.max(0, e - 0.12) > 0.01) {
          this.trail
            .arc(0, 0, 45, vis(Math.max(0, e - 0.12)), vis(e), this.facing === 1)
            .stroke({ color: 0xffffff, width: 9, alpha: 0.9 });
        }
        // 手臂 + 拳頭:從胸口伸向拍柄根,讓「拍握在手上」單格可讀
        this.trail.moveTo(0, -2).lineTo(fx, fy).stroke({ color: 0xf2c398, width: 5 });
        this.trail.circle(fx, fy, 4).fill(0xf2c398);
        // 擊球瞬間(弧的最低點通過身前):拍頭閃一圈亮邊,標示接觸時刻
        if (e > 0.42 && e < 0.62) {
          const hv = vis(e);
          this.trail
            .circle(Math.cos(hv) * 45, Math.sin(hv) * 45, 13)
            .stroke({ color: 0xffffcc, width: 3, alpha: 0.85 });
        }
        return;
      }
      this.swingT = -1; // 收拍,落回下面的持拍姿勢
      this.trail.clear();
      this.arm.position.set(0, 0); // idle 錨點本身就是拳頭位置,拍柄歸位
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
