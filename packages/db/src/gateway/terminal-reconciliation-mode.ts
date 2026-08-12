/** CA02 terminal acknowledgement-gap repair can be rolled back to the legacy append-only path. */
export type GatewayTerminalReconciliationMode = 'enabled' | 'legacy-disabled';

/**
 * Parses the composition-root flag without reflecting its raw value. An absent flag enables the
 * repair; any configured value outside the closed enum prevents startup.
 */
export function resolveGatewayTerminalReconciliationMode(
  raw: string | undefined,
): GatewayTerminalReconciliationMode {
  if (raw === undefined) return 'enabled';
  const value = raw.trim();
  if (value === 'enabled' || value === 'legacy-disabled') return value;
  throw new Error(
    'EDUCANVAS_GATEWAY_TERMINAL_RECONCILIATION_MODE must be enabled or legacy-disabled',
  );
}
