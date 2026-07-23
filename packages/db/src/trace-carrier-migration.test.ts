import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../drizzle/0032_famous_starfox.sql', import.meta.url),
);

describe('0032 continuation trace carrier migration', () => {
  it('只添加nullable列与严格CHECK，不设置默认值或回填旧行', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain(
      'ALTER TABLE "operation_continuations" ADD COLUMN "trace_parent" text;',
    );
    expect(migration).toContain(
      'ALTER TABLE "tool_approval_intents" ADD COLUMN "trace_parent" text;',
    );
    expect(migration).toContain(
      'CONSTRAINT "operation_continuations_trace_parent_check"',
    );
    expect(migration).toContain(
      'CONSTRAINT "tool_approval_intents_trace_parent_check"',
    );
    expect(migration).toContain("~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'");
    expect(migration).toContain("<> repeat('0', 32)");
    expect(migration).toContain("<> repeat('0', 16)");
    expect(migration).not.toMatch(/trace_parent[^;]*(default|not null)/i);
    expect(migration).not.toMatch(/\b(update|insert into)\b/i);
  });
});
