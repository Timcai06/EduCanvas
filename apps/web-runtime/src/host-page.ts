import type { WebRuntimeConfig } from './config';
import {
  MAX_RUNTIME_MESSAGE_BYTES,
  MAX_RUNTIME_MESSAGES_PER_SECOND,
  MAX_RUNTIME_OUTPUT_BYTES,
} from './message-budget';
import { createHash } from 'node:crypto';
import {
  type DomExplorationContent,
  type WebAppContent,
  webAppContentSchema,
  WEB_APP_MEDIA_TYPES,
} from '@educanvas/canvas-protocol/server';

type WebRuntimeArtifactContent = DomExplorationContent | WebAppContent;

const FORBIDDEN_REMOTE_URL =
  /(href|src)\s*=\s*["']\s*(?:https?:\/\/|\/\/)|url\(\s*["']?\s*(?:https?:\/\/|\/\/)/i;

function isManifestPathSafe(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 200 &&
    /^[A-Za-z0-9._/-]+$/.test(path) &&
    !path.includes('..') &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes('://')
  );
}

function assertLocalAndSafePayload(
  content: string,
  label: 'html' | 'css' | 'js',
): void {
  const forbiddenScriptNetwork =
    label === 'js' &&
    (/\b(?:fetch|WebSocket|EventSource|XMLHttpRequest|importScripts)\s*\(/.test(
      content,
    ) ||
      /navigator\.sendBeacon\s*\(/.test(content));
  const forbiddenCssImport =
    label === 'css' &&
    /@import\s+(?:url\()?\s*["']?\s*(?:https?:\/\/|\/\/)/i.test(content);
  if (
    FORBIDDEN_REMOTE_URL.test(content) ||
    forbiddenScriptNetwork ||
    forbiddenCssImport
  ) {
    throw new Error(`runtime_rejected_${label}`);
  }
}

function validateWebAppContent(content: WebAppContent): {
  html: string;
  css: string;
  script: string;
} {
  /* v1 没有依赖字节装载器。即使 manifest 写了锁定版本，Host 也不能从网络
     安装或猜测依赖；必须与 admission 层一样 fail closed。 */
  if (content.lockedDependencies.length > 0) {
    throw new Error('runtime_rejected_dependencies');
  }
  if (!isManifestPathSafe(content.manifest.entry)) {
    throw new Error('runtime_rejected_invalid_manifest');
  }
  const fileByPath = new Map<string, (typeof content.manifest.files)[number]>();
  for (const file of content.manifest.files) {
    if (!isManifestPathSafe(file.path) || fileByPath.has(file.path)) {
      throw new Error('runtime_rejected_invalid_manifest');
    }
    if (!WEB_APP_MEDIA_TYPES.includes(file.mediaType)) {
      throw new Error('runtime_rejected_unknown_media_type');
    }
    const actualHash = createHash('sha256')
      .update(file.content, 'utf8')
      .digest('hex');
    if (actualHash !== file.hash) {
      throw new Error('runtime_rejected_hash_mismatch');
    }
    fileByPath.set(file.path, file);
  }
  const entry = fileByPath.get(content.manifest.entry);
  if (!entry || entry.mediaType !== 'text/html') {
    throw new Error('runtime_rejected_invalid_entry');
  }
  const styles = [];
  const scripts = [];
  for (const file of fileByPath.values()) {
    if (file.path === content.manifest.entry) continue;
    if (file.mediaType === 'text/css') styles.push(file.content);
    if (file.mediaType === 'text/javascript') scripts.push(file.content);
    if (
      !['text/html', 'text/css', 'text/javascript'].includes(file.mediaType)
    ) {
      throw new Error('runtime_rejected_unknown_media_type');
    }
  }
  assertLocalAndSafePayload(entry.content, 'html');
  assertLocalAndSafePayload(styles.join('\n'), 'css');
  assertLocalAndSafePayload(scripts.join('\n'), 'js');
  return {
    html: entry.content,
    css: styles.join('\n'),
    script: scripts.join('\n'),
  };
}

/**
 * Compile artifact content into the legacy `html/css/script` runtime payload.
 *
 * `dom_exploration` stays byte-compatible; `web_app.v1` uses manifest entry and
 * hash-verified file lookup before assembling the same runtime contract.
 */
export function compileRuntimePayload(content: WebRuntimeArtifactContent): {
  html: string;
  css: string;
  script: string;
} {
  if ('manifest' in content) {
    const parsed = webAppContentSchema.parse(content);
    return validateWebAppContent(parsed);
  }
  return {
    html: content.html,
    css: content.css,
    script: content.script,
  };
}

/**
 * In-browser host script for web-runtime:
 * - receives bootstrap messages from web app (postMessage)
 * - claims one-time bootstrap content from `/api/bootstrap`
 * - creates an iframe `sandbox` with `credentialless` and srcdoc payload
 * - forwards runtime bridge events back to web app with sequence + binding checks
 * - enforces lightweight budget checks and terminal state transitions
 */
const hostScript = String.raw`
(() => {
  "use strict";
  const webOrigin = document.documentElement.dataset.webOrigin;
  const mount = document.getElementById("runtime-mount");
  let sandbox = null;
  let binding = null;
  let nextSequence = 0;
  let terminal = false;
  let pendingStart = null;
  let activated = false;
  let sandboxLoaded = false;
  let rateWindowStarted = performance.now();
  let rateWindowMessages = 0;
  let outputBytes = 0;

  const exactKeys = (value, keys) =>
    value && typeof value === "object" &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
  const sameBinding = (message) =>
    message.protocolVersion === binding.protocolVersion &&
    message.channelId === binding.channelId &&
    message.runtimeId === binding.runtimeId &&
    message.notebookId === binding.notebookId &&
    message.artifactVersionId === binding.artifactVersionId &&
    message.artifactContentHash === binding.artifactContentHash;
  const relay = (message) => parent.postMessage({
    type: "educanvas.runtime.event",
    message
  }, webOrigin);
  const fail = (failureCode = "runtime_crashed") => {
    terminal = true;
    if (sandbox) sandbox.remove();
    sandbox = null;
    parent.postMessage({
      type: "educanvas.runtime.bridge_failed",
      failureCode
    }, webOrigin);
  };

  function sandboxDocument(content, startMessage) {
    const contentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(content))));
    const startBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(startMessage))));
    const csp = ${JSON.stringify(
      "default-src 'none'; connect-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'; manifest-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:",
    )};
    return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
      csp.replaceAll('"', '&quot;') + '"><meta name="referrer" content="no-referrer"></head>' +
      '<body><div id="artifact-root"></div><script>(()=>{"use strict";const content=JSON.parse(decodeURIComponent(escape(atob("' +
      contentBase64 + '"))));const start=JSON.parse(decodeURIComponent(escape(atob("' + startBase64 +
      '"))));let sequence=1;let done=false;const send=(type,payload={})=>{if(done)return;parent.postMessage({...start,type,sequence:sequence++,payload},"*");if(["succeeded","failed","cancelled"].includes(type))done=true};' +
      'window.educanvasRuntime=Object.freeze({output:(value,kind="text")=>send("output",{kind,value:String(value).slice(0,16384)}),succeed:()=>send("succeeded"),fail:(failureCode="execution_failed")=>send("failed",{failureCode})});' +
      'addEventListener("message",event=>{if(event.source!==parent||!event.data||event.data.channelId!==start.channelId)return;if(event.data.type==="cancel"){send("cancelled");return;}if(event.data.type!=="start"||event.data.sequence!==0)return;' +
      'document.getElementById("artifact-root").innerHTML=content.html;const style=document.createElement("style");style.textContent=content.css;document.head.append(style);send("ready");const blob=new Blob([content.script],{type:"text/javascript"});const script=document.createElement("script");script.src=URL.createObjectURL(blob);script.onerror=()=>send("failed",{failureCode:"execution_failed"});document.body.append(script);},{once:false});})();<\/script></body></html>';
  }

  async function bootstrap(data) {
    if (binding || !exactKeys(data, ["type","runId","bootstrapToken","startMessage"])) return fail();
    const response = await fetch("/api/bootstrap", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: data.runId, bootstrapToken: data.bootstrapToken })
    });
    if (!response.ok) return fail();
    const result = await response.json();
    const start = data.startMessage;
    binding = { ...result.binding, channelId: start.channelId };
    if (!sameBinding(start) || start.type !== "start" || start.sequence !== 0) return fail();
    nextSequence = 1;
    sandbox = document.createElement("iframe");
    sandbox.title = "EduCanvas isolated DOM runtime";
    sandbox.setAttribute("sandbox", "allow-scripts");
    sandbox.referrerPolicy = "no-referrer";
    sandbox.setAttribute("credentialless", "");
    sandbox.srcdoc = sandboxDocument(result.content, start);
    pendingStart = start;
    sandbox.addEventListener("load", () => {
      sandboxLoaded = true;
      if (activated) sandbox.contentWindow.postMessage(pendingStart, "*");
    }, { once: true });
    mount.replaceChildren(sandbox);
    parent.postMessage({
      type: "educanvas.runtime.host_ready",
      runtimeId: binding.runtimeId
    }, webOrigin);
  }

  addEventListener("message", event => {
    if (event.source === parent) {
      if (event.origin !== webOrigin || !event.data) return;
      if (event.data.type === "educanvas.runtime.bootstrap") void bootstrap(event.data).catch(fail);
      if (
        event.data.type === "educanvas.runtime.activate" &&
        sandbox &&
        pendingStart &&
        !activated &&
        event.data.channelId === binding.channelId
      ) {
        activated = true;
        if (sandboxLoaded) sandbox.contentWindow.postMessage(pendingStart, "*");
      }
      if (event.data.type === "educanvas.runtime.cancel" && sandbox && binding) {
        sandbox.contentWindow.postMessage(event.data.message, "*");
      }
      if (event.data.type === "educanvas.runtime.destroy") {
        terminal = true;
        if (sandbox) sandbox.remove();
        sandbox = null;
      }
      return;
    }
    if (!sandbox || event.source !== sandbox.contentWindow || terminal || !event.data) return;
    const message = event.data;
    let messageBytes;
    try {
      messageBytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
    } catch {
      return fail();
    }
    if (messageBytes > ${MAX_RUNTIME_MESSAGE_BYTES}) return fail("resource_quota_exceeded");
    const now = performance.now();
    if (now - rateWindowStarted >= 1000) {
      rateWindowStarted = now;
      rateWindowMessages = 0;
    }
    rateWindowMessages += 1;
    if (rateWindowMessages > ${MAX_RUNTIME_MESSAGES_PER_SECOND}) return fail("resource_quota_exceeded");
    if (!sameBinding(message) || message.sequence !== nextSequence) return fail();
    if (!["ready","output","succeeded","failed","cancelled"].includes(message.type)) return fail();
    if (message.type === "output") {
      outputBytes += new TextEncoder().encode(String(message.payload && message.payload.value || "")).byteLength;
      if (outputBytes > ${MAX_RUNTIME_OUTPUT_BYTES}) return fail("resource_quota_exceeded");
    }
    nextSequence += 1;
    if (["succeeded","failed","cancelled"].includes(message.type)) terminal = true;
    relay(message);
  });
})();`;

export function renderHostPage(config: WebRuntimeConfig): string {
  /**
   * Host page is intentionally minimal: only mount container + bridge loader.
   * `data-web-origin` is the parent allowlist for message targetOrigin checks.
   */
  return `<!doctype html>
<html lang="zh-CN" data-web-origin="${config.webOrigin}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="referrer" content="no-referrer"><title>EduCanvas Runtime</title></head>
<body><main id="runtime-mount" aria-live="polite"></main><script src="/host.js"></script></body>
</html>`;
}

/**
 * Return compiled host bootstrap script string.
 *
 * The returned script is served as-is from `/host.js` and must match CSP
 * assumptions in `/host` response. Changes here should keep the runtime contract:
 * bootstrap -> activate -> message relay -> terminal states.
 */
export function renderHostScript(): string {
  return hostScript;
}
