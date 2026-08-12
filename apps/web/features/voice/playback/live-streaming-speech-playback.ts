import type {
  LiveSpeechSessionClient,
  StreamingSpeechClientHandlers,
} from '../transport';
import type { PcmPlaybackWindow } from './pcm-player';
import type { SemanticSegment } from './semantic-segmentation';
import {
  createLiveSubtitleCues,
  prepareLiveSpeechText,
} from './live-speech-text';
import {
  pcmLevel,
  type LiveSpeechPcmPlayer,
} from './stream-speech-into-player';

interface ScheduledCue {
  readonly atContentSeconds: number;
  readonly text: string;
}

interface ScheduledCursor {
  readonly atContentSeconds: number;
  readonly endCursor: number;
}

export interface LiveStreamingSpeechPlaybackOptions {
  readonly notebookId: string;
  readonly player: LiveSpeechPcmPlayer;
  readonly signal: AbortSignal;
  readonly createClient: (
    handlers: StreamingSpeechClientHandlers,
  ) => LiveSpeechSessionClient;
  readonly onMarker: (at: number, callback: () => void) => void;
  readonly onSubtitle: (text: string) => void;
  readonly onPlayedCursor: (endCursor: number) => void;
  readonly onFirstAudio: () => void;
  readonly onAudioLevel: (level: number) => void;
  readonly onFinished: (lastWindow: PcmPlaybackWindow | null) => void;
  readonly onFailed: (beforeFirstAudio: boolean) => void;
}

/**
 * 一个 Assistant response 复用一个浏览器到 Gateway 的 TTS 会话。
 * Provider PCM 没有可靠的提交归属，因此这里只把文本 cue 投影到同一 Web
 * Audio 时间轴；绝不伪造“某一帧属于某个 submission”的供应商事实。
 */
export class LiveStreamingSpeechPlayback {
  private readonly client: LiveSpeechSessionClient;
  private readonly cues: ScheduledCue[] = [];
  private readonly cursors: ScheduledCursor[] = [];
  private submittedDurationSeconds = 0;
  private queuedContentSeconds = 0;
  private nextCue = 0;
  private nextCursor = 0;
  private lastWindow: PcmPlaybackWindow | null = null;
  private audioChain = Promise.resolve();
  private heardFirstAudio = false;
  private terminal = false;
  private finishing = false;

  constructor(private readonly options: LiveStreamingSpeechPlaybackOptions) {
    this.client = options.createClient({
      onAudio: ({ pcmBytes }) => this.acceptAudio(pcmBytes),
      onFinished: () => this.finishFromServer(),
      onFailed: () => this.fail(),
    });
  }

  start(): Promise<void> {
    return this.client.start({
      notebookId: this.options.notebookId,
      signal: this.options.signal,
    });
  }

  hasHeardAudio(): boolean {
    return this.heardFirstAudio;
  }

  submit(segment: SemanticSegment): boolean {
    if (this.terminal) return false;
    const text = prepareLiveSpeechText(segment.text);
    if (!text) return true;
    const cues = createLiveSubtitleCues(text);
    const base = this.submittedDurationSeconds;
    for (const cue of cues) {
      this.cues.push({
        atContentSeconds: base + cue.startOffsetSeconds,
        text: cue.text,
      });
    }
    const estimatedDuration = cues.reduce(
      (total, cue) => total + cue.estimatedDurationSeconds,
      0,
    );
    this.submittedDurationSeconds += estimatedDuration;
    this.cursors.push({
      atContentSeconds: this.submittedDurationSeconds,
      endCursor: segment.endCursor,
    });
    this.client.submit({
      text,
    });
    return true;
  }

  finish(): void {
    if (this.terminal || this.finishing) return;
    this.finishing = true;
    this.client.finish();
  }

  cancel(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.client.cancel();
  }

  private acceptAudio(bytes: Uint8Array): void {
    if (this.terminal) return;
    this.audioChain = this.audioChain.then(async () => {
      if (this.terminal || this.options.signal.aborted) return;
      const level = pcmLevel(bytes);
      const contentBeforeWindow = this.queuedContentSeconds;
      const window = await this.options.player.enqueue(bytes);
      if (!window || this.terminal || this.options.signal.aborted) return;
      this.lastWindow = window;
      this.queuedContentSeconds += window.durationSeconds;
      this.options.onMarker(window.startAt, () =>
        this.options.onAudioLevel(level),
      );
      if (!this.heardFirstAudio) {
        this.heardFirstAudio = true;
        this.options.onFirstAudio();
      }
      while (
        this.nextCue < this.cues.length &&
        this.cues[this.nextCue]!.atContentSeconds <= this.queuedContentSeconds
      ) {
        const cue = this.cues[this.nextCue++]!;
        this.options.onMarker(
          window.startAt +
            Math.min(
              window.durationSeconds,
              Math.max(0, cue.atContentSeconds - contentBeforeWindow),
            ),
          () => this.options.onSubtitle(cue.text),
        );
      }
      while (
        this.nextCursor < this.cursors.length &&
        this.cursors[this.nextCursor]!.atContentSeconds <=
          this.queuedContentSeconds
      ) {
        const cursor = this.cursors[this.nextCursor++]!;
        this.options.onMarker(window.endAt, () =>
          this.options.onPlayedCursor(cursor.endCursor),
        );
      }
    });
  }

  private finishFromServer(): void {
    if (this.terminal) return;
    void this.audioChain.then(() => {
      if (this.terminal) return;
      this.terminal = true;
      if (this.lastWindow) {
        const lastCursor = this.cursors.at(-1);
        if (lastCursor && this.nextCursor < this.cursors.length) {
          this.options.onMarker(this.lastWindow.endAt, () =>
            this.options.onPlayedCursor(lastCursor.endCursor),
          );
        }
      }
      this.options.onFinished(this.lastWindow);
    });
  }

  private fail(): void {
    if (this.terminal) return;
    this.terminal = true;
    this.options.onFailed(!this.heardFirstAudio);
  }
}
