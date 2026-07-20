import { Application, Container, Text } from 'pixi.js';
import { loadManifest, loadFrames, sheetExists } from './assets';
import { aabbOverlap, buildScene, loadScene } from './scene';
import type { Aabb } from './types';
import { Player } from './player';
import { SceneEditor } from './editor';
import { buildUi, type SlotGroup } from './ui';
import { AnimatedSprite } from 'pixi.js';
import { Net } from './net';
import { RemotePlayer } from './remote-player';

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
  const ui = buildUi({
    groups,
    onSlot: (slot, name) => void player?.setOverlay(manifest, slot, name),
    onEditToggle: (on) => editor.setEnabled(on),
    exportJson: () => editor.exportJson(),
  });

  // 背包:撿到的物品計數(跨場景保留)
  let bagCount = 0;
  const PICKUP_RANGE = 90; // 角色與物品距離小於此才能撿(場景像素)
  let pickupHandled = false;
  dbg.__bag = () => bagCount;
  // 撿取最近且在範圍內的地上物品
  const tryPickup = () => {
    if (!player) return;
    let best: (typeof built.pickups)[number] | null = null;
    let bestD = PICKUP_RANGE;
    for (const pk of built.pickups) {
      const d = Math.hypot(pk.data.x - player.x, pk.data.y - player.y);
      if (d < bestD) {
        bestD = d;
        best = pk;
      }
    }
    if (!best) return;
    best.sprite.destroy();
    built.pickups = built.pickups.filter((p) => p !== best);
    bagCount++;
    ui.setBag(bagCount);
  };
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f' && !pickupHandled) {
      pickupHandled = true;
      tryPickup();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'f') pickupHandled = false;
  });

  // 載具:G 上/下車;上車後角色隱身、車帶著人以車速移動
  let riding: (typeof built.vehicles)[number] | null = null;
  const RIDE_RANGE = 110; // 上車距離
  const DEFAULT_VEHICLE_SPEED = 380; // 車比人(220)快
  const vehKeys = new Set<string>();
  let rideHandled = false;
  dbg.__riding = () => (riding ? riding.data.id : null);
  const enterVehicle = () => {
    if (!player) return;
    let best: (typeof built.vehicles)[number] | null = null;
    let bestD = RIDE_RANGE;
    for (const v of built.vehicles) {
      const d = Math.hypot(v.x - player.x, v.y - player.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (!best) return;
    riding = best;
    player.view.visible = false; // 人坐進車裡,先隱身(基本版)
  };
  const exitVehicle = () => {
    if (!player || !riding) return;
    // 角色落回車旁(車正下方一點,避免疊在車上)
    player.x = riding.x;
    player.y = riding.y + 60;
    player.view.visible = true;
    riding = null;
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'g' && !rideHandled) {
      rideHandled = true;
      if (riding) exitVehicle();
      else enterVehicle();
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      vehKeys.add(k);
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'g') rideHandled = false;
    vehKeys.delete(k);
  });
  // 車移動:讀方向鍵,吃碰撞牆(沿牆滑),更新車 sprite + 讓角色座標跟車
  const updateVehicle = (dtSec: number) => {
    if (!riding || !player) return;
    let dx = 0;
    let dy = 0;
    if (vehKeys.has('w') || vehKeys.has('arrowup')) dy -= 1;
    if (vehKeys.has('s') || vehKeys.has('arrowdown')) dy += 1;
    if (vehKeys.has('a') || vehKeys.has('arrowleft')) dx -= 1;
    if (vehKeys.has('d') || vehKeys.has('arrowright')) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      const speed = riding.data.speed ?? DEFAULT_VEHICLE_SPEED;
      const step = (speed * dtSec) / len;
      const half = { w: 60, h: 30 }; // 車底碰撞框(約車身)
      const canMove = (nx: number, ny: number): boolean => {
        const box: Aabb = { x: nx, y: ny - half.h / 2, w: half.w, h: half.h };
        return !built.colliders.some((c) => aabbOverlap(box, c));
      };
      const nx = riding.x + dx * step;
      if (canMove(nx, riding.y)) riding.x = nx;
      const ny = riding.y + dy * step;
      if (canMove(riding.x, ny)) riding.y = ny;
    }
    riding.sprite.x = riding.x;
    riding.sprite.y = riding.y;
    riding.sprite.zIndex = riding.y;
    // 角色跟著車(座標同步,view 雖隱身但保持位置正確,下車才對)
    player.x = riding.x;
    player.y = riding.y;
  };

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

  // ── 多人連線:把本地玩家位置廣播到 Firebase RTDB,渲染同場景的其他玩家 ──
  let net: Net | null = null;
  const remotes = new Map<string, RemotePlayer>();
  // 正在建立中的 remote(避免 async 建立期間同一 id 重複建)
  const remoteBuilding = new Set<string>();
  const PLAYER_SCALE = 0.55;
  try {
    net = new Net();
    dbg.__net = () => ({
      id: net?.clientId,
      name: net?.name,
      peers: net ? Object.keys(net.peers).length : 0,
      shown: remotes.size,
    });
  } catch (e) {
    console.warn('多人連線初始化失敗(單機仍可玩):', e);
  }
  // 每幀對帳:依 net.peers 增/刪/更新 remote sprite,只顯示與本地同場景者
  const syncRemotes = (dtSec: number) => {
    if (!net) return;
    const sceneName = built.data.name;
    const peers = net.peers;
    // 移除:已離線、或跑到別的場景的 remote
    for (const [id, rp] of remotes) {
      const st = peers[id];
      if (!st || st.scene !== sceneName) {
        built.objectLayer.removeChild(rp.view);
        rp.destroy();
        remotes.delete(id);
      }
    }
    // 新增/更新:同場景的 peer
    for (const [id, st] of Object.entries(peers)) {
      if (st.scene !== sceneName) continue;
      const rp = remotes.get(id);
      if (rp) {
        rp.onUpdate(st);
      } else if (!remoteBuilding.has(id)) {
        remoteBuilding.add(id);
        void RemotePlayer.create(manifest, PLAYER_SCALE, st).then((newRp) => {
          remoteBuilding.delete(id);
          // 建立期間可能已切場景/該 peer 已離線 → 再確認一次才掛上
          if (!net || net.peers[id]?.scene !== built.data.name) {
            newRp.destroy();
            return;
          }
          remotes.set(id, newRp);
          built.objectLayer.addChild(newRp.view);
        });
      }
    }
    // 插值移動所有 remote
    for (const rp of remotes.values()) rp.update(dtSec);
  };
  // 切場景時清掉所有 remote(objectLayer 會被銷毀重建)
  const clearRemotes = () => {
    for (const rp of remotes.values()) rp.destroy();
    remotes.clear();
    remoteBuilding.clear();
  };

  // 場景切換:換裝狀態跟著 Player 實例保留
  let switching = false;
  const switchScene = async (to: string, spawn: { x: number; y: number }) => {
    switching = true;
    clearRemotes(); // 舊場景 objectLayer 即將銷毀,先清遠端玩家 sprite
    // 切場景先強制下車(舊場景的車 sprite 會被銷毀,riding 不能懸空)
    if (riding && player) {
      player.view.visible = true;
      riding = null;
    }
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
    const dt = t.deltaMS / 1000;
    if (riding) {
      // 騎乘中:只由車帶人移動,角色不自走(不跑 player.update,避免方向鍵人車搶控)
      updateVehicle(dt);
    } else {
      player?.update(dt, built.colliders);
    }
    if (player && !switching && !riding) {
      for (const ex of built.data.exits ?? []) {
        if (aabbOverlap(player.aabb, ex.zone)) {
          void switchScene(ex.to, ex.spawn);
          break;
        }
      }
    }
    // 多人:廣播自己 + 對帳/渲染其他玩家(切場景中不推,避免場景名跳動)
    if (net && player && !switching) {
      net.push({ x: player.x, y: player.y, dir: player.dir, scene: built.data.name });
      syncRemotes(dt);
    }
  });
}

boot().catch((e) => {
  document.body.innerHTML = `<pre style="color:#e88">${e?.stack ?? e}</pre>`;
});
