/**
 * Platform-controlled environment whitelist for CPU experiments.
 *
 * Only environments listed here with a pinned digest can be used.
 * Each entry specifies the exact Docker image digest and the set of
 * allowed dependencies. Requests referencing unknown environments,
 * undeclared packages, or version-mismatched packages are rejected
 * before any container starts.
 *
 * ## U14-R03 changes
 * - Only cpu-python-3.11 is allowed (cpu-node-22 removed).
 * - Image is pinned by digest, not mutable tag.
 * - Only python@3.11.15 is in the allowed dependency list (numpy, pandas,
 *   etc. are NOT pre-installed in python:3.11-slim and must not be claimed).
 */

export interface AllowedDependency {
  readonly name: string;
  readonly version: string;
}

export interface ExperimentEnvironment {
  readonly id: string;
  readonly description: string;
  readonly dockerImage: string;
  readonly entrypoint: readonly string[];
  readonly allowedDependencies: readonly AllowedDependency[];
}

export const EXPERIMENT_ENVIRONMENTS: readonly ExperimentEnvironment[] = [
  {
    id: 'cpu-python-3.11',
    description:
      'Python 3.11 CPU-only environment (pinned digest, no data science packages)',
    dockerImage:
      'python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93',
    entrypoint: ['python3'],
    allowedDependencies: [{ name: 'python', version: '3.11.15' }],
  },
] as const;

export function findEnvironment(
  environmentId: string,
): ExperimentEnvironment | undefined {
  return EXPERIMENT_ENVIRONMENTS.find((env) => env.id === environmentId);
}

export function isEnvironmentAllowed(environmentId: string): boolean {
  return findEnvironment(environmentId) !== undefined;
}

export function findAllowedDependency(
  environment: ExperimentEnvironment,
  dependencyName: string,
  dependencyVersion: string,
): AllowedDependency | undefined {
  return environment.allowedDependencies.find(
    (dep) => dep.name === dependencyName && dep.version === dependencyVersion,
  );
}
