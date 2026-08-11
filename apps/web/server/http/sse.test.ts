import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createSseEventStream, encodeSseEvent, sseResponse } from './sse';

describe('EduCanvas SSE encoding', () => {
  it('编码受控事件名与单行 JSON data', () => {
    const encoded = new TextDecoder().decode(
      encodeSseEvent({
        type: 'message.delta',
        schemaVersion: '1',
        delta: '第一行\n第二行',
      }),
    );
    expect(encoded).toBe(
      'event: message.delta\ndata: {"type":"message.delta","schemaVersion":"1","delta":"第一行\\n第二行"}\n\n',
    );
  });

  it('拒绝事件名字段注入并设置禁止缓冲的响应头', () => {
    expect(() =>
      encodeSseEvent({ type: 'message.delta\nevent: injected' }),
    ).toThrow('invalid_sse_event_name');

    const response = sseResponse(new ReadableStream());
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
  });

  it('客户端释放响应体时只通知一次调用方提供的取消处理', async () => {
    let finish!: () => void;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onCancel = vi.fn();
    const events = (async function* () {
      yield { type: 'message.delta', delta: '你' };
      await completed;
    })();
    const reader = createSseEventStream(events, { onCancel }).getReader();

    await reader.read();
    await reader.cancel();
    await reader.cancel();
    finish();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
