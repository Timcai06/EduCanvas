import type { GatewayOperationEvent } from '@educanvas/gateway-core';
import {
  renderApprovalCard,
  renderCitation,
  renderCompletion,
  renderFailure,
  renderProgressBar,
  renderToolCompleted,
  renderToolFailed,
  renderToolStarted,
} from './render';
import { InkSpinner } from './spinner';
import { MarkdownStream } from './markdown-stream';
import type { TuiTheme } from './theme';

export interface RendererIO {
  /** 回答正文（可被管道消费）。 */
  out: { isTTY?: boolean; write(chunk: string): unknown };
  /** 辅助层：工具、审批、状态（保持 stdout 干净）。 */
  err: { isTTY?: boolean; write(chunk: string): unknown };
  width(): number;
}

/**
 * 一轮回答的事件渲染器。职责是把 Gateway 事件流翻译成三层信息密度的
 * 终端输出：正文流式直出；工具活动占一行、进行中由墨点 spinner 表达、
 * 结束后原地落定为耗时行；审批以朱砂卡片插入。跨行状态只有两个：
 * 正文行是否悬空（needsNewline）与当前是否有活跃工具行。
 */
export class TurnRenderer {
  private needsNewline = false;
  private spinner: InkSpinner;
  private toolStartedAt = new Map<string, number>();
  private activeToolCallId: string | null = null;
  private activeTool: string | null = null;
  private progressActive = false;
  private lastProgress = 0;
  private startedAt: number | null = null;
  private markdown: MarkdownStream;
  /** 本轮的 operationId（首个事件携带），供中断后提示 resume。 */
  operationId: string | null = null;
  /** 本轮出现过的审批请求，供 REPL 在回合结束后接手处理。 */
  readonly pendingApprovals: GatewayOperationEvent[] = [];

  /**
   * @param interruptible 仅交互式 REPL 传 true——它才处理 esc 取消；
   *   `chat`/`resume`/`ui-demo` 等非交互路径不显示"esc 停止"，避免承诺
   *   一个当前上下文做不到的操作。
   */
  constructor(
    private readonly theme: TuiTheme,
    private readonly io: RendererIO,
    private readonly interruptible = false,
  ) {
    this.spinner = new InkSpinner(io.err);
    this.markdown = new MarkdownStream(theme);
  }

  private breakTextLine(): void {
    if (this.needsNewline) {
      this.io.out.write('\n');
      this.needsNewline = false;
    }
  }

  /** 工具/进度行还在 spinner 状态时，先把它固化成静态行再输出后续内容。 */
  private settleActiveTool(): void {
    if (this.activeTool !== null) {
      this.spinner.stop(renderToolStarted(this.theme, this.activeTool));
      this.activeTool = null;
      this.activeToolCallId = null;
    } else if (this.progressActive) {
      this.spinner.stop(
        renderProgressBar(this.theme, this.lastProgress, '生成产物'),
      );
      this.progressActive = false;
    } else {
      this.spinner.stop(null);
    }
  }

  render(event: GatewayOperationEvent): void {
    this.operationId ??= event.operationId;
    switch (event.type) {
      case 'operation.accepted':
        this.startedAt = Date.parse(event.occurredAt);
        /* 首个 token 到达前的等待感：墨点研磨。任何后续事件都会 settle 掉它 */
        this.spinner.start(
          this.theme.dim(
            this.interruptible ? '思考中… (esc 停止)' : '思考中…',
          ),
        );
        break;
      case 'message.delta': {
        this.settleActiveTool();
        this.io.out.write(this.markdown.push(event.delta));
        this.needsNewline = !event.delta.endsWith('\n');
        break;
      }
      case 'tool.started': {
        this.settleActiveTool();
        this.breakTextLine();
        this.toolStartedAt.set(event.toolCallId, Date.parse(event.occurredAt));
        this.activeToolCallId = event.toolCallId;
        this.activeTool = event.tool;
        this.spinner.start(renderToolStarted(this.theme, event.tool));
        break;
      }
      case 'tool.completed': {
        const startedAt = this.toolStartedAt.get(event.toolCallId);
        const occurredAt = Date.parse(event.occurredAt);
        const seconds =
          startedAt !== undefined && Number.isFinite(occurredAt)
            ? Math.max(0, (occurredAt - startedAt) / 1000)
            : null;
        const line = renderToolCompleted(
          this.theme,
          this.activeToolCallId === event.toolCallId
            ? (this.activeTool ?? event.toolCallId)
            : event.toolCallId,
          seconds,
        );
        if (this.activeToolCallId === event.toolCallId) {
          this.activeTool = null;
          this.activeToolCallId = null;
          this.spinner.stop(line);
        } else {
          this.io.err.write(`${line}\n`);
        }
        break;
      }
      case 'tool.failed': {
        const line = renderToolFailed(
          this.theme,
          this.activeToolCallId === event.toolCallId
            ? (this.activeTool ?? event.toolCallId)
            : event.toolCallId,
          event.retryable,
        );
        if (this.activeToolCallId === event.toolCallId) {
          this.activeTool = null;
          this.activeToolCallId = null;
          this.spinner.stop(line);
        } else {
          this.io.err.write(`${line}\n`);
        }
        break;
      }
      case 'message.citation': {
        this.settleActiveTool();
        this.breakTextLine();
        this.io.err.write(
          `${renderCitation(this.theme, event.citation.label, event.citation.marker)}\n`,
        );
        break;
      }
      case 'approval.required': {
        this.settleActiveTool();
        this.breakTextLine();
        this.pendingApprovals.push(event);
        this.io.err.write(
          `\n${renderApprovalCard(this.theme, this.io.width(), event.approval)}\n`,
        );
        break;
      }
      case 'approval.resolved': {
        this.settleActiveTool();
        this.breakTextLine();
        const approved = event.decision.status === 'approved';
        this.io.err.write(
          approved
            ? `${this.theme.good('✓')} ${this.theme.dim('已同意，继续执行')}\n`
            : `${this.theme.zhusha('✗')} ${this.theme.dim('已拒绝')}\n`,
        );
        break;
      }
      case 'operation.completed': {
        this.settleActiveTool();
        this.io.out.write(this.markdown.flush());
        this.breakTextLine();
        const seconds =
          this.startedAt !== null
            ? Math.max(0, (Date.parse(event.occurredAt) - this.startedAt) / 1000)
            : null;
        this.io.err.write(
          `${renderCompletion(this.theme, this.io.width(), seconds)}\n`,
        );
        break;
      }
      case 'operation.failed': {
        this.settleActiveTool();
        this.io.out.write(this.markdown.flush());
        this.breakTextLine();
        this.io.err.write(`${renderFailure(this.theme, event.code)}\n`);
        break;
      }
      case 'operation.cancelled': {
        this.settleActiveTool();
        this.io.out.write(this.markdown.flush());
        this.breakTextLine();
        this.io.err.write(
          `${this.theme.dim('── 已停止这轮回答 ──')}\n`,
        );
        break;
      }
      case 'artifact.proposed': {
        this.settleActiveTool();
        this.breakTextLine();
        this.io.err.write(
          `${this.theme.dim('  ├─ ')}${this.theme.dai('▣')}${this.theme.dim(` 产物提案 · ${event.title}`)}\n`,
        );
        break;
      }
      case 'artifact.generation_progress': {
        if (!this.progressActive) {
          this.settleActiveTool();
          this.breakTextLine();
        }
        this.lastProgress = event.progress;
        this.spinner.start(
          renderProgressBar(this.theme, event.progress, '生成产物'),
        );
        this.progressActive = true;
        break;
      }
      case 'artifact.version_added': {
        if (this.progressActive) {
          this.spinner.stop(
            renderProgressBar(this.theme, 1, '生成产物') +
              ` ${this.theme.good('✓')}`,
          );
          this.progressActive = false;
        }
        break;
      }
      case 'artifact.failed': {
        this.settleActiveTool();
        if (this.progressActive) {
          this.spinner.stop(null);
          this.progressActive = false;
        }
        this.breakTextLine();
        this.io.err.write(
          `${this.theme.dim('  ├─ ')}${this.theme.zhusha('✗ 产物生成失败，可稍后从产物列表重试')}\n`,
        );
        break;
      }
      default:
        /* message.started 等事件当前在 TUI 无对应 UI，静默即可（不伪装成完成）。 */
        break;
    }
  }
}
