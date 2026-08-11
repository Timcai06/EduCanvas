/**
 * Live TTS 只接纳由本次语音提问触发的下一条 Assistant 消息。
 *
 * 页面 hydration、持久化确认和普通文字聊天都可能在 Live 入室后改变
 * `assistantId`。仅靠“enabled 的第一帧”做基线会把这些迟到旧消息误判为
 * 新回答；本门闩要求用户终稿先显式 arm，再允许一个不同于基线的 ID 进入
 * 播放队列。已接纳 ID 的后续 delta 仍持续放行。
 */
export class LiveSpeechResponseGate {
  private armed = false;
  private baselineAssistantId: string | null = null;
  private activeAssistantId: string | null = null;

  reset(currentAssistantId: string | null): void {
    this.armed = false;
    this.baselineAssistantId = currentAssistantId;
    this.activeAssistantId = null;
  }

  expectNext(currentAssistantId: string | null): void {
    this.armed = true;
    this.baselineAssistantId = currentAssistantId;
    this.activeAssistantId = null;
  }

  accepts(assistantId: string | null): boolean {
    if (assistantId === null) return false;
    if (assistantId === this.activeAssistantId) return true;
    if (!this.armed || assistantId === this.baselineAssistantId) return false;
    this.armed = false;
    this.activeAssistantId = assistantId;
    return true;
  }
}
