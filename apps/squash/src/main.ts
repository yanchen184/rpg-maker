import { loadFrames, loadManifest, setAssetBase } from '@rpg-maker/engine';
import {
  AnimatedSprite,
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  type Texture,
} from 'pixi.js';
import {
  aiServeTarget,
  clearAiMemory,
  createAiMemory,
  decideAi,
  moveAi,
  rememberAiDecision,
  type AiLevel,
} from './ai';
import { SquashCharacterAnim, type SquashAction } from './character-anim';
import {
  BACK_OUT_HEIGHT,
  COURT_LENGTH,
  COURT_WIDTH,
  FRONT_OUT_HEIGHT,
  SERVICE_LINE_HEIGHT,
  SHORT_LINE_Y,
  TIN_HEIGHT,
  clamp,
  distance,
  otherPlayer,
  type CourtPlayer,
  type PlayerId,
  type ShotKind,
} from './game-types';
import { SquashBall, type BallEvent } from './physics';
import { SquashSfx } from './sfx';

void (async () => {
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const PLAYER_SPEED = 3.85;
const DASH_SPEED = 7.6;
const DASH_COST = 28;
const ENERGY_REGEN_PER_SECOND = 20;
const HIT_REACH = 1.28;
const HIT_HEIGHT = 1.6;
const SWING_COOLDOWN_MS = 430;
const CONTACT_DELAY_MS = (6 / 36) * 1000;
const POINT_PAUSE_MS = 1900;
const MIN_PLAYER_SEPARATION = 0.94;
const T_X = 0;
const T_Y = 5.55;

interface PendingHit {
  by: PlayerId;
  kind: ShotKind;
  targetX: number;
  quality: number;
  pace: number;
  fireAt: number;
  serving: boolean;
}

interface Impact {
  x: number;
  y: number;
  color: number;
  age: number;
  life: number;
  wall: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
}

const appRoot = document.querySelector<HTMLDivElement>('#app')!;
const pointsLeftEl = document.querySelector<HTMLElement>('#points-left')!;
const pointsRightEl = document.querySelector<HTMLElement>('#points-right')!;
const leftNameEl = document.querySelector<HTMLElement>('#left-name')!;
const rightNameEl = document.querySelector<HTMLElement>('#right-name')!;
const scoreMetaEl = document.querySelector<HTMLElement>('#score-meta')!;
const modeBadgeEl = document.querySelector<HTMLElement>('#mode-badge')!;
const energyFillEl = document.querySelector<HTMLElement>('#energy-fill')!;
const energyValueEl = document.querySelector<HTMLElement>('#energy-value')!;
const qualityFillEl = document.querySelector<HTMLElement>('#quality-fill')!;
const qualityLabelEl = document.querySelector<HTMLElement>('#quality-label')!;
const rallyEl = document.querySelector<HTMLElement>('#rally')!;
const tControlEl = document.querySelector<HTMLElement>('#t-control')!;
const strategyFeedEl = document.querySelector<HTMLElement>('#strategy-feed')!;
const flashEl = document.querySelector<HTMLElement>('#flash')!;
const loadingEl = document.querySelector<HTMLElement>('#loading')!;

setAssetBase(import.meta.env.BASE_URL);

const app = new Application();
await app.init({
  resizeTo: window,
  background: 0x071016,
  antialias: false,
  resolution: 1,
  autoDensity: false,
});
appRoot.appendChild(app.canvas);

const root = new Container();
root.sortableChildren = true;
app.stage.addChild(root);

function resizeStage(): void {
  const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  root.scale.set(scale);
  root.x = (window.innerWidth - DESIGN_WIDTH * scale) / 2;
  root.y = (window.innerHeight - DESIGN_HEIGHT * scale) / 2;
}
resizeStage();
window.addEventListener('resize', resizeStage);

interface Projected {
  x: number;
  y: number;
  scale: number;
}

function project(worldX: number, worldY: number, height = 0): Projected {
  const depth = clamp(worldY / COURT_LENGTH, 0, 1);
  const halfWidth = 370 + depth * 160;
  const floorY = 310 + depth * 330;
  const heightScale = 55 - depth * 10;
  return {
    x: DESIGN_WIDTH / 2 + (worldX / (COURT_WIDTH / 2)) * halfWidth,
    y: floorY - height * heightScale,
    scale: 0.36 + depth * 0.17,
  };
}

const manifest = await loadManifest();
const [arenaTexture, frontWallTexture, sideWallTexture, floorTexture, glassTexture, crowdFrames] = await Promise.all([
  Assets.load<Texture>(`${import.meta.env.BASE_URL}environment/squash-arena-crowd.png`),
  Assets.load<Texture>(`${import.meta.env.BASE_URL}environment/squash-front-wall.png`),
  Assets.load<Texture>(`${import.meta.env.BASE_URL}environment/squash-side-wall.png`),
  Assets.load<Texture>(`${import.meta.env.BASE_URL}environment/squash-maple-floor.png`),
  Assets.load<Texture>(`${import.meta.env.BASE_URL}environment/squash-glass-reflections.png`),
  loadFrames('crowd-squash-animated', manifest.assets['crowd-squash-animated']),
]);
arenaTexture.source.scaleMode = 'nearest';
frontWallTexture.source.scaleMode = 'nearest';
sideWallTexture.source.scaleMode = 'nearest';
floorTexture.source.scaleMode = 'nearest';
glassTexture.source.scaleMode = 'nearest';

const arenaLayer = new Container();
arenaLayer.zIndex = -200;
root.addChild(arenaLayer);
const arenaBackdrop = new Sprite(arenaTexture);
arenaBackdrop.width = DESIGN_WIDTH;
arenaBackdrop.height = DESIGN_HEIGHT;
arenaBackdrop.alpha = 0.92;
arenaLayer.addChild(arenaBackdrop);

interface CrowdActor {
  sprite: AnimatedSprite;
  baseFrames: Texture[];
  excitedFrames: Texture[];
  excited: boolean;
  baseFps: number;
}

const crowdActors: CrowdActor[] = [];
const crowdPlacements = [
  { x: 126, y: 268, scale: 0.44, row: 0, excitedRow: 2, phase: 0 },
  { x: 1154, y: 268, scale: 0.44, row: 1, excitedRow: 2, phase: 3 },
  { x: 96, y: 486, scale: 0.38, row: 1, excitedRow: 3, phase: 1 },
  { x: 1184, y: 486, scale: 0.38, row: 0, excitedRow: 3, phase: 4 },
] as const;
for (const placement of crowdPlacements) {
  const baseFrames = crowdFrames.slice(placement.row * 6, placement.row * 6 + 6);
  const excitedFrames = crowdFrames.slice(placement.excitedRow * 6, placement.excitedRow * 6 + 6);
  const sprite = new AnimatedSprite(baseFrames);
  sprite.anchor.set(0.5, 1);
  sprite.position.set(placement.x, placement.y);
  sprite.scale.set(placement.scale);
  sprite.animationSpeed = 7 / 60;
  sprite.gotoAndPlay(placement.phase);
  arenaLayer.addChild(sprite);
  crowdActors.push({ sprite, baseFrames, excitedFrames, excited: false, baseFps: 7 });
}

const venueTextureLayer = new Container();
venueTextureLayer.zIndex = -20;
root.addChild(venueTextureLayer);

function addMaskedTexture(
  texture: Texture,
  bounds: { x: number; y: number; width: number; height: number },
  points: number[],
  alpha: number,
): Sprite {
  const sprite = new Sprite(texture);
  sprite.position.set(bounds.x, bounds.y);
  sprite.width = bounds.width;
  sprite.height = bounds.height;
  sprite.alpha = alpha;
  const mask = new Graphics().poly(points).fill({ color: 0xffffff });
  venueTextureLayer.addChild(sprite, mask);
  sprite.mask = mask;
  return sprite;
}

const frontLeftFloor = project(-COURT_WIDTH / 2, 0);
const frontRightFloor = project(COURT_WIDTH / 2, 0);
const backLeftFloor = project(-COURT_WIDTH / 2, COURT_LENGTH);
const backRightFloor = project(COURT_WIDTH / 2, COURT_LENGTH);
const frontTopLeftPoint = project(-COURT_WIDTH / 2, 0, FRONT_OUT_HEIGHT);
const frontTopRightPoint = project(COURT_WIDTH / 2, 0, FRONT_OUT_HEIGHT);
const backTopLeftPoint = project(-COURT_WIDTH / 2, COURT_LENGTH, BACK_OUT_HEIGHT);
const backTopRightPoint = project(COURT_WIDTH / 2, COURT_LENGTH, BACK_OUT_HEIGHT);
const tinTopLeftPoint = project(-COURT_WIDTH / 2, 0, TIN_HEIGHT);
const tinTopRightPoint = project(COURT_WIDTH / 2, 0, TIN_HEIGHT);

addMaskedTexture(
  frontWallTexture,
  {
    x: frontTopLeftPoint.x,
    y: frontTopLeftPoint.y,
    width: frontTopRightPoint.x - frontTopLeftPoint.x,
    height: frontLeftFloor.y - frontTopLeftPoint.y,
  },
  [
    frontTopLeftPoint.x, frontTopLeftPoint.y,
    frontTopRightPoint.x, frontTopRightPoint.y,
    frontRightFloor.x, frontRightFloor.y,
    frontLeftFloor.x, frontLeftFloor.y,
  ],
  1,
);
addMaskedTexture(
  floorTexture,
  {
    x: backLeftFloor.x,
    y: frontLeftFloor.y,
    width: backRightFloor.x - backLeftFloor.x,
    height: backLeftFloor.y - frontLeftFloor.y,
  },
  [
    frontLeftFloor.x, frontLeftFloor.y,
    frontRightFloor.x, frontRightFloor.y,
    backRightFloor.x, backRightFloor.y,
    backLeftFloor.x, backLeftFloor.y,
  ],
  0.96,
);
const tinTexture = addMaskedTexture(
  frontWallTexture,
  {
    x: tinTopLeftPoint.x,
    y: tinTopLeftPoint.y,
    width: tinTopRightPoint.x - tinTopLeftPoint.x,
    height: frontLeftFloor.y - tinTopLeftPoint.y,
  },
  [
    tinTopLeftPoint.x, tinTopLeftPoint.y,
    tinTopRightPoint.x, tinTopRightPoint.y,
    frontRightFloor.x, frontRightFloor.y,
    frontLeftFloor.x, frontLeftFloor.y,
  ],
  0.82,
);
tinTexture.tint = 0xd95f52;
const leftWallTexture = addMaskedTexture(
  sideWallTexture,
  { x: backLeftFloor.x, y: frontTopLeftPoint.y, width: frontLeftFloor.x - backLeftFloor.x, height: backLeftFloor.y - frontTopLeftPoint.y },
  [
    frontTopLeftPoint.x, frontTopLeftPoint.y,
    frontLeftFloor.x, frontLeftFloor.y,
    backLeftFloor.x, backLeftFloor.y,
    backTopLeftPoint.x, backTopLeftPoint.y,
  ],
  0.96,
);
const rightWallTexture = addMaskedTexture(
  sideWallTexture,
  { x: frontRightFloor.x, y: frontTopRightPoint.y, width: backRightFloor.x - frontRightFloor.x, height: backRightFloor.y - frontTopRightPoint.y },
  [
    frontTopRightPoint.x, frontTopRightPoint.y,
    frontRightFloor.x, frontRightFloor.y,
    backRightFloor.x, backRightFloor.y,
    backTopRightPoint.x, backTopRightPoint.y,
  ],
  0.96,
);
const backGlassTexture = addMaskedTexture(
  glassTexture,
  {
    x: backTopLeftPoint.x,
    y: backTopLeftPoint.y,
    width: backTopRightPoint.x - backTopLeftPoint.x,
    height: backLeftFloor.y - backTopLeftPoint.y,
  },
  [
    backTopLeftPoint.x, backTopLeftPoint.y,
    backTopRightPoint.x, backTopRightPoint.y,
    backRightFloor.x, backRightFloor.y,
    backLeftFloor.x, backLeftFloor.y,
  ],
  0.25,
);

const rearGlassLayer = new Container();
rearGlassLayer.zIndex = 66;
root.addChild(rearGlassLayer);
const rearGlassReflection = new Sprite(glassTexture);
rearGlassReflection.position.set(backLeftFloor.x, 500);
rearGlassReflection.width = backRightFloor.x - backLeftFloor.x;
rearGlassReflection.height = 220;
rearGlassReflection.alpha = 0.13;
rearGlassLayer.addChild(rearGlassReflection);
const rearGlassFrame = new Graphics();
rearGlassFrame
  .rect(backLeftFloor.x, 516, backRightFloor.x - backLeftFloor.x, 204)
  .fill({ color: 0x6ddcf4, alpha: 0.025 })
  .stroke({ color: 0xa8efff, width: 2, alpha: 0.48 })
  .moveTo(backLeftFloor.x, 640)
  .lineTo(backRightFloor.x, 640)
  .stroke({ color: 0xbdf5ff, width: 3, alpha: 0.5 })
  .moveTo(backLeftFloor.x, 706)
  .lineTo(backRightFloor.x, 706)
  .stroke({ color: 0x8de9ff, width: 8, alpha: 0.58 });
for (const panelX of [backLeftFloor.x, 410, 640, 870, backRightFloor.x]) {
  rearGlassFrame
    .moveTo(panelX, 516)
    .lineTo(panelX, 720)
    .stroke({ color: 0xa6f1ff, width: panelX === 640 ? 4 : 2, alpha: panelX === 640 ? 0.64 : 0.42 });
}
for (const fixtureX of [410, 640, 870]) {
  rearGlassFrame
    .rect(fixtureX - 9, 626, 18, 28)
    .fill({ color: 0x071016, alpha: 0.82 })
    .stroke({ color: 0xa8efff, width: 2, alpha: 0.62 });
}
rearGlassLayer.addChild(rearGlassFrame);

const ambientLayer = new Container();
ambientLayer.zIndex = 70;
root.addChild(ambientLayer);
const ambientGraphics = new Graphics();
const glassPulseGraphics = new Graphics();
ambientLayer.addChild(ambientGraphics, glassPulseGraphics);
glassPulseGraphics
  .moveTo(backTopLeftPoint.x, backTopLeftPoint.y)
  .lineTo(backTopRightPoint.x, backTopRightPoint.y)
  .lineTo(backRightFloor.x, backRightFloor.y)
  .lineTo(backLeftFloor.x, backLeftFloor.y)
  .closePath()
  .stroke({ color: 0xc5f8ff, width: 4, alpha: 0.82 });
glassPulseGraphics.blendMode = 'add';
glassPulseGraphics.alpha = 0;

const courtLayer = new Container();
courtLayer.zIndex = 0;
root.addChild(courtLayer);

function line(graphics: Graphics, points: number[], color: number, width: number, alpha = 1): void {
  graphics.moveTo(points[0], points[1]);
  for (let index = 2; index < points.length; index += 2) {
    graphics.lineTo(points[index], points[index + 1]);
  }
  graphics.stroke({ color, width, alpha });
}

function drawCourt(): void {
  const graphics = new Graphics();
  const frontLeft = project(-COURT_WIDTH / 2, 0);
  const frontRight = project(COURT_WIDTH / 2, 0);
  const backLeft = project(-COURT_WIDTH / 2, COURT_LENGTH);
  const backRight = project(COURT_WIDTH / 2, COURT_LENGTH);
  const frontTopLeft = project(-COURT_WIDTH / 2, 0, FRONT_OUT_HEIGHT);
  const frontTopRight = project(COURT_WIDTH / 2, 0, FRONT_OUT_HEIGHT);
  const backTopLeft = project(-COURT_WIDTH / 2, COURT_LENGTH, BACK_OUT_HEIGHT);
  const backTopRight = project(COURT_WIDTH / 2, COURT_LENGTH, BACK_OUT_HEIGHT);

  graphics
    .poly([
      frontTopLeft.x, frontTopLeft.y,
      frontTopRight.x, frontTopRight.y,
      frontRight.x, frontRight.y,
      frontLeft.x, frontLeft.y,
    ])
    .fill({ color: 0x173b49, alpha: 0.12 })
    .stroke({ color: 0x8de9ff, width: 2, alpha: 0.72 });

  graphics
    .poly([
      frontLeft.x, frontLeft.y,
      frontRight.x, frontRight.y,
      backRight.x, backRight.y,
      backLeft.x, backLeft.y,
    ])
    .fill({ color: 0xd8cba4, alpha: 0.08 })
    .stroke({ color: 0xeaffff, width: 2, alpha: 0.66 });

  graphics
    .poly([
      frontTopLeft.x, frontTopLeft.y,
      frontLeft.x, frontLeft.y,
      backLeft.x, backLeft.y,
      backTopLeft.x, backTopLeft.y,
    ])
    .fill({ color: 0x2f7184, alpha: 0.08 })
    .stroke({ color: 0x7ae6ff, width: 2, alpha: 0.5 });
  graphics
    .poly([
      frontTopRight.x, frontTopRight.y,
      frontRight.x, frontRight.y,
      backRight.x, backRight.y,
      backTopRight.x, backTopRight.y,
    ])
    .fill({ color: 0x2f7184, alpha: 0.08 })
    .stroke({ color: 0x7ae6ff, width: 2, alpha: 0.5 });

  graphics
    .poly([
      backTopLeft.x, backTopLeft.y,
      backTopRight.x, backTopRight.y,
      backRight.x, backRight.y,
      backLeft.x, backLeft.y,
    ])
    .fill({ color: 0x96edff, alpha: 0.03 })
    .stroke({ color: 0xcaf7ff, width: 2, alpha: 0.48 });

  const tinTopLeft = project(-COURT_WIDTH / 2, 0, TIN_HEIGHT);
  const tinTopRight = project(COURT_WIDTH / 2, 0, TIN_HEIGHT);
  graphics
    .poly([
      tinTopLeft.x, tinTopLeft.y,
      tinTopRight.x, tinTopRight.y,
      frontRight.x, frontRight.y,
      frontLeft.x, frontLeft.y,
    ])
    .fill({ color: 0xb53a38, alpha: 0.22 });
  line(graphics, [tinTopLeft.x, tinTopLeft.y, tinTopRight.x, tinTopRight.y], 0xff8c78, 3, 0.95);

  const serviceWallLeft = project(-COURT_WIDTH / 2, 0, 1.78);
  const serviceWallRight = project(COURT_WIDTH / 2, 0, 1.78);
  line(graphics, [serviceWallLeft.x, serviceWallLeft.y, serviceWallRight.x, serviceWallRight.y], 0xd8faff, 2, 0.68);

  const shortLeft = project(-COURT_WIDTH / 2, 5.44);
  const shortRight = project(COURT_WIDTH / 2, 5.44);
  line(graphics, [shortLeft.x, shortLeft.y, shortRight.x, shortRight.y], 0xffffff, 2, 0.7);
  const centerShort = project(0, 5.44);
  const centerBack = project(0, COURT_LENGTH);
  line(graphics, [centerShort.x, centerShort.y, centerBack.x, centerBack.y], 0xffffff, 2, 0.68);

  const serviceBoxBackY = 5.44 + 1.6;
  for (const side of [-1, 1]) {
    const boxInnerFront = project(side * (COURT_WIDTH / 2 - 1.6), 5.44);
    const boxInnerBack = project(side * (COURT_WIDTH / 2 - 1.6), serviceBoxBackY);
    const boxOuterBack = project(side * COURT_WIDTH / 2, serviceBoxBackY);
    line(
      graphics,
      [
        boxInnerFront.x, boxInnerFront.y,
        boxInnerBack.x, boxInnerBack.y,
        boxOuterBack.x, boxOuterBack.y,
      ],
      0xffffff,
      2,
      0.68,
    );
  }

  const t = project(T_X, T_Y);
  graphics.circle(t.x, t.y, 34).stroke({ color: 0xffc857, width: 2, alpha: 0.5 });
  graphics.circle(t.x, t.y, 5).fill({ color: 0xffc857, alpha: 0.7 });

  line(graphics, [frontTopLeft.x, frontTopLeft.y, backTopLeft.x, backTopLeft.y], 0xffcbd4, 3, 0.72);
  line(graphics, [frontTopRight.x, frontTopRight.y, backTopRight.x, backTopRight.y], 0xffcbd4, 3, 0.72);
  courtLayer.addChild(graphics);
}
drawCourt();

const [
  blueActionFrames,
  blueBackhandFrames,
  blueGlassFrames,
  blueLoopFrames,
  blueReactionFrames,
  goldActionFrames,
  goldBackhandFrames,
  goldGlassFrames,
  goldLoopFrames,
  goldReactionFrames,
] = await Promise.all([
  loadFrames('char-squash-blue-actions', manifest.assets['char-squash-blue-actions']),
  loadFrames('char-squash-blue-backhand', manifest.assets['char-squash-blue-backhand']),
  loadFrames('char-squash-blue-glass', manifest.assets['char-squash-blue-glass']),
  loadFrames('char-squash-blue-loops', manifest.assets['char-squash-blue-loops']),
  loadFrames('char-squash-blue-reactions', manifest.assets['char-squash-blue-reactions']),
  loadFrames('char-squash-gold-actions', manifest.assets['char-squash-gold-actions']),
  loadFrames('char-squash-gold-backhand', manifest.assets['char-squash-gold-backhand']),
  loadFrames('char-squash-gold-glass', manifest.assets['char-squash-gold-glass']),
  loadFrames('char-squash-gold-loops', manifest.assets['char-squash-gold-loops']),
  loadFrames('char-squash-gold-reactions', manifest.assets['char-squash-gold-reactions']),
]);

const blueAnimationAssets = {
  actions: blueActionFrames,
  backhand: blueBackhandFrames,
  glass: blueGlassFrames,
  rearLoops: blueLoopFrames,
  reactions: blueReactionFrames,
};
const goldAnimationAssets = {
  actions: goldActionFrames,
  backhand: goldBackhandFrames,
  glass: goldGlassFrames,
  rearLoops: goldLoopFrames,
  reactions: goldReactionFrames,
};

const actorLayer = new Container();
actorLayer.sortableChildren = true;
actorLayer.zIndex = 20;
root.addChild(actorLayer);

const humanAnim = new SquashCharacterAnim(blueAnimationAssets, 0xffffff);
const aiAnim = new SquashCharacterAnim(goldAnimationAssets, 0xffffff);
actorLayer.addChild(humanAnim.view, aiAnim.view);

const ballLayer = new Container();
ballLayer.zIndex = 40;
root.addChild(ballLayer);
const trailGraphics = new Graphics();
const ballShadow = new Graphics();
const ballGraphics = new Graphics();
ballLayer.addChild(trailGraphics, ballShadow, ballGraphics);

const impactLayer = new Container();
impactLayer.zIndex = 60;
root.addChild(impactLayer);
const impactGraphics = new Graphics();
impactLayer.addChild(impactGraphics);

const aimLayer = new Container();
aimLayer.zIndex = 15;
root.addChild(aimLayer);
const aimGraphics = new Graphics();
const serveGuideGraphics = new Graphics();
aimLayer.addChild(serveGuideGraphics, aimGraphics);

const landingLayer = new Container();
landingLayer.zIndex = 12;
root.addChild(landingLayer);
const landingGraphics = new Graphics();
const landingLabel = new Text({
  text: '落點',
  style: new TextStyle({
    fill: 0xdffff5,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '800',
    stroke: { color: 0x031015, width: 4 },
  }),
});
landingLabel.anchor.set(0.5, 1);
landingLayer.addChild(landingGraphics, landingLabel);

const wallPredictionLayer = new Container();
wallPredictionLayer.zIndex = 18;
root.addChild(wallPredictionLayer);
const wallShadowGraphics = new Graphics();
wallPredictionLayer.addChild(wallShadowGraphics);

const players: Record<PlayerId, CourtPlayer> = {
  you: {
    id: 'you',
    x: -0.85,
    y: 7.25,
    energy: 100,
    lastSwingAt: -Infinity,
    dashUntil: 0,
    dashTailUntil: 0,
    facing: 1,
  },
  ai: {
    id: 'ai',
    x: 0.8,
    y: 5.35,
    energy: 100,
    lastSwingAt: -Infinity,
    dashUntil: 0,
    dashTailUntil: 0,
    facing: -1,
  },
};

const ball = new SquashBall();
const sfx = new SquashSfx();
const held = new Set<string>();
const pendingHits: Partial<Record<PlayerId, PendingHit>> = {};
const scores: Record<PlayerId, number> = { you: 0, ai: 0 };
const aiMemories = {
  you: createAiMemory(),
  ai: createAiMemory(),
};
const impacts: Impact[] = [];
const trail: TrailPoint[] = [];
type GameMode = 'play' | 'watch';
let gameMode: GameMode = 'play';
let aiLevel: AiLevel = 'normal';
let ballSpeed = 1;
let gameNow = performance.now();
let server: PlayerId = 'you';
let serveSide: -1 | 1 = -1;
let rally = 0;
let targetWallX = -1.2;
let lastQuality = 1;
let pointPauseUntil = 0;
let nextServeAt = 0;
let matchWinner: PlayerId | null = null;
let flashTimer = 0;
let crowdExcitedUntil = 0;
let lastStrategy = '雙方試探站位';

function playerAnim(id: PlayerId): SquashCharacterAnim {
  return id === 'you' ? humanAnim : aiAnim;
}

function resetRally(now: number): void {
  const servingPlayer = players[server];
  const receivingPlayer = players[otherPlayer(server)];
  servingPlayer.x = serveSide * 2.35;
  servingPlayer.y = 6.2;
  servingPlayer.facing = -serveSide;
  receivingPlayer.x = -serveSide * 1.2;
  receivingPlayer.y = 7.65;
  receivingPlayer.facing = serveSide;
  players.you.energy = Math.max(players.you.energy, 70);
  players.ai.energy = Math.max(players.ai.energy, 70);
  delete pendingHits.you;
  delete pendingHits.ai;
  rally = 0;
  ball.reset(servingPlayer.x, servingPlayer.y - 0.25);
  pointPauseUntil = 0;
  nextServeAt = now + 1050;
  humanAnim.setLocomotion(false, players.you.facing);
  aiAnim.setLocomotion(false, players.ai.facing);
  const serverName = gameMode === 'watch'
    ? server === 'you' ? '藍方' : '金方'
    : server === 'you' ? '你' : '對手';
  lastStrategy = `${serverName}站${serveSide < 0 ? '左' : '右'}發球格 · 目標對角後場`;
}

function showFlash(message: string, duration = 920): void {
  flashEl.textContent = message;
  flashEl.classList.add('show');
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => flashEl.classList.remove('show'), duration);
}

function spawnImpact(worldX: number, worldY: number, color: number, wall: boolean): void {
  const projected = project(worldX, worldY, wall ? ball.z : 0);
  impacts.push({ x: projected.x, y: projected.y, color, age: 0, life: 0.32, wall });
}

function contactQuality(player: CourtPlayer, now: number): number {
  const contactDistance = distance(player.x, player.y, ball.x, ball.y);
  const reachPenalty = clamp((contactDistance - 0.42) / (HIT_REACH - 0.42), 0, 1) * 0.62;
  const heightPenalty = clamp((ball.z - 0.82) / 0.9, 0, 1) * 0.18;
  const dashPenalty = now < player.dashTailUntil ? 0.18 : 0;
  const fatiguePenalty = clamp((30 - player.energy) / 30, 0, 1) * 0.1;
  return clamp(1 - reachPenalty - heightPenalty - dashPenalty - fatiguePenalty, 0.12, 1);
}

function canHit(id: PlayerId): boolean {
  const player = players[id];
  return (
    ball.active &&
    ball.lastHitter !== id &&
    ball.floorBounces <= 1 &&
    ball.z <= HIT_HEIGHT &&
    distance(player.x, player.y, ball.x, ball.y) <= HIT_REACH
  );
}

function swingAction(id: PlayerId, quality: number): SquashAction {
  if (quality < 0.55) return 'reach';
  const relativeBallX = ball.x - players[id].x;
  return relativeBallX >= 0 ? 'forehand' : 'backhand';
}

function shotEnergyCost(kind: ShotKind): number {
  if (kind === 'drop') return 12;
  if (kind === 'lob') return 16;
  if (kind === 'boast') return 14;
  if (kind === 'glass') return 18;
  return 0;
}

function queueHit(
  id: PlayerId,
  kind: ShotKind,
  targetX: number,
  pace = 1,
  strategyLabel = '',
): boolean {
  const now = gameNow;
  if (matchWinner || pointPauseUntil > now || pendingHits[id]) return false;
  const player = players[id];
  if (now - player.lastSwingAt < SWING_COOLDOWN_MS) return false;
  const serving = !ball.active && server === id;
  if (!serving && !canHit(id)) {
    player.lastSwingAt = now;
    playerAnim(id).action('reach', player.facing);
    sfx.hit(kind, 0.2);
    return false;
  }

  const resolvedKind: ShotKind = serving ? 'drive' : kind;
  const cost = shotEnergyCost(resolvedKind);
  if (player.energy < cost) {
    if (id === 'you') showFlash('氣力不足');
    return false;
  }
  player.energy -= cost;
  player.lastSwingAt = now;
  if (serving) {
    ball.x = player.x;
    ball.y = player.y - 0.25;
    ball.z = 0.9;
    if (id === 'you' && gameMode === 'play') {
      showFlash('發球：正面牆發球線以上\n第一落點進對角後場', 1250);
    }
  }
  const quality = serving ? 0.92 : contactQuality(player, now);
  lastQuality = quality;
  const action =
    resolvedKind === 'glass' ? 'glass' : serving ? 'forehand' : swingAction(id, quality);
  playerAnim(id).action(action, player.facing);
  pendingHits[id] = {
    by: id,
    kind: resolvedKind,
    targetX,
    quality,
    pace,
    serving,
    fireAt: now + CONTACT_DELAY_MS,
  };
  if (strategyLabel && gameMode === 'watch') {
    const side = id === 'you' ? '藍方' : '金方';
    lastStrategy = `${side} · ${strategyLabel}`;
  }
  return true;
}

function firePendingHits(now: number): void {
  for (const id of ['you', 'ai'] as const) {
    const pending = pendingHits[id];
    if (!pending || now < pending.fireAt) continue;
    delete pendingHits[id];
    if (matchWinner || pointPauseUntil > now) continue;
    if (!pending.serving && (!ball.active || ball.lastHitter === id)) continue;
    ball.strike(id, {
      kind: pending.kind,
      targetX: pending.targetX,
      quality: pending.quality,
      pace: pending.pace,
      serving: pending.serving,
      serveSide: pending.serving ? serveSide : undefined,
    });
    rally += 1;
    sfx.hit(pending.kind, pending.quality);
    spawnImpact(ball.x, ball.y, pending.quality < 0.55 ? 0xff7a59 : 0x9fffe2, false);
    playerAnim(otherPlayer(id)).action('splitstep', players[otherPlayer(id)].facing);
    if (id === 'you' && gameMode === 'play') {
      const label = pending.quality >= 0.82 ? 'PURE' : pending.quality >= 0.55 ? 'SOLID' : 'STRETCHED';
      showFlash(`${label} · ${pending.kind.toUpperCase()}`, 520);
    }
  }
}

function awardPoint(winner: PlayerId, reason: string, now: number): void {
  if (pointPauseUntil > now || matchWinner) return;
  scores[winner] += 1;
  const previousServer = server;
  server = winner;
  serveSide = winner === previousServer
    ? serveSide === -1 ? 1 : -1
    : winner === 'you' ? -1 : 1;
  ball.active = false;
  delete pendingHits.you;
  delete pendingHits.ai;
  playerAnim(winner).action('celebrate', players[winner].facing);
  playerAnim(otherPlayer(winner)).action('dejected', players[otherPlayer(winner)].facing);
  crowdExcitedUntil = now + 1750;
  sfx.point(winner === 'you');
  const winnerName = gameMode === 'watch'
    ? winner === 'you' ? '藍方 AI' : '金方 AI'
    : winner === 'you' ? '你' : '對手';
  showFlash(`${winnerName}得分\n${reason}`, 1100);

  const leader = Math.max(scores.you, scores.ai);
  const margin = Math.abs(scores.you - scores.ai);
  if (leader >= 11 && margin >= 2) {
    matchWinner = winner;
    pointPauseUntil = Infinity;
    window.setTimeout(() => {
      const result = gameMode === 'watch'
        ? `${winner === 'you' ? '藍方 AI' : '金方 AI'} 勝出`
        : winner === 'you' ? '比賽勝利' : '惜敗';
      showFlash(`${result}\n按 Enter 再戰`, 4000);
    }, 650);
    return;
  }
  pointPauseUntil = now + POINT_PAUSE_MS;
}

function handleBallEvent(event: BallEvent, now: number): void {
  if (event.type === 'fault') {
    awardPoint(event.winner, event.reason, now);
  } else if (event.type === 'front') {
    sfx.wall(true);
    spawnImpact(event.x, 0, 0x8de9ff, true);
  } else if (event.type === 'side') {
    sfx.wall(false);
    spawnImpact(event.x, event.y, 0xb0f4ff, true);
  } else if (event.type === 'back') {
    sfx.wall(false);
    spawnImpact(event.x, COURT_LENGTH, 0xc9f8ff, true);
  } else {
    sfx.floor();
    spawnImpact(event.x, event.y, event.bounce === 1 ? 0xffc857 : 0xff6b52, false);
  }
}

function movementVector(): { x: number; y: number } {
  const x = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
  const y = (held.has('s') ? 1 : 0) - (held.has('w') ? 1 : 0);
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

function dash(): void {
  if (gameMode === 'watch') return;
  const now = gameNow;
  const player = players.you;
  const movement = movementVector();
  if (player.energy < DASH_COST || (!movement.x && !movement.y) || now < player.dashUntil) return;
  player.energy -= DASH_COST;
  player.dashUntil = now + 210;
  player.dashTailUntil = now + 520;
  player.x = clamp(player.x + movement.x * 1.1, -COURT_WIDTH / 2 + 0.35, COURT_WIDTH / 2 - 0.35);
  player.y = clamp(player.y + movement.y * 1.1, 0.72, COURT_LENGTH - 0.4);
  sfx.dash();
  showFlash('閃身', 360);
}

function resetMatch(): void {
  scores.you = 0;
  scores.ai = 0;
  server = 'you';
  serveSide = -1;
  matchWinner = null;
  lastQuality = 1;
  lastStrategy = '雙方試探站位';
  clearAiMemory(aiMemories.you);
  clearAiMemory(aiMemories.ai);
  resetRally(gameNow);
}

window.addEventListener('keydown', (event) => {
  sfx.unlock();
  const key = event.key.toLowerCase();
  if (gameMode === 'watch' && key !== 'enter') return;
  held.add(key);
  if (event.repeat && ['j', 'k', 'l', 'i', ' ', 'shift'].includes(key)) return;
  if (key === 'j') queueHit('you', 'drive', targetWallX);
  else if (key === 'k') queueHit('you', 'drop', targetWallX);
  else if (key === 'l') queueHit('you', 'boast', targetWallX);
  else if (key === 'i') queueHit('you', 'glass', targetWallX);
  else if (event.key === ' ') queueHit('you', ball.active ? 'lob' : 'drive', targetWallX);
  else if (key === 'shift') dash();
  else if (key === 'arrowleft') targetWallX = clamp(targetWallX - 0.45, -2.65, 2.65);
  else if (key === 'arrowright') targetWallX = clamp(targetWallX + 0.45, -2.65, 2.65);
  else if (key === 'enter' && matchWinner) resetMatch();
});
window.addEventListener('keyup', (event) => held.delete(event.key.toLowerCase()));
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

for (const button of document.querySelectorAll<HTMLButtonElement>('#touch-move button')) {
  const key = button.dataset.key!;
  const press = (event: PointerEvent): void => {
    event.preventDefault();
    held.add(key);
    button.setPointerCapture(event.pointerId);
  };
  const release = (event: PointerEvent): void => {
    event.preventDefault();
    held.delete(key);
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
}
for (const button of document.querySelectorAll<HTMLButtonElement>('#touch-shots button')) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    sfx.unlock();
    const kind = button.dataset.shot as ShotKind;
    queueHit('you', kind, targetWallX);
  });
}

function setGameMode(mode: GameMode): void {
  gameMode = mode;
  held.clear();
  document.body.classList.toggle('watch-mode', mode === 'watch');
  document.querySelector('#mode-play')?.classList.toggle('active', mode === 'play');
  document.querySelector('#mode-watch')?.classList.toggle('active', mode === 'watch');
  modeBadgeEl.textContent = mode === 'watch' ? 'AI VS AI · LIVE' : 'PLAYER VS AI';
  leftNameEl.textContent = mode === 'watch' ? 'BLUE AI' : 'YOU';
  rightNameEl.textContent = mode === 'watch' ? 'GOLD AI' : 'RIVAL AI';
  resetMatch();
}

document.querySelector('#mode-play')?.addEventListener('click', () => setGameMode('play'));
document.querySelector('#mode-watch')?.addEventListener('click', () => setGameMode('watch'));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-level]')) {
  button.addEventListener('click', () => {
    aiLevel = button.dataset.level as AiLevel;
    for (const peer of document.querySelectorAll('[data-level]')) {
      peer.classList.toggle('active', peer === button);
    }
  });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
  button.addEventListener('click', () => {
    ballSpeed = Number(button.dataset.speed);
    for (const peer of document.querySelectorAll('[data-speed]')) {
      peer.classList.toggle('active', peer === button);
    }
  });
}

function updatePlayers(dtSeconds: number, now: number): void {
  const human = players.you;
  if (gameMode === 'play') {
    const movement = movementVector();
    const speed = now < human.dashUntil ? DASH_SPEED : PLAYER_SPEED;
    human.x = clamp(human.x + movement.x * speed * dtSeconds, -COURT_WIDTH / 2 + 0.36, COURT_WIDTH / 2 - 0.36);
    human.y = clamp(human.y + movement.y * speed * dtSeconds, 0.72, COURT_LENGTH - 0.42);
    if (Math.abs(movement.x) > 0.05) human.facing = Math.sign(movement.x);
    humanAnim.setLocomotion(Math.hypot(movement.x, movement.y) > 0.05, human.facing);
  } else {
    const blueDecision = decideAi(
      human,
      players.ai,
      ball,
      'you',
      now,
      aiLevel,
      aiMemories.you,
      { rally, selfScore: scores.you, opponentScore: scores.ai },
    );
    moveAi(human, blueDecision, dtSeconds, aiLevel);
    humanAnim.setLocomotion(Math.hypot(blueDecision.moveX, blueDecision.moveY) > 0.05, human.facing);
    if (
      blueDecision.shot &&
      queueHit('you', blueDecision.shot, blueDecision.targetX, blueDecision.pace, blueDecision.label)
    ) {
      rememberAiDecision(aiMemories.you, blueDecision);
    }
  }
  human.energy = clamp(human.energy + ENERGY_REGEN_PER_SECOND * dtSeconds, 0, 100);

  const decision = decideAi(
    players.ai,
    human,
    ball,
    'ai',
    now,
    aiLevel,
    aiMemories.ai,
    { rally, selfScore: scores.ai, opponentScore: scores.you },
  );
  moveAi(players.ai, decision, dtSeconds, aiLevel);
  players.ai.energy = clamp(players.ai.energy + ENERGY_REGEN_PER_SECOND * dtSeconds, 0, 100);
  aiAnim.setLocomotion(Math.hypot(decision.moveX, decision.moveY) > 0.05, players.ai.facing);
  if (
    decision.shot &&
    queueHit('ai', decision.shot, decision.targetX, decision.pace, decision.label)
  ) {
    rememberAiDecision(aiMemories.ai, decision);
  }

  const separation = distance(human.x, human.y, players.ai.x, players.ai.y);
  if (separation < MIN_PLAYER_SEPARATION) {
    const pushX = separation > 0.001 ? (human.x - players.ai.x) / separation : -1;
    const pushY = separation > 0.001 ? (human.y - players.ai.y) / separation : 0;
    const correction = (MIN_PLAYER_SEPARATION - separation) / 2;
    human.x = clamp(human.x + pushX * correction, -COURT_WIDTH / 2 + 0.36, COURT_WIDTH / 2 - 0.36);
    human.y = clamp(human.y + pushY * correction, 0.72, COURT_LENGTH - 0.42);
    players.ai.x = clamp(
      players.ai.x - pushX * correction,
      -COURT_WIDTH / 2 + 0.36,
      COURT_WIDTH / 2 - 0.36,
    );
    players.ai.y = clamp(players.ai.y - pushY * correction, 0.72, COURT_LENGTH - 0.42);
  }
}

function updateAiServe(now: number): void {
  const automaticServer = server === 'ai' || gameMode === 'watch';
  if (!automaticServer || ball.active || pendingHits[server] || now < nextServeAt || pointPauseUntil > now) return;
  queueHit(
    server,
    'drive',
    aiServeTarget(players[otherPlayer(server)], aiLevel),
    0.88,
    `${serveSide < 0 ? '左' : '右'}格發球 → 對角後場`,
  );
}

function updateActorVisual(id: PlayerId): void {
  const player = players[id];
  const anim = playerAnim(id);
  const projected = project(player.x, player.y);
  anim.view.position.set(projected.x, projected.y);
  anim.view.scale.set(projected.scale);
  anim.view.zIndex = projected.y;
}

function updateBallVisual(): void {
  const projected = project(ball.x, ball.y, ball.z);
  const floor = project(ball.x, ball.y, 0);
  const visible = ball.active || (!matchWinner && pointPauseUntil === 0);
  ballGraphics.visible = visible;
  ballShadow.visible = visible;
  trailGraphics.visible = ball.active;
  if (!visible) return;

  ballShadow
    .clear()
    .ellipse(floor.x, floor.y + 2, 12.5 * floor.scale, 5 * floor.scale)
    .fill({ color: 0x020406, alpha: 0.38 });
  const radius = 8.4 * projected.scale + 3;
  ballGraphics
    .clear()
    .circle(projected.x, projected.y, radius + 4.5)
    .fill({ color: 0x7eeaff, alpha: 0.2 })
    .circle(projected.x, projected.y, radius)
    .fill({ color: 0x010304 })
    .circle(projected.x, projected.y, radius)
    .stroke({ color: 0xb8f5ff, width: 1.2, alpha: 0.62 })
    .circle(projected.x - radius * 0.28, projected.y - radius * 0.3, Math.max(1.2, radius * 0.2))
    .fill({ color: 0x56dffc, alpha: 0.9 });

  if (ball.active) {
    trail.push({ x: projected.x, y: projected.y });
    if (trail.length > 15) trail.shift();
  } else {
    trail.length = 0;
  }
  trailGraphics.clear();
  for (let index = 1; index < trail.length; index += 1) {
    const previous = trail[index - 1];
    const current = trail[index];
    trailGraphics
      .moveTo(previous.x, previous.y)
      .lineTo(current.x, current.y)
      .stroke({
        color: 0x87ecff,
        width: 1 + (index / trail.length) * 2,
        alpha: (index / trail.length) * 0.32,
      });
  }
  ballLayer.zIndex = projected.y + 50;
}

function updateImpacts(dtSeconds: number): void {
  impactGraphics.clear();
  for (let index = impacts.length - 1; index >= 0; index -= 1) {
    const impact = impacts[index];
    impact.age += dtSeconds;
    const progress = impact.age / impact.life;
    if (progress >= 1) {
      impacts.splice(index, 1);
      continue;
    }
    const radius = 8 + progress * (impact.wall ? 42 : 28);
    impactGraphics
      .circle(impact.x, impact.y, radius)
      .stroke({ color: impact.color, width: 4 * (1 - progress) + 1, alpha: 0.75 * (1 - progress) });
  }
}

function updateServeGuide(now: number): void {
  serveGuideGraphics.clear();
  if (ball.active || pointPauseUntil > now || matchWinner) return;

  const pulse = 0.72 + Math.sin(now * 0.008) * 0.18;
  const boxMinX = serveSide < 0 ? -COURT_WIDTH / 2 : COURT_WIDTH / 2 - 1.6;
  const boxMaxX = serveSide < 0 ? -COURT_WIDTH / 2 + 1.6 : COURT_WIDTH / 2;
  const boxFrontLeft = project(boxMinX, SHORT_LINE_Y);
  const boxFrontRight = project(boxMaxX, SHORT_LINE_Y);
  const boxBackRight = project(boxMaxX, SHORT_LINE_Y + 1.6);
  const boxBackLeft = project(boxMinX, SHORT_LINE_Y + 1.6);
  const targetMinX = serveSide < 0 ? 0 : -COURT_WIDTH / 2;
  const targetMaxX = serveSide < 0 ? COURT_WIDTH / 2 : 0;
  const targetFrontLeft = project(targetMinX, SHORT_LINE_Y);
  const targetFrontRight = project(targetMaxX, SHORT_LINE_Y);
  const targetBackRight = project(targetMaxX, COURT_LENGTH);
  const targetBackLeft = project(targetMinX, COURT_LENGTH);
  const serviceBandBottomLeft = project(-COURT_WIDTH / 2, 0, SERVICE_LINE_HEIGHT);
  const serviceBandBottomRight = project(COURT_WIDTH / 2, 0, SERVICE_LINE_HEIGHT);
  const serviceBandTopRight = project(COURT_WIDTH / 2, 0, FRONT_OUT_HEIGHT);
  const serviceBandTopLeft = project(-COURT_WIDTH / 2, 0, FRONT_OUT_HEIGHT);
  const color = server === 'you' ? 0x65e8ff : 0xffc857;

  serveGuideGraphics
    .poly([
      boxFrontLeft.x, boxFrontLeft.y,
      boxFrontRight.x, boxFrontRight.y,
      boxBackRight.x, boxBackRight.y,
      boxBackLeft.x, boxBackLeft.y,
    ])
    .fill({ color, alpha: 0.12 * pulse })
    .stroke({ color, width: 3, alpha: 0.72 * pulse })
    .poly([
      targetFrontLeft.x, targetFrontLeft.y,
      targetFrontRight.x, targetFrontRight.y,
      targetBackRight.x, targetBackRight.y,
      targetBackLeft.x, targetBackLeft.y,
    ])
    .fill({ color: 0x7dffb2, alpha: 0.09 * pulse })
    .stroke({ color: 0x7dffb2, width: 2, alpha: 0.58 * pulse })
    .poly([
      serviceBandBottomLeft.x, serviceBandBottomLeft.y,
      serviceBandBottomRight.x, serviceBandBottomRight.y,
      serviceBandTopRight.x, serviceBandTopRight.y,
      serviceBandTopLeft.x, serviceBandTopLeft.y,
    ])
    .fill({ color, alpha: 0.035 * pulse })
    .stroke({ color, width: 2, alpha: 0.32 * pulse });
}

function updateAim(): void {
  const point = project(targetWallX, 0, ball.active ? 1.25 : 2.4);
  aimGraphics
    .clear()
    .circle(point.x, point.y, 14)
    .stroke({ color: 0xffc857, width: 2, alpha: 0.62 })
    .moveTo(point.x - 20, point.y)
    .lineTo(point.x + 20, point.y)
    .moveTo(point.x, point.y - 20)
    .lineTo(point.x, point.y + 20)
    .stroke({ color: 0xffedac, width: 1, alpha: 0.55 });
}

function updateLandingMarker(now: number): void {
  const landing = ball.predictNextBounce();
  landingGraphics.clear();
  landingLabel.visible = Boolean(landing);
  if (!landing) return;

  const point = project(landing.x, landing.y);
  const color = ball.lastHitter === 'you' ? 0x7dffb2 : 0xffc857;
  const urgency = 1 - clamp(landing.seconds / 1.8, 0, 1);
  const pulse = 0.5 + Math.sin(now * 0.012) * 0.5;
  const outerRadius = 18 + (1 - urgency) * 8 + pulse * 2;
  const innerRadius = 5 + urgency * 8;
  const perspectiveY = 0.38 + point.scale * 0.24;

  landingGraphics
    .ellipse(point.x, point.y, outerRadius, outerRadius * perspectiveY)
    .fill({ color, alpha: 0.1 })
    .stroke({ color, width: 3, alpha: 0.78 })
    .ellipse(point.x, point.y, innerRadius, innerRadius * perspectiveY)
    .stroke({ color: 0xffffff, width: 1.5, alpha: 0.75 })
    .moveTo(point.x - 6, point.y)
    .lineTo(point.x + 6, point.y)
    .moveTo(point.x, point.y - 4)
    .lineTo(point.x, point.y + 4)
    .stroke({ color, width: 2, alpha: 0.9 });

  landingLabel.text = landing.bounce === 1 ? '落點' : '二跳';
  landingLabel.style.fill = color;
  landingLabel.position.set(point.x, point.y - outerRadius * perspectiveY - 5);
}

function updateWallShadow(): void {
  const impact = ball.predictNextWallImpact();
  wallShadowGraphics.clear();
  if (!impact) return;

  const point = project(impact.x, impact.y, impact.z);
  const urgency = 1 - clamp(impact.seconds / 1.35, 0, 1);
  const spread = 26 - urgency * 12;
  const surfaceStretchX = impact.surface === 'side' ? 0.48 : 1;
  const surfaceStretchY = impact.surface === 'back' ? 0.48 : 0.72;
  const color = ball.lastHitter === 'you' ? 0x74e9d1 : 0xffc857;

  wallShadowGraphics
    .ellipse(point.x, point.y, spread * surfaceStretchX, spread * surfaceStretchY)
    .fill({ color: 0x00060a, alpha: 0.1 + urgency * 0.1 })
    .ellipse(point.x, point.y, spread * 0.68 * surfaceStretchX, spread * 0.68 * surfaceStretchY)
    .fill({ color: 0x000207, alpha: 0.13 + urgency * 0.14 })
    .ellipse(point.x, point.y, spread * 0.34 * surfaceStretchX, spread * 0.34 * surfaceStretchY)
    .fill({ color: 0x000000, alpha: 0.28 + urgency * 0.22 })
    .ellipse(point.x, point.y, spread * 0.84 * surfaceStretchX, spread * 0.84 * surfaceStretchY)
    .stroke({ color, width: 1.5 + urgency, alpha: 0.2 + urgency * 0.28 });
}

function updateArena(now: number): void {
  const cycle = (now % 5200) / 5200;
  const scheduledGlassPulse =
    cycle < 0.22 ? Math.sin((cycle / 0.22) * Math.PI) ** 2 : 0;
  const scorePulse = now < crowdExcitedUntil
    ? 0.5 + Math.sin(now * 0.024) * 0.28
    : 0;
  const glassLight = clamp(scheduledGlassPulse + scorePulse, 0, 1);
  glassPulseGraphics.alpha = 0.03 + glassLight * 0.72;
  leftWallTexture.alpha = 0.94 + glassLight * 0.06;
  rightWallTexture.alpha = 0.94 + glassLight * 0.06;
  backGlassTexture.alpha = 0.22 + glassLight * 0.2;
  rearGlassReflection.alpha = 0.1 + glassLight * 0.16;
  rearGlassFrame.alpha = 0.74 + glassLight * 0.26;

  ambientGraphics.clear();
  const beamCenter = 640 + Math.sin(now * 0.00032) * 250;
  ambientGraphics
    .poly([
      beamCenter - 52, 0,
      beamCenter + 52, 0,
      beamCenter + 190, 610,
      beamCenter - 190, 610,
    ])
    .fill({ color: 0x77dfff, alpha: 0.025 + scheduledGlassPulse * 0.035 });

  const flashPoints = [
    { x: 82, y: 210, offset: 0 },
    { x: 1192, y: 265, offset: 820 },
    { x: 160, y: 448, offset: 1730 },
    { x: 1118, y: 430, offset: 2780 },
  ];
  for (const flash of flashPoints) {
    const flashPhase = ((now + flash.offset) % 3900) / 3900;
    if (flashPhase > 0.055) continue;
    const strength = 1 - flashPhase / 0.055;
    ambientGraphics
      .circle(flash.x, flash.y, 4 + strength * 9)
      .fill({ color: 0xeaffff, alpha: strength * 0.58 })
      .circle(flash.x, flash.y, 22 + strength * 34)
      .fill({ color: 0x79ddff, alpha: strength * 0.07 });
  }

  const excited = now < crowdExcitedUntil;
  for (const actor of crowdActors) {
    if (actor.excited !== excited) {
      actor.excited = excited;
      actor.sprite.textures = excited ? actor.excitedFrames : actor.baseFrames;
      actor.sprite.animationSpeed = (excited ? 15 : actor.baseFps) / 60;
      actor.sprite.gotoAndPlay(0);
    }
  }
}

function updateHud(now: number): void {
  pointsLeftEl.textContent = `${scores.you}`;
  pointsRightEl.textContent = `${scores.ai}`;
  const serveText = gameMode === 'watch'
    ? `${server === 'you' ? '藍方' : '金方'}發球`
    : server === 'you' ? '你發球' : '對手發球';
  const winnerText = gameMode === 'watch'
    ? `${matchWinner === 'you' ? '藍方 AI' : '金方 AI'}勝出`
    : matchWinner === 'you' ? '比賽勝利' : '對手獲勝';
  scoreMetaEl.textContent = matchWinner
    ? `${winnerText} · Enter 再戰`
    : !ball.active
      ? `${serveText} · ${serveSide < 0 ? '左' : '右'}格 → 對角後場`
      : rally === 1
        ? `${serveText}進行中 · 發球線以上 → 對角後場`
        : `回合進行中 · 第 ${Math.max(1, rally)} 拍`;
  energyFillEl.style.width = `${players.you.energy}%`;
  energyValueEl.textContent = `${Math.round(players.you.energy)}`;
  qualityFillEl.style.width = `${lastQuality * 100}%`;
  qualityLabelEl.textContent =
    lastQuality >= 0.82 ? 'PURE' : lastQuality >= 0.55 ? 'SOLID' : 'STRETCHED';
  qualityLabelEl.style.color =
    lastQuality >= 0.82 ? '#7dffb2' : lastQuality >= 0.55 ? '#ffd166' : '#ff7a59';
  rallyEl.textContent = `回合 ${rally}`;
  const humanT = distance(players.you.x, players.you.y, T_X, T_Y);
  const aiT = distance(players.ai.x, players.ai.y, T_X, T_Y);
  const leftTName = gameMode === 'watch' ? '藍方' : '你';
  const rightTName = gameMode === 'watch' ? '金方' : '對手';
  tControlEl.textContent =
    Math.abs(humanT - aiT) < 0.35 ? 'T 區纏鬥' : humanT < aiT ? `${leftTName}控制 T 區` : `${rightTName}控制 T 區`;
  strategyFeedEl.textContent = gameMode === 'watch' ? lastStrategy : '觀察三方位置再選球';
  if (pointPauseUntil > 0 && pointPauseUntil <= now && !matchWinner) resetRally(now);
}

resetRally(gameNow);
loadingEl.classList.add('hide');
window.setTimeout(() => loadingEl.remove(), 600);

app.ticker.add((ticker) => {
  const realDtSeconds = Math.min(0.033, ticker.deltaMS / 1000);
  const ballDtSeconds = realDtSeconds * ballSpeed;
  gameNow += realDtSeconds * 1000;
  const now = gameNow;

  if (!matchWinner && pointPauseUntil <= now) {
    updatePlayers(realDtSeconds, now);
    firePendingHits(now);
    updateAiServe(now);
    for (const event of ball.update(ballDtSeconds)) handleBallEvent(event, now);
  }

  humanAnim.update(realDtSeconds);
  aiAnim.update(realDtSeconds);
  updateActorVisual('you');
  updateActorVisual('ai');
  updateBallVisual();
  updateImpacts(realDtSeconds);
  updateServeGuide(now);
  updateAim();
  updateWallShadow();
  updateLandingMarker(now);
  updateArena(now);
  updateHud(now);
});
})();
