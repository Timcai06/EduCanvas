import 'server-only';

import { DrizzleGatewayConnectionRepository } from '@educanvas/db';
import {
  createDefaultGatewayConnectionProviders,
  GatewayConnectionService,
} from '@educanvas/gateway-runtime';

/**
 * Web BFF 与独立 Gateway 复用同一个 Connections 用例服务；这里只组合当前进程的
 * PostgreSQL Adapter 和部署配置，不复制 provider、归属或撤销规则。
 */
export function createWebConnectionService(): GatewayConnectionService {
  return new GatewayConnectionService(
    new DrizzleGatewayConnectionRepository(),
    createDefaultGatewayConnectionProviders({
      telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
    }),
  );
}
