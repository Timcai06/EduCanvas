import { describe, expect, it } from 'vitest';
import { loadMineruConfig, validateSubmitResponse } from './mineru-client';

describe('MinerU 服务端请求边界', () => {
  it.each([
    [
      'status_url 跨 origin',
      {
        task_id: 't-1',
        status_url: 'http://127.0.0.1:5432/private',
        result_url: 'https://mineru.example/tasks/t-1/result',
      },
    ],
    [
      'result_url 跨 origin',
      {
        task_id: 't-1',
        status_url: 'https://mineru.example/tasks/t-1',
        result_url: 'https://evil.example/result',
      },
    ],
    [
      '任务 URL 携带凭据',
      {
        task_id: 't-1',
        status_url: 'https://user:pass@mineru.example/tasks/t-1',
        result_url: 'https://mineru.example/tasks/t-1/result',
      },
    ],
  ])('%s 时拒绝外部响应', (_name, payload) => {
    expect(() =>
      validateSubmitResponse(payload, 'https://mineru.example'),
    ).toThrowError(/mineru_invalid_response/);
  });

  it.each([
    'https://user:pass@mineru.test',
    'https://mineru.test?target=x',
    'https://mineru.test#fragment',
  ])('拒绝带凭据、查询或片段的服务配置：%s', (baseUrl) => {
    expect(loadMineruConfig({ MINERU_BASE_URL: baseUrl })).toBeNull();
  });
});
