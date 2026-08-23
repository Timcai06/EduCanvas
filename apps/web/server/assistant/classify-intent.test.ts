import { describe, expect, it } from 'vitest';
import type { TurnModelEvent } from '@educanvas/agent-core';
import { classifyIntent, type ClassifyGateway } from './classify-intent';

/** 构造合法 text_delta 事件。 */
function delta(text: string): TurnModelEvent {
  return { type: 'text_delta', phase: 'answer', delta: text };
}

/** 构造合法 failed 事件（错误码闭集由 normalizedModelErrorCodeSchema 约束）。 */
function failedEvent(): TurnModelEvent {
  return {
    type: 'failed',
    phase: 'answer',
    error: { code: 'unavailable', retryable: false },
  };
}

/** 构造一个按给定事件序列响应的 fake gateway。 */
function fakeGateway(events: TurnModelEvent[]): ClassifyGateway {
  return {
    async *streamTurnText() {
      for (const event of events) yield event;
    },
  };
}

/** 捕获 classifyIntent 发给 gateway 的请求，用于断言上下文注入。 */
function capturingGateway(capture: (input: unknown) => void): ClassifyGateway {
  return {
    async *streamTurnText(input) {
      capture(input);
      yield delta('{"action":"unknown"}');
    },
  };
}

const NOTEBOOKS = [
  { id: 'nb-1', title: '数学笔记' },
  { id: 'nb-2', title: '英语' },
];

describe('assistant classifyIntent', () => {
  it('解析模型返回的 JSON 并原样返回 intent', async () => {
    const gateway = fakeGateway([
      delta('{"action":"create_notebook","title":"物理"}'),
    ]);
    const intent = await classifyIntent(
      '帮我新建一个物理笔记本',
      NOTEBOOKS,
      gateway,
    );
    expect(intent).toEqual({ action: 'create_notebook', title: '物理' });
  });

  it('从带前后缀文本的响应中提取 JSON（模型常输出 markdown 围栏）', async () => {
    const gateway = fakeGateway([
      delta('```json\n{"action":"switch_notebook","notebookId":"nb-1"}\n```'),
    ]);
    const intent = await classifyIntent('切换到数学笔记', NOTEBOOKS, gateway);
    expect(intent).toEqual({ action: 'switch_notebook', notebookId: 'nb-1' });
  });

  it('分块文本拼接后整体解析', async () => {
    const gateway = fakeGateway([
      delta('{"action":"open_'),
      delta('panel","panel":"create_mind_map","title":"宇宙"}'),
    ]);
    const intent = await classifyIntent(
      '生成一个宇宙主题的思维导图',
      NOTEBOOKS,
      gateway,
    );
    expect(intent).toEqual({
      action: 'open_panel',
      panel: 'create_mind_map',
      title: '宇宙',
    });
  });

  it('action 不在白名单时回退 unknown（LLM 输出不可信）', async () => {
    const gateway = fakeGateway([
      delta('{"action":"drop_database","title":"hack"}'),
    ]);
    const intent = await classifyIntent('删库', NOTEBOOKS, gateway);
    expect(intent).toEqual({ action: 'unknown' });
  });

  it('panel 不在白名单时整条意图按 unknown 处理', async () => {
    const gateway = fakeGateway([
      delta('{"action":"open_panel","panel":"drop_database"}'),
    ]);
    const intent = await classifyIntent('删库', NOTEBOOKS, gateway);
    expect(intent).toEqual({ action: 'unknown' });
  });

  it('title 超长时剔除，由路由回退默认命名', async () => {
    const gateway = fakeGateway([
      delta(`{"action":"create_notebook","title":"${'长'.repeat(121)}"}`),
    ]);
    const intent = await classifyIntent('新建笔记本', NOTEBOOKS, gateway);
    expect(intent).toEqual({ action: 'create_notebook' });
  });

  it('kind 不在白名单时剔除，仅保留标题匹配', async () => {
    const gateway = fakeGateway([
      delta('{"action":"open_artifact","kind":"drop_database","title":"数学"}'),
    ]);
    const intent = await classifyIntent('打开数学', NOTEBOOKS, gateway);
    expect(intent).toEqual({ action: 'open_artifact', title: '数学' });
  });

  it('action 缺失时回退 unknown', async () => {
    const gateway = fakeGateway([delta('{"title":"只有标题"}')]);
    const intent = await classifyIntent('随便说点', NOTEBOOKS, gateway);
    expect(intent).toEqual({ action: 'unknown' });
  });

  it('响应不是 JSON 时回退 unknown', async () => {
    const gateway = fakeGateway([delta('抱歉，我没听明白。')]);
    const intent = await classifyIntent('你好', NOTEBOOKS, gateway);
    expect(intent).toEqual({ action: 'unknown' });
  });

  it('空响应回退 unknown', async () => {
    const intent = await classifyIntent('', NOTEBOOKS, fakeGateway([]));
    expect(intent).toEqual({ action: 'unknown' });
  });

  it('模型失败事件向上抛错（由路由转 503）', async () => {
    const gateway = fakeGateway([failedEvent()]);
    await expect(classifyIntent('hi', NOTEBOOKS, gateway)).rejects.toThrow(
      'unavailable',
    );
  });

  it('prompt 中包含用户指令与笔记本上下文（供模型匹配）', async () => {
    let captured: unknown = null;
    await classifyIntent(
      '切换到英语',
      NOTEBOOKS,
      capturingGateway((input) => {
        captured = input;
      }),
    );
    const content = (captured as { messages: { content: string }[] } | null)
      ?.messages[0]?.content;
    expect(content).toContain('用户指令：切换到英语');
    expect(content).toContain('nb-1');
    expect(content).toContain('数学笔记');
  });

  it('无笔记本时 prompt 标记为空列表', async () => {
    let captured: unknown = null;
    await classifyIntent(
      '列一下',
      [],
      capturingGateway((input) => {
        captured = input;
      }),
    );
    const content = (captured as { messages: { content: string }[] } | null)
      ?.messages[0]?.content;
    expect(content).toContain('（暂无）');
  });
});
