export type TelemetryHealthSnapshot =
  | { status: 'disabled' | 'ready' }
  | {
      status: 'degraded';
      failureCode:
        'invalid_configuration' | 'initialization_failed' | 'export_failed';
    };

/** @internal 只保存低基数状态码，不保存Exporter异常或配置值。 */
export class MutableTelemetryHealth {
  private current: TelemetryHealthSnapshot;

  constructor(initial: TelemetryHealthSnapshot) {
    this.current = initial;
  }

  snapshot(): TelemetryHealthSnapshot {
    return this.current;
  }

  ready(): void {
    this.current = { status: 'ready' };
  }

  degraded(
    failureCode: Extract<
      TelemetryHealthSnapshot,
      { status: 'degraded' }
    >['failureCode'],
  ): void {
    this.current = { status: 'degraded', failureCode };
  }
}
