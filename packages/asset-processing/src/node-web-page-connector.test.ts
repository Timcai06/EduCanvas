import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeWebPageConnector } from './node-web-page-connector';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server!.close((error) => (error ? reject(error) : resolve())),
  );
  server = undefined;
});

async function listen(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test server address unavailable');
  }
  return address.port;
}

describe('nodeWebPageConnector', () => {
  it('connects to the reviewed address while preserving the original Host', async () => {
    let receivedHost: string | undefined;
    const port = await listen((request, response) => {
      receivedHost = request.headers.host;
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<p>ok</p>');
    });

    const connection = await nodeWebPageConnector(
      new URL(`http://public.example:${port}/article?q=1`),
      { method: 'GET' },
      ['127.0.0.1'],
    );

    expect(connection.connectedAddress).toBe('127.0.0.1');
    expect(receivedHost).toBe(`public.example:${port}`);
    expect(await connection.response.text()).toBe('<p>ok</p>');
  });

  it('propagates caller cancellation to the bound socket', async () => {
    const port = await listen(() => undefined);
    const controller = new AbortController();
    const pending = nodeWebPageConnector(
      new URL(`http://public.example:${port}/hang`),
      { method: 'GET', signal: controller.signal },
      ['127.0.0.1'],
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
