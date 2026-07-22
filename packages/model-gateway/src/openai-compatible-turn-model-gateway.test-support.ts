import type {
  StreamAgentTextRequest,
  TurnModelEvent,
} from '@educanvas/agent-core';
import type { EnabledModelGatewayConfiguration } from './config';
import { OpenAICompatibleTurnModelGateway } from './openai-compatible-turn-model-gateway';

export const config: EnabledModelGatewayConfiguration = {
  enabled: true,
  environment: 'local',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'fixture-key-never-real',
  modelIds: { primary: 'explicitly-configured-model' },
  timeoutMs: 1_000,
  maxOutputTokens: 2_048,
  speechVoice: 'alloy',
  speechTimeoutMs: 60_000,
  speechMaxInputChars: 3_500,
};

export const answerRequest: StreamAgentTextRequest = {
  taskAlias: 'teaching.turn',
  modelAlias: 'primary',
  phase: 'answer',
  messages: [
    { role: 'system', content: '你是AI老师。' },
    { role: 'user', content: '猫和狗有什么不同？' },
  ],
  tools: [
    {
      name: 'getStudentState',
      description: '读取学生当前学习状态',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  toolResults: [],
  promptVersion: 'teaching-turn-v1',
  traceId: 'trace-fixture-1',
  turnId: 'turn-fixture-1',
};

export const collect = async (
  gateway: OpenAICompatibleTurnModelGateway,
  request: StreamAgentTextRequest = answerRequest,
): Promise<TurnModelEvent[]> => {
  const events: TurnModelEvent[] = [];
  for await (const event of gateway.streamTurnText(request)) events.push(event);
  return events;
};

export const oneResponseFetch = (
  responseFactory: () => Response,
  capture?: (input: URL | RequestInfo, init?: RequestInit) => void,
): typeof fetch =>
  (async (input: URL | RequestInfo, init?: RequestInit) => {
    capture?.(input, init);
    return responseFactory();
  }) as typeof fetch;
