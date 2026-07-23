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
