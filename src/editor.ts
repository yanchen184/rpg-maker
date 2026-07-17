import { Application, FederatedPointerEvent } from 'pixi.js';
import { objectCollider } from './scene';
import type { BuiltScene, PlacedObject } from './scene';

/**
 * 場景編輯模式:點選家具高亮、拖曳改位置(即時 y-sort 與碰撞框跟動),
 * 改動直接寫回 built.data.objects,匯出即為新版場景 JSON。
 */
export class SceneEditor {
  enabled = false;
  private selected: PlacedObject | null = null;
  private dragging = false;
  private offX = 0;
  private offY = 0;

  constructor(app: Application, private built: BuiltScene) {
    for (const rec of built.placed) this.bindSprite(rec);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointermove', (e) => this.onMove(e));
    app.stage.on('pointerup', () => (this.dragging = false));
    app.stage.on('pointerupoutside', () => (this.dragging = false));
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    for (const rec of this.built.placed) rec.sprite.cursor = on ? 'grab' : 'default';
    if (!on) this.select(null);
  }

  private bindSprite(rec: PlacedObject) {
    rec.sprite.eventMode = 'static';
    rec.sprite.on('pointerdown', (e: FederatedPointerEvent) => {
      if (!this.enabled) return;
      this.select(rec);
      const local = this.built.objectLayer.toLocal(e.global);
      this.offX = rec.obj.x - local.x;
      this.offY = rec.obj.y - local.y;
      this.dragging = true;
    });
  }

  private select(rec: PlacedObject | null) {
    if (this.selected) this.selected.sprite.tint = 0xffffff;
    this.selected = rec;
    if (rec) rec.sprite.tint = 0x9adf9a;
  }

  private onMove(e: FederatedPointerEvent) {
    if (!this.enabled || !this.dragging || !this.selected) return;
    const rec = this.selected;
    const local = this.built.objectLayer.toLocal(e.global);
    rec.obj.x = Math.round(local.x + this.offX);
    rec.obj.y = Math.round(local.y + this.offY);
    rec.sprite.x = rec.obj.x;
    rec.sprite.y = rec.obj.y;
    rec.sprite.zIndex = rec.obj.z ?? (rec.def.flat ? -10000 + rec.obj.y : rec.obj.y);
    if (rec.collider) {
      const c = objectCollider(rec.obj, rec.def);
      rec.collider.x = c.x;
      rec.collider.y = c.y;
    }
  }

  /** 目前場景(含拖曳後座標)的 JSON 字串 */
  exportJson(): string {
    return JSON.stringify(this.built.data, null, 2) + '\n';
  }

  get selectedName(): string | null {
    return this.selected?.obj.asset ?? null;
  }
}
