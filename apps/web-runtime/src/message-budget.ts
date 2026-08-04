/** 单条 iframe 消息允许的最大序列化大小（字节）。 */
export const MAX_RUNTIME_MESSAGE_BYTES = 64 * 1024;
/** 运行时每秒允许的最大消息数（按滑窗1秒统计）。 */
export const MAX_RUNTIME_MESSAGES_PER_SECOND = 30;
/** 运行时单次会话累计输出字节数上限（防止无限制日志/文本增长）。 */
export const MAX_RUNTIME_OUTPUT_BYTES = 1024 * 1024;

/** Runtime 沙箱通信的滑窗速率/输出状态快照（窗口起始与累计计数）。 */
export interface RuntimeMessageBudgetState {
  /** 本窗口的起始时间戳（ms），用于1秒速率滚动。 */
  readonly rateWindowStarted: number;
  /** 当前窗口内已接收消息条数。 */
  readonly rateWindowMessages: number;
  /** 当前窗口内累计输出字节数。 */
  readonly outputBytes: number;
}

/** 预算检查结果；`ok:false` 表示关闭路径并触发桥接失败。 */
export type RuntimeMessageBudgetResult =
  | { readonly ok: true; readonly state: RuntimeMessageBudgetState }
  | { readonly ok: false; readonly code: 'resource_quota_exceeded' };

/**
 * 以“窗口化速率 + 累计输出”双重约束执行预算扣减。
 * - 输入参数与状态都经过严格数值校验，非法数值直接拒绝（fail-closed）。
 * - 新窗口在 1000ms 到达后重置速率计数，但输出累计按状态连续累积。
 * - 返回的 state 是下一轮处理用的新状态；调用方必须持久化状态。
 */
export function consumeRuntimeMessageBudget(
  state: RuntimeMessageBudgetState,
  input: {
    readonly now: number;
    readonly messageBytes: number;
    readonly outputBytes: number;
  },
): RuntimeMessageBudgetResult {
  if (
    !Number.isSafeInteger(input.messageBytes) ||
    !Number.isSafeInteger(input.outputBytes) ||
    input.messageBytes < 0 ||
    input.outputBytes < 0 ||
    input.messageBytes > MAX_RUNTIME_MESSAGE_BYTES
  ) {
    return { ok: false, code: 'resource_quota_exceeded' };
  }
  const newWindow = input.now - state.rateWindowStarted >= 1_000;
  const rateWindowMessages = newWindow ? 1 : state.rateWindowMessages + 1;
  const outputBytes = state.outputBytes + input.outputBytes;
  if (
    rateWindowMessages > MAX_RUNTIME_MESSAGES_PER_SECOND ||
    outputBytes > MAX_RUNTIME_OUTPUT_BYTES
  ) {
    return { ok: false, code: 'resource_quota_exceeded' };
  }
  return {
    ok: true,
    state: {
      rateWindowStarted: newWindow ? input.now : state.rateWindowStarted,
      rateWindowMessages,
      outputBytes,
    },
  };
}
