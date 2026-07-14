/**
 * 数据访问包的公共入口；业务层应通过此处导入，避免绕过统一连接生命周期或绑定内部文件结构。
 * @packageDocumentation
 */

export { getDb } from './client';
export * from './schema';
export {
  DrizzleArtifactRepository,
  type SavedArtifactReference,
} from './artifact-repository';
export {
  DrizzleEventStore,
  DrizzleMasteryRepository,
  DrizzleSessionRepository,
  DrizzleTeachingUnitOfWork,
  IdempotencyConflictError,
  OptimisticLockError,
} from './teaching-adapters';
