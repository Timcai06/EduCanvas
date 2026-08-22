function validateOptionalHttpBaseUrl(name, value, fail) {
  const raw = value(name);
  if (raw === '') return;
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${name} is not a valid URL`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    fail(`${name} must be http(s) without credentials, query, or fragment`);
  }
}

function validateOptionalSecret(name, value, fail) {
  const secret = value(name);
  if (
    secret !== '' &&
    (secret.length > 4_096 || !/^[\x21-\x7e]+$/.test(secret))
  ) {
    fail(`${name} has an invalid shape`);
  }
}

export function validateSearchEnvironment({ value, fail }) {
  const searchApiKey = value('SEARCH_API_KEY');
  const searchBaseUrl = value('SEARCH_BASE_URL');
  if (searchBaseUrl !== '' && searchApiKey === '') {
    fail('missing search provider values: SEARCH_API_KEY');
  }
  validateOptionalSecret('SEARCH_API_KEY', value, fail);
  validateOptionalHttpBaseUrl('SEARCH_BASE_URL', value, fail);

  const searxngBaseUrl = value('SEARXNG_BASE_URL');
  const searxngApiKey = value('SEARXNG_API_KEY');
  if (searxngApiKey !== '' && searxngBaseUrl === '') {
    fail('missing SearXNG provider values: SEARXNG_BASE_URL');
  }
  validateOptionalSecret('SEARXNG_API_KEY', value, fail);
  validateOptionalHttpBaseUrl('SEARXNG_BASE_URL', value, fail);
}
