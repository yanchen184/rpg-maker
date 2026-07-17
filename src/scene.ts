import { AnimatedSprite, Container, Texture } from 'pixi.js';
import { loadFrames, sheetExists } from './assets';
import type { Aabb, Manifest, SceneData, SceneObject } from './types';

export interface BuiltScene {
  root: Container;
  /** 物件層(按 y 排序遮擋),角色 sprite 也加進這層 */
  objectLayer: Container;
  colliders: Aabb[];
  data: SceneData;
}

function makeAnim(frames: Texture[], fps: number): AnimatedSprite {
  const sp = new AnimatedSprite(frames);
  sp.animationSpeed = fps / 60;
  sp.play();
  return sp;
}

export async function loadScene(name: string): Promise<SceneData> {
  const res = await fetch(`/scenes/${name}.json?t=${Date.now()}`);
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

  // 上牆:沿房間頂部橫向鋪
  const wallDef = manifest.assets[data.wall];
  if (wallDef && (await sheetExists(wallDef))) {
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
  }

  // 房間四周邊界(角色不能走出地板)
  const B = 40;
  colliders.push(
    { x: data.size.w / 2, y: data.size.h + B / 2, w: data.size.w, h: B },
    { x: -B / 2, y: data.size.h / 2, w: B, h: data.size.h + 400 },
    { x: data.size.w + B / 2, y: data.size.h / 2, w: B, h: data.size.h + 400 },
  );

  for (const obj of data.objects) {
    await addObject(obj, manifest, objectLayer, colliders);
  }

  return { root, objectLayer, colliders, data };
}

export async function addObject(
  obj: SceneObject,
  manifest: Manifest,
  objectLayer: Container,
  colliders: Aabb[],
): Promise<AnimatedSprite | null> {
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
  sp.zIndex = def.flat ? -10000 + obj.y : obj.y;
  objectLayer.addChild(sp);

  if (def.collider) {
    const c = def.collider;
    const k = obj.scale ?? 1;
    colliders.push({
      x: obj.x + (c.ox ?? 0) * k * (obj.flip ? -1 : 1),
      y: obj.y - (c.h * k) / 2 + (c.oy ?? 0) * k,
      w: c.w * k,
      h: c.h * k,
    });
  }
  return sp;
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h
  );
}
