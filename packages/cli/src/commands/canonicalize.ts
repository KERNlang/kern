import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { parseDocumentWithDiagnostics } from '@kernlang/core';
import { nativeEligibilityClassifier, typescriptClosureClassifier } from '@kernlang/core/node';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '@kernlang/core/runtime/handler';
import { decodeModuleKir, encodeModuleKir } from '../kern-canonicalizer/core/kir-structural/module-canonical.js';
import { canonicalizerTableArguments, flattenStructuralKir } from './canonicalizer-adapter.js';
import { type CanonicalizerAssets, loadCanonicalizerAssets } from './canonicalizer-assets.js';
import { firstDiscardedCommentLine } from './canonicalizer-source-boundary.js';

export const KERN_CANONICALIZE_REPORT_FORMAT = 'kern.cli.canonicalize.1' as const;

const NODE_PARSE_CAPS = {
  closureClassifier: typescriptClosureClassifier,
  nativeEligibilityClassifier,
} as const;

const CANONICALIZE_MODULE_ID = 'canonicalize-input.kern';

export interface CanonicalizeDiagnostic {
  readonly code: string;
  readonly column: number | null;
  readonly line: number | null;
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info';
}

export interface CanonicalizeReport {
  readonly canonicalSource: string | null;
  readonly canonicalizer: { readonly bytes: number; readonly sha256: string } | null;
  readonly changed: boolean | null;
  readonly diagnostics: readonly CanonicalizeDiagnostic[];
  readonly format: typeof KERN_CANONICALIZE_REPORT_FORMAT;
  readonly outcome: 'success' | 'failure';
}

function failure(
  assets: CanonicalizerAssets | null,
  code: string,
  message: string,
  diagnostics?: readonly CanonicalizeDiagnostic[],
): CanonicalizeReport {
  return {
    canonicalSource: null,
    canonicalizer: assets ? { bytes: assets.bytes, sha256: assets.sha256 } : null,
    changed: null,
    diagnostics: diagnostics ?? [{ code, column: null, line: null, message, severity: 'error' }],
    format: KERN_CANONICALIZE_REPORT_FORMAT,
    outcome: 'failure',
  };
}

function parseDiagnostics(source: string, maxDiagnostics: number) {
  const parsed = parseDocumentWithDiagnostics(source, undefined, NODE_PARSE_CAPS);
  const hasErrors = parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const diagnostics: CanonicalizeDiagnostic[] = parsed.diagnostics.slice(0, maxDiagnostics).map((diagnostic) => ({
    code: diagnostic.code,
    column: diagnostic.col,
    line: diagnostic.line,
    message: diagnostic.message,
    severity: diagnostic.severity,
  }));
  if (parsed.diagnostics.length > maxDiagnostics) {
    diagnostics[maxDiagnostics - 1] = {
      code: 'diagnostics-truncated',
      column: null,
      line: null,
      message: `diagnostics truncated at configured limit ${maxDiagnostics}`,
      severity: 'error',
    };
  }
  return { diagnostics, hasErrors, parsed };
}

export function canonicalizeKernSource(
  source: string,
  _sourceName: string,
  providedAssets?: CanonicalizerAssets,
): CanonicalizeReport {
  let assets: CanonicalizerAssets | null = null;
  try {
    assets = providedAssets ?? loadCanonicalizerAssets();
    const sourceBytes = Buffer.byteLength(source, 'utf8');
    if (sourceBytes > assets.policy.runtimeLimits.maxStringBytes) {
      return failure(
        assets,
        'source-too-large',
        `source exceeds configured ${assets.policy.runtimeLimits.maxStringBytes}-byte limit`,
      );
    }
    const discardedCommentLine = firstDiscardedCommentLine(source);
    if (discardedCommentLine !== null) {
      return failure(
        assets,
        'comments-not-preserved',
        `comment syntax at line ${discardedCommentLine} is rejected because canonicalization cannot preserve trivia`,
      );
    }
    const initial = parseDiagnostics(source, assets.policy.runtimeLimits.maxDiagnostics);
    if (initial.parsed.partial || initial.hasErrors) {
      return failure(assets, 'parse-rejected', 'source parsing failed', initial.diagnostics);
    }

    const moduleId = CANONICALIZE_MODULE_ID;
    const roots = initial.parsed.root.type === 'document' ? (initial.parsed.root.children ?? []) : [];
    const originalBytes = encodeModuleKir([{ id: moduleId, roots }], assets.policy.kirLimits);
    const decoded = decodeModuleKir(originalBytes, assets.policy.kirLimits);
    const module = decoded.modules.find((candidate) => candidate.id === moduleId);
    if (!module) return failure(assets, 'kir-module-missing', `structural KIR omitted ${moduleId}`);

    const tables = flattenStructuralKir(module.roots);
    const envelope = executeKernRuntimeHandlerSync(
      {
        abi: KERN_RUNTIME_HANDLER_ABI,
        arguments: [
          ...canonicalizerTableArguments(tables),
          assets.policy.profileLimits.maxNodeRows,
          assets.policy.profileLimits.maxPropertyRows,
          assets.policy.profileLimits.maxValueRows,
        ],
        identity: {
          handlerName: 'canonicalize',
          sourcePath: '@kernlang/cli/dist/kern-canonicalizer/canonicalizer.composed.kern',
        },
        source: assets.source,
      },
      { enabled: true, limits: assets.policy.runtimeLimits },
    );

    if (
      envelope.outcome !== 'success' ||
      envelope.completion.kind !== 'return' ||
      envelope.events.length !== 0 ||
      envelope.result.presence !== 'value' ||
      envelope.result.value.tag !== 'list'
    ) {
      const diagnostics = envelope.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        column: null,
        line: null,
        message: `KERN canonicalizer rejected during ${diagnostic.phase}`,
        severity: 'error' as const,
      }));
      return failure(
        assets,
        'canonicalizer-rejected',
        'KERN canonicalizer returned a malformed or failed envelope',
        diagnostics.length > 0 ? diagnostics : undefined,
      );
    }

    const lines: string[] = [];
    for (const [index, value] of envelope.result.value.value.entries()) {
      if (value.tag !== 'text') {
        return failure(assets, 'canonicalizer-invalid-result', `result line ${index} is not text`);
      }
      lines.push(value.value);
    }
    const canonicalSource = `${lines.join('\n')}\n`;

    const canonical = parseDiagnostics(canonicalSource, assets.policy.runtimeLimits.maxDiagnostics);
    if (canonical.parsed.partial || canonical.hasErrors) {
      return failure(assets, 'canonicalizer-invalid-source', 'canonical output does not parse', canonical.diagnostics);
    }
    const canonicalRoots = canonical.parsed.root.type === 'document' ? (canonical.parsed.root.children ?? []) : [];
    const canonicalBytes = encodeModuleKir([{ id: moduleId, roots: canonicalRoots }], assets.policy.kirLimits);
    if (!Buffer.from(canonicalBytes).equals(Buffer.from(originalBytes))) {
      return failure(assets, 'kir-mismatch', 'canonical output changed structural KIR');
    }

    return {
      canonicalSource,
      canonicalizer: { bytes: assets.bytes, sha256: assets.sha256 },
      changed: canonicalSource !== source,
      diagnostics: initial.diagnostics,
      format: KERN_CANONICALIZE_REPORT_FORMAT,
      outcome: 'success',
    };
  } catch (error) {
    return failure(assets, 'canonicalization-failed', error instanceof Error ? error.message : String(error));
  }
}

function json(report: CanonicalizeReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function readBoundedUtf8(path: string, maxBytes: number): string {
  const pathStat = lstatSync(path);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw new TypeError('canonicalize input must be a regular file');
  }
  if (pathStat.size > maxBytes) throw new TypeError(`canonicalize input exceeds configured ${maxBytes}-byte limit`);
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new TypeError('canonicalize input must be a regular file');
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
      throw new TypeError('canonicalize input changed while opening');
    }
    if (stat.size > maxBytes) throw new TypeError(`canonicalize input exceeds configured ${maxBytes}-byte limit`);
    const bytes = Buffer.alloc(Math.min(stat.size, maxBytes) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new TypeError(`canonicalize input exceeds configured ${maxBytes}-byte limit`);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
    } catch {
      throw new TypeError('canonicalize input must be valid UTF-8');
    }
  } finally {
    closeSync(descriptor);
  }
}

export function runCanonicalize(args: string[]): void {
  const values = args.slice(1);
  const check = values.includes('--check');
  const jsonOutput = values.includes('--json');
  const unknownFlags = values.filter((value) => value.startsWith('--') && value !== '--check' && value !== '--json');
  const paths = values.filter((value) => !value.startsWith('--'));
  let assets: CanonicalizerAssets | null = null;
  let report: CanonicalizeReport;

  try {
    if (unknownFlags.length > 0 || paths.length !== 1) {
      throw new TypeError('Usage: kern canonicalize <file.kern> [--check] [--json]');
    }
    const path = resolve(paths[0]);
    if (extname(path) !== '.kern') throw new TypeError('canonicalize input must use the .kern extension');
    assets = loadCanonicalizerAssets();
    report = canonicalizeKernSource(readBoundedUtf8(path, assets.policy.runtimeLimits.maxStringBytes), path, assets);
  } catch (error) {
    report = failure(assets, 'cli-error', error instanceof Error ? error.message : String(error));
  }

  if (report.outcome === 'success' && report.canonicalSource === null) {
    report = failure(assets, 'canonicalizer-invalid-result', 'canonicalizer success omitted canonical source');
  }

  if (jsonOutput) {
    process.stdout.write(json(check && report.outcome === 'success' ? { ...report, canonicalSource: null } : report));
  } else if (report.outcome === 'failure') {
    process.stderr.write(`${report.diagnostics[0]?.message ?? 'canonicalization failed'}\n`);
  } else if (check) {
    if (report.changed) process.stderr.write(`${paths[0]} would change\n`);
  } else {
    process.stdout.write(report.canonicalSource ?? '');
  }

  process.exitCode = report.outcome === 'failure' ? 2 : check && report.changed ? 1 : 0;
}
