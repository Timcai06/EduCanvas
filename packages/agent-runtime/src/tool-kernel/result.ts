import type { ToolKernelFailureCode, ToolKernelResult } from './contracts';

/** @internal 构建不含原始异常或参数的稳定失败结果。 */
/** @internal 构造无敏感载荷的稳定失败结果。 */
export function toolFailure(
  tool: string,
  status: Exclude<
    ToolKernelResult['status'],
    'succeeded' | 'approval_required'
  >,
  code: Exclude<ToolKernelFailureCode, 'approval_required'>,
  retryable: boolean,
): ToolKernelResult {
  return { ok: false, status, tool, code, retryable, replayed: false };
}
