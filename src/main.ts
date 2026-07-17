import { Application, Container, Text } from 'pixi.js';
import { loadManifest, loadFrames, sheetExists } from './assets';
import { buildScene, loadScene } from './scene';
import { Player } from './player';
import { AnimatedSprite } from 'pixi.js';

async function boot() {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#1a1410',
    antialias: false,
    roundPixels: true,
  });
  document.getElementById('app')!.appendChild(app.canvas);

  const manifest = await loadManifest();
  if (location.hash === '#preview') {
    await previewMode(app, manifest);
  } else {
    await sceneMode(app, manifest);
  }
}

/** 素材預覽:所有已生好的素材排格子、播動畫 */
async function previewMode(app: Application, manifest: Awaited<ReturnType<typeof loadManifest>>) {
  const grid = new Container();
  app.stage.addChild(grid);
  const cell = 200;
  const cols = Math.max(1, Math.floor(app.screen.width / cell));
  let i = 0;
  for (const [name, def] of Object.entries(manifest.assets)) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = col * cell + cell / 2;
    const cy = row * cell + cell / 2;
    const label = new Text({
      text: name,
      style: { fill: 0xd8c8a8, fontSize: 13, fontFamily: 'monospace' },
    });
    label.anchor.set(0.5, 0);
    label.x = cx;
    label.y = cy + cell / 2 - 24;
    grid.addChild(label);
    if (await sheetExists(def)) {
      const frames = await loadFrames(name, def);
      const sp = new AnimatedSprite(frames);
      sp.animationSpeed = def.fps / 60;
      sp.play();
      sp.anchor.set(0.5);
      const fit = (cell - 48) / Math.max(sp.width, sp.height);
      sp.scale.set(fit);
      sp.x = cx;
      sp.y = cy - 10;
      grid.addChild(sp);
    } else {
      label.text = `${name}\n(生成中…)`;
    }
    i++;
  }
}

/** 場景模式:office 房間 + 可操作角色 */
async function sceneMode(app: Application, manifest: Awaited<ReturnType<typeof loadManifest>>) {
  const data = await loadScene('office');
  const built = await buildScene(data, manifest);
  app.stage.addChild(built.root);

  // 角色(紙娃娃層,素材未生成時場景仍可看)
  let player: Player | null = null;
  const layerNames = Object.keys(manifest.assets).some((k) => k === 'char-body-walk')
    ? ['char-body']
    : [];
  if (layerNames.length > 0) {
    player = await Player.create(manifest, layerNames, 0.55);
    player.x = data.spawn.x;
    player.y = data.spawn.y;
    built.objectLayer.addChild(player.view);
  }

  // 鏡頭:整個房間置中、縮放至可視範圍
  const fit = () => {
    const totalH = data.size.h + data.wallHeight;
    const s = Math.min(app.screen.width / data.size.w, app.screen.height / totalH) * 0.92;
    built.root.scale.set(s);
    built.root.x = (app.screen.width - data.size.w * s) / 2;
    built.root.y = (app.screen.height - totalH * s) / 2 + data.wallHeight * s;
  };
  fit();
  window.addEventListener('resize', fit);

  app.ticker.add((t) => {
    player?.update(t.deltaMS / 1000, built.colliders);
  });
}

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#e88">${e?.stack ?? e}</pre>`;
});
