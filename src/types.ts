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
  /** 平貼地面(地毯類):不吃 y-sort,永遠墊在其他物件與角色底下 */
  flat?: boolean;
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
  /** z-sort 覆寫:放在檯面上的小物需要比檯子後畫,但 y 又比檯子小時用 */
  z?: number;
}

/** 場景出入口:角色踩進 zone 就切到 to 場景、落在 spawn */
export interface SceneExit {
  /** 觸發區(場景座標,中心式 AABB) */
  zone: Aabb;
  to: string;
  spawn: { x: number; y: number };
}

export interface SceneData {
  name: string;
  /** 房間內部(地板區)像素尺寸 */
  size: { w: number; h: number };
  /** 上牆顯示高度(室外場景可為 0,只當頂部留白) */
  wallHeight: number;
  /** 地板單格顯示尺寸 */
  floorTile: number;
  floor: string;
  /** 上牆素材;室外場景不填 */
  wall?: string;
  objects: SceneObject[];
  spawn: { x: number; y: number };
  exits?: SceneExit[];
}

export interface Aabb {
  x: number; // 中心 x
  y: number; // 中心 y
  w: number;
  h: number;
}
