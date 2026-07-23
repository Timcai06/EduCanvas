import type { McpLifecycleStatus, McpServerStatus } from './contracts';

type FailureCode = NonNullable<McpServerStatus['failureCode']>;

/** 只记录稳定健康码，不保存URL、工具参数、Credential或远端错误正文。 */
export class McpStatusRegistry {
  private readonly values = new Map<string, McpServerStatus>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  set(
    serverId: string,
    status: McpLifecycleStatus,
    failureCode: FailureCode | null = null,
  ): void {
    this.values.set(serverId, {
      serverId,
      status,
      failureCode,
      updatedAt: this.now().toISOString(),
    });
  }

  list(): readonly McpServerStatus[] {
    return [...this.values.values()].sort((left, right) =>
      left.serverId.localeCompare(right.serverId),
    );
  }
}
