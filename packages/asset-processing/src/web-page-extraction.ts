import { WebPageError } from './web-page-security';

export const WEB_PAGE_MAX_TEXT_CHARACTERS = 120_000;

export interface ReadableHtml {
  title: string | null;
  summary: string;
  text: string;
}

const HTML_ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (matched, decimal: string, hexadecimal: string, named: string) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hexadecimal) {
        return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      }
      return HTML_ENTITY_MAP[named.toLowerCase()] ?? matched;
    },
  );
}

function normalizeReadableText(value: string): string {
  return decodeHtmlEntities(value)
    .normalize('NFC')
    .replace(/\u0000/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Dependency-free conservative HTML extraction for worker and preview paths. */
export function extractReadableHtml(
  html: string,
  options: { allowEmptyText?: boolean } = {},
): ReadableHtml {
  const titleMatch = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/iu.exec(html);
  const title = titleMatch
    ? normalizeReadableText(titleMatch[1]!.replace(/<[^>]*>/gu, ' ')).slice(
        0,
        300,
      ) || null
    : null;
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(
      /<(script|style|noscript|svg|canvas|template)(?:\s[^>]*)?>[\s\S]*?<\/\1>/giu,
      ' ',
    )
    .replace(/<(nav|footer|aside)(?:\s[^>]*)?>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/article|\/section)>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');
  const text = [...normalizeReadableText(withoutNoise)]
    .slice(0, WEB_PAGE_MAX_TEXT_CHARACTERS)
    .join('');
  if (!text && !options.allowEmptyText) {
    throw new WebPageError('link_no_extractable_content');
  }
  return { title, summary: [...text].slice(0, 280).join(''), text };
}
