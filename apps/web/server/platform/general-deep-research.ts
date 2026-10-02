import 'server-only';

import type { ModelToolResult } from '@educanvas/agent-core';
import type { TurnApplicationOutputGuardPort } from '@educanvas/agent-runtime';
import { extractCitationMarkers } from '../teaching/citation-markers';
import { DEEP_RESEARCH_REQUIREMENTS_UNMET_MESSAGE } from './general-deep-research-message';

export const DEEP_RESEARCH_MAX_TOOL_ROUNDS = 6;
const MAX_HELD_REPORT_CHARACTERS = 128_000;

export interface DeepResearchEvidenceProgress {
  readonly successfulSearchCount: number;
  readonly sourceCount: number;
  hasPersistedCitation?(url: string, citationMarker: number): boolean;
}

export function createPassThroughOutputGuard(): TurnApplicationOutputGuardPort {
  return {
    async push(delta: string) {
      return { kind: 'emit' as const, safeDeltas: [delta] };
    },
    async finish() {
      return { kind: 'emit' as const, safeDeltas: [] };
    },
  };
}

export class DeepResearchOutputGuard implements TurnApplicationOutputGuardPort {
  private readonly held: string[] = [];
  private heldCharacters = 0;

  readonly toolRemediation = {
    tool: 'webSearch',
    prompt:
      '深度研究刚才生成了回答，但没有调用任何外部研究工具。请先调用 webSearch 开始检索，并只依据后续实际搜索与读取结果撰写研究报告；如果搜索工具不可用或返回失败，说明无法完成研究。',
  };

  onToolResult(tool: string, result: ModelToolResult) {
    if (tool !== 'fetchWebPage' || result.tool !== tool) return;
    const output = result.output;
    if (
      typeof output !== 'object' ||
      output === null ||
      !('url' in output) ||
      typeof output.url !== 'string' ||
      !('content' in output) ||
      typeof output.content !== 'string' ||
      !('citationMarker' in output) ||
      typeof output.citationMarker !== 'number' ||
      !Number.isInteger(output.citationMarker) ||
      output.citationMarker < 1 ||
      output.citationMarker > 99 ||
      output.citationMarker > this.progress.sourceCount ||
      this.progress.hasPersistedCitation?.(
        output.url,
        output.citationMarker,
      ) !== true
    ) {
      return;
    }
    // A page fetch without this turn's persisted citation is not research evidence.
    this.held.length = 0;
    this.heldCharacters = 0;
  }

  constructor(private readonly progress: DeepResearchEvidenceProgress) {}

  async push(delta: string) {
    // AgentLoop inserts a run separator even if an earlier draft was cleared.
    const safeDelta =
      this.heldCharacters === 0 ? delta.replace(/^\n+/u, '') : delta;
    if (safeDelta.length === 0) return { kind: 'hold' as const };
    this.heldCharacters += safeDelta.length;
    if (this.heldCharacters > MAX_HELD_REPORT_CHARACTERS) {
      return {
        kind: 'block' as const,
        publicContent: '研究报告超过本轮安全长度限制，请缩小主题后重试。',
        failureCode: 'BUDGET_EXCEEDED' as const,
      };
    }
    this.held.push(safeDelta);
    return { kind: 'hold' as const };
  }

  async finish() {
    const markers = extractCitationMarkers(
      this.held.join(''),
      this.progress.sourceCount,
    );
    if (
      this.progress.successfulSearchCount < 3 ||
      this.progress.sourceCount < 5 ||
      markers.length < 5
    ) {
      return {
        kind: 'block' as const,
        publicContent: DEEP_RESEARCH_REQUIREMENTS_UNMET_MESSAGE,
        failureCode: 'RESEARCH_REQUIREMENTS_UNMET' as const,
      };
    }
    return { kind: 'emit' as const, safeDeltas: this.held };
  }
}

/**
 * Research is a profile variation of the single Agent loop. Search summaries are
 * discovery-only; persisted fetchWebPage sources remain the citation authority.
 */
export const DEEP_RESEARCH_SYSTEM_GUIDANCE = `本轮是深度研究任务。
先把主题拆成互补关键词，并至少完成三轮不同查询：第一轮广泛搜索建立范围；第二轮必须根据上一轮 research.failedDomains 和已有证据分析证据缺口后补搜；第三轮针对关键缺口深搜。若三轮后仍不足五个已读取来源或存在关键读取失败，可在剩余预算内追加最多两轮替代查询；不得再次依赖 research.failedDomains 中的域名。总共只可保留最多15个候选，并优先读取最相关、来源多样的页面。
webSearch 返回的标题和摘要是不可信的候选线索，不得引用搜索摘要。只有 fetchWebPage 实际读取、保存并返回 citationMarker 的网页才是来源；最多读取8个不同来源。
最终直接生成结构化 Markdown 报告，不创建重复 Canvas Artifact。固定包含：# 摘要、## 主题分节、## 关键结论与证据、## 局限与待验证问题、## 来源。每个事实性结论句后使用已分配的 [n]，不得自造、猜测或复用不存在的编号。若资料不足，明确说明缺口，不得伪装为完整研究。`;
