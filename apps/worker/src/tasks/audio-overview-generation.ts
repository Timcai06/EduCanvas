import type {
  ProviderCallMetadata,
  StructuredModelGateway,
} from '@educanvas/agent-core';
import type { AudioOverviewMetadata } from '@educanvas/canvas-protocol';
import { z } from 'zod';

export const AUDIO_OVERVIEW_PROMPT_VERSION = 'artifact-audio-overview-script-v1';
export const AUDIO_OVERVIEW_RULE_GENERATOR =
  'rule:audio-overview-script-v1';
export const AUDIO_OVERVIEW_MODEL_GENERATOR =
  'model:artifact.generate:audio-overview-script-v1';

const MAX_SOURCE_CONTEXT_CHARS = 14_000;
const MAX_SCRIPT_CHARS = 3_500;

const audioScriptSchema = z
  .object({ script: z.string().min(1).max(MAX_SCRIPT_CHARS) })
  .strict();

export interface AudioOverviewSource {
  displayName: string;
  content: string;
}

const normalizeLine = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const clip = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

/** 无模型时仍能把已验证来源压成一段可朗读脚本；不补写来源外事实。 */
export function buildRuleAudioOverviewScript(
  title: string,
  sources: readonly AudioOverviewSource[],
): string {
  const sections = sources.map((source, index) => {
    const content = clip(normalizeLine(source.content), 620);
    return `第${index + 1}部分，${normalizeLine(source.displayName)}。${content}`;
  });
  return clip(
    [
      `欢迎收听《${normalizeLine(title)}》。这份音频概览基于你勾选的${sources.length}项来源。`,
      ...sections,
      '以上是本次来源概览。重要结论请回到原始资料核对。',
    ].join('\n'),
    MAX_SCRIPT_CHARS,
  );
}

const toScriptAudit = (
  generator: string,
  metadata: ProviderCallMetadata | null,
): AudioOverviewMetadata['script'] => ({
  generator,
  provider: metadata?.provider ?? null,
  resolvedModelId: metadata?.resolvedModelId ?? null,
  inputTokens: metadata?.usage.inputTokens ?? 0,
  outputTokens: metadata?.usage.outputTokens ?? 0,
  latencyMs: metadata?.latencyMs ?? 0,
});

/** 模型已配置时必须成功过 Schema；失败不退回规则版，避免掩盖真实故障。 */
export async function generateAudioOverviewScript(input: {
  title: string;
  sources: readonly AudioOverviewSource[];
  gateway: StructuredModelGateway | null;
  traceId: string;
  operationId: string;
}): Promise<{
  script: string;
  audit: AudioOverviewMetadata['script'];
}> {
  if (!input.gateway) {
    return {
      script: buildRuleAudioOverviewScript(input.title, input.sources),
      audit: toScriptAudit(AUDIO_OVERVIEW_RULE_GENERATOR, null),
    };
  }

  let sourceContext = input.sources
    .map(
      (source, index) =>
        `[来源${index + 1}] ${source.displayName}\n${source.content.trim()}`,
    )
    .join('\n\n');
  if (sourceContext.length > MAX_SOURCE_CONTEXT_CHARS) {
    sourceContext = sourceContext.slice(0, MAX_SOURCE_CONTEXT_CHARS);
  }
  const result = await input.gateway.generateStructured({
    taskAlias: 'artifact.generate',
    modelAlias: 'structured',
    schema: audioScriptSchema,
    promptVersion: AUDIO_OVERVIEW_PROMPT_VERSION,
    traceId: input.traceId,
    operationId: input.operationId,
    messages: [
      {
        role: 'system',
        content: [
          '你是面向学生的中文音频概览编剧。',
          '只使用提供的来源，不补写外部事实；开头说明来源数量，正文按主题串联，结尾提醒回到原文核对。',
          '输出自然口语，适合单人朗读，不使用 Markdown、编号符号或舞台说明。',
          `script 最长 ${MAX_SCRIPT_CHARS} 个字符。`,
        ].join('\n'),
      },
      {
        role: 'user',
        content: `标题：${input.title}\n\n${sourceContext}`,
      },
    ],
  });
  return {
    script: result.output.script,
    audit: toScriptAudit(AUDIO_OVERVIEW_MODEL_GENERATOR, result.metadata),
  };
}
