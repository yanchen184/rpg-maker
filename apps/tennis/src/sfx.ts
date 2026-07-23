/**
 * 音效:WebAudio 即時合成,零音檔素材(短促合成音跟像素風反而搭)。
 * 瀏覽器規定 AudioContext 要使用者手勢後才能出聲 —— 把 unlock() 綁在第一次
 * keydown/pointerdown;還沒解鎖前所有播放呼叫都靜默無害。
 */

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** 綁在使用者手勢事件:第一次互動時建立/恢復 AudioContext */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** 單音:freq 起頻,可滑到 slideTo;delay 秒後開始(和弦/琶音用) */
  private tone(freq: number, type: OscillatorType, dur: number, vol: number, delay = 0, slideTo?: number): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 短噪音爆(擊球「啪」、揮拍風聲的原料) */
  private noise(dur: number, vol: number, filterHz: number, delay = 0): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterHz;
    f.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  /** 擊球:球種不同手感 —— drive 尖銳爆、lob 悶軟、normal 居中 */
  hit(kind: 'lob' | 'drive' | 'normal'): void {
    if (kind === 'drive') {
      this.noise(0.05, 0.85, 2400);
      this.tone(420, 'square', 0.09, 0.35, 0, 150);
    } else if (kind === 'lob') {
      this.noise(0.09, 0.5, 900);
      this.tone(240, 'sine', 0.12, 0.35, 0, 120);
    } else {
      this.noise(0.06, 0.7, 1600);
      this.tone(330, 'square', 0.09, 0.3, 0, 140);
    }
  }

  /** 揮拍風聲(揮空也有,打到再疊 hit) */
  swing(): void {
    this.noise(0.12, 0.22, 620);
  }

  /** 球落地悶響 */
  bounce(): void {
    this.tone(150, 'sine', 0.09, 0.4, 0, 70);
    this.noise(0.04, 0.18, 500);
  }

  /** 得分:自己 = 上行雙音,失分 = 下行;觀戰(mine=null)= 中性單音 */
  point(mine: boolean | null): void {
    if (mine === true) {
      this.tone(660, 'triangle', 0.12, 0.3);
      this.tone(880, 'triangle', 0.16, 0.3, 0.09);
    } else if (mine === false) {
      this.tone(330, 'triangle', 0.14, 0.28);
      this.tone(220, 'triangle', 0.2, 0.28, 0.1);
    } else {
      this.tone(520, 'triangle', 0.14, 0.28);
    }
  }

  /** 一發失誤警示 */
  fault(): void {
    this.tone(200, 'sawtooth', 0.16, 0.22, 0, 140);
  }

  /** 整場結束:贏 = 上行琶音,輸 = 下行 */
  match(win: boolean | null): void {
    const seq = win === false ? [523, 392, 262] : [523, 659, 784, 1047];
    seq.forEach((f, i) => this.tone(f, 'triangle', 0.22, 0.3, i * 0.13));
  }
}
