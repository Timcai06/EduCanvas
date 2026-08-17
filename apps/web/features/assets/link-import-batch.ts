export const MAX_LINK_IMPORTS = 10;
export const LINK_IMPORT_CONCURRENCY = 3;

/** 用户粘贴边界：容忍中英文逗号与换行，并按首次出现顺序去重。 */
export function parseLinkImportInput(value: string): {
  urls: readonly string[];
  overflowCount: number;
} {
  const unique = [
    ...new Set(
      value
        .split(/[,，\n\r]+/u)
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
  return {
    urls: unique.slice(0, MAX_LINK_IMPORTS),
    overflowCount: Math.max(0, unique.length - MAX_LINK_IMPORTS),
  };
}

/** 保持输入顺序的有界并发 map，单个 job 失败交由 mapper 决定如何投影。 */
export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  mapper: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }
  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index] as Input, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}
