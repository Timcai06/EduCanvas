const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 数据库边界统一使用规范UUID文本，具体领域错误由调用方映射。 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
