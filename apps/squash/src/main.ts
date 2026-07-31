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
import { SquashBall, type BallEvent, type PredictedBounce } from './physics';
import { SquashSfx } from './sfx';

void (async () => {
const DESIGN_WIDTH = 1280;
const DESIGN_HEIGHT = 720;
const PLAYER_SPEED = 3.85;
const DASH_SPEED = 7.6;
const DASH_COST = 28;
const ENERGY_REGEN_PER_SECOND = 7.5;
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

type WallSurface = 'front' | 'side' | 'back';

interface LandingSample {
  x: number;
  y: number;
  kind: ShotKind;
  quality: number;
  actual: boolean;
}

interface PlayerMatchStats {
  shots: number;
  qualityTotal: number;
  lowQuality: number;
  twoWall: number;
  threeWall: number;
  glass: number;
  volley: number;
  directFront: number;
  sideFront: number;
  shotKinds: Record<ShotKind, number>;
  landings: LandingSample[];
}

interface ActiveShot {
  by: PlayerId;
  kind: ShotKind;
  quality: number;
  volley: boolean;
  contactZ: number;
  opponentStartX: number;
  opponentStartY: number;
  predictedX: number | null;
  predictedY: number | null;
  firstLandingX: number | null;
  firstLandingY: number | null;
  walls: WallSurface[];
  landed: boolean;
  landingIndex: number | null;
}

type PointAnalysisType =
  | '死角致勝'
  | '調動致勝'
  | '直接致勝球'
  | '壓迫得分'
  | '受迫失誤'
  | '非受迫失誤'
  | '低球硬抽失誤'
  | '發球直接得分'
  | '發球失誤'
  | '規則失誤'
  | '對手規則失誤';

interface PointAnalysis {
  type: PointAnalysisType;
  detail: string;
  finishingShot: ShotKind | null;
}

interface PointRecord {
  number: number;
  winner: PlayerId;
  loser: PlayerId;
  reason: string;
  rally: number;
  server: PlayerId;
  analysis: PointAnalysis;
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
const matchReportEl = document.querySelector<HTMLElement>('#match-report')!;
const reportScoreEl = document.querySelector<HTMLElement>('#report-score')!;
const reportBlueNameEl = document.querySelector<HTMLElement>('#report-blue-name')!;
const reportGoldNameEl = document.querySelector<HTMLElement>('#report-gold-name')!;
const reportBlueResultEl = document.querySelector<HTMLElement>('#report-blue-result')!;
const reportGoldResultEl = document.querySelector<HTMLElement>('#report-gold-result')!;
const pointLogBodyEl = document.querySelector<HTMLTableSectionElement>('#point-log-body')!;
const blueWinReasonsEl = document.querySelector<HTMLElement>('#blue-win-reasons')!;
const goldWinReasonsEl = document.querySelector<HTMLElement>('#gold-win-reasons')!;
const blueLossReasonsEl = document.querySelector<HTMLElement>('#blue-loss-reasons')!;
const goldLossReasonsEl = document.querySelector<HTMLElement>('#gold-loss-reasons')!;
const reportAverageRallyEl = document.querySelector<HTMLElement>('#report-average-rally')!;
const reportLongestRallyEl = document.querySelector<HTMLElement>('#report-longest-rally')!;
const reportServeWinRateEl = document.querySelector<HTMLElement>('#report-serve-win-rate')!;
const reportShotVarietyEl = document.querySelector<HTMLElement>('#report-shot-variety')!;
const reportBackCourtRateEl = document.querySelector<HTMLElement>('#report-back-court-rate')!;
const reportFrontCourtRateEl = document.querySelector<HTMLElement>('#report-front-court-rate')!;
const reportBalanceNoteEl = document.querySelector<HTMLElement>('#report-balance-note')!;
const landingMapEl = document.querySelector<HTMLCanvasElement>('#landing-map')!;
const landingDepthSummaryEl = document.querySelector<HTMLElement>('#landing-depth-summary')!;
const reportRematchEl = document.querySelector<HTMLButtonElement>('#report-rematch')!;
const reportExportEl = document.querySelector<HTMLButtonElement>('#report-export')!;

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
const createPlayerMatchStats = (): PlayerMatchStats => ({
  shots: 0,
  qualityTotal: 0,
  lowQuality: 0,
  twoWall: 0,
  threeWall: 0,
  glass: 0,
  volley: 0,
  directFront: 0,
  sideFront: 0,
  shotKinds: { drive: 0, drop: 0, lob: 0, boast: 0, glass: 0 },
  landings: [],
});
const matchStats: Record<PlayerId, PlayerMatchStats> = {
  you: createPlayerMatchStats(),
  ai: createPlayerMatchStats(),
};
const pointRecords: PointRecord[] = [];
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
let activeShot: ActiveShot | null = null;

function playerAnim(id: PlayerId): SquashCharacterAnim {
  return id === 'you' ? humanAnim : aiAnim;
}

function resetMatchStats(): void {
  for (const id of ['you', 'ai'] as const) {
    Object.assign(matchStats[id], createPlayerMatchStats());
  }
  pointRecords.length = 0;
  activeShot = null;
}

function finalizeActiveShot(): void {
  if (!activeShot) return;
  const stats = matchStats[activeShot.by];
  if (activeShot.walls.length === 2) stats.twoWall += 1;
  if (activeShot.walls.length >= 3) stats.threeWall += 1;
  if (activeShot.walls[0] === 'front') stats.directFront += 1;
  if (activeShot.walls[0] === 'side' && activeShot.walls.includes('front')) {
    stats.sideFront += 1;
  }
  activeShot = null;
}

function beginActiveShot(
  by: PlayerId,
  kind: ShotKind,
  volley: boolean,
  quality: number,
  predictedBounce: PredictedBounce | null,
): void {
  const stats = matchStats[by];
  stats.shots += 1;
  stats.qualityTotal += quality;
  if (quality < 0.55) stats.lowQuality += 1;
  stats.shotKinds[kind] += 1;
  if (kind === 'glass') stats.glass += 1;
  if (volley) stats.volley += 1;
  const opponent = players[otherPlayer(by)];
  const landingIndex = predictedBounce === null
    ? null
    : stats.landings.push({
        x: predictedBounce.x,
        y: predictedBounce.y,
        kind,
        quality,
        actual: false,
      }) - 1;
  activeShot = {
    by,
    kind,
    quality,
    volley,
    contactZ: ball.z,
    opponentStartX: opponent.x,
    opponentStartY: opponent.y,
    predictedX: predictedBounce?.x ?? null,
    predictedY: predictedBounce?.y ?? null,
    firstLandingX: null,
    firstLandingY: null,
    walls: [],
    landed: false,
    landingIndex,
  };
}

function trackWall(surface: WallSurface): void {
  if (activeShot) activeShot.walls.push(surface);
}

function trackFirstLanding(x: number, y: number): void {
  if (!activeShot || activeShot.landed) return;
  activeShot.landed = true;
  activeShot.firstLandingX = x;
  activeShot.firstLandingY = y;
  const landings = matchStats[activeShot.by].landings;
  const sample = activeShot.landingIndex === null
    ? null
    : landings[activeShot.landingIndex];
  if (sample) {
    sample.x = x;
    sample.y = y;
    sample.actual = true;
  } else {
    landings.push({
      x,
      y,
      kind: activeShot.kind,
      quality: activeShot.quality,
      actual: true,
    });
  }
}

const shotKindLabel = (kind: ShotKind): string => ({
  drive: '平抽',
  drop: '小球',
  lob: '高吊',
  boast: '側牆球',
  glass: '後玻璃球',
})[kind];

function analyzePoint(
  winner: PlayerId,
  reason: string,
  shot: ActiveShot | null,
): PointAnalysis {
  const loser = otherPlayer(winner);
  if (!shot) {
    const serveFault = reason.startsWith('發球');
    const serveWinner = reason === '第二次落地' && winner === server;
    return {
      type: serveFault ? '發球失誤' : serveWinner ? '發球直接得分' : '規則失誤',
      detail: serveFault
        ? `發球違例：${reason}`
        : serveWinner
          ? '接發者未能在第二次落地前完成回擊'
          : reason,
      finishingShot: null,
    };
  }

  const shotLabel = shotKindLabel(shot.kind);
  const qualityPercent = Math.round(shot.quality * 100);
  if (shot.by === loser) {
    if (reason === '下界板' && shot.kind === 'drive' && shot.contactZ < 0.55) {
      return {
        type: '低球硬抽失誤',
        detail: `球僅 ${Math.round(shot.contactZ * 100)}cm 高仍選平抽，撞下界板`,
        finishingShot: shot.kind,
      };
    }
    if (shot.quality < 0.55) {
      return {
        type: '受迫失誤',
        detail: `勉強回出 ${qualityPercent}% 品質的${shotLabel}，最終${reason}`,
        finishingShot: shot.kind,
      };
    }
    return {
      type: '非受迫失誤',
      detail: `${qualityPercent}% 品質的${shotLabel}仍發生「${reason}」`,
      finishingShot: shot.kind,
    };
  }

  const landingX = shot.firstLandingX ?? shot.predictedX;
  const landingY = shot.firstLandingY ?? shot.predictedY;
  const opponentTravel = landingX === null || landingY === null
    ? 0
    : distance(shot.opponentStartX, shot.opponentStartY, landingX, landingY);
  const opponentOffT = distance(shot.opponentStartX, shot.opponentStartY, T_X, T_Y);
  const isFrontCorner = landingX !== null && landingY !== null
    && Math.abs(landingX) >= 1.85 && landingY <= 2.2;
  const isBackCorner = landingX !== null && landingY !== null
    && Math.abs(landingX) >= 2.05 && landingY >= 7.1;

  if (reason === '第二次落地' && (isFrontCorner || isBackCorner)) {
    const corner = isFrontCorner ? '前場死角' : '後場死角';
    return {
      type: '死角致勝',
      detail: `${shotLabel}落入${corner}，對手需移動 ${opponentTravel.toFixed(1)}m`,
      finishingShot: shot.kind,
    };
  }
  if (reason === '第二次落地' && opponentOffT >= 1.45 && opponentTravel >= 2.7) {
    return {
      type: '調動致勝',
      detail: `對手已離開 T 區 ${opponentOffT.toFixed(1)}m，再被迫移動 ${opponentTravel.toFixed(1)}m`,
      finishingShot: shot.kind,
    };
  }
  if (reason === '第二次落地' && (shot.quality >= 0.82 || shot.volley)) {
    return {
      type: '直接致勝球',
      detail: `${shot.volley ? '凌空' : '高品質'}${shotLabel}讓對手未能在第二次落地前回擊`,
      finishingShot: shot.kind,
    };
  }
  if (reason === '第二次落地') {
    return {
      type: '壓迫得分',
      detail: `${shotLabel}持續施壓，對手未能在第二次落地前回擊`,
      finishingShot: shot.kind,
    };
  }
  return {
    type: '對手規則失誤',
    detail: `對手回擊發生「${reason}」`,
    finishingShot: shot.kind,
  };
}

function constrainServerToServiceBox(now = gameNow): void {
  if (ball.active || pointPauseUntil > now || matchWinner) return;
  const servingPlayer = players[server];
  const minX = serveSide < 0 ? -COURT_WIDTH / 2 : COURT_WIDTH / 2 - 1.6;
  const maxX = serveSide < 0 ? -COURT_WIDTH / 2 + 1.6 : COURT_WIDTH / 2;
  const inset = 0.36;
  servingPlayer.x = clamp(servingPlayer.x, minX + inset, maxX - inset);
  servingPlayer.y = clamp(servingPlayer.y, SHORT_LINE_Y + inset, SHORT_LINE_Y + 1.6 - inset);
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
  const reachPenalty = clamp((contactDistance - 0.42) / (HIT_REACH - 0.42), 0, 1) * 0.48;
  const heightPenalty = clamp((ball.z - 0.82) / 0.9, 0, 1) * 0.18;
  const dashPenalty = now < player.dashTailUntil ? 0.18 : 0;
  const fatiguePenalty = clamp((55 - player.energy) / 55, 0, 1) * 0.18;
  const rallyPressurePenalty = clamp((rally - 8) / 24, 0, 1) * 0.12;
  return clamp(
    1 - reachPenalty - heightPenalty - dashPenalty - fatiguePenalty - rallyPressurePenalty,
    0.12,
    1,
  );
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
  if (kind === 'drop') return 10;
  if (kind === 'lob') return 12;
  if (kind === 'boast') return 12;
  if (kind === 'glass') return 15;
  return 4;
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
    constrainServerToServiceBox(now);
    ball.x = player.x;
    ball.y = player.y - 0.25;
    ball.z = 0.9;
    if (id === 'you' && gameMode === 'play') {
      showFlash('發球：正面牆發球線以上\n第一落點進對角後場', 1250);
    }
  }
  // The receiver can still attack a well-read serve, but a first contact made
  // under the serve's side-wall pressure has less control than a neutral rally
  // ball. The continuous quality model turns that pressure into a shallower,
  // more scattered return rather than a scripted miss.
  const serveReturnPenalty = !serving && rally === 1 && ball.lastHitter === server ? 0.35 : 0;
  const serveInitiativeBonus = !serving && rally === 2 && id === server ? 0.18 : 0;
  const quality = serving
    ? 0.92
    : clamp(
        contactQuality(player, now) - serveReturnPenalty + serveInitiativeBonus,
        0.12,
        1,
      );
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
    const volley = ball.active && ball.floorBounces === 0;
    finalizeActiveShot();
    const shotSpec = {
      kind: pending.kind,
      targetX: pending.targetX,
      quality: pending.quality,
      pace: pending.pace,
      serving: pending.serving,
      serveSide: pending.serving ? serveSide : undefined,
    };
    const predictedBounce = pending.serving
      ? null
      : ball.previewStrike(id, shotSpec);
    ball.strike(id, shotSpec);
    if (!pending.serving) {
      beginActiveShot(id, pending.kind, volley, pending.quality, predictedBounce);
    }
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
  const analysis = analyzePoint(winner, reason, activeShot);
  finalizeActiveShot();
  pointRecords.push({
    number: pointRecords.length + 1,
    winner,
    loser: otherPlayer(winner),
    reason,
    rally,
    server,
    analysis,
  });
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
  showFlash(`${winnerName}得分\n${analysis.type}`, 1100);

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
      showMatchReport(winner);
    }, 650);
    return;
  }
  pointPauseUntil = now + POINT_PAUSE_MS;
}

function handleBallEvent(event: BallEvent, now: number): void {
  if (event.type === 'fault') {
    awardPoint(event.winner, event.reason, now);
  } else if (event.type === 'front') {
    trackWall('front');
    sfx.wall(true);
    spawnImpact(event.x, 0, 0x8de9ff, true);
  } else if (event.type === 'side') {
    trackWall('side');
    sfx.wall(false);
    spawnImpact(event.x, event.y, 0xb0f4ff, true);
  } else if (event.type === 'back') {
    trackWall('back');
    sfx.wall(false);
    spawnImpact(event.x, COURT_LENGTH, 0xc9f8ff, true);
  } else {
    if (event.bounce === 1) trackFirstLanding(event.x, event.y);
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
  constrainServerToServiceBox(now);
  sfx.dash();
  showFlash('閃身', 360);
}

function reportPlayerName(id: PlayerId): string {
  if (gameMode === 'watch') return id === 'you' ? '藍方 AI' : '金方 AI';
  return id === 'you' ? '你' : '對手';
}

function populatePlayerStats(id: PlayerId): void {
  const card = matchReportEl.querySelector<HTMLElement>(`[data-report-player="${id}"]`)!;
  const stats = matchStats[id];
  const values: Record<string, number> = {
    shots: stats.shots,
    'average-quality': stats.shots ? Math.round((stats.qualityTotal / stats.shots) * 100) : 0,
    'low-quality': stats.lowQuality,
    'two-wall': stats.twoWall,
    'three-wall': stats.threeWall,
    glass: stats.glass,
    volley: stats.volley,
    'direct-front': stats.directFront,
    'side-front': stats.sideFront,
    'kind-drive': stats.shotKinds.drive,
    'kind-drop': stats.shotKinds.drop,
    'kind-lob': stats.shotKinds.lob,
    'kind-boast': stats.shotKinds.boast,
    'kind-glass': stats.shotKinds.glass,
  };
  for (const [key, value] of Object.entries(values)) {
    const target = card.querySelector<HTMLElement>(`[data-stat="${key}"]`);
    if (target) target.textContent = `${value}`;
  }
}

function drawLandingMap(): void {
  const context = landingMapEl.getContext('2d');
  if (!context) return;
  const cssWidth = Math.max(280, landingMapEl.clientWidth || 560);
  const cssHeight = Math.round(cssWidth * (340 / 560));
  const density = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
  landingMapEl.width = Math.round(cssWidth * density);
  landingMapEl.height = Math.round(cssHeight * density);
  const width = cssWidth;
  const height = cssHeight;
  context.setTransform(density, 0, 0, density, 0, 0);
  const court = {
    x: width * 0.17,
    y: 22,
    width: width * 0.66,
    height: height - 42,
  };
  const mapX = (x: number): number =>
    court.x + ((x + COURT_WIDTH / 2) / COURT_WIDTH) * court.width;
  const mapY = (y: number): number =>
    court.y + (y / COURT_LENGTH) * court.height;

  context.clearRect(0, 0, width, height);
  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#071b24');
  background.addColorStop(1, '#0b3037');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = '#153c45';
  context.fillRect(court.x, court.y, court.width, court.height);
  context.fillStyle = '#173b42';
  context.fillRect(court.x, court.y, court.width, mapY(3.05) - court.y);
  context.fillStyle = '#17454a';
  context.fillRect(court.x, mapY(3.05), court.width, mapY(SHORT_LINE_Y) - mapY(3.05));
  context.fillStyle = '#1c5253';
  context.fillRect(
    court.x,
    mapY(SHORT_LINE_Y),
    court.width,
    court.y + court.height - mapY(SHORT_LINE_Y),
  );
  context.strokeStyle = '#d7fbff';
  context.lineWidth = 2;
  context.strokeRect(court.x, court.y, court.width, court.height);
  const shortY = mapY(SHORT_LINE_Y);
  context.beginPath();
  context.moveTo(court.x, shortY);
  context.lineTo(court.x + court.width, shortY);
  context.moveTo(court.x + court.width / 2, shortY);
  context.lineTo(court.x + court.width / 2, court.y + court.height);
  context.strokeStyle = '#8bc5ce';
  context.lineWidth = 1.5;
  context.stroke();

  context.font = '800 11px system-ui';
  context.textAlign = 'center';
  context.fillStyle = '#b8dce1';
  context.fillText('正面牆・前場', court.x + court.width / 2, 14);
  context.fillText('後場・後方玻璃', court.x + court.width / 2, height - 5);
  context.save();
  context.textAlign = 'left';
  context.fillStyle = '#8fb5b9';
  context.font = '800 9px system-ui';
  context.fillText('前場', court.x + 5, mapY(1.5));
  context.fillText('中場', court.x + 5, mapY(4.2));
  context.fillText('後場', court.x + 5, mapY(7.5));
  context.restore();

  const sets = [
    { points: matchStats.you.landings, color: '#65e8ff' },
    { points: matchStats.ai.landings, color: '#ffc857' },
  ];
  context.globalCompositeOperation = 'lighter';
  for (const set of sets) {
    for (const point of set.points) {
      const x = mapX(point.x);
      const y = mapY(point.y);
      const halo = context.createRadialGradient(x, y, 1, x, y, 16);
      halo.addColorStop(0, `${set.color}8f`);
      halo.addColorStop(0.35, `${set.color}42`);
      halo.addColorStop(1, `${set.color}00`);
      context.fillStyle = halo;
      context.beginPath();
      context.arc(x, y, 16, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalCompositeOperation = 'source-over';
  for (const set of sets) {
    for (const point of set.points) {
      context.fillStyle = point.actual ? set.color : '#0a2931';
      context.strokeStyle = point.actual ? '#031015' : set.color;
      context.lineWidth = point.actual ? 1.5 : 2.5;
      context.beginPath();
      context.arc(mapX(point.x), mapY(point.y), 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }
}

function renderReasonBars(
  container: HTMLElement,
  player: PlayerId,
  outcome: 'win' | 'loss',
): void {
  const counts = new Map<string, number>();
  for (const point of pointRecords) {
    if (point[outcome === 'win' ? 'winner' : 'loser'] !== player) continue;
    const label = point.analysis.type;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  container.replaceChildren();
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maximum = Math.max(1, ...entries.map(([, count]) => count));
  for (const [reason, count] of entries) {
    const row = document.createElement('div');
    row.className = 'reason-row';
    const label = document.createElement('span');
    label.textContent = reason;
    const track = document.createElement('span');
    track.className = 'reason-track';
    const fill = document.createElement('span');
    fill.className = 'reason-fill';
    fill.style.width = `${(count / maximum) * 100}%`;
    track.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'reason-count';
    value.textContent = `${count}`;
    row.append(label, track, value);
    container.appendChild(row);
  }
}

function renderMatchRhythm(): void {
  const totalRallies = pointRecords.reduce((sum, point) => sum + point.rally, 0);
  const averageRally = pointRecords.length ? totalRallies / pointRecords.length : 0;
  const longestRally = Math.max(0, ...pointRecords.map((point) => point.rally));
  const serveWins = pointRecords.filter((point) => point.winner === point.server).length;
  const serveWinRate = pointRecords.length ? (serveWins / pointRecords.length) * 100 : 0;
  const landings = [...matchStats.you.landings, ...matchStats.ai.landings];
  const backCourtLandings = landings.filter((point) => point.y >= SHORT_LINE_Y).length;
  const frontCourtLandings = landings.filter((point) => point.y <= 3.05).length;
  const backCourtRate = landings.length ? (backCourtLandings / landings.length) * 100 : 0;
  const frontCourtRate = landings.length ? (frontCourtLandings / landings.length) * 100 : 0;
  const depthByKind = new Map<ShotKind, number[]>();
  for (const landing of landings) {
    const depths = depthByKind.get(landing.kind) ?? [];
    depths.push(landing.y);
    depthByKind.set(landing.kind, depths);
  }
  const averageDepth = (kind: ShotKind): number | null => {
    const depths = depthByKind.get(kind);
    return depths?.length
      ? depths.reduce((sum, depth) => sum + depth, 0) / depths.length
      : null;
  };
  const kindLabels: Record<ShotKind, string> = {
    drive: '平抽',
    drop: '小球',
    lob: '高吊',
    boast: '側牆',
    glass: '玻璃',
  };
  landingDepthSummaryEl.replaceChildren();
  for (const kind of ['drive', 'drop', 'lob', 'boast', 'glass'] as const) {
    const item = document.createElement('span');
    const depth = averageDepth(kind);
    item.textContent = `${kindLabels[kind]} ${depth === null ? '—' : `${depth.toFixed(1)}m`}`;
    landingDepthSummaryEl.appendChild(item);
  }
  const kinds = new Set<ShotKind>();
  for (const id of ['you', 'ai'] as const) {
    for (const [kind, count] of Object.entries(matchStats[id].shotKinds) as [ShotKind, number][]) {
      if (count > 0) kinds.add(kind);
    }
  }

  reportAverageRallyEl.textContent = averageRally.toFixed(1);
  reportLongestRallyEl.textContent = `${longestRally}`;
  reportServeWinRateEl.textContent = `${Math.round(serveWinRate)}%`;
  reportShotVarietyEl.textContent = `${kinds.size} / 5`;
  reportBackCourtRateEl.textContent = `${Math.round(backCourtRate)}%`;
  reportFrontCourtRateEl.textContent = `${Math.round(frontCourtRate)}%`;

  const notes: string[] = [];
  if (averageRally < 5) notes.push('平均回合偏短');
  if (longestRally < 10) notes.push('缺少長回合');
  if (averageRally > 11) notes.push('平均回合過長');
  if (serveWinRate < 52 || serveWinRate > 68) notes.push('發球優勢失衡');
  if (kinds.size < 4) notes.push('球路變化不足');
  if (backCourtRate < 35 || backCourtRate > 72) notes.push('後場落點比例失衡');
  if (frontCourtRate < 18 || frontCourtRate > 55) notes.push('前場落點比例失衡');
  const driveDepth = averageDepth('drive');
  const dropDepth = averageDepth('drop');
  const lobDepth = averageDepth('lob');
  const boastDepth = averageDepth('boast');
  const glassDepth = averageDepth('glass');
  if (driveDepth !== null && driveDepth < 5.4) notes.push('平抽落點過淺');
  if (lobDepth !== null && lobDepth < 6.4) notes.push('高吊落點過淺');
  if (dropDepth !== null && dropDepth > 2.2) notes.push('小球落點過深');
  if (boastDepth !== null && (boastDepth < 2.7 || boastDepth > 5.2)) {
    notes.push('側牆落點失衡');
  }
  if (glassDepth !== null && glassDepth > 3.1) notes.push('後玻璃落點過深');
  const totalShots = matchStats.you.shots + matchStats.ai.shots;
  const glassShots = matchStats.you.glass + matchStats.ai.glass;
  const lowQualityShots = matchStats.you.lowQuality + matchStats.ai.lowQuality;
  const dropShots = matchStats.you.shotKinds.drop + matchStats.ai.shotKinds.drop;
  const boastShots = matchStats.you.shotKinds.boast + matchStats.ai.shotKinds.boast;
  const lengthShots =
    matchStats.you.shotKinds.drive +
    matchStats.ai.shotKinds.drive +
    matchStats.you.shotKinds.lob +
    matchStats.ai.shotKinds.lob;
  if (totalShots && glassShots / totalShots > 0.18) notes.push('後玻璃使用率過高');
  if (totalShots && dropShots / totalShots > 0.3) notes.push('小球使用率過高');
  if (totalShots && boastShots / totalShots < 0.06) notes.push('側牆球使用率過低');
  if (totalShots && lengthShots / totalShots < 0.45) notes.push('深球使用率過低');
  if (totalShots && lowQualityShots / totalShots > 0.3) notes.push('勉強回球比例過高');
  const tinFaults = pointRecords.filter((point) => point.reason === '下界板').length;
  if (pointRecords.length && tinFaults / pointRecords.length > 0.25) {
    notes.push('下界板失分比例過高');
  }
  reportBalanceNoteEl.textContent = notes.length
    ? `平衡觀察｜${notes.join(' · ')}`
    : '平衡觀察｜節奏、發球權與球路多樣性落在健康區間';
  reportBalanceNoteEl.classList.toggle('warning', notes.length > 0);
}

function renderPointLog(): void {
  pointLogBodyEl.replaceChildren();
  for (const point of pointRecords) {
    const row = document.createElement('tr');
    const number = document.createElement('td');
    number.textContent = `#${point.number}`;
    const winner = document.createElement('td');
    winner.textContent = reportPlayerName(point.winner);
    winner.className = point.winner === 'you' ? 'point-blue' : 'point-gold';
    const loser = document.createElement('td');
    loser.textContent = reportPlayerName(point.loser);
    const servingPlayer = document.createElement('td');
    servingPlayer.textContent = reportPlayerName(point.server);
    const reason = document.createElement('td');
    reason.textContent = point.analysis.type;
    reason.className = 'point-analysis-type';
    const detail = document.createElement('td');
    detail.textContent = point.analysis.detail;
    detail.className = 'point-analysis-detail';
    const rallyCount = document.createElement('td');
    rallyCount.textContent = `${point.rally}`;
    row.append(number, servingPlayer, winner, loser, reason, detail, rallyCount);
    pointLogBodyEl.appendChild(row);
  }
}

function showMatchReport(winner: PlayerId): void {
  reportScoreEl.textContent = `${scores.you} : ${scores.ai}`;
  reportBlueNameEl.textContent = reportPlayerName('you');
  reportGoldNameEl.textContent = reportPlayerName('ai');
  reportBlueResultEl.textContent = winner === 'you' ? 'WIN' : 'LOSE';
  reportGoldResultEl.textContent = winner === 'ai' ? 'WIN' : 'LOSE';
  populatePlayerStats('you');
  populatePlayerStats('ai');
  renderMatchRhythm();
  drawLandingMap();
  renderReasonBars(blueWinReasonsEl, 'you', 'win');
  renderReasonBars(blueLossReasonsEl, 'you', 'loss');
  renderReasonBars(goldWinReasonsEl, 'ai', 'win');
  renderReasonBars(goldLossReasonsEl, 'ai', 'loss');
  renderPointLog();
  matchReportEl.setAttribute('aria-hidden', 'false');
  matchReportEl.classList.add('show');
  reportRematchEl.focus();
}

function exportMatchData(): void {
  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    mode: gameMode,
    difficulty: aiLevel,
    ballSpeed,
    score: { ...scores },
    winner: matchWinner,
    players: {
      you: { name: reportPlayerName('you'), ...matchStats.you },
      ai: { name: reportPlayerName('ai'), ...matchStats.ai },
    },
    rhythm: {
      averageRally: pointRecords.length
        ? pointRecords.reduce((sum, point) => sum + point.rally, 0) / pointRecords.length
        : 0,
      longestRally: Math.max(0, ...pointRecords.map((point) => point.rally)),
      serveWinRate: pointRecords.length
        ? pointRecords.filter((point) => point.winner === point.server).length / pointRecords.length
        : 0,
      backCourtLandingRate: (() => {
        const landings = [...matchStats.you.landings, ...matchStats.ai.landings];
        return landings.length
          ? landings.filter((point) => point.y >= SHORT_LINE_Y).length / landings.length
          : 0;
      })(),
      frontCourtLandingRate: (() => {
        const landings = [...matchStats.you.landings, ...matchStats.ai.landings];
        return landings.length
          ? landings.filter((point) => point.y <= 3.05).length / landings.length
          : 0;
      })(),
    },
    points: pointRecords,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `squash-match-${scores.you}-${scores.ai}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function resetMatch(): void {
  scores.you = 0;
  scores.ai = 0;
  server = 'you';
  serveSide = -1;
  matchWinner = null;
  lastQuality = 1;
  lastStrategy = '雙方試探站位';
  matchReportEl.setAttribute('aria-hidden', 'true');
  matchReportEl.classList.remove('show');
  resetMatchStats();
  clearAiMemory(aiMemories.you);
  clearAiMemory(aiMemories.ai);
  resetRally(gameNow);
}

reportRematchEl.addEventListener('click', resetMatch);
reportExportEl.addEventListener('click', exportMatchData);

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
  constrainServerToServiceBox(now);
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
