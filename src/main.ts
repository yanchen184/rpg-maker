import { Application, Container, Text } from 'pixi.js';
import { loadManifest, loadFrames, sheetExists } from './assets';
import { aabbOverlap, buildScene, loadScene } from './scene';
import { Player } from './player';
import { SceneEditor } from './editor';
import { buildUi, type SlotGroup } from './ui';
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
  // 依素材數自動縮格子,全部塞進一屏(canvas 不捲動)
  const count = Object.keys(manifest.assets).length;
  const cols = Math.max(1, Math.ceil(Math.sqrt((count * app.screen.width) / app.screen.height)));
  const rows = Math.ceil(count / cols);
  const cell = Math.min(
    Math.floor(app.screen.width / cols),
    Math.floor(app.screen.height / rows),
  );
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

/** 場景模式:office 房間 + 可操作角色,踩到出入口切場景 */
async function sceneMode(app: Application, manifest: Awaited<ReturnType<typeof loadManifest>>) {
  let built = await buildScene(await loadScene('office'), manifest);
  app.stage.addChild(built.root);

  // 角色(紙娃娃層,素材未生成時場景仍可看)
  let player: Player | null = null;
  const walkDef = manifest.assets['char-body-walk'];
  const idleDef = manifest.assets['char-body-idle'];
  const charReady =
    !!walkDef && !!idleDef && (await sheetExists(walkDef)) && (await sheetExists(idleDef));
  // 換裝插槽群組:sheet(walk+idle)已落地的變體才進選單
  const slotDefs: { slot: string; title: string; none: string; variants: [string, string][] }[] = [
    {
      slot: 'hair',
      title: '髮色',
      none: '原色',
      variants: [
        ['金', 'char-hair-blonde'],
        ['粉', 'char-hair-pink'],
        ['銀', 'char-hair-silver'],
      ],
    },
    {
      slot: 'shirt',
      title: '上衣',
      none: '原色',
      variants: [
        ['紅', 'char-shirt-red'],
        ['藍', 'char-shirt-blue'],
        ['綠', 'char-shirt-green'],
      ],
    },
    {
      slot: 'pants',
      title: '褲子',
      none: '原色',
      variants: [
        ['棕', 'char-pants-brown'],
        ['綠', 'char-pants-green'],
      ],
    },
    {
      slot: 'hat',
      title: '帽子',
      none: '無',
      variants: [['棒球帽', 'char-hat-cap']],
    },
  ];
  const groups: SlotGroup[] = [];
  if (charReady) {
    for (const def of slotDefs) {
      const options: SlotGroup['options'] = [{ label: def.none, name: null }];
      for (const [label, name] of def.variants) {
        const w = manifest.assets[`${name}-walk`];
        const i = manifest.assets[`${name}-idle`];
        if (w && i && (await sheetExists(w)) && (await sheetExists(i))) options.push({ label, name });
      }
      if (options.length > 1) groups.push({ slot: def.slot, title: def.title, options, active: null });
    }
    player = await Player.create(manifest, ['char-body'], 0.55);
    const hairGrp = groups.find((g) => g.slot === 'hair');
    const defaultHair = hairGrp?.options.find((o) => o.name === 'char-hair-blonde')?.name ?? null;
    if (defaultHair) {
      await player.setOverlay(manifest, 'hair', defaultHair);
      hairGrp!.active = defaultHair;
    }
    player.x = built.data.spawn.x;
    player.y = built.data.spawn.y;
    built.objectLayer.addChild(player.view);
  }
  // 控制面板:髮色切換 + 場景編輯
  let editor = new SceneEditor(app, built);

  // 驗收/除錯用:曝露角色與編輯器
  const dbg = window as unknown as Record<string, unknown>;
  dbg.__player = player;
  dbg.__built = built;
  dbg.__editor = editor;
  buildUi({
    groups,
    onSlot: (slot, name) => void player?.setOverlay(manifest, slot, name),
    onEditToggle: (on) => editor.setEnabled(on),
    exportJson: () => editor.exportJson(),
  });

  // 鏡頭:整個房間置中、縮放至可視範圍
  const fit = () => {
    const d = built.data;
    const totalH = d.size.h + d.wallHeight;
    const s = Math.min(app.screen.width / d.size.w, app.screen.height / totalH) * 0.92;
    built.root.scale.set(s);
    built.root.x = (app.screen.width - d.size.w * s) / 2;
    built.root.y = (app.screen.height - totalH * s) / 2 + d.wallHeight * s;
  };
  fit();
  window.addEventListener('resize', fit);

  // 場景切換:換裝狀態跟著 Player 實例保留
  let switching = false;
  const switchScene = async (to: string, spawn: { x: number; y: number }) => {
    switching = true;
    try {
      const next = await buildScene(await loadScene(to), manifest);
      if (player) built.objectLayer.removeChild(player.view);
      editor.destroy();
      app.stage.removeChild(built.root);
      built.root.destroy({ children: true });
      built = next;
      app.stage.addChild(built.root);
      if (player) {
        player.x = spawn.x;
        player.y = spawn.y;
        built.objectLayer.addChild(player.view);
      }
      editor = new SceneEditor(app, built);
      dbg.__built = built;
      dbg.__editor = editor;
      fit();
    } finally {
      switching = false;
    }
  };

  app.ticker.add((t) => {
    player?.update(t.deltaMS / 1000, built.colliders);
    if (player && !switching) {
      for (const ex of built.data.exits ?? []) {
        if (aabbOverlap(player.aabb, ex.zone)) {
          void switchScene(ex.to, ex.spawn);
          break;
        }
      }
    }
  });
}

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#e88">${e?.stack ?? e}</pre>`;
});
