/**
 * 打擊感視覺:擊球衝擊圈、落地塵土。純呈現層,自己管生命週期,
 * 每幀 update 推進、播完自動回收 —— 呼叫端射後不理。
 */
import { Container, Graphics } from 'pixi.js';

interface FxItem {
  g: Graphics;
  t: number;
  life: number;
  tick: (g: Graphics, p: number) => void;
}

export class FxLayer {
  view = new Container();
  private items: FxItem[] = [];

  get count(): number {
    return this.items.length;
  }

  private spawn(x: number, y: number, life: number, tick: FxItem['tick']): void {
    const g = new Graphics();
    g.x = x;
    g.y = y;
    g.zIndex = y + 5;
    this.view.addChild(g);
    this.items.push({ g, t: 0, life, tick });
  }

  /** 擊球衝擊圈:白圈快速擴散淡出 */
  ring(x: number, y: number, color = 0xffffff): void {
    this.spawn(x, y, 0.2, (g, p) => {
      g.clear()
        .circle(0, 0, 10 + p * 26)
        .stroke({ color, width: 3 * (1 - p) + 1, alpha: 0.9 * (1 - p) });
    });
  }

  /**
   * 閃身殘影:從起點朝衝刺方向拉一道拖尾 + 幾片速度線,快速淡出。
   * dx/dy = 衝刺位移向量(px),長度就是這次閃身跑的距離。
   */
  streak(x: number, y: number, dx: number, dy: number, color = 0x9fe8ff): void {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    this.spawn(x, y, 0.28, (g, p) => {
      const fade = 1 - p;
      g.clear();
      // 主拖尾:貼在角色腰高,從起點指向衝刺方向
      g.moveTo(0, -30)
        .lineTo(-ux * len * 0.9, -30 - uy * len * 0.9)
        .stroke({ color, width: 7 * fade + 1, alpha: 0.55 * fade });
      // 速度線:上下各錯開一點,補「唰」的殘影感
      for (let i = -1; i <= 1; i += 2) {
        const ox = -uy * 13 * i;
        const oy = ux * 13 * i;
        g.moveTo(ox, -30 + oy)
          .lineTo(ox - ux * len * 0.6, -30 + oy - uy * len * 0.6)
          .stroke({ color, width: 2.5 * fade, alpha: 0.4 * fade });
      }
    });
  }

  /** 殺球爆裂:雙層亮圈 + 放射狀衝擊線,比一般 ring 大而狠 */
  burst(x: number, y: number, color = 0xff6a3d): void {
    this.spawn(x, y, 0.3, (g, p) => {
      const fade = 1 - p;
      g.clear()
        .circle(0, 0, 12 + p * 52)
        .stroke({ color, width: 5 * fade + 1, alpha: 0.95 * fade })
        .circle(0, 0, 6 + p * 30)
        .stroke({ color: 0xffe9a8, width: 3 * fade + 1, alpha: 0.8 * fade });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r0 = 16 + p * 34;
        const r1 = r0 + 18 * fade;
        g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.55)
          .lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.55)
          .stroke({ color, width: 3 * fade, alpha: 0.8 * fade });
      }
    });
  }

  /** 落地塵土:貼地扁橢圓往外擴散 */
  puff(x: number, y: number): void {
    this.spawn(x, y, 0.32, (g, p) => {
      g.clear();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.6;
        g.ellipse(Math.cos(a) * p * 18, Math.sin(a) * p * 7, 6 * (1 - p) + 1, 3 * (1 - p) + 0.5).fill({
          color: 0xcfc8a8,
          alpha: 0.5 * (1 - p),
        });
      }
    });
  }

  update(dtSec: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dtSec;
      const p = it.t / it.life;
      if (p >= 1) {
        this.view.removeChild(it.g);
        it.g.destroy();
        this.items.splice(i, 1);
      } else {
        it.tick(it.g, p);
      }
    }
  }
}
