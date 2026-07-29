/**
 * 網球 sprite 展示廊:掃 manifest 內所有 char-tennis-* sheet,
 * 每張用引擎 loadFrames 載入 16 格,各自一個 pixi Application 循環播放,
 * 排成 grid。這是「sprite 素材交付」的展示形態——不接對戰,純看每套動作動起來。
 */
import { Application, AnimatedSprite } from 'pixi.js';
import { setAssetBase, loadManifest, loadFrames } from '@rpg-maker/engine';

setAssetBase(import.meta.env.BASE_URL);

const hud = document.getElementById('hud')!;
const grid = document.getElementById('grid')!;

// 每格畫布尺寸與 sprite 放大倍率
const CANVAS = 180;
const SCALE = 0.5; // 320px cell -> 160px,留邊

// 動作中文標籤
const LABELS: Record<string, string> = {
  'char-tennis-swing-bh': '反手揮拍',
  'char-tennis-swing-fh': '正手揮拍',
  'char-tennis-swing-up': '頭頂殺球',
  'char-tennis-serve': '發球',
  'char-tennis-dive': '魚躍救球',
  'char-tennis-ready': '準備姿勢',
  'char-tennis-idle-racket': '待機持拍',
  'char-tennis-run': '跑動',
  'char-tennis-celebrate': '得分慶祝',
  'char-tennis-dejected': '失分沮喪',
  'char-tennis-faces': '表情變化',
  'char-tennis-dive-flagship': '旗艦・勉強救球',
  'char-tennis-smash-flagship': '旗艦・全力殺球',
  'char-tennis-forehand-flagship': '旗艦・正拍',
  'char-tennis-backhand-flagship': '旗艦・反拍',
  'char-tennis-serve-flagship': '旗艦・完整發球',
  'char-tennis-locomotion-flagship': '旗艦・跑動急停',
  'char-tennis-ready-flagship': '旗艦・待機墊步',
  'char-tennis-special-flagship': '旗艦・切球高吊',
  'char-tennis-reactions-flagship': '旗艦・賽果反應',
};

async function makeCell(key: string, def: any): Promise<void> {
  const cell = document.createElement('div');
  cell.className = 'cell';

  const app = new Application();
  await app.init({ width: CANVAS, height: CANVAS, backgroundAlpha: 0 });
  cell.appendChild(app.canvas);

  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.textContent = LABELS[key] ?? key;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = `${key.replace('char-tennis-', '')} · fps ${def.fps}`;
  cell.append(cap, sub);
  grid.appendChild(cell);

  try {
    const frames = await loadFrames(key, def);
    const sprite = new AnimatedSprite(frames);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(SCALE);
    sprite.x = CANVAS / 2;
    sprite.y = CANVAS - 6; // 腳底貼近底邊
    sprite.animationSpeed = (def.fps ?? 12) / 60;
    sprite.play();
    app.stage.addChild(sprite);
  } catch (e) {
    const err = document.createElement('div');
    err.className = 'err';
    err.textContent = `❌ ${e}`;
    cell.appendChild(err);
  }
}

async function main(): Promise<void> {
  const manifest = await loadManifest();
  const keys = Object.keys(manifest.assets)
    .filter((k) => k.startsWith('char-tennis-'))
    .sort();

  hud.textContent = `載入 ${keys.length} 套 sprite…`;
  for (const key of keys) {
    await makeCell(key, manifest.assets[key]);
  }
  hud.textContent = `✅ ${keys.length} 套 sprite 全部循環播放中`;
}

main().catch((e) => {
  hud.textContent = `❌ ${e}`;
  console.error(e);
});
