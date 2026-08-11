import { describe, expect, it } from 'vitest';
import { NotebookSurfacePositionValidationError } from './notebook-surface-position-repository';

describe('NotebookSurfacePositionValidationError', () => {
  it('提供稳定错误类型', () => {
    const error = new NotebookSurfacePositionValidationError('invalid');
    expect(error.name).toBe('NotebookSurfacePositionValidationError');
    expect(error.message).toBe('invalid');
  });
});
