import { describe, expect, it, vi } from 'vitest';
import type {
  TurnModelEvent,
  TurnUsageBudgetLedgerEntry,
  TurnUsageBudgetLedgerPort,
} from '@educanvas/agent-core';
import {
  AssistantClassifyError,
  runClassifiedTurn,
} from './assistant-classify';
import type { ClassifyGateway } from './classify-intent';

vi.mock('server-only', () => ({}));

/** 构造合法 text_delta 事件。 */
function delta(text: string): TurnModelEvent {
  return { type: 'text_delta', phase: 'answer', delta: text };
}

function fakeGateway(events: TurnModelEvent[]): ClassifyGateway {
  return {
    async *streamTurnText() {
      for (const event of events) yield event;
    },
  };
}

const NOTEBOOKS = [{ id: 'nb-1', title: '数学笔记' }];

/** 捕获 ledger 行的 fake 账本。 */
function fakeLedger(): {
  ledger: TurnUsageBudgetLedgerPort;
  entries: TurnUsageBudgetLedgerEntry[];
} {
  const entries: TurnUsageBudgetLedgerEntry[] = [];
  return {
    ledger: {
      async record(entry: TurnUsageBudgetLedgerEntry): Promise<void> {
        entries.push(entry);
      },
    },
    entries,
  };
}

describe('runClassifiedTurn 预算控制与账本', () => {
  it('正常路径返回意图，账本记一行（估算口径，breachReason=null）', async () => {
    const { ledger, entries } = fakeLedger();
    const intent = await runClassifiedTurn(
      { text: '新建物理笔记本', notebooks: NOTEBOOKS },
      {
        gateway: fakeGateway([
          delta('{"action":"create_notebook","title":"物理"}'),
        ]),
        usageBudgetLedger: ledger,
      },
    );
    expect(intent).toEqual({ action: 'create_notebook', title: '物理' });
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.breachReason).toBeNull();
    expect(entry.modelCalls).toBe(1);
    expect(entry.estimated).toBe(true);
    expect(entry.inputTokens).toBeGreaterThan(0);
    expect(entry.profileId).toBe('assistant.classify');
  });

  it('未配置模型路由时抛 model_unavailable 且不记账', async () => {
    const { ledger, entries } = fakeLedger();
    await expect(
      runClassifiedTurn(
        { text: 'hi', notebooks: NOTEBOOKS },
        { gateway: null, usageBudgetLedger: ledger },
      ),
    ).rejects.toBeInstanceOf(AssistantClassifyError);
    expect(entries).toHaveLength(0);
  });

  it('输入超预算（超长指令）在调用前拦截，账本记 breachReason', async () => {
    const { ledger, entries } = fakeLedger();
    const oversized = '长'.repeat(600_001); // > 150_000 token 估算
    await expect(
      runClassifiedTurn(
        { text: oversized, notebooks: NOTEBOOKS },
        {
          gateway: fakeGateway([delta('{"action":"unknown"}')]),
          usageBudgetLedger: ledger,
        },
      ),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.breachReason).toBe('max_input_tokens');
  });

  it('模型 failed 事件转 model_failed，失败尝试也记账', async () => {
    const { ledger, entries } = fakeLedger();
    const failing: ClassifyGateway = {
      async *streamTurnText() {
        yield {
          type: 'failed',
          phase: 'answer',
          error: { code: 'unavailable', retryable: true },
        };
      },
    };
    await expect(
      runClassifiedTurn(
        { text: 'hi', notebooks: NOTEBOOKS },
        { gateway: failing, usageBudgetLedger: ledger },
      ),
    ).rejects.toMatchObject({ code: 'model_failed' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.modelCalls).toBe(1);
  });

  it('账本写入失败是尽力而为，不改变结果', async () => {
    const failingLedger: TurnUsageBudgetLedgerPort = {
      async record(): Promise<void> {
        throw new Error('db down');
      },
    };
    const intent = await runClassifiedTurn(
      { text: 'hi', notebooks: NOTEBOOKS },
      {
        gateway: fakeGateway([delta('{"action":"unknown"}')]),
        usageBudgetLedger: failingLedger,
      },
    );
    expect(intent).toEqual({ action: 'unknown' });
  });
});
