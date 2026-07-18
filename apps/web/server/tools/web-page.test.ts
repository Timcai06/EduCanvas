import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { WebPageFetchError, extractReadableText, fetchReadableWebPage } =
  await import('./web-page');

const htmlResponse = (html: string, headers: Record<string, string> = {}) =>
  new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });

describe('extractReadableText', () => {
  it('抽取标题与正文,去脚本样式,解码实体,收敛空白', () => {
    const { title, text } = extractReadableText(
      `<html><head><title> 测试页 &amp; 标题 </title>
       <style>.x{color:red}</style><script>alert(1)</script></head>
       <body><h1>标题一</h1><p>第一段&nbsp;内容</p><div>第二段</div></body></html>`,
    );
    expect(title).toBe('测试页 & 标题');
    expect(text).toContain('标题一');
    expect(text).toContain('第一段 内容');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
  });
});

describe('fetchReadableWebPage', () => {
  it('拒绝非 http(s)、内网主机、非常规端口与带凭据 URL', async () => {
    for (const bad of [
      'ftp://example.com/a',
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://10.0.0.5/x',
      'http://172.20.1.1/x',
      'http://192.168.1.1/x',
      'http://169.254.1.1/x',
      'http://foo.local/x',
      'http://user:pass@example.com/x',
      'http://example.com:8080/x',
      'not-a-url',
    ]) {
      await expect(
        fetchReadableWebPage(bad, vi.fn() as unknown as typeof fetch),
      ).rejects.toBeInstanceOf(WebPageFetchError);
    }
  });

  it('手动跟随重定向且每跳重检,重定向进内网被拦截', async () => {
    const fetchStub = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('example.com')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://192.168.0.1/secret' },
        });
      }
      throw new Error('should not reach');
    });
    await expect(
      fetchReadableWebPage(
        'https://example.com/page',
        fetchStub as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: 'blocked_host' });
  });

  it('正常页面返回标题与正文;非文本内容与超大页面被拒绝', async () => {
    const okStub = (async () =>
      htmlResponse(
        '<html><head><title>猫狗分类</title></head><body><p>神经网络提取特征。</p></body></html>',
      )) as unknown as typeof fetch;
    const page = await fetchReadableWebPage('https://example.com/a', okStub);
    expect(page.title).toBe('猫狗分类');
    expect(page.text).toContain('神经网络提取特征');

    const pdfStub = (async () =>
      new Response('x', {
        headers: { 'content-type': 'application/pdf' },
      })) as unknown as typeof fetch;
    await expect(
      fetchReadableWebPage('https://example.com/b', pdfStub),
    ).rejects.toMatchObject({ code: 'unsupported_content' });

    const hugeStub = (async () =>
      htmlResponse('<p>x</p>', {
        'content-length': String(10 * 1024 * 1024),
      })) as unknown as typeof fetch;
    await expect(
      fetchReadableWebPage('https://example.com/c', hugeStub),
    ).rejects.toMatchObject({ code: 'too_large' });
  });
});
