import { type CDPSession, type Page, type TestInfo } from "@playwright/test";

// Temporary, opt-in timing probe: record no request headers, cookies or bodies.
export async function navigationDiagnostics(page: Page, info: TestInfo) {
  if (!process.env.E2E_NAVIGATION_DIAGNOSTICS || info.project.name !== "chromium") return;
  const events: unknown[] = [];
  const record = (kind: string, data: unknown = {}) => events.push({ at: Date.now(), kind, data });
  const documents = new Set<string>();
  const session: CDPSession = await page.context().newCDPSession(page);
  session.on("Network.requestWillBeSent", (event) => {
    if (event.type !== "Document") return;
    documents.add(event.requestId);
    record("document-request", { requestId: event.requestId, timestamp: event.timestamp });
  });
  session.on("Network.responseReceived", (event) => {
    if (!documents.has(event.requestId)) return;
    record("document-response", { requestId: event.requestId, timestamp: event.timestamp, status: event.response.status });
  });
  session.on("Network.dataReceived", (event) => {
    if (!documents.has(event.requestId)) return;
    record("document-data", { requestId: event.requestId, timestamp: event.timestamp, dataLength: event.dataLength, encodedDataLength: event.encodedDataLength });
  });
  session.on("Network.loadingFinished", (event) => {
    if (!documents.has(event.requestId)) return;
    record("document-finished", event);
  });
  session.on("Network.loadingFailed", (event) => {
    if (!documents.has(event.requestId)) return;
    record("document-failed", { requestId: event.requestId, timestamp: event.timestamp, canceled: event.canceled, errorText: event.errorText });
  });
  session.on("Page.frameNavigated", (event) => {
    if (!event.frame.parentId) record("document-commit", { loaderId: event.frame.loaderId });
  });
  session.on("Page.lifecycleEvent", (event) => record("lifecycle", event));
  session.on("Runtime.consoleAPICalled", (event) => {
    const value = event.args[0]?.value;
    if (typeof value === "string" && value.startsWith("NAVIGATION_DIAGNOSTIC ")) {
      record("heartbeat", JSON.parse(value.slice("NAVIGATION_DIAGNOSTIC ".length)));
    }
  });
  await session.send("Network.enable");
  await session.send("Page.enable");
  await session.send("Page.setLifecycleEventsEnabled", { enabled: true });
  await session.send("Runtime.enable");
  await session.send("Profiler.enable");
  await session.send("Profiler.start");
  await page.addInitScript(() => {
    let frames = 0;
    let longTasks = 0;
    let maxLongTask = 0;
    const frame = () => { frames++; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks++;
        maxLongTask = Math.max(maxLongTask, entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
    const report = (event: string) => console.debug("NAVIGATION_DIAGNOSTIC " + JSON.stringify({
      now: Date.now(), event, frames, longTasks, maxLongTask,
      visibility: document.visibilityState, focus: document.hasFocus(), readyState: document.readyState,
      canvases: document.querySelectorAll("canvas").length,
    }));
    setInterval(() => report("timer"), 1000);
    for (const event of ["pagehide", "visibilitychange", "pageshow"]) {
      addEventListener(event, () => report(event));
    }
  });
  return async () => {
    record("test-end", { status: info.status });
    try {
      const { profile } = await Promise.race([
        session.send("Profiler.stop"),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("profile stop timeout")), 5000)),
      ]);
      await info.attach("navigation-cpu-profile", { body: JSON.stringify(profile), contentType: "application/json" });
    } catch { record("profile-unavailable"); }
    await info.attach("navigation-timing", { body: JSON.stringify(events), contentType: "application/json" });
  };
}
