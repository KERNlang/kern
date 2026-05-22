/**
 * Python emitter leg — Phase 1 PR-3b.
 *
 * Council-approved design (6-engine agon brainstorm, run 1778871685720):
 *
 *   - **(A) Fresh `python3 -u` subprocess per fixture.** Clean isolation;
 *     ~50-100ms overhead × 19 fixtures = ~1-2s test cost; no shared state.
 *     `-u` flag forces unbuffered stdio so short-lived fixtures cannot
 *     drop trace events to a half-flushed buffer.
 *   - **(ii) Dedicated FD 3 for trace transport.** stdout is reserved for
 *     emitted-code `print()` calls; FD3 carries one JSON event per line.
 *     This keeps user output from polluting the trace channel.
 *   - **(B1) Codegen hook injected in production Python emitter** behind
 *     `BodyEmitOptions.traceHooks.eachIterNext` (opt-in only; production
 *     callers never set it). Symmetric with TS leg's hook contract.
 *   - **(P1) Sentinel exception classes** `_KernReturn`/`_KernThrow`
 *     defined in the prelude. Lowered `throw` body-stmts raise them;
 *     a wrapping `async def __kern_run()` catches and resolves them
 *     into [[CompletionRecord]]s. Symmetric with TS sentinel approach.
 *
 * Council-flagged mitigations applied:
 *   - Deterministic JSON: `sort_keys=True` on Python side; we already do
 *     key-sorted serialization on TS side via `serializeValue`.
 *   - Unbuffered stdio: `python3 -u`.
 *   - Async-aware timeout: subprocess SIGKILLed after 10s if it hasn't
 *     exited; surfaces as PythonLegError.
 *
 * Fixture authors: do NOT use Python `print()` inside fixture bodies — the
 * harness writes the completion record to stdout. Use `__trace` events with
 * `op: 'stdout'` if you need to observe stdout-style output through the
 * trace channel (FD 3).
 */

import { type ChildProcessByStdio, spawn } from 'node:child_process';
import type internal from 'node:stream';
import type { Readable } from 'node:stream';
import type { CanonicalError, CompletionRecord, NodeFixture, SemanticEnv, Trace, TraceEvent } from '@kernlang/core';
import { lowerFixtureForTarget } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports } from '../codegen-body-python.js';

const PYTHON_LEG_TIMEOUT_MS = 10_000;

/**
 * Serialise a fixture binding into a Python literal expression. Mirrors
 * `serializeValue` from `@kernlang/core/ir/semantics/fixture-lowering`
 * but with `target='python'` semantics so booleans, null, etc. map to
 * their Python equivalents.
 */
function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`pyLiteral: ${value} is not cross-target portable`);
    }
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`;
  if (value instanceof Map) {
    // Python dict (3.7+) preserves insertion order; emit in Map iteration
    // order to keep `.keys()` / `.values()` / `.items()` iteration semantics
    // aligned with the reference runner (which uses `Map` insertion order).
    const pairs = Array.from(value.entries()).map(([k, v]) => `${JSON.stringify(String(k))}: ${pyLiteral(v)}`);
    return `{${pairs.join(', ')}}`;
  }
  if (typeof value === 'object') {
    // Preserve JS object insertion order — Python dict iteration mirrors it.
    // Sort-keys here would silently reorder entry-mode iteration.
    const pairs = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`,
    );
    return `{${pairs.join(', ')}}`;
  }
  throw new Error(`pyLiteral: unsupported type "${typeof value}"`);
}

/**
 * Python prelude — injected as the first statements in the spawned
 * subprocess. Defines the sentinel classes the lowered IR raises, the
 * trace sink that writes one JSON event per line to FD 3, and the
 * async wrapper that converts sentinel exceptions into CompletionRecords.
 */
function buildPrelude(): string {
  return [
    'import asyncio',
    'import json',
    'import os',
    'import sys',
    '',
    'class _KernReturn(Exception):',
    '    def __init__(self, value):',
    '        self.value = value',
    '',
    'class _KernThrow(Exception):',
    '    def __init__(self, kind):',
    '        self.kind = kind',
    '',
    '_kern_trace_fd = 3',
    '',
    'def _kern_trace(event):',
    '    line = json.dumps(event, sort_keys=True)',
    '    os.write(_kern_trace_fd, (line + "\\n").encode("utf-8"))',
    '',
  ].join('\n');
}

/**
 * Wrap the emitted body in an async function that returns a JSON
 * CompletionRecord on stdout, catching the sentinel exceptions.
 *
 * `helpers` are emitted at module scope ABOVE the env bindings so they're
 * visible from inside `__kern_run`. This matches production codegen: helpers
 * (`_kern_pairs`, `_kern_async_pairs`) are module-level defs, not nested
 * inside the running function.
 */
function buildProgram(
  bodyCode: string,
  envBindings: ReadonlyArray<[string, unknown]>,
  helpers: ReadonlyArray<string>,
): string {
  const bindingLines = envBindings.map(([name, value]) => `${name} = ${pyLiteral(value)}`);
  const indented = bodyCode
    .split('\n')
    .map((line) => (line.length === 0 ? '' : `        ${line}`))
    .join('\n');
  const helperBlock = helpers.length > 0 ? `${helpers.join('\n\n')}\n` : '';
  return [
    buildPrelude(),
    helperBlock,
    ...bindingLines,
    '',
    'async def __kern_run():',
    '    try:',
    indented || '        pass',
    `        return {"kind": "normal"}`,
    '    except _KernReturn as r:',
    '        return {"kind": "return", "value": r.value}',
    '    except _KernThrow as t:',
    '        return {"kind": "throw", "error": {"kind": t.kind}}',
    '',
    '_completion = asyncio.run(__kern_run())',
    'sys.stdout.write(json.dumps(_completion, sort_keys=True))',
    'sys.stdout.flush()',
  ].join('\n');
}

export class PythonLegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonLegError';
  }
}

interface ProcessResult {
  stdout: string;
  fd3: string;
  stderr: string;
  exitCode: number | null;
}

function runPython(program: string): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<internal.Writable, internal.Readable, internal.Readable>;
    try {
      child = spawn('python3', ['-u', '-c', program], {
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      }) as unknown as ChildProcessByStdio<internal.Writable, internal.Readable, internal.Readable>;
    } catch (err) {
      reject(new PythonLegError(`python3 spawn failed: ${(err as Error).message}`));
      return;
    }

    // Single-settle guard — `error` and `close` can both fire; we want
    // exactly one terminal resolution.
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };

    let stdout = '';
    let stderr = '';
    let fd3 = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    // FD 3 is the trace channel. Parent's view is Readable because the child
    // writes to FD 3 via `os.write(3, ...)`.
    const fd3Stream = (child.stdio as unknown as Array<Readable | null>)[3];
    if (fd3Stream && typeof fd3Stream.on === 'function') {
      fd3Stream.on('data', (chunk: Buffer | string) => {
        fd3 += chunk.toString();
      });
      fd3Stream.on('error', (err: Error) => {
        settle(() => {
          clearTimeout(killTimer);
          reject(new PythonLegError(`fd3 stream error: ${err.message}`));
        });
      });
    }

    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(() => reject(new PythonLegError(`python3 timed out after ${PYTHON_LEG_TIMEOUT_MS}ms`)));
    }, PYTHON_LEG_TIMEOUT_MS);
    killTimer.unref?.();

    child.on('error', (err) => {
      settle(() => {
        clearTimeout(killTimer);
        reject(new PythonLegError(`python3 process error: ${err.message}`));
      });
    });

    // Resolve on `close` — fires only after ALL stdio streams have closed,
    // so stdout/stderr/FD3 buffers are fully drained. `exit` races stdio
    // drain (claude + codex agreed in PR-3b review).
    child.on('close', (code) => {
      settle(() => {
        clearTimeout(killTimer);
        resolve({ stdout, fd3, stderr, exitCode: code });
      });
    });
  });
}

function parseTraceEvents(fd3: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const raw of fd3.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line) as TraceEvent);
    } catch {
      throw new PythonLegError(`malformed trace line on FD3: ${line.slice(0, 200)}`);
    }
  }
  return events;
}

function isCompletion(value: unknown): value is CompletionRecord {
  if (!value || typeof value !== 'object') return false;
  const k = (value as { kind?: unknown }).kind;
  return k === 'normal' || k === 'return' || k === 'throw';
}

/**
 * Run the Python emitter leg of the differential harness.
 *
 * Error model mirrors `runTsEmitterLeg`: ONLY the sentinel-resolved
 * completions count as fixture-comparable; any other failure (spawn
 * error, non-zero exit, malformed FD3 output) is thrown so the harness
 * records `leg-error`.
 */
export async function runPythonEmitterLeg(fixture: NodeFixture, env: SemanticEnv): Promise<Trace> {
  const lowered = lowerFixtureForTarget(fixture.ir, 'python');
  const handlerChildren = lowered.type === '__block' ? (lowered.children ?? []) : [lowered];
  const handlerWrapper = {
    type: 'handler',
    props: { lang: 'kern' },
    children: handlerChildren,
  };

  let bodyCode: string;
  let bodyHelpers: ReadonlyArray<string>;
  try {
    const result = emitNativeKernBodyPythonWithImports(handlerWrapper, {
      traceHooks: { eachIterNext: true, forIterNext: true, letAssign: shouldTraceLetAssign(fixture.ir) },
    });
    if (result.imports.size > 0) {
      // Differential fixtures don't exercise stdlib-import codegen (math, etc.);
      // if a future fixture does, this leg will need an import-emission
      // strategy. Fail loud rather than silently producing broken Python.
      const list = [...result.imports].sort().join(', ');
      throw new PythonLegError(`fixture body requires Python imports [${list}] — unsupported by harness`);
    }
    bodyCode = result.code;
    bodyHelpers = [...result.helpers];
  } catch (err) {
    if (err instanceof PythonLegError) throw err;
    throw new PythonLegError(`emitNativeKernBodyPythonWithImports failed: ${(err as Error).message}`);
  }

  const program = buildProgram(bodyCode, Array.from(env.bindings.entries()), bodyHelpers);

  const result = await runPython(program);

  if (result.exitCode !== 0) {
    throw new PythonLegError(`python3 exited with code ${result.exitCode}; stderr=${result.stderr.slice(0, 1000)}`);
  }

  const events = parseTraceEvents(result.fd3);

  let completion: CompletionRecord;
  try {
    const parsed = JSON.parse(result.stdout);
    if (!isCompletion(parsed)) {
      throw new Error(`unexpected completion shape: ${result.stdout.slice(0, 500)}`);
    }
    completion = parsed;
    // Canonicalise error: Python sends `{"kind": "throw", "error": {"kind": "TypeError"}}`.
    // The CompletionRecord shape matches our reference; nothing more to do.
    if (completion.kind === 'throw' && completion.error) {
      const canonical: CanonicalError = { kind: completion.error.kind };
      completion = { kind: 'throw', error: canonical };
    }
  } catch (err) {
    throw new PythonLegError(
      `failed to parse Python completion JSON: ${(err as Error).message}; stdout=${result.stdout.slice(0, 500)}`,
    );
  }

  return { events, completion };
}

function shouldTraceLetAssign(ir: NodeFixture['ir']): boolean {
  return ir.type === 'let' || ir.props?.__semanticContract === 'let';
}
