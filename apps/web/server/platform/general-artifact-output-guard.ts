import 'server-only';

import type { ModelToolResult, OutputPreference } from '@educanvas/agent-core';
import type { TurnApplicationOutputGuardPort } from '@educanvas/agent-runtime';
import {
  createCanvasArtifactOutputSchema,
  type WebOperationArtifacts,
} from './general-artifact-tool';

const MAX_AUTO_CONFIRMATION_OUTPUT_CHARACTERS = 128_000;

/** Replace any model completion accompanying a proposal with a factual prompt. */
export class AutoArtifactConfirmationOutputGuard implements TurnApplicationOutputGuardPort {
  private readonly held: string[] = [];
  private heldCharacters = 0;

  constructor(private readonly artifacts: WebOperationArtifacts) {}

  async push(delta: string) {
    this.heldCharacters += delta.length;
    if (this.heldCharacters > MAX_AUTO_CONFIRMATION_OUTPUT_CHARACTERS) {
      return {
        kind: 'block' as const,
        publicContent: '回答超过本轮安全长度限制，请缩小问题后重试。',
        failureCode: 'BUDGET_EXCEEDED' as const,
      };
    }
    this.held.push(delta);
    return { kind: 'hold' as const };
  }

  async finish() {
    const proposal = this.artifacts.confirmationProposalSnapshot();
    if (proposal) {
      return {
        kind: 'emit' as const,
        safeDeltas: [
          `我建议把「${proposal.title}」保存为持久产物。请在下方确认或修改类型；确认后才会开始创建。`,
        ],
      };
    }
    return { kind: 'emit' as const, safeDeltas: this.held };
  }
}

/** 明确选择产物输出时，模型正文不能替代原子落库和已验证的工具结果。 */
export class ArtifactOutputGuard implements TurnApplicationOutputGuardPort {
  private satisfied = false;

  get completionRequirement() {
    return {
      tool: 'createCanvasArtifact',
      remediationPrompt: this.confirmedKind
        ? `本轮用户确认创建 ${this.confirmedKind}。若尚无该类型的服务端创建回执，请立即调用 createCanvasArtifact，kind 必须为 ${this.confirmedKind}；不能以聊天正文或“已提交”的自述代替工具。proposed 只代表后台任务已提交，不代表生成完成。`
        : '本轮用户明确选择了持久产物输出，但尚无符合选择的创建结果。请立即调用 createCanvasArtifact 创建所选产物；不能以聊天正文或“已提交”的自述代替工具。proposed 只代表后台任务已提交，不代表生成完成。',
      isSatisfied: (results: readonly ModelToolResult[]) => {
        this.satisfied = results.some((result) => {
          if (result.tool !== 'createCanvasArtifact') return false;
          const parsed = createCanvasArtifactOutputSchema.safeParse(
            result.output,
          );
          if (!parsed.success) return false;
          const { artifactId, kind } = parsed.data;
          const allowed = this.confirmedKind
            ? kind === this.confirmedKind
            : this.preference === 'markdown_document'
              ? kind === 'markdown_document'
              : this.preference === 'web_app'
                ? kind === 'web_app'
                : [
                    'mind_map',
                    'slides',
                    'flashcards',
                    'note',
                    'picturebook',
                  ].includes(kind);
          return (
            allowed &&
            this.artifacts
              .events()
              .some(
                (event) =>
                  event.type === 'artifact.proposed' &&
                  event.operationId === this.operationId &&
                  event.artifactId === artifactId &&
                  event.artifactKind === kind,
              )
          );
        });
        return this.satisfied;
      },
    };
  }

  constructor(
    private readonly preference: Exclude<OutputPreference, 'auto'>,
    private readonly artifacts: WebOperationArtifacts,
    private readonly operationId: string,
    private readonly confirmedKind?: string | null,
  ) {}

  async push(delta: string) {
    // 不缓存/公开未经事实支持的提交或完成自述，也不随输出长度增加内存。
    void delta;
    return { kind: 'hold' as const };
  }

  async finish() {
    return this.satisfied
      ? {
          kind: 'emit' as const,
          safeDeltas: [
            '产物任务已提交，正在后台生成。请在 Canvas 中查看实际进度和结果。',
          ],
        }
      : {
          kind: 'block' as const,
          publicContent:
            '本轮未能创建所选产物。请缩小产物范围或补充必要资料后重新发送。',
          failureCode: 'TOOL_FAILED' as const,
        };
  }
}
