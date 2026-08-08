import 'server-only';

import {
  ModelGatewayInvocationError,
  PLATFORM_EMBEDDING_DIMENSIONS,
  type EmbeddingModelGateway,
} from '@educanvas/agent-core';
import {
  DrizzleKnowledgeHybridRetrieval,
  type EmbeddingIdentity,
  type HybridRetrievalResult,
} from '@educanvas/db';
import { getDb } from '@educanvas/db/internal';
import {
  EMBEDDING_INSTRUCTION_VERSION,
  OpenAICompatibleEmbeddingModelGateway,
  parseModelGatewayConfiguration,
  resolveCapabilityGatewayConfiguration,
  type EnabledModelGatewayConfiguration,
} from '@educanvas/model-gateway';
import {
  embeddingGatewayErrorToRetrievalDegradation,
  type RetrievalDegradationReason,
} from '@educanvas/agent-core';
import { recordRetrievalDegradation } from '@educanvas/teaching-runtime';
import { getWebTelemetryRuntime } from '../telemetry/telemetry-runtime';
import { webTeachingObservability } from '../teaching/teaching-observability';

/**
 * Web 组合根只显式转交向量检索所需的环境变量；与其他模型入口同一纪律，
 * API Key 不出 `packages/model-gateway`。
 *
 * 能力可用性统一由 `resolveCapabilityGatewayConfiguration()` 判定（ADR-0021）：
 * embedding 可继承主 Provider 或走独立 override；能力级错误只关闭该能力。
 */
function embeddingConfiguration(): EnabledModelGatewayConfiguration | null {
  const primaryConfiguration = parseModelGatewayConfiguration({
    EDUCANVAS_DEPLOYMENT_ENV: process.env.EDUCANVAS_DEPLOYMENT_ENV,
    MODEL_GATEWAY_PROVIDER: process.env.MODEL_GATEWAY_PROVIDER,
    MODEL_GATEWAY_ALLOW_DEEPSEEK: process.env.MODEL_GATEWAY_ALLOW_DEEPSEEK,
    MODEL_GATEWAY_BASE_URL: process.env.MODEL_GATEWAY_BASE_URL,
    MODEL_GATEWAY_API_KEY: process.env.MODEL_GATEWAY_API_KEY,
    MODEL_GATEWAY_PRIMARY_MODEL: process.env.MODEL_GATEWAY_PRIMARY_MODEL,
    MODEL_GATEWAY_EMBEDDING_MODEL: process.env.MODEL_GATEWAY_EMBEDDING_MODEL,
    MODEL_GATEWAY_EMBEDDING_MODEL_VERSION:
      process.env.MODEL_GATEWAY_EMBEDDING_MODEL_VERSION,
    MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS:
      process.env.MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS,
    MODEL_GATEWAY_EMBEDDING_MAX_BATCH:
      process.env.MODEL_GATEWAY_EMBEDDING_MAX_BATCH,
    MODEL_GATEWAY_EMBEDDING_PROVIDER:
      process.env.MODEL_GATEWAY_EMBEDDING_PROVIDER,
    MODEL_GATEWAY_EMBEDDING_BASE_URL:
      process.env.MODEL_GATEWAY_EMBEDDING_BASE_URL,
    MODEL_GATEWAY_EMBEDDING_API_KEY:
      process.env.MODEL_GATEWAY_EMBEDDING_API_KEY,
  });
  const configuration = resolveCapabilityGatewayConfiguration(
    {
      MODEL_GATEWAY_EMBEDDING_MODEL: process.env.MODEL_GATEWAY_EMBEDDING_MODEL,
      MODEL_GATEWAY_EMBEDDING_MODEL_VERSION:
        process.env.MODEL_GATEWAY_EMBEDDING_MODEL_VERSION,
      MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS:
        process.env.MODEL_GATEWAY_EMBEDDING_TIMEOUT_MS,
      MODEL_GATEWAY_EMBEDDING_PROVIDER:
        process.env.MODEL_GATEWAY_EMBEDDING_PROVIDER,
      MODEL_GATEWAY_EMBEDDING_BASE_URL:
        process.env.MODEL_GATEWAY_EMBEDDING_BASE_URL,
      MODEL_GATEWAY_EMBEDDING_API_KEY:
        process.env.MODEL_GATEWAY_EMBEDDING_API_KEY,
    },
    'embedding',
    primaryConfiguration.enabled ? primaryConfiguration : null,
  );
  return configuration &&
    configuration.modelIds.embedding &&
    configuration.embeddingModelVersion
    ? configuration
    : null;
}

/**
 * 语料侧向量身份。
 *
 * 检索端必须用与写入端逐字相同的身份，否则查询向量永远匹配不到任何语料向量，
 * 表现为「向量路一直没有命中」而不是任何显式错误。
 */
export function resolveWebEmbeddingIdentity(): EmbeddingIdentity | null {
  const configuration = embeddingConfiguration();
  if (!configuration) return null;
  return {
    embeddingModel: configuration.modelIds.embedding!,
    embeddingModelVersion: configuration.embeddingModelVersion!,
    instruction: `passage:${EMBEDDING_INSTRUCTION_VERSION}`,
  };
}

export function resolveWebEmbeddingGateway(): EmbeddingModelGateway | null {
  const configuration = embeddingConfiguration();
  return configuration
    ? new OpenAICompatibleEmbeddingModelGateway(configuration)
    : null;
}

/**
 * 生成查询向量。
 *
 * 任何失败都返回 null 而不是抛出：查询向量缺失只应让本轮退回纯词法检索，
 * 不应该把一次教学提问变成一次工具调用失败。稳定错误码仍然会被上层记录，
 * 但供应商响应体和堆栈不会离开这里。
 */
/** embedQuery 的结果：向量与 Provider 侧降级原因分离表达（Q02 最终验收）。 */
interface QueryEmbeddingResult {
  vector: readonly number[] | null;
  degradationReason: RetrievalDegradationReason | null;
}

/** 供单测直接注入 fake gateway（导出仅为可测性，无副作用）。 */
export async function embedQuery(
  gateway: EmbeddingModelGateway,
  input: { query: string; traceId: string; turnId: string },
): Promise<QueryEmbeddingResult> {
  try {
    const result = await gateway.embed({
      taskAlias: 'retrieval.embed',
      modelAlias: 'embedding',
      purpose: 'query',
      inputs: [input.query],
      promptVersion: 'knowledge-query-embedding-v1',
      traceId: input.traceId,
      operationId: input.turnId,
    });
    const vector = result.embeddings[0];
    return vector && vector.length === PLATFORM_EMBEDDING_DIMENSIONS
      ? { vector, degradationReason: null }
      : // 维度不符属 Provider 返回异常，交给 DB 输入侧 invalid_dimensions 分类
        // （与既有语义一致，不在本层重复分类）。
        { vector: null, degradationReason: null };
  } catch (error) {
    // Provider 失败不再吞成无原因 null（B3）：网关归一化错误经既有契约映射为
    // 精确 reason；非网关错误（如配置/网络层未知异常）保持 null，由输入侧推断。
    if (error instanceof ModelGatewayInvocationError) {
      return {
        vector: null,
        degradationReason: embeddingGatewayErrorToRetrievalDegradation(error),
      };
    }
    return { vector: null, degradationReason: null };
  }
}

/**
 * 教学检索的服务端组合根。
 *
 * 无论向量能力是否配置，返回形状完全一致；调用方不需要知道本次是混合还是
 * 纯词法，只能从 `retriever` 字段诚实读出实际发生了什么。
 */
export async function retrieveTeachingEvidence(input: {
  trustedStudentId: string;
  sessionId: string;
  turnId: string;
  query: string;
  limit: number;
  traceId: string;
}): Promise<HybridRetrievalResult> {
  const identity = resolveWebEmbeddingIdentity();
  const gateway = identity ? resolveWebEmbeddingGateway() : null;
  const queryEmbedding = gateway
    ? await embedQuery(gateway, {
        query: input.query,
        traceId: input.traceId,
        turnId: input.turnId,
      })
    : null;
  const providerDegradationReason = queryEmbedding?.degradationReason ?? null;

  const result = await new DrizzleKnowledgeHybridRetrieval(
    getDb(),
  ).retrieveHybrid({
    trustedStudentId: input.trustedStudentId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    query: input.query,
    limit: input.limit,
    traceId: input.traceId,
    queryEmbedding: queryEmbedding?.vector ?? null,
    embeddingIdentity: identity,
    // Provider 已知原因优先：embedQuery 失败时 DB 输入侧会推断
    // invalid_configuration，此处传回精确 reason 防止被覆盖（B5）。
    inputDegradationReason: providerDegradationReason,
  });
  // Q04：检索 SLI —— 向量命中 / 词法回退只记录模式，不记录查询正文。
  getWebTelemetryRuntime().metrics.increment('retrieval_mode_total', {
    mode: result.vectorApplied ? 'vector' : 'lexical',
  });
  // Q02 接线：降级 reason 双通道记录——teaching-runtime 指标通道（平台可订阅）
  // 与全局 metrics 注册表（/v1/internal/metrics 暴露），均为低基数闭集标签。
  // Provider 原因优先于 DB 输入侧推断（二者互斥：Provider 失败时向量路径不执行，
  // 不会产生执行期 reason），同一降级只记一次。
  const degradationReason =
    providerDegradationReason ?? result.degradationReason;
  if (degradationReason) {
    recordRetrievalDegradation(webTeachingObservability, degradationReason);
    getWebTelemetryRuntime().metrics.increment('retrieval_degradations', {
      reason: degradationReason,
    });
  }
  return result;
}
