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
} from '@educanvas/db';
import type {
  GatewayClientSessionAuth,
  GatewayNodeSessionAuth,
} from '../client-auth';
import type { GatewayObservability } from '../observability';

/**
 * Gateway HTTP handler 的依赖类型：Client / Node / Internal 三种传输各自的能力面。
 * 与拆分前 createGatewayHttpHandler 的内联入参结构完全一致，仅抽出为命名类型供各路由组复用，
 * 因此三种鉴权边界（Client session、Node session、Internal token）的注入方式不变。
 */

export interface GatewayClientTransport {
  bootstrapToken: string | null;
  sessionAuth: GatewayClientSessionAuth;
  identities: Pick<
    DrizzleGatewayIdentityRepository,
    'ensureRegistered' | 'getActive'
  >;
  directory: Pick<DrizzleGatewayDirectoryRepository, 'listConversations'>;
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
  connections: Pick<GatewayConnectionService, 'list' | 'connect' | 'revoke'>;
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
  clientTransport?: GatewayClientTransport | null;
  nodeTransport?: GatewayNodeTransport | null;
  observability?: GatewayObservability;
}
