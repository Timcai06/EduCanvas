import { describe, expect, it } from 'vitest';
import { isResourceAnnotationGeometry } from './resource-annotation-repository';

describe('isResourceAnnotationGeometry', () => {
  it('接受归一化坐标（含可选尺寸与页码）', () => {
    expect(isResourceAnnotationGeometry({ x: 0.5, y: 0.25 })).toBe(true);
    expect(
      isResourceAnnotationGeometry({
        x: 0,
        y: 0.8,
        width: 0.4,
        height: 0.1,
        page: 3,
      }),
    ).toBe(true);
  });

  it('拒绝越界坐标与非对象', () => {
    expect(isResourceAnnotationGeometry({ x: -0.1, y: 0.5 })).toBe(false);
    expect(isResourceAnnotationGeometry({ x: 0.5, y: 1.01 })).toBe(false);
    expect(isResourceAnnotationGeometry({ x: 0.5, y: 0.5, width: 2 })).toBe(
      false,
    );
    expect(isResourceAnnotationGeometry({ x: 0.8, y: 0.5, width: 0.3 })).toBe(
      false,
    );
    expect(isResourceAnnotationGeometry({ x: 0.5, y: 0.5, page: 0 })).toBe(
      false,
    );
    expect(isResourceAnnotationGeometry('x:0.5')).toBe(false);
    expect(isResourceAnnotationGeometry(null)).toBe(false);
    expect(isResourceAnnotationGeometry([0.5, 0.5])).toBe(false);
    expect(isResourceAnnotationGeometry({ x: '0.5', y: 0.5 })).toBe(false);
  });
});
