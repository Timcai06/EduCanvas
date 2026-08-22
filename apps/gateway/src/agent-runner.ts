/**
 * Gateway Agent Turn Runner（R 线 R06）。
 *
 * Gateway 入口只负责把可信路由投影成统一命令，再把统一事件投影回 Gateway 事件。
 * 公共依赖装配全部委托给 `./turn-composition.ts`，本文件不直接实例化
 * Drizzle Repository、ToolKernel 或 Telemetry。
 *
 * 测试可通过构造函数注入 Application 工厂绕过真实 DB 依赖。
 */
import type { AgentMessagePart, ModelAbortSignal } from '@educanvas/agent-core';
import type { TurnApplicationPort } from '@educanvas/agent-runtime';
import type {
  GatewayInboundEnvelope,
  GatewayResolvedRoute,
} from '@educanvas/gateway-core';
import {
  projectTurnApplicationEventToGateway,
  type GatewayEventPayload,
  type GatewayTurnRunnerPort,
} from '@educanvas/gateway-runtime';
import {
  createGatewayDependencies,
  createGatewayTurnApplication,
  type GatewayDependencies,
} from './turn-composition';

type ApplicationFactory = (input: {
  signal: ModelAbortSignal;
  route: GatewayResolvedRoute;
}) => TurnApplicationPort;

const SUPPORTED_GATEWAY_PROFILE_ID = 'general';

/** Gateway只负责把可信路由投影成统一命令，再把统一事件投影回Gateway事件。 */
export class GatewayAgentTurnRunner implements GatewayTurnRunnerPort {
  private readonly createApplication: ApplicationFactory;
  /**
   * 是否启用了 asset_ref 物化（DP10）。依赖对象显式注入 materializer 时才允许
   * asset_ref 进入命令；裸工厂/未注入时保留硬拒绝语义，避免能力清单未升级前
   * 桌面声明的 input.image/input.file 被静默吞掉。
   */
  private readonly assetMaterializerActive: boolean;

  constructor(
    depsOrFactory:
      GatewayDependencies | ApplicationFactory = createGatewayDependencies(),
  ) {
    this.assetMaterializerActive =
      typeof depsOrFactory === 'function'
        ? false
        : depsOrFactory.assetMaterializer !== undefined &&
          depsOrFactory.assetMaterializer !== null;
    this.createApplication =
      typeof depsOrFactory === 'function'
        ? depsOrFactory
        : (input) => createGatewayTurnApplication(depsOrFactory, input);
  }

  async *run(
    input: Parameters<GatewayTurnRunnerPort['run']>[0],
  ): AsyncIterable<GatewayEventPayload> {
    if (input.route.agentProfileId !== SUPPORTED_GATEWAY_PROFILE_ID) {
      yield {
        type: 'operation.failed',
        code: 'CAPABILITY_UNAVAILABLE',
        retryable: false,
      };
      return;
    }
    const allowedPartTypes = this.assetMaterializerActive
      ? new Set<string>(['text', 'asset_ref'])
      : new Set<string>(['text']);
    if (input.envelope.parts.some((part) => !allowedPartTypes.has(part.type))) {
      yield {
        type: 'operation.failed',
        code: 'CAPABILITY_UNAVAILABLE',
        retryable: false,
      };
      return;
    }
    const command = {
      protocol: 'educanvas.turn.v2' as const,
      operationId: input.operationId,
      traceId: input.traceId,
      actor: {
        actorId: input.route.actorUserId,
        agentId: input.route.agentId,
      },
      notebook: {
        notebookId: input.route.notebookId,
        conversationId: input.route.conversationId,
      },
      profile: { profileId: input.route.agentProfileId },
      entrypoint: toEntrypoint(input.envelope),
      input: {
        clientMessageId: input.envelope.idempotencyKey,
        parts: this.assetMaterializerActive
          ? input.envelope.parts.filter(
              (part): part is AgentMessagePart =>
                part.type === 'text' || part.type === 'asset_ref',
            )
          : input.envelope.parts.filter(
              (part): part is AgentMessagePart => part.type === 'text',
            ),
      },
      capabilities: input.envelope.capabilities.capabilities.map(
        (capability) => capability.name,
      ),
    };
    const application = this.createApplication({
      signal: input.signal,
      route: input.route,
    });
    for await (const event of application.run(command)) {
      yield projectTurnApplicationEventToGateway(event, {
        actorUserId: input.route.actorUserId,
        occurredAt: new Date().toISOString(),
      });
    }
  }
}

/**
 * entrypoint 只用于服务端工具授权策略（general-tool-policy），不是渲染投影分支。
 * 桌面与 TUI 同为已认证非浏览器客户端，映射到同一工具授权入口；
 * 渲染投影按 capability manifest 而非 transport 名称决定（DP06）。
 */
function toEntrypoint(
  envelope: GatewayInboundEnvelope,
): 'web' | 'tui' | 'channel' | 'system' {
  if (envelope.connection.transport === 'web') return 'web';
  if (
    envelope.connection.transport === 'tui' ||
    envelope.connection.transport === 'desktop'
  )
    return 'tui';
  if (envelope.connection.transport === 'telegram') return 'channel';
  return 'system';
}
