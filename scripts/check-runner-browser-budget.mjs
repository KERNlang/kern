#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertRunnerBrowserBudgetLifecycle,
  loadRunnerBrowserBudgetPolicy,
} from './runner-browser-budget-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'packages/core/dist');
const ENTRY = resolve(DIST, 'runner-browser.js');
const BUDGET_POLICY_PATH = resolve(ROOT, 'scripts/runner-browser-budget-policy.json');
const BUDGET_POLICY = loadRunnerBrowserBudgetPolicy(BUDGET_POLICY_PATH);
const BROWSER_SMOKE_HTML = resolve(ROOT, 'examples/browser-runner-smoke/index.html');
const BROWSER_SMOKE_MODULE = resolve(ROOT, 'examples/browser-runner-smoke/runner-smoke.mjs');
const BROWSER_SMOKE_RUNNER_IMPORT = '../../packages/core/dist/runner-browser.js';
const BROWSER_SMOKE_DECIMAL_IMPORT = '../../packages/core/node_modules/decimal.js/decimal.mjs';

const ALLOWED_BARE_SPECIFIERS = ['decimal.js'];
const FORBIDDEN_BARE_SPECIFIERS = new Set([
  'typescript',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:child_process',
  'node:net',
  'node:os',
  'node:url',
  'node:stream',
  'node:http',
  'node:https',
  'fs',
  'path',
  'crypto',
  'child_process',
  'net',
  'os',
  'url',
  'stream',
  'http',
  'https',
]);

// M3.20 intentionally makes the canonical and legacy compatibility engines
// both reachable through static ESM. The checked-in policy records the measured
// transition closure and a fixed 5% accidental-bloat margin. When the legacy
// module exits this graph, the lifecycle check below forces the ceilings back
// to their pre-transition values instead of letting temporary headroom persist.
const MAX_INTERNAL_RAW_BYTES = BUDGET_POLICY.limits.maxInternalRawBytes;
const MAX_INTERNAL_GZIP_BYTES = BUDGET_POLICY.limits.maxInternalGzipBytes;
const MAX_COLD_IMPORT_EXECUTE_MS = BUDGET_POLICY.limits.maxColdImportExecuteMs;
const MAX_BROWSER_IMPORT_EXECUTE_MS = BUDGET_POLICY.limits.maxBrowserImportExecuteMs;
const COLD_START_RUNS = BUDGET_POLICY.limits.coldStartRuns;
const BROWSER_START_RUNS = BUDGET_POLICY.limits.browserStartRuns;
const BROWSER_BUDGET_MODE = browserBudgetModeFromArgs() ?? process.env.KERN_BROWSER_BUDGET ?? 'auto';
const CDP_TIMEOUT_MS = BUDGET_POLICY.limits.cdpTimeoutMs;
const ACTIVE_CHROME_SESSIONS = new Set();
let shuttingDown = false;

process.once('exit', cleanupActiveChromeSessions);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanupActiveChromeSessions();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

if (!existsSync(ENTRY)) {
  console.error(`missing built runner at ${ENTRY}; run pnpm --filter @kernlang/core build first`);
  process.exit(2);
}
checkBrowserSmokeFixture();

const graph = walkGraph(ENTRY);
try {
  assertRunnerBrowserBudgetLifecycle(BUDGET_POLICY, graph.visited, DIST);
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)} in scripts/runner-browser-budget-policy.json`);
  process.exit(1);
}
const bare = [...graph.bare].sort();
const forbiddenBare = bare.filter((specifier) => FORBIDDEN_BARE_SPECIFIERS.has(specifier));
if (JSON.stringify(bare) !== JSON.stringify(ALLOWED_BARE_SPECIFIERS)) {
  console.error(`runner browser graph bare specifiers drifted: ${JSON.stringify(bare)}`);
  console.error(`expected exactly: ${JSON.stringify(ALLOWED_BARE_SPECIFIERS)}`);
  process.exit(1);
}
if (forbiddenBare.length > 0) {
  console.error(`runner browser graph reached forbidden host/runtime specifiers: ${forbiddenBare.join(', ')}`);
  process.exit(1);
}

const internalSource = [...graph.visited].sort().map((file) => readFileSync(file, 'utf8')).join('\n');
const rawBytes = Buffer.byteLength(internalSource);
const gzipBytes = gzipSync(internalSource).length;
if (rawBytes > MAX_INTERNAL_RAW_BYTES || gzipBytes > MAX_INTERNAL_GZIP_BYTES) {
  console.error('runner browser budget exceeded');
  console.error(
    JSON.stringify(
      {
        rawBytes,
        maxRawBytes: MAX_INTERNAL_RAW_BYTES,
        gzipBytes,
        maxGzipBytes: MAX_INTERNAL_GZIP_BYTES,
        modules: graph.visited.size,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const coldStartMs = measureColdImportExecute();
await checkBrowserSmokeFixtureExecution();
const browserBudget = await measureBrowserDeviceBudget();
if (coldStartMs > MAX_COLD_IMPORT_EXECUTE_MS) {
  console.error(
    `runner cold import+execute exceeded budget: ${coldStartMs}ms > ${MAX_COLD_IMPORT_EXECUTE_MS}ms`,
  );
  process.exit(1);
}
if (browserBudget.status === 'measured' && browserBudget.medianMs > MAX_BROWSER_IMPORT_EXECUTE_MS) {
  console.error(
    `runner browser import+execute exceeded budget: ${browserBudget.medianMs}ms > ${MAX_BROWSER_IMPORT_EXECUTE_MS}ms`,
  );
  console.error(JSON.stringify(browserBudget, null, 2));
  process.exit(1);
}

console.log(
  `runner browser budget passed: ${graph.visited.size} modules, ${rawBytes} raw bytes, ${gzipBytes} gzip bytes, cold import+execute ${coldStartMs}ms, ${browserBudgetSummary(browserBudget)}, browser fixture ok`,
);

function checkBrowserSmokeFixture() {
  if (!existsSync(BROWSER_SMOKE_HTML) || !existsSync(BROWSER_SMOKE_MODULE)) {
    console.error('missing browser runner smoke fixture under examples/browser-runner-smoke');
    process.exit(1);
  }
  const html = readFileSync(BROWSER_SMOKE_HTML, 'utf8');
  const moduleSource = readFileSync(BROWSER_SMOKE_MODULE, 'utf8');
  if (!/<script\s+type="module">[\s\S]*from\s+['"]\.\/runner-smoke\.mjs['"][\s\S]*renderBrowserRunnerSmoke\(\)/u.test(html)) {
    console.error('browser runner smoke HTML must import and render ./runner-smoke.mjs as a module');
    process.exit(1);
  }
  if (!new RegExp(`["']decimal\\.js["']\\s*:\\s*["']${escapeRegExp(BROWSER_SMOKE_DECIMAL_IMPORT)}["']`, 'u').test(html)) {
    console.error(`browser runner smoke HTML must map decimal.js to ${BROWSER_SMOKE_DECIMAL_IMPORT}`);
    process.exit(1);
  }
  const decimalImportTarget = resolve(dirname(BROWSER_SMOKE_HTML), BROWSER_SMOKE_DECIMAL_IMPORT);
  if (!existsSync(decimalImportTarget)) {
    console.error(`browser runner smoke import map target is missing: ${decimalImportTarget}`);
    process.exit(1);
  }
  if (!new RegExp(`from\\s+["']${escapeRegExp(BROWSER_SMOKE_RUNNER_IMPORT)}["']`, 'u').test(moduleSource)) {
    console.error(`browser runner smoke module must import ${BROWSER_SMOKE_RUNNER_IMPORT}`);
    process.exit(1);
  }
}

async function checkBrowserSmokeFixtureExecution() {
  try {
    let ticks = 0;
    const fixture = await import(pathToFileURL(BROWSER_SMOKE_MODULE).href);
    if (typeof fixture.runBrowserRunnerSmoke !== 'function') {
      console.error('browser runner smoke module must export runBrowserRunnerSmoke()');
      process.exit(1);
    }
    const result = await fixture.runBrowserRunnerSmoke({
      startedAt: 0,
      now: () => {
        ticks += 1;
        return ticks;
      },
    });
    if (!result?.ok) {
      console.error('browser runner smoke fixture failed');
      if (typeof result?.error === 'string') console.error(`fixture error: ${result.error}`);
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
    if (result.error !== undefined) {
      console.error(`browser runner smoke fixture returned ok=true with error: ${JSON.stringify(result.error)}`);
      process.exit(1);
    }
    if (!Number.isFinite(result.browserElapsedMs)) {
      console.error(`browser runner smoke fixture returned invalid timing: ${JSON.stringify(result)}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`browser runner smoke fixture threw: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

async function measureBrowserDeviceBudget() {
  const mode = normalizeBrowserBudgetMode(BROWSER_BUDGET_MODE);
  if (mode === 'off') return { status: 'skipped', reason: 'disabled by KERN_BROWSER_BUDGET=off' };
  if (typeof WebSocket !== 'function') {
    return handleUnavailableBrowserBudget(mode, 'Node runtime does not provide global WebSocket');
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    return handleUnavailableBrowserBudget(
      mode,
      'Chrome/Chromium not found; set KERN_CHROME_PATH, CHROME_PATH, or CHROME_BIN',
    );
  }

  let server;
  try {
    server = await startStaticServer(ROOT);
  } catch (error) {
    return handleUnavailableBrowserBudget(
      mode,
      `browser smoke static server unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const samples = [];
  const metrics = [];
  try {
    for (let index = 0; index < BROWSER_START_RUNS; index += 1) {
      const url = `${server.origin}/examples/browser-runner-smoke/index.html?run=${index}`;
      const sample = await runBrowserSmokeInChrome(chromePath, url);
      samples.push(sample.browserElapsedMs);
      metrics.push(sample.metrics);
    }
  } catch (error) {
    console.error(`runner measured browser budget failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    await closeStaticServer(server.server);
  }
  samples.sort((a, b) => a - b);
  return {
    status: 'measured',
    chromePath,
    medianMs: samples[Math.floor(samples.length / 2)],
    maxMs: Math.max(...samples),
    samples,
    metrics,
  };
}

function normalizeBrowserBudgetMode(value) {
  if (value === 'auto' || value === 'required' || value === 'off') return value;
  console.error(`browser budget mode must be one of auto, required, or off; got ${JSON.stringify(value)}`);
  process.exit(1);
}

function browserBudgetModeFromArgs() {
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith('--browser-budget=')) return arg.slice('--browser-budget='.length);
    if (arg === '--browser-budget') {
      const value = process.argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error('--browser-budget requires a mode: auto, required, or off');
        process.exit(1);
      }
      return value;
    }
  }
  return undefined;
}

function handleUnavailableBrowserBudget(mode, reason) {
  if (mode === 'required') {
    console.error(`runner measured browser budget is required but unavailable: ${reason}`);
    process.exit(1);
  }
  return { status: 'skipped', reason };
}

function findChromeExecutable() {
  const envCandidates = [process.env.KERN_CHROME_PATH, process.env.CHROME_PATH, process.env.CHROME_BIN].filter(Boolean);
  const platformCandidates =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          ]
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of [...envCandidates, ...platformCandidates]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  const pathProbe = process.platform === 'win32' ? 'where' : 'which';
  for (const binary of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']) {
    const result = spawnSync(pathProbe, [binary], { encoding: 'utf8' });
    const resolved = result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : '';
    if (resolved && existsSync(resolved)) return resolved;
  }
  return undefined;
}

function startStaticServer(root) {
  // Local-only static server for the browser smoke fixture. It binds to
  // 127.0.0.1 and realpath-checks served files against the repo root.
  const realRoot = realpathSync(root);
  return new Promise((resolveServer, reject) => {
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(url.pathname);
        if (pathname === '/favicon.ico') {
          response.writeHead(204);
          response.end();
          return;
        }
        if (pathname.includes('\\') || pathname.includes('\0')) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('bad path');
          return;
        }
        const filePath = resolve(root, `.${pathname}`);
        if (!isPathInside(root, filePath)) {
          response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('forbidden');
          return;
        }
        const target = existsSync(filePath) && statSync(filePath).isDirectory() ? join(filePath, 'index.html') : filePath;
        if (!existsSync(target) || !statSync(target).isFile()) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('not found');
          return;
        }
        const realTarget = realpathSync(target);
        if (!isPathInside(realRoot, realTarget)) {
          response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('forbidden');
          return;
        }
        response.writeHead(200, { 'content-type': contentTypeFor(target) });
        response.end(readFileSync(target));
      } catch (error) {
        console.error(`browser smoke static server failed: ${error instanceof Error ? error.message : String(error)}`);
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('internal server error');
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('browser smoke static server did not bind to a TCP port'));
        return;
      }
      resolveServer({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function isPathInside(root, target) {
  const path = relative(root, target);
  return path === '' || (path !== '' && !path.startsWith('..') && !isAbsolute(path));
}

function closeStaticServer(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function contentTypeFor(file) {
  switch (extname(file)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

async function runBrowserSmokeInChrome(chromePath, url) {
  const chrome = await launchChrome(chromePath);
  let cdp;
  try {
    const target = await waitForPageTarget(chrome.port);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await optionalCdpSend(cdp, 'Log.enable');
    await optionalCdpSend(cdp, 'Performance.enable');
    await cdp.send('Page.navigate', { url });
    await waitForCdpEvent(cdp, 'Page.loadEventFired');
    const result = await waitForBrowserSmokeResult(cdp);
    const metrics = await readPerformanceMetrics(cdp);
    if (!result?.ok) {
      throw new Error(`browser smoke fixture failed: ${JSON.stringify(result)}`);
    }
    if (result.error !== undefined) {
      throw new Error(`browser smoke fixture returned ok=true with error: ${JSON.stringify(result.error)}`);
    }
    if (!Number.isFinite(result.browserElapsedMs)) {
      throw new Error(`browser smoke fixture returned invalid timing: ${JSON.stringify(result)}`);
    }
    const errors = cdp.events
      .filter(
        (event) =>
          event.method === 'Runtime.exceptionThrown' ||
          (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error'),
      )
      .map((event) => JSON.stringify(event.params));
    if (errors.length > 0) {
      throw new Error(`browser page emitted errors: ${errors.join('; ')}`);
    }
    return { browserElapsedMs: Math.ceil(result.browserElapsedMs), metrics };
  } finally {
    cdp?.close();
    await stopChrome(chrome);
  }
}

async function launchChrome(chromePath) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'kern-runner-browser-'));
  const args = [
    '--headless=new',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-sync',
    '--disable-dev-shm-usage',
    '--no-default-browser-check',
    '--no-first-run',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  const needsNoSandbox =
    process.platform === 'linux' &&
    (typeof process.getuid !== 'function' || process.getuid() === 0 || process.env.KERN_CHROME_NO_SANDBOX === '1');
  if (needsNoSandbox) {
    args.splice(1, 0, '--no-sandbox');
  }
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const chrome = { child, userDataDir, port: undefined };
  ACTIVE_CHROME_SESSIONS.add(chrome);
  let stderr = '';
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  child.stderr?.on('data', (chunk) => {
    if (stderr.length < 16_384) stderr += String(chunk);
  });
  try {
    const portFile = join(userDataDir, 'DevToolsActivePort');
    chrome.port = await waitForDevToolsPort(child, portFile, () => stderr, () => spawnError);
    return chrome;
  } catch (error) {
    cleanupChromeSessionSync(chrome);
    throw error;
  }
}

async function waitForDevToolsPort(child, portFile, stderr, spawnError) {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const error = spawnError();
    if (error instanceof Error) {
      throw new Error(`Chrome failed to launch: ${error.message}`);
    }
    if (existsSync(portFile)) {
      const [portText] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      const port = Number.parseInt(portText, 10);
      if (Number.isFinite(port)) return port;
    }
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools was ready: ${stderr()}`);
    }
    await delay(50);
  }
  throw new Error(`timed out waiting for Chrome DevTools port: ${stderr()}`);
}

async function waitForPageTarget(port) {
  const endpoint = `http://127.0.0.1:${port}/json/list`;
  const started = Date.now();
  let lastFetchError;
  while (Date.now() - started < 10_000) {
    let targets;
    try {
      targets = await fetchJson(endpoint);
      lastFetchError = undefined;
    } catch (error) {
      lastFetchError = error;
    }
    const page = Array.isArray(targets)
      ? targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      : undefined;
    if (page) return page;
    await delay(50);
  }
  const detail = lastFetchError instanceof Error ? `: ${lastFetchError.message}` : '';
  throw new Error(`timed out waiting for Chrome page target${detail}`);
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return response.json();
}

function connectCdp(webSocketDebuggerUrl) {
  const parsedUrl = new URL(webSocketDebuggerUrl);
  if (parsedUrl.hostname !== '127.0.0.1' && parsedUrl.hostname !== 'localhost') {
    throw new Error(`refusing non-local Chrome DevTools WebSocket: ${webSocketDebuggerUrl}`);
  }
  return new Promise((resolveConnection, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    const events = [];
    let nextId = 1;
    let opened = false;
    const connectTimer = setTimeout(() => {
      fail(new Error('timed out connecting to Chrome DevTools WebSocket'));
      ws.close();
    }, CDP_TIMEOUT_MS);
    const fail = (error) => {
      clearTimeout(connectTimer);
      for (const { reject: rejectPending } of pending.values()) rejectPending(error);
      pending.clear();
      reject(error);
    };
    ws.addEventListener('open', () => {
      opened = true;
      clearTimeout(connectTimer);
      resolveConnection({
        events,
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          const payload = JSON.stringify({ id, method, params });
          return new Promise((resolveSend, rejectSend) => {
            if (ws.readyState !== 1) {
              rejectSend(new Error(`Chrome DevTools WebSocket is not open for ${method}`));
              return;
            }
            const timer = setTimeout(() => {
              pending.delete(id);
              rejectSend(new Error(`Chrome DevTools command timed out: ${method}`));
            }, CDP_TIMEOUT_MS);
            pending.set(id, {
              resolve(result) {
                clearTimeout(timer);
                resolveSend(result);
              },
              reject(error) {
                clearTimeout(timer);
                rejectSend(error);
              },
            });
            ws.send(payload);
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener('error', () => fail(new Error('Chrome DevTools WebSocket error')));
    ws.addEventListener('close', () => {
      clearTimeout(connectTimer);
      const error = new Error('Chrome DevTools WebSocket closed');
      for (const { reject: rejectPending } of pending.values()) rejectPending(error);
      pending.clear();
      if (!opened) reject(error);
    });
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
      } catch (error) {
        fail(new Error(`malformed Chrome DevTools message: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      if (message.id !== undefined) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(`${message.error.message}: ${message.error.data ?? ''}`.trim()));
        else request.resolve(message.result);
        return;
      }
      events.push(message);
    });
  });
}

async function waitForBrowserSmokeResult(cdp) {
  const expression = `(() => {
    const element = document.getElementById('kern-runner-smoke');
    if (!element) return { status: 'missing', text: '' };
    const status = element.dataset.status || 'pending';
    const text = element.textContent || '';
    if (status !== 'pass' && status !== 'fail') return { status, text };
    try {
      return { status, result: JSON.parse(text) };
    } catch (error) {
      return { status, parseError: error instanceof Error ? error.message : String(error), text };
    }
  })()`;
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const evaluated = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    if (evaluated.exceptionDetails) {
      throw new Error(`browser smoke evaluation failed: ${JSON.stringify(evaluated.exceptionDetails)}`);
    }
    const value = evaluated.result?.value;
    if (value?.status === 'pass' || value?.status === 'fail') {
      if (value.parseError) throw new Error(`browser smoke JSON parse failed: ${value.parseError}`);
      return value.result;
    }
    await delay(50);
  }
  throw new Error('timed out waiting for browser smoke fixture result');
}

async function waitForCdpEvent(cdp, method) {
  const started = Date.now();
  while (Date.now() - started < CDP_TIMEOUT_MS) {
    if (cdp.events.some((event) => event.method === method)) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for Chrome DevTools event: ${method}`);
}

async function optionalCdpSend(cdp, method) {
  try {
    await cdp.send(method);
  } catch (error) {
    console.warn(`optional Chrome DevTools command ${method} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readPerformanceMetrics(cdp) {
  let result;
  try {
    result = await cdp.send('Performance.getMetrics');
  } catch (error) {
    return { unavailable: error instanceof Error ? error.message : String(error) };
  }
  if (!result?.metrics) return {};
  return Object.fromEntries(
    result.metrics
      .filter((metric) => ['JSHeapUsedSize', 'ScriptDuration', 'TaskDuration'].includes(metric.name))
      .map((metric) => [metric.name, metric.value]),
  );
}

async function stopChrome(chrome) {
  if (chrome.child.exitCode !== null) {
    cleanupChromeProfile(chrome);
    return;
  }
  safeKillChrome(chrome.child, 'SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => chrome.child.once('exit', () => resolveExit())),
    delay(2_000).then(() => {
      if (chrome.child.exitCode === null) safeKillChrome(chrome.child, 'SIGKILL');
    }),
  ]);
  cleanupChromeProfile(chrome);
}

function cleanupChromeProfile(chrome) {
  ACTIVE_CHROME_SESSIONS.delete(chrome);
  safeRemoveChromeProfile(chrome);
}

function cleanupChromeSessionSync(chrome) {
  ACTIVE_CHROME_SESSIONS.delete(chrome);
  if (chrome.child.exitCode === null) safeKillChrome(chrome.child, 'SIGKILL');
  safeRemoveChromeProfile(chrome);
}

function cleanupActiveChromeSessions() {
  for (const chrome of [...ACTIVE_CHROME_SESSIONS]) {
    cleanupChromeSessionSync(chrome);
  }
}

function safeRemoveChromeProfile(chrome) {
  try {
    rmSync(chrome.userDataDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup: signal/exit handlers must not throw while unwinding.
  }
}

function safeKillChrome(child, signal) {
  try {
    child.kill(signal);
  } catch {
    // Best-effort cleanup: the process may already have failed to spawn or exit.
  }
}

function browserBudgetSummary(browserBudget) {
  if (browserBudget.status === 'measured') {
    return `browser import+execute ${browserBudget.medianMs}ms (samples ${browserBudget.samples.join(',')}ms)`;
  }
  return `browser measurement skipped (${browserBudget.reason})`;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function measureColdImportExecute() {
  const source = JSON.stringify('fn name=main returns=void\n  handler lang="kern"\n    print value="42"');
  const expected = JSON.stringify('42\n');
  const entry = JSON.stringify(pathToFileURL(ENTRY).href);
  const code = [
    'const t = performance.now();',
    `const runner = await import(${entry});`,
    `const out = runner.executeKernSource(${source});`,
    `if (out !== ${expected}) throw new Error(out);`,
    'console.log(Math.ceil(performance.now() - t));',
  ].join('\n');
  const samples = [];
  for (let i = 0; i < COLD_START_RUNS; i += 1) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 10_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error(result.stderr || result.stdout);
      process.exit(result.status ?? 1);
    }
    const sample = Number.parseInt(result.stdout.trim(), 10);
    if (!Number.isFinite(sample)) {
      console.error(`runner cold-start probe returned non-numeric output: ${JSON.stringify(result.stdout)}`);
      process.exit(1);
    }
    samples.push(sample);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkGraph(entry) {
  const bare = new Set();
  const visited = new Set();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) {
      throw new Error(`runner browser graph references missing module: ${file}`);
    }
    const source = readFileSync(file, 'utf8');
    for (const spec of staticSpecifiers(source)) {
      if (spec.startsWith('.')) stack.push(resolve(dirname(file), spec));
      else bare.add(spec);
    }
  }
  return { bare, visited };
}

function staticSpecifiers(source) {
  const specs = [];
  for (let index = 0; index < source.length; index += 1) {
    const keyword = importExportKeywordAt(source, index);
    if (!keyword) {
      index = skipNonCode(source, index);
      continue;
    }
    const statementEnd = findStatementEnd(source, index);
    const statement = source.slice(index, statementEnd + 1);
    const spec = specifierFromStaticImportExport(statement);
    if (spec) specs.push(spec);
    index = statementEnd;
  }
  return specs;
}

function importExportKeywordAt(source, index) {
  const prev = index === 0 ? '' : source[index - 1];
  if ((prev && /[$\w]/.test(prev)) || !startsAtStatementBoundary(source, index)) return undefined;
  if (source.startsWith('import', index) && !/[$\w]/.test(source[index + 'import'.length] ?? '')) {
    const rest = source.slice(index + 'import'.length).trimStart();
    if (rest.startsWith('(') || rest.startsWith('.') || rest.startsWith(':')) return undefined;
    return 'import';
  }
  if (source.startsWith('export', index) && !/[$\w]/.test(source[index + 'export'.length] ?? '')) {
    const rest = source.slice(index + 'export'.length).trimStart();
    if (rest.startsWith('*') || rest.startsWith('{') || /^type\s+\{/.test(rest)) return 'export';
  }
  return undefined;
}

function startsAtStatementBoundary(source, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === '\n' || ch === ';' || ch === '}') return true;
    if (ch === '/' && source[i - 1] === '*') return true;
    if (!/\s/.test(ch)) return false;
  }
  return true;
}

function skipNonCode(source, index) {
  const ch = source[index];
  const next = source[index + 1];
  if (ch === '/' && next === '/') {
    const end = source.indexOf('\n', index + 2);
    return end === -1 ? source.length : Math.max(index, end - 1);
  }
  if (ch === '/' && next === '*') {
    const end = source.indexOf('*/', index + 2);
    return end === -1 ? source.length : end + 1;
  }
  if (ch === '`') return Math.min(skipTemplate(source, index), source.length - 1);
  if (ch === '"' || ch === "'") return Math.min(skipQuoted(source, index, ch), source.length - 1);
  return index;
}

function skipQuoted(source, index, quote) {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return source.length;
}

function skipTemplate(source, index) {
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === '`') return i;
    if (source[i] === '$' && source[i + 1] === '{') {
      i = skipTemplateExpression(source, i + 1);
    }
  }
  return source.length;
}

function skipTemplateExpression(source, openBraceIndex) {
  let depth = 1;
  for (let i = openBraceIndex + 1; i < source.length; i += 1) {
    const skipped = skipNonCode(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length;
}

function findStatementEnd(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const skipped = skipNonCode(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const ch = source[i];
    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (source[i] === ';') return i;
    if (ch === '\n' && depth === 0) {
      const statement = source.slice(start, i);
      if (specifierFromStaticImportExport(statement)) return i;
    }
  }
  return source.length;
}

function specifierFromStaticImportExport(statement) {
  const sideEffect = /^\s*import\s*['"]([^'"]+)['"]/.exec(statement);
  if (sideEffect?.[1]) return sideEffect[1];
  const from = /\bfrom\s*['"]([^'"]+)['"]/.exec(statement);
  return from?.[1];
}
