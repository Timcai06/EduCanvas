/**
 * Provider-, DOM-, and persistence-free boundary for executing one immutable
 * artifact version. The implementation owns sandbox transport, never an Agent loop.
 */
export interface WebRuntimeArtifactVersionReference {
  readonly notebookId: string;
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly contentHash: string;
}

export interface WebRuntimeResourceLimits {
  readonly maxDurationMs: number;
  readonly maxInputBytes: number;
  readonly maxMessageBytes: number;
  readonly maxOutputBytes: number;
}

export type WebRuntimeFailureCode =
  | 'runtime_timeout'
  | 'runtime_crashed'
  | 'resource_quota_exceeded'
  | 'execution_failed'
  | 'cancel_race_rejected';

export type WebRuntimeEvent =
  | { readonly type: 'ready' }
  | {
      readonly type: 'output';
      readonly kind: 'text' | 'json';
      readonly value: string;
    }
  | { readonly type: 'succeeded' }
  | {
      readonly type: 'failed';
      readonly failureCode: WebRuntimeFailureCode;
    }
  | { readonly type: 'cancelled' };

export interface WebRuntimeExecutionRequest {
  readonly artifact: WebRuntimeArtifactVersionReference;
  readonly resources: WebRuntimeResourceLimits;
  readonly signal: AbortSignal;
}

export interface WebRuntimePort {
  execute(request: WebRuntimeExecutionRequest): AsyncIterable<WebRuntimeEvent>;
}
