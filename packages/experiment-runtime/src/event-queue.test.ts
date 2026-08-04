import { describe, expect, it } from 'vitest';
import { createEventQueue } from './event-queue';
import type { ExperimentRunEvent } from '@educanvas/agent-core';

const outputEvent = (content: string): ExperimentRunEvent => ({
  type: 'output',
  kind: 'stdout',
  content,
});

describe('event queue', () => {
  it('delivers pushed events in order', async () => {
    const queue = createEventQueue();
    queue.push(outputEvent('a'));
    queue.push(outputEvent('b'));
    queue.close();

    const events: ExperimentRunEvent[] = [];
    for await (const event of queue) {
      events.push(event);
    }
    expect(events.map((e) => (e.type === 'output' ? e.content : ''))).toEqual([
      'a',
      'b',
    ]);
  });

  it('waits for events pushed after iteration starts', async () => {
    const queue = createEventQueue();
    const collected: ExperimentRunEvent[] = [];
    const consumer = (async () => {
      for await (const event of queue) {
        collected.push(event);
      }
    })();

    // Give the consumer a tick to start waiting.
    await new Promise((r) => setTimeout(r, 10));
    queue.push(outputEvent('later'));
    queue.close();

    await consumer;
    expect(collected).toHaveLength(1);
  });

  it('ignores pushes after close', async () => {
    const queue = createEventQueue();
    queue.close();
    queue.push(outputEvent('after-close'));

    const events: ExperimentRunEvent[] = [];
    for await (const event of queue) {
      events.push(event);
    }
    expect(events).toHaveLength(0);
  });

  it('rejects pending next() calls when failed', async () => {
    const queue = createEventQueue();
    const iter = queue[Symbol.asyncIterator]();

    const pending = iter.next();
    queue.fail(new Error('boom'));
    await expect(pending).rejects.toThrow('boom');
  });

  it('fails subsequent reads after fail', async () => {
    const queue = createEventQueue();
    queue.push(outputEvent('x'));
    queue.fail(new Error('boom'));

    const iter = queue[Symbol.asyncIterator]();
    expect((await iter.next()).value).toEqual(outputEvent('x'));
    await expect(iter.next()).rejects.toThrow('boom');
  });

  it('supports early return (break)', async () => {
    const queue = createEventQueue();
    queue.push(outputEvent('one'));
    queue.push(outputEvent('two'));
    queue.close();

    const events: ExperimentRunEvent[] = [];
    for await (const event of queue) {
      events.push(event);
      break;
    }
    expect(events).toHaveLength(1);
  });

  it('rejects events that fail the public runtime schema', () => {
    const queue = createEventQueue();
    expect(() =>
      queue.push({
        type: 'output',
        kind: 'stdout',
        content: 'x'.repeat(65_537),
      }),
    ).toThrow();
  });
});
