import type {
  GatewayConnectionService,
  GatewayService,
} from '@educanvas/gateway-runtime';
import type {
  DrizzleGatewayApprovalRepository,
  DrizzleGatewayDirectoryRepository,
  DrizzleGatewayHandoffRepository,
  DrizzleGatewayIdentityRepository,
  DrizzleGatewayNodeRepository,
  DrizzleGatewayOperationStore,
  DrizzlePlatformTurnRepository,
  DrizzleWebSessionRepository,
} from '@educanvas/db';
import type {
  GatewayClientSessionAuth,
  GatewayNodeSessionAuth,
} from '../client-auth';
import type { TelemetryRuntime } from '@educanvas/telemetry';
import type { GatewayEffectReconciliationControl } from '../effect-reconciliation-control';
import type { GatewayObservability } from '../observability';
import type { GatewayCanvasResourceService } from '../canvas-resource-service';
import type { GatewayImagePreviewService } from '../asset-image-preview-service';
import type { StreamingTranscriptionTicketStore } from '../streaming-transcription-ticket';

/**
 * Gateway HTTP handler 的依赖类型：Client / Node / Internal 三种传输各自的能力面。
 * 与拆分前 createGatewayHttpHandler 的内联入参结构完全一致，仅抽出为命名类型供各路由组复用，
 * 因此三种鉴权边界（Client session、Node session、Internal token）的注入方式不变。
 */

export interface GatewayClientTransport {
  bootstrapToken: string | null;
  sessionAuth: GatewayClientSessionAuth;
  /** P3 packaged desktop sessions are opaque, revocable hashes in existing web_sessions. */
  desktopSessions?: Pick<
    DrizzleWebSessionRepository,
    'findActiveRegisteredUserIdByTokenHash' | 'revokeByTokenHash'
  >;
  identities: Pick<
    DrizzleGatewayIdentityRepository,
    'ensureRegistered' | 'getActive'
  >;
  directory: {
    listConversations?: (
      userId: string,
      now?: Date,
    ) => Promise<readonly unknown[]>;
    listConversationPage?: DrizzleGatewayDirectoryRepository['listConversationPage'];
    createConversation?: DrizzleGatewayDirectoryRepository['createConversation'];
  };
  localOnboarding?: {
    userId: string;
    ensureWorkspace: (userId: string) => Promise<unknown>;
  } | null;
  approvals: Pick<DrizzleGatewayApprovalRepository, 'listPending'>;
  operations: Pick<
    DrizzleGatewayOperationStore,
    'listRecent' | 'resolveApproval'
  >;
  handoffs: Pick<DrizzleGatewayHandoffRepository, 'issue'>;
  messageHistory?: {
    listMessagePage: DrizzlePlatformTurnRepository['listMessagePage'];
  };
  connections: Pick<GatewayConnectionService, 'list' | 'connect' | 'revoke'>;
  canvasResources?: Pick<GatewayCanvasResourceService, 'list' | 'get'>;
  /** 图片预览必须按 bearer 主体和当前 Conversation 再授权，不能直接暴露对象存储。 */
  imagePreviews?: Pick<GatewayImagePreviewService, 'read'>;
  /** V12 实时语音握手 ticket store；缺省时 ticket 端点 503。 */
  streamingTickets?: StreamingTranscriptionTicketStore | null;
  /** V12 实时语音 Notebook 访问校验（服务端重新绑定）；缺省时 ticket 端点 503。 */
  checkNotebookAccess?: (input: {
    notebookId: string;
    trustedSubjectId: string;
  }) => Promise<boolean>;
}

export interface GatewayNodeTransport {
  bootstrapToken: string;
  sessionAuth: GatewayNodeSessionAuth;
  nodes: Pick<
    DrizzleGatewayNodeRepository,
    'pair' | 'getActive' | 'heartbeat' | 'poll' | 'settle' | 'enqueue'
  >;
}

export interface GatewayHttpDependencies {
  service: GatewayService;
  internalToken: string | null;
  /** 公共健康检查仅暴露布尔能力事实，不泄漏模型目录或解析失败细节。 */
  health?: {
    readonly streamingTranscriptionEnabled: boolean;
    readonly streamingSpeechEnabled?: boolean;
  };
  effectReconciliation?: Pick<
    GatewayEffectReconciliationControl,
    'reconcile'
  > | null;
  clientTransport?: GatewayClientTransport | null;
  nodeTransport?: GatewayNodeTransport | null;
  observability?: GatewayObservability;
  /** Q04：遥测健康与指标快照随 internal metrics 端点暴露；缺省时 telemetry=null。 */
  telemetry?: TelemetryRuntime | null;
}
