/**
 * Shared differential-execution primitives for the KERN conformance harnesses.
 *
 * Both `class-conformance.mjs` and `conformance.mjs` lower a KERN program to a
 * TypeScript/Express module and a Python module, run each under its real
 * interpreter (node / python3), capture stdout, and compare the JSON-normalized
 * results. These helpers factor out the mechanical parts of that loop — temp-dir
 * management, the standard exec options, the two interpreter invocations, the
 * standard `transpileModule` settings, and the JSON canonicalizer — so the
 * harnesses share ONE copy instead of drifting byte-for-byte.
 *
 * Pure refactor: every helper below is the exact behaviour the harnesses
 * already had inline (same exec opts, same compiler options, same best-effort
 * cleanup), just hoisted to a single module.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Standard subprocess options: UTF-8 stdout, 10s wall-clock cap per fixture.
export const EXEC_OPTS = { encoding: 'utf8', timeout: 10_000 };

// Standard TypeScript transpile settings for the Express/TS target module: ESM
// output at ES2022 so top-level class/fn declarations + `console.log(...)` run
// directly under `node <file>.mjs`.
export const TS_COMPILER_OPTIONS = { module: 'ESNext', target: 'ES2022' };

/**
 * Create a unique temp directory and register a best-effort cleanup on process
 * exit. Cleanup never throws — the OS reaps the dir regardless — so a run is
 * never failed by tmp-dir removal.
 */
export function makeTmpDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort tmp cleanup — never fail the run on it
    }
  });
  return dir;
}

/** Write `source` to `file` then run it under node, returning trimmed stdout. */
export function runNode(file, source) {
  if (source !== undefined) writeFileSync(file, source);
  return execFileSync('node', [file], EXEC_OPTS).trim();
}

/** Write `source` to `file` then run it under python3, returning trimmed stdout. */
export function runPython(file, source) {
  if (source !== undefined) writeFileSync(file, source);
  return execFileSync('python3', [file], EXEC_OPTS).trim();
}

/**
 * Transpile a TypeScript source string to an executable ESM string using the
 * standard conformance compiler options. `tsCompiler` is the imported
 * `typescript` module (passed in so this module stays dependency-light and the
 * caller controls the import).
 */
export function transpileTs(tsCompiler, tsSource) {
  return tsCompiler.transpileModule(tsSource, {
    compilerOptions: {
      module: tsCompiler.ModuleKind[TS_COMPILER_OPTIONS.module],
      target: tsCompiler.ScriptTarget[TS_COMPILER_OPTIONS.target],
    },
  }).outputText;
}

/** JSON canonicalizer used to compare ts/python/expected values. */
export const canon = (v) => JSON.stringify(v);
