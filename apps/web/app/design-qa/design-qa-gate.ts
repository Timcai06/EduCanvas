/** Design QA routes are production-build compatible but default to not found. */
export function isDesignQaEnabled(value: string | undefined) {
  return value === 'true';
}
