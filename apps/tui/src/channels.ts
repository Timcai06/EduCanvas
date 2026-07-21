import type {
  GatewayChannelConnection,
  GatewayConnectionList,
} from '@educanvas/gateway-core';
import type { TuiTheme } from './theme';

const STATUS_LABEL: Record<GatewayChannelConnection['status'], string> = {
  pending: '等待渠道确认',
  active: '已连接',
  revoked: '已撤销',
};

/** `/channels` 的纯文本投影；颜色只强化状态，符号和文字始终保留完整语义。 */
export function renderChannels(
  theme: TuiTheme,
  snapshot: GatewayConnectionList,
): string {
  const lines = ['', theme.bold('通信方式'), ''];
  for (const provider of snapshot.providers) {
    const marker =
      provider.availability === 'available' ? theme.dai('●') : theme.dim('○');
    const qualifier = provider.experimental ? ' · 实验性' : '';
    lines.push(
      `  ${marker} ${provider.label}${theme.dim(qualifier)}${
        provider.disabledReason
          ? theme.dim(` · ${provider.disabledReason}`)
          : ''
      }`,
    );
  }
  lines.push('', theme.bold('连接'), '');
  if (snapshot.connections.length === 0) {
    lines.push(`  ${theme.dim('还没有连接任何通信方式。')}`);
  } else {
    snapshot.connections.forEach((connection, index) => {
      const marker =
        connection.status === 'active'
          ? theme.dai('●')
          : connection.status === 'pending'
            ? theme.warn('◌')
            : theme.zhusha('×');
      lines.push(
        `  ${marker} ${theme.dim(`${index + 1}.`)} ${connection.provider} · ${STATUS_LABEL[connection.status]} ${theme.dim(connection.connectionId)}`,
      );
    });
  }
  lines.push(
    '',
    theme.dim('  /channels connect telegram · /channels revoke <编号|id>'),
    '',
  );
  return lines.join('\n');
}

/** 撤销目标可用当前列表编号或完整 opaque ID，编号仅在最近一次列表快照内有效。 */
export function resolveConnectionTarget(
  connections: readonly GatewayChannelConnection[],
  target: string | undefined,
): GatewayChannelConnection | null {
  if (!target) return null;
  if (/^\d+$/.test(target)) {
    return connections[Number(target) - 1] ?? null;
  }
  return (
    connections.find((connection) => connection.connectionId === target) ?? null
  );
}
