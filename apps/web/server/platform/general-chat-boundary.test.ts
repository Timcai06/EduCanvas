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
    const turn = [
      source('./general-turn.ts'),
      source('./general-turn-profile.ts'),
    ].join('\n');
    expect(turn).toContain('TurnApplicationService');
    expect(turn).toContain('默认不要假定用户是学生');
    expect(turn).not.toContain('demoLesson');
    expect(turn).not.toContain('lessonSessions');
    expect(turn).not.toContain('getStudentState');
    expect(turn).not.toContain("taskAlias: 'teaching.turn'");
  });

  it('通用Turn拆分模块不引入K12 Runtime或第二套模型循环', () => {
    const modules = [
      source('./general-turn.ts'),
      source('./general-turn-lifecycle.ts'),
      source('./general-turn-persistence.ts'),
      source('./general-turn-profile.ts'),
      source('./general-turn-tool-policy.ts'),
      source('./general-turn-tools.ts'),
    ].join('\n');
    expect(modules).not.toContain('@educanvas/teaching-core');
    expect(modules).not.toContain('@educanvas/teaching-runtime');
    expect(modules).not.toContain('AgentLoopEngine');
    expect(modules).not.toContain('AgentToolRegistry');
  });

  it('Web兼容入口只从Gateway可信Route投影Profile与Membership', () => {
    const runner = source('../gateway/web-turn.ts');
    const turn = source('./general-turn.ts');
    const profile = source('./general-turn-profile.ts');

    expect(runner).toContain('route: input.route');
    expect(runner).toContain('transportCapabilities:');
    expect(turn).toContain(
      'profile: { profileId: input.route.agentProfileId }',
    );
    expect(turn).toContain('input.route.membershipRole');
    expect(turn).not.toContain("profileId: 'agent.general'");
    expect(turn).not.toContain(
      '...input.transportCapabilities, ...tools.staticCapabilities',
    );
    expect(profile).toContain('resolveWebGeneralToolPolicy');
    expect(profile).not.toContain('command.capabilities.includes');
  });
});
