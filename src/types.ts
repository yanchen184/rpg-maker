/** 素材 manifest:每個素材一張 sprite sheet(2x2 或 4x4 grid 的連續動畫幀) */
export interface AssetDef {
  /** 相對 publicDir 的路徑,如 raw/desk-computer_sheet.png */
  sheet: string;
  /** [cols, rows] */
  grid: [number, number];
  /** 動畫幀率 */
  fps: number;
  kind: 'floor' | 'wall' | 'object' | 'character-layer';
  /** 錨點(物件預設 [0.5, 1] = 底部中心,貼合俯視遮擋) */
  anchor?: [number, number];
  /** 顯示縮放(原幀 512px) */
  scale?: number;
  /** 碰撞框,以錨點為原點的 AABB(螢幕像素);ox/oy 為中心偏移 */
  collider?: { w: number; h: number; ox?: number; oy?: number };
}

export interface Manifest {
  assets: Record<string, AssetDef>;
}

export interface SceneObject {
  asset: string;
  x: number;
  y: number;
  flip?: boolean;
  scale?: number;
}

export interface SceneData {
  name: string;
  /** 房間內部(地板區)像素尺寸 */
  size: { w: number; h: number };
  /** 上牆顯示高度 */
  wallHeight: number;
  /** 地板單格顯示尺寸 */
  floorTile: number;
  floor: string;
  wall: string;
  objects: SceneObject[];
  spawn: { x: number; y: number };
}

export interface Aabb {
  x: number; // 中心 x
  y: number; // 中心 y
  w: number;
  h: number;
}
