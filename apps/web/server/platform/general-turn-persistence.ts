import 'server-only';

import {
  DrizzlePlatformSourceRepository,
  DrizzlePlatformTurnRepository,
} from '@educanvas/db';

/** Web General进程级消息仓储；拆分模块共享同一实例，调用方不得替换身份边界。 */
export const webGeneralTurns = new DrizzlePlatformTurnRepository();

/** Web General进程级来源仓储；Tool写入与Lifecycle重放必须共享同一事实源。 */
export const webGeneralSources = new DrizzlePlatformSourceRepository();
