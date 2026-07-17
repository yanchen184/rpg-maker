import { Assets, Rectangle, Texture } from 'pixi.js';
import type { AssetDef, Manifest } from './types';

const frameCache = new Map<string, Texture[]>();

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${import.meta.env.BASE_URL}manifest.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`manifest.json 載入失敗: ${res.status}`);
  return res.json();
}

/** 把一張 sheet 依 grid 切成連續幀(左上→右上→左下→右下的列優先順序) */
export async function loadFrames(name: string, def: AssetDef): Promise<Texture[]> {
  const cached = frameCache.get(name);
  if (cached) return cached;

  const base: Texture = await Assets.load(`${import.meta.env.BASE_URL}${def.sheet}`);
  base.source.scaleMode = 'nearest';
  const [cols, rows] = def.grid;
  const fw = base.width / cols;
  const fh = base.height / rows;
  const frames: Texture[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      frames.push(
        new Texture({ source: base.source, frame: new Rectangle(c * fw, r * fh, fw, fh) }),
      );
    }
  }
  frameCache.set(name, frames);
  return frames;
}

/** 檔案存在性檢查(預覽頁用來略過還沒生好的素材)。
 * 注意:Vite dev server 對不存在的路徑會回 200 + index.html(SPA fallback),
 * 所以不能只看 res.ok,要驗 content-type 真的是圖片。 */
export async function sheetExists(def: AssetDef): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${def.sheet}`, { method: 'HEAD' });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') ?? '';
    return type.startsWith('image/');
  } catch {
    return false;
  }
}
