import { describe, expect, it } from 'vitest';
import { createTheme } from './theme';
import { renderChannels, resolveConnectionTarget } from './channels';

const theme = createTheme({
  isTTY: false,
  noColor: true,
  term: undefined,
  colorterm: undefined,
  forceDepth: undefined,
});

const connection = {
  connectionId: 'connection:1',
  provider: 'telegram' as const,
  status: 'active' as const,
  conversationId: 'conversation:1',
  createdAt: '2026-07-21T08:00:00.000Z',
  activationExpiresAt: null,
  revokedAt: null,
};

describe('TUI channels view', () => {
  it('renders honest disabled providers and connection status without color', () => {
    const output = renderChannels(theme, {
      providers: [
        {
          provider: 'wechat',
          label: '微信',
          availability: 'disabled',
          disabledReason: '需要平台资格',
          experimental: false,
        },
      ],
      connections: [connection],
    });
    expect(output).toContain('微信 · 需要平台资格');
    expect(output).toContain('telegram · 已连接');
    expect(output).toContain('/channels revoke');
  });

  it('resolves only a visible list index or exact id', () => {
    expect(resolveConnectionTarget([connection], '1')).toEqual(connection);
    expect(resolveConnectionTarget([connection], 'connection:1')).toEqual(
      connection,
    );
    expect(resolveConnectionTarget([connection], '2')).toBeNull();
  });
});
