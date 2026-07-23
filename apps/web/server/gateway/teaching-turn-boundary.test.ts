import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('Web Teaching Gateway 可信能力边界', () => {
  it('完整传递可信Route且Envelope只协商传输与渲染能力', () => {
    const runner = source('./teaching-turn.ts');
    const turn = source('../teaching/learning-turn.ts');
    const profile = source('../teaching/turn-application/profile.ts');

    expect(runner).toContain('route: input.route');
    expect(runner).toContain('transportCapabilities:');
    expect(runner).not.toContain('teachingToolCapabilitiesForState');
    expect(turn).toContain(
      'profile: { profileId: input.route.agentProfileId }',
    );
    expect(turn).toContain('input.route.membershipRole');
    expect(turn).not.toContain("profile: { profileId: 'k12.teacher' }");
    expect(profile).toContain('resolveWebTeachingToolPolicy');
    expect(profile).not.toContain('command.capabilities.includes');
  });
});
