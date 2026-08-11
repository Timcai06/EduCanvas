import { describe, expect, it } from 'vitest';
import {
  canvasAnnotationGeometrySchema,
  createCanvasAnnotationSchema,
} from './resource-annotation';

describe('Canvas annotation contract', () => {
  it('accepts bounded normalized geometry', () => {
    expect(
      canvasAnnotationGeometrySchema.safeParse({
        x: 0.2,
        y: 0.3,
        width: 0.18,
        height: 0.13,
      }).success,
    ).toBe(true);
  });

  it('rejects geometry crossing the resource edge and empty notes', () => {
    expect(
      canvasAnnotationGeometrySchema.safeParse({
        x: 0.9,
        y: 0.3,
        width: 0.2,
      }).success,
    ).toBe(false);
    expect(
      createCanvasAnnotationSchema.safeParse({
        kind: 'note',
        geometry: { x: 0.2, y: 0.3 },
        source: 'canvas',
      }).success,
    ).toBe(false);
  });
});
