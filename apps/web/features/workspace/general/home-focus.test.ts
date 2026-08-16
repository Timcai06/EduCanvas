import { describe, expect, it } from 'vitest';
import { parseHomeFocusParam } from './home-focus';

const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('parseHomeFocusParam', () => {
  it('parses artifact and source focus params', () => {
    expect(parseHomeFocusParam(`artifact:${uuid}`)).toEqual({
      kind: 'artifact',
      resourceId: uuid,
    });
    expect(parseHomeFocusParam(`source:${uuid}`)).toEqual({
      kind: 'source',
      resourceId: uuid,
    });
  });

  it('rejects non-string, array, malformed kind and non-uuid ids', () => {
    expect(parseHomeFocusParam(undefined)).toBeNull();
    expect(parseHomeFocusParam([`artifact:${uuid}`])).toBeNull();
    expect(parseHomeFocusParam(`conversation:${uuid}`)).toBeNull();
    expect(parseHomeFocusParam('artifact:not-a-uuid')).toBeNull();
    expect(parseHomeFocusParam(`artifact:`)).toBeNull();
    expect(parseHomeFocusParam('artifact:../../etc')).toBeNull();
    expect(parseHomeFocusParam('')).toBeNull();
  });
});
