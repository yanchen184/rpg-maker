/**
 * 球場標線與網(俯視,橫式:左右半場對打):純 Graphics 疊在草地上,
 * 不參與碰撞(圍欄由 main 的半場牆負責)。
 */
import { Container, Graphics } from 'pixi.js';

/** 球場界線(場景座標);netX 是網的位置,也是左右半場分界 */
export const COURT = { left: 150, right: 1350, top: 150, bottom: 850, netX: 750 };

export function buildCourt(): Container {
  const c = new Container();
  const { left, right, top, bottom, netX } = COURT;
  const h = bottom - top;
  const line = 0xf4f8ec;

  const g = new Graphics();
  // 場地底色(比草地深一階的場感)
  g.rect(left - 40, top - 40, right - left + 80, h + 80).fill({ color: 0x1f3a17, alpha: 0.55 });
  g.rect(left, top, right - left, h).fill({ color: 0x2c5220, alpha: 0.9 });
  // 外框線
  g.rect(left, top, right - left, h).stroke({ color: line, width: 6 });
  // 發球線(網左右各 300)與中央發球線
  g.moveTo(netX - 300, top).lineTo(netX - 300, bottom).stroke({ color: line, width: 4 });
  g.moveTo(netX + 300, top).lineTo(netX + 300, bottom).stroke({ color: line, width: 4 });
  g.moveTo(netX - 300, (top + bottom) / 2)
    .lineTo(netX + 300, (top + bottom) / 2)
    .stroke({ color: line, width: 4 });
  // 底線中點記號
  g.moveTo(left, (top + bottom) / 2).lineTo(left + 16, (top + bottom) / 2).stroke({ color: line, width: 4 });
  g.moveTo(right - 16, (top + bottom) / 2)
    .lineTo(right, (top + bottom) / 2)
    .stroke({ color: line, width: 4 });
  c.addChild(g);

  // 網:縱貫全場的深色帶 + 白色上緣 + 兩端網柱
  const net = new Graphics();
  net.rect(netX - 7, top - 30, 14, h + 60).fill({ color: 0x101a0c, alpha: 0.85 });
  net.moveTo(netX - 7, top - 30).lineTo(netX - 7, bottom + 30).stroke({ color: 0xe8f0dc, width: 3 });
  net.circle(netX, top - 30, 6).fill(0x0c140a);
  net.circle(netX, bottom + 30, 6).fill(0x0c140a);
  c.addChild(net);
  return c;
}
