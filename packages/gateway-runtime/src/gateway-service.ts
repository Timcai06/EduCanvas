/**
 * Gateway Service — Gateway 协议的中央编排引擎。
 *
 * ## 请求生命周期
 *
 * ```
 * Inbound Envelope → Route Resolution → Idempotency Check → Turn Runner → Event Projection → Outbound Events
 *                      │                      │                   │
 *                      └─ 身份→路由映射       └─ 重放已有事件     └─ 调用 TurnApplicationService
 * ```
 *
 * ## 幂等
 *
 * 同一 idempotencyKey 的重复请求直接回放已持久化事件（replayed=true），
 * 不重新执行 Turn Runner。指纹不匹配时拒绝（IDEMPOTENCY_CONFLICT）。
 *
 * ## 取消
 *
 * GatewayCancellationRegistry 管理跨 Operation 的 AbortSignal。
 * 客户端取消请求通过独立的 cancel() 方法处理，不在主 handle() 路径。
 */

import {
  gatewayInboundEnvelopeSchema,
  isGatewayTerminalEvent,
  type GatewayInboundEnvelope,
  type GatewayOperationEvent,
} from '@educanvas/gateway-core';
import { GatewayCancellationRegistry } from './cancellation';
import { GatewayRuntimeError } from './errors';
import type {
  GatewayEventPayload,
  GatewayOperationStorePort,
  GatewayRequestFingerprintPort,
  GatewayRouteResolverPort,
  GatewayTurnRunnerPort,
} from './ports';

const failurePayload = (
  code: Extract<GatewayEventPayload, { type: 'operation.failed' }>['code'],
): Extract<GatewayEventPayload, { type: 'operation.failed' }> => ({
  type: 'operation.failed',
  code,
  retryable: code === 'RUNTIME_FAILED' || code === 'RATE_LIMITED',
});

export class GatewayService {
  constructor(
    private readonly routeResolver: GatewayRouteResolverPort,
    private readonly operationStore: GatewayOperationStorePort,
    private readonly turnRunner: GatewayTurnRunnerPort,
    private readonly fingerprint: GatewayRequestFingerprintPort,
    private readonly now: () => Date = () => new Date(),
    private readonly cancellation: GatewayCancellationRegistry = new GatewayCancellationRegistry(),
  ) {}

  async *handle(rawEnvelope: unknown): AsyncIterable<GatewayOperationEvent> {
    const envelope = gatewayInboundEnvelopeSchema.parse(rawEnvelope);
    const route = await this.routeResolver.resolve({
      principal: envelope.principal,
      routeHint: envelope.routeHint,
      requiredPermission: 'conversation.reply',
      now: this.now(),
    });
    if (
      route.actorUserId !== envelope.principal.userId ||
      route.agentId !== envelope.principal.agentId
    ) {
      throw new GatewayRuntimeError(
        'FORBIDDEN',
        'Resolved route does not belong to the authenticated principal',
      );
    }

    const operation = await this.operationStore.begin({
      envelopeId: envelope.envelopeId,
      idempotencyKey: envelope.idempotencyKey,
      requestFingerprint: this.fingerprint.fingerprint(envelope),
      route,
      now: this.now(),
    });

    if (operation.replayed) {
      for (const event of await this.operationStore.listEvents(
        operation.operationId,
        -1,
        route.actorUserId,
      )) {
        yield event.type === 'message.started'
          ? { ...event, replayed: true }
          : event;
      }
      return;
    }

    yield await this.operationStore.append(
      operation.operationId,
      { type: 'operation.accepted' },
      this.now(),
    );

    /* 登记中止信号，使 requestCancel 能打断本循环。abort 与 runner 事件竞速：
       慢 Provider 阻塞在 next() 时也能即时取消，而不必等下一个 token。 */
    const signal = this.cancellation.register(operation.operationId);
    const abortSignal: Promise<'aborted'> = new Promise((resolve) => {
      if (signal.aborted) resolve('aborted');
      else
        signal.addEventListener('abort', () => resolve('aborted'), {
          once: true,
        });
    });

    let terminalSeen = false;
    let approvalPending = false;
    const iterator = this.turnRunner
      .run({
        operationId: operation.operationId,
        traceId: operation.traceId,
        envelope,
        route,
        signal,
      })
      [Symbol.asyncIterator]();
    try {
      while (true) {
        const step = await Promise.race([iterator.next(), abortSignal]);
        if (step === 'aborted') {
          /* 不 await runner 清理：它可能正阻塞在自己的 await（慢 Provider），
             async generator 的方法调用是串行的，await return 会一直挂到那个
             await 完成，形成死锁。fire-and-forget 让它自行收尾。 */
          void iterator.return?.(undefined)?.catch(() => undefined);
          if (!terminalSeen) {
            terminalSeen = true;
            yield await this.operationStore.append(
              operation.operationId,
              { type: 'operation.cancelled' },
              this.now(),
            );
          }
          break;
        }
        if (step.done) break;
        const event = await this.operationStore.append(
          operation.operationId,
          step.value,
          this.now(),
        );
        yield event;
        if (isGatewayTerminalEvent(event)) {
          terminalSeen = true;
          break;
        }
        if (event.type === 'approval.required') approvalPending = true;
      }
    } catch {
      if (!terminalSeen) {
        terminalSeen = true;
        yield await this.operationStore.append(
          operation.operationId,
          failurePayload('RUNTIME_FAILED'),
          this.now(),
        );
      }
    } finally {
      this.cancellation.release(operation.operationId);
    }

    if (!terminalSeen && !approvalPending) {
      yield await this.operationStore.append(
        operation.operationId,
        failurePayload('RUNTIME_FAILED'),
        this.now(),
      );
    }
  }

  /**
   * 请求取消一个运行中操作。鉴权后触发中止信号；实际的
   * `operation.cancelled` 事件由该操作自己的 handle 循环追加，
   * 通过既有事件流回到客户端——取消不另开一条终态写入路径。
   *
   * 幂等：已终态返回其状态；continuation由PostgreSQL/Worker跨进程终结，
   * 普通Turn仍由本进程AbortSignal终结。两边都不存在活动执行者时返回not_running。
   */
  async requestCancel(input: {
    operationId: string;
    principalUserId: string;
  }): Promise<{
    status: 'cancelling' | 'not_running' | 'completed' | 'failed' | 'cancelled';
  }> {
    const descriptor = await this.operationStore.describe(
      input.operationId,
      input.principalUserId,
      this.now(),
    );
    if (!descriptor) {
      throw new GatewayRuntimeError(
        'OPERATION_NOT_FOUND',
        'Operation not found',
      );
    }
    if (descriptor.actorUserId !== input.principalUserId) {
      throw new GatewayRuntimeError('FORBIDDEN', 'Operation access denied');
    }
    if (descriptor.status !== 'running') return { status: descriptor.status };
    const persisted = await this.operationStore.requestCancellation({
      operationId: input.operationId,
      actorUserId: input.principalUserId,
      now: this.now(),
    });
    if (!persisted.recorded) return { status: 'not_running' };
    const interruptedLocally = this.cancellation.cancel(input.operationId);
    if (persisted.continuation === 'cancelled') {
      return { status: 'cancelled' };
    }
    if (interruptedLocally || persisted.continuation === 'running') {
      return { status: 'cancelling' };
    }
    return { status: 'not_running' };
  }

  async resume(input: {
    operationId: string;
    afterSequence: number;
    principalUserId: string;
  }): Promise<readonly GatewayOperationEvent[]> {
    return this.operationStore.listEvents(
      input.operationId,
      input.afterSequence,
      input.principalUserId,
      this.now(),
    );
  }
}

export type { GatewayInboundEnvelope };
