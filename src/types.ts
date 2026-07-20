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

/** 地上可撿取物品:走近按 F 撿起,計入背包 */
export interface Pickup {
  /** 場景內唯一 id(撿起後從清單移除用) */
  id: string;
  /** 用 emoji 當圖示(免生圖):☕ 📄 🔑 💾 ... */
  emoji: string;
  x: number;
  y: number;
}

/** 載具(車):走近按 G 上車,車帶著人一起移動,再按 G 下車 */
export interface Vehicle {
  id: string;
  /** 用 emoji 當圖示(免生圖):🚗 🚙 🛺 ... */
  emoji: string;
  x: number;
  y: number;
  /** 車速(不填用預設,通常比人快) */
  speed?: number;
}

/** 門鎖:出入口被鎖住,要滿足條件才能通過(解謎核心) */
export interface DoorLock {
  /** 數字密碼(字串,允許前導 0);玩家靠近門開輸入面板,輸對才解鎖 */
  code?: string;
  /** 需要先觸發的機關 flag(device.setFlag);全部為 true 才解鎖 */
  needFlags?: string[];
  /** 需要持有的物品 id(撿到即算,不消耗);全部持有才解鎖 */
  needItems?: string[];
  /** 鎖住時門上顯示的提示(如「輸入 3 位密碼」「需要鑰匙」) */
  hint?: string;
}

/** 場景出入口:角色踩進 zone 就切到 to 場景、落在 spawn。可掛 lock 變成解謎門 */
export interface SceneExit {
  /** 觸發區(場景座標,中心式 AABB) */
  zone: Aabb;
  to: string;
  spawn: { x: number; y: number };
  /** 鎖:有 lock 時門是鎖住的,要解開才能按 E 通過(否則只提示、不切場景) */
  lock?: DoorLock;
}

/** 線索物件:場景擺放,靠近按 E 顯示提示文字(數字/謎面);不入袋、可重複看 */
export interface Clue {
  id: string;
  /** emoji 圖示:📜 📋 🖼️ 🔢 📖 ... */
  emoji: string;
  x: number;
  y: number;
  /** 靠近按 E 顯示的內容(密碼線索、謎面提示) */
  text: string;
}

/** 機關:踩板(站上觸發)或開關(按 E 切換);觸發後把 setFlag 設 true(供門鎖判定) */
export interface Device {
  id: string;
  kind: 'plate' | 'switch';
  /** emoji 圖示:🔘(開關) 🟦(踩板) ⬜ 🎚️ ... */
  emoji: string;
  x: number;
  y: number;
  /** 觸發後設定的 flag 名(門鎖 needFlags 用同名判定) */
  setFlag: string;
  /** 觸發時顯示的提示(如「喀噠——某處的門開了」) */
  hint?: string;
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
  /**
   * 地板/牆色調(0xRRGGBB,PixiJS tint;省略=不染色=原色 0xffffff)。
   * 每關套不同色調讓房間有各自氛圍——用現有素材做出「不同場所」的感覺,不必生新地板圖。
   * 例:控制室偏冷藍、機房偏工業青、檔案室偏暖褐。
   */
  floorTint?: number;
  objects: SceneObject[];
  spawn: { x: number; y: number };
  exits?: SceneExit[];
  /** 地上可撿取物品 */
  pickups?: Pickup[];
  /** 可騎乘載具 */
  vehicles?: Vehicle[];
  /** 解謎:線索物件(靠近按 E 看提示) */
  clues?: Clue[];
  /** 解謎:機關(踩板/開關) */
  devices?: Device[];
}

export interface Aabb {
  x: number; // 中心 x
  y: number; // 中心 y
  w: number;
  h: number;
}
