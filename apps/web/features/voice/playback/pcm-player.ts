export interface PcmPlaybackWindow {
  readonly startAt: number;
  readonly endAt: number;
  readonly durationSeconds: number;
}

export class Pcm16Player {
  private context: AudioContext | null = null;
  private nextStart = 0;
  private generation = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly markers = new Map<
    AudioBufferSourceNode,
    { cancelled: boolean }
  >();

  constructor(
    private readonly contextFactory: () => AudioContext = () =>
      new AudioContext({ sampleRate: 24_000 }),
  ) {}

  /**
   * 在用户点击 Live 的手势内创建并解锁 AudioContext。
   * 首个 PCM 到达后再初始化会额外增加首音延迟，也更容易撞上浏览器自动播放策略。
   */
  async prepare(): Promise<void> {
    this.context ??= this.contextFactory();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async enqueue(bytes: Uint8Array): Promise<PcmPlaybackWindow | null> {
    if (bytes.byteLength < 2) return null;
    const expectedGeneration = this.generation;
    await this.prepare();
    if (expectedGeneration !== this.generation) return null;
    const context = this.context;
    if (!context) return null;
    const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 32_768;
    }
    const buffer = context.createBuffer(1, samples.length, 24_000);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => this.sources.delete(source);
    this.sources.add(source);
    const startAt = Math.max(context.currentTime, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    return {
      startAt,
      endAt: this.nextStart,
      durationSeconds: buffer.duration,
    };
  }

  /** 在 Web Audio 时钟上放置无声标记，字幕只在对应 PCM 真正开始播放时切换。 */
  scheduleMarker(at: number, callback: () => void): () => void {
    const context = this.context;
    if (!context) return () => undefined;
    const marker = context.createBufferSource();
    marker.buffer = context.createBuffer(1, 1, 24_000);
    marker.connect(context.destination);
    const state = { cancelled: false };
    marker.onended = () => {
      this.markers.delete(marker);
      if (!state.cancelled) callback();
    };
    this.markers.set(marker, state);
    marker.start(Math.max(context.currentTime, at));
    return () => {
      state.cancelled = true;
      this.markers.delete(marker);
      try {
        marker.stop();
      } catch {
        /* 标记已自然结束。 */
      }
    };
  }

  stop(): void {
    this.generation += 1;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* 已自然结束。 */
      }
    }
    this.sources.clear();
    for (const [marker, state] of this.markers) {
      state.cancelled = true;
      try {
        marker.stop();
      } catch {
        /* 标记已自然结束。 */
      }
    }
    this.markers.clear();
    this.nextStart = this.context?.currentTime ?? 0;
  }

  async close(): Promise<void> {
    this.stop();
    await this.context?.close();
    this.context = null;
  }
}
