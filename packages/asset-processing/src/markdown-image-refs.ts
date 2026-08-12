/**
 * Markdown 图片引用的服务端投影（ADR-0026 决定 3：图片引用重写为已鉴权
 * 的 Canvas Source resource URL，不暴露私有存储位置）。
 *
 * 重写发生在读取/投影时，不改写对象存储里的 `index.md`——派生表示保持
 * 供应商输出的原样字节（不可变原件语义），鉴权 URL 由调用方经 `resolve`
 * 注入（D 阶段的资源路由）。
 *
 * 只处理 MinerU 实际产出的内联式图片引用 `![alt](images/x.jpg "title")`：
 * - 仅 `images/` 前缀的相对路径会交给 resolver；
 * - 外部 URL（http/https/data:）与其它相对路径保留原样——外部内容不是
 *   派生资源，不能把任意链接投影成本地资源；
 * - fenced code block 内的引用不重写（不可信输入防御）。行内代码中的
 *   引用不在处理范围（MinerU 输出无此场景）。
 */

const IMAGE_REF_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
/** fenced code block 开闭行（``` 或 ~~~）。 */
const FENCE_PATTERN = /^\s*(```|~~~)/;

/** 相对路径解析器：返回鉴权 URL；null 表示不重写（保留原样）。 */
export type ImageRefResolver = (relativePath: string) => string | null;

/**
 * 重写 Markdown 中的派生图片引用。纯函数、幂等。
 */
export function rewriteMarkdownImageRefs(
  markdown: string,
  resolve: ImageRefResolver,
): string {
  const lines = markdown.split('\n');
  let inFence = false;
  const rewritten = lines.map((line) => {
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(IMAGE_REF_PATTERN, (whole, _alt, path: string) => {
      if (!path.startsWith('images/')) return whole;
      const url = resolve(path);
      if (url === null) return whole;
      return whole.replace(path, url);
    });
  });
  return rewritten.join('\n');
}
