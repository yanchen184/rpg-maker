import { loadFrames, loadManifest, setAssetBase } from '@rpg-maker/engine';
import { AnimatedSprite, Application } from 'pixi.js';

setAssetBase(import.meta.env.BASE_URL);

const ACTIONS = [
  {
    title: '面牆待機與左側注視',
    detail: '身體保持背對鏡頭，只有頭部短暫看左側，再回到前牆。',
    source: 'loops',
    from: 0,
  },
  {
    title: '面牆移動與回位',
    detail: '前進、橫移和後退都維持壁球的面牆基準，不再左右翻面。',
    source: 'loops',
    from: 12,
  },
  {
    title: '後視角正手平抽',
    detail: '背對玻璃、肩膀內收，接觸時才轉肩露出少量側臉。',
    source: 'actions',
    from: 0,
  },
  {
    title: '後視角反手穿越',
    detail: '相反方向的肩髖旋轉，擊球後回到面牆準備姿勢。',
    source: 'actions',
    from: 12,
  },
  {
    title: '面牆低角救球',
    detail: '朝前角衝刺、深跨步失衡伸拍，背部方向仍符合玻璃後視角。',
    source: 'actions',
    from: 24,
  },
] as const;

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
    const nextFrame = (sprite.currentFrame + delta + sprite.totalFrames) % sprite.totalFrames;
    sprite.gotoAndStop(nextFrame);
  }
}

pauseButton.addEventListener('click', () => setPaused(!paused));
document.querySelector<HTMLButtonElement>('#prev')!.addEventListener('click', () => stepFrames(-1));
document.querySelector<HTMLButtonElement>('#next')!.addEventListener('click', () => stepFrames(1));

void (async () => {
  const manifest = await loadManifest();
  const [actionFrames, loopFrames] = await Promise.all([
    loadFrames(
      'char-squash-actions-rear-flagship',
      manifest.assets['char-squash-actions-rear-flagship'],
    ),
    loadFrames(
      'char-squash-rear-loops-flagship',
      manifest.assets['char-squash-rear-loops-flagship'],
    ),
  ]);

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
    await app.init({ width: 300, height: 310, backgroundAlpha: 0, antialias: false });
    card.querySelector('.stage')!.appendChild(app.canvas);

    const frames = action.source === 'actions' ? actionFrames : loopFrames;
    const sprite = new AnimatedSprite(frames.slice(action.from, action.from + 12));
    sprite.anchor.set(0.5, 1);
    sprite.position.set(150, 300);
    sprite.scale.set(1.15);
    sprite.animationSpeed = 36 / 60;
    sprite.loop = true;
    sprite.play();
    app.stage.addChild(sprite);
    gallerySprites.push(sprite);
  }

  status.textContent = '60 / 60 幀載入完成 · 五套後視角動作循環播放中';
})();
