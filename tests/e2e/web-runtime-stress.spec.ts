import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { WebRuntimeConfig } from '@educanvas/web-runtime/config';
import { createWebRuntimeHandler } from '@educanvas/web-runtime/server';

const RUNS = {
  loop: '10000000-0000-4000-8000-000000000001',
  memory: '10000000-0000-4000-8000-000000000002',
  clean: '10000000-0000-4000-8000-000000000003',
} as const;
const TOKEN = 'a'.repeat(43);
const VERSION = '20000000-0000-4000-8000-000000000001';
const NOTEBOOK = '30000000-0000-4000-8000-000000000001';
const HASH = 'b'.repeat(64);

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('server_address_unavailable'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function harnessPage(runtimeOrigin: string): string {
  return `<!doctype html><html><body>
<output id="heartbeat">0</output><output id="state">idle</output>
<button id="loop">loop</button><button id="memory">memory</button>
<button id="destroy">destroy</button><button id="clean">clean</button>
<main id="mount"></main>
<script>
const runtimeOrigin=${JSON.stringify(runtimeOrigin)};
let frame=null;let currentRun=null;let ticks=0;
setInterval(()=>heartbeat.textContent=String(++ticks),25);
const binding=(runId)=>({
  protocolVersion:"educanvas.web-runtime.v1",
  channelId:"channel-"+runId,
  runtimeId:"40000000-0000-4000-8000-"+runId.slice(-12),
  notebookId:${JSON.stringify(NOTEBOOK)},
  artifactVersionId:${JSON.stringify(VERSION)},
  artifactContentHash:${JSON.stringify(HASH)}
});
function start(runId){
  currentRun=runId;
  state.textContent="loading";
  frame=document.createElement("iframe");
  frame.src=runtimeOrigin+"/host";
  frame.id="runtime-frame";
  frame.onload=()=>frame.contentWindow.postMessage({
    type:"educanvas.runtime.bootstrap",
    runId,
    bootstrapToken:${JSON.stringify(TOKEN)},
    startMessage:{...binding(runId),type:"start",sequence:0,payload:{}}
  },runtimeOrigin);
  mount.replaceChildren(frame);
}
addEventListener("message",event=>{
  console.log("parent-message",event.origin,event.data?.type,event.source===frame?.contentWindow);
  if(event.source!==frame?.contentWindow||event.origin!==runtimeOrigin)return;
  if(event.data?.type==="educanvas.runtime.host_ready"){
    state.textContent="host_ready";
    frame.contentWindow.postMessage({
      type:"educanvas.runtime.activate",
      channelId:binding(currentRun).channelId
    },runtimeOrigin);
  }
  if(event.data?.type==="educanvas.runtime.event")state.textContent=event.data.message.type;
  if(event.data?.type==="educanvas.runtime.bridge_failed")state.textContent="bridge_failed";
});
loop.onclick=()=>start(${JSON.stringify(RUNS.loop)});
memory.onclick=()=>start(${JSON.stringify(RUNS.memory)});
clean.onclick=()=>start(${JSON.stringify(RUNS.clean)});
destroy.onclick=()=>{frame?.remove();frame=null;state.textContent="destroyed"};
</script></body></html>`;
}

test.describe('R28 independent OOPIF pressure gate', () => {
  let runtimeServer: Server;
  let harnessServer: Server;
  let runtimeOrigin = '';
  let harnessOrigin = '';

  test.beforeAll(async () => {
    let currentRuntimeOrigin = '';
    harnessServer = createServer((_request, response) => {
      if (_request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"status":"ok"}');
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(harnessPage(currentRuntimeOrigin));
    });
    const harnessPort = await listen(harnessServer, '127.0.0.1');
    harnessOrigin = `http://harness.test:${harnessPort}`;

    const contents: Record<string, string> = {
      [RUNS.loop]: 'while(true){}',
      [RUNS.memory]:
        'const x=[];const grow=setInterval(()=>{if(x.length>=64){clearInterval(grow);return}const b=new Uint8Array(4*1024*1024);for(let i=0;i<b.length;i+=4096)b[i]=1;x.push(b)},10)',
      [RUNS.clean]: 'educanvasRuntime.succeed()',
    };
    const fakeRepository = {
      async claimBootstrap(input: { runId: string; bootstrapToken: string }) {
        if (input.bootstrapToken !== TOKEN || !(input.runId in contents)) {
          throw new Error('resource_not_found');
        }
        return {
          run: {
            id: input.runId,
            requestId: randomUUID(),
            runtimeId: `40000000-0000-4000-8000-${input.runId.slice(-12)}`,
            notebookId: NOTEBOOK,
            artifactId: '50000000-0000-4000-8000-000000000001',
            artifactVersionId: VERSION,
            artifactContentHash: HASH,
            status: 'running' as const,
            failureCode: null,
            terminalAuthority: 'client_observed' as const,
          },
          content: {
            schemaVersion: 1 as const,
            html: '<p>runtime</p>',
            css: '',
            script: contents[input.runId]!,
            dependencies: [],
          },
        };
      },
    };
    const placeholder: WebRuntimeConfig = {
      host: '127.0.0.1',
      port: 0,
      publicOrigin: 'http://localhost',
      webOrigin: harnessOrigin,
    };
    runtimeServer = createServer(
      createWebRuntimeHandler(placeholder, fakeRepository),
    );
    const runtimePort = await listen(runtimeServer, '127.0.0.1');
    runtimeOrigin = `http://runtime.test:${runtimePort}`;
    placeholder.publicOrigin = runtimeOrigin;
    currentRuntimeOrigin = runtimeOrigin;
  });

  test.afterAll(async () => {
    await Promise.all([close(runtimeServer), close(harnessServer)]);
  });

  for (const load of ['loop', 'memory'] as const) {
    test(`${load}: host responds, parent stays live, old OOPIF dies and replacement starts`, async ({
      browser,
      page,
    }) => {
      test.setTimeout(20_000);
      page.on('console', (message) =>
        process.stdout.write(`[runtime-browser] ${message.text()}\n`),
      );
      page.on('requestfailed', (request) =>
        process.stdout.write(
          `[runtime-request-failed] ${request.url()} ${request.failure()?.errorText ?? ''}\n`,
        ),
      );
      page.on('response', (response) => {
        if (response.url().startsWith(runtimeOrigin)) {
          process.stdout.write(
            `[runtime-response] ${response.status()} ${response.url()}\n`,
          );
        }
      });
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send('Target.setDiscoverTargets', { discover: true });
      await page.goto(harnessOrigin);
      await page.getByRole('button', { name: load }).click();
      await expect(page.locator('#runtime-frame')).toBeVisible();
      await expect
        .poll(
          async () =>
            (await cdp.send('Target.getTargets')).targetInfos.some(
              (target) =>
                target.type === 'iframe' &&
                target.url === `${runtimeOrigin}/host`,
            ),
          {
            message: 'Chromium must expose the cross-site runtime as an OOPIF',
            timeout: 5_000,
          },
        )
        .toBe(true);

      const targetsBefore = (await cdp.send('Target.getTargets')).targetInfos;
      const runtimeTarget = targetsBefore.find(
        (target) =>
          target.type === 'iframe' && target.url === `${runtimeOrigin}/host`,
      );
      expect(
        runtimeTarget,
        'CDP must expose the runtime host as an OOPIF target',
      ).toBeTruthy();
      await expect(page.locator('#state')).toHaveText('ready', {
        timeout: 5_000,
      });
      const firstHeartbeat = Number(
        await page.locator('#heartbeat').textContent(),
      );
      await page.waitForTimeout(1_500);
      await expect
        .poll(async () =>
          Number(await page.locator('#heartbeat').textContent()),
        )
        .toBeGreaterThan(firstHeartbeat);
      await expect(
        page.evaluate(async () => (await fetch('/health')).json()),
      ).resolves.toEqual({ status: 'ok' });

      await page.getByRole('button', { name: 'destroy' }).click();
      await expect(page.locator('#state')).toHaveText('destroyed');
      await expect
        .poll(async () => {
          const targets = (await cdp.send('Target.getTargets')).targetInfos;
          return targets.some(
            (target) => target.targetId === runtimeTarget!.targetId,
          );
        })
        .toBe(false);

      await page.getByRole('button', { name: 'clean' }).click();
      await expect(page.locator('#state')).toHaveText('succeeded', {
        timeout: 5_000,
      });
      const replacement = (
        await cdp.send('Target.getTargets')
      ).targetInfos.find(
        (target) =>
          target.type === 'iframe' &&
          target.url === `${runtimeOrigin}/host` &&
          target.targetId !== runtimeTarget!.targetId,
      );
      expect(
        replacement,
        'replacement must use a fresh OOPIF target',
      ).toBeTruthy();
    });
  }
});
