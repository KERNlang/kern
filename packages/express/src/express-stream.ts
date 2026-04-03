import type { IRNode } from '@kernlang/core';
import { getChildren, getFirstChild, getProps } from '@kernlang/core';
import { escapeSingleQuotes } from './express-utils.js';

// ── SSE stream code generator ────────────────────────────────────────────

export function generateStreamSetup(indent: string): string[] {
  return [
    `${indent}res.writeHead(200, {`,
    `${indent}  'Content-Type': 'text/event-stream',`,
    `${indent}  'Cache-Control': 'no-cache',`,
    `${indent}  'Connection': 'keep-alive',`,
    `${indent}});`,
    `${indent}res.flushHeaders();`,
    `${indent}`,
    `${indent}const emit = (data: unknown, event?: string) => {`,
    `${indent}  if (res.writableEnded) return;`,
    `${indent}  if (event) res.write(\`event: \${event}\\n\`);`,
    `${indent}  res.write(\`data: \${JSON.stringify(data)}\\n\\n\`);`,
    `${indent}};`,
    `${indent}`,
    `${indent}// SSE heartbeat — keeps proxies/browsers from killing the connection`,
    `${indent}const heartbeat = setInterval(() => {`,
    `${indent}  if (res.writableEnded) { clearInterval(heartbeat); return; }`,
    `${indent}  res.write(': keep-alive\\n\\n');`,
    `${indent}}, 15000);`,
  ];
}

export function generateStreamWrap(handlerLines: string[], hasSpawn: boolean, indent: string): string[] {
  const lines: string[] = [];

  // Await the async IIFE so Express doesn't return before stream completes
  lines.push(`${indent}await (async () => {`);
  lines.push(`${indent}  try {`);

  if (hasSpawn) {
    // Wrap spawn in a Promise so we await child completion before closing stream
    lines.push(`${indent}    await new Promise<void>((resolveStream, rejectStream) => {`);
    lines.push(...handlerLines.map(l => `${indent}      ${l}`));
    // The spawn's on('close') handler should call resolveStream()
    lines.push(`${indent}    });`);
  } else {
    lines.push(...handlerLines.map(l => `${indent}    ${l}`));
  }

  lines.push(`${indent}  } catch (err) {`);
  lines.push(`${indent}    emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });`);
  lines.push(`${indent}  } finally {`);
  lines.push(`${indent}    clearInterval(heartbeat);`);
  lines.push(`${indent}    if (!res.writableEnded) {`);
  lines.push(`${indent}      res.write(\`data: \${JSON.stringify('[DONE]')}\\n\\n\`);`);
  lines.push(`${indent}      res.end();`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}})();`);

  return lines;
}

// ── Spawn code generator ─────────────────────────────────────────────────

export function generateSpawnCode(spawnNode: IRNode, indent: string): string[] {
  const p = getProps(spawnNode);
  const binary = String(p.binary || 'echo');
  const args = p.args as string | undefined;
  const timeoutSec = Number(p.timeout) || 0;
  const lines: string[] = [];

  // Validate: binary must be static (security: no dynamic binary)
  if (binary.includes('{{') || binary.includes('req.')) {
    lines.push(`${indent}// ERROR: Dynamic binary is not allowed for security. Use a static binary name.`);
    lines.push(`${indent}res.status(500).json({ error: 'Dynamic binary not allowed' });`);
    return lines;
  }

  const argsExpr = args || '[]';
  lines.push(`${indent}const child = spawn('${escapeSingleQuotes(binary)}', ${argsExpr}, {`);
  lines.push(`${indent}  stdio: ['pipe', 'pipe', 'pipe'],`);
  lines.push(`${indent}  shell: false,`);

  // Env vars
  const envNodes = getChildren(spawnNode, 'env');
  if (envNodes.length > 0) {
    const envPairs = envNodes.map(e => {
      const ep = getProps(e);
      const entries = Object.entries(ep).filter(([k]) => k !== 'styles' && k !== 'pseudoStyles' && k !== 'themeRefs');
      return entries.map(([k, v]) => `${k}: '${String(v)}'`).join(', ');
    }).join(', ');
    lines.push(`${indent}  env: { ...process.env, ${envPairs} },`);
  }

  lines.push(`${indent}});`);

  // stdin handling — only end if no stdin prop
  if (!p.stdin) {
    lines.push(`${indent}child.stdin.end();`);
  }

  lines.push(`${indent}let errorText = '';`);

  // Timeout with SIGTERM → SIGKILL escalation
  lines.push(`${indent}let childExited = false;`);
  lines.push(`${indent}child.on('exit', () => { childExited = true; });`);

  if (timeoutSec > 0) {
    lines.push(`${indent}const spawnTimer = setTimeout(() => {`);
    lines.push(`${indent}  child.kill('SIGTERM');`);
    lines.push(`${indent}  setTimeout(() => { if (!childExited) child.kill('SIGKILL'); }, 3000);`);
    lines.push(`${indent}}, ${timeoutSec * 1000});`);
  }

  // Abort on request close — SIGTERM then force SIGKILL + resolve after 5s
  lines.push(`${indent}ac.signal.addEventListener('abort', () => {`);
  lines.push(`${indent}  if (!childExited) {`);
  lines.push(`${indent}    child.kill('SIGTERM');`);
  lines.push(`${indent}    setTimeout(() => {`);
  lines.push(`${indent}      if (!childExited) child.kill('SIGKILL');`);
  lines.push(`${indent}      if (typeof resolveStream === 'function') resolveStream();`);
  lines.push(`${indent}    }, 5000);`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}});`);

  // Event handlers from child nodes
  const onNodes = getChildren(spawnNode, 'on');
  let hasCloseHandler = false;

  for (const onNode of onNodes) {
    const onProps = getProps(onNode);
    const event = String(onProps.name || onProps.event || '');
    const handlerChild = getFirstChild(onNode, 'handler');
    const code = handlerChild ? String(getProps(handlerChild).code || '') : '';

    if (event === 'stdout') {
      lines.push(`${indent}child.stdout.on('data', (chunk: Buffer) => {`);
      lines.push(...code.split('\n').map(l => `${indent}  ${l.trim()}`));
      lines.push(`${indent}});`);
    } else if (event === 'stderr') {
      lines.push(`${indent}child.stderr.on('data', (chunk: Buffer) => {`);
      lines.push(...code.split('\n').map(l => `${indent}  ${l.trim()}`));
      lines.push(`${indent}});`);
    } else if (event === 'close') {
      hasCloseHandler = true;
      lines.push(`${indent}child.on('close', (code: number | null) => {`);
      if (timeoutSec > 0) lines.push(`${indent}  clearTimeout(spawnTimer);`);
      lines.push(...code.split('\n').map(l => `${indent}  ${l.trim()}`));
      // Resolve the stream promise so finally block runs AFTER child exits
      lines.push(`${indent}  if (typeof resolveStream === 'function') resolveStream();`);
      lines.push(`${indent}});`);
    } else if (event === 'timeout') {
      // Handled via the timer killed branch
    }
  }

  // Default close handler if none specified — ensures stream promise resolves
  if (!hasCloseHandler) {
    lines.push(`${indent}child.on('close', (code: number | null) => {`);
    if (timeoutSec > 0) lines.push(`${indent}  clearTimeout(spawnTimer);`);
    lines.push(`${indent}  if (typeof resolveStream === 'function') resolveStream();`);
    lines.push(`${indent}});`);
  }

  // Catch spawn errors (binary not found)
  lines.push(`${indent}child.on('error', (err: Error) => {`);
  lines.push(`${indent}  emit({ type: 'error', error: err.message });`);
  lines.push(`${indent}  if (typeof resolveStream === 'function') resolveStream();`);
  lines.push(`${indent}});`);

  return lines;
}

// ── Timer code generator ─────────────────────────────────────────────────

export function generateTimerCode(timerNode: IRNode, handlerCode: string, indent: string): string[] {
  const p = getProps(timerNode);
  const timeoutSec = Number(Object.values(p).find(v => typeof v === 'string' && !isNaN(Number(v))) || p.timeout || 15);
  const handlerChild = getFirstChild(timerNode, 'handler');
  const timerHandlerCode = handlerChild ? String(getProps(handlerChild).code || '') : '';
  const onTimeoutNode = (timerNode.children || []).find(c => c.type === 'on' && (getProps(c).name === 'timeout' || getProps(c).event === 'timeout'));
  const timeoutHandler = onTimeoutNode ? getFirstChild(onTimeoutNode, 'handler') : undefined;
  const timeoutCode = timeoutHandler ? String(getProps(timeoutHandler).code || '') : `res.status(408).json({ error: 'Request timed out' });`;

  const lines: string[] = [];
  lines.push(`${indent}const timeoutMs = ${timeoutSec * 1000};`);
  lines.push(`${indent}const timer = setTimeout(() => {`);
  lines.push(`${indent}  ac.abort();`);
  lines.push(...timeoutCode.split('\n').map(l => `${indent}  ${l.trim()}`));
  lines.push(`${indent}}, timeoutMs);`);
  lines.push(`${indent}`);
  lines.push(`${indent}try {`);
  // Timer handler code (the work to do)
  if (timerHandlerCode) {
    lines.push(...timerHandlerCode.split('\n').map(l => `${indent}  ${l.trim()}`));
  }
  // Original route handler code
  if (handlerCode) {
    lines.push(...handlerCode.split('\n').map(l => `${indent}  ${l.trim()}`));
  }
  lines.push(`${indent}} catch (err) {`);
  lines.push(`${indent}  if (!ac.signal.aborted) {`);
  lines.push(`${indent}    clearTimeout(timer);`);
  lines.push(`${indent}    throw err;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}} finally {`);
  lines.push(`${indent}  clearTimeout(timer);`);
  lines.push(`${indent}}`);

  return lines;
}
