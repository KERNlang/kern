import { Project } from 'ts-morph';
import { runTSCDiagnostics } from '../src/external-tools.js';

// kern-guard PR #489 saw ts-morph report TS2339 on KERN runner code:
// "Property 'kind' does not exist on type 'never'" for `parsed.kind`,
// `parsed.callee`, `parsed.args`, etc. The canonical `tsc -b` accepted the
// files. The review-mode Project can over-narrow a parseExpression result after
// the array/record literal guards, so suppress that exact cascade in review mode
// only while keeping real TS2339 diagnostics visible.

function projectWith(source: string, filename = '/runner.ts') {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, target: 99, module: 99, moduleResolution: 100, noEmit: true },
  });
  project.createSourceFile(filename, source);
  return project;
}

const PARSER_EXPRESSION_NEVER_CASCADE = `
type Parsed =
  | { kind: 'arrayLit' }
  | { kind: 'objectLit' }
  | { kind: 'new'; argument: unknown }
  | { kind: 'call'; callee: { kind: 'ident'; name: string }; args: unknown[] }
  | { kind: 'ident'; name: string };

declare function parseExpression(input: string): Parsed;
declare function isArrayLiteralExpression(node: Parsed): node is Extract<Parsed, { kind: 'arrayLit' }>;
declare function isRecordLiteralExpression(node: Parsed): node is Exclude<Parsed, { kind: 'arrayLit' }>;
declare function evalRecordArrayFieldReferenceValue(node: Parsed): readonly unknown[] | undefined;

export function run(raw: string): unknown {
  const parsed: Parsed = (parseExpression(raw) as Parsed);
  const recordArrayFieldValue = evalRecordArrayFieldReferenceValue(parsed);
  const value = isArrayLiteralExpression(parsed)
    ? []
    : isRecordLiteralExpression(parsed)
      ? {}
      : recordArrayFieldValue !== undefined
        ? recordArrayFieldValue
        : parsed.kind === 'new'
          ? parsed.argument
          : parsed.kind === 'call'
            ? parsed.callee.name
            : parsed.kind === 'ident'
              ? parsed.name
              : null;
  return value;
}
`;

const EXHAUSTIVE_NEVER_BRANCH = `
type Parsed = { kind: 'arrayLit' } | { kind: 'objectLit' };

declare function parseExpression(input: string): Parsed;
declare function isArrayLiteralExpression(node: Parsed): node is Extract<Parsed, { kind: 'arrayLit' }>;
declare function isRecordLiteralExpression(node: Parsed): node is Extract<Parsed, { kind: 'objectLit' }>;
declare function evalRecordArrayFieldReferenceValue(node: Parsed): readonly unknown[] | undefined;

export function run(raw: string): unknown {
  const parsed = parseExpression(raw);
  evalRecordArrayFieldReferenceValue(parsed);
  if (isArrayLiteralExpression(parsed)) return [];
  if (isRecordLiteralExpression(parsed)) return {};
  return parsed.kind;
}
`;

const EXHAUSTIVE_AFTER_RUNTIME_KIND_GUARDS = `
type Parsed =
  | { kind: 'arrayLit' }
  | { kind: 'objectLit' }
  | { kind: 'new'; argument: unknown }
  | { kind: 'call'; callee: { kind: 'ident'; name: string }; args: unknown[] }
  | { kind: 'ident'; name: string };

declare function parseExpression(input: string): Parsed;
declare function isArrayLiteralExpression(node: Parsed): node is Extract<Parsed, { kind: 'arrayLit' }>;
declare function isRecordLiteralExpression(node: Parsed): node is Extract<Parsed, { kind: 'objectLit' }>;
declare function evalRecordArrayFieldReferenceValue(node: Parsed): readonly unknown[] | undefined;

export function run(raw: string): unknown {
  const parsed = parseExpression(raw);
  evalRecordArrayFieldReferenceValue(parsed);
  if (isArrayLiteralExpression(parsed)) return [];
  if (isRecordLiteralExpression(parsed)) return {};
  if (parsed.kind === 'new') return parsed.argument;
  if (parsed.kind === 'call') return parsed.args;
  if (parsed.kind === 'ident') return parsed.name;
  return parsed.kind;
}
`;

describe('runTSCDiagnostics — parseExpression never-narrowing noise (kern-guard PR #489)', () => {
  it('suppresses the review-mode TS2339 never cascade on parseExpression values', () => {
    const findings = runTSCDiagnostics(projectWith(PARSER_EXPRESSION_NEVER_CASCADE), {
      downgradeProjectLoadingErrors: true,
    });

    expect(findings.filter((f) => f.ruleId === 'ts2339' && /type 'never'/.test(f.message))).toEqual([]);
  });

  it('STILL surfaces the same TS2339 cascade in lint mode', () => {
    const findings = runTSCDiagnostics(projectWith(PARSER_EXPRESSION_NEVER_CASCADE), {
      downgradeProjectLoadingErrors: false,
    });

    expect(findings.some((f) => f.ruleId === 'ts2339' && /type 'never'/.test(f.message))).toBe(true);
  });

  it('STILL surfaces unrelated TS2339 never diagnostics in review mode', () => {
    const findings = runTSCDiagnostics(
      projectWith(`
        declare const impossible: never;
        export const value = impossible.kind;
      `),
      { downgradeProjectLoadingErrors: true },
    );

    expect(findings.some((f) => f.ruleId === 'ts2339' && /type 'never'/.test(f.message))).toBe(true);
  });

  it('STILL surfaces an exhaustive parseExpression branch without the record-array-field cascade', () => {
    const findings = runTSCDiagnostics(projectWith(EXHAUSTIVE_NEVER_BRANCH), {
      downgradeProjectLoadingErrors: true,
    });

    expect(findings.some((f) => f.ruleId === 'ts2339' && /type 'never'/.test(f.message))).toBe(true);
  });

  it('STILL surfaces a later exhaustive parseExpression branch after runtime-kind guards', () => {
    const findings = runTSCDiagnostics(projectWith(EXHAUSTIVE_AFTER_RUNTIME_KIND_GUARDS), {
      downgradeProjectLoadingErrors: true,
    });

    expect(findings.some((f) => f.ruleId === 'ts2339' && /type 'never'/.test(f.message))).toBe(true);
  });
});
