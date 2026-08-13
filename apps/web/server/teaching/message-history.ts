import 'server-only';

import { DrizzleK12VisibleMessageHistoryRepository } from '@educanvas/db';

/** Web 进程启动时冻结 authority；配置切换与回退都必须重启。 */
export const webTeachingVisibleMessageHistory =
  new DrizzleK12VisibleMessageHistoryRepository();
