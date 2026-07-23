/**
 * 角色程式化動作 + 表情泡泡(網球層,不動引擎)。
 * 動作走 view.pivot.y(正值 = 內容上移;Player/RemotePlayer 的 update 都不會重設 pivot/rotation)
 * 與 view.rotation(傾身)。表情泡泡自己掛 Text 冒出 → 浮起 → 淡出,不鎖角色移動
 * (引擎的 emote() 會把角色定格,rally 進行中不能用)。
 */
import { Container, Text } from 'pixi.js';

export type PoseKind = 'swing' | 'celebrate' | 'droop' | 'shrug' | 'splitstep';

interface PoseState {
  kind: PoseKind;
  t: number;
  dur: number;
  facing: number;
}

const POSE_DUR: Record<PoseKind, number> = { swing: 0.22, celebrate: 0.9, droop: 0.8, shrug: 0.45, splitstep: 0.28 };

export class CharAnim {
  private poseState: PoseState | null = null;
  private bubble: Text | null = null;
  private bubbleHost: Container | null = null;
  private bubbleT = 0;
  private bubbleDur = 0;

  /** getView:回傳這一側當前的角色容器(online 對手可能中途才建立/銷毀,所以用 getter) */
  constructor(private getView: () => Container | null) {}

  /** 播一段姿勢動畫;facing = 傾身方向(左側球員 +1 往右傾) */
  pose(kind: PoseKind, facing = 1): void {
    this.poseState = { kind, t: 0, dur: POSE_DUR[kind], facing };
  }

  /** 頭上表情泡泡(得分 😆、失分 😫、失誤 😅…),與姿勢獨立、可疊加 */
  say(emoji: string, durSec = 1.1): void {
    const view = this.getView();
    if (!view) return;
    if (!this.bubble || this.bubbleHost !== view || this.bubble.destroyed) {
      if (this.bubble && !this.bubble.destroyed) this.bubble.destroy();
      this.bubble = new Text({ style: { fontSize: 44, fill: 0xffffff } });
      this.bubble.anchor.set(0.5, 1);
      this.bubbleHost = view;
      view.addChild(this.bubble);
    }
    this.bubble.text = emoji;
    this.bubble.visible = true;
    this.bubble.alpha = 1;
    this.bubbleT = 0;
    this.bubbleDur = durSec;
  }

  /** 測試/除錯:泡泡是否顯示中 */
  get talking(): boolean {
    return !!this.bubble && !this.bubble.destroyed && this.bubble.visible;
  }

  update(dtSec: number): void {
    const view = this.getView();
    if (!view) return;

    if (this.poseState) {
      const ps = this.poseState;
      ps.t += dtSec;
      const p = Math.min(1, ps.t / ps.dur);
      let lift = 0;
      let rot = 0;
      let lunge = 0;
      if (ps.kind === 'swing') {
        // 揮拍帶身:重心撲向擊球側(傾身 + 前撲位移),腳下蹬地,尾段回正
        const s = Math.sin(p * Math.PI);
        rot = s * 0.3 * ps.facing;
        lift = s * 8;
        lunge = s * 10 * ps.facing;
      } else if (ps.kind === 'splitstep') {
        // 對手出手瞬間的預備小彈跳(split-step):輕跳落地壓低重心
        lift = p < 0.6 ? Math.sin((p / 0.6) * Math.PI) * 10 : -Math.sin(((p - 0.6) / 0.4) * Math.PI) * 3;
      } else if (ps.kind === 'celebrate') {
        // 得分開心跳兩下,幅度漸收
        lift = Math.abs(Math.sin(p * Math.PI * 2)) * 22 * (1 - p * 0.3);
        rot = Math.sin(p * Math.PI * 4) * 0.08;
      } else if (ps.kind === 'droop') {
        // 沮喪:下沉 + 歪頭,尾段回正
        const sag = Math.sin(Math.min(1, p * 1.25) * Math.PI);
        lift = -sag * 8;
        rot = sag * 0.12 * ps.facing;
      } else {
        // shrug:失誤小小下蹲聳一下
        lift = -Math.sin(p * Math.PI) * 6;
      }
      view.pivot.y = lift;
      view.pivot.x = -lunge; // pivot 正值往反向移,取負讓身體撲向 facing 側
      view.rotation = rot;
      if (p >= 1) {
        this.poseState = null;
        view.pivot.y = 0;
        view.pivot.x = 0;
        view.rotation = 0;
      }
    }

    if (this.bubble && !this.bubble.destroyed && this.bubble.visible && this.bubbleHost === view) {
      this.bubbleT += dtSec;
      const p = this.bubbleT / this.bubbleDur;
      if (p >= 1) {
        this.bubble.visible = false;
      } else {
        const pop = Math.min(1, p * 6); // 前 1/6 快速冒出
        this.bubble.scale.set(0.6 + 0.4 * pop);
        const h = (view.children[0] as Container | undefined)?.height ?? 150;
        this.bubble.y = -h - 26 - p * 18; // 緩緩浮起
        this.bubble.alpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25; // 尾段淡出
      }
    }
  }
}
