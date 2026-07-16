import type { z } from 'zod';
import type {
  ModelAbortSignal,
  ModelAlias,
  ModelMessage,
  ProviderCallMetadata,
  StreamAgentTextRequest,
  StructuredTaskAlias,
  TurnModelEvent,
} from './model-contracts';

/** 结构化模型调用请求；正常Agent Turn被类型系统排除。 */
export interface StructuredModelRequest<Output> {
  taskAlias: StructuredTaskAlias;
  modelAlias: ModelAlias;
  messages: readonly ModelMessage[];
  schema: z.ZodType<Output>;
  promptVersion: string;
  traceId: string;
  operationId: string;
  signal?: ModelAbortSignal;
}

/** 结构化模型调用结果及审计所需元数据。 */
export interface StructuredModelResult<Output> {
  output: Output;
  metadata: ProviderCallMetadata;
}

/** 正常Agent Turn使用的供应商无关Port。 */
export interface TurnModelGateway {
  streamTurnText(
    request: StreamAgentTextRequest,
  ): AsyncIterable<TurnModelEvent>;
}

/** Artifact与离线结构化任务使用的独立Port。 */
export interface StructuredModelGateway {
  generateStructured<Output>(
    request: StructuredModelRequest<Output>,
  ): Promise<StructuredModelResult<Output>>;
}

/** 组合根可提供的完整模型网关。 */
export interface ModelGateway
  extends TurnModelGateway, StructuredModelGateway {}
