import { type GatewayOperationEvent } from '@educanvas/gateway-core';
import { describe, expect, it } from 'vitest';
import { gatewayCrossEntryConformance } from '../../../tooling/test-fixtures/gateway-cross-entry-conformance';
import { TurnRenderer } from './renderer';
import { createTheme } from './theme';

const theme = createTheme({
  isTTY: false,
  noColor: true,
  term: undefined,
  colorterm: undefined,
  forceDepth: undefined,
});

function render(events: readonly GatewayOperationEvent[]) {
  let out = '';
  let err = '';
  const renderer = new TurnRenderer(theme, {
    out: { write: (chunk) => (out += chunk) },
    err: { write: (chunk) => (err += chunk) },
    width: () => 72,
  });
  for (const event of events) renderer.render(event);
  return { renderer, out, err };
}

describe('TUI跨入口合规', () => {
  it('把审批保持为等待状态而非完成或失败', () => {
    const result = render(gatewayCrossEntryConformance.approvalPending);
    expect(result.renderer.pendingApprovals).toHaveLength(1);
    expect(result.err).toContain('需要你确认');
    expect(result.err).not.toContain('✓ 完成');
    expect(result.err).not.toContain('✗');
  });

  it('把取消与失败渲染成可区分的唯一结果', () => {
    const cancelled = render(gatewayCrossEntryConformance.cancelled);
    const unavailable = render(
      gatewayCrossEntryConformance.capabilityUnavailable,
    );

    expect(cancelled.err).toContain('已停止这轮回答');
    expect(cancelled.err).not.toContain('能力当前不可用');
    expect(unavailable.err).toContain('所需能力当前不可用');
    expect(unavailable.err).not.toContain('已停止这轮回答');
  });
});
