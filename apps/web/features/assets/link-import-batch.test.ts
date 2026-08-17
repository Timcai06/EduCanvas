import { describe, expect, it } from 'vitest';
import { mapWithConcurrency, parseLinkImportInput } from './link-import-batch';

describe('parseLinkImportInput', () => {
  it('splits commas, Chinese commas, and newlines while preserving first-seen order', () => {
    expect(
      parseLinkImportInput(
        ' https://a.example/x,https://b.example/y\nhttps://a.example/x，https://c.example/z ',
      ),
    ).toEqual({
      urls: [
        'https://a.example/x',
        'https://b.example/y',
        'https://c.example/z',
      ],
      overflowCount: 0,
    });
  });

  it('keeps at most ten unique links and reports the overflow', () => {
    const value = Array.from(
      { length: 12 },
      (_, index) => `https://example.com/${index}`,
    ).join('\n');

    const parsed = parseLinkImportInput(value);

    expect(parsed.urls).toHaveLength(10);
    expect(parsed.overflowCount).toBe(2);
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more than the configured number of jobs', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const work = mapWithConcurrency([1, 2, 3, 4, 5], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return value * 2;
    });

    await Promise.resolve();
    expect(active).toBe(3);
    releases.splice(0, 3).forEach((release) => release());
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(2);
    releases.splice(0).forEach((release) => release());

    await expect(work).resolves.toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(3);
  });
});
