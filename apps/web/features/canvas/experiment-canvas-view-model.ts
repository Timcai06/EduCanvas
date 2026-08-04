import {
  experimentDependencySchema,
  experimentFailureCodeSchema,
  experimentInputMountSchema,
  experimentLogEntrySchema,
  experimentOutputArtifactSchema,
  experimentProvenanceSchema,
  experimentResourceBudgetSchema,
  experimentRunResultSchema,
  experimentRunTerminalStatusSchema,
  type ExperimentLogEntry,
} from '@educanvas/agent-core';
import { z } from 'zod';

export const EXPERIMENT_CANVAS_MAX_CODE_CHARS = 65_536;
export const EXPERIMENT_CANVAS_VISIBLE_CODE_CHARS = 16_384;
export const EXPERIMENT_CANVAS_VISIBLE_LOG_CHARS = 16_384;
export const EXPERIMENT_CANVAS_MAX_TABLE_ROWS = 100;
export const EXPERIMENT_CANVAS_VISIBLE_TABLE_ROWS = 25;
export const EXPERIMENT_CANVAS_MAX_CHART_POINTS = 200;
export const EXPERIMENT_CANVAS_VISIBLE_CHART_POINTS = 50;

const opaqueIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const displayTextSchema = z.string().max(200);

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectProvenanceInput(
  input: z.infer<typeof experimentInputMountSchema>,
) {
  return {
    mountName: input.mountName,
    artifactId: input.artifactId,
    artifactVersionId: input.artifactVersionId,
    checksum: input.checksum,
  };
}

function projectOutputReference(
  output: z.infer<typeof experimentCanvasOutputViewSchema>,
) {
  return {
    artifactId: output.artifactId,
    artifactVersionId: output.artifactVersionId,
    kind: output.kind,
    mimeType: output.mimeType,
    checksum: output.checksum,
    byteSize: output.byteSize,
  };
}

const tablePreviewSchema = z
  .object({
    kind: z.literal('table'),
    caption: displayTextSchema,
    columns: z.array(z.string().max(100)).min(1).max(20),
    rows: z
      .array(z.array(z.string().max(200)).max(20))
      .max(EXPERIMENT_CANVAS_MAX_TABLE_ROWS),
  })
  .strict()
  .superRefine((preview, context) => {
    preview.rows.forEach((row, rowIndex) => {
      if (row.length !== preview.columns.length) {
        context.addIssue({
          code: 'custom',
          path: ['rows', rowIndex],
          message: 'Table rows must match the declared column count',
        });
      }
    });
  });

const chartPointSchema = z
  .object({
    x: z.union([z.number().finite(), z.string().max(100)]),
    y: z.number().finite(),
  })
  .strict();

const chartPreviewSchema = z
  .object({
    kind: z.literal('chart'),
    chartType: z.enum(['line', 'bar', 'scatter']),
    title: displayTextSchema,
    xLabel: z.string().max(100).nullable(),
    yLabel: z.string().max(100).nullable(),
    series: z
      .array(
        z
          .object({
            label: z.string().min(1).max(100),
            points: z
              .array(chartPointSchema)
              .max(EXPERIMENT_CANVAS_MAX_CHART_POINTS),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export const experimentCanvasOutputViewSchema = z
  .object({
    ...experimentOutputArtifactSchema.shape,
    label: z.string().min(1).max(200),
    preview: z
      .discriminatedUnion('kind', [tablePreviewSchema, chartPreviewSchema])
      .nullable(),
  })
  .strict();

const executionFields = {
  title: z.string().trim().min(1).max(300),
  runId: opaqueIdSchema,
  code: z
    .object({
      language: z.literal('python'),
      content: z.string().max(EXPERIMENT_CANVAS_MAX_CODE_CHARS),
      codeVersionId: opaqueIdSchema,
      codeHash: sha256Schema,
    })
    .strict(),
  environmentId: z.string().trim().min(1).max(256),
  inputs: z.array(experimentInputMountSchema).min(1).max(32),
  dependencies: z.array(experimentDependencySchema).min(1).max(64),
  randomSeed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  resourceBudget: experimentResourceBudgetSchema,
};

const unavailableViewSchema = z
  .object({
    status: z.literal('unavailable'),
    title: z.string().trim().min(1).max(300),
    reason: z.enum([
      'experiment_not_available',
      'experiment_details_unavailable',
      'experiment_version_unavailable',
    ]),
  })
  .strict();

const activeViewSchema = z
  .object({
    ...executionFields,
    status: z.enum(['queued', 'running']),
    logs: z.array(experimentLogEntrySchema).max(64),
  })
  .strict();

const terminalViewSchema = z
  .object({
    ...executionFields,
    status: experimentRunTerminalStatusSchema,
    result: experimentRunResultSchema,
    provenance: experimentProvenanceSchema,
    outputViews: z.array(experimentCanvasOutputViewSchema).max(128),
  })
  .strict()
  .superRefine((view, context) => {
    if (
      view.result.status !== view.status ||
      view.provenance.terminalStatus !== view.status
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Terminal status must match result and provenance',
      });
    }
    if (
      view.result.runId !== view.runId ||
      view.provenance.runId !== view.runId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'Terminal evidence must belong to the displayed run',
      });
    }
    if (
      view.provenance.codeVersionId !== view.code.codeVersionId ||
      view.provenance.codeHash !== view.code.codeHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'Displayed code must match terminal provenance',
      });
    }
    const displayedInputs = view.inputs.map(projectProvenanceInput);
    if (
      view.provenance.environmentId !== view.environmentId ||
      view.provenance.randomSeed !== view.randomSeed ||
      !sameJson(view.provenance.dependencies, view.dependencies) ||
      !sameJson(view.provenance.inputs, displayedInputs) ||
      !sameJson(view.provenance.resourceBudget, view.resourceBudget)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provenance'],
        message: 'Displayed configuration must match terminal provenance',
      });
    }
    if (view.provenance.failureCode !== view.result.failureCode) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'failureCode'],
        message: 'Result and provenance failure codes must match',
      });
    }
    const displayedOutputs = view.outputViews.map(projectOutputReference);
    if (
      !sameJson(displayedOutputs, view.result.outputs) ||
      !sameJson(displayedOutputs, view.provenance.outputs)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outputViews'],
        message: 'Displayed outputs must match the terminal result',
      });
    }
  });

export const experimentCanvasViewModelSchema = z.union([
  unavailableViewSchema,
  activeViewSchema,
  terminalViewSchema,
]);

export type ExperimentCanvasViewModel = z.infer<
  typeof experimentCanvasViewModelSchema
>;
export type ExperimentCanvasOutputView = z.infer<
  typeof experimentCanvasOutputViewSchema
>;

export type ExperimentCanvasViewParseResult =
  | { kind: 'available'; value: ExperimentCanvasViewModel }
  | { kind: 'unavailable' };

/** Invalid or oversized browser data becomes a stable unavailable state. */
export function parseExperimentCanvasViewModel(
  input: unknown,
): ExperimentCanvasViewParseResult {
  const parsed = experimentCanvasViewModelSchema.safeParse(input);
  return parsed.success
    ? { kind: 'available', value: parsed.data }
    : { kind: 'unavailable' };
}

export function truncateExperimentText(
  content: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  const characters = Array.from(content);
  if (characters.length <= maxChars) return { text: content, truncated: false };
  return { text: characters.slice(0, maxChars).join(''), truncated: true };
}

export function selectVisibleExperimentLogs(
  entries: readonly ExperimentLogEntry[],
): { entries: ExperimentLogEntry[]; truncated: boolean } {
  const visible: ExperimentLogEntry[] = [];
  let remaining = EXPERIMENT_CANVAS_VISIBLE_LOG_CHARS;
  let truncated = false;

  for (const entry of entries) {
    if (entry.kind === 'artifact_ref') {
      visible.push(entry);
      continue;
    }
    const limited = truncateExperimentText(entry.content, remaining);
    visible.push({ kind: 'text', content: limited.text });
    remaining -= Array.from(limited.text).length;
    if (limited.truncated) truncated = true;
    if (remaining === 0) {
      truncated ||= visible.length < entries.length;
      break;
    }
  }

  return { entries: visible, truncated };
}

export function getExperimentCanvasLogs(
  model: Exclude<ExperimentCanvasViewModel, { status: 'unavailable' }>,
): readonly ExperimentLogEntry[] {
  return 'result' in model ? model.result.logs : model.logs;
}

export function getExperimentFailureCode(
  model: Exclude<ExperimentCanvasViewModel, { status: 'unavailable' }>,
): z.infer<typeof experimentFailureCodeSchema> | null {
  return 'result' in model && model.status === 'failed'
    ? model.result.failureCode
    : null;
}
