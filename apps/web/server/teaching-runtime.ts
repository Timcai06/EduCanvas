import 'server-only';

import {
  DrizzleArtifactRepository,
  DrizzleTeachingUnitOfWork,
} from '@educanvas/db';
import { GradeCanvasSubmissionService } from '@educanvas/teaching-runtime';

// Next.js阶段一组合根：领域与应用包只认识Port，具体Drizzle实现仅在服务端装配。
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
