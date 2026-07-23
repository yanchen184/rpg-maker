/**
 * 網球對戰 bootstrap:引擎場景 + 球場標線 + 本地/遠端玩家 + 確定性球軌跡 + Firebase 同步接線。
 *
 * 同步模型(重點):球不逐幀同步 —— 每次擊球送一個 Shot 事件(起點/落點/時刻/時長),
 * 兩端用 server 時間各自代入同一公式模擬,畫面自然一致。失分裁定由「接球方」單邊判定
 * (漏接/對手出界都是接球方視角最清楚),裁定後整包 Score 覆寫上雲,雙方照抄。
 */
import { Application } from 'pixi.js';
import {
  setAssetBase,
  loadManifest,
  loadScene,
  buildScene,
  Player,
  type Aabb,
} from '@rpg-maker/engine';
import { buildCourt, COURT } from './court';
import { Ball, shotHitsNet, type Shot } from './ball';
import { Racket } from './racket';
import {
  initialScore,
  pointWon,
  ptText,
  isDeuce,
  otherSide,
  type Score,
  type Side,
} from './scoring';
import { TennisNet, type PlayerState } from './net-tennis';
import { RemotePlayer } from './remote-player';

setAssetBase(import.meta.env.BASE_URL);

const PLAYER_SCALE = 0.55;
/** 拍子可及半徑:球(地面投影)離玩家多近才打得到 */
const RACKET_REACH = 95;
/** 球高超過這個就搆不到(挑高球過頂要退後等它降) */
const HIT_H_MAX = 150;
/** 揮拍判定窗:揮下去後這段時間內球進可及範圍就算擊中 */
const SWING_WINDOW_MS = 150;
/** 揮拍冷卻:亂揮會空窗 */
const SWING_COOLDOWN_MS = 350;
/** 加入房間時,雲上殘留的舊 shot 超過這年紀就當垃圾清掉 */
const STALE_SHOT_MS = 15_000;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** 房間代碼:?room= 沒帶就生一個並寫回網址列(分享連結即對戰邀請) */
function ensureRoom(): string {
  const url = new URL(location.href);
  let room = (url.searchParams.get('room') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
  if (!room) {
    room = Math.random().toString(36).slice(2, 8);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url.toString());
  }
  return room;
}

/** 半場圍欄:限制玩家只能在自己半場活動(中心式 AABB) */
function halfWalls(side: Side): Aabb[] {
  if (side === 'left') {
    return [
      { x: 730, y: 500, w: 40, h: 1200 }, // 網前(x 710-750)
      { x: 10, y: 500, w: 60, h: 1200 }, // 場左端
      { x: 375, y: 15, w: 900, h: 70 },
      { x: 375, y: 985, w: 900, h: 70 },
    ];
  }
  return [
    { x: 770, y: 500, w: 40, h: 1200 }, // 網前(x 750-790)
    { x: 1490, y: 500, w: 60, h: 1200 }, // 場右端
    { x: 1125, y: 15, w: 900, h: 70 },
    { x: 1125, y: 985, w: 900, h: 70 },
  ];
}

function spawnFor(side: Side): { x: number; y: number } {
  return side === 'left' ? { x: 350, y: 500 } : { x: 1150, y: 500 };
}

function hideLoading(): void {
  const el = document.getElementById('loading');
  if (!el) return;
  el.classList.add('hide');
  window.setTimeout(() => el.remove(), 500);
}

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: '#14210f', antialias: false, roundPixels: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const lobby = document.getElementById('lobby')!;
  const lobbyMsg = document.getElementById('lobby-msg')!;
  const lobbyLink = document.getElementById('lobby-link') as HTMLInputElement;
  const lobbyCopy = document.getElementById('lobby-copy')!;
  const sb = document.getElementById('scoreboard')!;
  const hintEl = document.getElementById('hint')!;
  const flashEl = document.getElementById('flash')!;

  const room = ensureRoom();
  lobbyLink.value = location.href;
  lobbyCopy.addEventListener('click', () => {
    void navigator.clipboard.writeText(lobbyLink.value).then(() => {
      lobbyCopy.textContent = '已複製 ✓';
      window.setTimeout(() => (lobbyCopy.textContent = '複製對戰連結'), 1500);
    });
  });

  const net = new TennisNet(room);
  let side: Side;
  try {
    side = await net.join();
  } catch {
    lobbyMsg.textContent = '這個房間已經有兩位玩家了,換個房間代碼再開一場吧。';
    lobby.style.display = 'flex';
    hideLoading();
    return;
  }
  const oppo = otherSide(side);

  // ── 場景與球場 ──
  const manifest = await loadManifest();
  const built = await buildScene(await loadScene('tennis-court'), manifest);
  app.stage.addChild(built.root);
  const court = buildCourt();
  court.zIndex = -10000; // 標線永遠貼地
  built.objectLayer.addChild(court);

  // ── 本地玩家(左右半場穿不同色好辨識) ──
  const player = await Player.create(manifest, ['char-body'], PLAYER_SCALE);
  await player.setOverlay(manifest, 'hair', side === 'left' ? 'char-hair-blonde' : 'char-hair-pink');
  await player.setOverlay(manifest, 'shirt', side === 'left' ? 'char-shirt-red' : 'char-shirt-blue');
  const spawn = spawnFor(side);
  player.x = spawn.x;
  player.y = spawn.y;
  built.objectLayer.addChild(player.view);
  const colliders: Aabb[] = [...built.colliders, ...halfWalls(side)];

  const ball = new Ball();
  built.objectLayer.addChild(ball.view);

  // 球拍:自己一支、對手一支(對手那支收到對方 shot 時播揮拍)
  const racket = new Racket(side === 'left' ? 1 : -1);
  built.objectLayer.addChild(racket.view);
  const remoteRacket = new Racket(side === 'left' ? -1 : 1);
  remoteRacket.view.visible = false;
  built.objectLayer.addChild(remoteRacket.view);

  // 鏡頭:整個球場置中縮放
  const fit = () => {
    const d = built.data;
    const s = Math.min(app.screen.width / d.size.w, app.screen.height / d.size.h) * 0.98;
    built.root.scale.set(s);
    built.root.x = (app.screen.width - d.size.w * s) / 2;
    built.root.y = (app.screen.height - d.size.h * s) / 2;
  };
  fit();
  window.addEventListener('resize', fit);

  // ── 對戰狀態 ──
  let score: Score | null = null;
  let currentShot: Shot | null = null;
  let judgedKey = ''; // 已裁定過的 shot(seq-t0),防重複計分
  let lastFlashSeq = -1;
  let opponent: PlayerState | null = null;
  let remote: RemotePlayer | null = null;
  let remoteBuilding = false;
  let flashTimer = 0;

  const flash = (text: string) => {
    flashEl.textContent = text;
    flashEl.style.display = 'block';
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (flashEl.style.display = 'none'), 1500);
  };

  const updateHud = () => {
    if (!score) return;
    sb.style.display = 'block';
    const pts = isDeuce(score) ? 'Deuce' : `${ptText(score, side)} : ${ptText(score, oppo)}`;
    const serveTxt = score.winner
      ? '按空白鍵再來一場'
      : score.server === side
        ? '🎾 你發球'
        : '對手發球';
    sb.innerHTML =
      `<div class="games">局數 ${score.games[side]} - ${score.games[oppo]} · 你在${side === 'left' ? '左' : '右'}半場(先拿 3 局)</div>` +
      `<div class="pts">${pts}</div>` +
      `<div class="serve">${serveTxt}</div>`;
  };

  // ── 網路事件接線 ──
  net.onPeer = (st) => {
    opponent = st;
    if (st) {
      lobby.style.display = 'none';
      if (remote) {
        remote.onUpdate(st);
      } else if (!remoteBuilding) {
        remoteBuilding = true;
        void RemotePlayer.create(manifest, PLAYER_SCALE, st, '對手').then((rp) => {
          remoteBuilding = false;
          if (!opponent) {
            rp.destroy();
            return;
          }
          remote = rp;
          built.objectLayer.addChild(rp.view);
        });
      }
    } else {
      if (remote) {
        built.objectLayer.removeChild(remote.view);
        remote.destroy();
        remote = null;
      }
      lobbyMsg.textContent = '等待對手加入…(把下面連結傳給對手)';
      lobby.style.display = 'flex';
    }
  };

  net.onShot = (shot) => {
    if (!shot) {
      currentShot = null;
      ball.clear();
      return;
    }
    // 殘局垃圾:加入時雲上留著很久以前的 shot → 清掉,不然會誤裁定
    if (net.now() - shot.t0 > STALE_SHOT_MS && shot.seq !== currentShot?.seq) {
      net.clearShot();
      return;
    }
    const isNew = !currentShot || currentShot.seq !== shot.seq || currentShot.t0 !== shot.t0;
    currentShot = shot;
    ball.play(shot);
    if (isNew && shot.by !== side) remoteRacket.swing();
  };

  net.onScore = (s) => {
    if (!s) {
      // 房主(left)負責開局寫初始比分
      if (side === 'left') net.sendScore(initialScore('left'));
      return;
    }
    if (score && s.seq <= score.seq && s.seq !== 0) {
      score = s;
      updateHud();
      return;
    }
    score = s;
    updateHud();
    if (s.seq > 0 && s.seq > lastFlashSeq && s.lastPointTo) {
      lastFlashSeq = s.seq;
      if (s.winner) {
        flash(s.winner === side ? '🏆 你贏了整場!' : '😢 對手獲勝');
      } else {
        const mine = s.lastPointTo === side;
        flash(`${mine ? '🎾 你得分!' : '對手得分'}${isDeuce(s) ? ' — Deuce' : ''}`);
      }
    }
  };

  // ── 揮拍/發球 ──
  const held = new Set<string>();
  window.addEventListener('keydown', (e) => {
    held.add(e.key.toLowerCase());
    if (e.key === ' ') onSpace();
  });
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));

  /** 球種:按住 ↑(W)= 挑高球、↓(S)= 平抽,沒按 = 普通球 */
  type ShotKind = 'lob' | 'drive' | 'normal';
  const shotKind = (): ShotKind =>
    held.has('w') || held.has('arrowup')
      ? 'lob'
      : held.has('s') || held.has('arrowdown')
        ? 'drive'
        : 'normal';

  // 各球種參數:弧頂高度(px)/球速(px/s)/飛行時長 clamp。
  // 網高 NET_H=46:drive 弧頂只有 48~62,過網點離弧頂稍遠就真的掛網 —— 風險換速度。
  const KIND = {
    lob: { apex: [225, 270], speed: 500, minMs: 1150, maxMs: 1800 },
    normal: { apex: [110, 150], speed: 700, minMs: 700, maxMs: 1200 },
    drive: { apex: [48, 62], speed: 950, minMs: 450, maxMs: 750 },
  } as const;

  const shoot = (x0: number, y0: number) => {
    const kind = shotKind();
    const k = KIND[kind];
    // 拍球相對關係決定回球方向:擊球點偏玩家上/下方 → 回球往對面上/下帶
    const dy = y0 - player.y;
    const y1 = Math.max(200, Math.min(800, (COURT.top + COURT.bottom) / 2 + dy * 4 + rand(-90, 90)));
    const x1 =
      side === 'left'
        ? kind === 'drive'
          ? rand(1020, 1300)
          : rand(840, 1250)
        : kind === 'drive'
          ? rand(200, 480)
          : rand(250, 660);
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const flightMs = Math.max(k.minMs, Math.min(k.maxMs, (dist / k.speed) * 1000));
    const shot: Shot = {
      seq: (currentShot?.seq ?? 0) + 1,
      by: side,
      x0,
      y0,
      x1,
      y1,
      t0: net.now(),
      flightMs,
      apexH: rand(k.apex[0], k.apex[1]),
    };
    currentShot = shot;
    ball.play(shot);
    net.sendShot(shot);
  };

  /** 球在拍子可及範圍內(距離 + 高度都要夠) */
  const ballHittable = (): boolean =>
    !!currentShot &&
    currentShot.by !== side &&
    ball.phase !== 'dead' &&
    ball.h <= HIT_H_MAX &&
    Math.hypot(ball.gx - player.x, ball.gy - player.y) <= RACKET_REACH;

  let swingUntil = 0; // 揮拍判定窗截止時刻(performance.now ms);0 = 沒在揮
  let nextSwingAt = 0; // 冷卻結束時刻

  /** 判定窗內每幀試打:球真的碰到拍子(可及範圍)才出手 */
  const trySwingHit = (): boolean => {
    if (!ballHittable()) return false;
    swingUntil = 0;
    shoot(ball.gx, ball.gy); // 從實際觸拍點出手 → dy 影響回球方向
    return true;
  };

  const onSpace = (): boolean => {
    if (!score || !opponent) return false;
    if (score.winner) {
      // 再來一場:輸家先發
      net.clearShot();
      net.sendScore(initialScore(otherSide(score.winner)));
      return true;
    }
    const nowMs = performance.now();
    if (nowMs < nextSwingAt) return false; // 冷卻中
    nextSwingAt = nowMs + SWING_COOLDOWN_MS;
    racket.swing();
    if (!currentShot && score.server === side) {
      shoot(player.x, player.y - 20); // 發球:拋球直接出手
      return true;
    }
    // 回擊:開判定窗,球進拍子範圍才算打到(揮空就是空)
    swingUntil = nowMs + SWING_WINDOW_MS;
    return trySwingHit();
  };

  /** 對手這球的落點是否為好球(落在我方半場界內) */
  const shotLandsIn = (shot: Shot): boolean => {
    const { left, right, top, bottom, netX } = COURT;
    if (shot.x1 < left || shot.x1 > right || shot.y1 < top || shot.y1 > bottom) return false;
    return shot.by === 'left' ? shot.x1 > netX : shot.x1 < netX;
  };

  /** 好球 = 落點界內且過網時高度夠(掛網 = 壞球,打者失分) */
  const goodShot = (shot: Shot): boolean => shotLandsIn(shot) && !shotHitsNet(shot);

  /** 一分結束:接球方裁定,整包寫分 + 清球 */
  const settlePoint = (to: Side) => {
    if (!score) return;
    const ns = pointWon(score, to);
    net.sendScore(ns);
    net.clearShot();
    currentShot = null;
    ball.clear();
  };

  // ── 主迴圈 ──
  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    player.update(dt, colliders);
    remote?.update(dt);
    net.push({ x: player.x, y: player.y, dir: player.dir });

    const phase = ball.update(net.now());
    // 揮拍判定窗:窗內每幀試打(球飛進拍子範圍的那幀出手)
    if (swingUntil > 0) {
      if (performance.now() <= swingUntil) trySwingHit();
      else swingUntil = 0;
    }
    racket.update(dt, player.x, player.y);
    remoteRacket.view.visible = !!remote;
    if (remote) remoteRacket.update(dt, remote.view.x, remote.view.y);

    // 失分裁定(只有接球方判,單一寫入者)
    if (currentShot && currentShot.by !== side && score && !score.winner && opponent) {
      const key = `${currentShot.seq}-${currentShot.t0}`;
      if (key !== judgedKey) {
        if (phase !== 'flying' && !goodShot(currentShot)) {
          judgedKey = key;
          settlePoint(side); // 對手打出界或掛網 → 我得分
        } else if (phase === 'dead') {
          judgedKey = key;
          settlePoint(currentShot.by); // 兩跳沒接到 → 對手得分
        }
      }
    }

    // 底部提示
    let hint = '';
    if (opponent && score) {
      if (score.winner) hint = '按空白鍵再來一場';
      else if (!currentShot && score.server === side) {
        hint = '按空白鍵發球(按住 ↑ 挑高球.↓ 平抽)';
      } else if (currentShot && currentShot.by !== side && ball.phase !== 'dead') {
        const d = Math.hypot(ball.gx - player.x, ball.gy - player.y);
        if (d <= RACKET_REACH * 1.6) {
          hint = ball.h > HIT_H_MAX ? '球太高了!等它降下來再揮' : '按空白鍵揮拍!';
        }
      }
    }
    hintEl.textContent = hint;
    hintEl.style.display = hint ? 'block' : 'none';
  });

  // 驗收/除錯 hook(agent-browser eval 用)
  (window as unknown as Record<string, unknown>).__tennis = {
    room,
    side: () => side,
    score: () => score,
    shot: () => currentShot,
    ballState: () => ({
      x: Math.round(ball.gx),
      y: Math.round(ball.gy),
      h: Math.round(ball.h),
      phase: ball.phase,
    }),
    hasOpponent: () => !!opponent,
    pos: () => ({ x: Math.round(player.x), y: Math.round(player.y) }),
    teleport: (x: number, y: number) => {
      player.x = x;
      player.y = y;
    },
    swing: () => onSpace(),
  };

  hideLoading();
}

void boot();
