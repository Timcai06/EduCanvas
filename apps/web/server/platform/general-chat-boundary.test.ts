import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('默认通用Chat产品边界', () => {
  it('根入口组合通用Chat而不是K12课程页', () => {
    const page = source('../../app/page.tsx');
    expect(page).toContain('GeneralChatWorkspace');
    expect(page).not.toContain('demoLesson');
    expect(page).not.toContain('bootstrapAnonymousLesson');
    expect(page).not.toContain('猫狗');
  });

  it('Conversation ID变化时重建客户端工作区并重新水合历史消息', () => {
    const page = source('../../app/page.tsx');
    expect(page).toContain('key={data.conversation.id}');
  });

  it('通用Turn不导入教学Session、教学工具或固定课程', () => {
    const turn = source('./general-turn.ts');
    expect(turn).toContain('TurnApplicationService');
    expect(turn).not.toContain('AgentLoopEngine');
    expect(turn).not.toContain('AgentToolRegistry');
    expect(turn).toContain('默认不要假定用户是学生');
    expect(turn).not.toContain('demoLesson');
    expect(turn).not.toContain('lessonSessions');
    expect(turn).not.toContain('getStudentState');
    expect(turn).not.toContain("taskAlias: 'teaching.turn'");
  });
});
