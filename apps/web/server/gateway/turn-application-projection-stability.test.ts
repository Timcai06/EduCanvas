import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import {
  gatewayFailureCodes,
  type GatewayFailureCode,
} from '@educanvas/gateway-core';
import { gatewayToLegacy } from './turn-application-projection';
import {
  collect,
  eventsOf,
  makeGatewayEvent,
} from './turn-application-projection-test-helpers';

describe('gatewayToLegacy 失败码与 retryable 保真', () => {
  it.each(gatewayFailureCodes)(
    'tool.failed 保真透传失败码 %s',
    async (code) => {
      const events = await collect(
        gatewayToLegacy(
          eventsOf([
            makeGatewayEvent(0, {
              type: 'tool.failed',
              toolCallId: 'tool-call:1',
              code,
              retryable: true,
            }),
          ]),
        ),
      );
      expect(events[0]).toMatchObject({
        type: 'tool.failed',
        toolCallId: 'tool-call:1',
        code,
      });
    },
  );

  it.each(gatewayFailureCodes)(
    'artifact.failed 保真透传失败码 %s',
    async (code) => {
      const events = await collect(
        gatewayToLegacy(
          eventsOf([
            makeGatewayEvent(0, {
              type: 'artifact.failed',
              artifactId: 'artifact:1',
              jobId: null,
              code,
            }),
          ]),
        ),
      );
      expect(events[0]).toMatchObject({ type: 'artifact.failed', code });
    },
  );

  it.each(gatewayFailureCodes)(
    'operation.failed 保真透传失败码 %s',
    async (code) => {
      const events = await collect(
        gatewayToLegacy(
          eventsOf([
            makeGatewayEvent(0, {
              type: 'operation.failed',
              code,
              retryable: true,
            }),
          ]),
        ),
      );
      expect(events[0]).toMatchObject({
        type: 'turn.failed',
        code,
        retryable: true,
      });
    },
  );

  it.each([true, false])(
    'operation.failed 保真透传 retryable=%s',
    async (retryable) => {
      const events = await collect(
        gatewayToLegacy(
          eventsOf([
            makeGatewayEvent(0, {
              type: 'operation.failed',
              code: 'RUNTIME_FAILED',
              retryable,
            }),
          ]),
        ),
      );
      expect(events[0]).toMatchObject({ type: 'turn.failed', retryable });
    },
  );
});

describe('gatewayToLegacy 未知枚举 fail closed', () => {
  it('未知 tool ID 兜底为通用动作名，绝不反向推断为已知工具', async () => {
    const events = await collect(
      gatewayToLegacy(
        eventsOf([
          makeGatewayEvent(0, {
            type: 'tool.started',
            toolCallId: 'tool-call:1',
            tool: 'some.new_capability',
          }),
        ]),
      ),
    );
    expect(events[0]).toEqual({
      schemaVersion: '1',
      turnId: 'operation:1',
      type: 'tool.started',
      toolCallId: 'tool-call:1',
      label: '正在使用工具',
      activity: 'other',
    });
  });

  it('未知失败码原样透传，不猜测为 RATE_LIMITED/CANCELLED/RUNTIME_FAILED', async () => {
    const unknownCode = 'UNKNOWN_FUTURE_CODE' as unknown as GatewayFailureCode;
    const events = await collect(
      gatewayToLegacy(
        eventsOf([
          makeGatewayEvent(0, {
            type: 'tool.failed',
            toolCallId: 'tool-call:1',
            code: unknownCode,
            retryable: false,
          }),
          makeGatewayEvent(1, {
            type: 'operation.failed',
            code: unknownCode,
            retryable: false,
          }),
        ]),
      ),
    );
    expect(
      events.map((event) =>
        event.type === 'tool.failed' || event.type === 'turn.failed'
          ? event.code
          : undefined,
      ),
    ).toEqual(['UNKNOWN_FUTURE_CODE', 'UNKNOWN_FUTURE_CODE']);
  });
});

describe('UI 文案变化不改变协议标识', () => {
  it('同一 operation.failed 在不同 audience 下 code/retryable 一致，仅 message 文案不同', async () => {
    const failedEvent = makeGatewayEvent(0, {
      type: 'operation.failed',
      code: 'RUNTIME_FAILED',
      retryable: true,
    });
    const general = await collect(
      gatewayToLegacy(eventsOf([failedEvent]), 'general'),
    );
    const teaching = await collect(
      gatewayToLegacy(eventsOf([failedEvent]), 'teaching'),
    );
    expect(general[0]).toMatchObject({
      type: 'turn.failed',
      code: 'RUNTIME_FAILED',
      retryable: true,
    });
    expect(teaching[0]).toMatchObject({
      type: 'turn.failed',
      code: 'RUNTIME_FAILED',
      retryable: true,
    });
    const generalFirst = general[0];
    const teachingFirst = teaching[0];
    expect(generalFirst).not.toEqual(teachingFirst);
    if (
      generalFirst?.type === 'turn.failed' &&
      teachingFirst?.type === 'turn.failed'
    ) {
      expect(generalFirst.message).toBe('AI 暂时无法回答，请稍后重试。');
      expect(teachingFirst.message).toBe('AI 老师暂时无法连接，请稍后重试。');
    }
  });

  it('同一工具的不同书写形式映射同一动作名，协议字段一致', async () => {
    const aliases = ['web.search', 'web_search', 'webSearch'] as const;
    for (const tool of aliases) {
      const events = await collect(
        gatewayToLegacy(
          eventsOf([
            makeGatewayEvent(0, {
              type: 'tool.started',
              toolCallId: 'tool-call:1',
              tool,
            }),
          ]),
        ),
      );
      expect(events[0]).toEqual({
        schemaVersion: '1',
        turnId: 'operation:1',
        type: 'tool.started',
        toolCallId: 'tool-call:1',
        label: '正在搜索网页',
        activity: 'web_search',
      });
    }
  });
});
