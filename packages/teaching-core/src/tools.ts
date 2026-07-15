import type { TeachingState } from './state-machine';
import { z } from 'zod';

/** runtime可识别的受控教学操作闭集；是否向模型暴露由执行层定义。 */
export const teachingTools = [
  'retrieveKnowledge',
  'getStudentState',
  'renderCanvas',
  'generateQuiz',
  'gradeAnswer',
  'requestHint',
  'updateMisconception',
  'recommendNextNode',
] as const;

/** 运行时用于拒绝未知工具字符串的唯一名称Schema。 */
export const teachingToolSchema = z.enum(teachingTools);

/** runtime可识别的受控教学工具名称。 */
export type TeachingTool = z.infer<typeof teachingToolSchema>;

const freezeToolList = (...tools: TeachingTool[]): readonly TeachingTool[] =>
  Object.freeze(tools);

/**
 * 阶段一状态×工具白名单。工具获准只代表可以发起调用，状态转移和掌握度更新仍需各自guard。
 */
export const defaultToolPolicy: Readonly<
  Record<TeachingState, readonly TeachingTool[]>
> = Object.freeze({
  DIAGNOSE: freezeToolList(
    'retrieveKnowledge',
    'getStudentState',
    'generateQuiz',
    'gradeAnswer',
    'requestHint',
    'updateMisconception',
  ),
  EXPLAIN: freezeToolList(
    'retrieveKnowledge',
    'getStudentState',
    'renderCanvas',
    'requestHint',
  ),
  DEMONSTRATE: freezeToolList(
    'retrieveKnowledge',
    'getStudentState',
    'renderCanvas',
    'requestHint',
  ),
  PRACTICE: freezeToolList(
    'retrieveKnowledge',
    'getStudentState',
    'renderCanvas',
    'generateQuiz',
    'gradeAnswer',
    'requestHint',
    'updateMisconception',
  ),
  ASSESS: freezeToolList(
    'getStudentState',
    'generateQuiz',
    'gradeAnswer',
    'requestHint',
    'updateMisconception',
    'recommendNextNode',
  ),
});

/** 判断已解析的工具在当前状态是否获准；运行时未知字符串必须先经Schema解析。 */
export function isToolAllowed(
  state: TeachingState,
  tool: TeachingTool,
  policy: Readonly<
    Record<TeachingState, readonly TeachingTool[]>
  > = defaultToolPolicy,
): boolean {
  return policy[state].includes(tool);
}
