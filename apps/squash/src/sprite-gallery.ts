import { loadFrames, loadManifest, setAssetBase } from '@rpg-maker/engine';
import { AnimatedSprite, Application, type Texture } from 'pixi.js';

setAssetBase(import.meta.env.BASE_URL);

const ACTIONS = [
  { title: '面牆準備', detail: '呼吸、墊步與向前凝視。', source: 'loops', from: 0, count: 6, fps: 10 },
  { title: '偶發左側注視', detail: '只有頭眼短暫看左側，身體仍面向前牆。', source: 'loops', from: 6, count: 6, fps: 12 },
  { title: '跑位與回 T', detail: '前進、交叉步、橫移與恢復準備。', source: 'loops', from: 12, count: 12, fps: 24 },
  { title: '正手平抽', detail: '第 7 幀接觸，肩髖完整傳力。', source: 'actions', from: 0, count: 12, fps: 36 },
  { title: '獨立反手穿越', detail: '全新右手反拍；第 7 幀在身體左側接觸，沒有鏡像正手。', source: 'backhand', from: 0, count: 12, fps: 36 },
  { title: '後玻璃解圍', detail: '轉身看球、朝觀眾側玻璃送拍，第 7 幀接觸後再轉回面牆。', source: 'glass', from: 0, count: 12, fps: 36 },
  { title: '勉強低角救球', detail: '晚到、失衡、伸拍與艱難恢復。', source: 'actions', from: 24, count: 12, fps: 30 },
  { title: '得分慶祝', detail: '表情、拳頭、跳躍與落地收束。', source: 'reactions', from: 0, count: 12, fps: 24 },
  { title: '失分重整', detail: '視線下沉、肩背垮落，再重新站穩。', source: 'reactions', from: 12, count: 12, fps: 18 },
] as const;

type SheetSet = Record<'actions' | 'backhand' | 'glass' | 'loops' | 'reactions', Texture[]>;

const grid = document.querySelector<HTMLElement>('#grid')!;
const status = document.querySelector<HTMLElement>('#status')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
const gallerySprites: AnimatedSprite[] = [];
let paused = false;

function setPaused(nextPaused: boolean): void {
  paused = nextPaused;
  pauseButton.textContent = paused ? '播放' : '暫停';
  for (const sprite of gallerySprites) {
    if (paused) sprite.stop();
    else sprite.play();
  }
}

function stepFrames(delta: number): void {
  setPaused(true);
  for (const sprite of gallerySprites) {
    sprite.gotoAndStop((sprite.currentFrame + delta + sprite.totalFrames) % sprite.totalFrames);
  }
}

pauseButton.addEventListener('click', () => setPaused(!paused));
document.querySelector<HTMLButtonElement>('#prev')!.addEventListener('click', () => stepFrames(-1));
document.querySelector<HTMLButtonElement>('#next')!.addEventListener('click', () => stepFrames(1));

async function addCharacter(name: string, accent: string, sheets: SheetSet): Promise<void> {
  const heading = document.createElement('h2');
  heading.className = 'character-heading';
  heading.style.color = accent;
  heading.textContent = name;
  grid.appendChild(heading);

  for (const action of ACTIONS) {
    const card = document.createElement('section');
    card.className = 'card';
    card.innerHTML = `
      <div class="stage"></div>
      <div class="copy">
        <div class="title">${action.title}</div>
        <div class="detail">${action.detail}</div>
      </div>
    `;
    grid.appendChild(card);

    const app = new Application();
    await app.init({
      width: 300,
      height: 310,
      backgroundAlpha: 0,
      antialias: false,
      preference: ['canvas'],
    });
    card.querySelector('.stage')!.appendChild(app.canvas);

    const sprite = new AnimatedSprite(
      sheets[action.source].slice(action.from, action.from + action.count),
    );
    sprite.anchor.set(0.5, 1);
    sprite.position.set(150, 300);
    sprite.scale.set(1.15);
    sprite.animationSpeed = action.fps / 60;
    sprite.loop = true;
    sprite.play();
    app.stage.addChild(sprite);
    gallerySprites.push(sprite);
  }
}

void (async () => {
  const manifest = await loadManifest();
  const loadSet = async (color: 'blue' | 'gold'): Promise<SheetSet> => {
    const [actions, backhand, glass, loops, reactions] = await Promise.all([
      loadFrames(`char-squash-${color}-actions`, manifest.assets[`char-squash-${color}-actions`]),
      loadFrames(`char-squash-${color}-backhand`, manifest.assets[`char-squash-${color}-backhand`]),
      loadFrames(`char-squash-${color}-glass`, manifest.assets[`char-squash-${color}-glass`]),
      loadFrames(`char-squash-${color}-loops`, manifest.assets[`char-squash-${color}-loops`]),
      loadFrames(`char-squash-${color}-reactions`, manifest.assets[`char-squash-${color}-reactions`]),
    ]);
    return { actions, backhand, glass, loops, reactions };
  };

  const [blueSheets, goldSheets] = await Promise.all([loadSet('blue'), loadSet('gold')]);
  await addCharacter('BLUE ATHLETE · 藍衣選手', '#65e8ff', blueSheets);
  await addCharacter('GOLD ATHLETE · 黃衣選手', '#ffc857', goldSheets);
  status.textContent = '216 / 216 幀素材載入完成 · 兩名角色、十八套動作可暫停逐幀檢查';
})();
