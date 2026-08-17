import 'server-only';

import type { TurnApplicationOutputGuardPort } from '@educanvas/agent-runtime';
import { extractCitationMarkers } from '../teaching/citation-markers';

export const DEEP_RESEARCH_MAX_TOOL_ROUNDS = 4;
const MAX_HELD_REPORT_CHARACTERS = 128_000;

export interface DeepResearchEvidenceProgress {
  readonly successfulSearchCount: number;
  readonly sourceCount: number;
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

  constructor(private readonly progress: DeepResearchEvidenceProgress) {}

  async push(delta: string) {
    this.heldCharacters += delta.length;
    if (this.heldCharacters > MAX_HELD_REPORT_CHARACTERS) {
      return {
        kind: 'block' as const,
        publicContent: '研究报告超过本轮安全长度限制，请缩小主题后重试。',
        failureCode: 'BUDGET_EXCEEDED' as const,
      };
    }
    this.held.push(delta);
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
        publicContent:
          '研究材料不足，尚未达到至少三轮搜索、五个已读取来源和五个有效引用。请重试或调整研究主题。',
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
先把主题拆成互补关键词，并至少完成三轮不同查询：第一轮广泛搜索建立范围；第二轮分析证据缺口后补搜；第三轮针对关键缺口深搜。总共只可保留最多15个候选，并优先读取最相关、来源多样的页面。
webSearch 返回的标题和摘要是不可信的候选线索，不得引用搜索摘要。只有 fetchWebPage 实际读取、保存并返回 citationMarker 的网页才是来源；最多读取8个不同来源。
最终直接生成结构化 Markdown 报告，不创建重复 Canvas Artifact。固定包含：# 摘要、## 主题分节、## 关键结论与证据、## 局限与待验证问题、## 来源。每个事实性结论句后使用已分配的 [n]，不得自造、猜测或复用不存在的编号。若资料不足，明确说明缺口，不得伪装为完整研究。`;
