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
import { Application, Graphics } from 'pixi.js';
import {
  setAssetBase,
  loadManifest,
  loadFrames,
  loadScene,
  buildScene,
  aabbOverlap,
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
import { AI_PRESETS, AiController, type AiLevel } from './ai-controller';
import {
  makeShot,
  serveLandsIn,
  RACKET_REACH,
  HIT_H_MAX,
  SMASH_MIN_H,
  SPECIAL_KINDS,
  SWING_WINDOW_MS,
  SWING_COOLDOWN_MS,
  ENERGY_MAX,
  ENERGY_REGEN,
  COST,
  DASH_DIST,
  DASH_SEC,
  DASH_REACH_MUL,
  DASH_REACH_TAIL,
  DASH_COOLDOWN_MS,
  STRAINED_QUALITY,
  contactQuality,
  serveSpot,
  type ShotAim,
  type ShotKind,
} from './shots';
import { isTouchDevice, setupTouchControls } from './touch';
import { CharAnim, type PoseKind } from './char-anim';
import { Sfx } from './sfx';
import { FxLayer } from './fx';

setAssetBase(import.meta.env.BASE_URL);

const PLAYER_SCALE = 0.55;
/** 加入房間時,雲上殘留的舊 shot 超過這年紀就當垃圾清掉 */
const STALE_SHOT_MS = 15_000;
/** 觀戰模式:整場打完後幾 ms 自動再開一場 */
const WATCH_RESTART_MS = 3200;

// 招式數值(氣力槽 / 閃身)住在 shots.ts,人類與 AI 共用同一組 —— 見該檔註解。

type Mode = 'online' | 'ai' | 'watch';

function parseMode(): Mode {
  const m = new URL(location.href).searchParams.get('mode');
  return m === 'ai' ? 'ai' : m === 'watch' ? 'watch' : 'online';
}

/** AI 難度(?level=):easy / normal / hard,遊戲中 1/2/3 可再切 */
function parseLevel(): AiLevel {
  const l = new URL(location.href).searchParams.get('level');
  return l === 'easy' || l === 'hard' ? l : 'normal';
}

const LEVEL_NAME: Record<AiLevel, string> = { easy: '簡單', normal: '普通', hard: '困難' };

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
  const energyEl = document.getElementById('energy');
  const energyFillEl = document.getElementById('energy-fill');
  const flowEl = document.getElementById('flow');
  const rallyCountEl = document.getElementById('rally-count');
  const momentumFillEl = document.getElementById('momentum-fill');
  const qualityTextEl = document.getElementById('quality-text');

  const mode = parseMode();
  // 觸控樣式要在「大廳還在畫面上」時就決定 —— 大廳的操作說明有鍵盤版/觸控版兩份,
  // 等進遊戲才掛 class 的話,玩家在大廳讀到的會是叫他按不存在的鍵。
  if (isTouchDevice()) document.body.classList.add('touch-mode');
  // 大廳的模式切換鈕(等人等膩了可改跟 AI 打/看 AI 對打)
  const gotoMode = (m: Mode, level?: AiLevel) => {
    location.href = `${location.pathname}?mode=${m}${level ? `&level=${level}` : ''}`;
  };
  document.getElementById('mode-ai-easy')?.addEventListener('click', () => gotoMode('ai', 'easy'));
  document.getElementById('mode-ai')?.addEventListener('click', () => gotoMode('ai'));
  document.getElementById('mode-ai-hard')?.addEventListener('click', () => gotoMode('ai', 'hard'));
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
  const [strainedFrames, smashFrames, forehandFrames, backhandFrames] = await Promise.all([
    loadFrames('char-tennis-dive-flagship', manifest.assets['char-tennis-dive-flagship']),
    loadFrames('char-tennis-smash-flagship', manifest.assets['char-tennis-smash-flagship']),
    loadFrames('char-tennis-forehand-flagship', manifest.assets['char-tennis-forehand-flagship']),
    loadFrames('char-tennis-backhand-flagship', manifest.assets['char-tennis-backhand-flagship']),
  ]);
  const characterActionAssets = {
    strained: strainedFrames,
    smash: smashFrames,
    forehand: forehandFrames,
    backhand: backhandFrames,
  };
  const built = await buildScene(await loadScene('tennis-court'), manifest);
  app.stage.addChild(built.root);
  const court = buildCourt();
  court.zIndex = -10000; // 標線永遠貼地
  built.objectLayer.addChild(court);
  const aimMarker = new Graphics();
  aimMarker.zIndex = -9000;
  built.objectLayer.addChild(aimMarker);

  // ── 本地玩家(觀戰模式沒有;左右半場穿不同色好辨識) ──
  let player: Player | null = null;
  let racket: Racket | null = null;
  let colliders: Aabb[] = [];
  if (mode !== 'watch') {
    player = await Player.create(manifest, ['char-body'], PLAYER_SCALE);
    player.speed = 280; // 球場上是跑不是走
    player.walkFps = 14; // 步頻拉高才有跑步感(引擎預設 8 是散步)
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

  // ── 打擊手感:音效(WebAudio 合成)+ 衝擊圈/塵土 + 畫面震動 ──
  const sfx = new Sfx();
  window.addEventListener('pointerdown', () => sfx.unlock());
  const fx = new FxLayer();
  fx.view.zIndex = 9000; // 特效永遠蓋在人與球上面
  built.objectLayer.addChild(fx.view);
  let shake = 0; // 畫面震動幅度(px),drive 擊球觸發、指數衰減
  /** 擊球回饋(本地與遠端共用):音效 + 衝擊圈;殺球最重、平抽次之 */
  const fxHit = (kind: ShotKind, x: number, y: number) => {
    sfx.hit(kind);
    if (kind === 'smash') {
      fx.burst(x, y - 20); // 殺球專屬爆裂圈,比一般 ring 大而狠
      shake = 13;
    } else {
      fx.ring(x, y - 20, kind === 'drive' ? 0xffd24a : kind === 'slice' ? 0x9fe8ff : 0xffffff);
      if (kind === 'drive') shake = 6;
    }
  };

  // ── AI 球員(ai 模式:右側一隻;watch 模式:左右各一隻) ──
  const aiSides: Side[] = mode === 'ai' ? ['right'] : mode === 'watch' ? ['left', 'right'] : [];
  interface AiEntity {
    ctl: AiController;
    body: RemotePlayer;
    racket: Racket;
  }
  const ais: AiEntity[] = [];
  let aiLevel = parseLevel();
  for (const s of aiSides) {
    // ai 模式吃難度預設;watch 模式固定普通(兩隻同強度才有來回)
    const ctl = new AiController(s, AI_PRESETS[mode === 'ai' ? aiLevel : 'normal']);
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

  // 鏡頭:整個球場置中縮放(基準位置另存,畫面震動時在基準上加抖動)
  const rootBase = { x: 0, y: 0 };
  const fit = () => {
    const d = built.data;
    const s = Math.min(app.screen.width / d.size.w, app.screen.height / d.size.h) * 0.98;
    built.root.scale.set(s);
    rootBase.x = (app.screen.width - d.size.w * s) / 2;
    rootBase.y = (app.screen.height - d.size.h * s) / 2;
    built.root.x = rootBase.x;
    built.root.y = rootBase.y;
  };
  fit();
  window.addEventListener('resize', fit);

  // ── 對戰狀態 ──
  let score: Score | null = null;
  let currentShot: Shot | null = null;
  let rallyHits = 0;
  let momentum = 0;
  let qualityText = '待機';
  const updateFlowHud = () => {
    if (!flowEl || !rallyCountEl || !momentumFillEl || !qualityTextEl) return;
    flowEl.style.display = player ? 'flex' : 'none';
    rallyCountEl.textContent = `回合 ${rallyHits}`;
    momentumFillEl.style.width = `${Math.round(momentum)}%`;
    qualityTextEl.textContent = qualityText;
  };
  const resetFlow = () => {
    rallyHits = 0;
    momentum = 0;
    qualityText = '待機';
    updateFlowHud();
  };
  /** 驗收用:每次出手的球種紀錄(含 AI),配 aiDashes 驗招式真的有打出來 */
  const shotLog: { by: Side; kind: ShotKind; h: number; quality: number; shallow: boolean }[] = [];
  /**
   * 閃身紀錄。`saved` 是平衡調校的關鍵指標:這次撲救最後有沒有真的把球打回去。
   * 撲了卻沒救到(saved=false)才是設計上該存在的「白閃」—— 全是 true 代表閃身無腦強。
   * 撲出去時先記 false,同一顆球稍後打到才翻成 true(見 shotLog 那側)。
   */
  const aiDashes: { side: Side; dx: number; dy: number; saved: boolean }[] = [];
  /** 每邊「還沒揭曉結果」的那次閃身在 aiDashes 的索引;-1 = 沒有待結算的撲救 */
  const pendingDash: Record<Side, number> = { left: -1, right: -1 };
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

  /** ai 模式:切 AI 難度(即時生效,同步寫回網址列讓重整保留) */
  const setAiLevel = (l: AiLevel) => {
    if (mode !== 'ai' || l === aiLevel) return;
    aiLevel = l;
    for (const ai of ais) ai.ctl.configure(AI_PRESETS[l]);
    const url = new URL(location.href);
    url.searchParams.set('level', l);
    history.replaceState(null, '', url.toString());
    flash(`🤖 AI 難度:${LEVEL_NAME[l]}`);
  };

  // ── 角色動作與表情(揮拍帶身/得分跳/失分垂頭/失誤聳肩) ──
  const viewFor = (s: Side) => {
    if (player && s === side) return player.view;
    const ai = ais.find((a) => a.ctl.side === s);
    if (ai) return ai.body.view;
    if (remote && s === oppo) return remote.view;
    return null;
  };
  const anim: Record<Side, CharAnim> = {
    left: new CharAnim(() => viewFor('left'), characterActionAssets, PLAYER_SCALE),
    right: new CharAnim(() => viewFor('right'), characterActionAssets, PLAYER_SCALE),
  };
  const facingOf = (s: Side): number => (s === 'left' ? 1 : -1);
  /** 得分方慶祝、失分方垂頭(整場結束用 🏆/😭 加長版) */
  const reactPoint = (winner: Side) => {
    anim[winner].pose('celebrate', facingOf(winner));
    const loser = otherSide(winner);
    anim[loser].pose('droop', facingOf(loser));
  };

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
    // 本機 AI/觀戰的出手已在 shoot() 計數;只有線上遠端球需要在收到網路事件時補記。
    if (isNew && mode === 'online' && shot.by !== side && !shot.serveBox) {
      rallyHits += 1;
      updateFlowHud();
    }
    ball.play(shot);
    if (isNew && shot.by !== side) {
      remoteRacket?.swing();
      // 對手擊球回饋:優先讀 shot.kind;舊版 client 沒這欄才從 apexH 反推
      // (殺球弧頂 52~64 跟平抽 48~62 重疊,所以招式球一定要靠明確欄位,反推區分不出來)
      const kind: ShotKind = shot.kind ?? (shot.apexH <= 62 ? 'drive' : shot.apexH >= 225 ? 'lob' : 'normal');
      fxHit(kind, shot.x0, shot.y0);
      const owner = viewFor(shot.by);
      const contactFacing = Math.sign(shot.x0 - (owner?.x ?? shot.x0)) || facingOf(shot.by);
      if ((shot.quality ?? 1) < STRAINED_QUALITY) anim[shot.by].action('strained', contactFacing);
      else if (kind === 'smash') anim[shot.by].action('smash', facingOf(shot.by));
      else if (kind === 'normal' || kind === 'drive') {
        const action = contactFacing === facingOf(shot.by) ? 'forehand' : 'backhand';
        anim[shot.by].action(action, facingOf(shot.by));
      } else {
        anim[shot.by].pose('swing', facingOf(shot.by));
      }
      anim[otherSide(shot.by)].pose('splitstep', facingOf(otherSide(shot.by)));
    }
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
    const scoreAdvanced = !score || s.seq > score.seq;
    score = s;
    if (scoreAdvanced && (s.lastPointTo || (s.faults ?? 0) > 0)) resetFlow();
    updateHud();
    if (s.seq > 0 && s.seq > lastFlashSeq && s.lastPointTo) {
      lastFlashSeq = s.seq;
      if (mode === 'watch') {
        if (s.winner) {
          flash(`🏆 ${sideName(s.winner)}方 AI 獲勝!`);
          sfx.match(null);
        } else {
          flash(`${sideName(s.lastPointTo)}方得分${isDeuce(s) ? ' — Deuce' : ''}`);
          sfx.point(null);
        }
      } else if (s.winner) {
        flash(s.winner === side ? '🏆 你贏了整場!' : `😢 ${mode === 'ai' ? 'AI' : '對手'}獲勝`);
        sfx.match(s.winner === side);
      } else {
        const mine = s.lastPointTo === side;
        flash(`${mine ? '🎾 你得分!' : `${mode === 'ai' ? 'AI' : '對手'}得分`}${isDeuce(s) ? ' — Deuce' : ''}`);
        sfx.point(mine);
      }
      reactPoint(s.winner ?? s.lastPointTo);
    } else if (s.seq > 0 && s.seq > lastFlashSeq && !s.lastPointTo && (s.faults ?? 0) === 1) {
      // 一發失誤(fault 更新沒有得分者):兩端都跳失誤快報
      lastFlashSeq = s.seq;
      const who =
        mode === 'watch' ? `${sideName(s.server)}方 AI` : s.server === side ? '你' : mode === 'ai' ? 'AI' : '對手';
      flash(`⚠️ ${who}一發失誤,還有第二發`);
      sfx.fault();
      anim[s.server].pose('shrug', facingOf(s.server));
    }
  };

  // 本機模式:直接開局(不用等雲端 null 快照)
  if (mode !== 'online') net.sendScore(initialScore('left'));

  // ── 出球(人與 AI 共用同一公式) ──
  const shoot = (
    by: Side,
    kind: ShotKind,
    x0: number,
    y0: number,
    ownerY: number,
    aim: ShotAim | null,
    quality = 1,
    contactFacing = facingOf(by),
  ) => {
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
      aim,
      quality,
    });
    currentShot = shot;
    const shallow =
      by === 'left' ? shot.x1 < COURT.netX + 300 : shot.x1 > COURT.netX - 300;
    shotLog.push({ by, kind, h: Math.round(ball.h), quality: Number(quality.toFixed(2)), shallow });
    if (shotLog.length > 200) shotLog.shift();
    if (!serving) {
      rallyHits += 1;
      if (by === side) {
        const gain =
          quality >= 0.9 ? 22 : quality >= 0.72 ? 12 : quality >= STRAINED_QUALITY ? 6 : -18;
        const rallyBonus = Math.max(0, Math.min(8, rallyHits - 3));
        momentum = Math.max(0, Math.min(100, momentum + gain + rallyBonus));
        qualityText =
          quality >= 0.9 ? '完美' : quality >= 0.72 ? '扎實' : quality >= STRAINED_QUALITY ? '普通' : '勉強';
        if (quality >= 0.9) energy = Math.min(ENERGY_MAX, energy + 7);
      }
      updateFlowHud();
    }
    // 這一擊如果緊接在自己的閃身之後,代表那次撲救真的把球救回來了(平衡調校用的關鍵指標)
    const pend = pendingDash[by];
    if (pend >= 0) {
      if (aiDashes[pend]) aiDashes[pend].saved = true;
      pendingDash[by] = -1;
    }
    ball.play(shot);
    net.sendShot(shot);
    fxHit(kind, x0, y0);
    // 發球演出(人與 AI 同一套):拋球的上升尾跡 + 擊球瞬間的擴散圈 + 一記震動。
    // 開球是一分的起手式,要跟對打中隨手一擊分得出來。
    if (serving) {
      fx.streak(x0, y0, 0, -110, 0xffe08a); // 拋球:往上竄的一道亮線
      fx.ring(x0, y0 - 90, 0xffe08a); // 球在最高點的那一圈
      fx.burst(x0, y0, 0xffd166); // 擊球瞬間的擴散
      shake = Math.max(shake, 5); // fxHit 已按球種給過震動,發球只保底不疊加
    }
    // 勉強救球與殺球用完整人物 sprite:表情/肢體直接演在角色身上,不用頭頂 emoji。
    if (!serving && quality < STRAINED_QUALITY) anim[by].action('strained', contactFacing);
    else if (!serving && kind === 'smash') anim[by].action('smash', facingOf(by));
    else if (!serving && (kind === 'normal' || kind === 'drive')) {
      const action = contactFacing === facingOf(by) ? 'forehand' : 'backhand';
      anim[by].action(action, facingOf(by));
    } else if (!serving) {
      anim[by].pose('swing', facingOf(by));
    }
    anim[otherSide(by)].pose('splitstep', facingOf(otherSide(by)));
  };

  // ── 鍵盤:揮拍/發球(觀戰模式空白鍵只用來提早再開) ──
  // 球種各自有鍵:空白 = 普通、J = 平抽、K = 挑高、L = 切球;方向鍵/WASD 在揮拍瞬間兼瞄準。
  // 招式:Shift = 閃身;殺球沒有專屬鍵 —— 球夠高時 J 自動升級成殺球(條件觸發才像招式)。
  const held = new Set<string>();
  window.addEventListener('keydown', (e) => {
    sfx.unlock();
    const k = e.key.toLowerCase();
    held.add(k);
    if (k === 'shift') onDash();
    else if (e.key === ' ') onSwing('normal');
    else if (k === 'j') onSwing(canSmash() ? 'smash' : 'drive');
    else if (k === 'k') onSwing('lob');
    else if (k === 'l') onSwing('slice');
    else if (k === '1') setAiLevel('easy');
    else if (k === '2') setAiLevel('normal');
    else if (k === '3') setAiLevel('hard');
    else if (import.meta.env.DEV && k === '6') anim[side].action('forehand', facingOf(side));
    else if (import.meta.env.DEV && k === '7') anim[side].action('backhand', facingOf(side));
    else if (import.meta.env.DEV && k === '8') anim[side].action('strained', -1);
    else if (import.meta.env.DEV && k === '9') anim[side].action('smash', 1);
  });
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
  if (mode === 'ai') flash(`🤖 AI 難度:${LEVEL_NAME[aiLevel]}(按 1 簡單.2 普通.3 困難)`);

  /** 瞄準:揮拍瞬間按住的方向 = 指哪打哪(世界座標,←→ 控深淺、↑↓ 控上下路);沒按 = 不瞄 */
  const humanAim = (): ShotAim | null => {
    const up = held.has('w') || held.has('arrowup');
    const dn = held.has('s') || held.has('arrowdown');
    const lf = held.has('a') || held.has('arrowleft');
    const rt = held.has('d') || held.has('arrowright');
    const aim: ShotAim = {};
    if (up && !dn) aim.y = 275;
    else if (dn && !up) aim.y = 725;
    const xLo = side === 'left' ? 855 : 215; // 對方半場的世界左端/右端(往內縮一點)
    const xHi = side === 'left' ? 1285 : 645;
    if (lf && !rt) aim.x = xLo;
    else if (rt && !lf) aim.x = xHi;
    return aim.x == null && aim.y == null ? null : aim;
  };

  /** 把按住方向形成的戰術意圖直接畫在對方場內，不再只藏在鍵位說明裡。 */
  const updateAimMarker = () => {
    const aim = humanAim();
    const show =
      !!player &&
      !!currentShot &&
      currentShot.by !== side &&
      ball.phase !== 'dead' &&
      !!aim;
    aimMarker.visible = show;
    if (!show || !aim) return;
    const x = aim.x ?? (side === 'left' ? 1070 : 430);
    const y = aim.y ?? 500;
    aimMarker
      .clear()
      .circle(x, y, 24)
      .stroke({ color: 0xffd166, width: 3, alpha: 0.8 })
      .moveTo(x - 34, y)
      .lineTo(x + 34, y)
      .moveTo(x, y - 24)
      .lineTo(x, y + 24)
      .stroke({ color: 0xfff0b3, width: 2, alpha: 0.8 });
  };

  /** 球在拍子可及範圍內(距離 + 高度都要夠);閃身中半徑放大 —— 撲救就是靠這個 */
  const ballHittable = (): boolean =>
    !!player &&
    !!currentShot &&
    currentShot.by !== side &&
    ball.phase !== 'dead' &&
    ball.h <= HIT_H_MAX &&
    Math.hypot(ball.gx - player.x, ball.gy - player.y) <= reachNow();

  /** 殺球條件:球夠高(高球才殺得下去)+ 氣力夠。不符就退回平抽,不擋玩家出手 */
  const canSmash = (): boolean =>
    energy >= COST.smash && ball.phase !== 'dead' && ball.h >= SMASH_MIN_H && ballHittable();

  let swingUntil = 0; // 揮拍判定窗截止時刻(performance.now ms);0 = 沒在揮
  let nextSwingAt = 0; // 冷卻結束時刻
  let pendingKind: ShotKind = 'normal'; // 這次揮拍要打的球種(揮拍鍵決定)

  // ── 招式狀態(本地玩家的那份;AI 各自持有自己的氣力,同價同回充,見 ai-controller) ──
  let energy = ENERGY_MAX;
  let dashLeft = 0; // 衝刺剩餘秒數;>0 = 正在閃身
  let dashVx = 0; // 衝刺速度向量(px/s)
  let dashVy = 0;
  let dashReachLeft = 0; // 拍子加成剩餘秒數(衝刺結束後還延續 DASH_REACH_TAIL)
  let nextDashAt = 0;

  // ── 發球儀式(就位時刻;0 = 這一分還沒就位過) ──
  let serveReadyAt = 0;
  /** 就位後的凝神時間:這段內不准出手,逼出「站定 → 沉住氣 → 開球」的節奏 */
  const SERVE_SETTLE_MS = 450;

  /** 這一刻的拍子可及半徑:閃身中放大 —— 撲救就是靠這個構到平常搆不到的球 */
  const reachNow = (): number => (dashReachLeft > 0 ? RACKET_REACH * DASH_REACH_MUL : RACKET_REACH);

  /** 氣力槽 HUD:條長 + 各招式圖示的可用/不可用狀態(觀戰模式沒氣力槽,整塊藏掉) */
  const moveEls = ['dash', 'smash', 'slice'].map((n) => document.getElementById(`move-${n}`));
  let hudPct = -1;
  const updateEnergyHud = () => {
    if (!energyEl || !energyFillEl) return;
    const show = !!player; // 觀戰模式沒有本地球員 = 沒有氣力概念
    energyEl.style.display = show ? 'flex' : 'none';
    if (!show) return;
    const pct = Math.round((energy / ENERGY_MAX) * 100);
    if (pct === hudPct) return; // 只在真的變動時碰 DOM,免得每幀 layout
    hudPct = pct;
    energyFillEl.style.width = `${pct}%`;
    moveEls.forEach((el, i) => {
      if (!el) return;
      const cost = [COST.dash, COST.smash, COST.slice][i];
      el.classList.toggle('off', energy < cost);
    });
  };

  /** 氣力夠不夠放這一式;不夠就給個悶音,不吃鍵也不罰 */
  const spend = (cost: number): boolean => {
    if (energy < cost) {
      sfx.reject();
      return false;
    }
    energy -= cost;
    return true;
  };

  // ── 發球就位(儀式感第一拍:輪到發球就傳送到位,不用自己走) ──
  /** 這一分該站的發球點(deuce/ad 依局內分數奇偶);沒有比分/沒球員就沒有 */
  const mySpot = (): { x: number; y: number } | null =>
    score && player ? serveSpot(side, serveHalf(side, score)) : null;

  /** 已經站在發球點上(容許一點誤差,免得浮點讓人永遠「還沒就位」) */
  const atServeSpot = (): boolean => {
    const spot = mySpot();
    if (!spot || !player) return false;
    return Math.abs(player.x - spot.x) < 8 && Math.abs(player.y - spot.y) < 8;
  };

  /**
   * 就位:把人傳送到發球點並起算凝神時間。回傳是否真的位移了
   * (本來就站在點上 → 不重播特效,但一樣起算,儀式節奏不會因站位而不同)。
   */
  const toServeSpot = (): boolean => {
    const spot = mySpot();
    if (!spot || !player) return false;
    serveReadyAt = performance.now();
    if (atServeSpot()) return false;
    fx.puff(player.x, player.y); // 原地留一團煙:人是「離開」這裡的
    player.x = spot.x;
    player.y = spot.y;
    dashLeft = 0; // 傳送打斷閃身,免得衝刺速度把人又帶離發球點
    dashReachLeft = 0;
    sfx.dash();
    fx.ring(spot.x, spot.y, 0xffe08a); // 就位落地圈
    fx.puff(spot.x, spot.y);
    anim[side].pose('splitstep', facingOf(side));
    return true;
  };

  /** 閃身瞄準:按住的方向 = 閃向那邊;沒按方向就朝球撲(最常見的意圖) */
  const dashDir = (): { x: number; y: number } => {
    let dx = 0;
    let dy = 0;
    if (held.has('w') || held.has('arrowup')) dy -= 1;
    if (held.has('s') || held.has('arrowdown')) dy += 1;
    if (held.has('a') || held.has('arrowleft')) dx -= 1;
    if (held.has('d') || held.has('arrowright')) dx += 1;
    if (dx === 0 && dy === 0 && player && currentShot && ball.phase !== 'dead') {
      dx = ball.gx - player.x;
      dy = ball.gy - player.y;
    }
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return { x: facingOf(side), y: 0 }; // 真的沒方向:朝網前撲
    return { x: dx / len, y: dy / len };
  };

  /** 閃身:朝指定方向爆衝一小段,期間拍子構得更遠(魚躍撲救) */
  const onDash = (): boolean => {
    if (!player || !score || score.winner) return false;
    const nowMs = performance.now();
    if (nowMs < nextDashAt || dashLeft > 0) return false;
    if (!spend(COST.dash)) return false;
    nextDashAt = nowMs + DASH_COOLDOWN_MS;
    const d = dashDir();
    dashVx = (d.x * DASH_DIST) / DASH_SEC;
    dashVy = (d.y * DASH_DIST) / DASH_SEC;
    dashLeft = DASH_SEC;
    dashReachLeft = DASH_SEC + DASH_REACH_TAIL;
    sfx.dash();
    fx.streak(player.x, player.y, d.x * DASH_DIST, d.y * DASH_DIST);
    fx.puff(player.x, player.y);
    // 傾身方向 = 閃的左右向;純上下閃時用本方朝網方向,免得傾角變 0 看不出動作
    anim[side].pose('dash', Math.abs(d.x) > 0.2 ? Math.sign(d.x) : facingOf(side));
    return true;
  };

  /** 衝刺位移:逐幀推進 + 沿用半場圍欄碰撞(撞牆就停,不會穿到對面半場) */
  const stepDash = (dtSec: number) => {
    if (!player || dashReachLeft <= 0) return;
    dashReachLeft = Math.max(0, dashReachLeft - dtSec);
    if (dashLeft <= 0) return;
    const step = Math.min(dtSec, dashLeft);
    dashLeft -= step;
    const fits = (nx: number, ny: number): boolean => {
      const box: Aabb = {
        x: nx,
        y: ny - player.collider.h / 2,
        w: player.collider.w,
        h: player.collider.h,
      };
      return !colliders.some((c) => aabbOverlap(box, c));
    };
    // x/y 分開推進:撞到圍欄時能沿牆滑,跟引擎的走路手感一致
    const nx = player.x + dashVx * step;
    if (fits(nx, player.y)) player.x = nx;
    else dashVx = 0;
    const ny = player.y + dashVy * step;
    if (fits(player.x, ny)) player.y = ny;
    else dashVy = 0;
  };

  /** 判定窗內每幀試打:球真的碰到拍子(可及範圍)才出手 */
  const trySwingHit = (): boolean => {
    if (!player || !ballHittable()) return false;
    swingUntil = 0;
    const distance = Math.hypot(ball.gx - player.x, ball.gy - player.y);
    const quality = contactQuality({
      distance,
      reach: reachNow(),
      ballH: ball.h,
      dashTail: dashReachLeft > 0 && dashLeft <= 0,
    });
    const contactFacing = Math.sign(ball.gx - player.x) || facingOf(side);
    // 從實際觸拍點出手;瞄準讀「擊中那幀」還按著的方向鍵
    shoot(side, pendingKind, ball.gx, ball.gy, player.y, humanAim(), quality, contactFacing);
    return true;
  };

  /** 再開一場:輸家先發 */
  const restartMatch = () => {
    if (!score?.winner) return;
    watchRestartAt = 0;
    net.clearShot();
    net.sendScore(initialScore(otherSide(score.winner)));
  };

  const onSwing = (kind: ShotKind): boolean => {
    if (!score || !opponent) return false;
    if (score.winner) {
      restartMatch();
      return true;
    }
    if (!player || !racket) return false; // 觀戰模式:比賽中揮拍鍵無作用
    // 招式球要收氣力。發球不給用招式(發球本來就有 serveBox 的規則,再疊招式會失衡)
    const special = SPECIAL_KINDS.includes(kind);
    if (special && !currentShot && score.server === side) {
      sfx.reject();
      return false;
    }
    if (!currentShot && score.server === side) {
      // 發球:不用自己走過去 —— 輪到發球 ticker 就把人傳送到位(見 toServeSpot)。
      // 玩家若自己走離發球點,這裡把他拉回去並重新起算凝神:發球一定從定點開始。
      if (!atServeSpot()) {
        toServeSpot();
        return false;
      }
      const nowMs = performance.now();
      // 凝神:就位後這段時間內按發球鍵不出手 —— 開球有停頓才有份量
      if (serveReadyAt && nowMs - serveReadyAt < SERVE_SETTLE_MS) {
        sfx.reject();
        return false;
      }
      if (nowMs < nextSwingAt) return false; // 冷卻中
      nextSwingAt = nowMs + SWING_COOLDOWN_MS;
      racket.swing();
      shoot(side, kind, player.x, player.y - 20, player.y, null); // 發球:拋球直接出手(落點歸發球散布)
      return true;
    }
    const nowMs = performance.now();
    if (nowMs < nextSwingAt) return false; // 冷卻中
    // 氣力在冷卻檢查之後才收 —— 冷卻中按鍵不該白扣氣力
    if (special && !spend(COST[kind === 'smash' ? 'smash' : 'slice'])) return false;
    nextSwingAt = nowMs + SWING_COOLDOWN_MS;
    pendingKind = kind;
    sfx.swing(); // 風聲:揮空也有回饋,打到再疊擊球聲
    racket.swing();
    // 殺球有專屬的舉拍下壓動作;其餘走一般揮拍帶身
    anim[side].pose(kind === 'smash' ? 'smash' : 'swing', facingOf(side));
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
    // 這一分結束時還沒揭曉的撲救 = 撲了但沒把球救回來,維持 saved:false
    pendingDash.left = -1;
    pendingDash.right = -1;
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

  // ── 觸控操作:手機上直接可玩 ──
  // 只在觸控裝置掛(桌機不該多一層半透明按鈕);觀戰模式沒有本地球員,沒東西可操作也不掛。
  // 觸控只是「另一組按鍵」—— 搖桿寫進同一份 held、動作鍵呼叫同一組 onSwing/onDash,
  // 所以瞄準、招式、冷卻、發球儀式全部與鍵盤共用同一條路徑,不可能兩邊規則漂移。
  // 提示文案要跟著操作方式走:手機上寫「按空白鍵」等於叫玩家找一個不存在的鍵。
  const touchUi = mode !== 'watch' && isTouchDevice();
  if (touchUi) {
    setupTouchControls({
      held,
      setMoveKey: (k, down) => player?.setVirtualKey(k, down),
      onSwing: (k) => void onSwing(k),
      onDash: () => void onDash(),
      canSmash,
    });
  }

  // ── 主迴圈 ──
  // 測試用時間縮放(__tennis.slowmo):只縮 dt 驅動的動畫(揮拍/走路),球飛行走伺服器時鐘不受影響
  let timeScale = 1;
  app.ticker.add((t) => {
    const rawDt = t.deltaMS / 1000;
    const dt = rawDt * timeScale;
    const nowSrv = net.now();
    // 發球就位:輪到自己發球且場上無球 → 自動傳送到發球點(每分只傳一次,傳完就交還操控權,
    // 玩家想在框內微調站位仍然可以走)。這是儀式的第一拍,不用玩家自己走過去。
    if (player && score && !score.winner && !currentShot && score.server === side) {
      if (!serveReadyAt) toServeSpot();
    } else if (serveReadyAt) {
      serveReadyAt = 0; // 球開出去/換人發球:這一分的儀式結束,下一分重新就位
    }
    if (player) {
      player.update(dt, colliders);
      stepDash(dt); // 閃身位移疊在一般走位之上(衝刺期間仍可微調方向)
      net.push({ x: player.x, y: player.y, dir: player.dir });
    }
    // 氣力回復:比賽進行中才回,分數結算/勝利畫面不累積
    if (energy < ENERGY_MAX) energy = Math.min(ENERGY_MAX, energy + ENERGY_REGEN * dt);
    updateEnergyHud();
    updateFlowHud();
    updateAimMarker();
    remote?.update(dt);

    const prevPhase = ball.phase;
    const phase = ball.update(nowSrv);
    // 落地回饋:flying → bounce 的那幀(掛網墜地同樣走這條,悶響也合)
    if (prevPhase === 'flying' && phase === 'bounce') {
      sfx.bounce();
      fx.puff(ball.gx, ball.gy);
    }
    fx.update(rawDt); // 特效走真實時間:slowmo 只慢角色動畫,puff 圈不會被拉長掛在畫面上
    anim.left.update(dt);
    anim.right.update(dt);
    if (racket) racket.view.visible = !anim[side].acting;
    if (remoteRacket) remoteRacket.view.visible = !!remote && !anim[oppo].acting;
    for (const ai of ais) ai.racket.view.visible = !anim[ai.ctl.side].acting;
    // 畫面震動:在鏡頭基準位置上加抖動,指數衰減
    if (shake > 0.4) {
      built.root.x = rootBase.x + (Math.random() * 2 - 1) * shake;
      built.root.y = rootBase.y + (Math.random() * 2 - 1) * shake;
      shake *= Math.exp(-dt * 14);
    } else if (shake !== 0) {
      shake = 0;
      built.root.x = rootBase.x;
      built.root.y = rootBase.y;
    }
    // 揮拍判定窗:窗內每幀試打(球飛進拍子範圍的那幀出手)
    if (swingUntil > 0) {
      if (performance.now() <= swingUntil) trySwingHit();
      else swingUntil = 0;
    }
    if (player && racket) {
      // 揮拍轉體:引拍背向側身 → 擊球面向側身 → 收拍轉正(dir 會隨 net.push 同步給對面)
      const sd = racket.swingDir;
      if (sd) player.face(sd);
      racket.update(dt, player.x, player.y, player.dir);
    }
    if (remoteRacket) {
      if (remote) remoteRacket.update(dt, remote.view.x, remote.view.y, remote.dir);
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
      // 對手位置(瞄空檔用):ai 模式是玩家,watch 模式是另一隻 AI
      const foe = player ?? ais.find((a) => a.ctl.side !== ai.ctl.side)?.ctl;
      const intent = ai.ctl.tick(dt, {
        shot: currentShot,
        ballX: ball.gx,
        ballY: ball.gy,
        ballH: ball.h,
        ballPhase: ball.phase,
        score,
        now: nowSrv,
        oppoX: foe?.x ?? 750,
        oppoY: foe?.y ?? 500,
      });
      const aiDir = ai.racket.swingDir ?? ai.ctl.dir; // 揮拍轉體優先於移動朝向
      ai.body.onUpdate({ id: `ai-${ai.ctl.side}`, x: ai.ctl.x, y: ai.ctl.y, dir: aiDir, ts: nowSrv });
      ai.body.update(dt);
      ai.racket.update(dt, ai.body.view.x, ai.body.view.y, aiDir);
      if (intent) {
        if (intent.type === 'dash') {
          // 閃身撲救:走跟玩家同一套呈現(殘影 + 塵土 + 音效 + 傾身)
          aiDashes.push({
            side: ai.ctl.side,
            dx: Math.round(intent.dx),
            dy: Math.round(intent.dy),
            saved: false,
          });
          pendingDash[ai.ctl.side] = aiDashes.length - 1; // 這一撲有沒有救到,等下一次出手揭曉
          sfx.dash();
          fx.streak(ai.ctl.x, ai.ctl.y, intent.dx, intent.dy);
          fx.puff(ai.ctl.x, ai.ctl.y);
          anim[ai.ctl.side].pose(
            'dash',
            Math.abs(intent.dx) > 0.2 ? Math.sign(intent.dx) : facingOf(ai.ctl.side),
          );
        } else if (intent.type === 'teleport') {
          // 發球就位:位置已由 controller 套用,這裡只播跟玩家同一套的就位演出
          sfx.dash();
          fx.ring(intent.x, intent.y, 0xffe08a);
          fx.puff(intent.x, intent.y);
          anim[ai.ctl.side].pose('splitstep', facingOf(ai.ctl.side));
        } else {
          ai.racket.swing();
          if (intent.type === 'serve') shoot(ai.ctl.side, intent.kind, ai.ctl.x, ai.ctl.y - 20, ai.ctl.y, null);
          else {
            const contactFacing = Math.sign(intent.x0 - ai.ctl.x) || facingOf(ai.ctl.side);
            shoot(
              ai.ctl.side,
              intent.kind,
              intent.x0,
              intent.y0,
              ai.ctl.y,
              intent.aim,
              intent.quality,
              contactFacing,
            );
          }
        }
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
      if (score.winner) hint = touchUi ? '點「擊球」再來一場' : '按空白鍵再來一場';
      else if (!currentShot && score.server === side) {
        // 發球提示:站位半區 + 第幾發。人已自動就位,所以只在「凝神中」與「可出手」間切換
        const half = serveHalf(side, score);
        const nth = (score.faults ?? 0) > 0 ? '第二發' : '第一發';
        const box = `${half === 'top' ? '上' : '下'}半區`;
        const settling = !atServeSpot() || (serveReadyAt && performance.now() - serveReadyAt < SERVE_SETTLE_MS);
        hint = settling
          ? `${nth}:${box}就位中…調整呼吸`
          : touchUi
            ? `${nth}(${box}):點「擊球」發球(「抽」平抽發.「挑」挑高發),要落進對角發球區`
            : `${nth}(${box}):空白鍵發球(J 平抽發.K 挑高發),要落進對角發球區`;
      } else if (currentShot && currentShot.by !== side && ball.phase !== 'dead') {
        const d = Math.hypot(ball.gx - player.x, ball.gy - player.y);
        if (d <= RACKET_REACH * 1.6) {
          // 球高到可以殺、氣力也夠 → 直接喊出來,不然玩家不會知道 J 這時候變殺球
          hint = canSmash()
            ? (touchUi ? '🔥 可以殺球!點「抽」灌下去' : '🔥 可以殺球!按 J 灌下去')
            : ball.h > HIT_H_MAX
              ? '球太高了!等它降下來再揮'
              : touchUi
                ? '點「擊球」!「抽」平抽.「挑」挑高.「切」切球|「閃」閃身|推搖桿瞄準'
                : '空白揮拍!J 平抽.K 挑高.L 切球|Shift 閃身|按住方向鍵瞄準';
        } else if (d <= RACKET_REACH * 3 && energy >= COST.dash) {
          hint = touchUi ? '搆不到?點「閃」撲救(耗氣力)' : '搆不到?按 Shift 閃身撲救(耗氣力)';
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
    sfxReady: () => sfx.ready,
    fxCount: () => fx.count,
    aiLevel: () => aiLevel,
    setAiLevel: (l: AiLevel) => setAiLevel(l),
    aiAtNet: () => ais.map((a) => ({ side: a.ctl.side, atNet: a.ctl.atNet })),
    /** 驗收用:出手球種紀錄 / AI 閃身紀錄 */
    shots: () => shotLog.slice(),
    aiDashes: () => aiDashes.slice(),
    clearLog: () => {
      shotLog.length = 0;
      aiDashes.length = 0;
    },
    /** 發球儀式驗收用:該站哪、實際站哪、有沒有就位、凝神還剩多久 */
    serveState: () => {
      const spot = mySpot();
      const settleLeft = serveReadyAt ? Math.max(0, SERVE_SETTLE_MS - (performance.now() - serveReadyAt)) : 0;
      return {
        server: score?.server ?? null,
        mine: !!score && score.server === side,
        half: score ? serveHalf(side, score) : null,
        spot,
        pos: player ? { x: Math.round(player.x), y: Math.round(player.y) } : null,
        atSpot: atServeSpot(),
        settleLeft: Math.round(settleLeft),
      };
    },
    /** AI 招式驗收用:氣力與可及半徑(閃身中會放大) */
    aiEnergy: () =>
      ais.map((a) => ({
        side: a.ctl.side,
        energy: Math.round(a.ctl.energyNow),
        reach: Math.round(a.ctl.reach),
      })),
    emoteTest: (s: Side) => {
      anim[s].pose('celebrate', facingOf(s));
    },
    poseTest: (s: Side, kind: PoseKind) => anim[s].pose(kind, facingOf(s)),
    actionTest: (s: Side, kind: 'strained' | 'smash' | 'forehand' | 'backhand', facing = facingOf(s)) =>
      anim[s].action(kind, facing),
    acting: (s: Side) => anim[s].acting,
    pos: () => (player ? { x: Math.round(player.x), y: Math.round(player.y) } : null),
    ais: () => ais.map((a) => ({ side: a.ctl.side, x: Math.round(a.ctl.x), y: Math.round(a.ctl.y) })),
    teleport: (x: number, y: number) => {
      if (player) {
        player.x = x;
        player.y = y;
      }
    },
    swing: (kind: ShotKind = 'normal') => onSwing(kind),
    slowmo: (f: number) => {
      timeScale = f;
    },
    /** 招式驗收用:氣力/冷卻/可及半徑的當下狀態 */
    energy: () => ({
      value: Math.round(energy),
      max: ENERGY_MAX,
      cost: COST,
      reach: Math.round(reachNow()),
      dashing: dashLeft > 0,
      dashReach: dashReachLeft > 0,
      canSmash: canSmash(),
      momentum: Math.round(momentum),
      rallyHits,
      qualityText,
    }),
    /** 測試用:直接放閃身(方向沿用 held 方向鍵/朝球),回傳有沒有真的放出去 */
    dash: () => onDash(),
    /** 測試用:把氣力設成指定值(驗不足時被擋、足時能放) */
    setEnergy: (v: number) => {
      energy = Math.max(0, Math.min(ENERGY_MAX, v));
      hudPct = -1; // 強制下一幀重畫 HUD
    },
    /** 測試用:模擬按住方向鍵(下次 humanAim 讀得到) */
    holdKey: (k: string, down: boolean) => (down ? held.add(k) : held.delete(k)),
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
