/**
 * Event queue — provides AsyncIterable-based event streaming for experiment
 * output. Uses a real AsyncQueue pattern instead of emit callbacks to ensure
 * proper backpressure and async iteration semantics.
 */

import {
  experimentRunEventSchema,
  type ExperimentRunEvent,
} from '@educanvas/agent-core';

export type ExperimentEvent = ExperimentRunEvent;

export interface EventQueue {
  push(event: ExperimentEvent): void;
  close(): void;
  fail(error: unknown): void;
  [Symbol.asyncIterator](): AsyncIterator<ExperimentEvent>;
}

interface QueueItem {
  readonly event: ExperimentEvent;
}

class EventQueueImpl implements EventQueue {
  private buffer: QueueItem[] = [];
  private waiters: Array<{
    resolve: (value: IteratorResult<ExperimentEvent>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private done = false;
  private error: unknown = null;

  push(event: ExperimentEvent): void {
    if (this.done) return;
    const validated = experimentRunEventSchema.parse(event);

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve({ value: validated, done: false });
    } else {
      this.buffer.push({ event: validated });
    }
  }

  close(): void {
    this.done = true;

    for (const waiter of this.waiters) {
      waiter.resolve({
        value: undefined as unknown as ExperimentEvent,
        done: true,
      });
    }
    this.waiters = [];
  }

  fail(error: unknown): void {
    this.error = error;
    this.done = true;

    for (const waiter of this.waiters) {
      waiter.reject(error);
    }
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<ExperimentEvent> {
    return {
      next: (): Promise<IteratorResult<ExperimentEvent>> => {
        if (this.buffer.length > 0) {
          const item = this.buffer.shift()!;
          return Promise.resolve({ value: item.event, done: false });
        }

        if (this.done) {
          if (this.error) {
            return Promise.reject(this.error);
          }
          return Promise.resolve({
            value: undefined as unknown as ExperimentEvent,
            done: true,
          });
        }

        return new Promise<IteratorResult<ExperimentEvent>>(
          (resolve, reject) => {
            this.waiters.push({ resolve, reject });
          },
        );
      },
      return: (): Promise<IteratorResult<ExperimentEvent>> => {
        this.done = true;
        for (const waiter of this.waiters) {
          waiter.resolve({
            value: undefined as unknown as ExperimentEvent,
            done: true,
          });
        }
        this.waiters = [];
        return Promise.resolve({
          value: undefined as unknown as ExperimentEvent,
          done: true,
        });
      },
    };
  }
}

export function createEventQueue(): EventQueue {
  return new EventQueueImpl();
}
