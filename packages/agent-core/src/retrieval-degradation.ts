/**
 * 检索降级 reason 契约（Q02）。
 *
 * 低基数内部 reason：用于区分「混合检索为什么没有用上向量路」，落到
 * Trace/metric/health 标签时必须是这 9 个之一，禁止携带正文、query、
 * embedding 或高基数错误文本。
 *
 * 产生位置分三处：
 * - Embedding 网关侧（`embeddingGatewayErrorToRetrievalDegradation`）：
 *   provider_timeout / provider_unavailable / invalid_dimensions /
 *   invalid_configuration —— 由 Embedding/RAG runtime 在生成查询向量失败时映射；
 * - 混合检索入口侧（`@educanvas/db` retrieveHybrid 输入分类）：
 *   not_configured / invalid_configuration / invalid_dimensions —— 调用方没有
 *   提供可用的向量能力；
 * - 混合检索向量子查询侧（`@educanvas/db` 内部分类）：
 *   corpus_not_embedded / vector_query_timeout / extension_unavailable /
 *   fallback_fts —— 向量路执行时发现语料未嵌入、超时、扩展缺失或无法归类的错误。
 */
export const RETRIEVAL_DEGRADATION_REASONS = [
  'not_configured',
  'invalid_configuration',
  'provider_timeout',
  'provider_unavailable',
  'invalid_dimensions',
  'corpus_not_embedded',
  'vector_query_timeout',
  'extension_unavailable',
  'fallback_fts',
] as const;

export type RetrievalDegradationReason =
  (typeof RETRIEVAL_DEGRADATION_REASONS)[number];

/**
 * 把 Embedding 网关的归一化错误映射为检索降级 reason。
 *
 * 供 Embedding/RAG runtime 在调用 `EmbeddingModelGateway.embed` 失败时使用：
 * 网关错误码是稳定契约（`normalizedModelErrorCodes`），reason 是低基数标签，
 * 两者都禁止携带供应商原始响应或正文。
 */
export function embeddingGatewayErrorToRetrievalDegradation(error: {
  normalized: { code: string };
}): RetrievalDegradationReason {
  switch (error.normalized.code) {
    case 'timeout':
    case 'aborted':
      return 'provider_timeout';
    case 'unavailable':
    case 'rate_limit':
      return 'provider_unavailable';
    case 'invalid_response':
      return 'invalid_dimensions';
    case 'output_limit':
      return 'invalid_configuration';
    default:
      return 'fallback_fts';
  }
}
