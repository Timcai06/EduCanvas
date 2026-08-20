const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function normalizeSearchProviderBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function normalizePublicSearchResultUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      return null;
    }
    url.hash = '';
    const normalized = url.toString();
    return normalized.length <= 1024 ? normalized : null;
  } catch {
    return null;
  }
}

export function toSearchResultFields(input: {
  title?: string;
  url: string;
  snippet?: string;
}): {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
} {
  return {
    title: clip(input.title?.trim() || input.url, 200),
    url: input.url,
    snippet: clip((input.snippet ?? '').trim(), 400),
    sourceDomain: new URL(input.url).hostname.replace(/^www\./, ''),
  };
}
