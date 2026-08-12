import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('desktop React effects', () => {
  it('never returns the value of scrollIntoView as an effect cleanup', () => {
    const source = readFileSync(
      join(__dirname, '../src/renderer/src/App.tsx'),
      'utf8',
    );

    expect(source).not.toMatch(
      /useEffect\(\(\) => historyEndRef.*scrollIntoView/,
    );
  });
});
