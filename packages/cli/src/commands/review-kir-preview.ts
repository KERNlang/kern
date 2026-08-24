import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { relative, resolve, sep } from 'path';
import { withoutLocalGitEnv } from '../git-env.js';

export const KIR_ANALYSIS_MODES = ['legacy-source', 'canonical-kir-preview', 'dual-compare'] as const;

export type KirAnalysisMode = (typeof KIR_ANALYSIS_MODES)[number];

type MachineOutput = 'json' | 'sarif' | 'text';

type PreviewResult = {
  status?: string;
  analysisMode?: string;
  findings?: unknown[];
  diagnostics?: unknown[];
  canonical?: PreviewResult;
  legacy?: PreviewResult;
  divergence?: unknown;
  [key: string]: unknown;
};

type KernModule = Readonly<{ moduleId: string; source: string }>;

export type KirPreviewComparison = 'snapshot' | 'git-diff';

export interface KirPreviewInputOptions {
  readonly cwd?: string;
  readonly diffBase?: string;
  readonly scopePaths?: readonly string[];
}

/**
 * Parse the opt-in KIR selector without affecting the legacy command path.
 * `undefined` deliberately means the historical source-analysis behavior.
 */
export function parseKirAnalysisMode(args: string[]): KirAnalysisMode | undefined {
  const matches = args.filter((arg) => arg.startsWith('--analysis-mode='));
  const separate = args.indexOf('--analysis-mode');
  const hasSelector = matches.length > 0 || separate !== -1;
  const supplied =
    matches.length > 0
      ? matches[matches.length - 1].slice('--analysis-mode='.length)
      : separate === -1
        ? undefined
        : args[separate + 1];

  if (!hasSelector) return undefined;
  if (typeof supplied === 'string' && (KIR_ANALYSIS_MODES as readonly string[]).includes(supplied)) {
    return supplied as KirAnalysisMode;
  }
  throw new Error(
    `--analysis-mode=${supplied || '<missing>'} invalid. Expected one of: ${KIR_ANALYSIS_MODES.join(', ')}.`,
  );
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return (leftPoints[index] as number) - (rightPoints[index] as number);
    }
  }
  return leftPoints.length - rightPoints.length;
}

function assertSafeModuleId(moduleId: string): string {
  if (moduleId.length === 0 || moduleId.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`KIR preview requires a safe module identity; received: ${moduleId || '<empty>'}`);
  }
  return moduleId;
}

function commonSourceRoot(paths: readonly string[]): string {
  const segments = paths.map((filePath) => resolve(filePath).split(sep));
  const common: string[] = [];
  for (let index = 0; index < Math.min(...segments.map((parts) => parts.length)); index += 1) {
    const segment = segments[0][index];
    if (segments.every((parts) => parts[index] === segment)) common.push(segment);
    else break;
  }
  // A source file's parent is always a safe identity root, including when it
  // lives outside cwd (where relative(cwd, file) would begin with `..`).
  return common.join(sep) || sep;
}

function modulesFromSources(entries: readonly { moduleId: string; source: string }[]): readonly KernModule[] {
  if (entries.length === 0) throw new Error('KIR preview requires a non-empty module set on each side.');
  const seen = new Set<string>();
  return Object.freeze(
    entries
      .map(({ moduleId, source }) => {
        const safeModuleId = assertSafeModuleId(moduleId);
        if (seen.has(safeModuleId))
          throw new Error(`KIR preview requires unique module identities; duplicate: ${safeModuleId}`);
        seen.add(safeModuleId);
        return Object.freeze({ moduleId: safeModuleId, source });
      })
      .sort((left, right) => compareCodePoints(left.moduleId, right.moduleId)),
  );
}

export function collectKirPreviewModules(paths: string[], cwd: string = process.cwd()): readonly KernModule[] {
  if (paths.length === 0) throw new Error('KIR preview requires at least one .kern source file.');
  for (const filePath of paths) {
    if (!filePath.endsWith('.kern')) {
      throw new Error(`KIR preview accepts only .kern sources; received: ${filePath}`);
    }
  }
  const root = commonSourceRoot(paths.map((filePath) => resolve(filePath, '..')));
  return modulesFromSources(
    paths.map((filePath) => {
      const insideCwd = relative(cwd, resolve(filePath));
      const moduleId =
        insideCwd && !insideCwd.startsWith(`..${sep}`) && insideCwd !== '..'
          ? insideCwd.split(sep).join('/')
          : relative(root, resolve(filePath)).split(sep).join('/');
      return { moduleId, source: readFileSync(filePath, 'utf-8') };
    }),
  );
}

function git(cwd: string, args: string[], encoding: BufferEncoding = 'utf-8'): string {
  return execFileSync('git', args, {
    cwd,
    encoding,
    env: { ...withoutLocalGitEnv(), LC_ALL: 'C' },
  }) as unknown as string;
}

function gitRoot(cwd: string): string {
  return git(cwd, ['rev-parse', '--show-toplevel']).trim();
}

function repoPath(root: string, filePath: string): string {
  const path = relative(root, resolve(filePath)).split(sep).join('/');
  return assertSafeModuleId(path);
}

function selected(path: string, scopes: readonly string[] | undefined): boolean {
  return !scopes || scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

function trackedKernPaths(root: string, ref: string | undefined): string[] {
  const output = ref
    ? git(root, ['ls-tree', '-r', '--name-only', '-z', ref])
    : git(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  return output.split('\0').filter((path) => path.endsWith('.kern'));
}

function changedPairPaths(root: string, ref: string, scopes: readonly string[] | undefined): Set<string> {
  const tokens = git(root, ['diff', '--name-status', '-z', '-M', ref]).split('\0');
  const paired = new Set<string>();
  for (let index = 0; index < tokens.length - 1; ) {
    const status = tokens[index++];
    if (!status) continue;
    const first = tokens[index++];
    const second = /^(R|C)/u.test(status) ? tokens[index++] : undefined;
    if ((second && (selected(first, scopes) || selected(second, scopes))) || (!second && selected(first, scopes))) {
      if (first.endsWith('.kern')) paired.add(first);
      if (second?.endsWith('.kern')) paired.add(second);
    }
  }
  return paired;
}

function resolveGitModules(
  options: Required<Pick<KirPreviewInputOptions, 'cwd' | 'diffBase'>> & KirPreviewInputOptions,
): {
  base: readonly KernModule[];
  head: readonly KernModule[];
} {
  const root = gitRoot(options.cwd);
  const ref = git(root, ['rev-parse', '--verify', `${options.diffBase}^{commit}`]).trim();
  const scopes = options.scopePaths?.map((scope) => repoPath(root, resolve(options.cwd, scope)));
  const paired = changedPairPaths(root, ref, scopes);
  const include = (path: string) => selected(path, scopes) || paired.has(path);
  const basePaths = trackedKernPaths(root, ref).filter(include);
  const headPaths = trackedKernPaths(root, undefined)
    .filter(include)
    .filter((path) => existsSync(resolve(root, path)));
  const base = modulesFromSources(
    basePaths.map((moduleId) => ({
      moduleId,
      source: git(root, ['show', `${ref}:${moduleId}`]),
    })),
  );
  const head = modulesFromSources(
    headPaths.map((moduleId) => ({
      moduleId,
      source: readFileSync(resolve(root, moduleId), 'utf-8'),
    })),
  );
  return { base, head };
}

/**
 * The CLI depends only on the public Review entry point.  Keeping this
 * dynamic avoids coupling the stable CLI build to an optional preview export
 * during mixed-version installs, while still failing visibly at invocation.
 */
export async function runKirPreviewAnalysis(
  mode: Exclude<KirAnalysisMode, 'legacy-source'>,
  entryFilePaths: string[],
  options: KirPreviewInputOptions = {},
): Promise<PreviewResult> {
  const review =
    mode === 'canonical-kir-preview'
      ? await import('@kernlang/review/kir-preview')
      : await import('@kernlang/review/kir-preview-dual');
  const preview = review as unknown as {
    reviewKernModuleSets?: (request: {
      base: { modules: readonly KernModule[] };
      head: { modules: readonly KernModule[] };
      mode: Exclude<KirAnalysisMode, 'legacy-source'>;
    }) => Promise<PreviewResult>;
  };
  if (typeof preview.reviewKernModuleSets !== 'function') {
    throw new Error(
      `canonical-kir-preview is unavailable: the selected @kernlang/review entrypoint does not export reviewKernModuleSets.`,
    );
  }
  if (mode === 'dual-compare' && !options.diffBase) {
    throw new Error('dual-compare requires --diff <ref>; a snapshot cannot be used as a semantic comparison.');
  }
  const comparison: KirPreviewComparison = options.diffBase ? 'git-diff' : 'snapshot';
  const modules = options.diffBase
    ? resolveGitModules({ ...options, cwd: options.cwd ?? process.cwd(), diffBase: options.diffBase })
    : (() => {
        const current = collectKirPreviewModules(entryFilePaths, options.cwd);
        return { base: current, head: current };
      })();
  const result = await preview.reviewKernModuleSets({
    base: { modules: modules.base },
    head: { modules: modules.head },
    mode,
  });
  return { ...result, comparison };
}

function diagnosticsOf(result: PreviewResult): unknown[] {
  if (Array.isArray(result.diagnostics)) return result.diagnostics;
  if (result.canonical) return diagnosticsOf(result.canonical);
  return [];
}

function failedCanonical(result: PreviewResult): boolean {
  return result.canonical ? result.canonical.status === 'failed' : result.status === 'failed';
}

function diagnosticText(diagnostic: unknown): string {
  if (typeof diagnostic === 'string') return diagnostic;
  if (diagnostic && typeof diagnostic === 'object') {
    const value = diagnostic as Record<string, unknown>;
    const code = typeof value.code === 'string' ? `${value.code}: ` : '';
    const message = typeof value.message === 'string' ? value.message : JSON.stringify(value);
    return `${code}${message}`;
  }
  return String(diagnostic);
}

function sarifResultsForKirFindings(result: PreviewResult): Record<string, unknown>[] {
  const canonical = result.canonical ?? result;
  if (!Array.isArray(canonical.findings)) return [];
  return canonical.findings.map((finding) => {
    const value = finding && typeof finding === 'object' ? (finding as Record<string, unknown>) : {};
    const facet = typeof value.facet === 'string' ? value.facet : 'change';
    const change = typeof value.change === 'string' ? value.change : 'detected';
    const key = typeof value.key === 'string' ? value.key : diagnosticText(finding);
    return {
      ruleId: `kern/kir-preview/${facet}`,
      level: 'warning',
      message: { text: `${change}: ${key}` },
      partialFingerprints: typeof value.fingerprint === 'string' ? { 'kern/kir-preview': value.fingerprint } : {},
      properties: { 'kern/analysis-mode': 'canonical-kir-preview', finding: value },
    };
  });
}

function sarifForKirPreview(result: PreviewResult): Record<string, unknown> {
  const canonical = result.canonical ?? result;
  const diagnostics = diagnosticsOf(result);
  const failed = failedCanonical(result);
  return {
    $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: '@kernlang/review', version: '2.0.0', rules: [] } },
        results: sarifResultsForKirFindings(result),
        properties: {
          analysisMode: result.analysisMode ?? (result.canonical ? 'dual-compare' : 'canonical-kir-preview'),
          comparison: result.comparison,
          canonical,
          ...(result.legacy ? { legacy: result.legacy, divergence: result.divergence ?? null } : {}),
        },
        invocations: [
          {
            executionSuccessful: !failed,
            toolExecutionNotifications: diagnostics.map((diagnostic) => ({
              descriptor: { id: 'kern/analysis/canonical-kir-preview' },
              level: failed ? 'error' : 'warning',
              message: { text: diagnosticText(diagnostic) },
              properties: { 'kern/analysis-mode': 'canonical-kir-preview' },
            })),
          },
        ],
      },
    ],
  };
}

function formatKirPreviewText(result: PreviewResult): string {
  const canonical = result.canonical ?? result;
  const lines = [
    `  KERN Review (${result.analysisMode ?? (result.canonical ? 'dual-compare' : 'canonical-kir-preview')})`,
    `  Canonical analysis: ${canonical.status ?? 'unknown'}`,
  ];
  if (typeof result.comparison === 'string') lines.push(`  Comparison: ${result.comparison}`);
  if (result.legacy) lines.push(`  Legacy analysis: ${result.legacy.status ?? 'unknown'}`);
  if (result.divergence) lines.push('  Divergence: canonical and legacy results are retained independently.');
  for (const diagnostic of diagnosticsOf(result)) lines.push(`  Diagnostic: ${diagnosticText(diagnostic)}`);
  return lines.join('\n');
}

export function writeKirPreviewOutput(result: PreviewResult, output: MachineOutput): void {
  if (output === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (output === 'sarif') {
    console.log(JSON.stringify(sarifForKirPreview(result), null, 2));
    return;
  }
  console.log(formatKirPreviewText(result));
}

export function kirPreviewExitCode(result: PreviewResult): number {
  return failedCanonical(result) ? 1 : 0;
}
