export type LiveInterruptionTurnId = string | number;

export interface LiveInterruptionFinalPayload<TContext> {
  readonly generation: number;
  readonly text: string;
  readonly context: TContext;
}

export interface LiveInterruptionCoordinatorAction<TContext> {
  readonly type: 'submit';
  readonly generation: number;
  readonly text: string;
  readonly context: TContext;
}

export interface LiveInterruptionCoordinatorActionCancel {
  readonly type: 'cancel-agent';
  readonly turnId: LiveInterruptionTurnId;
}

export type LiveInterruptionCoordinatorDecision<TContext> =
  | LiveInterruptionCoordinatorAction<TContext>
  | LiveInterruptionCoordinatorActionCancel;

type LiveInterruptionCoordinatorInternalAction<TContext> =
  LiveInterruptionCoordinatorDecision<TContext> | { readonly type: 'none' };

interface LiveInterruptionCoordinatorQueuedFinal<TContext> {
  readonly generation: number;
  readonly text: string;
  readonly context: TContext;
  readonly busyTurnId: LiveInterruptionTurnId;
}

/** L06 插话协调器状态：纯内核，不持久化、不接 React。 */
export interface LiveInterruptionCoordinatorState<TContext> {
  /**
   * 运行中 ASR 的本地 generation。`generation` 递增；较旧回调会被直接丢弃。
   */
  readonly asrGeneration: number;
  /**
   * 当前 Assistant/busy turn 的身份，`turnId` 变化即表示新一轮展示。
   * 该字段用于防止旧的 cancel 回调误打断新的 turn。
   */
  readonly busyTurnId: LiveInterruptionTurnId | null;
  /**
   * 每个 busy turn 至多 cancel 一次，重复插话不再重复打断 Agent。
   */
  readonly cancelIssuedForTurnId: LiveInterruptionTurnId | null;
  /**
   * 最新一次“处理过”的 final generation（submit 或 queue），用于 first-wins 去重。
   */
  readonly handledGeneration: number;
  /**
   * busy 中暂存最新最终转写。恢复 old turn 空闲后只提交该条（最后到达者）。
   */
  readonly pendingFinal: LiveInterruptionCoordinatorQueuedFinal<TContext> | null;
}

export const INITIAL_LIVE_INTERRUPTION_COORDINATOR_STATE = <
  TContext,
>(): LiveInterruptionCoordinatorState<TContext> => ({
  asrGeneration: 0,
  busyTurnId: null,
  cancelIssuedForTurnId: null,
  handledGeneration: 0,
  pendingFinal: null,
});

/**
 * L06 纯逻辑：不管 UI、不管 transport，只在事件层面协调：
 * - 忽略迟到/重复回调
 * - 忙态下先 cancel（最多一次）再排队
 * - busy 结束后只提交排队中的最新 final
 */
export class LiveInterruptionCoordinator<TContext> {
  private state: LiveInterruptionCoordinatorState<TContext>;

  constructor(
    initialState: LiveInterruptionCoordinatorState<TContext> = INITIAL_LIVE_INTERRUPTION_COORDINATOR_STATE(),
  ) {
    this.state = initialState;
  }

  /** 获取当前快照；调用方可安全读取用于测试或边界日志。 */
  getState(): LiveInterruptionCoordinatorState<TContext> {
    return this.state;
  }

  /** 每次开始一段新的 ASR 之前调用，返回可用于回调的 generation。 */
  beginAsrTurn(): number {
    const nextGeneration = this.state.asrGeneration + 1;
    this.state = { ...this.state, asrGeneration: nextGeneration };
    return nextGeneration;
  }

  /**
   * 有效用户 partial 一出现就取消当前 Agent turn；ASR final 只负责排队下一轮。
   * 同一 turn 的重复 partial 共用 cancel guard，最多产生一次副作用。
   */
  onBargeIn(): readonly LiveInterruptionCoordinatorDecision<TContext>[] {
    const activeTurn = this.state.busyTurnId;
    if (
      activeTurn === null ||
      this.state.cancelIssuedForTurnId === activeTurn
    ) {
      return [];
    }
    this.state = { ...this.state, cancelIssuedForTurnId: activeTurn };
    return [{ type: 'cancel-agent', turnId: activeTurn }];
  }

  /**
   * busy 进退场。
   * - 进入 busy：记录 turn 并清空旧 pending（旧 turn 缓存不得污染新 turn）。
   * - 退出 busy：如果有 pending，则提交当前 turn 的最新 final。
   */
  setBusy(params: {
    readonly busy: boolean;
    readonly turnId: LiveInterruptionTurnId | null;
  }): readonly LiveInterruptionCoordinatorDecision<TContext>[] {
    if (!params.busy) {
      if (this.state.pendingFinal === null) {
        this.state = {
          ...this.state,
          busyTurnId: null,
          cancelIssuedForTurnId: null,
        };
        return [];
      }

      const submit = this.state.pendingFinal;
      this.state = {
        ...this.state,
        busyTurnId: null,
        cancelIssuedForTurnId: null,
        pendingFinal: null,
      };
      return [this.toSubmitAction(submit)];
    }

    if (params.turnId === null) return [];

    // turn 切换时重置 cancel guard；旧 turn 的 queued final 不应提交到新 turn。
    if (this.state.busyTurnId !== params.turnId) {
      this.state = {
        ...this.state,
        busyTurnId: params.turnId,
        cancelIssuedForTurnId: null,
        pendingFinal:
          this.state.pendingFinal?.busyTurnId === params.turnId
            ? this.state.pendingFinal
            : null,
      };
      return [];
    }

    return [];
  }

  /** 接收 ASR final；生成 action 供上层执行（submit/cancel）。 */
  onAsrFinal(
    payload: LiveInterruptionFinalPayload<TContext>,
  ): readonly LiveInterruptionCoordinatorDecision<TContext>[] {
    const normalizedGeneration = Math.max(payload.generation, 1);
    const shouldIgnoreGeneration =
      normalizedGeneration <= this.state.handledGeneration;
    if (shouldIgnoreGeneration) {
      // first-wins：已处理过的 generation 不再重复触发 side-effect。
      this.state = {
        ...this.state,
        asrGeneration: Math.max(this.state.asrGeneration, normalizedGeneration),
      };
      return [];
    }

    this.state = {
      ...this.state,
      asrGeneration: Math.max(this.state.asrGeneration, normalizedGeneration),
      handledGeneration: normalizedGeneration,
    };

    const activeTurn = this.state.busyTurnId;
    if (activeTurn === null) {
      // 未 busy 时直接提交 final，不产生 pending，也不清空 assistant 文本。
      return [this.toSubmitAction(payload)];
    }

    // busy 中只对新 turn 执行一次 cancel，避免重复打断。
    const actions: LiveInterruptionCoordinatorInternalAction<TContext>[] = [];
    if (this.state.cancelIssuedForTurnId !== activeTurn) {
      actions.push({ type: 'cancel-agent', turnId: activeTurn });
      this.state = { ...this.state, cancelIssuedForTurnId: activeTurn };
    }

    // 等待 busy 结束只提交最新 final（按 generation 递增，后到先用）。
    const pending = this.state.pendingFinal;
    const hasNewerPending =
      pending === null ||
      pending.generation < normalizedGeneration ||
      pending.busyTurnId !== activeTurn;
    if (hasNewerPending) {
      this.state = {
        ...this.state,
        pendingFinal: {
          generation: normalizedGeneration,
          text: payload.text,
          context: payload.context,
          busyTurnId: activeTurn,
        },
      };
    }

    return actions.filter(
      (action): action is LiveInterruptionCoordinatorDecision<TContext> =>
        action.type !== 'none',
    );
  }

  private toSubmitAction(
    payload: LiveInterruptionFinalPayload<TContext>,
  ): LiveInterruptionCoordinatorAction<TContext> {
    return {
      type: 'submit',
      generation: payload.generation,
      text: payload.text,
      context: payload.context,
    };
  }
}
