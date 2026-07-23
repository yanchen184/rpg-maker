/**
 * 網球對戰 bootstrap:引擎場景 + 球場標線 + 玩家/AI + 確定性球軌跡 + 連線層接線。
 *
 * 三種模式(?mode=):
 *   online(預設) 兩人 Firebase 連線對戰 —— 球不逐幀同步,每次擊球送一個 Shot 事件
 *                 (起點/落點/時刻/時長),兩端用 server 時間各自代入同一公式模擬。
 *                 失分裁定由「接球方」單邊判定,裁定後整包 Score 覆寫上雲,雙方照抄。
 *   ai            跟 AI 對戰:你在左、AI 在右,連線層換成本機迴音壁(LocalNet),規則同一套。
 *   watch         觀戰:左右都是 AI,自動開球、打完整場自動再開,人只看。
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
  faultCommitted,
  serveHalf,
  otherHalf,
  ptText,
  isDeuce,
  otherSide,
  type Score,
  type Side,
} from './scoring';
import { TennisNet, type PlayerState } from './net-tennis';
import { LocalNet, type MatchNet } from './local-net';
import { RemotePlayer } from './remote-player';
import { AiController } from './ai-controller';
import {
  makeShot,
  serveLandsIn,
  RACKET_REACH,
  HIT_H_MAX,
  SWING_WINDOW_MS,
  SWING_COOLDOWN_MS,
  type ShotKind,
} from './shots';

setAssetBase(import.meta.env.BASE_URL);

const PLAYER_SCALE = 0.55;
/** 加入房間時,雲上殘留的舊 shot 超過這年紀就當垃圾清掉 */
const STALE_SHOT_MS = 15_000;
/** 觀戰模式:整場打完後幾 ms 自動再開一場 */
const WATCH_RESTART_MS = 3200;

type Mode = 'online' | 'ai' | 'watch';

function parseMode(): Mode {
  const m = new URL(location.href).searchParams.get('mode');
  return m === 'ai' ? 'ai' : m === 'watch' ? 'watch' : 'online';
}

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

  const mode = parseMode();
  // 大廳的模式切換鈕(等人等膩了可改跟 AI 打/看 AI 對打)
  const gotoMode = (m: Mode) => {
    location.href = `${location.pathname}?mode=${m}`;
  };
  document.getElementById('mode-ai')?.addEventListener('click', () => gotoMode('ai'));
  document.getElementById('mode-watch')?.addEventListener('click', () => gotoMode('watch'));

  const room = mode === 'online' ? ensureRoom() : `local-${mode}`;
  lobbyLink.value = location.href;
  lobbyCopy.addEventListener('click', () => {
    void navigator.clipboard.writeText(lobbyLink.value).then(() => {
      lobbyCopy.textContent = '已複製 ✓';
      window.setTimeout(() => (lobbyCopy.textContent = '複製對戰連結'), 1500);
    });
  });

  const net: MatchNet = mode === 'online' ? new TennisNet(room) : new LocalNet();
  let side: Side; // 本地視角方(watch 模式無人操作,取 left 當 HUD 基準)
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

  // ── 本地玩家(觀戰模式沒有;左右半場穿不同色好辨識) ──
  let player: Player | null = null;
  let racket: Racket | null = null;
  let colliders: Aabb[] = [];
  if (mode !== 'watch') {
    player = await Player.create(manifest, ['char-body'], PLAYER_SCALE);
    await player.setOverlay(manifest, 'hair', side === 'left' ? 'char-hair-blonde' : 'char-hair-pink');
    await player.setOverlay(manifest, 'shirt', side === 'left' ? 'char-shirt-red' : 'char-shirt-blue');
    const spawn = spawnFor(side);
    player.x = spawn.x;
    player.y = spawn.y;
    built.objectLayer.addChild(player.view);
    colliders = [...built.colliders, ...halfWalls(side)];
    racket = new Racket(side === 'left' ? 1 : -1);
    built.objectLayer.addChild(racket.view);
  }

  const ball = new Ball();
  built.objectLayer.addChild(ball.view);

  // ── AI 球員(ai 模式:右側一隻;watch 模式:左右各一隻) ──
  const aiSides: Side[] = mode === 'ai' ? ['right'] : mode === 'watch' ? ['left', 'right'] : [];
  interface AiEntity {
    ctl: AiController;
    body: RemotePlayer;
    racket: Racket;
  }
  const ais: AiEntity[] = [];
  for (const s of aiSides) {
    const ctl = new AiController(s);
    const name = mode === 'ai' ? 'AI' : s === 'left' ? 'AI·左' : 'AI·右';
    const body = await RemotePlayer.create(
      manifest,
      PLAYER_SCALE,
      { id: `ai-${s}`, x: ctl.x, y: ctl.y, dir: 'down', ts: 0 },
      name,
    );
    built.objectLayer.addChild(body.view);
    const rk = new Racket(s === 'left' ? 1 : -1);
    built.objectLayer.addChild(rk.view);
    ais.push({ ctl, body, racket: rk });
  }

  // 線上模式:對手球拍(收到對方 shot 時播揮拍)
  const remoteRacket = mode === 'online' ? new Racket(side === 'left' ? -1 : 1) : null;
  if (remoteRacket) {
    remoteRacket.view.visible = false;
    built.objectLayer.addChild(remoteRacket.view);
  }

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
  // 本機模式沒有真人對手,直接視為「對手在場」讓開球/提示邏輯通行
  let opponent: PlayerState | null =
    mode === 'online' ? null : { id: 'ai', x: 0, y: 0, dir: 'down', ts: 0 };
  let remote: RemotePlayer | null = null;
  let remoteBuilding = false;
  let flashTimer = 0;
  let watchRestartAt = 0; // 觀戰模式自動再開的時刻(performance.now ms)

  const flash = (text: string) => {
    flashEl.textContent = text;
    flashEl.style.display = 'block';
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => (flashEl.style.display = 'none'), 1500);
  };

  const sideName = (s: Side): string => (s === 'left' ? '左' : '右');

  const updateHud = () => {
    if (!score) return;
    sb.style.display = 'block';
    if (mode === 'watch') {
      const pts = isDeuce(score) ? 'Deuce' : `${ptText(score, 'left')} : ${ptText(score, 'right')}`;
      const serveTxt = score.winner
        ? `${sideName(score.winner)}方 AI 獲勝!稍後自動再開一場(空白鍵立刻開)`
        : `${sideName(score.server)}方 AI 發球${(score.faults ?? 0) > 0 ? '(第二發)' : ''}`;
      sb.innerHTML =
        `<div class="games">局數 ${score.games.left} - ${score.games.right} · 👀 AI 對打觀戰中(先拿 3 局)</div>` +
        `<div class="pts">${pts}</div>` +
        `<div class="serve">${serveTxt}</div>`;
      return;
    }
    const pts = isDeuce(score) ? 'Deuce' : `${ptText(score, side)} : ${ptText(score, oppo)}`;
    const oppoName = mode === 'ai' ? 'AI' : '對手';
    const secondServe = (score.faults ?? 0) > 0 ? '(第二發)' : '';
    const serveTxt = score.winner
      ? '按空白鍵再來一場'
      : score.server === side
        ? `🎾 你發球${secondServe}`
        : `${oppoName}發球${secondServe}`;
    sb.innerHTML =
      `<div class="games">局數 ${score.games[side]} - ${score.games[oppo]} · 你在${sideName(side)}半場${mode === 'ai' ? ' · 對手是 AI' : ''}(先拿 3 局)</div>` +
      `<div class="pts">${pts}</div>` +
      `<div class="serve">${serveTxt}</div>`;
  };

  // ── 連線層事件接線(線上=Firebase;本機=迴音壁) ──
  if (mode === 'online') {
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
  }

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
    if (isNew && shot.by !== side) remoteRacket?.swing();
  };

  net.onScore = (s) => {
    if (!s) {
      // 房主(left)負責開局寫初始比分(本機模式在下面直接寫,不走這條)
      if (mode === 'online' && side === 'left') net.sendScore(initialScore('left'));
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
      if (mode === 'watch') {
        if (s.winner) flash(`🏆 ${sideName(s.winner)}方 AI 獲勝!`);
        else flash(`${sideName(s.lastPointTo)}方得分${isDeuce(s) ? ' — Deuce' : ''}`);
      } else if (s.winner) {
        flash(s.winner === side ? '🏆 你贏了整場!' : `😢 ${mode === 'ai' ? 'AI' : '對手'}獲勝`);
      } else {
        const mine = s.lastPointTo === side;
        flash(`${mine ? '🎾 你得分!' : `${mode === 'ai' ? 'AI' : '對手'}得分`}${isDeuce(s) ? ' — Deuce' : ''}`);
      }
    } else if (s.seq > 0 && s.seq > lastFlashSeq && !s.lastPointTo && (s.faults ?? 0) === 1) {
      // 一發失誤(fault 更新沒有得分者):兩端都跳失誤快報
      lastFlashSeq = s.seq;
      const who =
        mode === 'watch' ? `${sideName(s.server)}方 AI` : s.server === side ? '你' : mode === 'ai' ? 'AI' : '對手';
      flash(`⚠️ ${who}一發失誤,還有第二發`);
    }
  };

  // 本機模式:直接開局(不用等雲端 null 快照)
  if (mode !== 'online') net.sendScore(initialScore('left'));

  // ── 出球(人與 AI 共用同一公式) ──
  const COURT_MID = (COURT.top + COURT.bottom) / 2;
  const shoot = (by: Side, kind: ShotKind, x0: number, y0: number, ownerY: number) => {
    // 沒有球在飛 = 這球是發球:必須瞄對角發球區(站位半區的相反 y 半區)
    const serving = !currentShot && !!score;
    const shot = makeShot({
      by,
      kind,
      x0,
      y0,
      ownerY,
      prevSeq: currentShot?.seq ?? 0,
      t0: net.now(),
      serveBox: serving && score ? otherHalf(serveHalf(by, score)) : null,
    });
    currentShot = shot;
    ball.play(shot);
    net.sendShot(shot);
  };

  // ── 鍵盤:揮拍/發球(觀戰模式空白鍵只用來提早再開) ──
  const held = new Set<string>();
  window.addEventListener('keydown', (e) => {
    held.add(e.key.toLowerCase());
    if (e.key === ' ') onSpace();
  });
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));

  /** 球種:按住 ↑(W)= 挑高球、↓(S)= 平抽,沒按 = 普通球 */
  const humanKind = (): ShotKind =>
    held.has('w') || held.has('arrowup')
      ? 'lob'
      : held.has('s') || held.has('arrowdown')
        ? 'drive'
        : 'normal';

  /** 球在拍子可及範圍內(距離 + 高度都要夠) */
  const ballHittable = (): boolean =>
    !!player &&
    !!currentShot &&
    currentShot.by !== side &&
    ball.phase !== 'dead' &&
    ball.h <= HIT_H_MAX &&
    Math.hypot(ball.gx - player.x, ball.gy - player.y) <= RACKET_REACH;

  let swingUntil = 0; // 揮拍判定窗截止時刻(performance.now ms);0 = 沒在揮
  let nextSwingAt = 0; // 冷卻結束時刻

  /** 判定窗內每幀試打:球真的碰到拍子(可及範圍)才出手 */
  const trySwingHit = (): boolean => {
    if (!player || !ballHittable()) return false;
    swingUntil = 0;
    shoot(side, humanKind(), ball.gx, ball.gy, player.y); // 從實際觸拍點出手 → dy 影響回球方向
    return true;
  };

  /** 再開一場:輸家先發 */
  const restartMatch = () => {
    if (!score?.winner) return;
    watchRestartAt = 0;
    net.clearShot();
    net.sendScore(initialScore(otherSide(score.winner)));
  };

  const onSpace = (): boolean => {
    if (!score || !opponent) return false;
    if (score.winner) {
      restartMatch();
      return true;
    }
    if (!player || !racket) return false; // 觀戰模式:比賽中空白鍵無作用
    if (!currentShot && score.server === side) {
      // 發球:必須站在正確半區(deuce/ad 依局內分數奇偶),站錯不揮拍只提示
      const half = serveHalf(side, score);
      const okPos = half === 'top' ? player.y < COURT_MID : player.y > COURT_MID;
      if (!okPos) {
        flash(`發球要站在${half === 'top' ? '上' : '下'}半區(往${half === 'top' ? '上' : '下'}移動)`);
        return false;
      }
      const nowMs = performance.now();
      if (nowMs < nextSwingAt) return false; // 冷卻中
      nextSwingAt = nowMs + SWING_COOLDOWN_MS;
      racket.swing();
      shoot(side, humanKind(), player.x, player.y - 20, player.y); // 發球:拋球直接出手
      return true;
    }
    const nowMs = performance.now();
    if (nowMs < nextSwingAt) return false; // 冷卻中
    nextSwingAt = nowMs + SWING_COOLDOWN_MS;
    racket.swing();
    // 回擊:開判定窗,球進拍子範圍才算打到(揮空就是空)
    swingUntil = nowMs + SWING_WINDOW_MS;
    return trySwingHit();
  };

  /** 這球的落點是否為好球(落在接球方半場界內) */
  const shotLandsIn = (shot: Shot): boolean => {
    const { left, right, top, bottom, netX } = COURT;
    if (shot.x1 < left || shot.x1 > right || shot.y1 < top || shot.y1 > bottom) return false;
    return shot.by === 'left' ? shot.x1 > netX : shot.x1 < netX;
  };

  /** 好球 = 落點界內且過網時高度夠(掛網 = 壞球,打者失分);發球另須落進對角發球區 */
  const goodShot = (shot: Shot): boolean => shotLandsIn(shot) && serveLandsIn(shot) && !shotHitsNet(shot);

  /** 一分結束:整包寫分 + 清球 */
  const settlePoint = (to: Side) => {
    if (!score) return;
    const ns = pointWon(score, to);
    net.sendScore(ns);
    net.clearShot();
    currentShot = null;
    ball.clear();
  };

  /** 發球失敗一次:一發失誤 → 記 fault 重發;雙誤 → 接球方得分 */
  const settleFault = (receiver: Side) => {
    if (!score) return;
    const ns = faultCommitted(score, receiver);
    net.sendScore(ns);
    net.clearShot();
    currentShot = null;
    ball.clear();
  };

  // ── 主迴圈 ──
  app.ticker.add((t) => {
    const dt = t.deltaMS / 1000;
    const nowSrv = net.now();
    if (player) {
      player.update(dt, colliders);
      net.push({ x: player.x, y: player.y, dir: player.dir });
    }
    remote?.update(dt);

    const phase = ball.update(nowSrv);
    // 揮拍判定窗:窗內每幀試打(球飛進拍子範圍的那幀出手)
    if (swingUntil > 0) {
      if (performance.now() <= swingUntil) trySwingHit();
      else swingUntil = 0;
    }
    if (player && racket) racket.update(dt, player.x, player.y);
    if (remoteRacket) {
      remoteRacket.view.visible = !!remote;
      if (remote) remoteRacket.update(dt, remote.view.x, remote.view.y);
    }

    // 失分裁定:線上由接球方單邊判(單一寫入者);本機模式整場都在本頁,直接判。
    // 注意:必須在 AI 出手「之前」裁定 —— phase 是這幀開頭算的,若 AI 先在同幀出新球,
    // 會拿上一顆球殘留的 dead phase 誤判新球、發球瞬間就被結算。
    if (currentShot && score && !score.winner) {
      const receiver = otherSide(currentShot.by);
      const canJudge = mode !== 'online' ? true : currentShot.by !== side && !!opponent;
      if (canJudge) {
        const key = `${currentShot.seq}-${currentShot.t0}`;
        if (key !== judgedKey) {
          if (phase !== 'flying' && !goodShot(currentShot)) {
            judgedKey = key;
            // 發球失敗(沒進發球區/掛網)走一二發規則;對打壞球直接失分
            if (currentShot.serveBox) settleFault(receiver);
            else settlePoint(receiver); // 打者出界或掛網 → 接球方得分
          } else if (phase === 'dead') {
            judgedKey = key;
            settlePoint(currentShot.by); // 兩跳沒接到 → 打者得分
          }
        }
      }
    }

    // AI:感知 → 移動 → 出手(發球/回擊走跟人同一套 shoot)。放在裁定後,新球下一幀才進裁定。
    for (const ai of ais) {
      const intent = ai.ctl.tick(dt, {
        shot: currentShot,
        ballX: ball.gx,
        ballY: ball.gy,
        ballH: ball.h,
        ballPhase: ball.phase,
        score,
        now: nowSrv,
      });
      ai.body.onUpdate({ id: `ai-${ai.ctl.side}`, x: ai.ctl.x, y: ai.ctl.y, dir: ai.ctl.dir, ts: nowSrv });
      ai.body.update(dt);
      ai.racket.update(dt, ai.body.view.x, ai.body.view.y);
      if (intent) {
        ai.racket.swing();
        if (intent.type === 'serve') shoot(ai.ctl.side, intent.kind, ai.ctl.x, ai.ctl.y - 20, ai.ctl.y);
        else shoot(ai.ctl.side, intent.kind, intent.x0, intent.y0, ai.ctl.y);
      }
    }

    // 觀戰模式:整場結束後自動再開
    if (mode === 'watch' && score?.winner) {
      if (!watchRestartAt) watchRestartAt = performance.now() + WATCH_RESTART_MS;
      else if (performance.now() >= watchRestartAt) restartMatch();
    } else {
      watchRestartAt = 0;
    }

    // 底部提示(觀戰模式不提示操作)
    let hint = '';
    if (player && opponent && score) {
      if (score.winner) hint = '按空白鍵再來一場';
      else if (!currentShot && score.server === side) {
        // 發球提示:含站位半區與第幾發(站錯先引導移動)
        const half = serveHalf(side, score);
        const okPos = half === 'top' ? player.y < COURT_MID : player.y > COURT_MID;
        const nth = (score.faults ?? 0) > 0 ? '第二發' : '第一發';
        hint = okPos
          ? `${nth}:按空白鍵發球,要落進對角發球區(按住 ↑ 挑高球.↓ 平抽)`
          : `${nth}:先移動到${half === 'top' ? '上' : '下'}半區才能發球`;
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
    mode,
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
    pos: () => (player ? { x: Math.round(player.x), y: Math.round(player.y) } : null),
    ais: () => ais.map((a) => ({ side: a.ctl.side, x: Math.round(a.ctl.x), y: Math.round(a.ctl.y) })),
    teleport: (x: number, y: number) => {
      if (player) {
        player.x = x;
        player.y = y;
      }
    },
    swing: () => onSpace(),
    /** 測試用:指定落點直接發一顆球(繞過散布,驗發球區裁定/雙誤用) */
    debugServe: (x1: number, y1: number) => {
      if (!score || currentShot || !player || score.server !== side) return null;
      const box = otherHalf(serveHalf(side, score));
      const shot: Shot = {
        seq: 1,
        by: side,
        x0: player.x,
        y0: player.y - 20,
        x1,
        y1,
        t0: net.now(),
        flightMs: 450,
        apexH: 56,
        serveBox: box,
      };
      currentShot = shot;
      ball.play(shot);
      net.sendShot(shot);
      return box;
    },
  };

  hideLoading();
}

void boot();
