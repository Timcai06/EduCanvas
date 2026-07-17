import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { encodeSseEvent, sseResponse } from './sse';

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
});
