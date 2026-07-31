import type { ShotKind } from './game-types';

export class SquashSfx {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  hit(kind: ShotKind, quality: number): void {
    const base =
      kind === 'drop' ? 760 : kind === 'lob' ? 280 : kind === 'boast' ? 460 : kind === 'glass' ? 390 : 560;
    this.noise(0.045, 0.45 + quality * 0.4, 2300);
    this.tone(base, 'square', 0.07, 0.2 + quality * 0.18, base * 0.38);
  }

  wall(front: boolean): void {
    this.tone(front ? 210 : 160, 'sine', 0.07, front ? 0.28 : 0.16, 85);
  }

  floor(): void {
    this.tone(110, 'sine', 0.07, 0.18, 60);
  }

  dash(): void {
    this.noise(0.16, 0.24, 500);
  }

  point(won: boolean): void {
    const notes = won ? [620, 820] : [330, 210];
    notes.forEach((note, index) => this.tone(note, 'triangle', 0.15, 0.25, note * 0.9, index * 0.1));
  }

  private tone(
    frequency: number,
    type: OscillatorType,
    duration: number,
    volume: number,
    slideTo: number,
    delay = 0,
  ): void {
    if (!this.context || !this.master || this.context.state !== 'running') return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, frequency: number): void {
    if (!this.context || !this.master || this.context.state !== 'running') return;
    const samples = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, samples, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * (1 - index / samples);
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }
}
