import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

describe('音频Artifact浏览器边界', () => {
  it('详情投影只返回受控media URL，不映射私有key/checksum', () => {
    const route = read(
      '../../app/api/v1/chat/artifacts/[artifactId]/route.ts',
    );
    const responseProjection = route.slice(route.indexOf('return Response.json'));
    expect(responseProjection).toContain('media:');
    expect(responseProjection).toContain('/audio`');
    expect(responseProjection).not.toContain('objectKey:');
    expect(responseProjection).not.toContain('checksum:');
  });

  it('媒体端点先做主体读取与SHA-256校验，再支持Range响应', () => {
    const route = read(
      '../../app/api/v1/chat/artifacts/[artifactId]/audio/route.ts',
    );
    expect(route).toContain('trustedSubjectId: identity.studentId');
    expect(route).toContain('.readVerified(');
    expect(route).toContain("request.headers.get('range')");
    expect(route).toContain("status: range ? 206 : 200");
  });
});
