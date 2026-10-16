#!/usr/bin/env node
/**
 * BugRadar Ingestion Test Script
 * Sends test error events to the BugRadar server and ASSERTS the responses.
 *
 * Usage: node test-ingestion.js [DSN_KEY] [BASE_URL]
 *    or: DSN_KEY=abc BASE_URL=https://host npm run test:ingestion
 * Example: node test-ingestion.js abc123 http://localhost:3000
 *
 * Exits 0 only when every event is accepted (2xx); any 4xx/5xx (e.g. a wrong
 * or missing DSN key) fails the run (QA-BUG-REPORT.md D5).
 */

const http = require('http');
const https = require('https');

const dsnKey = process.argv[2] || process.env.DSN_KEY || 'test-dsn-key';
const baseUrl = (process.argv[3] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const url = `${baseUrl}/ingest/${dsnKey}/store/`;

const testEvents = [
  {
    message: 'TypeError: Cannot read property map of undefined',
    level: 'error',
    environment: 'production',
    release: 'v1.0.0',
    exception: {
      type: 'TypeError',
      value: 'Cannot read property map of undefined',
      stacktrace: {
        frames: [
          { filename: 'src/components/UserList.tsx', lineno: 42, function: 'renderUsers', colno: 5 },
          { filename: 'node_modules/react-dom/index.js', lineno: 123, function: 'processChild' },
          { filename: 'node_modules/react/index.js', lineno: 45, function: 'render' },
        ]
      }
    },
    breadcrumbs: [
      { category: 'navigation', message: 'Page loaded /dashboard', timestamp: new Date().toISOString() },
      { category: 'ui.click', message: 'button#refresh clicked', timestamp: new Date().toISOString() },
    ],
    tags: { browser: 'Chrome 120', os: 'Windows 10' },
    user: { id: 'user-123', name: 'Test User' },
  },
  {
    message: 'NetworkError: Failed to fetch /api/users',
    level: 'error',
    environment: 'production',
    release: 'v1.0.0',
    exception: {
      type: 'NetworkError',
      value: 'Failed to fetch /api/users',
      stacktrace: {
        frames: [
          { filename: 'src/services/api.ts', lineno: 15, function: 'fetchUsers', colno: 10 },
          { filename: 'src/hooks/useUsers.ts', lineno: 8, function: 'useUsers', colno: 3 },
        ]
      }
    },
    breadcrumbs: [
      { category: 'http', message: 'GET /api/projects 200', timestamp: new Date().toISOString() },
    ],
    tags: { browser: 'Firefox 121', os: 'macOS' },
  },
  {
    message: 'RangeError: Maximum call stack size exceeded',
    level: 'fatal',
    environment: 'staging',
    release: 'v1.1.0-beta',
    exception: {
      type: 'RangeError',
      value: 'Maximum call stack size exceeded',
      stacktrace: {
        frames: [
          { filename: 'src/utils/recursion.ts', lineno: 8, function: 'deepClone', colno: 12 },
          { filename: 'src/utils/recursion.ts', lineno: 12, function: 'deepClone', colno: 12 },
          { filename: 'src/utils/recursion.ts', lineno: 12, function: 'deepClone', colno: 12 },
        ]
      }
    },
    breadcrumbs: [],
    tags: { browser: 'Safari 17', os: 'iOS 17' },
  },
];

let sent = 0;
let failures = 0;
const total = testEvents.length;

function sendEvent(event, index) {
  const data = JSON.stringify(event);
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  const req = lib.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      sent++;
      const status = res.statusCode || 0;
      const ok = status >= 200 && status < 300;
      if (!ok) failures++;
      console.log(`[${sent}/${total}] Status: ${status} ${ok ? 'OK' : 'FAIL'} — ${event.message.slice(0, 50)}...`);
      if (!ok) {
        console.log(`         ${body.slice(0, 200)}`);
      }
      if (sent === total) {
        if (failures > 0) {
          console.error(`\n✗ ${failures}/${total} events rejected by ${url} — check the DSN key and that the server is running`);
          process.exit(1);
        }
        console.log(`\n✓ All ${total} events accepted (2xx) by ${url}`);
        process.exit(0);
      }
    });
  });

  req.on('error', (err) => {
    sent++;
    failures++;
    console.error(`[${sent}/${total}] Error: ${err.message}`);
    if (sent === total) process.exit(1);
  });

  req.write(data);
  req.end();
}

console.log(`Sending ${total} test events to ${url}...\n`);
testEvents.forEach((event, i) => {
  setTimeout(() => sendEvent(event, i), i * 200);
});
