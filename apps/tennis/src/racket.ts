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
  private armG: Graphics; // 手臂+拳頭,疊在球拍之上:握拍讀的是「手蓋住柄根」,畫在拍下面會被拍柄整條蓋掉

  constructor(facing: 1 | -1) {
    this.facing = facing;
    this.trail = new Graphics();
    this.view.addChild(this.trail);
    this.armG = new Graphics();
    this.arm = new Container();
    const g = new Graphics();
    // 柄(root 往內縮 4px 藏進拳頭,握起來不是「貼著手」)+ 橢圓拍面 + 網紋。
    // 柄用拍框同色的亮色+5px:深棕細柄在草地上讀不出來,「拳→柄→框」會斷鏈
    g.moveTo(-4, 0).lineTo(22, 0).stroke({ color: 0xe8e2d0, width: 5 });
    g.moveTo(-4, 0).lineTo(22, 0).stroke({ color: 0x333333, width: 1, alpha: 0.35 });
    g.ellipse(33, 0, 12, 9).fill({ color: 0xe8e2d0, alpha: 0.9 });
    g.ellipse(33, 0, 12, 9).stroke({ color: 0x333333, width: 2 });
    g.moveTo(25, -4).lineTo(41, -4).stroke({ color: 0x999999, width: 1, alpha: 0.8 });
    g.moveTo(24, 0).lineTo(42, 0).stroke({ color: 0x999999, width: 1, alpha: 0.8 });
    g.moveTo(25, 4).lineTo(41, 4).stroke({ color: 0x999999, width: 1, alpha: 0.8 });
    this.arm.addChild(g);
    this.view.addChild(this.arm);
    this.view.addChild(this.armG);
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
      this.swingT += dtSec;
      const p = this.swingT / (SWING_MS / 1000);
      // 跟上 char-anim 的揮拍帶身(傾身前撲 lunge 10 / 蹬地 lift 8,同 220ms 同步起跑),
      // 不然身體撲出去、手臂還留在原地,肩膀就脫臼了。
      const lean = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
      this.view.x = ownerX + this.facing * 6 + lean * 10 * this.facing;
      this.view.y = ownerY - 42 - lean * 8;
      if (p < 1) {
        const e = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) * (-2 * p + 2)) / 2;
        // 引拍段拍藏身後,掄出來才到身前,加一層「從身後帶出」的縱深
        this.view.zIndex = e < 0.22 ? ownerY - 1 : ownerY + 1;
        const phi = 2.9 - e * 4.32;
        this.arm.rotation = this.facing * phi;
        const vis = (ee: number): number =>
          this.facing === 1 ? 2.9 - ee * 4.32 : Math.PI - 2.9 + ee * 4.32;
        // 拳頭掄大圈,且手臂隨揮拍逐漸伸展(20 → 37px):收拍時拳頭要「明確越過肩線」,
        // 光拍框高沒用——抬手讀的是拳頭與手肘的剪影,不是拍頭。
        const armLen = (ee: number): number => 20 + 17 * ee * ee;
        // 旋轉圓心 = 持拍側肩點(不是身體中線):終角近垂直時,繞中線轉會把拍框甩進臉裡
        const sx = this.facing * 8;
        const sy = -8;
        const v = vis(e);
        const fx = sx + Math.cos(v) * armLen(e);
        const fy = sy + Math.sin(v) * armLen(e);
        this.arm.position.set(fx, fy);
        this.trail.clear();
        // 殘影:拍頭端亮而實、尾端淡而細的彗星尾(畫全弧會像套在身上的呼拉圈)。
        // 起訖角相同的退化弧 Pixi 會畫成整圈,起手那幾幀要跳過。
        // 拍頭實際軌跡半徑 = 手臂長 + 拍長,手臂會伸展所以逐段取中點半徑近似
        const headR = (ee: number): number => armLen(ee) + 33;
        const tailLo = Math.max(0, e - 0.45);
        const tailHi = Math.max(0, e - 0.1);
        if (tailHi - tailLo > 0.01) {
          this.trail
            .arc(sx, sy, headR((tailLo + tailHi) / 2), vis(tailLo), vis(tailHi), this.facing === 1)
            .stroke({ color: 0xffffff, width: 4, alpha: 0.22 });
        }
        // 亮尾收在拍頭後方一小段(不貼到拍):貼死拍頭時,粗白亮尾會被讀成「白色拍柄」,
        // 而它天生不連拳頭,握拍就被誤判成脫手
        const briLo = Math.max(0, e - 0.14);
        const briHi = Math.max(0, e - 0.045);
        if (briHi - briLo > 0.01) {
          this.trail
            .arc(sx, sy, headR((briLo + briHi) / 2), vis(briLo), vis(briHi), this.facing === 1)
            .stroke({ color: 0xffffff, width: 6.5, alpha: 0.85 });
        }
        // 抬手的主角:肩 → 肘 → 拳 兩段式手臂。肘點往弦的垂直方向壓出去,
        // 手臂才有折角(直棍手臂讀不出「抬」的關節感)。
        const dx = fx - sx;
        const dy = fy - sy;
        const dl = Math.hypot(dx, dy) || 1;
        let nx = -dy / dl;
        let ny = dx / dl;
        if (ny < 0) {
          nx = -nx;
          ny = -ny; // 肘永遠往下彎(重力側),不會反關節
        }
        const ex = (sx + fx) / 2 + nx * 5;
        const ey = (sy + fy) / 2 + ny * 5;
        this.armG.clear();
        // 深色描邊先鋪一層:膚色手臂跟沙色頭髮同色系,高位收拍掃過頭部時沒描邊會整條隱形
        this.armG
          .moveTo(sx, sy)
          .lineTo(ex, ey)
          .lineTo(fx, fy)
          .stroke({ color: 0x7a4a2a, width: 8.5, cap: 'round', join: 'round' });
        this.armG
          .moveTo(sx, sy)
          .lineTo(ex, ey)
          .lineTo(fx, fy)
          .stroke({ color: 0xf2c398, width: 5.5, cap: 'round', join: 'round' });
        // 拳頭壓在柄根上、帶描邊:握拍的證據就是「手在柄的末端且蓋住它」
        this.armG.circle(fx, fy, 5.5).fill(0xf2c398).stroke({ color: 0x7a4a2a, width: 2 });
        // 擊球瞬間(弧的最低點通過身前):拍頭閃一圈亮邊,標示接觸時刻
        if (e > 0.42 && e < 0.62) {
          const hv = vis(e);
          this.trail
            .circle(sx + Math.cos(hv) * headR(e), sy + Math.sin(hv) * headR(e), 13)
            .stroke({ color: 0xffffcc, width: 3, alpha: 0.85 });
        }
        return;
      }
      this.swingT = -1; // 收拍,落回下面的持拍姿勢
      this.trail.clear();
      this.armG.clear();
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
