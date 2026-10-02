/** 主体不拥有目标 Space/Artifact 时抛出;与查无此物同错,避免所有权探测。 */
export class ArtifactOwnershipError extends Error {
  readonly code = 'artifact_ownership';

  constructor() {
    super('产物不存在或不属于当前主体');
    this.name = 'ArtifactOwnershipError';
  }
}

/** 版本号并发冲突(同一产物同一版本被同时写入)。 */
export class ArtifactVersionConflictError extends Error {
  readonly code = 'artifact_version_conflict';

  constructor() {
    super('产物版本写入冲突,请重试');
    this.name = 'ArtifactVersionConflictError';
  }
}

/**
 * 幂等键已存在但请求指纹不一致。同一键只能绑定同一个创建请求，
 * 否则客户端复用键重放会静默拿到另一请求的结果，必须显式拒绝。
 */
export class ArtifactIdempotencyConflictError extends Error {
  readonly code = 'artifact_idempotency_conflict';

  constructor() {
    super('相同幂等键已绑定不同的产物创建请求');
    this.name = 'ArtifactIdempotencyConflictError';
  }
}

/** Canvas 修改基于过期版本或目标已有运行中任务时拒绝，防止覆盖更新。 */
export class ArtifactRevisionConflictError extends Error {
  readonly code = 'artifact_revision_conflict';

  constructor(readonly reason: 'stale_version' | 'job_in_progress') {
    super(
      reason === 'stale_version'
        ? '产物已经产生新版本，请刷新后再修改'
        : '产物仍有修改任务在运行',
    );
    this.name = 'ArtifactRevisionConflictError';
  }
}

/** 生成任务状态机拒绝非法转移。 */
export class ArtifactJobLifecycleError extends Error {
  readonly code = 'artifact_job_lifecycle';

  constructor(from: string, to: string) {
    super(`生成任务不允许从 ${from} 转移到 ${to}`);
    this.name = 'ArtifactJobLifecycleError';
  }
}

/** 过期 worker execution 已被后续 generation fence 取代。 */
export class ArtifactExecutionFenceError extends Error {
  readonly code = 'artifact_execution_fenced';

  constructor() {
    super('生成任务执行权已交给更新的 worker');
    this.name = 'ArtifactExecutionFenceError';
  }
}
