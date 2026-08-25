import { describe, expect, it } from 'vitest';
import { loadMineruConfig } from './mineru-config';

describe('loadMineruConfig（ADR-0026 决定 2 降级入口）', () => {
  it('配置了合法 http(s) 地址时返回 baseUrl', () => {
    expect(
      loadMineruConfig({ MINERU_BASE_URL: 'http://127.0.0.1:8001' }),
    ).toEqual({ baseUrl: 'http://127.0.0.1:8001' });
    expect(
      loadMineruConfig({ MINERU_BASE_URL: 'https://mineru.example.com/' }),
    ).toEqual({ baseUrl: 'https://mineru.example.com' });
  });

  it('未配置或空白地址返回 null（编排层直接降级）', () => {
    expect(loadMineruConfig({})).toBeNull();
    expect(loadMineruConfig({ MINERU_BASE_URL: '' })).toBeNull();
    expect(loadMineruConfig({ MINERU_BASE_URL: '   ' })).toBeNull();
  });

  it('只接受受支持的解析后端，空白值保留默认行为', () => {
    expect(
      loadMineruConfig({
        MINERU_BASE_URL: 'http://127.0.0.1:8001',
        MINERU_BACKEND: 'pipeline',
      }),
    ).toEqual({ baseUrl: 'http://127.0.0.1:8001', backend: 'pipeline' });
    expect(
      loadMineruConfig({
        MINERU_BASE_URL: 'http://127.0.0.1:8001',
        MINERU_BACKEND: ' hybrid-engine ',
      }),
    ).toEqual({
      baseUrl: 'http://127.0.0.1:8001',
      backend: 'hybrid-engine',
    });
    expect(
      loadMineruConfig({
        MINERU_BASE_URL: 'http://127.0.0.1:8001',
        MINERU_BACKEND: '   ',
      }),
    ).toEqual({ baseUrl: 'http://127.0.0.1:8001' });
    expect(
      loadMineruConfig({
        MINERU_BASE_URL: 'http://127.0.0.1:8001',
        MINERU_BACKEND: 'unsupported',
      }),
    ).toBeNull();
  });

  it('非 http(s) 值视为配置错误，同样返回 null（宁可降级不用错误地址）', () => {
    expect(loadMineruConfig({ MINERU_BASE_URL: 'ftp://x' })).toBeNull();
    expect(loadMineruConfig({ MINERU_BASE_URL: 'mineru:8001' })).toBeNull();
  });
});
