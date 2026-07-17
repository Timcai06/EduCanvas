import { describe, expect, it } from 'vitest';
import { isValidObjectKey } from './object-storage-contracts';

describe('isValidObjectKey', () => {
  it('接受规范 key', () => {
    expect(isValidObjectKey('artifacts/audio/abc-123.mp3')).toBe(true);
    expect(isValidObjectKey('a')).toBe(true);
    expect(isValidObjectKey('0/x_y.z-1')).toBe(true);
  });

  it('拒绝穿越、绝对路径与非法字符', () => {
    expect(isValidObjectKey('../etc/passwd')).toBe(false);
    expect(isValidObjectKey('artifacts/../../secret')).toBe(false);
    expect(isValidObjectKey('/absolute')).toBe(false);
    expect(isValidObjectKey('trailing/')).toBe(false);
    expect(isValidObjectKey('double//slash')).toBe(false);
    expect(isValidObjectKey('artifacts/./x')).toBe(false);
    expect(isValidObjectKey('UPPER/Case')).toBe(false);
    expect(isValidObjectKey('空格 key')).toBe(false);
    expect(isValidObjectKey('')).toBe(false);
    expect(isValidObjectKey(`a/${'x'.repeat(1030)}`)).toBe(false);
  });
});
