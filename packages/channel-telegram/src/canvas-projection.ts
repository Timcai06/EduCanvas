import { projectCanvasResourceForNonWeb } from '@educanvas/canvas-protocol';

/**
 * 运行时投影状态副本到 Telegram 文案。
 * 约定上限 600 字符是防止单消息长度失控 + 客户端卡片预览截断。
 */
const STATUS_COPY = {
  processing: '正在处理，完成后可在 EduCanvas 查看。',
  failed: '处理失败，请回到 EduCanvas 查看失败原因或重试。',
  unavailable: '当前不可用。',
  archived: '已经归档，不再提供打开或下载。',
} as const;

export const TELEGRAM_CANVAS_SUMMARY_MAX_CHARS = 600;

/**
 * Telegram 只获得有界资源摘要，不接收正文、对象地址或 bearer 深链。
 * 交互式 Runtime 必须回到受控 Web 环境；本投影只返回有界标题与状态摘要。
 * 该约束使任意 Telegram 渠道都不会把执行路径误传达为已完成。
 */
export function projectTelegramCanvasResource(input: {
  readonly resource: unknown;
  readonly currentNotebookId: string;
}): string {
  const projection = projectCanvasResourceForNonWeb(input);
  if (!projection.available) return 'Canvas 资源不可用。';

  let detail: string;
  if (projection.status !== 'ready') {
    detail = STATUS_COPY[projection.status];
  } else if (projection.runtimeKind !== 'none') {
    detail = '需要受控 Web Runtime；此消息渠道不会执行该资源。';
  } else if (projection.openMode === 'inline_text') {
    detail =
      '文本资源已就绪；为保护正文，此渠道仅显示状态，请在 EduCanvas 打开。';
  } else if (projection.openMode === 'web_handoff') {
    detail = '资源已就绪；请在 EduCanvas Web 中安全查看或下载。';
  } else {
    detail = '当前没有可用的查看操作。';
  }

  const output = `▣ ${projection.title}\n${detail}`;
  return output.length <= TELEGRAM_CANVAS_SUMMARY_MAX_CHARS
    ? output
    : `${output.slice(0, TELEGRAM_CANVAS_SUMMARY_MAX_CHARS - 1)}…`;
}
