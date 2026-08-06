/**
 * 多轮会话生命周期（V17-B REVISE）— useVoiceSession 的引用管理核心。
 *
 * ## 为什么存在
 *
 * 同一组件必须能完成一轮语音会话后再 start 第二轮（例如短句模式说完一句
 * 再录下一句）。控制器本身是会话级、一次性的；本类管理"当前活跃控制器"
 * 的引用生命周期：
 *
 * - `start` 只在没有活跃会话时创建新控制器（已有活跃会话返回 null）；
 * - `handleStatus` 在终态（stopped / cancelled / failed）到达时立即释放
 *   活跃引用，允许下一次 start 重建；
 * - `dispose` 清理活跃会话（卸载/能力撤销/模式切换），幂等。
 *
 * 事件隔离：旧控制器终态后 `settle` 已锁存（迟到事件全部 no-op），新会话
 * 是新实例——第二轮的 partial/error/status 只流向自己的回调，不会污染上一轮。
 *
 * ## 纪律
 *
 * - 不保存 PCM、文本、ticket 或凭证；
 * - 本类不读取浏览器 API，SSR 安全（hook 仅在 ref 中持有实例）。
 */

import type { VoiceSessionController } from './voice-session-controller';
import type { VoiceSessionStatus } from './voice-session-controller';

/** 终态集合：一轮会话结束（无论成败）后释放活跃引用。 */
const TERMINAL_STATUSES: readonly VoiceSessionStatus[] = [
  'stopped',
  'cancelled',
  'failed',
];

/**
 * 会话引用生命周期。泛型仅要求控制器可 dispose，测试可注入 fake。
 */
export class VoiceSessionLifecycle<
  TController extends { dispose(): void } = VoiceSessionController,
> {
  private active: TController | null = null;

  /** 启动新会话；已有活跃会话（未终态）时返回 null。 */
  start(create: () => TController): TController | null {
    if (this.active !== null) return null;
    const controller = create();
    this.active = controller;
    return controller;
  }

  /** 状态回调：终态后释放活跃引用，允许下一次 start。 */
  handleStatus(status: VoiceSessionStatus): void {
    if (TERMINAL_STATUSES.includes(status)) this.active = null;
  }

  /** 清理活跃会话并释放引用（幂等）。 */
  dispose(): void {
    this.active?.dispose();
    this.active = null;
  }

  /** 当前活跃会话（测试/调试用）。 */
  get activeController(): TController | null {
    return this.active;
  }
}
