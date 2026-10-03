// Temporary timing-only probe for the actual Next document stream.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(process.env.E2E_NAVIGATION_SERVER_LOG);
fs.mkdirSync(path.dirname(file), { recursive: true });
const emit = http.Server.prototype.emit;
let requestId = 0;
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [request, response] = args;
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (
      request.method === 'GET' &&
      !request.headers.rsc &&
      (pathname === '/' || pathname.startsWith('/notebook/'))
    ) {
      const id = ++requestId;
      const log = (kind, bytes = 0) =>
        fs.appendFileSync(
          file,
          JSON.stringify({ at: Date.now(), id, kind, bytes }) + '\n',
        );
      log('request');
      let first = true;
      for (const method of ['write', 'end']) {
        const original = response[method];
        response[method] = function (...values) {
          const value = values[0];
          const bytes =
            typeof value === 'string'
              ? Buffer.byteLength(value)
              : value?.byteLength || 0;
          if (first && bytes > 0) {
            first = false;
            log('first-body', bytes);
          }
          if (method === 'end') log('end', bytes);
          return original.apply(this, values);
        };
      }
      response.once('finish', () => log('finish'));
      response.once('close', () => log('close'));
    }
  }
  return emit.call(this, event, ...args);
};
