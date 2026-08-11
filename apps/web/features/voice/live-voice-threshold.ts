/**
 * Live Voice 门槛相位机（茶室的躙り口）。
 *
 * desk → entering → voice → exiting → desk 是唯一合法环路：
 * - entering 完成前不得启动 voice session（先过门，再落座）；
 * - entering 期间用户取消直接退回 desk，桌面不留半成品；
 * - exiting 单向不可中断，任何关闭入口（按钮/Esc/遮罩）都汇入同一条 EXIT。
 *
 * 本模块纯逻辑、不触 DOM，rect 捕获与 GSAP 编排在 use-live-voice-motion 侧。
 */

export type LiveVoiceThresholdPhase = 'desk' | 'entering' | 'voice' | 'exiting';

export type LiveVoiceThresholdEvent =
  'ENTER' | 'ENTERED' | 'ENTER_FAILED' | 'EXIT' | 'EXITED';

/** 非法迁移一律保持原相位——settled 守卫：已终态的转场不被迟到的事件改写。 */
const TRANSITIONS: Readonly<
  Record<
    LiveVoiceThresholdPhase,
    Partial<Record<LiveVoiceThresholdEvent, LiveVoiceThresholdPhase>>
  >
> = {
  desk: { ENTER: 'entering' },
  entering: { ENTERED: 'voice', ENTER_FAILED: 'desk', EXIT: 'desk' },
  voice: { EXIT: 'exiting' },
  exiting: { EXITED: 'desk' },
};

export function reduceLiveVoiceThreshold(
  phase: LiveVoiceThresholdPhase,
  event: LiveVoiceThresholdEvent,
): LiveVoiceThresholdPhase {
  return TRANSITIONS[phase][event] ?? phase;
}

/** 可序列化的矩形快照（DOMRect 不直接进 state，避免引用活节点）。 */
export interface LiveVoiceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 入室捕获：启动按钮位置 + 桌面上可定位的语境资产位置。
 * 与 freezeLiveVoiceContext 同帧执行——同一帧冻结数据和位置。
 */
export interface LiveVoiceEntryCapture {
  readonly buttonRect: LiveVoiceRect | null;
  readonly assetRects: Readonly<Record<string, LiveVoiceRect>>;
}

export function toLiveVoiceRect(rect: DOMRect): LiveVoiceRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * 捕获入口现场。资产定位走通用查询：桌面上任何带
 * `data-live-asset="<assetId>"` 的元素都视为那张纸的当前位置；
 * 没有标记的资产不飞行，由舞台自身的入场动画承接（优雅降级，不造假）。
 */
export function captureLiveVoiceEntry(
  button: HTMLElement | null,
  root: ParentNode = document,
): LiveVoiceEntryCapture {
  const assetRects: Record<string, LiveVoiceRect> = {};
  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-live-asset]',
  )) {
    const assetId = element.dataset.liveAsset;
    if (!assetId) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    assetRects[assetId] = toLiveVoiceRect(rect);
  }
  return {
    buttonRect: button ? toLiveVoiceRect(button.getBoundingClientRect()) : null,
    assetRects,
  };
}

/** 飞行位移：从 captured 中心到 target 中心的 translate 差值。 */
export function computeFlyDelta(
  captured: LiveVoiceRect,
  target: LiveVoiceRect,
): { readonly dx: number; readonly dy: number } {
  return {
    dx: captured.x + captured.width / 2 - (target.x + target.width / 2),
    dy: captured.y + captured.height / 2 - (target.y + target.height / 2),
  };
}
