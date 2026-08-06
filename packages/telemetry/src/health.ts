export type TelemetryHealthSnapshot =
  | { status: 'disabled' | 'ready' }
  | {
      status: 'degraded';
      failureCode:
        'invalid_configuration' | 'initialization_failed' | 'export_failed';
    };

/** @internal 只保存低基数状态码，不保存Exporter异常或配置值。 */
export class MutableTelemetryHealth {
  private readonly onChange:
    ((snapshot: TelemetryHealthSnapshot) => void) | null;
  private current: TelemetryHealthSnapshot;

  constructor(
    initial: TelemetryHealthSnapshot,
    onChange?: (snapshot: TelemetryHealthSnapshot) => void,
  ) {
    this.current = initial;
    this.onChange = onChange ?? null;
  }

  snapshot(): TelemetryHealthSnapshot {
    return this.current;
  }

  ready(): void {
    this.current = { status: 'ready' };
    this.onChange?.(this.current);
  }

  degraded(
    failureCode: Extract<
      TelemetryHealthSnapshot,
      { status: 'degraded' }
    >['failureCode'],
  ): void {
    this.current = { status: 'degraded', failureCode };
    this.onChange?.(this.current);
  }
}
