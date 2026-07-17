import type { Task } from 'graphile-worker';
import { z } from 'zod';

/** payload 必须显式校验:任务参数与工具参数同级,都是不可信输入。 */
const heartbeatPayloadSchema = z
  .object({
    requestedAt: z.string().min(1).max(64),
  })
  .strict();

/**
 * 冒烟任务:验证"入队 → worker 消费"回路与部署形态,不产生业务副作用。
 * M1 的 artifact.generate 落地后本任务保留作为队列健康检查。
 */
export const systemHeartbeat: Task = async (payload, helpers) => {
  const parsed = heartbeatPayloadSchema.parse(payload);
  helpers.logger.info(`heartbeat 收到,requestedAt=${parsed.requestedAt}`);
};
