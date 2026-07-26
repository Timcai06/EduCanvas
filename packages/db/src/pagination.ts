export interface TemporalIdCursor {
  timestamp: Date;
  id: string;
}

export interface CursorPage<T> {
  items: readonly T[];
  nextCursor: TemporalIdCursor | null;
}

export function boundedPageLimit(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? 50, 100));
}
