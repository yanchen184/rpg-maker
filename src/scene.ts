import { AnimatedSprite, Container, Graphics, Text, Texture } from 'pixi.js';
import { loadFrames, sheetExists } from './assets';
import type {
  Aabb,
  AssetDef,
  Clue,
  Device,
  Manifest,
  Pickup,
  SceneData,
  SceneObject,
  Vehicle,
} from './types';

export interface PlacedPickup {
  data: Pickup;
  sprite: Text;
}

export interface PlacedClue {
  data: Clue;
  sprite: Text;
}

export interface PlacedDevice {
  data: Device;
  sprite: Text;
  /** 機關已觸發(踩板/開關 on);繪製狀態、避免重複觸發 */
  active: boolean;
}

export interface PlacedVehicle {
  data: Vehicle;
  sprite: Text;
  /** 車自身座標(上車後由玩家操控更新;下車後角色落回車旁) */
  x: number;
  y: number;
}

export interface BuiltScene {
  root: Container;
  /** 物件層(按 y 排序遮擋),角色 sprite 也加進這層 */
  objectLayer: Container;
  colliders: Aabb[];
  data: SceneData;
  /** 編輯模式用:場景物件與其 sprite / collider 的對應 */
  placed: PlacedObject[];
  /** 地上可撿取物品(撿起時從此移除並拿掉 sprite) */
  pickups: PlacedPickup[];
  /** 可騎乘載具 */
  vehicles: PlacedVehicle[];
  /** 線索物件(靠近按 E 看提示,不入袋) */
  clues: PlacedClue[];
  /** 機關(踩板/開關,觸發設 flag) */
  devices: PlacedDevice[];
  /** 底牆的門 Graphics(依鎖狀態重畫顏色);室外場景為 null */
  doorGraphics: Graphics | null;
}

export interface PlacedObject {
  obj: SceneObject;
  def: AssetDef;
  sprite: AnimatedSprite;
  /** 指向 colliders 陣列內同一個物件,拖曳時原地改 */
  collider: Aabb | null;
}

function makeAnim(frames: Texture[], fps: number): AnimatedSprite {
  const sp = new AnimatedSprite(frames);
  sp.animationSpeed = fps / 60;
  sp.play();
  return sp;
}

export async function loadScene(name: string): Promise<SceneData> {
  const res = await fetch(`${import.meta.env.BASE_URL}scenes/${name}.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`場景 ${name} 載入失敗: ${res.status}`);
  return res.json();
}

export async function buildScene(data: SceneData, manifest: Manifest): Promise<BuiltScene> {
  const root = new Container();
  const floorLayer = new Container();
  const wallLayer = new Container();
  const objectLayer = new Container();
  objectLayer.sortableChildren = true;
  root.addChild(floorLayer, wallLayer, objectLayer);

  const colliders: Aabb[] = [];

  // 地板:animated tile 鋪滿房間(房間原點 = 地板左上角,牆畫在 y<0 區)
  const floorDef = manifest.assets[data.floor];
  if (floorDef && (await sheetExists(floorDef))) {
    const frames = await loadFrames(data.floor, floorDef);
    const t = data.floorTile;
    for (let ty = 0; ty < Math.ceil(data.size.h / t); ty++) {
      for (let tx = 0; tx < Math.ceil(data.size.w / t); tx++) {
        const sp = makeAnim(frames, floorDef.fps);
        sp.width = t;
        sp.height = t;
        sp.x = tx * t;
        sp.y = ty * t;
        floorLayer.addChild(sp);
      }
    }
  }

  // 上牆:沿房間頂部橫向鋪(室外場景沒牆 → 只放頂部邊界)
  const wallDef = data.wall ? manifest.assets[data.wall] : undefined;
  if (data.wall && wallDef && (await sheetExists(wallDef))) {
    const frames = await loadFrames(data.wall, wallDef);
    const h = data.wallHeight;
    const ratio = frames[0].width / frames[0].height;
    const w = h * ratio;
    for (let wx = 0; wx < Math.ceil(data.size.w / w); wx++) {
      const sp = makeAnim(frames, wallDef.fps);
      sp.height = h;
      sp.width = w;
      sp.x = wx * w;
      sp.y = -h;
      wallLayer.addChild(sp);
    }
    // 牆是實心的:整條上牆一個 collider
    colliders.push({ x: data.size.w / 2, y: -h / 2, w: data.size.w, h });
  } else {
    // 沒牆也要擋住頂部,角色不能走出地圖
    colliders.push({ x: data.size.w / 2, y: -20, w: data.size.w, h: 40 });
  }

  // 房間四周邊界(角色不能走出地板)。底邊在有出口(exit)的 x 段留門洞,
  // 讓角色能走到門口 zone 觸發離開,不會被邊界牆擋死。
  const B = 40;
  const bottomExits = (data.exits ?? []).filter((ex) => ex.zone.y >= data.size.h - 80);
  const gaps = bottomExits
    .map((ex) => ({ lo: ex.zone.x - ex.zone.w / 2 - 20, hi: ex.zone.x + ex.zone.w / 2 + 20 }))
    .sort((a, b) => a.lo - b.lo);
  // 依門洞把底邊切成數段實心牆
  let cursor = 0;
  const bottomY = data.size.h + B / 2;
  for (const g of gaps) {
    const lo = Math.max(0, g.lo);
    if (lo > cursor) {
      colliders.push({ x: (cursor + lo) / 2, y: bottomY, w: lo - cursor, h: B });
    }
    cursor = Math.max(cursor, Math.min(data.size.w, g.hi));
  }
  if (cursor < data.size.w) {
    colliders.push({ x: (cursor + data.size.w) / 2, y: bottomY, w: data.size.w - cursor, h: B });
  }
  colliders.push(
    { x: -B / 2, y: data.size.h / 2, w: B, h: data.size.h + 400 },
    { x: data.size.w + B / 2, y: data.size.h / 2, w: B, h: data.size.h + 400 },
  );

  // 底牆視覺 + 門:室內場景(有牆的)才畫。底部本來只有隱形 collider,沒有可見牆/門,
  // 玩家看不出哪裡能離開。這裡用程式畫一道底牆,並在每個底部出口位置畫一扇門(門是缺口,可穿過)。
  // 鎖住的門畫成紅色掛鎖,解開後由 main 呼叫 redrawDoors 重畫成綠色。
  let doorGraphics: Graphics | null = null;
  if (data.wall) {
    doorGraphics = drawBottomWallWithDoors(objectLayer, data, bottomExits);
  }

  const placed: PlacedObject[] = [];
  for (const obj of data.objects) {
    const rec = await addObject(obj, manifest, objectLayer, colliders);
    if (rec) placed.push(rec);
  }

  // 地上可撿取物品:emoji sprite,不擋路(無 collider),吃 y-sort 遮擋
  const pickups: PlacedPickup[] = [];
  for (const p of data.pickups ?? []) {
    const sp = new Text({ text: p.emoji, style: { fontSize: 40, fill: 0xffffff } });
    sp.anchor.set(0.5, 1);
    sp.x = p.x;
    sp.y = p.y;
    sp.zIndex = p.y;
    objectLayer.addChild(sp);
    pickups.push({ data: p, sprite: sp });
  }

  // 可騎乘載具:emoji sprite,吃 y-sort 遮擋;碰撞在 main 動態處理(未上車擋路、上車後不擋自己)
  const vehicles: PlacedVehicle[] = [];
  for (const v of data.vehicles ?? []) {
    const sp = new Text({ text: v.emoji, style: { fontSize: 72, fill: 0xffffff } });
    sp.anchor.set(0.5, 1);
    sp.x = v.x;
    sp.y = v.y;
    sp.zIndex = v.y;
    objectLayer.addChild(sp);
    vehicles.push({ data: v, sprite: sp, x: v.x, y: v.y });
  }

  // 線索物件:emoji sprite(不擋路、不入袋),靠近按 E 顯示 text
  const clues: PlacedClue[] = [];
  for (const c of data.clues ?? []) {
    const sp = new Text({ text: c.emoji, style: { fontSize: 44, fill: 0xffffff } });
    sp.anchor.set(0.5, 1);
    sp.x = c.x;
    sp.y = c.y;
    sp.zIndex = c.y;
    objectLayer.addChild(sp);
    clues.push({ data: c, sprite: sp });
  }

  // 機關:emoji sprite(不擋路),踩板/開關由 main 偵測觸發
  const devices: PlacedDevice[] = [];
  for (const d of data.devices ?? []) {
    const sp = new Text({ text: d.emoji, style: { fontSize: 44, fill: 0xffffff } });
    sp.anchor.set(0.5, 1);
    sp.x = d.x;
    sp.y = d.y;
    sp.zIndex = d.y;
    objectLayer.addChild(sp);
    devices.push({ data: d, sprite: sp, active: false });
  }

  return {
    root,
    objectLayer,
    colliders,
    data,
    placed,
    pickups,
    vehicles,
    clues,
    devices,
    doorGraphics,
  };
}

/**
 * 程式畫底牆 + 門(室內場景用)。底牆是一條沿房間底邊的實心牆,在每個出口 x 段畫一扇門。
 * 門本身是牆上的開口(角色可穿過,碰撞由 buildScene 的門洞邏輯處理),門框/門板純視覺標示「這裡能出去」。
 * 鎖住的門畫紅色掛鎖 🔒,解開後(unlocked 含該 exit.to)畫成綠色門把,表示可通過。
 * 回傳 Graphics 讓 main 在解鎖後 redrawDoors 重畫。
 */
function drawBottomWallWithDoors(
  objectLayer: Container,
  data: SceneData,
  bottomExits: SceneData['exits'],
): Graphics {
  const g = new Graphics();
  g.zIndex = data.size.h - 46; // 牆頂 y,走近時角色能站到門前
  objectLayer.addChild(g);
  redrawDoors(g, data, bottomExits, new Set());
  return g;
}

/**
 * 依鎖狀態(重)畫底牆與門。unlocked = 已解鎖的目標場景名集合;
 * 有 lock 但不在 unlocked 的門畫紅框 + 🔒,其餘畫正常木門。整個 g.clear() 後重畫。
 */
/** 正在播放開門動畫的門:to=目標場景名,progress 0→1(門板滑開、掛鎖掉落) */
export interface DoorOpening {
  to: string;
  progress: number;
}

export function redrawDoors(
  g: Graphics,
  data: SceneData,
  bottomExits: SceneData['exits'],
  unlocked: Set<string>,
  opening?: DoorOpening | null,
): void {
  g.clear();
  const wallH = 46; // 底牆高度(視覺,像素風矮牆)
  const wallTop = data.size.h - wallH; // 牆貼在房間底邊往上
  const doorW = 96; // 門寬
  const doorH = 78; // 門高(比牆高,門頭凸出牆上緣一點,像真的門框)

  const exits = (bottomExits ?? []).slice().sort((a, b) => a.zone.x - b.zone.x);
  const doorXs = exits.map((ex) => ex.zone.x);

  // 底牆:一段一段畫,遇到門的 x 範圍就跳過(留門口)
  const halfDoor = doorW / 2;
  let cursor = 0;
  const segments: [number, number][] = [];
  for (const dx of doorXs) {
    const lo = dx - halfDoor;
    if (lo > cursor) segments.push([cursor, lo]);
    cursor = Math.max(cursor, dx + halfDoor);
  }
  if (cursor < data.size.w) segments.push([cursor, data.size.w]);

  // 牆體(深棕磚牆感:底色 + 頂緣亮線)
  for (const [x0, x1] of segments) {
    g.rect(x0, wallTop, x1 - x0, wallH).fill(0x4a3a26);
    g.rect(x0, wallTop, x1 - x0, 5).fill(0x6b5335); // 牆頂亮邊
    g.rect(x0, data.size.h - 4, x1 - x0, 4).fill(0x2e2418); // 牆底陰影
  }

  // 每扇門:門框 + 門板 + 門把;鎖住加紅框+掛鎖;開門中門板往兩側滑開
  for (const ex of exits) {
    const dx = ex.zone.x;
    const left = dx - halfDoor;
    const top = data.size.h - doorH;
    const isLocked = !!ex.lock && !unlocked.has(ex.to);
    const anim = opening && opening.to === ex.to ? opening.progress : null;

    // 門洞(門框內側暗色,門板滑開後露出的通道)
    g.rect(left, top, doorW, doorH).fill(0x1a120a);
    // 門框
    g.rect(left - 6, top - 6, doorW + 12, doorH + 6).fill(isLocked ? 0x5a1e18 : 0x2e2013);
    g.rect(left, top, doorW, doorH).fill(0x1a120a); // 門洞(蓋回框內)

    if (anim !== null) {
      // 兩階段開門動畫:
      //   phase 1 (0~0.35):鎖彈開、往下掉、門板還閉合 → 讓玩家「看到鎖解開」
      //   phase 2 (0.35~1):雙扇門板往左右滑開,露出金色門洞光 → 明確的「開門」
      const unlockP = Math.min(1, anim / 0.35); // 掛鎖階段進度
      const swingP = Math.max(0, (anim - 0.35) / 0.65); // 門板階段進度(0~1)
      const ease = swingP * swingP * (3 - 2 * swingP); // smoothstep,開門有加減速手感
      const slide = halfDoor * ease; // 每扇最多滑開半扇寬 = 全開

      // 門洞底光:門越開,金色暖光越亮(暗示外面有光透進來)
      if (swingP > 0) {
        const glow = 0.15 + 0.5 * swingP;
        g.rect(left + 6, top + 4, doorW - 12, doorH - 8).fill({ color: 0xffcc66, alpha: glow });
      }

      // 左扇門板(往左滑)
      g.rect(left - slide, top, halfDoor, doorH).fill(0x7a4a24);
      g.rect(left - slide, top, 4, doorH).fill(0x5a3418); // 外緣
      g.rect(left + 10 - slide, top + 8, halfDoor - 16, 3).fill(0x8a5a30);
      // 右扇門板(往右滑)
      g.rect(dx + slide, top, halfDoor, doorH).fill(0x7a4a24);
      g.rect(dx + slide + halfDoor - 4, top, 4, doorH).fill(0x5a3418); // 外緣
      g.rect(dx + 6 + slide, top + 8, halfDoor - 16, 3).fill(0x8a5a30);

      // 掛鎖:先原地小彈(unlockP<1),彈完往下掉 + 淡出
      if (anim < 0.72) {
        const bounce = unlockP < 1 ? Math.sin(unlockP * Math.PI) * -4 : 0; // 解開瞬間往上彈一下
        const fall = unlockP >= 1 ? (anim - 0.35) * 140 : 0; // 掉落
        const cy = top + doorH / 2 + bounce + fall;
        const alpha = anim < 0.55 ? 1 : Math.max(0, 1 - (anim - 0.55) / 0.17);
        g.rect(dx - 11, cy - 2, 22, 18).fill({ color: 0xd83a2a, alpha });
        g.circle(dx, cy - 2, 9).stroke({ width: 4, color: unlockP < 1 ? 0xd83a2a : 0x8ad86e, alpha }); // 解開後鎖環轉綠
      }
    } else {
      // 靜態:整片門板
      g.rect(left, top, doorW, doorH).fill(0x7a4a24);
      g.rect(dx - 2, top, 4, doorH).fill(0x5a3418); // 中縫
      g.rect(left + 10, top + 8, doorW - 20, 3).fill(0x8a5a30); // 上橫飾
      g.rect(left + 10, top + doorH - 20, doorW - 20, 3).fill(0x8a5a30); // 下橫飾
      if (isLocked) {
        // 鎖住:紅色掛鎖(鎖身 + 鎖環)
        const cy = top + doorH / 2;
        g.rect(dx - 11, cy - 2, 22, 18).fill(0xd83a2a);
        g.circle(dx, cy - 2, 9).stroke({ width: 4, color: 0xd83a2a });
        g.rect(dx - 2, cy + 4, 4, 8).fill(0x3a0e08); // 鎖孔
      } else {
        // 可通:綠色門把(雙扇)
        g.circle(dx - 12, top + doorH / 2, 4).fill(0x6ee06e);
        g.circle(dx + 12, top + doorH / 2, 4).fill(0x6ee06e);
      }
    }
  }
}

export async function addObject(
  obj: SceneObject,
  manifest: Manifest,
  objectLayer: Container,
  colliders: Aabb[],
): Promise<PlacedObject | null> {
  const def = manifest.assets[obj.asset];
  if (!def) {
    console.warn(`場景引用了 manifest 沒有的素材: ${obj.asset}`);
    return null;
  }
  if (!(await sheetExists(def))) {
    console.warn(`素材 ${obj.asset} 的 sheet 還沒生成,先略過`);
    return null;
  }
  const frames = await loadFrames(obj.asset, def);
  const sp = makeAnim(frames, def.fps);
  const [ax, ay] = def.anchor ?? [0.5, 1];
  sp.anchor.set(ax, ay);
  const scale = (def.scale ?? 0.25) * (obj.scale ?? 1);
  sp.scale.set(obj.flip ? -scale : scale, scale);
  sp.x = obj.x;
  sp.y = obj.y;
  sp.zIndex = obj.z ?? (def.flat ? -10000 + obj.y : obj.y);
  objectLayer.addChild(sp);

  let colliderBox: Aabb | null = null;
  if (def.collider) {
    colliderBox = objectCollider(obj, def);
    colliders.push(colliderBox);
  }
  return { obj, def, sprite: sp, collider: colliderBox };
}

/** 依物件目前座標算 collider 框(拖曳後重算用) */
export function objectCollider(obj: SceneObject, def: AssetDef): Aabb {
  const c = def.collider!;
  const k = obj.scale ?? 1;
  return {
    x: obj.x + (c.ox ?? 0) * k * (obj.flip ? -1 : 1),
    y: obj.y - (c.h * k) / 2 + (c.oy ?? 0) * k,
    w: c.w * k,
    h: c.h * k,
  };
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h
  );
}
