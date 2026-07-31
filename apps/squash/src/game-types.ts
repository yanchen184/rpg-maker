export type PlayerId = 'you' | 'ai';
export type ShotKind = 'drive' | 'drop' | 'lob' | 'boast' | 'glass';

export interface CourtPlayer {
  id: PlayerId;
  x: number;
  y: number;
  energy: number;
  lastSwingAt: number;
  dashUntil: number;
  dashTailUntil: number;
  facing: number;
}

export interface ShotSpec {
  kind: ShotKind;
  targetX: number;
  quality: number;
  pace?: number;
}

export const COURT_WIDTH = 6.4;
export const COURT_LENGTH = 9.75;
export const FRONT_OUT_HEIGHT = 4.57;
export const BACK_OUT_HEIGHT = 2.13;
export const TIN_HEIGHT = 0.48;
export const GRAVITY = 13.8;

export function otherPlayer(id: PlayerId): PlayerId {
  return id === 'you' ? 'ai' : 'you';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function sideOutHeight(y: number): number {
  return FRONT_OUT_HEIGHT - (FRONT_OUT_HEIGHT - BACK_OUT_HEIGHT) * clamp(y / COURT_LENGTH, 0, 1);
}
