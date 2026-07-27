/**
 * Web 教学运行时组合根 — 在 Next.js 服务端组装教学应用服务。
 *
 * ## 职责
 *
 * 这是 DI（依赖注入）层，不是业务逻辑层：
 * - 创建 Drizzle 实现的具体 Repository/UnitOfWork
 * - 注入到 teaching-runtime 的应用服务（GradeCanvasSubmissionService、ProgressTeachingStateService）
 * - 配置 K12 课程策略参数（练习最少次数、补救目标状态等）
 *
 * ## 为什么是单例
 *
 * 两个服务都无状态（所有状态在 DB 事务内），单例避免每次请求重新创建。
 * 调用方必须先完成身份认证和 session 归属校验才能调用这些服务。
 */

import 'server-only';

import {
  DrizzleArtifactRepository,
  DrizzleTeachingUnitOfWork,
} from '@educanvas/db';
import {
  GradeCanvasSubmissionService,
  ProgressTeachingStateService,
} from '@educanvas/teaching-runtime';
const artifactRepository = new DrizzleArtifactRepository();
const teachingUnitOfWork = new DrizzleTeachingUnitOfWork();

/**
 * Canvas判分应用服务的服务端单例。调用它之前必须完成登录身份与session归属校验；
 * 因此当前不直接导出无认证Route Handler。
 */
export const gradeCanvasSubmissionService = new GradeCanvasSubmissionService(
  artifactRepository,
  teachingUnitOfWork,
);

/** K12垂直策略适配器；平台Agent Runtime不依赖这些教学参数。 */
export const progressTeachingStateService = new ProgressTeachingStateService(
  teachingUnitOfWork,
  {
    async getPolicy() {
      return {
        policyVersion: 'k12-demo-progression-v1',
        minimumPracticeEvents: 1,
        remediationTarget: 'EXPLAIN',
        prerequisiteScores: [],
        severeMisconceptions: [],
      };
    },
  },
);
