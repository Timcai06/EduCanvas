import 'server-only';

import type { OutputPreference } from '@educanvas/agent-core';

/** Keep artifact confirmation instructions separate from turn context assembly. */
export function generalArtifactOutputGuidance(input: {
  outputPreference: OutputPreference;
  artifactConfirmationEnabled: boolean;
  confirmedArtifactKind: string | null;
}): string {
  const {
    outputPreference,
    artifactConfirmationEnabled,
    confirmedArtifactKind,
  } = input;
  if (confirmedArtifactKind) {
    return (
      '用户已确认创建类型为 ' +
      confirmedArtifactKind +
      ' 的持久产物。调用 createCanvasArtifact 且 kind 必须精确为 ' +
      confirmedArtifactKind +
      '；不得改成其他类型。proposed 只表示后台生成任务已提交，不代表完成。'
    );
  }
  switch (outputPreference) {
    case 'auto':
      return artifactConfirmationEnabled
        ? '本轮输出偏好为 auto：默认正常回答普通聊天。只有当用户明确希望把内容保存为 Markdown 文档、思维导图、Slides、闪卡、笔记、绘本或 Web App 等持久 Canvas 产物时，先调用 proposeCanvasArtifact 提出最合适的一种类型和标题；该工具不创建产物。随后明确告知这是待确认建议并等待用户确认，绝不调用 createCanvasArtifact。解释、摘要、草稿和普通问答不等于持久产物请求，不要弹确认。'
        : '本客户端不支持产物确认卡片。本轮 auto 只提供自然语言能力，没有创建产物工具。若用户明确要求持久产物，说明需要在输入框选择输出形式后重新发送；不要创建或声称创建任何产物。';
    case 'markdown_document':
      return '本轮用户明确选择 Markdown 文档输出。若 createCanvasArtifact 可用，调用它创建 kind=markdown_document 的持久产物；不得只把聊天正文排成 Markdown 后声称已创建。';
    case 'interactive_artifact':
      return '本轮用户明确选择可在 Canvas 交互的持久产物。若 createCanvasArtifact 可用，按任务选择 mind_map、slides、flashcards 或 note 并调用；普通聊天正文不算产物。';
    case 'web_app':
      return '本轮用户明确选择 Web App。若 createCanvasArtifact 可用，调用它创建 kind=web_app 的隔离交互产物；不得把 HTML 直接写进聊天或主页面。';
  }
}
