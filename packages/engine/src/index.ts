/**
 * @rpg-maker/engine — 2D 房間引擎公開 API。
 *
 * 消費端(遊戲)只從這裡 import;packages/engine/src 內部檔案佈局不保證穩定。
 */
export { setAssetBase, loadManifest, loadFrames, sheetExists } from './assets';
export {
  loadScene,
  buildScene,
  addObject,
  objectCollider,
  aabbOverlap,
  makeInteractHalo,
  redrawDoors,
} from './scene';
export type {
  BuiltScene,
  PlacedObject,
  PlacedPickup,
  PlacedClue,
  PlacedDevice,
  PlacedVehicle,
  DoorOpening,
} from './scene';
export { Player } from './player';
export type { Dir } from './player';
export { SceneEditor } from './editor';
export type {
  Aabb,
  AssetDef,
  Manifest,
  SceneData,
  SceneObject,
  SceneExit,
  DoorLock,
  Pickup,
  Vehicle,
  Clue,
  Device,
} from './types';
