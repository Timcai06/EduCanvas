import type { GatewayChannelConnection } from '@educanvas/gateway-core';

/** 用户可见的 provider-neutral 连接状态文案。 */
export const connectionStatusLabel: Record<
  GatewayChannelConnection['status'],
  string
> = {
  pending: '等待确认',
  active: '已连接',
  revoked: '已撤销',
};
