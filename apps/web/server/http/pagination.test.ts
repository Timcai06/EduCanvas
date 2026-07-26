import { describe, expect, it, vi } from 'vitest';
import {
  encodeTemporalCursor,
  PaginationRequestError,
  parseListPagination,
} from './pagination';

vi.mock('server-only', () => ({}));

describe('opaque list pagination', () => {
  it('round trips a bounded timestamp/id cursor', () => {
    const cursor = {
      timestamp: new Date('2026-07-26T00:00:00.000Z'),
      id: '10000000-0000-4000-8000-000000000001',
    };
    const encoded = encodeTemporalCursor(cursor);
    const result = parseListPagination(
      new Request(
        `http://localhost/api/items?limit=20&cursor=${encodeURIComponent(encoded!)}`,
      ),
    );

    expect(result).toEqual({ limit: 20, cursor });
  });

  it('rejects malformed limits and cursors', () => {
    expect(() =>
      parseListPagination(new Request('http://localhost/api/items?limit=101')),
    ).toThrow(PaginationRequestError);
    expect(() =>
      parseListPagination(
        new Request('http://localhost/api/items?cursor=not-a-cursor'),
      ),
    ).toThrow(PaginationRequestError);
  });
});
