/**
 * 球場標線與網(俯視):純 Graphics 疊在草地上,不參與碰撞(圍欄由 main 的半場牆負責)。
 */
import { Container, Graphics } from 'pixi.js';

/** 球場界線(場景座標);netY 是網的位置,也是上下半場分界 */
export const COURT = { left: 150, right: 850, top: 150, bottom: 1350, netY: 750 };

export function buildCourt(): Container {
  const c = new Container();
  const { left, right, top, bottom, netY } = COURT;
  const w = right - left;
  const line = 0xf4f8ec;

  const g = new Graphics();
  // 場地底色(比草地深一階的紅土綠場感)
  g.rect(left - 40, top - 40, w + 80, bottom - top + 80).fill({ color: 0x1f3a17, alpha: 0.55 });
  g.rect(left, top, w, bottom - top).fill({ color: 0x2c5220, alpha: 0.9 });
  // 外框線
  g.rect(left, top, w, bottom - top).stroke({ color: line, width: 6 });
  // 發球線(網前後各 300)與中央發球線
  g.moveTo(left, netY - 300).lineTo(right, netY - 300).stroke({ color: line, width: 4 });
  g.moveTo(left, netY + 300).lineTo(right, netY + 300).stroke({ color: line, width: 4 });
  g.moveTo((left + right) / 2, netY - 300)
    .lineTo((left + right) / 2, netY + 300)
    .stroke({ color: line, width: 4 });
  // 底線中點記號
  g.moveTo((left + right) / 2, top).lineTo((left + right) / 2, top + 16).stroke({ color: line, width: 4 });
  g.moveTo((left + right) / 2, bottom - 16)
    .lineTo((left + right) / 2, bottom)
    .stroke({ color: line, width: 4 });
  c.addChild(g);

  // 網:橫跨全場的深色帶 + 白色上緣 + 兩端網柱
  const net = new Graphics();
  net.rect(left - 30, netY - 7, w + 60, 14).fill({ color: 0x101a0c, alpha: 0.85 });
  net.moveTo(left - 30, netY - 7).lineTo(right + 30, netY - 7).stroke({ color: 0xe8f0dc, width: 3 });
  net.circle(left - 30, netY, 6).fill(0x0c140a);
  net.circle(right + 30, netY, 6).fill(0x0c140a);
  c.addChild(net);
  return c;
}
