import type {
  DesktopApprovalRef,
  DesktopArtifactRef,
  DesktopCitation,
} from './chat-history';

/**
 * main → renderer 的受限流式事件投影（DP05/DP06）。
 *
 * main 把 gateway Operation 事件翻译成这一组白名单投影后，通过 `assistant:event`
 * 广播给小窗与大窗；renderer 据此原位追加 delta、展示工具状态、保留结构化事件
 * （citation/artifact/approval）并收口终态。每次投影都携带 `conversationId` 与稳定
 * 请求身份，renderer 用 conversationId 丢弃旧 operation 的迟到事件，避免串会话；
 * 操作内部的原始体、Prompt 与密钥永不外泄。
 */
export type DesktopAssistantProjection =
  | {
      type: 'accepted';
      requestId: string;
      clientMessageId: string | null;
      conversationId: string;
      operationId: string;
    }
  | {
      type: 'message.started';
      requestId: string;
      clientMessageId: string | null;
      conversationId: string;
      operationId: string;
      assistantMessageId: string;
    }
  | {
      type: 'delta';
      requestId: string;
      clientMessageId: string | null;
      conversationId: string;
      operationId: string;
      sequence: number;
      delta: string;
    }
  | {
      type: 'tool';
      requestId: string;
      clientMessageId: string | null;
      conversationId: string;
      operationId: string;
      /** 工具名仅在 started 阶段可得；completed/failed 只有 toolCallId，置 null。 */
      tool: string | null;
      status: 'started' | 'completed' | 'failed';
    }
  | {
      type: 'citation';
      requestId: string;
      clientMessageId: string | null;
      conversationId: string;
      operationId: string;
      sequence: number;
      citation: DesktopCitation;
    }
  | {
      type: 'artifact';
      requestId: string;
      clientMessageId: string | null;
      conversationId: string;
      operationId: string;
      /** 供 renderer 按 artifactId 合并，kind/title 仅 proposed 阶段可得。 */
      artifact: DesktopArtifactRef;
    }
  | {
      type: 'approval';
      requestId: string;
      clientMessageId: string | null;
      conversationId: string;
      operationId: string;
      approvalId: string;
      status: 'required' | 'resolved';
      /** resolved 阶段置 null，renderer 据 approvalId 清除待决审批。 */
      approval: DesktopApprovalRef | null;
    }
  | {
      type: 'final';
      requestId: string;
      clientMessageId: string | null;
      conversationId: string;
      operationId: string;
      status:
        | 'completed'
        | 'failed'
        | 'aborted'
        | 'interrupted'
        | 'timeout'
        | 'unauthenticated';
      message: string;
      /** 稳定 gateway 失败码（如 CAPABILITY_UNAVAILABLE）；成功/本地取消置 null。 */
      code: string | null;
    };

/** 稳定流式占位 id 的来源：优先 clientMessageId，续传/语音无则退回请求身份。 */
export function desktopStreamKey(projection: {
  clientMessageId: string | null;
  requestId: string;
}): string {
  return projection.clientMessageId ?? `request:${projection.requestId}`;
}
