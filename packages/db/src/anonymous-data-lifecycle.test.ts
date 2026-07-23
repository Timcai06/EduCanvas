import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_DATA_LIFECYCLE_REGISTRY,
  assertAnonymousDataLifecycleRegistryCoverage,
  isAnonymousSyntheticSubjectId,
} from './anonymous-data-lifecycle';

const currentSubjectOwnedTables = [
  'conversation_message_citations',
  'operation_sources',
  'artifact_generation_jobs',
  'artifact_versions',
  'artifacts',
  'conversation_messages',
  'agent_operations',
  'conversations',
  'spaces',
  'message_citations',
  'tool_calls',
  'model_runs',
  'turn_safety_decisions',
  'canvas_artifact_grading_keys',
  'canvas_artifacts',
  'retrieval_candidates',
  'turn_source_versions',
  'turn_source_snapshots',
  'session_source_bindings',
  'agent_message_parts',
  'chat_messages',
  'learning_events',
  'asset_versions',
  'assets',
  'lesson_sessions',
  'mastery_states',
] as const;

describe('匿名数据生命周期注册表', () => {
  it('显式固定当前subject-owned表与外键删除顺序', () => {
    expect(
      ANONYMOUS_DATA_LIFECYCLE_REGISTRY.map((entry) => entry.tableName),
    ).toEqual(currentSubjectOwnedTables);
    expect(
      ANONYMOUS_DATA_LIFECYCLE_REGISTRY.map((entry) => entry.deletionOrder),
    ).toEqual(Array.from({ length: 26 }, (_, index) => index + 1));
    expect(() =>
      assertAnonymousDataLifecycleRegistryCoverage(currentSubjectOwnedTables),
    ).not.toThrow();
  });

  it('为K1/T1/C1新增关联表提供缺失注册项门禁', () => {
    expect(() =>
      assertAnonymousDataLifecycleRegistryCoverage([
        ...currentSubjectOwnedTables,
        'future_subject_owned_table',
      ]),
    ).toThrow(/missing=future_subject_owned_table/);
  });

  it('只识别规范anon:v1哈希主体', () => {
    expect(isAnonymousSyntheticSubjectId(`anon:v1:${'a'.repeat(64)}`)).toBe(
      true,
    );
    expect(isAnonymousSyntheticSubjectId(`anon:v1:${'A'.repeat(64)}`)).toBe(
      false,
    );
    expect(isAnonymousSyntheticSubjectId('student-1')).toBe(false);
  });
});
