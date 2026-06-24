import type { IRNode } from '@kernlang/core';
import {
  makeEnv,
  parseDocumentWithDiagnostics,
  ReferenceRunnerError,
  referenceRunSequence,
  registerAllContracts,
} from '@kernlang/core';
import { nativeEligibilityClassifier, typescriptClosureClassifier } from '@kernlang/core/node';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const USAGE = 'Usage: kern run <file.kern>';

// The same parser capabilities the rest of the Node CLI injects (see compile.ts),
// so `kern run` parses identically to `kern compile` — block-bodied arrow closures
// and native-eligibility hints resolve instead of failing closed at parse time.
const NODE_PARSE_CAPS = {
  closureClassifier: typescriptClosureClassifier,
  nativeEligibilityClassifier,
} as const;

/**
 * A controlled `kern run` failure: a stderr diagnostic + a process exit code.
 * Thrown by the resolution/execution steps and turned into `process.exitCode` by
 * {@link runRun}. Keeping exit policy in ONE place means we never call
 * `process.exit()` mid-write, which can truncate piped stdout/stderr.
 */
class KernRunError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = 'KernRunError';
    this.exitCode = exitCode;
  }
}

/** Strict slice-1 entry resolution → the single `fn main`'s `handler lang="kern"`. */
function resolveMainHandler(root: IRNode): IRNode {
  const topLevel = root.type === 'document' ? (root.children ?? []) : [];
  const mains = topLevel.filter((node) => node.type === 'fn' && node.props?.name === 'main');

  if (mains.length === 0) throw new KernRunError('expected exactly one top-level fn name=main');
  if (mains.length > 1) throw new KernRunError('found multiple top-level fn name=main');

  const main = mains[0];
  if (main.props?.returns !== 'void') throw new KernRunError('main must declare returns=void');
  if (typeof main.props?.params === 'string' && main.props.params.trim() !== '') {
    throw new KernRunError('main parameters are unsupported in slice-1');
  }
  if (main.props?.async === 'true') throw new KernRunError('main async is unsupported in slice-1');

  const handlers = (main.children ?? []).filter((node) => node.type === 'handler' && node.props?.lang === 'kern');
  if (handlers.length !== 1) throw new KernRunError('main must contain exactly one handler lang="kern"');

  return handlers[0];
}

/**
 * Parse + execute `source`, returning the program's stdout as a single string,
 * or throwing {@link KernRunError} on any setup failure or runner abstention.
 * Pure (no stream/exit side effects) so {@link runRun} is the one place that
 * touches process state — and so the executor is unit-testable without spawning.
 *
 * Atomicity: the runner returns the COMPLETE trace or throws, so stdout is built
 * only after the whole body succeeds; a body that abstains mid-way leaks nothing.
 */
export function executeKernSource(source: string): string {
  const { root, diagnostics } = parseDocumentWithDiagnostics(source, undefined, NODE_PARSE_CAPS);
  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (firstError) throw new KernRunError(firstError.message);

  // NOTE: we deliberately do NOT run `validateSchema` here. `print` (and other new
  // runner primitives) are not yet registered as allowed `handler` children in the
  // schema, so schema validation would reject valid runnable programs. Parse
  // diagnostics above + the runner's fail-close below are the validation surface
  // for slice-1; aligning the schema with the runner's primitives is a separate slice.
  const handler = resolveMainHandler(root);
  registerAllContracts();

  let trace: ReturnType<typeof referenceRunSequence>;
  try {
    trace = referenceRunSequence(handler.children ?? [], makeEnv());
  } catch (err) {
    if (err instanceof ReferenceRunnerError) {
      throw new KernRunError(`kern run: cannot execute - non-portable operation (${err.message})`);
    }
    throw new KernRunError(`kern run: ${err instanceof Error ? err.message : String(err)}`);
  }

  const kind = trace.completion.kind;
  if (kind === 'normal' || kind === 'return') {
    let out = '';
    for (const event of trace.events) {
      if (event.op === 'stdout') out += `${event.text}\n`;
    }
    return out;
  }
  // The runner abstains on `throw` today (caught above as a ReferenceRunnerError),
  // so this `throw`-completion branch is reserved; `break`/`continue` escaping main
  // are malformed programs.
  if (kind === 'throw') {
    throw new KernRunError(
      `kern run: cannot execute - non-portable operation (main threw ${trace.completion.error?.kind ?? 'Error'})`,
    );
  }
  throw new KernRunError('control statement escaped main');
}

/** `kern run <file.kern>` — execute the KERN-native `fn main` through the reference runner. */
export function runRun(args: string[]): void {
  const fileArg = args[1];
  if (!fileArg) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }

  const filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    process.stderr.write(`kern run: cannot read file '${fileArg}'\n`);
    process.exitCode = 2;
    return;
  }

  let source: string;
  try {
    source = readFileSync(filePath, 'utf-8');
  } catch (err) {
    process.stderr.write(`kern run: cannot read file '${fileArg}': ${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  try {
    const output = executeKernSource(source);
    // `process.exitCode` + a return (instead of `process.exit()`) lets Node flush
    // stdout/stderr naturally before exiting — no truncation on a pipe.
    if (output) process.stdout.write(output);
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof KernRunError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    throw err;
  }
}
