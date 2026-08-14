/**
 * main 进程 Operation 注册表向 renderer 暴露的受限投影。
 * 不含 token、原始请求 body 或内部错误；仅用于"是否有可续传的请求"与 resume。
 */
export interface DesktopPendingOperation {
  clientMessageId: string;
  operationId: string;
  status: 'running' | 'interrupted';
  conversationId: string | null;
}

export interface DesktopPendingOperationsSnapshot {
  operations: DesktopPendingOperation[];
}
