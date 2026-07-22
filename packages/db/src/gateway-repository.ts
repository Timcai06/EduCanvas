/**
 * Gateway 数据仓储的兼容入口。
 *
 * 具体实现已按领域职责与事务所有权拆分到 `./gateway/` 目录下的各模块；本文件仅保留向后兼容的
 * re-export，使既有调用方与测试无需一次性改动导入路径。公共导出与拆分前完全一致。
 * 新代码应直接从 `@educanvas/db` 包入口导入。
 */

export { GatewayPersistenceError } from './gateway/persistence';
export {
  DrizzleGatewayIdentityRepository,
  ensurePersonalIdentity,
  type GatewayIdentitySnapshot,
} from './gateway/identity-repository';
export { DrizzleGatewayRouteResolver } from './gateway/route-repository';
export {
  DrizzleGatewayDirectoryRepository,
  type GatewayConversationDirectoryEntry,
} from './gateway/directory-repository';
export {
  DrizzleGatewayChannelBindingRepository,
  type GatewayChannelPrivateRoute,
} from './gateway/channel-binding-repository';
export { DrizzleGatewayDeliveryRepository } from './gateway/delivery-repository';
export { DrizzleGatewayNodeRepository } from './gateway/node-repository';
export {
  DrizzleGatewayApprovalRepository,
  type GatewayPendingApprovalSnapshot,
} from './gateway/approval-repository';
export {
  DrizzleGatewayOperationStore,
  type GatewayStoredOperationSnapshot,
} from './gateway/operation-store';
