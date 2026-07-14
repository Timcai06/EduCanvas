import type { TeachingState } from './state-machine';

/** runtime允许模型请求的受控教学工具闭集。 */
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

/** runtime可识别的受控教学工具名称。 */
export type TeachingTool = (typeof teachingTools)[number];

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

/** 判断工具在当前状态是否获准；未知工具不会通过TypeScript边界。 */
export function isToolAllowed(
  state: TeachingState,
  tool: TeachingTool,
  policy: Readonly<
    Record<TeachingState, readonly TeachingTool[]>
  > = defaultToolPolicy,
): boolean {
  return policy[state].includes(tool);
}
