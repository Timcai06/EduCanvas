/**
 * 网络连接状态的纯逻辑。Web 用每轮 SSE 而非常驻连接，"断线"只在两处有意义：
 * 发送前浏览器已离线、以及回答中途本机网络掉线。此处把"该说什么"从 React
 * 组件里抽出来以便单测：把本机网络问题诚实地归因给网络，而不是含糊地说
 * "AI 老师无法连接"——后者会让学生以为是产品坏了。
 */

export const OFFLINE_BANNER_TEXT = '网络连接已断开，恢复后可以继续对话。';
export const OFFLINE_SEND_HINT = '网络已断开，恢复后再发送。';

const NETWORK_FAILURE_MESSAGE = '网络似乎断开了，恢复后可以重新发送这条问题。';

/**
 * 一轮回答失败/中断时的用户可见文案。本机离线时归因给网络并可重试；
 * 否则沿用调用方给的服务端安全文案（不暴露 SDK/模型/服务端术语）。
 */
export function resolveTurnFailureMessage(input: {
  online: boolean;
  serverMessage: string;
  serverRetryable: boolean;
}): { message: string; retryable: boolean } {
  if (!input.online) {
    return { message: NETWORK_FAILURE_MESSAGE, retryable: true };
  }
  return { message: input.serverMessage, retryable: input.serverRetryable };
}
