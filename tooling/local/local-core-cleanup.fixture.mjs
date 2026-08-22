/**
 * local-core-cleanup 集成测试 fixture：监听指定端口直到被杀。
 *
 * 用法：node local-core-cleanup.fixture.mjs <port> [gateway]
 *
 * - 默认模式：任意请求返回 200 'fixture'；
 * - 第二个参数为 `gateway` 时按 EduCanvas gateway 的健康协议响应
 *   `/healthz`（orchestrator 的 gatewayReady 探测），用于制造"半个 core"。
 *
 * 本文件路径位于仓库内，因此进程命令行天然包含 EduCanvas 特征，会被
 * cleanup 判定为可清理的残留进程。
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) {
  console.error('usage: local-core-cleanup.fixture.mjs <port> [gateway]');
  process.exit(2);
}
const isGateway = process.argv[3] === 'gateway';

const server = createServer((request, response) => {
  if (isGateway && request.url === '/healthz') {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        service: 'educanvas-gateway',
        protocol: 'gateway.v1',
      }),
    );
    return;
  }
  response.end('fixture');
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fixture listening on ${port}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
