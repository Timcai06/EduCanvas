/**
 * V02-V fixture server：本地 OpenAI-compatible /audio/transcriptions mock。
 * 只在 127.0.0.1 上监听随机端口，模拟 Provider 的成功与失败响应，用于验证
 * cloudFinal 链路而不产生真实付费调用。请求体（含音频）直接丢弃。
 * 场景通过 --scenario 指定，端口打印到 stdout 供矩阵脚本解析。
 */

import { createServer } from 'node:http';

const scenario = parseScenario(process.argv[2] ?? 'success');

const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/audio/transcriptions')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  req.resume(); // 丢弃请求体（可能含音频与假 key），不落盘不打印。
  switch (scenario.name) {
    case 'success':
      respondJson(res, 200, {
        text: 'Bagging and boosting are two classic ensemble methods. Bagging reduces variance, while boosting reduces bias.',
        language: 'english',
        duration: 10,
      });
      break;
    case 'unauthorized':
      respondJson(res, 401, { error: 'invalid_api_key' });
      break;
    case 'forbidden':
      respondJson(res, 403, { error: 'permission_denied' });
      break;
    case 'rate_limit':
      respondJson(res, 429, { error: 'rate_limit_exceeded' });
      break;
    case 'server_error':
      respondJson(res, 500, { error: 'internal_error' });
      break;
    case 'invalid_json':
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{not valid json');
      break;
    case 'empty_transcript':
      respondJson(res, 200, { text: '', language: 'english', duration: 10 });
      break;
    case 'slow':
      setTimeout(() => {
        respondJson(res, 200, {
          text: 'Bagging and boosting are two classic ensemble methods.',
          language: 'english',
          duration: 10,
        });
      }, scenario.delayMs);
      break;
    default:
      respondJson(res, 500, { error: 'unknown_scenario' });
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    process.stdout.write(`${address.port}\n`);
  }
});

function respondJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseScenario(value) {
  const [name, delayRaw] = value.split(':');
  const delayMs = Number(delayRaw) > 0 ? Number(delayRaw) : 2000;
  return { name, delayMs };
}
