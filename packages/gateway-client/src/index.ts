/**
 * 仅导出对外客户端 API；实际传输协议细节保持在 `client.ts` 内，
 * 以便未来替换 transport 时，边界与类型签名不受影响。
 */
export {
  GatewayBootstrapClient,
  GatewayClient,
  GatewayClientError,
  type GatewayBootstrapSession,
  type GatewayCancelResult,
  type GatewayConversationEntry,
  type GatewayImagePreview,
  type GatewayPendingApproval,
  type GatewayRecentOperation,
} from './client';
export { revokeGatewayDesktopSession } from './desktop-session';
