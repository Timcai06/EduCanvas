import { describe, expect, it } from 'vitest';
import { createToolSemanticsHash } from './tool-kernel/semantics';
import { adapter, context } from './tool-kernel.test-support';

describe('Tool Kernel语义摘要', () => {
  it('null绑定保持旧hash，非空绑定参与摘要并防止漂移', () => {
    const request = {
      tool: 'runLocal',
      arguments: { value: 'same' },
      context: context('verifier-semantics'),
    };
    const legacy = createToolSemanticsHash(
      adapter({ effect: 'write' }),
      request,
    );
    const first = createToolSemanticsHash(
      adapter({ effect: 'write', reconciliationVerifierId: 'adapter:first' }),
      request,
    );
    const changed = createToolSemanticsHash(
      adapter({ effect: 'write', reconciliationVerifierId: 'adapter:changed' }),
      request,
    );

    expect(legacy).toBe(
      '2a3253fd61748749355c6fdfde83783c3a4f04f8f306b9da1b088ac668f3597a',
    );
    expect(first).not.toBe(changed);
    expect(first).not.toBe(legacy);
  });
});
