import type { ComponentType } from 'react';
import {
  canvasRendererManifestSchema,
  rendererSupportsResource,
  type CanvasRendererManifest,
  type CanvasResource,
} from '@educanvas/canvas-protocol';

/**
 * Props for every local trusted Canvas Renderer component.
 * The registry only hands out ComponentType<CanvasResourceRendererProps>;
 * callers must not receive raw manifest, URL, or loader references.
 *
 * `content` 是打开 Artifact 时由组合层注入的受控版本数据（`ArtifactVersionData`），
 * 仅 Artifact Renderer 使用；Source 内容经 preview 端点读取，不使用该槽。
 */
export interface CanvasResourceRendererProps {
  resource: CanvasResource;
  content?: unknown;
}

/** Discriminated union: the caller must switch on `kind` to narrow. */
export type CanvasResourceSelection =
  | {
      kind: 'available';
      Renderer: ComponentType<CanvasResourceRendererProps>;
      manifest: CanvasRendererManifest;
    }
  | {
      kind: 'unavailable';
      reason: UnavailableReason;
    };

/**
 * Stable, non-sensitive reason codes for Renderer unavailability.
 * No code exposes resource content, URL, stack traces, or object storage keys.
 */
export type UnavailableReason =
  | 'rendererId_not_registered'
  | 'rendererVersion_mismatch'
  | 'representation_not_supported'
  | 'trustTier_not_supported'
  | 'runtimeKind_not_supported'
  | 'action_not_supported'
  | 'renderer_incompatible';

interface InternalEntry {
  manifest: CanvasRendererManifest;
  Renderer: ComponentType<CanvasResourceRendererProps>;
}

// Module-private storage: keyed by the frozen registry handle object.
// WeakMap prevents the handle from being leaked and allows GC.
const registryStore = new WeakMap<object, Map<string, InternalEntry>>();

// Unique symbol brand prevents structural type forgery.
const BRAND = Symbol('CanvasResourceRegistry');

/**
 * Immutable handle to a local trusted Canvas Renderer registry.
 *
 * Only `readonly size` is publicly accessible.  No `get`, `has`, `keys`,
 * `set`, `delete`, or `clear` is exposed.  The handle is frozen to prevent
 * property injection.  Internal entries are stored in a module-private
 * WeakMap keyed by this handle — callers cannot obtain the underlying Map.
 */
export interface CanvasResourceRegistry {
  /** @internal */
  readonly [BRAND]: true;
  readonly size: number;
}

interface FrozenHandle {
  readonly size: number;
  readonly [BRAND]: true;
}

/**
 * Build an immutable CanvasResourceRegistry from validated local registrations.
 *
 * - Validates each manifest against the shared canvasRendererManifestSchema.
 * - Runtime-validates that every Renderer is a function component reference.
 * - Rejects duplicate rendererId + rendererVersion pairs (no silent overwrite).
 * - Stores only schema-parsed immutable snapshots, never the original references.
 * - Does not mutate the input array or any manifest.
 * - Pure computation: no network, database, or browser storage access.
 */
export function createCanvasResourceRegistry(
  registrations: readonly {
    manifest: CanvasRendererManifest;
    Renderer: ComponentType<CanvasResourceRendererProps>;
  }[],
): CanvasResourceRegistry {
  const entries = new Map<string, InternalEntry>();

  for (const registration of registrations) {
    // Runtime Renderer validation: only local function references accepted.
    if (typeof registration.Renderer !== 'function') {
      throw new Error('Renderer must be a local function component reference.');
    }

    const validation = canvasRendererManifestSchema.safeParse(
      registration.manifest,
    );
    if (!validation.success) {
      throw new Error(
        `Invalid manifest for renderer "${String((registration.manifest as Record<string, unknown>).rendererId ?? 'unknown')}": ${validation.error.issues.map((i) => i.message).join(', ')}`,
      );
    }

    const key = `${validation.data.rendererId}@${validation.data.rendererVersion}`;
    if (entries.has(key)) {
      throw new Error(
        `Duplicate registration: renderer "${validation.data.rendererId}" version ${validation.data.rendererVersion} is already registered.`,
      );
    }

    // Store an immutable snapshot of the schema-parsed manifest,
    // not the caller's original object reference.
    entries.set(key, {
      manifest: structuredClone(validation.data),
      Renderer: registration.Renderer,
    });
  }

  const handle: FrozenHandle = Object.freeze({
    size: entries.size,
    [BRAND]: true as const,
  });
  registryStore.set(handle, entries);
  return handle as CanvasResourceRegistry;
}

/**
 * Read an entry from the module-private registry store.
 * Returns undefined if the key is not registered.
 */
function getEntry(
  registry: CanvasResourceRegistry,
  key: string,
): InternalEntry | undefined {
  return registryStore.get(registry as unknown as object)?.get(key);
}

/**
 * Check if any registered key starts with the given prefix.
 */
function hasIdPrefix(
  registry: CanvasResourceRegistry,
  idPrefix: string,
): boolean {
  const store = registryStore.get(registry as unknown as object);
  if (!store) return false;
  for (const k of store.keys()) {
    if (k.startsWith(idPrefix)) return true;
  }
  return false;
}

/**
 * Determine the compatible local Renderer for a CanvasResource.
 *
 * Uses the shared rendererSupportsResource predicate — no duplicated logic.
 * Returns a discriminated union: `available` with the Renderer and immutable
 * manifest snapshot, or `unavailable` with a stable, non-sensitive reason code.
 *
 * When the result is `unavailable`, the object never contains stack traces,
 * resource content, URLs, or object storage information.
 */
export function selectCanvasResourceRenderer(
  registry: CanvasResourceRegistry,
  resource: CanvasResource,
): CanvasResourceSelection {
  const key = `${resource.renderer.rendererId}@${resource.renderer.rendererVersion}`;
  const entry = getEntry(registry, key);

  if (!entry) {
    const idPrefix = `${resource.renderer.rendererId}@`;
    if (!hasIdPrefix(registry, idPrefix)) {
      return { kind: 'unavailable', reason: 'rendererId_not_registered' };
    }
    return { kind: 'unavailable', reason: 'rendererVersion_mismatch' };
  }

  if (!rendererSupportsResource(entry.manifest, resource)) {
    if (
      !entry.manifest.representations.includes(resource.representation.kind)
    ) {
      return { kind: 'unavailable', reason: 'representation_not_supported' };
    }
    if (!entry.manifest.trustTiers.includes(resource.trustTier)) {
      return { kind: 'unavailable', reason: 'trustTier_not_supported' };
    }
    if (!entry.manifest.runtimeKinds.includes(resource.runtime.kind)) {
      return { kind: 'unavailable', reason: 'runtimeKind_not_supported' };
    }
    if (
      !resource.allowedActions.every((action) =>
        entry.manifest.supportedActions.includes(action),
      )
    ) {
      return { kind: 'unavailable', reason: 'action_not_supported' };
    }
    return { kind: 'unavailable', reason: 'renderer_incompatible' };
  }

  return {
    kind: 'available',
    Renderer: entry.Renderer,
    manifest: structuredClone(entry.manifest),
  };
}
