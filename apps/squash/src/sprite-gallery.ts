import { loadFrames, loadManifest, setAssetBase } from '@rpg-maker/engine';
import { AnimatedSprite, Application } from 'pixi.js';

setAssetBase(import.meta.env.BASE_URL);

const ACTIONS = [
  {
    title: '貼牆正手平抽',
    detail: '肩膀內收、視線壓低盯住接觸點，揮拍路徑短而有力。',
    from: 0,
  },
  {
    title: '反手穿越球',
    detail: '身體先轉、眼睛持續追球，擊球後自然完成重心交換。',
    from: 12,
  },
  {
    title: '勉強低牆救球',
    detail: '跨步、失衡、咬牙與伸手全部由人物演出，明確對應低品質回球。',
    from: 24,
  },
] as const;

const grid = document.querySelector<HTMLElement>('#grid')!;
const status = document.querySelector<HTMLElement>('#status')!;

void (async () => {
  const manifest = await loadManifest();
  const definition = manifest.assets['char-squash-actions-flagship'];
  const frames = await loadFrames('char-squash-actions-flagship', definition);

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

    const sprite = new AnimatedSprite(frames.slice(action.from, action.from + 12));
    sprite.anchor.set(0.5, 1);
    sprite.position.set(150, 300);
    sprite.scale.set(1.15);
    sprite.animationSpeed = 36 / 60;
    sprite.loop = true;
    sprite.play();
    app.stage.addChild(sprite);
  }

  status.textContent = '36 / 36 幀載入完成 · 三套動作循環播放中';
})();
