import type { IRNode, ParseDiagnostic, SchemaViolation, SemanticViolation } from '@kernlang/core';
import {
  decompile,
  emitNativeKernBodyTS,
  generateCoreNode,
  importTypeScript,
  parseDocumentWithDiagnostics,
  validateSchema,
  validateSemantics,
} from '@kernlang/core';
import { execFileSync } from 'child_process';
import type { Dirent } from 'fs';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { inspect, isDeepStrictEqual } from 'util';
import { createContext, Script } from 'vm';

export type NativeKernTestStatus = 'passed' | 'failed' | 'warning';
export type NativeKernTestSeverity = 'error' | 'warn';

export interface NativeKernTestResult {
  suite: string;
  caseName: string;
  ruleId: string;
  assertion: string;
  severity: NativeKernTestSeverity;
  status: NativeKernTestStatus;
  message?: string;
  file?: string;
  line?: number;
  col?: number;
}

export interface NativeKernTestCoverageMetric {
  total: number;
  covered: number;
  percent: number;
  uncovered: string[];
}

export interface NativeKernTestCoverageTarget {
  file: string;
  transitions: NativeKernTestCoverageMetric;
  guards: NativeKernTestCoverageMetric;
  routes: NativeKernTestCoverageMetric;
  tools: NativeKernTestCoverageMetric;
  effects: NativeKernTestCoverageMetric;
}

export interface NativeKernTestCoverageSummary {
  total: number;
  covered: number;
  percent: number;
  transitions: NativeKernTestCoverageMetric;
  guards: NativeKernTestCoverageMetric;
  routes: NativeKernTestCoverageMetric;
  tools: NativeKernTestCoverageMetric;
  effects: NativeKernTestCoverageMetric;
  targets: NativeKernTestCoverageTarget[];
}

export interface NativeKernTestSummary {
  file: string;
  targetFiles: string[];
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  results: NativeKernTestResult[];
  coverage: NativeKernTestCoverageSummary;
}

export interface NativeKernTestRunSummary {
  input: string;
  testFiles: string[];
  targetFiles: string[];
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  files: NativeKernTestSummary[];
  coverage: NativeKernTestCoverageSummary;
}

export interface NativeKernTestBaselineEntry {
  suite: string;
  caseName: string;
  ruleId: string;
  assertion: string;
  signature?: string;
  message?: string;
}

export interface NativeKernTestBaseline {
  version: 1;
  warnings: NativeKernTestBaselineEntry[];
}

export interface NativeKernTestBaselineCheck {
  ok: boolean;
  knownWarnings: NativeKernTestBaselineEntry[];
  newWarnings: NativeKernTestBaselineEntry[];
  staleWarnings: NativeKernTestBaselineEntry[];
}

export interface NativeKernTestOptions {
  grep?: string | RegExp;
  bail?: boolean;
  passWithNoTests?: boolean;
}

export type NativeKernTestFormat = 'default' | 'compact';

export interface NativeKernTestFormatOptions {
  format?: NativeKernTestFormat;
}

export interface NativeKernTestRule {
  ruleId: string;
  description: string;
  presets?: string[];
}

interface LoadedKernDocument {
  file: string;
  root?: IRNode;
  diagnostics: ParseDiagnostic[];
  schemaViolations: SchemaViolation[];
  semanticViolations: SemanticViolation[];
  readError?: string;
}

interface CollectedAssertion {
  suite: string;
  caseName: string;
  node: IRNode;
  fixtures: RuntimeBinding[];
  mocks: RuntimeEffectMock[];
}

interface EvaluatedAssertion {
  ruleId: string;
  assertion: string;
  passed: boolean;
  severity?: NativeKernTestSeverity;
  message?: string;
}

interface NativeKernAssertionContext {
  assertions: CollectedAssertion[];
  testFile?: string;
  fixtures?: RuntimeBinding[];
  mocks?: RuntimeEffectMock[];
  mockCalls?: Map<string, number>;
  checkedMocks?: Set<string>;
}

interface RuntimeBinding {
  name: string;
  expr: string;
  kind: 'expr' | 'fixture' | 'fn' | 'class' | 'native' | 'workflow';
  eager?: boolean;
  line?: number;
}

interface RuntimeBindingOrder {
  ordered: RuntimeBinding[];
  error?: string;
}

interface RuntimeEffectMock {
  id: string;
  effect: string;
  returns?: string;
  throws?: string;
  line?: number;
  col?: number;
}

interface NativeTestCaseRow {
  node: IRNode;
  fixtures: RuntimeBinding[];
  mocks: RuntimeEffectMock[];
  label: string;
}

type RuntimeWorkflowKind = 'route' | 'tool';

interface RuntimeWorkflowProgramOptions {
  mocks?: RuntimeEffectMock[];
  kind?: RuntimeWorkflowKind;
}

interface RuntimeGuardOptions {
  portable?: boolean;
  targetParam?: string;
  trackCoverage?: boolean;
}

type RuntimeEvalResult = { ok: true; value: unknown } | { ok: false; error: unknown };

type EncodedRuntimeValue =
  | { type: 'json'; value: unknown }
  | { type: 'undefined' }
  | { type: 'number'; value: 'NaN' | 'Infinity' | '-Infinity' }
  | { type: 'bigint'; value: string }
  | { type: 'unserializable'; value: string };

interface EncodedRuntimeError {
  name?: string;
  message?: string;
  stack?: string;
}

const DISCOVERY_SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'generated',
  'node_modules',
]);

const NATIVE_TEST_PRESETS: Record<string, string[]> = {
  apisafety: ['duplicateRoutes', 'emptyRoutes', 'unvalidatedRoutes', 'unguardedEffects', 'uncheckedRoutePathParams'],
  coverage: ['untestedTransitions', 'untestedGuards', 'untestedRoutes', 'untestedTools', 'untestedEffects'],
  effects: ['unguardedEffects', 'sensitiveEffectsRequireAuth', 'effectWithoutCleanup', 'unrecoveredAsync'],
  guard: ['invalidGuards', 'weakGuards', 'nonExhaustiveGuards'],
  machine: ['deadStates', 'duplicateTransitions'],
  mcpsafety: ['duplicateParams', 'invalidGuards', 'unguardedToolParams', 'missingPathGuards', 'ssrfRisks'],
  strict: [
    'duplicateNames',
    'duplicateRoutes',
    'emptyRoutes',
    'duplicateTransitions',
    'deadStates',
    'deriveCycles',
    'codegenErrors',
    'invalidGuards',
    'nonExhaustiveGuards',
    'unvalidatedRoutes',
    'unguardedEffects',
    'weakGuards',
    'duplicateParams',
    'unguardedToolParams',
    'missingPathGuards',
    'ssrfRisks',
    'sensitiveEffectsRequireAuth',
    'uncheckedRoutePathParams',
    'effectWithoutCleanup',
    'unrecoveredAsync',
  ],
};

const NATIVE_KERN_TEST_RULES: NativeKernTestRule[] = [
  { ruleId: 'file:validates', description: 'The native test file itself can be read, parsed, and schema validated.' },
  { ruleId: 'suite:hasassertions', description: 'Every native test suite contains at least one expect assertion.' },
  {
    ruleId: 'machine:reaches',
    description: 'A machine can reach the requested state, optionally through an explicit transition path.',
  },
  {
    ruleId: 'machine:transition',
    description: 'A machine declares a named transition with optional from/to/guarded constraints.',
  },
  { ruleId: 'guard:exhaustive', description: 'A guard covers every variant of the referenced union type.' },
  {
    ruleId: 'kern:node',
    description: 'A target KERN node exists and optionally matches child-count or prop-value constraints.',
  },
  {
    ruleId: 'expr',
    description:
      'Evaluate a constrained runtime expression against target const/derive bindings, with optional equals/matches/throws comparators.',
  },
  {
    ruleId: 'runtime:behavior',
    description: 'Evaluate a constrained pure fn or derive assertion with scoped native test fixtures.',
  },
  {
    ruleId: 'runtime:route',
    description: 'Evaluate a portable route workflow with request fixtures before backend code generation.',
  },
  {
    ruleId: 'runtime:tool',
    description: 'Evaluate a portable MCP tool workflow with input fixtures before backend code generation.',
  },
  {
    ruleId: 'runtime:effect',
    description: 'Evaluate a deterministic portable effect/recover workflow before backend code generation.',
  },
  {
    ruleId: 'mock:called',
    description: 'Assert how many times a scoped native effect mock was actually invoked.',
  },
  {
    ruleId: 'import',
    description: 'Assert that a TypeScript fixture imports to expected KERN source and optionally recompiles.',
  },
  {
    ruleId: 'has:invariant',
    description: 'Assert that an intentionally bad target KERN file contains the requested native invariant failure.',
  },
  { ruleId: 'expect:unsupported', description: 'The expect assertion shape is not supported by native kern test.' },
  { ruleId: 'preset:unknown', description: 'The requested preset name is unknown.' },
  { ruleId: 'no:schemaviolations', description: 'The target KERN file has no schema violations.' },
  { ruleId: 'no:semanticviolations', description: 'The target KERN file has no semantic validation violations.' },
  {
    ruleId: 'no:codegenerrors',
    description: 'The target KERN file can be passed through core code generation without generator errors.',
  },
  { ruleId: 'no:derivecycles', description: 'The target derive graph has no cycles.' },
  { ruleId: 'no:deadstates', description: 'Machines have no unreachable states.', presets: ['machine'] },
  {
    ruleId: 'no:duplicatetransitions',
    description: 'Machines do not declare duplicate transition names.',
    presets: ['machine'],
  },
  {
    ruleId: 'no:duplicatenames',
    description: 'Sibling declarations do not reuse the same type/name pair.',
    presets: ['strict'],
  },
  {
    ruleId: 'no:duplicateroutes',
    description: 'API/server routes do not duplicate method and path.',
    presets: ['apiSafety', 'strict'],
  },
  {
    ruleId: 'no:emptyroutes',
    description: 'Routes declare executable behavior with handler/respond/derive/fmt/branch/each/collect/effect.',
    presets: ['apiSafety', 'strict'],
  },
  {
    ruleId: 'no:unvalidatedroutes',
    description: 'Mutating routes have schema, validation, guard, or auth coverage.',
    presets: ['apiSafety', 'strict'],
  },
  {
    ruleId: 'no:uncheckedroutepathparams',
    description: 'Route path params are declared, validated, or guarded.',
    presets: ['apiSafety', 'strict'],
  },
  { ruleId: 'no:rawhandlers', description: 'Raw handler escapes are absent when a suite forbids them.' },
  {
    ruleId: 'no:invalidguards',
    description: 'Guards reference valid params and have valid guard configuration.',
    presets: ['guard', 'mcpSafety', 'strict'],
  },
  {
    ruleId: 'no:weakguards',
    description: 'Expression guards include an else branch, handler, or typed security kind.',
    presets: ['guard', 'strict'],
  },
  {
    ruleId: 'no:nonexhaustiveguards',
    description: 'Variant guards that declare covered cases cover every variant of their union.',
    presets: ['guard', 'strict'],
  },
  {
    ruleId: 'no:duplicateparams',
    description: 'Parameter containers do not declare duplicate params.',
    presets: ['mcpSafety', 'strict'],
  },
  {
    ruleId: 'no:unguardedtoolparams',
    description: 'Required tool params have param-specific guard coverage.',
    presets: ['mcpSafety', 'strict'],
  },
  {
    ruleId: 'no:missingpathguards',
    description: 'Path-like params have path containment guards.',
    presets: ['mcpSafety', 'strict'],
  },
  {
    ruleId: 'no:ssrfrisks',
    description: 'URL-like params and network effects have URL/host allowlist coverage.',
    presets: ['mcpSafety', 'strict'],
  },
  {
    ruleId: 'no:unguardedeffects',
    description: 'Detected effects have guard, auth, or validation coverage.',
    presets: ['apiSafety', 'effects', 'strict'],
  },
  {
    ruleId: 'no:sensitiveeffectsrequireauth',
    description: 'Sensitive detected effects have auth coverage.',
    presets: ['effects', 'strict'],
  },
  {
    ruleId: 'no:effectwithoutcleanup',
    description: 'Effect blocks that need cleanup define cleanup handlers.',
    presets: ['effects', 'strict'],
  },
  {
    ruleId: 'no:unrecoveredasync',
    description: 'Async blocks with handlers define recovery behavior.',
    presets: ['effects', 'strict'],
  },
  {
    ruleId: 'no:untestedtransitions',
    description: 'Machine transitions are covered by native reachability assertions.',
    presets: ['coverage'],
  },
  {
    ruleId: 'no:untestedguards',
    description: 'Guards are covered by exhaustive or guard-preset assertions.',
    presets: ['coverage'],
  },
  {
    ruleId: 'no:untestedroutes',
    description: 'Routes are covered by native route workflow assertions.',
    presets: ['coverage'],
  },
  {
    ruleId: 'no:untestedtools',
    description: 'MCP tools are covered by native tool workflow assertions.',
    presets: ['coverage'],
  },
  {
    ruleId: 'no:untestedeffects',
    description: 'Deterministic KERN effects are covered by native effect assertions.',
    presets: ['coverage'],
  },
];

export function listNativeKernTestRules(): NativeKernTestRule[] {
  return NATIVE_KERN_TEST_RULES.map((rule) => ({
    ...rule,
    ...(rule.presets ? { presets: [...rule.presets] } : {}),
  }));
}

export function explainNativeKernTestRule(ruleId: string): NativeKernTestRule | undefined {
  const normalized = ruleId.includes(':') ? ruleId.toLowerCase() : invariantRuleId(ruleId);
  return listNativeKernTestRules().find((rule) => rule.ruleId === normalized);
}

function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function getChildren(node: IRNode, type: string): IRNode[] {
  return (node.children || []).filter((child) => child.type === type);
}

function exprToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '__expr' in value) {
    const expr = value as { code?: unknown };
    if (typeof expr.code === 'string') return expr.code;
  }
  return '';
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 'true';
}

function isJsStringLiteralSource(value: string): boolean {
  return /^'(?:\\[\s\S]|[^'\\])*'$/.test(value) || /^"(?:\\[\s\S]|[^"\\])*"$/.test(value);
}

function exprPropToRuntimeSource(node: IRNode, propName: string): string {
  const props = getProps(node);
  const value = props[propName];
  if (value === undefined || value === '') return '';
  if (node.__quotedProps?.includes(propName)) {
    const source = String(value);
    return isJsStringLiteralSource(source) ? source : JSON.stringify(value);
  }
  return exprToString(value);
}

function rawPropToRuntimeSource(node: IRNode, propName: string): string {
  const props = getProps(node);
  const value = props[propName];
  if (value === undefined || value === '') return '';
  const expr = exprToString(value);
  return expr || String(value);
}

function stringLiteralOrExprPropToRuntimeSource(node: IRNode, propName: string): string {
  const props = getProps(node);
  const value = props[propName];
  if (value === undefined || value === '') return '';
  if (value && typeof value === 'object' && '__expr' in value) return exprToString(value);
  const source = String(value);
  return isJsStringLiteralSource(source) ? source : JSON.stringify(source);
}

function runtimeExpectedSource(node: IRNode, propName: string): string | undefined {
  const props = getProps(node);
  const value = props[propName];
  if (value === undefined) return undefined;
  if (value && typeof value === 'object' && '__expr' in value) return exprToString(value);

  const source = String(value);
  if (node.__quotedProps?.includes(propName)) {
    return isJsStringLiteralSource(source) ? source : JSON.stringify(source);
  }

  const trimmed = source.trim();
  if (/^(?:true|false|null)$/.test(trimmed)) return trimmed;
  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return trimmed;
  return JSON.stringify(source);
}

function runtimePatternValue(node: IRNode, propName: string): string | undefined {
  const props = getProps(node);
  const value = props[propName];
  if (value === undefined) return undefined;
  const source = String(value);
  if (node.__quotedProps?.includes(propName) && isJsStringLiteralSource(source)) {
    try {
      const script = new Script(`"use strict";\n(${source});`);
      const evaluated = script.runInContext(createContext(runtimeContext()), {
        timeout: RUNTIME_EXPR_TIMEOUT_MS,
      });
      return String(evaluated);
    } catch {
      return source;
    }
  }
  return source;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectNodes(node: IRNode | undefined, type: string, acc: IRNode[] = []): IRNode[] {
  if (!node) return acc;
  if (node.type === type) acc.push(node);
  for (const child of node.children || []) collectNodes(child, type, acc);
  return acc;
}

function parseList(value: string): string[] {
  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!trimmed) return [];
  return trimmed
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function parseNameList(value: string): string[] {
  return parseList(value).flatMap((part) =>
    part
      .split('|')
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

function normalizeInvariant(value: string): string {
  return value.replace(/[-_\s]/g, '').toLowerCase();
}

function severityFromNode(node: IRNode): NativeKernTestSeverity {
  const severity = str(getProps(node).severity).toLowerCase();
  return severity === 'warn' || severity === 'warning' ? 'warn' : 'error';
}

function statusForEvaluation(passed: boolean, severity: NativeKernTestSeverity): NativeKernTestStatus {
  if (passed) return 'passed';
  return severity === 'warn' ? 'warning' : 'failed';
}

function effectiveSeverity(
  requestedSeverity: NativeKernTestSeverity,
  evaluated: EvaluatedAssertion,
): NativeKernTestSeverity {
  return evaluated.severity || requestedSeverity;
}

function isAssertionConfigurationFailure(message?: string): boolean {
  if (!message) return false;
  return (
    message.startsWith('Unsupported native ') ||
    message.startsWith('Runtime expr assertions ') ||
    message.startsWith('Runtime expr assertion requires ') ||
    message.startsWith('Runtime expr assertion cannot execute ') ||
    message.startsWith('Runtime expr assertion has ') ||
    message.startsWith('Runtime fn assertion ') ||
    message.startsWith('Runtime derive assertion ') ||
    message.startsWith('Runtime behavior assertion ') ||
    message.startsWith('Runtime route assertion cannot ') ||
    message.startsWith('Runtime tool assertion cannot ') ||
    message.startsWith('Runtime effect assertion cannot ') ||
    message.startsWith('Node assertion requires ') ||
    message.startsWith('Node assertion count ') ||
    message === 'Unsupported native expect assertion.' ||
    message.includes(' assertion requires ') ||
    message.includes(' needs over=') ||
    message.startsWith('Machine not found:') ||
    message.startsWith('Guard not found:') ||
    message.startsWith('Union not found') ||
    message.startsWith('State not found in machine ')
  );
}

function grepMatches(options: NativeKernTestOptions | undefined, result: NativeKernTestResult): boolean {
  const grep = options?.grep;
  if (!grep) return true;
  const haystack = [
    result.suite,
    result.caseName,
    result.ruleId,
    result.assertion,
    result.message || '',
    result.file || '',
  ].join('\n');
  if (grep instanceof RegExp) {
    grep.lastIndex = 0;
    return grep.test(haystack);
  }
  return haystack.toLowerCase().includes(grep.toLowerCase());
}

function invariantRuleId(value: string): string {
  return `no:${normalizeInvariant(value) || 'unknown'}`;
}

function hasInvariantRuleId(value: string): string {
  return `has:${normalizeInvariant(value) || 'unknown'}`;
}

function presetRuleId(value: string): string {
  return `preset:${normalizeInvariant(value) || 'unknown'}`;
}

function nodeLabel(node: IRNode): string {
  const props = getProps(node);
  const name = str(props.name);
  const method = str(props.method);
  const path = str(props.path);
  if (method || path) return `${node.type} ${(method || 'GET').toUpperCase()} ${path || '<missing-path>'}`;
  if (name) return `${node.type} ${name}`;
  return node.type;
}

function handlerText(node: IRNode): string {
  return getChildren(node, 'handler')
    .map((handler) => str(getProps(handler).code))
    .filter(Boolean)
    .join('\n');
}

// `handlerText` returns the verbatim `props.code` from each handler child,
// which is what most callers (reach analysis, length checks, regex sniffing)
// want. The runtime-eval path is different: a handler with `lang="kern"`
// stores raw KERN source in `props.code`, not JS. Feeding that to V8 yields
// ReferenceErrors when tests reference symbols whose body is kern-native.
// `runtimeHandlerSource` lowers each kern handler through the same emitter
// the codegen path uses (`emitNativeKernBodyTS`), giving the runner a
// JS body it can wrap and execute.
function runtimeHandlerSource(node: IRNode): string {
  return getChildren(node, 'handler')
    .map((handler) => {
      if (str(getProps(handler).lang) === 'kern') {
        try {
          return emitNativeKernBodyTS(handler);
        } catch {
          return '';
        }
      }
      return str(getProps(handler).code);
    })
    .filter(Boolean)
    .join('\n');
}

function collectNamedHandlerBodies(root: IRNode): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const fn of collectNodes(root, 'fn')) {
    const name = str(getProps(fn).name);
    const code = handlerText(fn);
    if (name && code) bodies.set(name, code);
  }
  return bodies;
}

function reachableHandlerText(root: IRNode, node: IRNode): string {
  const helperBodies = collectNamedHandlerBodies(root);
  const chunks: string[] = [];
  const queue = [handlerText(node)];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() || '';
    if (!current) continue;
    chunks.push(current);

    for (const [name, body] of helperBodies) {
      if (visited.has(name)) continue;
      if (!new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(current)) continue;
      visited.add(name);
      queue.push(body);
    }
  }

  return chunks.join('\n');
}

function hasInlinePermissionGate(node: IRNode): boolean {
  const code = handlerText(node);
  if (!code) return false;
  const declaresPermissionCheck =
    /\b(?:function|const|let)\s+checkPermission\b/.test(code) ||
    /\bcheckPermission\s*[:=]\s*(?:async\s*)?\(/.test(code);
  if (!declaresPermissionCheck) return false;
  const returnsPermissionCheck = /\breturn\s*\{[\s\S]*\bcheckPermission\b[\s\S]*\}/.test(code);
  const hasDecisionSignal =
    /\bPermissionDecision\b/.test(code) ||
    /\bpermissionMode\b/.test(code) ||
    /\bbehavior\s*:\s*['"](?:allow|ask|deny)['"]/.test(code);
  return returnsPermissionCheck && hasDecisionSignal;
}

function hasGuardLikeChild(node: IRNode): boolean {
  return (
    (node.children || []).some((child) => ['guard', 'auth', 'validate'].includes(child.type)) ||
    hasInlinePermissionGate(node)
  );
}

function isMultiSourceTransitionFalsePositive(violation: SemanticViolation, root: IRNode): boolean {
  if (violation.rule !== 'machine-transition-from') return false;
  for (const machine of collectNodes(root, 'machine')) {
    const stateNames = new Set(getChildren(machine, 'state').map((state) => str(getProps(state).name)));
    for (const transition of getChildren(machine, 'transition')) {
      if (transition.loc?.line !== violation.line) continue;
      const sources = parseNameList(str(getProps(transition).from));
      if (sources.length > 1 && sources.every((source) => stateNames.has(source))) return true;
    }
  }
  return false;
}

function loadKernDocument(file: string): LoadedKernDocument {
  if (!existsSync(file)) {
    return {
      file,
      diagnostics: [],
      schemaViolations: [],
      semanticViolations: [],
      readError: `Not found: ${file}`,
    };
  }

  const source = readFileSync(file, 'utf-8');
  const parsed = parseDocumentWithDiagnostics(source);
  const schemaViolations = validateSchema(parsed.root);
  const semanticViolations = validateSemantics(parsed.root).filter(
    (violation) => !isMultiSourceTransitionFalsePositive(violation, parsed.root),
  );
  return {
    file,
    root: parsed.root,
    diagnostics: parsed.diagnostics,
    schemaViolations,
    semanticViolations,
  };
}

function firstParseError(doc: LoadedKernDocument): ParseDiagnostic | undefined {
  return doc.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
}

function targetBlockingMessage(doc: LoadedKernDocument): string | undefined {
  if (doc.readError) return doc.readError;

  const parseError = firstParseError(doc);
  if (parseError)
    return `Target has parse error at ${doc.file}:${parseError.line}:${parseError.col}: ${parseError.message}`;

  const schemaViolation = doc.schemaViolations[0];
  if (schemaViolation) {
    return `Target has schema violation at ${doc.file}:${schemaViolation.line ?? 1}:${schemaViolation.col ?? 1}: ${schemaViolation.message}`;
  }

  return undefined;
}

function issueResult(file: string, message: string, issue?: { line?: number; col?: number }): NativeKernTestResult {
  return {
    suite: 'native test',
    caseName: 'file validates',
    ruleId: 'file:validates',
    assertion: 'parse/schema validity',
    severity: 'error',
    status: 'failed',
    message,
    file,
    line: issue?.line,
    col: issue?.col,
  };
}

function runtimeFixtureBinding(node: IRNode): RuntimeBinding | undefined {
  const props = getProps(node);
  const name = str(props.name);
  const expr = exprPropToRuntimeSource(node, 'value') || exprPropToRuntimeSource(node, 'expr');
  if (!name || !expr) return undefined;
  return { name, expr, kind: 'fixture', line: node.loc?.line };
}

function runtimeFixtureBindings(node: IRNode): RuntimeBinding[] {
  return getChildren(node, 'fixture')
    .map((fixture) => runtimeFixtureBinding(fixture))
    .filter((fixture): fixture is RuntimeBinding => fixture !== undefined);
}

function runtimeEffectMock(node: IRNode, id: string): RuntimeEffectMock | undefined {
  const props = getProps(node);
  const effect = str(props.effect);
  const returns = runtimeExpectedSource(node, 'returns');
  const throws = props.throws === undefined ? undefined : String(props.throws || 'true');
  if (!effect || (returns === undefined && throws === undefined)) return undefined;
  return { id, effect, returns, throws, line: node.loc?.line, col: node.loc?.col };
}

function collectAssertions(testNode: IRNode): CollectedAssertion[] {
  const suite = str(getProps(testNode).name) || 'unnamed test';
  const assertions: CollectedAssertion[] = [];
  let mockId = 0;
  const caseMergeProps = new Set([
    'args',
    'with',
    'input',
    'equals',
    'returns',
    'recovers',
    'fallback',
    'matches',
    'throws',
    'called',
    'message',
    'severity',
  ]);

  function runtimeEffectMocks(node: IRNode): RuntimeEffectMock[] {
    return getChildren(node, 'mock')
      .map((mock) => runtimeEffectMock(mock, `mock:${mockId++}`))
      .filter((mock): mock is RuntimeEffectMock => mock !== undefined);
  }

  function testCaseRows(node: IRNode, fixtures: RuntimeBinding[], mocks: RuntimeEffectMock[]): NativeTestCaseRow[] {
    return getChildren(node, 'case').map((caseNode, index) => {
      const label = str(getProps(caseNode).name) || `case ${index + 1}`;
      return {
        node: caseNode,
        fixtures: [...fixtures, ...runtimeFixtureBindings(caseNode)],
        mocks: [...mocks, ...runtimeEffectMocks(caseNode)],
        label,
      };
    });
  }

  function expectationForCase(expectNode: IRNode, caseNode: IRNode): IRNode {
    const mergedProps = { ...getProps(expectNode) };
    const quotedProps = new Set(expectNode.__quotedProps || []);
    const caseQuotedProps = new Set(caseNode.__quotedProps || []);

    for (const [key, value] of Object.entries(getProps(caseNode))) {
      if (!caseMergeProps.has(key)) continue;
      mergedProps[key] = value;
      if (caseQuotedProps.has(key)) quotedProps.add(key);
      else quotedProps.delete(key);
    }

    return {
      ...expectNode,
      props: mergedProps,
      __quotedProps: [...quotedProps],
      loc: caseNode.loc || expectNode.loc,
      children: (expectNode.children || []).filter((child) => child.type !== 'case'),
    };
  }

  function pushExpectation(
    node: IRNode,
    path: string[],
    fixtures: RuntimeBinding[],
    mocks: RuntimeEffectMock[],
    cases: NativeTestCaseRow[] = [],
  ): void {
    if (cases.length > 0) {
      for (const testCase of cases) {
        assertions.push({
          suite,
          caseName: [...path, testCase.label].join(' > '),
          node: expectationForCase(node, testCase.node),
          fixtures: testCase.fixtures,
          mocks: testCase.mocks,
        });
      }
      return;
    }

    assertions.push({
      suite,
      caseName: path.length > 0 ? path.join(' > ') : 'top-level',
      node,
      fixtures,
      mocks,
    });
  }

  function visit(node: IRNode, path: string[], fixtures: RuntimeBinding[], mocks: RuntimeEffectMock[]): void {
    const scopedFixtures = [...fixtures, ...runtimeFixtureBindings(node)];
    const scopedMocks = [...mocks, ...runtimeEffectMocks(node)];

    if (node.type === 'expect') {
      pushExpectation(node, path, scopedFixtures, scopedMocks, testCaseRows(node, scopedFixtures, scopedMocks));
      return;
    }

    if (node.type === 'it') {
      const nextPath = [...path, str(getProps(node).name) || 'it'];
      const scopedCases = testCaseRows(node, scopedFixtures, scopedMocks);
      for (const child of node.children || []) {
        if (child.type === 'expect') {
          const expectCases = testCaseRows(child, scopedFixtures, scopedMocks);
          pushExpectation(
            child,
            nextPath,
            scopedFixtures,
            scopedMocks,
            expectCases.length > 0 ? expectCases : scopedCases,
          );
        }
      }
      return;
    }

    if (node.type === 'describe') {
      const nextPath = [...path, str(getProps(node).name) || 'describe'];
      for (const child of node.children || []) visit(child, nextPath, scopedFixtures, scopedMocks);
      return;
    }

    for (const child of node.children || []) visit(child, path, scopedFixtures, scopedMocks);
  }

  visit(testNode, [], [], []);
  return assertions;
}

function assertionLabel(node: IRNode): string {
  const props = getProps(node);
  const preset = str(props.preset);
  const nodeType = str(props.node);
  const name = str(props.name);
  const prop = str(props.prop);
  const isValue = props.is === undefined ? '' : exprToString(props.is) || String(props.is);
  const child = str(props.child);
  const childName = str(props.childName);
  const count = props.count === undefined ? '' : String(props.count);
  const machine = str(props.machine);
  const transition = str(props.transition);
  const from = str(props.from);
  const to = str(props.to);
  const reaches = str(props.reaches);
  const no = str(props.no);
  const has = str(props.has);
  const guard = str(props.guard);
  const expr = exprToString(props.expr);
  const fn = str(props.fn);
  const derive = str(props.derive);
  const route = str(props.route);
  const tool = str(props.tool);
  const effect = str(props.effect);
  const mock = str(props.mock);
  const importAssertion = 'import' in props;
  const importSource = importAssertionSourcePath(node);
  const codegen = 'codegen' in props;
  const decompileAssertion = 'decompile' in props;
  const roundtrip = 'roundtrip' in props;
  const args = exprToString(props.args);
  const withValue = exprToString(props.with);
  const input = exprToString(props.input);
  const equals = props.equals === undefined ? '' : exprToString(props.equals) || String(props.equals);
  const returns = props.returns === undefined ? '' : exprToString(props.returns) || String(props.returns);
  const fallback = props.fallback === undefined ? '' : exprToString(props.fallback) || String(props.fallback);
  const recovers = props.recovers === undefined ? '' : String(props.recovers || 'true');
  const contains = props.contains === undefined ? '' : String(props.contains);
  const notContains = props.notContains === undefined ? '' : String(props.notContains);
  const matches = props.matches === undefined ? '' : String(props.matches);
  const unmapped = props.unmapped === undefined ? '' : String(props.unmapped);
  const throws = props.throws === undefined ? '' : String(props.throws || 'true');
  const called = props.called === undefined ? '' : String(props.called);

  if (importAssertion) {
    const parts = [`import${importSource ? ` ${importSource}` : ''}`];
    if (contains) parts.push(`contains ${contains}`);
    if (notContains) parts.push(`notContains ${notContains}`);
    if (matches) parts.push(`matches ${matches}`);
    if (roundtrip) parts.push('roundtrip');
    if (unmapped) parts.push(`unmapped ${unmapped}`);
    if (no === 'unmapped') parts.push('no unmapped');
    return parts.join(' ');
  }
  if (decompileAssertion) {
    const parts = ['decompile'];
    if (contains) parts.push(`contains ${contains}`);
    if (notContains) parts.push(`notContains ${notContains}`);
    if (matches) parts.push(`matches ${matches}`);
    return parts.join(' ');
  }
  if (roundtrip) return 'roundtrip';
  if (codegen) {
    const parts = ['codegen'];
    if (contains) parts.push(`contains ${contains}`);
    if (notContains) parts.push(`notContains ${notContains}`);
    if (matches) parts.push(`matches ${matches}`);
    return parts.join(' ');
  }
  if (preset) return `preset ${preset}`;
  if (nodeType) {
    const parts = [`node ${nodeType}`];
    if (name) parts.push(name);
    if (child) parts.push(`has ${child}${childName ? ` ${childName}` : ''}`);
    if (prop) parts.push(`prop ${prop}${isValue ? ` is ${isValue}` : ''}`);
    if (count) parts.push(`count ${count}`);
    return parts.join(' ');
  }
  if (no) return `${machine ? `machine ${machine} ` : ''}no ${no}`;
  if (has) {
    return `${machine ? `machine ${machine} ` : ''}has ${has}${count ? ` count ${count}` : ''}${matches ? ` matches ${matches}` : ''}`;
  }
  if (guard) return `guard ${guard} exhaustive`;
  if (machine && transition) {
    return [`machine ${machine} transition ${transition}`, from ? `from ${from}` : '', to ? `to ${to}` : '']
      .filter(Boolean)
      .join(' ');
  }
  if (machine || reaches) {
    return [`machine ${machine || '<missing>'}`, from ? `from ${from}` : '', `reaches ${reaches || '<missing>'}`]
      .filter(Boolean)
      .join(' ');
  }
  if (fn) {
    const parts = [`fn ${fn}`];
    if (args) parts.push(`args ${args}`);
    if (withValue) parts.push(`with ${withValue}`);
    if (equals) parts.push(`equals ${equals}`);
    if (matches) parts.push(`matches ${matches}`);
    if (throws) parts.push(`throws ${throws}`);
    return parts.join(' ');
  }
  if (derive) {
    const parts = [`derive ${derive}`];
    if (equals) parts.push(`equals ${equals}`);
    if (matches) parts.push(`matches ${matches}`);
    if (throws) parts.push(`throws ${throws}`);
    return parts.join(' ');
  }
  if (route) {
    const parts = [`route ${route}`];
    if (withValue) parts.push(`with ${withValue}`);
    if (input) parts.push(`input ${input}`);
    if (returns) parts.push(`returns ${returns}`);
    if (equals) parts.push(`equals ${equals}`);
    if (matches) parts.push(`matches ${matches}`);
    if (throws) parts.push(`throws ${throws}`);
    return parts.join(' ');
  }
  if (tool) {
    const parts = [`tool ${tool}`];
    if (withValue) parts.push(`with ${withValue}`);
    if (input) parts.push(`input ${input}`);
    if (returns) parts.push(`returns ${returns}`);
    if (equals) parts.push(`equals ${equals}`);
    if (matches) parts.push(`matches ${matches}`);
    if (throws) parts.push(`throws ${throws}`);
    return parts.join(' ');
  }
  if (effect) {
    const parts = [`effect ${effect}`];
    if (returns) parts.push(`returns ${returns}`);
    if (recovers) parts.push(`recovers ${recovers}`);
    if (fallback) parts.push(`fallback ${fallback}`);
    if (equals) parts.push(`equals ${equals}`);
    if (matches) parts.push(`matches ${matches}`);
    if (throws) parts.push(`throws ${throws}`);
    return parts.join(' ');
  }
  if (mock) {
    const parts = [`mock ${mock}`];
    if (called) parts.push(`called ${called}`);
    return parts.join(' ');
  }
  if (expr && equals) return `expr ${expr} equals ${equals}`;
  if (expr && matches) return `expr ${expr} matches ${matches}`;
  if (expr && throws) return `expr ${expr} throws ${throws}`;
  if (expr) return `expr ${expr}`;
  return 'expect';
}

function findDeriveCycles(root: IRNode): string[][] {
  const derives = collectNodes(root, 'derive')
    .map((node) => ({
      name: str(getProps(node).name),
      expr: exprToString(getProps(node).expr),
    }))
    .filter((derive) => derive.name && derive.expr);

  const names = derives.map((derive) => derive.name);
  const graph = new Map<string, string[]>();
  for (const derive of derives) {
    graph.set(
      derive.name,
      names.filter((name) => name !== derive.name && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(derive.expr)),
    );
    if (new RegExp(`\\b${escapeRegExp(derive.name)}\\b`).test(derive.expr)) {
      graph.get(derive.name)!.push(derive.name);
    }
  }

  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function dfs(name: string): void {
    if (visiting.has(name)) {
      const idx = stack.indexOf(name);
      cycles.push([...stack.slice(idx), name]);
      return;
    }
    if (visited.has(name)) return;

    visiting.add(name);
    stack.push(name);
    for (const dep of graph.get(name) || []) dfs(dep);
    stack.pop();
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of names) dfs(name);
  return cycles;
}

function selectedMachines(root: IRNode, machineName?: string): IRNode[] {
  const machines = collectNodes(root, 'machine');
  return machineName ? machines.filter((machine) => str(getProps(machine).name) === machineName) : machines;
}

function findUnreachableStates(root: IRNode, machineName?: string): string[] {
  const failures: string[] = [];
  const machines = selectedMachines(root, machineName);
  if (machineName && machines.length === 0) return [`Machine not found: ${machineName}`];
  for (const machine of machines) {
    const name = str(getProps(machine).name) || '<unnamed>';
    const states = getChildren(machine, 'state').map((state) => ({
      name: str(getProps(state).name),
      initial: isTruthy(getProps(state).initial),
    }));
    const initialState = states.find((state) => state.initial)?.name || states[0]?.name;
    if (!initialState) continue;

    const transitions = getChildren(machine, 'transition').map((transition) => ({
      name: str(getProps(transition).name),
      from: parseNameList(str(getProps(transition).from)),
      to: str(getProps(transition).to),
    }));
    const visited = new Set<string>([initialState]);
    const queue = [initialState];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const transition of transitions.filter((candidate) => candidate.from.includes(current))) {
        if (visited.has(transition.to)) continue;
        visited.add(transition.to);
        queue.push(transition.to);
      }
    }

    const unreachable = states.map((state) => state.name).filter((state) => state && !visited.has(state));
    if (unreachable.length > 0) failures.push(`${name}: ${unreachable.join(', ')}`);
  }
  return failures;
}

function findDuplicateTransitions(root: IRNode, machineName?: string): string[] {
  const failures: string[] = [];
  const machines = selectedMachines(root, machineName);
  if (machineName && machines.length === 0) return [`Machine not found: ${machineName}`];
  for (const machine of machines) {
    const name = str(getProps(machine).name) || '<unnamed>';
    const seen = new Map<string, IRNode>();
    for (const transition of getChildren(machine, 'transition')) {
      const props = getProps(transition);
      const transitionName = str(props.name) || '<unnamed>';
      const sources = parseNameList(str(props.from));
      for (const source of sources) {
        const key = `${source}:${transitionName}`;
        const previous = seen.get(key);
        if (previous) {
          failures.push(
            `${name}: transition '${transitionName}' is duplicated from '${source}' at line ${transition.loc?.line ?? '?'} (first at line ${previous.loc?.line ?? '?'})`,
          );
        } else {
          seen.set(key, transition);
        }
      }
    }
  }
  return failures;
}

function findDuplicateRoutes(root: IRNode): string[] {
  const seen = new Map<string, IRNode>();
  const failures: string[] = [];
  for (const route of collectNodes(root, 'route')) {
    const props = getProps(route);
    const method = (str(props.method) || 'get').toUpperCase();
    const path = str(props.path);
    if (!path) continue;
    const key = `${method} ${path}`;
    const previous = seen.get(key);
    if (previous) {
      failures.push(`${key} at line ${route.loc?.line ?? '?'} (first at line ${previous.loc?.line ?? '?'})`);
    } else {
      seen.set(key, route);
    }
  }
  return failures;
}

function routeHasBehavior(route: IRNode): boolean {
  return ['handler', 'respond', 'derive', 'fmt', 'branch', 'each', 'collect', 'effect'].some(
    (childType) => getChildren(route, childType).length > 0,
  );
}

function findEmptyRoutes(root: IRNode): string[] {
  return collectNodes(root, 'route')
    .filter((route) => !routeHasBehavior(route))
    .map((route) => `${nodeLabel(route)} at line ${route.loc?.line ?? '?'} has no behavior node`);
}

function findDuplicateSiblingNames(root: IRNode): string[] {
  const failures: string[] = [];

  function visit(node: IRNode): void {
    const seen = new Map<string, IRNode>();
    for (const child of node.children || []) {
      const name = str(getProps(child).name);
      if (!name) continue;
      const key = `${child.type}:${name}`;
      const previous = seen.get(key);
      if (previous) {
        failures.push(
          `${nodeLabel(child)} at line ${child.loc?.line ?? '?'} duplicates line ${previous.loc?.line ?? '?'}`,
        );
      } else {
        seen.set(key, child);
      }
    }
    for (const child of node.children || []) visit(child);
  }

  visit(root);
  return failures;
}

function findWeakGuards(root: IRNode): string[] {
  return collectNodes(root, 'guard')
    .filter((guard) => {
      const props = getProps(guard);
      const hasExpr = 'expr' in props;
      const hasSecurityKind = 'kind' in props || 'type' in props;
      const hasElse = 'else' in props;
      const hasHandler = getChildren(guard, 'handler').length > 0;
      return hasExpr && !hasSecurityKind && !hasElse && !hasHandler;
    })
    .map((guard) => `${nodeLabel(guard)} at line ${guard.loc?.line ?? '?'} has expr but no else/handler`);
}

interface EffectClassification {
  kind: 'database' | 'email' | 'fs-read' | 'fs-write' | 'network' | 'shell';
  label: string;
  sensitive: boolean;
}

const EFFECT_PATTERNS: Array<EffectClassification & { re: RegExp }> = [
  {
    kind: 'shell',
    label: 'shell command',
    sensitive: true,
    re: /\b(?:exec|execFile|execFileSync|execSync|spawn|spawnSync)\s*\(/,
  },
  {
    kind: 'network',
    label: 'network request',
    sensitive: true,
    re: /\b(?:fetch|axios|got|request)\s*\(|\bnew\s+WebSocket\s*\(/,
  },
  {
    kind: 'fs-write',
    label: 'filesystem write',
    sensitive: true,
    re: /\b(?:appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rename|renameSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|writeFile|writeFileSync)\s*\(/,
  },
  {
    kind: 'fs-read',
    label: 'filesystem read',
    sensitive: true,
    re: /\b(?:access|accessSync|createReadStream|existsSync|lstat|lstatSync|readFile|readFileSync|readdir|readdirSync|stat|statSync)\s*\(/,
  },
  {
    kind: 'database',
    label: 'database query',
    sensitive: true,
    re: /\b(?:client|collection|connection|database|db|knex|pool|prisma|repo|repository)\s*\.(?:create|delete|execute|findFirst|findMany|findUnique|insert|query|select|update|upsert)\s*\(|(?:^|[^\w.])(?:create|delete|execute|findFirst|findMany|findUnique|query|update|upsert)\s*\(|\bsql\s*`/,
  },
  {
    kind: 'email',
    label: 'email send',
    sensitive: true,
    re: /\b(?:mailer\.send|sendEmail|sendMail|transporter\.send)\s*\(/,
  },
];

function classifyEffect(code: string): EffectClassification | undefined {
  const pattern = EFFECT_PATTERNS.find((candidate) => candidate.re.test(code));
  if (!pattern) return undefined;
  return { kind: pattern.kind, label: pattern.label, sensitive: pattern.sensitive };
}

function findUnguardedEffects(root: IRNode): string[] {
  const checkedTypes = new Set(['action', 'command', 'fn', 'job', 'middleware', 'route', 'tool']);
  const failures: string[] = [];

  function visit(node: IRNode): void {
    if (checkedTypes.has(node.type)) {
      const code = reachableHandlerText(root, node);
      const effect = classifyEffect(code);
      if (effect && !hasGuardLikeChild(node)) {
        failures.push(
          `${nodeLabel(node)} at line ${node.loc?.line ?? '?'} performs ${effect.label} without guard/auth/validate/permission`,
        );
      }
    }
    for (const child of node.children || []) visit(child);
  }

  visit(root);
  return failures;
}

function findUnvalidatedMutatingRoutes(root: IRNode): string[] {
  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  return collectNodes(root, 'route')
    .filter((route) => mutatingMethods.has((str(getProps(route).method) || 'get').toUpperCase()))
    .filter((route) => !hasGuardLikeChild(route) && getChildren(route, 'schema').length === 0)
    .map((route) => `${nodeLabel(route)} at line ${route.loc?.line ?? '?'} mutates without schema/validate/guard/auth`);
}

function findRawHandlerEscapes(root: IRNode): string[] {
  return collectNodes(root, 'handler')
    .filter((handler) => str(getProps(handler).code).trim().length > 0)
    .map((handler) => `handler at line ${handler.loc?.line ?? '?'}`);
}

const PARAM_CONTAINER_TYPES = new Set(['tool', 'resource', 'prompt', 'fn', 'method', 'constructor', 'route']);
const BOUNDED_GUARD_CONTAINER_TYPES = new Set(['tool', 'route', 'resource', 'prompt']);

function parseLegacyParamNames(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim().split('=')[0]?.trim() || '')
    .map(
      (part) =>
        part
          .replace(/[?].*$/, '')
          .split(':')[0]
          ?.trim() || '',
    )
    .filter(Boolean);
}

function declaredParamNames(node: IRNode): Set<string> {
  const names = new Set<string>();
  for (const param of getChildren(node, 'param')) {
    const name = str(getProps(param).name);
    if (name) names.add(name);
  }

  for (const paramsNode of getChildren(node, 'params')) {
    const items = getProps(paramsNode).items;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item && typeof item === 'object' && 'name' in item) {
          const name = str((item as { name?: unknown }).name);
          if (name) names.add(name);
        }
      }
    }
  }

  for (const name of parseLegacyParamNames(str(getProps(node).params))) names.add(name);

  const path = str(getProps(node).path);
  for (const match of path.matchAll(/:([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(match[1]);
  }

  return names;
}

function numericProp(props: Record<string, unknown>, key: string): number | undefined {
  const value = props[key];
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findInvalidGuards(root: IRNode): string[] {
  const failures: string[] = [];

  function visit(node: IRNode, parent?: IRNode): void {
    if (node.type === 'guard') {
      const props = getProps(node);
      const kind = normalizeInvariant(str(props.kind) || str(props.type) || str(props.name));
      const param = str(props.param) || str(props.target) || str(props.field);
      const line = node.loc?.line ?? '?';

      if (param && parent && PARAM_CONTAINER_TYPES.has(parent.type)) {
        const params = declaredParamNames(parent);
        if (!params.has(param)) {
          failures.push(
            `${nodeLabel(node)} at line ${line} references unknown param '${param}' on ${nodeLabel(parent)}`,
          );
        }
      }

      if (
        parent &&
        BOUNDED_GUARD_CONTAINER_TYPES.has(parent.type) &&
        (kind === 'pathcontainment' || kind === 'pathcontainmentguard') &&
        !str(props.allowlist) &&
        !str(props.allow) &&
        !str(props.root) &&
        !str(props.roots)
      ) {
        failures.push(`${nodeLabel(node)} at line ${line} is path containment without allowlist/allow/root/roots`);
      }

      const min = numericProp(props, 'min');
      const max = numericProp(props, 'max');
      if (kind === 'validate' && min !== undefined && max !== undefined && min > max) {
        failures.push(`${nodeLabel(node)} at line ${line} has min ${min} greater than max ${max}`);
      }

      const maxRequests = numericProp(props, 'maxRequests');
      if (kind === 'ratelimit' && maxRequests !== undefined && maxRequests <= 0) {
        failures.push(`${nodeLabel(node)} at line ${line} has maxRequests ${maxRequests}; expected > 0`);
      }

      const windowMs = numericProp(props, 'windowMs');
      if (kind === 'ratelimit' && windowMs !== undefined && windowMs <= 0) {
        failures.push(`${nodeLabel(node)} at line ${line} has windowMs ${windowMs}; expected > 0`);
      }
    }

    for (const child of node.children || []) visit(child, node);
  }

  visit(root);
  return failures;
}

function declaredParamNameList(node: IRNode): string[] {
  const names: string[] = [];
  for (const param of getChildren(node, 'param')) {
    const name = str(getProps(param).name);
    if (name) names.push(name);
  }

  for (const paramsNode of getChildren(node, 'params')) {
    const items = getProps(paramsNode).items;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (item && typeof item === 'object' && 'name' in item) {
          const name = str((item as { name?: unknown }).name);
          if (name) names.push(name);
        }
      }
    }
  }

  names.push(...parseLegacyParamNames(str(getProps(node).params)));
  return names;
}

function guardKind(node: IRNode): string {
  const props = getProps(node);
  return normalizeInvariant(str(props.kind) || str(props.type) || str(props.name));
}

function guardParam(node: IRNode): string {
  const props = getProps(node);
  return str(props.param) || str(props.target) || str(props.field);
}

function guardTargetsParam(node: IRNode, paramName: string): boolean {
  return guardParam(node) === paramName;
}

function paramNodeByName(container: IRNode, paramName: string): IRNode | undefined {
  return getChildren(container, 'param').find((param) => str(getProps(param).name) === paramName);
}

function paramSpecificGuards(container: IRNode, paramName: string): IRNode[] {
  const param = paramNodeByName(container, paramName);
  return [
    ...getChildren(container, 'guard').filter((guard) => guardTargetsParam(guard, paramName)),
    ...(param ? getChildren(param, 'guard') : []),
  ];
}

function hasParamSpecificGuard(container: IRNode, paramName: string): boolean {
  return paramSpecificGuards(container, paramName).length > 0;
}

function isRequiredParam(node: IRNode): boolean {
  return isTruthy(getProps(node).required);
}

function isPathLikeParam(node: IRNode): boolean {
  const props = getProps(node);
  const name = str(props.name).toLowerCase();
  const type = str(props.type).toLowerCase();
  return /(path|file|dir|directory|folder|root)/.test(name) || /(path|file|directory)/.test(type);
}

function isUrlLikeName(value: string): boolean {
  return /(^|[_-])(url|uri|host|hostname|endpoint|baseurl|callback|webhook)([_-]|$)/i.test(value);
}

function hasPathContainmentGuard(container: IRNode, paramName: string): boolean {
  return paramSpecificGuards(container, paramName).some((guard) => {
    const kind = guardKind(guard);
    return kind === 'pathcontainment' || kind === 'pathcontainmentguard' || kind === 'path';
  });
}

function allChildGuards(node: IRNode): IRNode[] {
  const guards: IRNode[] = [];
  for (const child of node.children || []) {
    if (child.type === 'guard') guards.push(child);
    if (child.type === 'param') guards.push(...getChildren(child, 'guard'));
  }
  return guards;
}

function hasAuthLikeChild(node: IRNode): boolean {
  return (node.children || []).some((child) => {
    if (child.type === 'auth') return true;
    if (child.type === 'middleware') {
      const props = getProps(child);
      const names = `${str(props.name)} ${str(props.names)}`.toLowerCase();
      return /\bauth\b|oauth|session|jwt/.test(names);
    }
    if (child.type === 'guard') {
      const kind = guardKind(child);
      return kind === 'auth' || kind === 'oauth' || kind === 'session' || kind === 'jwt';
    }
    return false;
  });
}

function hasAuthorizationLikeGate(node: IRNode): boolean {
  return hasAuthLikeChild(node) || hasInlinePermissionGate(node);
}

function hasUrlAllowlistGuard(node: IRNode, paramName?: string): boolean {
  return allChildGuards(node).some((guard) => {
    if (paramName && guardParam(guard) && !guardTargetsParam(guard, paramName)) return false;
    const props = getProps(guard);
    const kind = guardKind(guard);
    const hasBoundary =
      str(props.allowlist) ||
      str(props.allow) ||
      str(props.host) ||
      str(props.hosts) ||
      str(props.domain) ||
      str(props.domains) ||
      str(props.pattern) ||
      str(props.regex);
    return (
      kind === 'urlallowlist' ||
      kind === 'hostallowlist' ||
      kind === 'domainallowlist' ||
      kind === 'ssrf' ||
      kind === 'allowlist' ||
      Boolean(hasBoundary)
    );
  });
}

function findDuplicateParams(root: IRNode): string[] {
  const failures: string[] = [];
  for (const containerType of PARAM_CONTAINER_TYPES) {
    for (const container of collectNodes(root, containerType)) {
      const seen = new Set<string>();
      for (const name of declaredParamNameList(container)) {
        if (seen.has(name)) {
          failures.push(`${nodeLabel(container)} duplicates param '${name}'`);
        } else {
          seen.add(name);
        }
      }
    }
  }
  return failures;
}

function findUnguardedRequiredToolParams(root: IRNode): string[] {
  const failures: string[] = [];
  for (const containerType of ['tool', 'resource', 'prompt']) {
    for (const container of collectNodes(root, containerType)) {
      for (const param of getChildren(container, 'param')) {
        const name = str(getProps(param).name);
        if (name && isRequiredParam(param) && !hasParamSpecificGuard(container, name)) {
          failures.push(`${nodeLabel(container)} requires param '${name}' without a param-specific guard`);
        }
      }
    }
  }
  return failures;
}

function findMissingPathGuards(root: IRNode): string[] {
  const failures: string[] = [];
  for (const containerType of ['tool', 'resource', 'prompt']) {
    for (const container of collectNodes(root, containerType)) {
      for (const param of getChildren(container, 'param')) {
        const name = str(getProps(param).name);
        if (name && isPathLikeParam(param) && !hasPathContainmentGuard(container, name)) {
          failures.push(`${nodeLabel(container)} path-like param '${name}' lacks pathContainment guard`);
        }
      }
    }
  }
  return failures;
}

function findSsrfRisks(root: IRNode): string[] {
  const failures: string[] = [];
  const checkedTypes = new Set(['action', 'command', 'fn', 'job', 'route', 'tool']);

  function visit(node: IRNode): void {
    if (checkedTypes.has(node.type)) {
      for (const param of getChildren(node, 'param')) {
        const name = str(getProps(param).name);
        if (name && isUrlLikeName(name) && !hasUrlAllowlistGuard(node, name)) {
          failures.push(`${nodeLabel(node)} URL-like param '${name}' lacks URL/host allowlist guard`);
        }
      }

      const code = reachableHandlerText(root, node);
      if (classifyEffect(code)?.kind === 'network' && !hasUrlAllowlistGuard(node)) {
        failures.push(`${nodeLabel(node)} performs network effect without URL/host allowlist guard`);
      }
    }
    for (const child of node.children || []) visit(child);
  }

  visit(root);
  return failures;
}

function findSensitiveEffectsWithoutAuth(root: IRNode): string[] {
  const checkedTypes = new Set(['action', 'command', 'fn', 'job', 'middleware', 'route', 'tool']);
  const failures: string[] = [];

  function visit(node: IRNode): void {
    if (checkedTypes.has(node.type)) {
      const effect = classifyEffect(reachableHandlerText(root, node));
      if (effect?.sensitive && !hasAuthorizationLikeGate(node)) {
        failures.push(`${nodeLabel(node)} performs ${effect.label} without auth/permission`);
      }
    }
    for (const child of node.children || []) visit(child);
  }

  visit(root);
  return failures;
}

function routePathParams(route: IRNode): string[] {
  const path = str(getProps(route).path);
  return [...path.matchAll(/:([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((match) => match[1]);
}

function findUncheckedRoutePathParams(root: IRNode): string[] {
  const failures: string[] = [];
  for (const route of collectNodes(root, 'route')) {
    if (getChildren(route, 'validate').length > 0 || getChildren(route, 'schema').length > 0) continue;
    const declared = new Set(declaredParamNameList(route));
    for (const paramName of routePathParams(route)) {
      if (!declared.has(paramName) && !hasParamSpecificGuard(route, paramName)) {
        failures.push(`${nodeLabel(route)} path param '${paramName}' is not declared, validated, or guarded`);
      }
    }
  }
  return failures;
}

function findEffectsWithoutCleanup(root: IRNode): string[] {
  const needsCleanup = /\b(addEventListener|setInterval|setTimeout|subscribe|watch|fetch|AbortController|WebSocket)\b/;
  return collectNodes(root, 'effect')
    .filter(
      (effect) => needsCleanup.test(reachableHandlerText(root, effect)) && getChildren(effect, 'cleanup').length === 0,
    )
    .map((effect) => `${nodeLabel(effect)} at line ${effect.loc?.line ?? '?'} has side-effect handler without cleanup`);
}

function findUnrecoveredAsync(root: IRNode): string[] {
  return collectNodes(root, 'async')
    .filter((node) => handlerText(node).trim().length > 0 && getChildren(node, 'recover').length === 0)
    .map((node) => `${nodeLabel(node)} at line ${node.loc?.line ?? '?'} has async handler without recover`);
}

function assertionNoInvariant(node: IRNode): string {
  return normalizeInvariant(str(getProps(node).no));
}

function presetInvariantNames(node: IRNode): string[] {
  return (presetInvariants(node) || []).map(normalizeInvariant);
}

function assertionCoversAnyInvariant(node: IRNode, invariants: Set<string>): boolean {
  const no = assertionNoInvariant(node);
  if (no && invariants.has(no)) return true;
  return presetInvariantNames(node).some((invariant) => invariants.has(invariant));
}

function syntheticTarget(root: IRNode): LoadedKernDocument {
  return { file: '<coverage>', root, diagnostics: [], schemaViolations: [], semanticViolations: [] };
}

function testNodeContributesCoverage(node: IRNode): boolean {
  const raw = getProps(node).coverage;
  if (raw === undefined || raw === '') return true;
  if (raw === false) return false;
  const value = String(raw).toLowerCase();
  return !['0', 'false', 'off', 'ignore', 'ignored', 'exclude', 'excluded', 'none'].includes(value);
}

function coveredTransitionsFromAssertion(
  root: IRNode,
  assertion: IRNode,
): { machineName: string; transitions: Set<string> } | undefined {
  const props = getProps(assertion);
  const machineName = str(props.machine);
  if (!machineName || 'no' in props) return undefined;

  const transitionName = str(props.transition);
  if (transitionName) {
    const evaluated = evaluateMachineTransitionAssertion(assertion, syntheticTarget(root));
    return evaluated.passed ? { machineName, transitions: new Set([transitionName]) } : undefined;
  }

  const via = parseList(str(props.via));
  if (!('reaches' in props) || via.length === 0) return undefined;

  const evaluated = evaluateMachineReachability(assertion, syntheticTarget(root));
  return evaluated.passed ? { machineName, transitions: new Set(via) } : undefined;
}

function findUntestedTransitions(
  root: IRNode,
  context: NativeKernAssertionContext | undefined,
  machineName?: string,
): string[] {
  const machines = selectedMachines(root, machineName);
  if (machineName && machines.length === 0) return [`Machine not found: ${machineName}`];

  const coveredByMachine = new Map<string, Set<string>>();
  for (const assertion of context?.assertions || []) {
    const coverage = coveredTransitionsFromAssertion(root, assertion.node);
    if (!coverage || (machineName && coverage.machineName !== machineName)) continue;
    const covered = coveredByMachine.get(coverage.machineName) || new Set<string>();
    for (const transitionName of coverage.transitions) covered.add(transitionName);
    coveredByMachine.set(coverage.machineName, covered);
  }

  const failures: string[] = [];
  for (const machine of machines) {
    const name = str(getProps(machine).name) || '<unnamed>';
    const covered = coveredByMachine.get(name) || new Set<string>();
    for (const transition of getChildren(machine, 'transition')) {
      const transitionName = str(getProps(transition).name);
      if (!transitionName || covered.has(transitionName)) continue;
      failures.push(`${name}.${transitionName} at line ${transition.loc?.line ?? '?'}`);
    }
  }
  return failures;
}

function findUntestedGuards(root: IRNode, context: NativeKernAssertionContext | undefined): string[] {
  const guardCoverageInvariants = new Set([
    'invalidguards',
    'guardmisconfigurations',
    'weakguards',
    'nonexhaustiveguards',
    'guardexhaustiveness',
    'exhaustiveguards',
  ]);
  const assertions = context?.assertions || [];
  if (assertions.some((assertion) => assertionCoversAnyInvariant(assertion.node, guardCoverageInvariants))) return [];

  const covered = coveredGuardKeys(root, assertions);

  return collectNodes(root, 'guard')
    .filter((guard) => !covered.has(runtimeGuardCoverageKey(guard)))
    .map((guard) => {
      const name = str(getProps(guard).name);
      return name
        ? `guard ${name} at line ${guard.loc?.line ?? '?'}`
        : `unnamed guard at line ${guard.loc?.line ?? '?'}`;
    });
}

function coveredGuardKeys(root: IRNode, assertions: CollectedAssertion[]): Set<string> {
  const target = syntheticTarget(root);
  const covered = new Set<string>();

  for (const assertion of assertions) {
    const props = getProps(assertion.node);
    const guardName = str(props.guard);
    if (guardName) {
      for (const guard of collectNodes(root, 'guard')) {
        if (str(getProps(guard).name) === guardName) covered.add(runtimeGuardCoverageKey(guard));
      }
      continue;
    }

    const routeSpec = str(props.route);
    if (routeSpec) {
      const guardCalls = new Map<string, number>();
      const evaluated = evaluateRuntimeRoute(
        assertion.node,
        target,
        assertion.fixtures,
        assertion.mocks,
        new Map<string, number>(),
        undefined,
        guardCalls,
      );
      if (evaluated.passed) {
        for (const [key, count] of guardCalls) if (count > 0) covered.add(key);
      }
      continue;
    }

    const toolName = str(props.tool);
    if (toolName) {
      const guardCalls = new Map<string, number>();
      const evaluated = evaluateRuntimeTool(
        assertion.node,
        target,
        assertion.fixtures,
        assertion.mocks,
        new Map<string, number>(),
        undefined,
        guardCalls,
      );
      if (evaluated.passed) {
        for (const [key, count] of guardCalls) if (count > 0) covered.add(key);
      }
    }
  }

  return covered;
}

function coveredRouteLabels(root: IRNode, assertions: CollectedAssertion[]): Set<string> {
  const target = syntheticTarget(root);
  const covered = new Set<string>();

  for (const assertion of assertions) {
    const routeSpec = str(getProps(assertion.node).route);
    if (!routeSpec) continue;
    const found = findRuntimeRoute(target, routeSpec);
    if (!found.route) continue;
    const evaluated = evaluateRuntimeRoute(
      assertion.node,
      target,
      assertion.fixtures,
      assertion.mocks,
      new Map<string, number>(),
    );
    if (evaluated.passed) covered.add(runtimeRouteLabel(found.route));
  }

  return covered;
}

function routeCoverage(root: IRNode, assertions: CollectedAssertion[]): NativeKernTestCoverageMetric {
  const covered = coveredRouteLabels(root, assertions);
  const routes = collectNodes(root, 'route');
  const uncovered = routes
    .filter((route) => !covered.has(runtimeRouteLabel(route)))
    .map((route) => `route ${runtimeRouteLabel(route)} at line ${route.loc?.line ?? '?'}`);
  return coverageMetric(routes.length, uncovered);
}

function findUntestedRoutes(root: IRNode, context: NativeKernAssertionContext | undefined): string[] {
  return routeCoverage(root, context?.assertions || []).uncovered;
}

function coveredToolNames(root: IRNode, assertions: CollectedAssertion[]): Set<string> {
  const target = syntheticTarget(root);
  const covered = new Set<string>();

  for (const assertion of assertions) {
    const toolName = str(getProps(assertion.node).tool);
    if (!toolName) continue;
    const found = findRuntimeTool(target, toolName);
    if (!found.tool) continue;
    const evaluated = evaluateRuntimeTool(
      assertion.node,
      target,
      assertion.fixtures,
      assertion.mocks,
      new Map<string, number>(),
    );
    if (evaluated.passed) covered.add(runtimeToolName(found.tool));
  }

  return covered;
}

function toolCoverage(root: IRNode, assertions: CollectedAssertion[]): NativeKernTestCoverageMetric {
  const covered = coveredToolNames(root, assertions);
  const tools = collectNodes(root, 'tool');
  const uncovered = tools
    .filter((tool) => !covered.has(runtimeToolName(tool)))
    .map((tool) => `tool ${runtimeToolName(tool)} at line ${tool.loc?.line ?? '?'}`);
  return coverageMetric(tools.length, uncovered);
}

function findUntestedTools(root: IRNode, context: NativeKernAssertionContext | undefined): string[] {
  return toolCoverage(root, context?.assertions || []).uncovered;
}

function runtimeEffectNodes(root: IRNode): IRNode[] {
  return collectNodes(root, 'effect').filter((effect) => {
    const name = str(getProps(effect).name);
    return Boolean(name && getChildren(effect, 'trigger').length > 0);
  });
}

function coveredEffectKeys(root: IRNode, assertions: CollectedAssertion[]): Set<string> {
  const target = syntheticTarget(root);
  const covered = new Set<string>();

  for (const assertion of assertions) {
    const props = getProps(assertion.node);
    const effectName = str(props.effect);
    if (effectName) {
      const found = findRuntimeEffect(target, effectName);
      if (!found.effect) continue;
      const evaluated = evaluateRuntimeEffect(
        assertion.node,
        target,
        assertion.fixtures,
        assertion.mocks,
        new Map<string, number>(),
      );
      if (evaluated.passed) covered.add(runtimeEffectCoverageKey(found.effect));
      continue;
    }

    const routeSpec = str(props.route);
    if (routeSpec) {
      const effectCalls = new Map<string, number>();
      const evaluated = evaluateRuntimeRoute(
        assertion.node,
        target,
        assertion.fixtures,
        assertion.mocks,
        new Map<string, number>(),
        effectCalls,
      );
      if (evaluated.passed) {
        for (const [key, count] of effectCalls) if (count > 0) covered.add(key);
      }
      continue;
    }

    const toolName = str(props.tool);
    if (toolName) {
      const effectCalls = new Map<string, number>();
      const evaluated = evaluateRuntimeTool(
        assertion.node,
        target,
        assertion.fixtures,
        assertion.mocks,
        new Map<string, number>(),
        effectCalls,
      );
      if (evaluated.passed) {
        for (const [key, count] of effectCalls) if (count > 0) covered.add(key);
      }
    }
  }

  return covered;
}

function effectCoverage(root: IRNode, assertions: CollectedAssertion[]): NativeKernTestCoverageMetric {
  const covered = coveredEffectKeys(root, assertions);
  const effects = runtimeEffectNodes(root);
  const uncovered = effects
    .filter((effect) => !covered.has(runtimeEffectCoverageKey(effect)))
    .map((effect) => `effect ${runtimeEffectName(effect)} at line ${effect.loc?.line ?? '?'}`);
  return coverageMetric(effects.length, uncovered);
}

function findUntestedEffects(root: IRNode, context: NativeKernAssertionContext | undefined): string[] {
  return effectCoverage(root, context?.assertions || []).uncovered;
}

function coverageMetric(total: number, uncovered: string[]): NativeKernTestCoverageMetric {
  const covered = Math.max(0, total - uncovered.length);
  return {
    total,
    covered,
    percent: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100,
    uncovered,
  };
}

function combineCoverageMetrics(metrics: NativeKernTestCoverageMetric[]): NativeKernTestCoverageMetric {
  const total = metrics.reduce((sum, metric) => sum + metric.total, 0);
  const uncovered = metrics.flatMap((metric) => metric.uncovered);
  return coverageMetric(total, uncovered);
}

function emptyCoverageSummary(): NativeKernTestCoverageSummary {
  const empty = coverageMetric(0, []);
  return {
    total: 0,
    covered: 0,
    percent: 100,
    transitions: empty,
    guards: empty,
    routes: empty,
    tools: empty,
    effects: empty,
    targets: [],
  };
}

function combineCoverageSummaries(summaries: NativeKernTestCoverageSummary[]): NativeKernTestCoverageSummary {
  const transitions = combineCoverageMetrics(summaries.map((summary) => summary.transitions));
  const guards = combineCoverageMetrics(summaries.map((summary) => summary.guards));
  const routes = combineCoverageMetrics(summaries.map((summary) => summary.routes));
  const tools = combineCoverageMetrics(summaries.map((summary) => summary.tools));
  const effects = combineCoverageMetrics(summaries.map((summary) => summary.effects));
  const total = transitions.total + guards.total + routes.total + tools.total + effects.total;
  const covered = transitions.covered + guards.covered + routes.covered + tools.covered + effects.covered;
  return {
    total,
    covered,
    percent: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100,
    transitions,
    guards,
    routes,
    tools,
    effects,
    targets: summaries.flatMap((summary) => summary.targets),
  };
}

function machineTransitionCoverage(root: IRNode, assertions: CollectedAssertion[]): NativeKernTestCoverageMetric {
  const machines = selectedMachines(root);
  const coveredByMachine = new Map<string, Set<string>>();

  for (const assertion of assertions) {
    const coverage = coveredTransitionsFromAssertion(root, assertion.node);
    if (!coverage) continue;
    const covered = coveredByMachine.get(coverage.machineName) || new Set<string>();
    for (const transitionName of coverage.transitions) covered.add(transitionName);
    coveredByMachine.set(coverage.machineName, covered);
  }

  let total = 0;
  const uncovered: string[] = [];
  for (const machine of machines) {
    const name = str(getProps(machine).name) || '<unnamed>';
    const covered = coveredByMachine.get(name) || new Set<string>();
    for (const transition of getChildren(machine, 'transition')) {
      const transitionName = str(getProps(transition).name);
      if (!transitionName) continue;
      total += 1;
      if (!covered.has(transitionName)) {
        uncovered.push(`${name}.${transitionName} at line ${transition.loc?.line ?? '?'}`);
      }
    }
  }
  return coverageMetric(total, uncovered);
}

function guardCoverage(root: IRNode, assertions: CollectedAssertion[]): NativeKernTestCoverageMetric {
  const guards = collectNodes(root, 'guard');
  const guardCoverageInvariants = new Set([
    'invalidguards',
    'guardmisconfigurations',
    'weakguards',
    'nonexhaustiveguards',
    'guardexhaustiveness',
    'exhaustiveguards',
  ]);
  if (assertions.some((assertion) => assertionCoversAnyInvariant(assertion.node, guardCoverageInvariants))) {
    return coverageMetric(guards.length, []);
  }

  const covered = coveredGuardKeys(root, assertions);
  const uncovered = guards
    .filter((guard) => !covered.has(runtimeGuardCoverageKey(guard)))
    .map((guard) => {
      const name = str(getProps(guard).name);
      return name
        ? `guard ${name} at line ${guard.loc?.line ?? '?'}`
        : `unnamed guard at line ${guard.loc?.line ?? '?'}`;
    });
  return coverageMetric(guards.length, uncovered);
}

function coverageForTarget(target: LoadedKernDocument, assertions: CollectedAssertion[]): NativeKernTestCoverageTarget {
  if (!target.root) {
    return {
      file: target.file,
      transitions: coverageMetric(0, []),
      guards: coverageMetric(0, []),
      routes: coverageMetric(0, []),
      tools: coverageMetric(0, []),
      effects: coverageMetric(0, []),
    };
  }
  return {
    file: target.file,
    transitions: machineTransitionCoverage(target.root, assertions),
    guards: guardCoverage(target.root, assertions),
    routes: routeCoverage(target.root, assertions),
    tools: toolCoverage(target.root, assertions),
    effects: effectCoverage(target.root, assertions),
  };
}

function createCoverageSummary(targets: NativeKernTestCoverageTarget[]): NativeKernTestCoverageSummary {
  const transitions = combineCoverageMetrics(targets.map((target) => target.transitions));
  const guards = combineCoverageMetrics(targets.map((target) => target.guards));
  const routes = combineCoverageMetrics(targets.map((target) => target.routes));
  const tools = combineCoverageMetrics(targets.map((target) => target.tools));
  const effects = combineCoverageMetrics(targets.map((target) => target.effects));
  const total = transitions.total + guards.total + routes.total + tools.total + effects.total;
  const covered = transitions.covered + guards.covered + routes.covered + tools.covered + effects.covered;
  return {
    total,
    covered,
    percent: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100,
    transitions,
    guards,
    routes,
    tools,
    effects,
    targets,
  };
}

function codegenRoots(root: IRNode): IRNode[] {
  return root.type === 'document' ? root.children || [] : [root];
}

function findCodegenErrors(root: IRNode): string[] {
  const failures: string[] = [];
  for (const node of codegenRoots(root)) {
    try {
      generateCoreNode(node);
    } catch (error) {
      failures.push(
        `${nodeLabel(node)} at line ${node.loc?.line ?? '?'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return failures;
}

function generatedCoreSource(root: IRNode): { code?: string; message?: string } {
  const chunks: string[] = [];
  for (const node of codegenRoots(root)) {
    try {
      chunks.push(...generateCoreNode(node));
    } catch (error) {
      return {
        message: `${nodeLabel(node)} at line ${node.loc?.line ?? '?'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
  return { code: chunks.join('\n') };
}

function decompiledCoreSource(root: IRNode): { code?: string; message?: string } {
  const chunks: string[] = [];
  for (const node of codegenRoots(root)) {
    try {
      chunks.push(decompile(node).code);
    } catch (error) {
      return {
        message: `${nodeLabel(node)} at line ${node.loc?.line ?? '?'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
  return { code: chunks.filter(Boolean).join('\n') };
}

function evaluateSourceTextAssertion(
  node: IRNode,
  source: string,
  label: string,
): { passed: boolean; message?: string } {
  const props = getProps(node);
  const contains = str(props.contains);
  const notContains = str(props.notContains);
  const matches = str(props.matches);
  if (!contains && !notContains && !matches) {
    return { passed: false, message: `${label} assertion requires contains=, notContains=, or matches=` };
  }
  if (contains && !source.includes(contains)) {
    return { passed: false, message: `${label} does not contain ${JSON.stringify(contains)}` };
  }
  if (notContains && source.includes(notContains)) {
    return { passed: false, message: `${label} unexpectedly contains ${JSON.stringify(notContains)}` };
  }
  if (matches) {
    try {
      if (!new RegExp(matches).test(source)) return { passed: false, message: `${label} does not match /${matches}/` };
    } catch {
      return { passed: false, message: `Invalid ${label.toLowerCase()} matches regex: ${matches}` };
    }
  }
  return { passed: true };
}

function evaluateCodegenAssertion(node: IRNode, target: LoadedKernDocument): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };
  if (!target.root) return { passed: false, message: 'Target has no parsed KERN root' };
  const generated = generatedCoreSource(target.root);
  if (generated.message || generated.code === undefined) {
    return { passed: false, message: `Target has codegen error: ${generated.message || 'unknown error'}` };
  }
  return evaluateSourceTextAssertion(node, generated.code, 'Generated code');
}

function evaluateDecompileAssertion(node: IRNode, target: LoadedKernDocument): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };
  if (!target.root) return { passed: false, message: 'Target has no parsed KERN root' };
  const decompiled = decompiledCoreSource(target.root);
  if (decompiled.message || decompiled.code === undefined) {
    return { passed: false, message: `Target has decompile error: ${decompiled.message || 'unknown error'}` };
  }
  return evaluateSourceTextAssertion(node, decompiled.code, 'Decompiled KERN');
}

function evaluateRoundtripAssertion(_node: IRNode, target: LoadedKernDocument): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };
  if (!target.root) return { passed: false, message: 'Target has no parsed KERN root' };

  const decompiled = decompiledCoreSource(target.root);
  if (decompiled.message || decompiled.code === undefined) {
    return { passed: false, message: `Target has decompile error: ${decompiled.message || 'unknown error'}` };
  }

  const reparsed = parseDocumentWithDiagnostics(decompiled.code);
  const parseError = reparsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (parseError) {
    return {
      passed: false,
      message: `Decompiled KERN does not reparse at ${parseError.line}:${parseError.col}: ${parseError.message}`,
    };
  }

  const schemaViolation = validateSchema(reparsed.root)[0];
  if (schemaViolation) {
    return {
      passed: false,
      message: `Decompiled KERN has schema violation at ${schemaViolation.line ?? 1}:${schemaViolation.col ?? 1}: ${schemaViolation.message}`,
    };
  }

  const semanticViolation = validateSemantics(reparsed.root).filter(
    (violation) => !isMultiSourceTransitionFalsePositive(violation, reparsed.root),
  )[0];
  if (semanticViolation) {
    return {
      passed: false,
      message: `Decompiled KERN has semantic violation at ${semanticViolation.line ?? 1}:${semanticViolation.col ?? 1}: ${semanticViolation.message}`,
    };
  }

  const originalGenerated = generatedCoreSource(target.root);
  if (originalGenerated.message || originalGenerated.code === undefined) {
    return { passed: false, message: `Target has codegen error: ${originalGenerated.message || 'unknown error'}` };
  }
  const roundtripGenerated = generatedCoreSource(reparsed.root);
  if (roundtripGenerated.message || roundtripGenerated.code === undefined) {
    return {
      passed: false,
      message: `Decompiled KERN has codegen error: ${roundtripGenerated.message || 'unknown error'}`,
    };
  }
  if (originalGenerated.code !== roundtripGenerated.code) {
    return { passed: false, message: 'Round-trip changed generated core code' };
  }

  return { passed: true };
}

function importAssertionSourcePath(node: IRNode): string {
  const props = getProps(node);
  const importValue = str(props.import);
  if (importValue && importValue !== 'true') return importValue;
  return str(props.from) || '';
}

function resolveImportAssertionSource(
  node: IRNode,
  context?: NativeKernAssertionContext,
): { source?: string; fileName?: string; message?: string } {
  const props = getProps(node);
  const inlineSource = str(props.source);
  if (inlineSource) return { source: inlineSource, fileName: 'inline.ts' };

  const sourcePath = importAssertionSourcePath(node);
  if (!sourcePath) return { message: 'Import assertion requires import=<ts-file> or from=<ts-file>' };

  const baseDir = context?.testFile ? dirname(context.testFile) : process.cwd();
  const fileName = resolve(baseDir, sourcePath);
  try {
    return { source: readFileSync(fileName, 'utf-8'), fileName };
  } catch (error) {
    return {
      message: `Could not read import source ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function evaluateImportedKernRoundtrip(
  kern: string,
  options: { allowWarnings?: boolean } = {},
): { passed: boolean; message?: string } {
  const reparsed = parseDocumentWithDiagnostics(kern);
  const parseError = reparsed.diagnostics.find((diagnostic) => diagnostic.severity === 'error');
  if (parseError) {
    return {
      passed: false,
      message: `Imported KERN does not reparse at ${parseError.line}:${parseError.col}: ${parseError.message}`,
    };
  }
  const parseWarning = reparsed.diagnostics.find((diagnostic) => diagnostic.severity === 'warning');
  if (parseWarning && !options.allowWarnings) {
    return {
      passed: false,
      message: `Imported KERN has parser warning at ${parseWarning.line}:${parseWarning.col}: ${parseWarning.message}`,
    };
  }

  const schemaViolation = validateSchema(reparsed.root)[0];
  if (schemaViolation) {
    return {
      passed: false,
      message: `Imported KERN has schema violation at ${schemaViolation.line ?? 1}:${schemaViolation.col ?? 1}: ${schemaViolation.message}`,
    };
  }

  const semanticViolation = validateSemantics(reparsed.root).filter(
    (violation) => !isMultiSourceTransitionFalsePositive(violation, reparsed.root),
  )[0];
  if (semanticViolation) {
    return {
      passed: false,
      message: `Imported KERN has semantic violation at ${semanticViolation.line ?? 1}:${semanticViolation.col ?? 1}: ${semanticViolation.message}`,
    };
  }

  const generated = generatedCoreSource(reparsed.root);
  if (generated.message || generated.code === undefined) {
    return { passed: false, message: `Imported KERN has codegen error: ${generated.message || 'unknown error'}` };
  }

  return { passed: true };
}

function formatImportUnmapped(unmapped: string[]): string {
  if (unmapped.length === 0) return 'no unmapped TypeScript statements';
  const shown = unmapped.slice(0, 5).join('; ');
  const suffix = unmapped.length > 5 ? `; +${unmapped.length - 5} more` : '';
  return `${unmapped.length} unmapped TypeScript statement(s): ${shown}${suffix}`;
}

function evaluateImportAssertion(
  node: IRNode,
  context?: NativeKernAssertionContext,
): { passed: boolean; message?: string } {
  const props = getProps(node);
  const hasTextAssertion = 'contains' in props || 'notContains' in props || 'matches' in props;
  const hasRoundtripAssertion = 'roundtrip' in props;
  const hasUnmappedAssertion = 'unmapped' in props || str(props.no) === 'unmapped';
  if (!hasTextAssertion && !hasRoundtripAssertion && !hasUnmappedAssertion) {
    return {
      passed: false,
      message:
        'Import assertion requires contains=, notContains=, matches=, roundtrip=true, unmapped=<count>, or no=unmapped',
    };
  }

  const resolved = resolveImportAssertionSource(node, context);
  if (resolved.message || resolved.source === undefined) {
    return { passed: false, message: resolved.message || 'Could not resolve import source' };
  }

  let imported: ReturnType<typeof importTypeScript>;
  try {
    imported = importTypeScript(resolved.source, resolved.fileName || 'input.ts');
  } catch (error) {
    return {
      passed: false,
      message: `TypeScript import failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (str(props.no) === 'unmapped' && imported.unmapped.length > 0) {
    return {
      passed: false,
      message: `Import expected no unmapped TypeScript, found ${formatImportUnmapped(imported.unmapped)}`,
    };
  }
  if ('unmapped' in props) {
    const expected = Number(props.unmapped);
    if (!Number.isInteger(expected) || expected < 0) {
      return { passed: false, message: 'Import assertion requires unmapped=<non-negative integer>' };
    }
    if (imported.unmapped.length !== expected) {
      return {
        passed: false,
        message: `Import expected ${expected} unmapped TypeScript statement(s), found ${formatImportUnmapped(imported.unmapped)}`,
      };
    }
  }

  if (hasTextAssertion) {
    const sourceAssertion = evaluateSourceTextAssertion(node, imported.kern, 'Imported KERN');
    if (!sourceAssertion.passed) return sourceAssertion;
  }

  if (hasRoundtripAssertion) {
    const roundtrip = evaluateImportedKernRoundtrip(imported.kern, { allowWarnings: isTruthy(props.allowWarnings) });
    if (!roundtrip.passed) return roundtrip;
  }

  return { passed: true };
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

// V8 enforces wall-clock time on `script.runInContext`. Under CPU contention
// cold-compile + JIT can blow tight budgets — a 100ms default produced flaky
// non-deterministic failures across runs. 1s is the new floor; override via
// `KERN_TEST_RUNTIME_TIMEOUT_MS` for slow CI or expensive evals.
const RUNTIME_EXPR_TIMEOUT_MS = readPositiveIntEnv('KERN_TEST_RUNTIME_TIMEOUT_MS', 1000);
// Outer process timeout for the async eval path — must comfortably exceed
// `RUNTIME_EXPR_TIMEOUT_MS` plus Node spawn cost (~200-400ms on busy machines).
const RUNTIME_ASYNC_PROCESS_TIMEOUT_MS = readPositiveIntEnv(
  'KERN_TEST_ASYNC_PROCESS_TIMEOUT_MS',
  Math.max(5000, RUNTIME_EXPR_TIMEOUT_MS + 2000),
);
const RUNTIME_EXPR_UNSAFE_TOKEN =
  /\b(?:async|class|constructor|Date|delete|do|eval|fetch|for|Function|global|globalThis|import|process|prototype|require|setInterval|setTimeout|switch|this|throw|try|while|with|WebSocket|XMLHttpRequest|__proto__)\b/;
const RUNTIME_FN_UNSAFE_TOKEN =
  /\b(?:class|constructor|Date|delete|do|eval|fetch|Function|global|globalThis|import|process|prototype|require|setInterval|setTimeout|switch|this|with|WebSocket|XMLHttpRequest|__proto__)\b/;
const RUNTIME_CLASS_UNSAFE_TOKEN =
  /\b(?:Date|delete|do|eval|fetch|Function|global|globalThis|import|process|prototype|require|setInterval|setTimeout|switch|with|WebSocket|XMLHttpRequest|__proto__)\b/;
const RUNTIME_NATIVE_BINDING_UNSAFE_TOKEN =
  /\b(?:class|constructor|Date|delete|do|eval|fetch|Function|global|globalThis|import|process|prototype|require|setInterval|setTimeout|switch|this|throw|try|while|with|WebSocket|XMLHttpRequest|__proto__)\b/;
const RUNTIME_WORKFLOW_BINDING_UNSAFE_TOKEN =
  /\b(?:class|constructor|Date|delete|do|eval|fetch|Function|global|globalThis|import|process|prototype|require|setInterval|setTimeout|switch|this|while|with|WebSocket|XMLHttpRequest|__proto__)\b/;

function unsafeRuntimeExpressionReason(source: string, options: { allowAwait?: boolean } = {}): string | undefined {
  if (source.length > 2000) return 'expression is longer than 2000 characters';
  if (/[\r\n;]/.test(source)) return 'multi-statement expressions are not supported';
  const unsafeToken = source.match(RUNTIME_EXPR_UNSAFE_TOKEN)?.[0];
  if (unsafeToken) return `unsupported token '${unsafeToken}'`;
  if (!options.allowAwait && /\bawait\b/.test(source)) return "unsupported token 'await'";
  if (/(^|[^=!<>])=(?!=|>)/.test(source)) return 'assignment is not supported';
  return undefined;
}

function unsafeRuntimeFunctionReason(source: string): string | undefined {
  if (source.length > 5000) return 'function body is longer than 5000 characters';
  const unsafeToken = source.match(RUNTIME_FN_UNSAFE_TOKEN)?.[0];
  if (unsafeToken) return `unsupported token '${unsafeToken}'`;
  return undefined;
}

function unsafeRuntimeClassReason(source: string): string | undefined {
  if (source.length > 10000) return 'class body is longer than 10000 characters';
  const unsafeToken = source.match(RUNTIME_CLASS_UNSAFE_TOKEN)?.[0];
  if (unsafeToken) return `unsupported token '${unsafeToken}'`;
  return undefined;
}

function unsafeRuntimeNativeBindingReason(source: string): string | undefined {
  if (source.length > 5000) return 'native binding expression is longer than 5000 characters';
  const unsafeToken = source.match(RUNTIME_NATIVE_BINDING_UNSAFE_TOKEN)?.[0];
  if (unsafeToken) return `unsupported token '${unsafeToken}'`;
  return undefined;
}

function unsafeRuntimeWorkflowReason(source: string): string | undefined {
  if (source.length > 10000) return 'workflow expression is longer than 10000 characters';
  const unsafeToken = source.match(RUNTIME_WORKFLOW_BINDING_UNSAFE_TOKEN)?.[0];
  if (unsafeToken) return `unsupported token '${unsafeToken}'`;
  return undefined;
}

function isRuntimeBindingName(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function transformRuntimeCodeSegments(source: string, transform: (segment: string) => string): string {
  let output = '';
  let segmentStart = 0;
  let index = 0;

  function flush(until: number): void {
    if (until > segmentStart) output += transform(source.slice(segmentStart, until));
  }

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      flush(index);
      const end = source.indexOf('\n', index + 2);
      const commentEnd = end === -1 ? source.length : end;
      output += source.slice(index, commentEnd);
      index = commentEnd;
      segmentStart = index;
      continue;
    }

    if (char === '/' && next === '*') {
      flush(index);
      const end = source.indexOf('*/', index + 2);
      const commentEnd = end === -1 ? source.length : end + 2;
      output += source.slice(index, commentEnd);
      index = commentEnd;
      segmentStart = index;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      flush(index);
      const quote = char;
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (source[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      output += source.slice(index, end);
      index = end;
      segmentStart = index;
      continue;
    }

    index += 1;
  }

  flush(source.length);
  return output;
}

function runtimeJsSource(source: string): string {
  return transformRuntimeCodeSegments(source, (segment) =>
    segment
      .replace(
        /\s+as\s+(?:const|any|unknown|never|[A-Za-z_$][\w$]*(?:<[^;\n(){}=]*>)?(?:\[\])?(?:\s*\|\s*[A-Za-z_$][\w$]*(?:<[^;\n(){}=]*>)?(?:\[\])?)*)/g,
        '',
      )
      .replace(/\b(const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;\n]+(?=\s*=)/g, '$1 $2')
      .replace(/([,(]\s*[A-Za-z_$][\w$]*)\s*:\s*[^,)]+(?=\s*[,)]\s*=>)/g, '$1')
      .replace(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*:\s*[^{]+{/g, 'function $1($2) {'),
  );
}

function runtimeConstHandlerExpr(node: IRNode): string {
  const code = runtimeJsSource(runtimeHandlerSource(node).trim());
  if (!code) return '';
  if (/^\s*(?:return|const|let|var|if|for|while|try|throw)\b/.test(code) || /;\s*$/.test(code)) {
    return `(() => {\n${code}\n})()`;
  }
  return `(${code})`;
}

function runtimeBindingSource(node: IRNode): { expr: string; kind: RuntimeBinding['kind'] } | undefined {
  if (node.type === 'const') {
    const value = exprPropToRuntimeSource(node, 'value');
    if (value) return { expr: runtimeJsSource(value), kind: 'expr' };
    const handlerExpr = runtimeConstHandlerExpr(node);
    if (handlerExpr) return { expr: handlerExpr, kind: 'native' };
    return { expr: '', kind: 'expr' };
  }
  if (node.type === 'derive' || node.type === 'let') {
    return {
      expr: runtimeJsSource(exprPropToRuntimeSource(node, 'value') || exprPropToRuntimeSource(node, 'expr')),
      kind: 'expr',
    };
  }
  if (node.type === 'fn') return { expr: runtimeFunctionExpr(node), kind: 'fn' };
  if (node.type === 'class') return { expr: runtimeClassExpr(node), kind: 'class' };
  if (node.type === 'mapLit') return { expr: runtimeMapLitExpr(node), kind: 'native' };
  if (node.type === 'setLit') return { expr: runtimeSetLitExpr(node), kind: 'native' };
  if (node.type === 'collect') return { expr: runtimeCollectBindingExpr(node), kind: 'native' };
  const arrayExpr = runtimeArrayBindingExpr(node);
  if (arrayExpr !== undefined) return { expr: arrayExpr, kind: 'native' };
  return undefined;
}

function runtimeParamNames(node: IRNode): string[] {
  const names: string[] = [];
  for (const param of getChildren(node, 'param')) {
    const name = str(getProps(param).name);
    if (name) names.push(name);
  }
  if (names.length > 0) return names;
  return parseLegacyParamNames(str(getProps(node).params));
}

function runtimeFunctionExpr(node: IRNode): string {
  const code = runtimeJsSource(runtimeHandlerSource(node));
  if (!code) return '';

  const params = runtimeParamNames(node);
  if (!params.every(isRuntimeBindingName)) return '';
  const asyncKw = isTruthy(getProps(node).async) ? 'async ' : '';
  return `(${asyncKw}(${params.join(', ')}) => {\n${code.trim()}\n})`;
}

function runtimeHandlerLines(node: IRNode, spaces = 4): string[] {
  const prefix = ' '.repeat(spaces);
  const code = runtimeJsSource(runtimeHandlerSource(node).trim());
  if (!code) return [];
  return code.split('\n').map((line) => `${prefix}${line}`);
}

function runtimeClassFieldInitializers(node: IRNode): string[] {
  const lines: string[] = [];
  for (const field of getChildren(node, 'field')) {
    const props = getProps(field);
    if (isTruthy(props.static)) continue;
    const name = str(props.name);
    if (!isRuntimeBindingName(name)) return [];
    const value = exprPropToRuntimeSource(field, 'value') || rawPropToRuntimeSource(field, 'default');
    if (value) lines.push(`    this.${name} = (${value});`);
  }
  return lines;
}

function runtimeClassMethodLines(node: IRNode): string[] | undefined {
  const props = getProps(node);
  const name = str(props.name);
  if (!isRuntimeBindingName(name)) return undefined;
  const params = runtimeParamNames(node);
  if (!params.every(isRuntimeBindingName)) return undefined;

  const staticKw = isTruthy(props.static) ? 'static ' : '';
  const asyncKw = isTruthy(props.async) || isTruthy(props.stream) ? 'async ' : '';
  const star = isTruthy(props.stream) ? '*' : '';
  const lines = [`  ${staticKw}${asyncKw}${star}${name}(${params.join(', ')}) {`];
  lines.push(...runtimeHandlerLines(node));
  lines.push('  }');
  return lines;
}

function runtimeClassGetterLines(node: IRNode): string[] | undefined {
  const props = getProps(node);
  const name = str(props.name);
  if (!isRuntimeBindingName(name)) return undefined;
  const staticKw = isTruthy(props.static) ? 'static ' : '';
  const lines = [`  ${staticKw}get ${name}() {`];
  lines.push(...runtimeHandlerLines(node));
  lines.push('  }');
  return lines;
}

function runtimeClassSetterLines(node: IRNode): string[] | undefined {
  const props = getProps(node);
  const name = str(props.name);
  if (!isRuntimeBindingName(name)) return undefined;
  const params = runtimeParamNames(node);
  if (!params.every(isRuntimeBindingName)) return undefined;
  const param = params[0] || 'value';
  const staticKw = isTruthy(props.static) ? 'static ' : '';
  const lines = [`  ${staticKw}set ${name}(${param}) {`];
  lines.push(...runtimeHandlerLines(node));
  lines.push('  }');
  return lines;
}

function runtimeClassExpr(node: IRNode): string {
  const name = str(getProps(node).name);
  if (!isRuntimeBindingName(name)) return '';

  const ctorNode = getChildren(node, 'constructor')[0];
  const ctorParams = ctorNode ? runtimeParamNames(ctorNode) : [];
  if (!ctorParams.every(isRuntimeBindingName)) return '';

  const fieldInitializers = runtimeClassFieldInitializers(node);
  const lines = ['(class {'];
  if (ctorNode || fieldInitializers.length > 0) {
    lines.push(`  constructor(${ctorParams.join(', ')}) {`);
    lines.push(...fieldInitializers);
    if (ctorNode) lines.push(...runtimeHandlerLines(ctorNode));
    lines.push('  }');
  }

  for (const method of getChildren(node, 'method')) {
    const methodLines = runtimeClassMethodLines(method);
    if (!methodLines) return '';
    lines.push(...methodLines);
  }
  for (const getter of getChildren(node, 'getter')) {
    const getterLines = runtimeClassGetterLines(getter);
    if (!getterLines) return '';
    lines.push(...getterLines);
  }
  for (const setter of getChildren(node, 'setter')) {
    const setterLines = runtimeClassSetterLines(setter);
    if (!setterLines) return '';
    lines.push(...setterLines);
  }

  lines.push('})');
  return lines.join('\n');
}

function runtimeValuePropSource(node: IRNode, propName: string): string {
  return exprPropToRuntimeSource(node, propName) || rawPropToRuntimeSource(node, propName);
}

function runtimePortableSource(source: string): string {
  return source.replace(/\b([A-Za-z_$][A-Za-z0-9_$]*)\.result\b/g, '$1');
}

function runtimePortableValuePropSource(node: IRNode, propName: string): string {
  const source = runtimeValuePropSource(node, propName);
  return source ? runtimePortableSource(source) : '';
}

function runtimeMapLitExpr(node: IRNode): string {
  const entries: string[] = [];
  for (const entry of getChildren(node, 'mapEntry')) {
    const key = runtimeValuePropSource(entry, 'key');
    const value = runtimeValuePropSource(entry, 'value');
    if (!key || !value) return '';
    entries.push(`[${key}, ${value}]`);
  }
  return `new Map([${entries.join(', ')}])`;
}

function runtimeSetLitExpr(node: IRNode): string {
  const items: string[] = [];
  for (const item of getChildren(node, 'setItem')) {
    const value = runtimeValuePropSource(item, 'value');
    if (!value) return '';
    items.push(value);
  }
  return `new Set([${items.join(', ')}])`;
}

function runtimeSyntheticName(node: IRNode, prefix: string): string {
  const line = node.loc?.line ?? 0;
  const col = node.loc?.col ?? 0;
  return `__kern${prefix}_${line}_${col}`;
}

function runtimeDestructureBindings(node: IRNode): RuntimeBinding[] {
  const source = rawPropToRuntimeSource(node, 'source');
  if (!source) return [];

  const bindings: RuntimeBinding[] = [];
  for (const child of node.children || []) {
    const props = getProps(child);
    const name = str(props.name);
    if (!isRuntimeBindingName(name)) continue;

    if (child.type === 'element') {
      const rawIndex = str(props.index);
      const index = rawIndex && /^-?\d+$/.test(rawIndex) ? rawIndex : String(bindings.length);
      bindings.push({
        name,
        expr: `((${source})[${index}])`,
        kind: 'native',
        line: child.loc?.line,
      });
    }

    if (child.type === 'binding') {
      const key = str(props.key) || name;
      const accessor = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
      bindings.push({
        name,
        expr: `((${source})${accessor})`,
        kind: 'native',
        line: child.loc?.line,
      });
    }
  }

  return bindings;
}

function runtimeNamedProp(node: IRNode, propName: string, fallback: string): string {
  const value = str(getProps(node)[propName]);
  return isRuntimeBindingName(value) ? value : fallback;
}

function runtimeArrayPredicateBindingExpr(
  node: IRNode,
  method: 'filter' | 'find' | 'some' | 'every' | 'findIndex',
): string {
  const collection = rawPropToRuntimeSource(node, 'in');
  const predicate = rawPropToRuntimeSource(node, 'where');
  if (!collection || !predicate) return '';
  const item = runtimeNamedProp(node, 'item', 'item');
  return `((${collection}).${method}((${item}) => ${predicate}))`;
}

function runtimeArrayProjectionBindingExpr(node: IRNode, method: 'map' | 'flatMap'): string {
  const collection = rawPropToRuntimeSource(node, 'in');
  const body = rawPropToRuntimeSource(node, 'expr');
  if (!collection || !body) return '';
  const item = runtimeNamedProp(node, 'item', 'item');
  return `((${collection}).${method}((${item}) => ${body}))`;
}

function runtimeArrayValueLookupBindingExpr(node: IRNode, method: 'includes' | 'indexOf' | 'lastIndexOf'): string {
  const collection = rawPropToRuntimeSource(node, 'in');
  const value = rawPropToRuntimeSource(node, 'value');
  if (!collection || !value) return '';
  const from = rawPropToRuntimeSource(node, 'from');
  const args = from ? `${value}, ${from}` : value;
  return `((${collection}).${method}(${args}))`;
}

function runtimeCollectBindingExpr(node: IRNode, options: { portable?: boolean } = {}): string {
  const source = options.portable ? runtimePortableSource : (value: string) => value;
  const from = source(rawPropToRuntimeSource(node, 'from'));
  if (!from) return '';
  const where = source(rawPropToRuntimeSource(node, 'where'));
  const order = source(rawPropToRuntimeSource(node, 'order'));
  const limit = source(rawPropToRuntimeSource(node, 'limit'));

  let chain = `(${from})`;
  if (where) chain += `.filter((item) => ${where})`;
  if (order) chain += `.sort((a, b) => ${order})`;
  if (limit) chain += `.slice(0, ${limit})`;
  return `(${chain})`;
}

function runtimePartitionBindings(node: IRNode): RuntimeBinding[] {
  const collection = rawPropToRuntimeSource(node, 'in');
  const predicate = rawPropToRuntimeSource(node, 'where');
  if (!collection || !predicate) return [];

  const passName = str(getProps(node).pass);
  const failName = str(getProps(node).fail);
  if (!isRuntimeBindingName(passName) || !isRuntimeBindingName(failName)) return [];

  const item = runtimeNamedProp(node, 'item', 'item');
  const pairName = `__kernPartition_${passName}_${failName}`;
  const pairExpr = `((${collection}).reduce((acc, ${item}) => { (${predicate} ? acc[0] : acc[1]).push(${item}); return acc; }, [[], []]))`;
  return [
    {
      name: pairName,
      expr: pairExpr,
      kind: 'native',
      line: node.loc?.line,
    },
    {
      name: passName,
      expr: `${pairName}[0]`,
      kind: 'native',
      line: node.loc?.line,
    },
    {
      name: failName,
      expr: `${pairName}[1]`,
      kind: 'native',
      line: node.loc?.line,
    },
  ];
}

function runtimeRespondSource(node: IRNode, options: { portable?: boolean } = {}): string {
  const props = getProps(node);
  const status = typeof props.status === 'number' ? props.status : Number(str(props.status)) || undefined;
  const valueSource = options.portable ? runtimePortableValuePropSource : runtimeValuePropSource;
  const jsonSource = valueSource(node, 'json');
  if (jsonSource) return status && status !== 200 ? `({ status: ${status}, json: ${jsonSource} })` : jsonSource;

  const textSource = valueSource(node, 'text');
  if (textSource) return status && status !== 200 ? `({ status: ${status}, text: ${textSource} })` : textSource;

  const error = str(props.error);
  if (error) return `({ status: ${status || 500}, error: ${JSON.stringify(error)} })`;

  const redirect = str(props.redirect);
  if (redirect) return `({ status: ${status || 302}, redirect: ${JSON.stringify(redirect)} })`;

  return `({ status: ${status || 200} })`;
}

function runtimeScopedObject(names: string[]): string {
  const unique = [...new Set(names)].filter(isRuntimeBindingName);
  if (unique.length === 0) return 'undefined';
  if (unique.length === 1) return unique[0];
  return `({ ${unique.join(', ')} })`;
}

function runtimeWorkflowHelperLines(): string[] {
  return [
    'const __kernGuardError = (name, message) => { const error = new Error(message); error.name = name; throw error; };',
    'const __kernGuardSyncParam = (name, value) => {',
    '  if (typeof params === "object" && params !== null) params[name] = value;',
    '  if (typeof query === "object" && query !== null && name in query) query[name] = value;',
    '  if (typeof body === "object" && body !== null && name in body) body[name] = value;',
    '  if (typeof args === "object" && args !== null) args[name] = value;',
    '};',
    'const __kernNormalizePath = (value) => {',
    '  const text = String(value || "");',
    '  const absolute = text.startsWith("/") ? text : `/${text}`;',
    '  const parts = [];',
    '  for (const part of absolute.split("/")) {',
    '    if (!part || part === ".") continue;',
    '    if (part === "..") parts.pop();',
    '    else parts.push(part);',
    '  }',
    '  return `/${parts.join("/")}`;',
    '};',
    'const __kernResolvePath = (value, base) => String(value).startsWith("/") ? __kernNormalizePath(value) : __kernNormalizePath(`${base || ""}/${value}`);',
    'const __kernPathWithin = (candidate, roots) => roots.some((root) => candidate === root || candidate.startsWith(root.endsWith("/") ? root : `${root}/`));',
    'const __kernByteLength = (value) => {',
    '  const text = typeof value === "string" ? value : JSON.stringify(value);',
    '  if (text == null) return 0;',
    '  let bytes = 0;',
    '  for (let i = 0; i < text.length; i++) {',
    '    const code = text.charCodeAt(i);',
    '    if (code < 0x80) bytes += 1;',
    '    else if (code < 0x800) bytes += 2;',
    '    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }',
    '    else bytes += 3;',
    '  }',
    '  return bytes;',
    '};',
    'const __kernUrlHost = (value) => {',
    '  const match = String(value || "").match(/^[A-Za-z][A-Za-z0-9+.-]*:\\/\\/([^/?#]+)/);',
    '  if (!match) return "";',
    '  return match[1].split("@").pop().split(":")[0].toLowerCase();',
    '};',
  ];
}

function runtimeGuardTargetName(node: IRNode, options: RuntimeGuardOptions): string {
  return guardParam(node) || options.targetParam || '';
}

function runtimeGuardListProp(node: IRNode, ...propNames: string[]): string[] {
  const props = getProps(node);
  for (const propName of propNames) {
    const value = str(props[propName]);
    if (value) return parseList(value);
  }
  return [];
}

function runtimeGuardAssignLines(target: string, source: string): string[] {
  return [`${target} = ${source};`, `__kernGuardSyncParam(${JSON.stringify(target)}, ${target});`];
}

function runtimeGuardStatement(node: IRNode, options: RuntimeGuardOptions = {}): string[] {
  const rawExpr = exprPropToRuntimeSource(node, 'expr') || rawPropToRuntimeSource(node, 'expr');
  const expr = options.portable ? runtimePortableSource(rawExpr) : rawExpr;
  const props = getProps(node);
  const coverageLine = options.trackCoverage ? runtimeGuardCoverageCallLine(node) : undefined;
  const withCoverage = (lines: string[]) => (coverageLine ? [coverageLine, ...lines] : lines);
  if (expr) {
    const fallback = str(props.else) || str(props.fallback);
    const numericFallback = fallback && /^\d+$/.test(fallback) ? Number(fallback) : undefined;
    const result =
      numericFallback !== undefined
        ? `({ status: ${numericFallback} })`
        : fallback
          ? `({ error: ${JSON.stringify(fallback)} })`
          : 'false';
    return withCoverage([`if (!(${expr})) return (${result});`]);
  }

  if (!options.portable && !options.targetParam) return [];

  const kind = guardKind(node);
  const target = runtimeGuardTargetName(node, options);
  const lines: string[] = [];

  if (kind === 'sanitize') {
    if (!target || !isRuntimeBindingName(target)) return [];
    const pattern = str(props.pattern) || '[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]';
    const replacement = str(props.replacement);
    try {
      new RegExp(pattern);
      if (/([+*}])\s*\)\s*[+*{]/.test(pattern)) {
        return withCoverage([
          `__kernGuardError("GuardConfigError", ${JSON.stringify(`Unsafe sanitize regex for ${target}: ${pattern}`)});`,
        ]);
      }
    } catch {
      return withCoverage([
        `__kernGuardError("GuardConfigError", ${JSON.stringify(`Invalid sanitize regex for ${target}: ${pattern}`)});`,
      ]);
    }
    lines.push(`if (typeof ${target} === "string") {`);
    for (const line of runtimeGuardAssignLines(
      target,
      `${target}.replace(new RegExp(${JSON.stringify(pattern)}, "g"), ${JSON.stringify(replacement)})`,
    )) {
      lines.push(`  ${line}`);
    }
    lines.push('}');
    return withCoverage(lines);
  }

  if (kind === 'validate') {
    if (!target || !isRuntimeBindingName(target)) return [];
    const min = numericProp(props, 'min');
    const max = numericProp(props, 'max');
    if (min !== undefined) {
      lines.push(
        `if (typeof ${target} === "number" ? ${target} < ${min} : String(${target}).length < ${min}) __kernGuardError("ValidationError", ${JSON.stringify(`${target} below minimum ${min}`)});`,
      );
    }
    if (max !== undefined) {
      lines.push(
        `if (typeof ${target} === "number" ? ${target} > ${max} : String(${target}).length > ${max}) __kernGuardError("ValidationError", ${JSON.stringify(`${target} above maximum ${max}`)});`,
      );
    }
    const regex = str(props.regex) || str(props.pattern);
    if (regex) {
      try {
        new RegExp(regex);
        if (/([+*}])\s*\)\s*[+*{]/.test(regex)) {
          lines.push(
            `__kernGuardError("GuardConfigError", ${JSON.stringify(`Unsafe validate regex for ${target}: ${regex}`)});`,
          );
        } else {
          lines.push(
            `if (typeof ${target} === "string" && !(new RegExp(${JSON.stringify(regex)})).test(${target})) __kernGuardError("ValidationError", ${JSON.stringify(`${target} does not match required pattern`)});`,
          );
        }
      } catch {
        lines.push(
          `__kernGuardError("GuardConfigError", ${JSON.stringify(`Invalid validate regex for ${target}: ${regex}`)});`,
        );
      }
    }
    return withCoverage(lines);
  }

  if (kind === 'pathcontainment' || kind === 'pathcontainmentguard' || kind === 'path') {
    if (!target || !isRuntimeBindingName(target)) return [];
    const roots = runtimeGuardListProp(node, 'allowlist', 'allow', 'roots', 'root');
    const base = str(props.baseDir) || str(props.base) || '/';
    const rootList = roots.length > 0 ? roots : [base || '/'];
    const rootsSource = `[${rootList.map((root) => JSON.stringify(root)).join(', ')}].map(__kernNormalizePath)`;
    lines.push(
      `if (${target} == null || ${target} === "") __kernGuardError("PathContainmentError", ${JSON.stringify(`${target} is required for path containment check`)});`,
    );
    for (const line of runtimeGuardAssignLines(target, `__kernResolvePath(${target}, ${JSON.stringify(base)})`)) {
      lines.push(line);
    }
    lines.push(
      `if (!__kernPathWithin(${target}, ${rootsSource})) __kernGuardError("PathContainmentError", ${JSON.stringify(`${target} escapes allowed directories`)});`,
    );
    return withCoverage(lines);
  }

  if (kind === 'sizelimit') {
    if (!target || !isRuntimeBindingName(target)) return [];
    const maxBytes = numericProp(props, 'maxBytes') ?? numericProp(props, 'max') ?? 1048576;
    lines.push(
      `if (__kernByteLength(${target}) > ${maxBytes}) __kernGuardError("SizeLimitError", ${JSON.stringify(`${target} exceeds size limit of ${maxBytes} bytes`)});`,
    );
    return withCoverage(lines);
  }

  if (kind === 'auth') {
    const tokenTarget = target && isRuntimeBindingName(target) ? target : '';
    const header = str(props.header) || 'authorization';
    const tokenExpr = tokenTarget
      ? tokenTarget
      : `(typeof headers === "object" && headers !== null ? (headers[${JSON.stringify(header)}] || headers[${JSON.stringify(header.toLowerCase())}] || headers.Authorization) : undefined) || (typeof params === "object" && params !== null ? (params.token || params.authorization) : undefined) || (typeof args === "object" && args !== null ? (args.token || args.authorization) : undefined)`;
    lines.push(
      `if (!(${tokenExpr})) __kernGuardError("AuthError", ${JSON.stringify(`Authentication required${tokenTarget ? `: ${tokenTarget}` : ''}`)});`,
    );
    return withCoverage(lines);
  }

  if (kind === 'ratelimit') {
    const maxRequests = numericProp(props, 'maxRequests') ?? numericProp(props, 'requests') ?? 1;
    if (maxRequests <= 0) {
      return withCoverage([`__kernGuardError("RateLimitError", "Rate limit maxRequests must be greater than 0");`]);
    }
    return withCoverage([]);
  }

  if (kind === 'urlallowlist' || kind === 'urlvalidation' || kind === 'hostallowlist' || kind === 'domainallowlist') {
    if (!target || !isRuntimeBindingName(target)) return [];
    const allowed = runtimeGuardListProp(node, 'allowlist', 'allow').map((entry) => entry.toLowerCase());
    if (allowed.length === 0) return [];
    const allowedSource = `[${allowed.map((entry) => JSON.stringify(entry)).join(', ')}]`;
    lines.push(
      `if (!${allowedSource}.includes(__kernUrlHost(${target}))) __kernGuardError("UrlAllowlistError", ${JSON.stringify(`${target} host is not allowlisted`)});`,
    );
    return withCoverage(lines);
  }

  return [];
}

function runtimeScopedChildProgram(children: IRNode[]): { lines: string[]; names: string[]; hasReturn: boolean } {
  const lines: string[] = [];
  const names: string[] = [];
  let hasReturn = false;

  for (const child of children) {
    if (child.type === 'respond') {
      lines.push(`return (${runtimeRespondSource(child)});`);
      hasReturn = true;
      continue;
    }

    if (child.type === 'guard') {
      lines.push(...runtimeGuardStatement(child));
      continue;
    }

    if (child.type === 'destructure') {
      for (const binding of runtimeDestructureBindings(child)) {
        lines.push(`const ${binding.name} = (${binding.expr});`);
        names.push(binding.name);
      }
      continue;
    }

    if (child.type === 'partition') {
      const partitionBindings = runtimePartitionBindings(child);
      for (const binding of partitionBindings) {
        lines.push(`const ${binding.name} = (${binding.expr});`);
        names.push(binding.name);
      }
      continue;
    }

    if (child.type === 'each') {
      const expr = runtimeEachExecutionExpr(child);
      if (expr) lines.push(`(${expr});`);
      continue;
    }

    const name = str(getProps(child).name);
    const binding = runtimeBindingSource(child);
    if (name && binding?.expr && isRuntimeBindingName(name)) {
      lines.push(`const ${name} = (${binding.expr});`);
      names.push(name);
    }
  }

  return { lines, names, hasReturn };
}

function runtimeBranchBindingExpr(node: IRNode, options: { async?: boolean } = {}): string {
  const on = rawPropToRuntimeSource(node, 'on');
  if (!on) return '';

  const lines = [`(${options.async ? 'async ' : ''}() => {`, `  const __branchValue = (${on});`];
  const paths = getChildren(node, 'path');
  for (let index = 0; index < paths.length; index++) {
    const pathNode = paths[index];
    const value = str(getProps(pathNode).value);
    const program = runtimeScopedChildProgram(pathNode.children || []);
    const keyword = index === 0 ? 'if' : 'else if';
    lines.push(`  ${keyword} (__branchValue === ${JSON.stringify(value)}) {`);
    for (const line of program.lines) lines.push(`    ${line}`);
    if (!program.hasReturn) lines.push(`    return (${runtimeScopedObject(program.names)});`);
    lines.push('  }');
  }
  lines.push('  return undefined;');
  lines.push('})()');
  return lines.join('\n');
}

function runtimeEachExecutionExpr(node: IRNode, options: { async?: boolean } = {}): string {
  const collection = rawPropToRuntimeSource(node, 'in');
  const item = str(getProps(node).name) || 'item';
  if (!collection || !isRuntimeBindingName(item)) return '';

  const index = str(getProps(node).index);
  if (index && !isRuntimeBindingName(index)) return '';

  const program = runtimeScopedChildProgram(node.children || []);
  const lines = [`(${options.async ? 'async ' : ''}() => {`, '  const __results = [];'];
  if (index) {
    lines.push(`  for (const [${index}, ${item}] of (${collection}).entries()) {`);
  } else {
    lines.push(`  for (const ${item} of ${collection}) {`);
  }
  for (const line of program.lines) lines.push(`    ${line}`);
  lines.push(`    __results.push(${runtimeScopedObject(program.names)});`);
  lines.push('  }');
  lines.push('  return __results;');
  lines.push('})()');
  return lines.join('\n');
}

function runtimeEachExecutionBinding(node: IRNode): RuntimeBinding | undefined {
  const expr = runtimeEachExecutionExpr(node);
  if (!expr) return undefined;
  return {
    name: runtimeSyntheticName(node, 'Each'),
    expr,
    kind: 'native',
    eager: true,
    line: node.loc?.line,
  };
}

function runtimeRouteMethod(node: IRNode): string {
  return (str(getProps(node).method) || 'get').toLowerCase();
}

function runtimeRoutePath(node: IRNode): string {
  return str(getProps(node).path);
}

function runtimeRouteLabel(node: IRNode): string {
  return `${runtimeRouteMethod(node).toUpperCase()} ${runtimeRoutePath(node) || '<missing-path>'}`;
}

function parseRuntimeRouteSpec(spec: string): { method?: string; path?: string; name?: string } {
  const trimmed = spec.trim();
  const match = trimmed.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(.+)$/i);
  if (match) return { method: match[1].toLowerCase(), path: match[2].trim() };
  if (trimmed.startsWith('/')) return { path: trimmed };
  return { name: trimmed };
}

function findRuntimeRoute(target: LoadedKernDocument, spec: string): { route?: IRNode; message?: string } {
  const parsed = parseRuntimeRouteSpec(spec);
  const routes = collectNodes(target.root, 'route').filter((route) => {
    const props = getProps(route);
    if (parsed.name) {
      return str(props.name) === parsed.name || runtimeRouteLabel(route) === parsed.name;
    }
    if (parsed.method && runtimeRouteMethod(route) !== parsed.method) return false;
    return !parsed.path || runtimeRoutePath(route) === parsed.path;
  });

  if (routes.length === 1) return { route: routes[0] };
  if (routes.length === 0) return { message: `Runtime route assertion target not found: ${spec}` };
  return { message: `Runtime route assertion target is ambiguous: ${spec}` };
}

function runtimeRoutePathParamNames(path: string): string[] {
  const names: string[] = [];
  const matcher = /(?::|\{)([A-Za-z_$][A-Za-z0-9_$]*)(?:\})?/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(path))) names.push(match[1]);
  return [...new Set(names)];
}

function runtimeRouteParamItems(route: IRNode): Array<{ name: string; defaultSource?: string }> {
  const items: Array<{ name: string; defaultSource?: string }> = [];
  for (const paramsNode of getChildren(route, 'params')) {
    const rawItems = getProps(paramsNode).items;
    if (!Array.isArray(rawItems)) continue;
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      const itemProps = item as { name?: unknown; default?: unknown };
      const name = str(itemProps.name);
      if (!name) continue;
      const defaultSource = itemProps.default === undefined ? undefined : String(itemProps.default);
      items.push({ name, defaultSource });
    }
  }
  return items;
}

function runtimeWorkflowKind(options: RuntimeWorkflowProgramOptions): RuntimeWorkflowKind {
  return options.kind || 'route';
}

function runtimeEffectName(node: IRNode): string {
  return str(getProps(node).name) || 'effect';
}

function runtimeEffectCoverageKey(node: IRNode): string {
  return `${runtimeEffectName(node)}:${node.loc?.line ?? '?'}`;
}

function runtimeGuardCoverageKey(node: IRNode): string {
  return `${node.loc?.line ?? '?'}:${node.loc?.col ?? '?'}`;
}

function runtimeEffectTriggerSource(
  node: IRNode,
  options: { portable?: boolean } = {},
): { source?: string; message?: string } {
  const triggerNode = getChildren(node, 'trigger')[0];
  if (!triggerNode) return { message: `Runtime effect ${runtimeEffectName(node)} requires trigger expr={{...}}` };

  const source = exprPropToRuntimeSource(triggerNode, 'expr');
  if (!source) {
    return {
      message:
        `Runtime effect ${runtimeEffectName(node)} can only simulate trigger expr={{...}}; ` +
        'query/url/call triggers need native mocks or a backend integration test.',
    };
  }

  const portableSource = options.portable ? runtimePortableSource(source) : source;
  const problem = unsafeRuntimeExpressionReason(portableSource, { allowAwait: true });
  if (problem) {
    return { message: `Runtime effect ${runtimeEffectName(node)} cannot execute trigger: ${problem}` };
  }
  return { source: portableSource };
}

function runtimeEffectRecoverFallbackSource(node: IRNode, options: { portable?: boolean } = {}): string {
  const recoverNode = getChildren(node, 'recover')[0];
  if (!recoverNode) return 'null';
  const source = runtimeValuePropSource(recoverNode, 'fallback') || 'null';
  return options.portable ? runtimePortableSource(source) : source;
}

function findRuntimeEffectMock(
  mocks: RuntimeEffectMock[] | undefined,
  effectName: string,
): { mock?: RuntimeEffectMock; message?: string } {
  const matches = (mocks || []).filter((mock) => mock.effect === effectName);
  if (matches.length === 0) return {};
  if (matches.length === 1) return { mock: matches[0] };
  return { message: `Runtime effect ${effectName} has multiple scoped mocks` };
}

function runtimeEffectMockExecutionExpr(
  mock: RuntimeEffectMock,
  options: { portable?: boolean; meta?: boolean } = {},
): { expr?: string; message?: string } {
  if (!isRuntimeBindingName(mock.effect)) return { message: `Runtime mock has invalid effect name: ${mock.effect}` };

  if (mock.throws !== undefined) {
    const rawName = mock.throws.trim() && mock.throws !== 'true' ? mock.throws.trim() : 'Error';
    const message = rawName === 'Error' ? `Mocked effect ${mock.effect} failed` : rawName;
    const lines = [
      '(async () => {',
      `  const __error = new Error(${JSON.stringify(message)});`,
      `  __error.name = ${JSON.stringify(rawName)};`,
      '  throw __error;',
      '})()',
    ];
    return { expr: lines.join('\n') };
  }

  const source = options.portable ? runtimePortableSource(mock.returns || 'undefined') : mock.returns || 'undefined';
  const problem = unsafeRuntimeExpressionReason(source, { allowAwait: true });
  if (problem) return { message: `Runtime mock effect ${mock.effect} cannot execute returns value: ${problem}` };

  const lines = ['(async () => {', `  const __value = await (${source});`];
  if (options.meta) {
    lines.push('  return { result: __value, recovered: false, attempts: 0, mocked: true };');
  } else {
    lines.push('  return __value;');
  }
  lines.push('})()');
  return { expr: lines.join('\n') };
}

function recordRuntimeEffectMockCall(mock: RuntimeEffectMock, mockCalls?: Map<string, number>): void {
  if (!mockCalls) return;
  mockCalls.set(mock.id, (mockCalls.get(mock.id) || 0) + 1);
}

function markRuntimeEffectMockChecked(mock: RuntimeEffectMock, checkedMocks?: Set<string>): void {
  checkedMocks?.add(mock.id);
}

function runtimeEffectMockCallLine(mock: RuntimeEffectMock): string {
  const id = JSON.stringify(mock.id);
  return `__kernMockCalls[${id}] = (__kernMockCalls[${id}] || 0) + 1;`;
}

function runtimeEffectCoverageCallLine(effect: IRNode): string {
  const key = JSON.stringify(runtimeEffectCoverageKey(effect));
  return `__kernEffectCalls[${key}] = (__kernEffectCalls[${key}] || 0) + 1;`;
}

function runtimeGuardCoverageCallLine(guard: IRNode): string {
  const key = JSON.stringify(runtimeGuardCoverageKey(guard));
  return `__kernGuardCalls[${key}] = (__kernGuardCalls[${key}] || 0) + 1;`;
}

function mergeRuntimeEffectMockCalls(mockCalls: Map<string, number> | undefined, calls: unknown): void {
  if (!mockCalls || !calls || typeof calls !== 'object') return;
  for (const [id, count] of Object.entries(calls as Record<string, unknown>)) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    mockCalls.set(id, (mockCalls.get(id) || 0) + numeric);
  }
}

function mergeRuntimeEffectCoverageCalls(effectCalls: Map<string, number> | undefined, calls: unknown): void {
  if (!effectCalls || !calls || typeof calls !== 'object') return;
  for (const [key, count] of Object.entries(calls as Record<string, unknown>)) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    effectCalls.set(key, (effectCalls.get(key) || 0) + numeric);
  }
}

function mergeRuntimeGuardCoverageCalls(guardCalls: Map<string, number> | undefined, calls: unknown): void {
  if (!guardCalls || !calls || typeof calls !== 'object') return;
  for (const [key, count] of Object.entries(calls as Record<string, unknown>)) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    guardCalls.set(key, (guardCalls.get(key) || 0) + numeric);
  }
}

function runtimeEffectExecutionExpr(
  node: IRNode,
  options: { portable?: boolean; meta?: boolean } = {},
): { expr?: string; message?: string } {
  const name = runtimeEffectName(node);
  if (!isRuntimeBindingName(name)) return { message: `Runtime effect has invalid name: ${name}` };

  const trigger = runtimeEffectTriggerSource(node, options);
  if (trigger.message || !trigger.source) return { message: trigger.message || 'Runtime effect has no trigger' };

  const recoverNode = getChildren(node, 'recover')[0];
  const hasRecover = recoverNode !== undefined;
  const fallbackSource = runtimeEffectRecoverFallbackSource(node, options);
  const fallbackProblem = unsafeRuntimeExpressionReason(fallbackSource, { allowAwait: true });
  if (fallbackProblem) {
    return { message: `Runtime effect ${name} cannot execute fallback: ${fallbackProblem}` };
  }

  const rawRetry = recoverNode ? getProps(recoverNode).retry : undefined;
  const retryCount = rawRetry === undefined || rawRetry === '' ? 0 : Number(rawRetry);
  if (!Number.isInteger(retryCount) || retryCount < 0) {
    return { message: `Runtime effect ${name} has invalid recover retry=${String(rawRetry)}` };
  }
  const attempts = hasRecover && retryCount > 0 ? retryCount : 1;
  const result = (value: string, recovered: boolean) =>
    options.meta ? `({ result: ${value}, recovered: ${recovered}, attempts: __attempts })` : value;

  const lines = ['(async () => {', '  let __attempts = 0;'];
  if (!hasRecover) {
    lines.push('  __attempts++;');
    lines.push(`  const __value = await (${trigger.source});`);
    lines.push(`  return ${result('__value', false)};`);
    lines.push('})()');
    return { expr: lines.join('\n') };
  }

  lines.push(`  const __fallback = (${fallbackSource});`);
  lines.push(`  for (let __attempt = 0; __attempt < ${attempts}; __attempt++) {`);
  lines.push('    __attempts++;');
  lines.push('    try {');
  lines.push(`      const __value = await (${trigger.source});`);
  lines.push(`      return ${result('__value', false)};`);
  lines.push('    } catch (__error) {');
  lines.push(`      if (__attempt === ${attempts - 1}) return ${result('__fallback', true)};`);
  lines.push('    }');
  lines.push('  }');
  lines.push(`  return ${result('__fallback', true)};`);
  lines.push('})()');
  return { expr: lines.join('\n') };
}

function runtimeRouteRequestLines(route: IRNode, inputSource: string): { lines: string[]; message?: string } {
  const lines = [
    `const __request = ((${inputSource}) ?? {});`,
    'let params = (__request.params ?? {});',
    'let query = (__request.query ?? {});',
    'let body = (__request.body ?? {});',
    'let headers = (__request.headers ?? {});',
  ];
  const declared = new Set<string>();

  for (const name of runtimeRoutePathParamNames(runtimeRoutePath(route))) {
    if (!isRuntimeBindingName(name)) return { lines: [], message: `Runtime route has invalid path param: ${name}` };
    if (declared.has(name)) continue;
    declared.add(name);
    lines.push(`let ${name} = params[${JSON.stringify(name)}];`);
    lines.push(`__kernGuardSyncParam(${JSON.stringify(name)}, ${name});`);
  }

  for (const item of runtimeRouteParamItems(route)) {
    if (!isRuntimeBindingName(item.name)) {
      return { lines: [], message: `Runtime route has invalid params entry: ${item.name}` };
    }
    if (declared.has(item.name)) continue;
    declared.add(item.name);
    const fallback = item.defaultSource ?? 'undefined';
    const key = JSON.stringify(item.name);
    lines.push(`let ${item.name} = query[${key}] ?? params[${key}] ?? (${fallback});`);
    lines.push(`__kernGuardSyncParam(${key}, ${item.name});`);
  }

  return { lines };
}

function runtimeRouteChildProgram(
  children: IRNode[],
  options: RuntimeWorkflowProgramOptions = {},
): { lines: string[]; message?: string } {
  const lines: string[] = [];
  const workflowKind = runtimeWorkflowKind(options);

  for (const child of children) {
    if (child.type === 'handler') {
      const handler = runtimeWorkflowHandlerLines(child, workflowKind);
      if (handler.message) return handler;
      lines.push(...handler.lines);
      continue;
    }
    if (child.type === 'effect') {
      const effectName = runtimeEffectName(child);
      if (!isRuntimeBindingName(effectName)) {
        return { lines: [], message: `Runtime ${workflowKind} effect has invalid name: ${effectName}` };
      }

      const scopedMock = findRuntimeEffectMock(options.mocks, effectName);
      if (scopedMock.message) return { lines: [], message: scopedMock.message };
      if (scopedMock.mock) {
        const mocked = runtimeEffectMockExecutionExpr(scopedMock.mock, { portable: true });
        if (mocked.message || !mocked.expr) {
          return {
            lines: [],
            message: mocked.message || `Runtime ${workflowKind} mock effect ${effectName} cannot be simulated`,
          };
        }
        lines.push(runtimeEffectCoverageCallLine(child));
        lines.push(runtimeEffectMockCallLine(scopedMock.mock));
        lines.push(`const ${effectName} = await (${mocked.expr});`);
        continue;
      }

      const effect = runtimeEffectExecutionExpr(child, { portable: true });
      if (effect.message || !effect.expr) {
        return {
          lines: [],
          message: effect.message || `Runtime ${workflowKind} effect ${effectName} cannot be simulated`,
        };
      }
      lines.push(runtimeEffectCoverageCallLine(child));
      lines.push(`const ${effectName} = await (${effect.expr});`);
      continue;
    }

    if (child.type === 'respond') {
      lines.push(`return (${runtimeRespondSource(child, { portable: true })});`);
      continue;
    }

    if (child.type === 'guard') {
      lines.push(...runtimeGuardStatement(child, { portable: true, trackCoverage: true }));
      continue;
    }

    if (child.type === 'branch') {
      const expr = runtimeRouteBranchExecutionExpr(child, options);
      if (!expr) continue;
      const name = runtimeSyntheticName(child, 'BranchResult');
      lines.push(`const ${name} = await (${expr});`);
      lines.push(`if (${name} !== undefined) return ${name};`);
      continue;
    }

    if (child.type === 'each') {
      const expr = runtimeRouteEachExecutionExpr(child, options);
      if (expr) lines.push(`await (${expr});`);
      continue;
    }

    if (child.type === 'destructure') {
      for (const binding of runtimeDestructureBindings(child)) lines.push(`const ${binding.name} = (${binding.expr});`);
      continue;
    }

    if (child.type === 'partition') {
      for (const binding of runtimePartitionBindings(child)) lines.push(`const ${binding.name} = (${binding.expr});`);
      continue;
    }

    const name = str(getProps(child).name);
    const binding =
      child.type === 'collect'
        ? { expr: runtimeCollectBindingExpr(child, { portable: true }), kind: 'native' as const }
        : runtimeBindingSource(child);
    if (name && binding?.expr && isRuntimeBindingName(name)) {
      lines.push(`const ${name} = (${runtimePortableSource(binding.expr)});`);
    }
  }

  lines.push('return undefined;');
  return { lines };
}

function runtimeWorkflowHandlerLines(
  node: IRNode,
  workflowKind: RuntimeWorkflowKind,
): { lines: string[]; message?: string } {
  const code = str(getProps(node).code).trim();
  if (!code) return { lines: [] };
  const problem = unsafeRuntimeWorkflowReason(code);
  if (problem) {
    return {
      lines: [],
      message: `Runtime ${workflowKind} assertion cannot execute handler: ${problem}`,
    };
  }
  return { lines: code.split('\n') };
}

function runtimeRouteBranchExecutionExpr(node: IRNode, options: RuntimeWorkflowProgramOptions = {}): string {
  const on = runtimePortableSource(rawPropToRuntimeSource(node, 'on'));
  if (!on) return '';

  const lines = ['(async () => {', `  const __branchValue = (${on});`];
  const paths = getChildren(node, 'path');
  for (let index = 0; index < paths.length; index++) {
    const pathNode = paths[index];
    const value = str(getProps(pathNode).value);
    const program = runtimeRouteChildProgram(pathNode.children || [], options);
    if (program.message) return '';
    const keyword = index === 0 ? 'if' : 'else if';
    lines.push(`  ${keyword} (__branchValue === ${JSON.stringify(value)}) {`);
    for (const line of program.lines) lines.push(`    ${line}`);
    lines.push('  }');
  }
  lines.push('  return undefined;');
  lines.push('})()');
  return lines.join('\n');
}

function runtimeRouteEachExecutionExpr(node: IRNode, options: RuntimeWorkflowProgramOptions = {}): string {
  const collection = runtimePortableSource(rawPropToRuntimeSource(node, 'in'));
  const item = str(getProps(node).name) || 'item';
  if (!collection || !isRuntimeBindingName(item)) return '';

  const index = str(getProps(node).index);
  if (index && !isRuntimeBindingName(index)) return '';

  const program = runtimeRouteChildProgram(node.children || [], options);
  if (program.message) return '';

  const lines = ['(async () => {', '  const __results = [];'];
  if (index) {
    lines.push(`  for (const [${index}, ${item}] of (${collection}).entries()) {`);
  } else {
    lines.push(`  for (const ${item} of ${collection}) {`);
  }
  for (const line of program.lines) lines.push(`    ${line}`);
  lines.push('    __results.push(undefined);');
  lines.push('  }');
  lines.push('  return __results;');
  lines.push('})()');
  return lines.join('\n');
}

function runtimeRouteExecutionExpr(
  route: IRNode,
  inputSource: string,
  options: { mocks?: RuntimeEffectMock[]; probe?: boolean } = {},
): { expr?: string; message?: string } {
  const request = runtimeRouteRequestLines(route, inputSource || '{}');
  if (request.message) return { message: request.message };

  const program = runtimeRouteChildProgram(route.children || [], options);
  if (program.message) return { message: program.message };

  const bodyLines = [...runtimeWorkflowHelperLines(), ...request.lines, ...program.lines];
  const lines = ['(async () => {', '  const __kernMockCalls = Object.create(null);'];
  lines.push('  const __kernEffectCalls = Object.create(null);');
  lines.push('  const __kernGuardCalls = Object.create(null);');
  if (options.probe) {
    lines.push('  const __kernRunRoute = async () => {');
    for (const line of bodyLines) lines.push(`    ${line}`);
    lines.push('  };');
    lines.push('  try {');
    lines.push('    const __kernValue = await __kernRunRoute();');
    lines.push(
      '    return { __kernRouteStatus: "returned", value: __kernValue, calls: __kernMockCalls, effects: __kernEffectCalls, guards: __kernGuardCalls };',
    );
    lines.push('  } catch (__kernError) {');
    lines.push('    return {');
    lines.push('      __kernRouteStatus: "thrown",');
    lines.push('      error: {');
    lines.push('        name: __kernError && __kernError.name ? String(__kernError.name) : "Error",');
    lines.push(
      '        message: __kernError && __kernError.message ? String(__kernError.message) : String(__kernError),',
    );
    lines.push('        stack: __kernError && __kernError.stack ? String(__kernError.stack) : undefined,');
    lines.push('      },');
    lines.push('      calls: __kernMockCalls,');
    lines.push('      effects: __kernEffectCalls,');
    lines.push('      guards: __kernGuardCalls,');
    lines.push('    };');
    lines.push('  }');
  } else {
    for (const line of bodyLines) lines.push(`  ${line}`);
  }
  lines.push('})()');
  return { expr: lines.join('\n') };
}

function runtimeToolName(node: IRNode): string {
  return str(getProps(node).name) || 'tool';
}

function findRuntimeTool(target: LoadedKernDocument, toolName: string): { tool?: IRNode; message?: string } {
  const tools = collectNodes(target.root, 'tool').filter((tool) => runtimeToolName(tool) === toolName);
  if (tools.length === 1) return { tool: tools[0] };
  if (tools.length === 0) return { message: `Runtime tool assertion target not found: ${toolName}` };
  return { message: `Runtime tool assertion target is ambiguous: ${toolName}` };
}

function runtimeToolParamItems(tool: IRNode): Array<{ name: string; defaultSource?: string }> {
  const items: Array<{ name: string; defaultSource?: string }> = [];
  for (const param of getChildren(tool, 'param')) {
    const name = str(getProps(param).name);
    if (!name) continue;
    const defaultSource =
      runtimePortableValuePropSource(param, 'value') || runtimePortableValuePropSource(param, 'default');
    items.push({ name, ...(defaultSource ? { defaultSource } : {}) });
  }
  return items;
}

function runtimeToolInputLines(tool: IRNode, inputSource: string): { lines: string[]; message?: string } {
  const lines = [
    `const __toolInput = ((${inputSource}) ?? {});`,
    'let args = __toolInput;',
    'let params = __toolInput;',
  ];
  const declared = new Set<string>();

  for (const item of runtimeToolParamItems(tool)) {
    if (!isRuntimeBindingName(item.name)) {
      return { lines: [], message: `Runtime tool has invalid param: ${item.name}` };
    }
    if (item.name === 'args' || item.name === 'params') {
      return { lines: [], message: `Runtime tool param name is reserved for native context: ${item.name}` };
    }
    if (declared.has(item.name)) continue;
    declared.add(item.name);
    const fallback = item.defaultSource ?? 'undefined';
    const key = JSON.stringify(item.name);
    lines.push(`let ${item.name} = params[${key}] ?? (${fallback});`);
    lines.push(`__kernGuardSyncParam(${key}, ${item.name});`);
    const paramNode = paramNodeByName(tool, item.name);
    for (const guard of paramNode ? getChildren(paramNode, 'guard') : []) {
      lines.push(...runtimeGuardStatement(guard, { portable: true, targetParam: item.name, trackCoverage: true }));
    }
  }

  return { lines };
}

function runtimeToolExecutionExpr(
  tool: IRNode,
  inputSource: string,
  options: { mocks?: RuntimeEffectMock[]; probe?: boolean } = {},
): { expr?: string; message?: string } {
  const input = runtimeToolInputLines(tool, inputSource || '{}');
  if (input.message) return { message: input.message };

  const program = runtimeRouteChildProgram(tool.children || [], { mocks: options.mocks, kind: 'tool' });
  if (program.message) return { message: program.message };

  const bodyLines = [...runtimeWorkflowHelperLines(), ...input.lines, ...program.lines];
  const lines = ['(async () => {', '  const __kernMockCalls = Object.create(null);'];
  lines.push('  const __kernEffectCalls = Object.create(null);');
  lines.push('  const __kernGuardCalls = Object.create(null);');
  if (options.probe) {
    lines.push('  const __kernRunTool = async () => {');
    for (const line of bodyLines) lines.push(`    ${line}`);
    lines.push('  };');
    lines.push('  try {');
    lines.push('    const __kernValue = await __kernRunTool();');
    lines.push(
      '    return { __kernToolStatus: "returned", value: __kernValue, calls: __kernMockCalls, effects: __kernEffectCalls, guards: __kernGuardCalls };',
    );
    lines.push('  } catch (__kernError) {');
    lines.push('    return {');
    lines.push('      __kernToolStatus: "thrown",');
    lines.push('      error: {');
    lines.push('        name: __kernError && __kernError.name ? String(__kernError.name) : "Error",');
    lines.push(
      '        message: __kernError && __kernError.message ? String(__kernError.message) : String(__kernError),',
    );
    lines.push('        stack: __kernError && __kernError.stack ? String(__kernError.stack) : undefined,');
    lines.push('      },');
    lines.push('      calls: __kernMockCalls,');
    lines.push('      effects: __kernEffectCalls,');
    lines.push('      guards: __kernGuardCalls,');
    lines.push('    };');
    lines.push('  }');
  } else {
    for (const line of bodyLines) lines.push(`  ${line}`);
  }
  lines.push('})()');
  return { expr: lines.join('\n') };
}

function runtimeArrayBindingExpr(node: IRNode): string | undefined {
  const collection = rawPropToRuntimeSource(node, 'in');
  switch (node.type) {
    case 'filter':
    case 'find':
    case 'some':
    case 'every':
    case 'findIndex':
      return runtimeArrayPredicateBindingExpr(node, node.type as 'filter' | 'find' | 'some' | 'every' | 'findIndex');
    case 'map':
    case 'flatMap':
      return runtimeArrayProjectionBindingExpr(node, node.type as 'map' | 'flatMap');
    case 'reduce': {
      const body = rawPropToRuntimeSource(node, 'expr');
      const initial = rawPropToRuntimeSource(node, 'initial');
      if (!collection || !body || !initial) return '';
      const acc = runtimeNamedProp(node, 'acc', 'acc');
      const item = runtimeNamedProp(node, 'item', 'item');
      return `((${collection}).reduce((${acc}, ${item}) => ${body}, ${initial}))`;
    }
    case 'slice': {
      if (!collection) return '';
      const start = rawPropToRuntimeSource(node, 'start');
      const end = rawPropToRuntimeSource(node, 'end');
      const args: string[] = [];
      if (start) args.push(start);
      if (end) {
        if (!start) args.push('0');
        args.push(end);
      }
      return `((${collection}).slice(${args.join(', ')}))`;
    }
    case 'flat': {
      if (!collection) return '';
      const depth = rawPropToRuntimeSource(node, 'depth');
      return `((${collection}).flat(${depth}))`;
    }
    case 'at': {
      const index = rawPropToRuntimeSource(node, 'index');
      return collection && index ? `((${collection}).at(${index}))` : '';
    }
    case 'sort': {
      if (!collection) return '';
      const compare = rawPropToRuntimeSource(node, 'compare');
      if (!compare) return `([...(${collection})].sort())`;
      const a = runtimeNamedProp(node, 'a', 'a');
      const b = runtimeNamedProp(node, 'b', 'b');
      return `([...(${collection})].sort((${a}, ${b}) => ${compare}))`;
    }
    case 'reverse':
      return collection ? `([...(${collection})].reverse())` : '';
    case 'join': {
      if (!collection) return '';
      const separator = stringLiteralOrExprPropToRuntimeSource(node, 'separator');
      return `((${collection}).join(${separator}))`;
    }
    case 'includes':
    case 'indexOf':
    case 'lastIndexOf':
      return runtimeArrayValueLookupBindingExpr(node, node.type as 'includes' | 'indexOf' | 'lastIndexOf');
    case 'concat': {
      const withArg = rawPropToRuntimeSource(node, 'with');
      return collection && withArg ? `((${collection}).concat(${withArg}))` : '';
    }
    case 'compact':
      return collection ? `((${collection}).filter(Boolean))` : '';
    case 'pluck': {
      const prop = rawPropToRuntimeSource(node, 'prop');
      if (!collection || !prop) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      return `((${collection}).map((${item}) => ${item}.${prop}))`;
    }
    case 'unique':
      return collection ? `((${collection}).filter((item, index, items) => items.indexOf(item) === index))` : '';
    case 'uniqueBy': {
      const by = rawPropToRuntimeSource(node, 'by');
      if (!collection || !by) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      return `((__seen) => (${collection}).filter((${item}) => { const __k = ${by}; if (__seen.has(__k)) return false; __seen.add(__k); return true; }))(new Set())`;
    }
    case 'groupBy': {
      const by = rawPropToRuntimeSource(node, 'by');
      if (!collection || !by) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      return `((${collection}).reduce((acc, ${item}) => { const __k = ${by}; (acc[__k] ??= []).push(${item}); return acc; }, Object.create(null)))`;
    }
    case 'indexBy': {
      const by = rawPropToRuntimeSource(node, 'by');
      if (!collection || !by) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      return `(Object.fromEntries((${collection}).map((${item}) => [${by}, ${item}])))`;
    }
    case 'countBy': {
      const by = rawPropToRuntimeSource(node, 'by');
      if (!collection || !by) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      return `((${collection}).reduce((acc, ${item}) => { const __k = ${by}; acc[__k] = (acc[__k] ?? 0) + 1; return acc; }, Object.create(null)))`;
    }
    case 'chunk': {
      const size = rawPropToRuntimeSource(node, 'size');
      return collection && size
        ? `((__src, __n) => Array.from({ length: Math.ceil(__src.length / __n) }, (_, i) => __src.slice(i * __n, (i + 1) * __n)))((${collection}), (${size}))`
        : '';
    }
    case 'zip': {
      const right = rawPropToRuntimeSource(node, 'with');
      if (!collection || !right) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      const indexName = runtimeNamedProp(node, 'index', '__i');
      return `((__r) => (${collection}).map((${item}, ${indexName}) => [${item}, __r[${indexName}]]))((${right}))`;
    }
    case 'range': {
      const end = rawPropToRuntimeSource(node, 'end');
      if (!end) return '';
      const start = rawPropToRuntimeSource(node, 'start') || '0';
      return `(Array.from({ length: (${end}) - (${start}) }, (_, i) => i + (${start})))`;
    }
    case 'take': {
      const n = rawPropToRuntimeSource(node, 'n');
      return collection && n ? `((${collection}).slice(0, ${n}))` : '';
    }
    case 'drop': {
      const n = rawPropToRuntimeSource(node, 'n');
      return collection && n ? `((${collection}).slice(${n}))` : '';
    }
    case 'min':
      return collection
        ? `((__src) => __src.length === 0 ? undefined : __src.reduce((__a, __b) => __b < __a ? __b : __a))((${collection}))`
        : '';
    case 'max':
      return collection
        ? `((__src) => __src.length === 0 ? undefined : __src.reduce((__a, __b) => __b > __a ? __b : __a))((${collection}))`
        : '';
    case 'minBy':
    case 'maxBy': {
      const by = rawPropToRuntimeSource(node, 'by');
      if (!collection || !by) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      const op = node.type === 'minBy' ? '<' : '>';
      return `((__src) => { if (__src.length === 0) return undefined; const __key = (${item}) => ${by}; return __src.reduce((__best, __cur) => __key(__cur) ${op} __key(__best) ? __cur : __best); })((${collection}))`;
    }
    case 'sum':
      return collection ? `((${collection}).reduce((acc, n) => acc + n, 0))` : '';
    case 'avg':
      return collection
        ? `((__src) => __src.length === 0 ? Number.NaN : __src.reduce((acc, n) => acc + n, 0) / __src.length)((${collection}))`
        : '';
    case 'sumBy': {
      const by = rawPropToRuntimeSource(node, 'by');
      if (!collection || !by) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      return `((${collection}).reduce((acc, ${item}) => acc + (${by}), 0))`;
    }
    case 'intersect': {
      const right = rawPropToRuntimeSource(node, 'with');
      if (!collection || !right) return '';
      const item = runtimeNamedProp(node, 'item', 'item');
      return `((__r) => (${collection}).filter((${item}) => __r.has(${item})))(new Set((${right})))`;
    }
    default:
      return undefined;
  }
}

function collectRuntimeBindings(root: IRNode): RuntimeBinding[] {
  const bindings: RuntimeBinding[] = [];

  function visit(node: IRNode): void {
    if (node.type === 'route') {
      return;
    }

    if (node.type === 'branch') {
      const name = str(getProps(node).name);
      const expr = runtimeBranchBindingExpr(node);
      if (name && expr) {
        bindings.push({
          name,
          expr,
          kind: 'native',
          line: node.loc?.line,
        });
      }
      return;
    }

    if (node.type === 'each') {
      const binding = runtimeEachExecutionBinding(node);
      if (binding) bindings.push(binding);
      return;
    }

    if (node.type === 'destructure') {
      bindings.push(...runtimeDestructureBindings(node));
    }
    if (node.type === 'partition') {
      bindings.push(...runtimePartitionBindings(node));
    }
    const name = str(getProps(node).name);
    const binding = runtimeBindingSource(node);
    if (name && binding?.expr) {
      bindings.push({
        name,
        expr: binding.expr,
        kind: binding.kind,
        line: node.loc?.line,
      });
    }
    for (const child of node.children || []) visit(child);
  }

  visit(root);
  return bindings;
}

function orderRuntimeBindings(bindings: RuntimeBinding[], entryExpr: string): RuntimeBindingOrder {
  const byName = new Map<string, RuntimeBinding[]>();
  for (const binding of bindings) {
    if (!isRuntimeBindingName(binding.name)) {
      return { ordered: [], error: `invalid runtime binding name '${binding.name}' at line ${binding.line ?? '?'}` };
    }
    byName.set(binding.name, [...(byName.get(binding.name) || []), binding]);
  }

  const ordered: RuntimeBinding[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function depsIn(source: string): string[] {
    return [...byName.keys()].filter((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(source));
  }

  function bindingFor(name: string): RuntimeBinding | undefined {
    const candidates = byName.get(name) || [];
    if (candidates.length <= 1) return candidates[0];
    const [first, ...rest] = candidates;
    throw new Error(
      `duplicate runtime binding '${name}' at line ${rest[0].line ?? '?'} (first at line ${first.line ?? '?'})`,
    );
  }

  function visit(name: string): string | undefined {
    if (visited.has(name)) return undefined;
    if (visiting.has(name)) {
      const start = stack.indexOf(name);
      return `runtime binding cycle: ${[...stack.slice(start), name].join(' -> ')}`;
    }

    let binding: RuntimeBinding | undefined;
    try {
      binding = bindingFor(name);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    if (!binding) return undefined;
    visiting.add(name);
    stack.push(name);
    for (const dep of depsIn(binding.expr)) {
      if (dep === name && binding.kind === 'fn') continue;
      const error = visit(dep);
      if (error) return error;
    }
    stack.pop();
    visiting.delete(name);
    visited.add(name);
    ordered.push(binding);
    return undefined;
  }

  const initialNames = new Set([...bindings.filter((binding) => binding.eager).map((binding) => binding.name)]);
  for (const name of depsIn(entryExpr)) initialNames.add(name);

  for (const name of initialNames) {
    const error = visit(name);
    if (error) return { ordered: [], error };
  }

  return { ordered };
}

function runtimeContext(): Record<string, unknown> {
  return {
    Array,
    Boolean,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RangeError,
    ReferenceError,
    Set,
    String,
    SyntaxError,
    TypeError,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
  };
}

function formatRuntimeValue(value: unknown): string {
  return inspect(value, { breakLength: 80, depth: 4, sorted: true });
}

function runtimeValuesEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (isDeepStrictEqual(actual, expected)) return true;
  try {
    const normalizedActual = JSON.parse(JSON.stringify(actual));
    const normalizedExpected = JSON.parse(JSON.stringify(expected));
    return isDeepStrictEqual(normalizedActual, normalizedExpected);
  } catch {
    return false;
  }
}

function normalizeRuntimeDiffValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function runtimeValueKind(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function runtimePathProperty(base: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

function firstRuntimeValueDifference(expected: unknown, actual: unknown, path = '$', depth = 0): string | undefined {
  if (runtimeValuesEqual(actual, expected)) return undefined;
  if (depth > 16) {
    return `at ${path}: expected ${formatRuntimeValue(expected)}, received ${formatRuntimeValue(actual)}`;
  }

  const expectedKind = runtimeValueKind(expected);
  const actualKind = runtimeValueKind(actual);
  if (expectedKind !== actualKind) {
    return `at ${path}: expected ${expectedKind} ${formatRuntimeValue(expected)}, received ${actualKind} ${formatRuntimeValue(actual)}`;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    const common = Math.min(expected.length, actual.length);
    for (let i = 0; i < common; i++) {
      const diff = firstRuntimeValueDifference(expected[i], actual[i], `${path}[${i}]`, depth + 1);
      if (diff) return diff;
    }
    if (expected.length > actual.length) {
      return `at ${path}[${actual.length}]: missing item; expected ${formatRuntimeValue(expected[actual.length])}`;
    }
    return `at ${path}[${expected.length}]: unexpected item ${formatRuntimeValue(actual[expected.length])}`;
  }

  if (
    expected !== null &&
    actual !== null &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)])].sort();
    for (const key of keys) {
      const nextPath = runtimePathProperty(path, key);
      if (!Object.hasOwn(actualRecord, key)) {
        return `at ${nextPath}: missing property; expected ${formatRuntimeValue(expectedRecord[key])}`;
      }
      if (!Object.hasOwn(expectedRecord, key)) {
        return `at ${nextPath}: unexpected property ${formatRuntimeValue(actualRecord[key])}`;
      }
      const diff = firstRuntimeValueDifference(expectedRecord[key], actualRecord[key], nextPath, depth + 1);
      if (diff) return diff;
    }
  }

  return `at ${path}: expected ${formatRuntimeValue(expected)}, received ${formatRuntimeValue(actual)}`;
}

function runtimeMismatchMessage(label: string, expected: unknown, actual: unknown, context: string): string {
  const normalizedExpected = normalizeRuntimeDiffValue(expected);
  const normalizedActual = normalizeRuntimeDiffValue(actual);
  const diff =
    firstRuntimeValueDifference(normalizedExpected, normalizedActual) ||
    `at $: expected ${formatRuntimeValue(normalizedExpected)}, received ${formatRuntimeValue(normalizedActual)}`;
  return `${label} expected ${formatRuntimeValue(expected)}, received ${formatRuntimeValue(actual)}${context}\ndiff: ${diff}`;
}

function formatThrownRuntimeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function runtimeFixtureSuffix(fixtures: RuntimeBinding[]): string {
  const names = fixtures.map((fixture) => fixture.name).filter(Boolean);
  return names.length > 0 ? `; fixtures: ${names.join(', ')}` : '';
}

function runtimeExpressionContext(expr: string, fixtures: RuntimeBinding[]): string {
  return `; expression: ${expr}${runtimeFixtureSuffix(fixtures)}`;
}

function runtimeBindingUnsafeReason(binding: RuntimeBinding): string | undefined {
  if (binding.kind === 'fn') return unsafeRuntimeFunctionReason(binding.expr);
  if (binding.kind === 'class') return unsafeRuntimeClassReason(binding.expr);
  if (binding.kind === 'workflow') return unsafeRuntimeWorkflowReason(binding.expr);
  if (binding.kind === 'native') return unsafeRuntimeNativeBindingReason(binding.expr);
  return unsafeRuntimeExpressionReason(binding.expr);
}

function thrownRuntimeErrorMatches(error: unknown, expected: string): boolean {
  const normalized = expected.trim();
  if (!normalized || normalized === 'true') return true;
  if (error instanceof Error) {
    return error.name === normalized || error.constructor.name === normalized || error.message.includes(normalized);
  }
  return String(error).includes(normalized);
}

function buildRuntimeDeclarations(
  target: LoadedKernDocument,
  entryExprs: string[],
  fixtures: RuntimeBinding[] = [],
): { source: string; message?: undefined } | { source?: undefined; message: string } {
  for (const entryExpr of entryExprs) {
    const problem = unsafeRuntimeExpressionReason(entryExpr, { allowAwait: true });
    if (problem) {
      return { message: `Runtime expr assertion cannot execute expression: ${problem}` };
    }
  }

  const bindings = orderRuntimeBindings([...collectRuntimeBindings(target.root!), ...fixtures], entryExprs.join(' '));
  if (bindings.error) {
    return { message: `Runtime expr assertion cannot execute target bindings: ${bindings.error}` };
  }

  const declarations: string[] = [];
  for (const binding of bindings.ordered) {
    const bindingProblem = runtimeBindingUnsafeReason(binding);
    if (bindingProblem) {
      return {
        message: `Runtime expr assertion cannot execute target binding '${binding.name}': ${bindingProblem}`,
      };
    }
    declarations.push(`const ${binding.name} = (${binding.expr});`);
  }

  return { source: declarations.join('\n') };
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function needsAsyncRuntime(declarations: string, expr: string): boolean {
  return /\b(?:async|await|Promise)\b/.test(`${declarations}\n${expr}`);
}

function decodeRuntimeValue(encoded: EncodedRuntimeValue): unknown {
  switch (encoded.type) {
    case 'undefined':
      return undefined;
    case 'number':
      if (encoded.value === 'NaN') return Number.NaN;
      return encoded.value === 'Infinity' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    case 'bigint':
      return BigInt(encoded.value);
    case 'unserializable':
      return encoded.value;
    case 'json':
      return encoded.value;
  }
}

function decodeRuntimeError(encoded: EncodedRuntimeError | undefined): Error {
  const error = new Error(encoded?.message || 'Runtime evaluation failed');
  error.name = encoded?.name || 'Error';
  if (encoded?.stack) error.stack = encoded.stack;
  return error;
}

function asyncRuntimeChildSource(): string {
  return `
const { readFileSync } = require('fs');
const { createContext, Script } = require('vm');

function encodeRuntimeValue(value) {
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'number' && Number.isNaN(value)) return { type: 'number', value: 'NaN' };
  if (value === Number.POSITIVE_INFINITY) return { type: 'number', value: 'Infinity' };
  if (value === Number.NEGATIVE_INFINITY) return { type: 'number', value: '-Infinity' };
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
  try {
    JSON.stringify(value);
    return { type: 'json', value };
  } catch {
    return { type: 'unserializable', value: String(value) };
  }
}

function encodeRuntimeError(error) {
  return {
    name: error && error.name ? String(error.name) : 'Error',
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : undefined,
  };
}

function runtimeContext() {
  return {
    Array,
    Boolean,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RangeError,
    ReferenceError,
    Set,
    String,
    SyntaxError,
    TypeError,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
  };
}

(async () => {
  const input = JSON.parse(readFileSync(0, 'utf-8'));
  try {
    const script = new Script('"use strict";\\n' + input.declarations + '\\n(async () => (' + input.expr + '))();', {
      filename: input.filename || 'native-kern-test:async',
    });
    const value = await script.runInContext(createContext(runtimeContext()), { timeout: input.timeout });
    process.stdout.write(JSON.stringify({ ok: true, value: encodeRuntimeValue(value) }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: encodeRuntimeError(error) }));
  }
})().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: encodeRuntimeError(error) }));
});
`;
}

function runRuntimeExpressionAsync(target: LoadedKernDocument, declarations: string, expr: string): RuntimeEvalResult {
  try {
    const output = execFileSync(process.execPath, ['-e', asyncRuntimeChildSource()], {
      input: JSON.stringify({
        declarations,
        expr,
        filename: `native-kern-test:${target.file}`,
        timeout: RUNTIME_EXPR_TIMEOUT_MS,
      }),
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      timeout: RUNTIME_ASYNC_PROCESS_TIMEOUT_MS,
    });
    const decoded = JSON.parse(output) as
      | { ok: true; value: EncodedRuntimeValue }
      | { ok: false; error?: EncodedRuntimeError };
    return decoded.ok
      ? { ok: true, value: decodeRuntimeValue(decoded.value) }
      : { ok: false, error: decodeRuntimeError(decoded.error) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: new Error(`Async runtime evaluation failed: ${message}`) };
  }
}

function runRuntimeExpressionSync(target: LoadedKernDocument, declarations: string, expr: string): RuntimeEvalResult {
  try {
    const script = new Script(`"use strict";\n${declarations}\n(${expr});`, {
      filename: `native-kern-test:${target.file}`,
    });
    return {
      ok: true,
      value: script.runInContext(createContext(runtimeContext()), {
        timeout: RUNTIME_EXPR_TIMEOUT_MS,
      }),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

function runRuntimeExpression(target: LoadedKernDocument, declarations: string, expr: string): RuntimeEvalResult {
  if (needsAsyncRuntime(declarations, expr)) return runRuntimeExpressionAsync(target, declarations, expr);
  const syncResult = runRuntimeExpressionSync(target, declarations, expr);
  if (syncResult.ok && isThenable(syncResult.value)) return runRuntimeExpressionAsync(target, declarations, expr);
  return syncResult;
}

function evaluateRuntimeThrows(
  node: IRNode,
  target: LoadedKernDocument,
  declarations: string,
  expr: string,
  fixtures: RuntimeBinding[],
  label = 'Runtime expr',
): { passed: boolean; message?: string } {
  const props = getProps(node);
  const expectedRaw = props.throws === true || props.throws === '' ? 'true' : String(props.throws ?? 'true');
  const actual = runRuntimeExpression(target, declarations, expr);
  if (actual.ok) {
    return {
      passed: false,
      message:
        str(props.message) ||
        `${label} was expected to throw${expectedRaw && expectedRaw !== 'true' ? ` ${expectedRaw}` : ''}, but returned ${formatRuntimeValue(actual.value)}${runtimeExpressionContext(expr, fixtures)}`,
    };
  }
  if (!thrownRuntimeErrorMatches(actual.error, expectedRaw)) {
    return {
      passed: false,
      message:
        str(props.message) ||
        `${label} threw ${formatThrownRuntimeError(actual.error)}, expected ${expectedRaw}${runtimeExpressionContext(expr, fixtures)}`,
    };
  }
  return { passed: true };
}

function evaluateRuntimeSource(
  node: IRNode,
  target: LoadedKernDocument,
  expr: string,
  fixtures: RuntimeBinding[] = [],
  label = 'Runtime expr',
  expectedPropName = 'equals',
): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const trimmedExpr = expr.trim();
  if (!trimmedExpr) return { passed: false, message: `${label} assertion requires an executable expression` };

  const expectedSource =
    runtimeExpectedSource(node, expectedPropName) ??
    (expectedPropName === 'equals' ? undefined : runtimeExpectedSource(node, 'equals'));
  const expectedLabel = expectedPropName !== 'equals' && expectedPropName in props ? expectedPropName : 'equals';
  const expressionSources = expectedSource ? [trimmedExpr, expectedSource] : [trimmedExpr];
  const declarations = buildRuntimeDeclarations(target, expressionSources, fixtures);
  if ('message' in declarations) return { passed: false, message: declarations.message };
  const declarationSource = declarations.source;

  if ('throws' in props) {
    return evaluateRuntimeThrows(node, target, declarationSource, trimmedExpr, fixtures, label);
  }

  const actual = runRuntimeExpression(target, declarationSource, trimmedExpr);
  if (!actual.ok) {
    return {
      passed: false,
      message: `${label} threw: ${actual.error instanceof Error ? actual.error.message : String(actual.error)}${runtimeExpressionContext(trimmedExpr, fixtures)}`,
    };
  }

  if (expectedSource !== undefined) {
    const expected = runRuntimeExpression(target, declarationSource, expectedSource);
    if (!expected.ok) {
      return {
        passed: false,
        message: `Runtime expr assertion cannot execute expected ${expectedLabel} value: ${formatThrownRuntimeError(
          expected.error,
        )}`,
      };
    }
    return runtimeValuesEqual(actual.value, expected.value)
      ? { passed: true }
      : {
          passed: false,
          message:
            str(props.message) ||
            runtimeMismatchMessage(
              label,
              expected.value,
              actual.value,
              runtimeExpressionContext(trimmedExpr, fixtures),
            ),
        };
  }

  if ('matches' in props) {
    const pattern = runtimePatternValue(node, 'matches') || '';
    try {
      const regex = new RegExp(pattern);
      return regex.test(String(actual.value))
        ? { passed: true }
        : {
            passed: false,
            message:
              str(props.message) ||
              `${label} value ${formatRuntimeValue(actual.value)} does not match /${pattern}/${runtimeExpressionContext(trimmedExpr, fixtures)}`,
          };
    } catch (error) {
      return {
        passed: false,
        message: `Runtime expr assertion has invalid matches regex: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return actual.value
    ? { passed: true }
    : {
        passed: false,
        message: str(props.message) || `${label} evaluated false${runtimeExpressionContext(trimmedExpr, fixtures)}`,
      };
}

function evaluateRuntimeExpression(
  node: IRNode,
  target: LoadedKernDocument,
  fixtures: RuntimeBinding[] = [],
): { passed: boolean; message?: string } {
  const props = getProps(node);
  const expr = exprToString(props.expr).trim();
  if (!expr) return { passed: false, message: 'Runtime expr assertion requires expr={{...}}' };
  return evaluateRuntimeSource(node, target, expr, fixtures);
}

function targetHasNamedNode(target: LoadedKernDocument, type: string, name: string): boolean {
  return collectNodes(target.root, type).some((node) => str(getProps(node).name) === name);
}

function runtimeCallExpression(node: IRNode, fnName: string): { expr?: string; message?: string } {
  const props = getProps(node);
  const argsSource = exprToString(props.args).trim();
  const withSource = exprToString(props.with).trim();

  if (argsSource && withSource) {
    return { message: 'Runtime fn assertion cannot combine args={{...}} and with={{...}}' };
  }
  if (argsSource) return { expr: `${fnName}(...(${argsSource}))` };
  if (withSource) return { expr: `${fnName}(${withSource})` };
  return { expr: `${fnName}()` };
}

function evaluateRuntimeBehavior(
  node: IRNode,
  target: LoadedKernDocument,
  fixtures: RuntimeBinding[] = [],
): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const fnName = str(props.fn);
  const deriveName = str(props.derive);

  if (fnName && deriveName)
    return { passed: false, message: 'Runtime behavior assertion cannot combine fn and derive' };

  if (fnName) {
    if (!targetHasNamedNode(target, 'fn', fnName)) {
      return { passed: false, message: `Runtime fn assertion target not found: ${fnName}` };
    }
    const call = runtimeCallExpression(node, fnName);
    if (call.message) return { passed: false, message: call.message };
    return evaluateRuntimeSource(node, target, call.expr || '', fixtures, `Runtime fn ${fnName}`);
  }

  if (deriveName) {
    if (!targetHasNamedNode(target, 'derive', deriveName)) {
      return { passed: false, message: `Runtime derive assertion target not found: ${deriveName}` };
    }
    return evaluateRuntimeSource(node, target, deriveName, fixtures, `Runtime derive ${deriveName}`);
  }

  return { passed: false, message: 'Runtime behavior assertion requires fn=<name> or derive=<name>' };
}

function evaluateRuntimeRoute(
  node: IRNode,
  target: LoadedKernDocument,
  fixtures: RuntimeBinding[] = [],
  mocks: RuntimeEffectMock[] = [],
  mockCalls?: Map<string, number>,
  effectCalls?: Map<string, number>,
  guardCalls?: Map<string, number>,
): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const routeSpec = str(props.route);
  if (!routeSpec) return { passed: false, message: 'Runtime route assertion requires route="METHOD /path"' };

  const found = findRuntimeRoute(target, routeSpec);
  if (found.message || !found.route)
    return { passed: false, message: found.message || 'Runtime route target not found' };

  const inputSource = runtimeValuePropSource(node, 'with') || runtimeValuePropSource(node, 'input') || '{}';
  const inputProblem = unsafeRuntimeExpressionReason(inputSource, { allowAwait: true });
  if (inputProblem) {
    return { passed: false, message: `Runtime route assertion cannot execute request input: ${inputProblem}` };
  }

  const routeExpr = runtimeRouteExecutionExpr(found.route, inputSource, { mocks, probe: true });
  if (routeExpr.message || !routeExpr.expr) {
    return { passed: false, message: routeExpr.message || 'Runtime route assertion cannot build route workflow' };
  }

  const routeBinding: RuntimeBinding = {
    name: runtimeSyntheticName(node, 'Route'),
    expr: routeExpr.expr,
    kind: 'workflow',
    line: node.loc?.line,
  };

  const label = `Runtime route ${runtimeRouteLabel(found.route)}`;
  const expectedSource = runtimeExpectedSource(node, 'returns') ?? runtimeExpectedSource(node, 'equals');
  const expectedLabel = 'returns' in props ? 'returns' : 'equals';
  const expressionSources = expectedSource ? [routeBinding.name, expectedSource] : [routeBinding.name];
  const declarations = buildRuntimeDeclarations(target, expressionSources, [...fixtures, routeBinding]);
  if ('message' in declarations) return { passed: false, message: declarations.message };
  const routeContext = runtimeExpressionContext(routeBinding.name, [...fixtures, routeBinding]);

  const actual = runRuntimeExpression(target, declarations.source, routeBinding.name);
  if (!actual.ok) {
    return {
      passed: false,
      message: `${label} threw: ${
        actual.error instanceof Error ? actual.error.message : String(actual.error)
      }${routeContext}`,
    };
  }

  const probe = actual.value as {
    __kernRouteStatus?: unknown;
    value?: unknown;
    error?: EncodedRuntimeError;
    calls?: Record<string, number>;
    effects?: Record<string, number>;
    guards?: Record<string, number>;
  };
  if (!probe || typeof probe !== 'object' || typeof probe.__kernRouteStatus !== 'string') {
    return { passed: false, message: `${label} returned an invalid runtime probe` };
  }
  mergeRuntimeEffectMockCalls(mockCalls, probe.calls);
  mergeRuntimeEffectCoverageCalls(effectCalls, probe.effects);
  mergeRuntimeGuardCoverageCalls(guardCalls, probe.guards);

  if ('throws' in props) {
    const expectedRaw = props.throws === true || props.throws === '' ? 'true' : String(props.throws ?? 'true');
    if (probe.__kernRouteStatus !== 'thrown') {
      return {
        passed: false,
        message:
          str(props.message) ||
          `${label} was expected to throw${
            expectedRaw && expectedRaw !== 'true' ? ` ${expectedRaw}` : ''
          }, but returned ${formatRuntimeValue(probe.value)}${routeContext}`,
      };
    }
    const error = decodeRuntimeError(probe.error);
    if (!thrownRuntimeErrorMatches(error, expectedRaw)) {
      return {
        passed: false,
        message:
          str(props.message) ||
          `${label} threw ${formatThrownRuntimeError(error)}, expected ${expectedRaw}${routeContext}`,
      };
    }
    return { passed: true };
  }

  if (probe.__kernRouteStatus === 'thrown') {
    return {
      passed: false,
      message: `${label} threw: ${formatThrownRuntimeError(decodeRuntimeError(probe.error))}${routeContext}`,
    };
  }

  if (expectedSource !== undefined) {
    const expected = runRuntimeExpression(target, declarations.source, expectedSource);
    if (!expected.ok) {
      return {
        passed: false,
        message: `Runtime route assertion cannot execute expected ${expectedLabel} value: ${formatThrownRuntimeError(
          expected.error,
        )}${routeContext}`,
      };
    }
    return runtimeValuesEqual(probe.value, expected.value)
      ? { passed: true }
      : {
          passed: false,
          message: str(props.message) || runtimeMismatchMessage(label, expected.value, probe.value, routeContext),
        };
  }

  if ('matches' in props) {
    const pattern = runtimePatternValue(node, 'matches') || '';
    try {
      const regex = new RegExp(pattern);
      return regex.test(String(probe.value))
        ? { passed: true }
        : {
            passed: false,
            message:
              str(props.message) ||
              `${label} value ${formatRuntimeValue(probe.value)} does not match /${pattern}/${routeContext}`,
          };
    } catch (error) {
      return {
        passed: false,
        message: `Runtime route assertion has invalid matches regex: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return probe.value
    ? { passed: true }
    : { passed: false, message: str(props.message) || `${label} evaluated false${routeContext}` };
}

function evaluateRuntimeTool(
  node: IRNode,
  target: LoadedKernDocument,
  fixtures: RuntimeBinding[] = [],
  mocks: RuntimeEffectMock[] = [],
  mockCalls?: Map<string, number>,
  effectCalls?: Map<string, number>,
  guardCalls?: Map<string, number>,
): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const toolName = str(props.tool);
  if (!toolName) return { passed: false, message: 'Runtime tool assertion requires tool=<name>' };

  const found = findRuntimeTool(target, toolName);
  if (found.message || !found.tool) {
    return { passed: false, message: found.message || 'Runtime tool target not found' };
  }

  const inputSource = runtimeValuePropSource(node, 'with') || runtimeValuePropSource(node, 'input') || '{}';
  const inputProblem = unsafeRuntimeExpressionReason(inputSource, { allowAwait: true });
  if (inputProblem) {
    return { passed: false, message: `Runtime tool assertion cannot execute input: ${inputProblem}` };
  }

  const toolExpr = runtimeToolExecutionExpr(found.tool, inputSource, { mocks, probe: true });
  if (toolExpr.message || !toolExpr.expr) {
    return { passed: false, message: toolExpr.message || 'Runtime tool assertion cannot build tool workflow' };
  }

  const toolBinding: RuntimeBinding = {
    name: runtimeSyntheticName(node, 'Tool'),
    expr: toolExpr.expr,
    kind: 'workflow',
    line: node.loc?.line,
  };

  const label = `Runtime tool ${runtimeToolName(found.tool)}`;
  const expectedSource = runtimeExpectedSource(node, 'returns') ?? runtimeExpectedSource(node, 'equals');
  const expectedLabel = 'returns' in props ? 'returns' : 'equals';
  const expressionSources = expectedSource ? [toolBinding.name, expectedSource] : [toolBinding.name];
  const declarations = buildRuntimeDeclarations(target, expressionSources, [...fixtures, toolBinding]);
  if ('message' in declarations) return { passed: false, message: declarations.message };
  const toolContext = runtimeExpressionContext(toolBinding.name, [...fixtures, toolBinding]);

  const actual = runRuntimeExpression(target, declarations.source, toolBinding.name);
  if (!actual.ok) {
    return {
      passed: false,
      message: `${label} threw: ${
        actual.error instanceof Error ? actual.error.message : String(actual.error)
      }${toolContext}`,
    };
  }

  const probe = actual.value as {
    __kernToolStatus?: unknown;
    value?: unknown;
    error?: EncodedRuntimeError;
    calls?: Record<string, number>;
    effects?: Record<string, number>;
    guards?: Record<string, number>;
  };
  if (!probe || typeof probe !== 'object' || typeof probe.__kernToolStatus !== 'string') {
    return { passed: false, message: `${label} returned an invalid runtime probe` };
  }
  mergeRuntimeEffectMockCalls(mockCalls, probe.calls);
  mergeRuntimeEffectCoverageCalls(effectCalls, probe.effects);
  mergeRuntimeGuardCoverageCalls(guardCalls, probe.guards);

  if ('throws' in props) {
    const expectedRaw = props.throws === true || props.throws === '' ? 'true' : String(props.throws ?? 'true');
    if (probe.__kernToolStatus !== 'thrown') {
      return {
        passed: false,
        message:
          str(props.message) ||
          `${label} was expected to throw${
            expectedRaw && expectedRaw !== 'true' ? ` ${expectedRaw}` : ''
          }, but returned ${formatRuntimeValue(probe.value)}${toolContext}`,
      };
    }
    const error = decodeRuntimeError(probe.error);
    if (!thrownRuntimeErrorMatches(error, expectedRaw)) {
      return {
        passed: false,
        message:
          str(props.message) ||
          `${label} threw ${formatThrownRuntimeError(error)}, expected ${expectedRaw}${toolContext}`,
      };
    }
    return { passed: true };
  }

  if (probe.__kernToolStatus === 'thrown') {
    return {
      passed: false,
      message: `${label} threw: ${formatThrownRuntimeError(decodeRuntimeError(probe.error))}${toolContext}`,
    };
  }

  if (expectedSource !== undefined) {
    const expected = runRuntimeExpression(target, declarations.source, expectedSource);
    if (!expected.ok) {
      return {
        passed: false,
        message: `Runtime tool assertion cannot execute expected ${expectedLabel} value: ${formatThrownRuntimeError(
          expected.error,
        )}${toolContext}`,
      };
    }
    return runtimeValuesEqual(probe.value, expected.value)
      ? { passed: true }
      : {
          passed: false,
          message: str(props.message) || runtimeMismatchMessage(label, expected.value, probe.value, toolContext),
        };
  }

  if ('matches' in props) {
    const pattern = runtimePatternValue(node, 'matches') || '';
    try {
      const regex = new RegExp(pattern);
      return regex.test(String(probe.value))
        ? { passed: true }
        : {
            passed: false,
            message:
              str(props.message) ||
              `${label} value ${formatRuntimeValue(probe.value)} does not match /${pattern}/${toolContext}`,
          };
    } catch (error) {
      return {
        passed: false,
        message: `Runtime tool assertion has invalid matches regex: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return probe.value
    ? { passed: true }
    : { passed: false, message: str(props.message) || `${label} evaluated false${toolContext}` };
}

function findRuntimeEffect(target: LoadedKernDocument, effectName: string): { effect?: IRNode; message?: string } {
  const effects = collectNodes(target.root, 'effect').filter((effect) => runtimeEffectName(effect) === effectName);
  if (effects.length === 1) return { effect: effects[0] };
  if (effects.length === 0) return { message: `Runtime effect assertion target not found: ${effectName}` };
  return { message: `Runtime effect assertion target is ambiguous: ${effectName}` };
}

function runtimeEffectExpectedSource(node: IRNode): { source?: string; label?: string } {
  const fallback = runtimeExpectedSource(node, 'fallback');
  if (fallback !== undefined) return { source: fallback, label: 'fallback' };
  const returns = runtimeExpectedSource(node, 'returns');
  if (returns !== undefined) return { source: returns, label: 'returns' };
  const equals = runtimeExpectedSource(node, 'equals');
  if (equals !== undefined) return { source: equals, label: 'equals' };
  return {};
}

function evaluateRuntimeEffectRecovery(
  node: IRNode,
  target: LoadedKernDocument,
  effect: IRNode,
  fixtures: RuntimeBinding[],
  mocks: RuntimeEffectMock[] = [],
  mockCalls?: Map<string, number>,
): { passed: boolean; message?: string } {
  const props = getProps(node);
  const effectName = runtimeEffectName(effect);

  const scopedMock = findRuntimeEffectMock(mocks, effectName);
  if (scopedMock.message) return { passed: false, message: scopedMock.message };
  const effectExpr = scopedMock.mock
    ? runtimeEffectMockExecutionExpr(scopedMock.mock, { portable: true, meta: true })
    : runtimeEffectExecutionExpr(effect, { portable: true, meta: true });
  if (effectExpr.message || !effectExpr.expr) {
    return { passed: false, message: effectExpr.message || `Runtime effect ${effectName} cannot be simulated` };
  }
  const effectBinding: RuntimeBinding = {
    name: runtimeSyntheticName(node, 'Effect'),
    expr: effectExpr.expr,
    kind: 'workflow',
    line: node.loc?.line,
  };

  const expected = runtimeEffectExpectedSource(node);
  const entryExprs = expected.source ? [effectBinding.name, expected.source] : [effectBinding.name];
  const declarations = buildRuntimeDeclarations(target, entryExprs, [...fixtures, effectBinding]);
  if ('message' in declarations) return { passed: false, message: declarations.message };
  const effectContext = runtimeExpressionContext(effectBinding.name, [...fixtures, effectBinding]);

  const actual = runRuntimeExpression(target, declarations.source, effectBinding.name);
  if (scopedMock.mock) recordRuntimeEffectMockCall(scopedMock.mock, mockCalls);
  if (!actual.ok) {
    return {
      passed: false,
      message: `Runtime effect ${effectName} threw: ${formatThrownRuntimeError(actual.error)}`,
    };
  }

  const meta = actual.value as { result?: unknown; recovered?: unknown; attempts?: unknown };
  if (isTruthy(props.recovers) && meta.recovered !== true) {
    return {
      passed: false,
      message:
        str(props.message) || `Runtime effect ${effectName} was expected to recover, but completed without recovery`,
    };
  }

  if (expected.source !== undefined) {
    const expectedResult = runRuntimeExpression(target, declarations.source, expected.source);
    if (!expectedResult.ok) {
      return {
        passed: false,
        message: `Runtime effect assertion cannot execute expected ${expected.label} value: ${formatThrownRuntimeError(
          expectedResult.error,
        )}`,
      };
    }
    return runtimeValuesEqual(meta.result, expectedResult.value)
      ? { passed: true }
      : {
          passed: false,
          message:
            str(props.message) ||
            runtimeMismatchMessage(`Runtime effect ${effectName}`, expectedResult.value, meta.result, effectContext),
        };
  }

  return { passed: true };
}

function evaluateRuntimeEffect(
  node: IRNode,
  target: LoadedKernDocument,
  fixtures: RuntimeBinding[] = [],
  mocks: RuntimeEffectMock[] = [],
  mockCalls?: Map<string, number>,
): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const effectName = str(props.effect);
  if (!effectName) return { passed: false, message: 'Runtime effect assertion requires effect=<name>' };

  const found = findRuntimeEffect(target, effectName);
  if (found.message || !found.effect) {
    return { passed: false, message: found.message || 'Runtime effect target not found' };
  }

  if (isTruthy(props.recovers)) {
    return evaluateRuntimeEffectRecovery(node, target, found.effect, fixtures, mocks, mockCalls);
  }

  const scopedMock = findRuntimeEffectMock(mocks, effectName);
  if (scopedMock.message) return { passed: false, message: scopedMock.message };
  const effectExpr = scopedMock.mock
    ? runtimeEffectMockExecutionExpr(scopedMock.mock, { portable: true })
    : runtimeEffectExecutionExpr(found.effect, { portable: true });
  if (effectExpr.message || !effectExpr.expr) {
    return { passed: false, message: effectExpr.message || `Runtime effect ${effectName} cannot be simulated` };
  }
  const effectBinding: RuntimeBinding = {
    name: runtimeSyntheticName(node, 'Effect'),
    expr: effectExpr.expr,
    kind: 'workflow',
    line: node.loc?.line,
  };

  const evaluated = evaluateRuntimeSource(
    node,
    target,
    effectBinding.name,
    [...fixtures, effectBinding],
    `Runtime effect ${effectName}`,
    'returns',
  );
  if (scopedMock.mock && !isAssertionConfigurationFailure(evaluated.message)) {
    recordRuntimeEffectMockCall(scopedMock.mock, mockCalls);
  }
  return evaluated;
}

function expectedMockCallCount(node: IRNode): { count?: number; message?: string } {
  const raw = getProps(node).called;
  const count = Number(raw);
  if (raw === '' || !Number.isInteger(count) || count < 0) {
    return { message: `Runtime mock call assertion requires called=<non-negative integer>, got ${String(raw)}` };
  }
  return { count };
}

function evaluateRuntimeMockCall(
  node: IRNode,
  mocks: RuntimeEffectMock[] = [],
  mockCalls?: Map<string, number>,
  checkedMocks?: Set<string>,
): { passed: boolean; message?: string } {
  const props = getProps(node);
  const effectName = str(props.mock);
  if (!effectName) return { passed: false, message: 'Runtime mock call assertion requires mock=<effect>' };
  if (!('called' in props)) return { passed: false, message: 'Runtime mock call assertion requires called=<count>' };

  const expected = expectedMockCallCount(node);
  if (expected.message || expected.count === undefined) return { passed: false, message: expected.message };

  const scopedMock = findRuntimeEffectMock(mocks, effectName);
  if (scopedMock.message) return { passed: false, message: scopedMock.message };
  if (!scopedMock.mock) return { passed: false, message: `Runtime mock assertion target not found: ${effectName}` };

  markRuntimeEffectMockChecked(scopedMock.mock, checkedMocks);
  const actual = mockCalls?.get(scopedMock.mock.id) || 0;
  return actual === expected.count
    ? { passed: true }
    : {
        passed: false,
        message:
          str(props.message) ||
          `Native effect mock effect=${effectName} expected called=${expected.count}, received called=${actual}`,
      };
}

function nodeSearchText(node: IRNode): string {
  const props = getProps(node);
  const parts = [
    exprToString(props.expr),
    str(props.pattern),
    str(props.allow),
    str(props.allowlist),
    str(props.covers),
    str(props.kind),
    str(props.type),
  ];
  for (const child of node.children || []) {
    if (child.type === 'handler') parts.push(str(getProps(child).code));
  }
  return parts.filter(Boolean).join('\n');
}

function unionVariantNames(union: IRNode): string[] {
  return getChildren(union, 'variant')
    .map((variant) => str(getProps(variant).name) || str(getProps(variant).type))
    .filter(Boolean);
}

function isVariantGuardCandidate(guard: IRNode): boolean {
  const props = getProps(guard);
  const kind = guardKind(guard);
  return Boolean(
    str(props.over) || str(props.union) || str(props.covers) || kind === 'variant' || kind === 'exhaustive',
  );
}

function resolveGuardUnion(root: IRNode | undefined, guard: IRNode, requestedUnion?: string): IRNode | undefined {
  const unions = collectNodes(root, 'union');
  const guardProps = getProps(guard);
  const unionName = requestedUnion || str(guardProps.over) || str(guardProps.union);
  if (unionName) return unions.find((candidate) => str(getProps(candidate).name) === unionName);

  const covered = new Set(parseNameList(str(guardProps.covers)));
  if (covered.size > 0) {
    const candidates = unions.filter((union) => {
      const variants = new Set(unionVariantNames(union));
      return [...covered].every((variant) => variants.has(variant));
    });
    if (candidates.length === 1) return candidates[0];
  }

  return unions.length === 1 ? unions[0] : undefined;
}

function guardCoveredVariants(guard: IRNode, assertion?: IRNode): Set<string> {
  return new Set([
    ...(assertion ? parseNameList(str(getProps(assertion).covers)) : []),
    ...parseNameList(str(getProps(guard).covers)),
    ...parseNameList(str(getProps(guard).allow)),
  ]);
}

function missingGuardVariants(guard: IRNode, union: IRNode, assertion?: IRNode): string[] {
  const explicitCoverage = guardCoveredVariants(guard, assertion);
  const searchable = nodeSearchText(guard);
  return unionVariantNames(union).filter((variant) => {
    if (explicitCoverage.has(variant)) return false;
    return !new RegExp(`(?:^|[^A-Za-z0-9_$])${escapeRegExp(variant)}(?:$|[^A-Za-z0-9_$])`).test(searchable);
  });
}

function evaluateGuardExhaustiveness(node: IRNode, target: LoadedKernDocument): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const guardName = str(props.guard);
  if (!guardName) return { passed: false, message: 'Guard exhaustiveness assertion requires guard=<name>' };
  if (!isTruthy(props.exhaustive))
    return { passed: false, message: 'Guard exhaustiveness assertion requires exhaustive=true' };

  const guard = collectNodes(target.root, 'guard').find((candidate) => str(getProps(candidate).name) === guardName);
  if (!guard) return { passed: false, message: `Guard not found: ${guardName}` };

  const unionName = str(props.over) || str(props.union);
  const union = resolveGuardUnion(target.root, guard, unionName);

  if (!union) {
    return {
      passed: false,
      message: unionName
        ? `Union not found for guard exhaustiveness: ${unionName}`
        : 'Guard exhaustiveness needs over=<UnionName> when the target has zero or multiple unions',
    };
  }

  const variants = unionVariantNames(union);
  if (variants.length === 0) return { passed: false, message: `Union ${str(getProps(union).name)} has no variants` };

  const missing = missingGuardVariants(guard, union, node);

  return missing.length > 0
    ? {
        passed: false,
        message: `Guard ${guardName} is not exhaustive over ${str(getProps(union).name)}; missing variants: ${missing.join(', ')}`,
      }
    : { passed: true };
}

function findNonExhaustiveGuards(root: IRNode): string[] {
  const failures: string[] = [];
  for (const guard of collectNodes(root, 'guard')) {
    if (!isVariantGuardCandidate(guard)) continue;

    const props = getProps(guard);
    const unionName = str(props.over) || str(props.union);
    const union = resolveGuardUnion(root, guard, unionName);
    const label = `${nodeLabel(guard)} at line ${guard.loc?.line ?? '?'}`;
    if (!union) {
      failures.push(
        unionName
          ? `${label} references unknown union ${unionName}`
          : `${label} cannot infer union; add over=<UnionName> or union=<UnionName>`,
      );
      continue;
    }

    const variants = unionVariantNames(union);
    if (variants.length === 0) {
      failures.push(`${label} targets union ${str(getProps(union).name)} with no variants`);
      continue;
    }

    const missing = missingGuardVariants(guard, union);
    if (missing.length > 0) {
      failures.push(
        `${label} is not exhaustive over ${str(getProps(union).name)}; missing variants: ${missing.join(', ')}`,
      );
    }
  }
  return failures;
}

interface NodeMatch {
  node: IRNode;
  ancestors: IRNode[];
}

function collectNodeMatches(
  root: IRNode | undefined,
  type: string,
  matches: NodeMatch[] = [],
  ancestors: IRNode[] = [],
): NodeMatch[] {
  if (!root) return matches;
  if (root.type === type) matches.push({ node: root, ancestors });
  for (const child of root.children || []) collectNodeMatches(child, type, matches, [...ancestors, root]);
  return matches;
}

function ancestorMatches(ancestor: IRNode, expected: string): boolean {
  return ancestor.type === expected || str(getProps(ancestor).name) === expected || nodeLabel(ancestor) === expected;
}

function propComparableValue(value: unknown): string {
  if (value === undefined) return '<missing>';
  const expr = exprToString(value);
  return expr || String(value);
}

function evaluateNodeAssertion(node: IRNode, target: LoadedKernDocument): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const type = str(props.node);
  if (!type) return { passed: false, message: 'Node assertion requires node=<type>' };

  const name = str(props.name);
  const within = str(props.within);
  const prop = str(props.prop);
  const expectedProp = props.is === undefined ? undefined : propComparableValue(props.is);
  const childType = str(props.child);
  const childName = str(props.childName);
  const expectedCount = props.count === undefined || props.count === '' ? undefined : Number(props.count);
  if (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 0)) {
    return { passed: false, message: `Node assertion count must be a non-negative integer: ${String(props.count)}` };
  }

  const matches = collectNodeMatches(target.root, type)
    .filter((match) => !name || str(getProps(match.node).name) === name)
    .filter((match) => !within || match.ancestors.some((ancestor) => ancestorMatches(ancestor, within)));
  if (matches.length === 0) {
    return {
      passed: false,
      message: `KERN node not found: ${type}${name ? ` name=${name}` : ''}${within ? ` within=${within}` : ''}`,
    };
  }

  if (prop) {
    const propMatches = matches.filter((match) => {
      const actual = propComparableValue(getProps(match.node)[prop]);
      return expectedProp === undefined || actual === expectedProp;
    });
    if (propMatches.length === 0) {
      const actuals = matches.map((match) => propComparableValue(getProps(match.node)[prop]));
      return {
        passed: false,
        message:
          expectedProp === undefined
            ? `KERN node ${type}${name ? ` name=${name}` : ''} has no prop ${prop}`
            : `KERN node ${type}${name ? ` name=${name}` : ''} prop ${prop} expected ${expectedProp}, found ${actuals.join(', ')}`,
      };
    }
  }

  if (childType) {
    const childMatches = matches.flatMap((match) =>
      getChildren(match.node, childType).filter((child) => !childName || str(getProps(child).name) === childName),
    );
    if (expectedCount !== undefined) {
      return childMatches.length === expectedCount
        ? { passed: true }
        : {
            passed: false,
            message: `KERN node ${type}${name ? ` name=${name}` : ''} expected ${expectedCount} child ${childType}${childName ? ` name=${childName}` : ''}, found ${childMatches.length}`,
          };
    }
    return childMatches.length > 0
      ? { passed: true }
      : {
          passed: false,
          message: `KERN node ${type}${name ? ` name=${name}` : ''} missing child ${childType}${childName ? ` name=${childName}` : ''}`,
        };
  }

  if (expectedCount !== undefined) {
    return matches.length === expectedCount
      ? { passed: true }
      : { passed: false, message: `Expected ${expectedCount} KERN node ${type} matches, found ${matches.length}` };
  }

  return { passed: true };
}

function evaluateNoInvariant(
  node: IRNode,
  target: LoadedKernDocument,
  context?: NativeKernAssertionContext,
): { passed: boolean; message?: string } {
  if (target.readError) return { passed: false, message: target.readError };

  const invariant = normalizeInvariant(str(getProps(node).no));
  const machineName = str(getProps(node).machine) || undefined;

  if (invariant === 'parseerrors') {
    const error = firstParseError(target);
    return error
      ? { passed: false, message: `Found parse error at ${target.file}:${error.line}:${error.col}: ${error.message}` }
      : { passed: true };
  }

  if (invariant === 'schemaviolations') {
    const violation = target.schemaViolations[0];
    return violation
      ? {
          passed: false,
          message: `Found schema violation at ${target.file}:${violation.line ?? 1}:${violation.col ?? 1}: ${violation.message}`,
        }
      : { passed: true };
  }

  if (invariant === 'semanticviolations') {
    const violation = target.semanticViolations[0];
    return violation
      ? {
          passed: false,
          message: `Found semantic violation at ${target.file}:${violation.line ?? 1}:${violation.col ?? 1}: ${violation.message}`,
        }
      : { passed: true };
  }

  if (invariant === 'codegenerrors' || invariant === 'codegenerationerrors' || invariant === 'compileerrors') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const errors = findCodegenErrors(target.root!);
    return errors.length > 0
      ? { passed: false, message: `Found codegen errors: ${errors.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'cycles' || invariant === 'derivecycles') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const cycles = findDeriveCycles(target.root!);
    return cycles.length > 0
      ? { passed: false, message: `Found derive cycle: ${cycles[0].join(' -> ')}` }
      : { passed: true };
  }

  if (invariant === 'deadstates' || invariant === 'unreachablestates') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const unreachable = findUnreachableStates(target.root!, machineName);
    return unreachable.length > 0
      ? { passed: false, message: `Found unreachable machine states: ${unreachable.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'duplicatetransitions') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const duplicates = findDuplicateTransitions(target.root!, machineName);
    return duplicates.length > 0
      ? { passed: false, message: `Found duplicate machine transitions: ${duplicates.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'duplicateroutes') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const duplicates = findDuplicateRoutes(target.root!);
    return duplicates.length > 0
      ? { passed: false, message: `Found duplicate routes: ${duplicates.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'emptyroutes' || invariant === 'missingroutehandlers' || invariant === 'missingrouteresponses') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const emptyRoutes = findEmptyRoutes(target.root!);
    return emptyRoutes.length > 0
      ? { passed: false, message: `Found empty routes: ${emptyRoutes.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'duplicatenames' || invariant === 'duplicatesiblingnames') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const duplicates = findDuplicateSiblingNames(target.root!);
    return duplicates.length > 0
      ? { passed: false, message: `Found duplicate sibling names: ${duplicates.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'weakguards' || invariant === 'guardwithoutelse' || invariant === 'guardswithoutelse') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const weakGuards = findWeakGuards(target.root!);
    return weakGuards.length > 0
      ? { passed: false, message: `Found weak guards: ${weakGuards.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'nonexhaustiveguards' || invariant === 'guardexhaustiveness' || invariant === 'exhaustiveguards') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const nonExhaustive = findNonExhaustiveGuards(target.root!);
    return nonExhaustive.length > 0
      ? { passed: false, message: `Found non-exhaustive guards: ${nonExhaustive.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'unguardedeffects') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const unguarded = findUnguardedEffects(target.root!);
    return unguarded.length > 0
      ? { passed: false, message: `Found unguarded effects: ${unguarded.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'unvalidatedroutes' || invariant === 'unguardedmutatingroutes') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const unvalidated = findUnvalidatedMutatingRoutes(target.root!);
    return unvalidated.length > 0
      ? { passed: false, message: `Found unvalidated mutating routes: ${unvalidated.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'rawhandlers' || invariant === 'handlerescapes') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const handlers = findRawHandlerEscapes(target.root!);
    return handlers.length > 0
      ? {
          passed: false,
          message: `Found raw handler escapes: ${handlers.slice(0, 10).join('; ')}${handlers.length > 10 ? `; +${handlers.length - 10} more` : ''}`,
        }
      : { passed: true };
  }

  if (invariant === 'invalidguards' || invariant === 'guardmisconfigurations') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const invalidGuards = findInvalidGuards(target.root!);
    return invalidGuards.length > 0
      ? { passed: false, message: `Found invalid guards: ${invalidGuards.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'duplicateparams' || invariant === 'duplicateparameters') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const duplicates = findDuplicateParams(target.root!);
    return duplicates.length > 0
      ? { passed: false, message: `Found duplicate params: ${duplicates.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'unguardedtoolparams' || invariant === 'unguardedrequiredparams') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const unguarded = findUnguardedRequiredToolParams(target.root!);
    return unguarded.length > 0
      ? { passed: false, message: `Found unguarded required tool params: ${unguarded.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'missingpathguards' || invariant === 'pathparamguards') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const missing = findMissingPathGuards(target.root!);
    return missing.length > 0
      ? { passed: false, message: `Found missing path guards: ${missing.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'ssrfrisks' || invariant === 'ssrf') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const risks = findSsrfRisks(target.root!);
    return risks.length > 0 ? { passed: false, message: `Found SSRF risks: ${risks.join('; ')}` } : { passed: true };
  }

  if (invariant === 'sensitiveeffectsrequireauth' || invariant === 'missingeffectauth' || invariant === 'missingauth') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const missing = findSensitiveEffectsWithoutAuth(target.root!);
    return missing.length > 0
      ? { passed: false, message: `Found sensitive effects without auth: ${missing.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'uncheckedroutepathparams' || invariant === 'routepathparams') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const unchecked = findUncheckedRoutePathParams(target.root!);
    return unchecked.length > 0
      ? { passed: false, message: `Found unchecked route path params: ${unchecked.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'effectwithoutcleanup' || invariant === 'effectcleanup') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const effects = findEffectsWithoutCleanup(target.root!);
    return effects.length > 0
      ? { passed: false, message: `Found effects without cleanup: ${effects.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'unrecoveredasync' || invariant === 'asyncrecover') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const asyncBlocks = findUnrecoveredAsync(target.root!);
    return asyncBlocks.length > 0
      ? { passed: false, message: `Found unrecovered async blocks: ${asyncBlocks.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'untestedtransitions' || invariant === 'uncoveredtransitions') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const untested = findUntestedTransitions(target.root!, context, machineName);
    return untested.length > 0
      ? { passed: false, message: `Found untested machine transitions: ${untested.join('; ')}` }
      : { passed: true };
  }

  if (invariant === 'untestedguards' || invariant === 'uncoveredguards') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const untested = findUntestedGuards(target.root!, context);
    return untested.length > 0
      ? {
          passed: false,
          message: `Found untested guards: ${untested.join('; ')}. Add expect guard=<name> exhaustive=true, a route/tool workflow assertion that executes the guard, or a guard-wide assertion such as expect preset=guard.`,
        }
      : { passed: true };
  }

  if (invariant === 'untestedroutes' || invariant === 'uncoveredroutes') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const untested = findUntestedRoutes(target.root!, context);
    return untested.length > 0
      ? {
          passed: false,
          message: `Found untested routes: ${untested.join('; ')}. Add expect route="METHOD /path" assertions for each route.`,
        }
      : { passed: true };
  }

  if (invariant === 'untestedtools' || invariant === 'uncoveredtools') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const untested = findUntestedTools(target.root!, context);
    return untested.length > 0
      ? {
          passed: false,
          message: `Found untested tools: ${untested.join('; ')}. Add expect tool=<name> assertions for each MCP tool.`,
        }
      : { passed: true };
  }

  if (invariant === 'untestedeffects' || invariant === 'uncoveredeffects') {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
    const untested = findUntestedEffects(target.root!, context);
    return untested.length > 0
      ? {
          passed: false,
          message: `Found untested effects: ${untested.join('; ')}. Add expect effect=<name> assertions for deterministic effects.`,
        }
      : { passed: true };
  }

  return { passed: false, message: `Unsupported native invariant: no=${str(getProps(node).no)}` };
}

function diagnosticFinding(file: string, issue: { line?: number; col?: number; message: string }): string {
  return `${file}:${issue.line ?? 1}:${issue.col ?? 1}: ${issue.message}`;
}

function nativeInvariantFindings(
  node: IRNode,
  target: LoadedKernDocument,
  context?: NativeKernAssertionContext,
): { findings?: string[]; message?: string } {
  if (target.readError) return { message: target.readError };

  const props = getProps(node);
  const invariant = normalizeInvariant(str(props.has) || str(props.no));
  const machineName = str(props.machine) || undefined;

  if (invariant === 'parseerrors') {
    return {
      findings: target.diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map((diagnostic) => diagnosticFinding(target.file, diagnostic)),
    };
  }

  if (invariant === 'schemaviolations') {
    return { findings: target.schemaViolations.map((violation) => diagnosticFinding(target.file, violation)) };
  }

  if (invariant === 'semanticviolations') {
    return { findings: target.semanticViolations.map((violation) => diagnosticFinding(target.file, violation)) };
  }

  const blocking = targetBlockingMessage(target);
  if (blocking) return { message: blocking };

  const root = target.root!;

  if (invariant === 'codegenerrors' || invariant === 'codegenerationerrors' || invariant === 'compileerrors') {
    return { findings: findCodegenErrors(root) };
  }

  if (invariant === 'cycles' || invariant === 'derivecycles') {
    return { findings: findDeriveCycles(root).map((cycle) => cycle.join(' -> ')) };
  }

  if (invariant === 'deadstates' || invariant === 'unreachablestates') {
    return { findings: findUnreachableStates(root, machineName) };
  }

  if (invariant === 'duplicatetransitions') {
    return { findings: findDuplicateTransitions(root, machineName) };
  }

  if (invariant === 'duplicateroutes') {
    return { findings: findDuplicateRoutes(root) };
  }

  if (invariant === 'emptyroutes' || invariant === 'missingroutehandlers' || invariant === 'missingrouteresponses') {
    return { findings: findEmptyRoutes(root) };
  }

  if (invariant === 'duplicatenames' || invariant === 'duplicatesiblingnames') {
    return { findings: findDuplicateSiblingNames(root) };
  }

  if (invariant === 'weakguards' || invariant === 'guardwithoutelse' || invariant === 'guardswithoutelse') {
    return { findings: findWeakGuards(root) };
  }

  if (invariant === 'nonexhaustiveguards' || invariant === 'guardexhaustiveness' || invariant === 'exhaustiveguards') {
    return { findings: findNonExhaustiveGuards(root) };
  }

  if (invariant === 'unguardedeffects') {
    return { findings: findUnguardedEffects(root) };
  }

  if (invariant === 'unvalidatedroutes' || invariant === 'unguardedmutatingroutes') {
    return { findings: findUnvalidatedMutatingRoutes(root) };
  }

  if (invariant === 'rawhandlers' || invariant === 'handlerescapes') {
    return { findings: findRawHandlerEscapes(root) };
  }

  if (invariant === 'invalidguards' || invariant === 'guardmisconfigurations') {
    return { findings: findInvalidGuards(root) };
  }

  if (invariant === 'duplicateparams' || invariant === 'duplicateparameters') {
    return { findings: findDuplicateParams(root) };
  }

  if (invariant === 'unguardedtoolparams' || invariant === 'unguardedrequiredparams') {
    return { findings: findUnguardedRequiredToolParams(root) };
  }

  if (invariant === 'missingpathguards' || invariant === 'pathparamguards') {
    return { findings: findMissingPathGuards(root) };
  }

  if (invariant === 'ssrfrisks' || invariant === 'ssrf') {
    return { findings: findSsrfRisks(root) };
  }

  if (invariant === 'sensitiveeffectsrequireauth' || invariant === 'missingeffectauth' || invariant === 'missingauth') {
    return { findings: findSensitiveEffectsWithoutAuth(root) };
  }

  if (invariant === 'uncheckedroutepathparams' || invariant === 'routepathparams') {
    return { findings: findUncheckedRoutePathParams(root) };
  }

  if (invariant === 'effectwithoutcleanup' || invariant === 'effectcleanup') {
    return { findings: findEffectsWithoutCleanup(root) };
  }

  if (invariant === 'unrecoveredasync' || invariant === 'asyncrecover') {
    return { findings: findUnrecoveredAsync(root) };
  }

  if (invariant === 'untestedtransitions' || invariant === 'uncoveredtransitions') {
    return { findings: findUntestedTransitions(root, context, machineName) };
  }

  if (invariant === 'untestedguards' || invariant === 'uncoveredguards') {
    return { findings: findUntestedGuards(root, context) };
  }

  if (invariant === 'untestedroutes' || invariant === 'uncoveredroutes') {
    return { findings: findUntestedRoutes(root, context) };
  }

  if (invariant === 'untestedtools' || invariant === 'uncoveredtools') {
    return { findings: findUntestedTools(root, context) };
  }

  if (invariant === 'untestedeffects' || invariant === 'uncoveredeffects') {
    return { findings: findUntestedEffects(root, context) };
  }

  const propName = 'has' in props ? 'has' : 'no';
  return { message: `Unsupported native invariant: ${propName}=${str(props.has) || str(props.no)}` };
}

function evaluateHasInvariant(
  node: IRNode,
  target: LoadedKernDocument,
  context?: NativeKernAssertionContext,
): { passed: boolean; message?: string } {
  const props = getProps(node);
  const invariant = str(props.has);
  const normalized = normalizeInvariant(invariant);
  const expectedCount = props.count === undefined || props.count === '' ? undefined : Number(props.count);
  if (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 0)) {
    return {
      passed: false,
      message: `Native has assertion count must be a non-negative integer: ${String(props.count)}`,
    };
  }

  if (expectedCount !== undefined) {
    const collected = nativeInvariantFindings(node, target, context);
    if (collected.message) return { passed: false, message: collected.message };

    const findings = collected.findings || [];
    if (findings.length !== expectedCount) {
      const details = findings.length > 0 ? `: ${findings.slice(0, 10).join('; ')}` : '';
      const extra = findings.length > 10 ? `; +${findings.length - 10} more` : '';
      return {
        passed: false,
        message: `Expected target to have ${invariant || '<missing>'} count ${expectedCount}, found ${findings.length}${details}${extra}`,
      };
    }

    if ('matches' in props) {
      const pattern = runtimePatternValue(node, 'matches') || '';
      const message = findings.join('; ');
      try {
        const regex = new RegExp(pattern);
        return regex.test(message)
          ? { passed: true }
          : {
              passed: false,
              message: `Expected ${invariant || '<missing>'} findings to match /${pattern}/, got: ${message || '<none>'}`,
            };
      } catch (error) {
        return {
          passed: false,
          message: `Native has assertion has invalid matches regex: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return { passed: true };
  }

  if (!['parseerrors', 'schemaviolations', 'semanticviolations'].includes(normalized)) {
    const blocking = targetBlockingMessage(target);
    if (blocking) return { passed: false, message: blocking };
  }
  const evaluated = evaluateNoInvariant(nodeWithProps(node, { ...props, no: invariant }), target, context);

  if (isAssertionConfigurationFailure(evaluated.message)) {
    return { passed: false, message: evaluated.message };
  }

  if (evaluated.passed) {
    return {
      passed: false,
      message: `Expected target to have ${invariant || '<missing>'}, but none was found`,
    };
  }

  if ('matches' in props) {
    const pattern = runtimePatternValue(node, 'matches') || '';
    try {
      const regex = new RegExp(pattern);
      return regex.test(evaluated.message || '')
        ? { passed: true }
        : {
            passed: false,
            message: `Expected ${invariant || '<missing>'} message to match /${pattern}/, got: ${evaluated.message || '<none>'}`,
          };
    } catch (error) {
      return {
        passed: false,
        message: `Native has assertion has invalid matches regex: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { passed: true };
}

function evaluateMachineReachability(node: IRNode, target: LoadedKernDocument): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const machineName = str(props.machine);
  const targetState = str(props.reaches);
  const fromState = str(props.from);
  const throughStates = parseNameList(str(props.through));
  const avoidedStates = new Set([...parseNameList(str(props.avoid)), ...parseNameList(str(props.avoids))]);
  const maxSteps = props.maxSteps === undefined || props.maxSteps === '' ? undefined : Number(props.maxSteps);
  if (!machineName) {
    return { passed: false, message: 'Machine reachability assertion requires machine=<name>' };
  }
  if (!targetState) {
    return { passed: false, message: 'Machine reachability assertion requires reaches=<state>' };
  }
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 0)) {
    return {
      passed: false,
      message: `Machine reachability maxSteps must be a non-negative integer: ${String(props.maxSteps)}`,
    };
  }
  const machine = collectNodes(target.root, 'machine').find(
    (candidate) => str(getProps(candidate).name) === machineName,
  );

  if (!machine) return { passed: false, message: `Machine not found: ${machineName}` };

  const states = getChildren(machine, 'state').map((state) => ({
    name: str(getProps(state).name),
    initial: isTruthy(getProps(state).initial),
  }));
  const transitions = getChildren(machine, 'transition').map((transition) => ({
    name: str(getProps(transition).name),
    from: parseNameList(str(getProps(transition).from)),
    to: str(getProps(transition).to),
  }));
  const initialState = states.find((state) => state.initial)?.name || states[0]?.name;

  if (!initialState) return { passed: false, message: `Machine ${machineName} has no states` };
  const startState = fromState || initialState;
  if (!states.some((state) => state.name === startState)) {
    return { passed: false, message: `State not found in machine ${machineName}: ${startState}` };
  }
  if (!states.some((state) => state.name === targetState)) {
    return { passed: false, message: `State not found in machine ${machineName}: ${targetState}` };
  }
  for (const through of throughStates) {
    if (!states.some((state) => state.name === through)) {
      return { passed: false, message: `State not found in machine ${machineName}: ${through}` };
    }
  }
  if (avoidedStates.has(startState)) {
    return { passed: false, message: `Path starts at avoided state ${startState} in machine ${machineName}` };
  }

  const via = parseList(str(props.via));
  if (via.length > 0) {
    let current = startState;
    const pathStates = [current];
    for (const transitionName of via) {
      const transition = transitions.find(
        (candidate) => candidate.name === transitionName && candidate.from.includes(current),
      );
      if (!transition) {
        return {
          passed: false,
          message: `Transition ${transitionName} is not reachable from state ${current} in machine ${machineName}`,
        };
      }
      current = transition.to;
      pathStates.push(current);
      if (avoidedStates.has(current)) {
        return {
          passed: false,
          message: `Path ${via.join(' -> ')} reaches avoided state ${current} in machine ${machineName}`,
        };
      }
    }
    if (maxSteps !== undefined && via.length > maxSteps) {
      return {
        passed: false,
        message: `Path ${via.join(' -> ')} uses ${via.length} transitions, above maxSteps=${maxSteps}`,
      };
    }
    const missingThrough = throughStates.filter((state) => !pathStates.includes(state));
    if (missingThrough.length > 0) {
      return {
        passed: false,
        message: `Path ${via.join(' -> ')} does not pass through required state(s): ${missingThrough.join(', ')}`,
      };
    }
    return current === targetState
      ? { passed: true, message: `Path ${via.join(' -> ')} reaches ${targetState}` }
      : { passed: false, message: `Path ${via.join(' -> ')} ended at ${current}, not ${targetState}` };
  }

  const defaultMaxDepth = Math.max(transitions.length + states.length, states.length);
  const maxDepth = maxSteps ?? defaultMaxDepth;
  const queue: { state: string; path: string[]; states: string[] }[] = [
    { state: startState, path: [], states: [startState] },
  ];
  const initialSatisfiedThrough = throughStates.filter((state) => state === startState).join(',');
  const visited = new Set<string>([`${startState}:${initialSatisfiedThrough}`]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const missingThrough = throughStates.filter((state) => !current.states.includes(state));
    if (current.state === targetState && missingThrough.length === 0) {
      return {
        passed: true,
        message:
          current.path.length > 0
            ? `Path ${current.path.join(' -> ')} reaches ${targetState}`
            : 'Target is initial state',
      };
    }
    if (current.path.length >= maxDepth) continue;
    for (const transition of transitions.filter((candidate) => candidate.from.includes(current.state))) {
      if (avoidedStates.has(transition.to)) continue;
      const nextStates = [...current.states, transition.to];
      const satisfiedThrough = throughStates.filter((state) => nextStates.includes(state)).join(',');
      const key = `${transition.to}:${satisfiedThrough}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ state: transition.to, path: [...current.path, transition.name], states: nextStates });
    }
  }

  return {
    passed: false,
    message: `State ${targetState} is not reachable from ${startState} in machine ${machineName}`,
  };
}

function evaluateMachineTransitionAssertion(
  node: IRNode,
  target: LoadedKernDocument,
): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const machineName = str(props.machine);
  const transitionName = str(props.transition);
  if (!machineName) return { passed: false, message: 'Machine transition assertion requires machine=<name>' };
  if (!transitionName) return { passed: false, message: 'Machine transition assertion requires transition=<name>' };

  const machine = collectNodes(target.root, 'machine').find(
    (candidate) => str(getProps(candidate).name) === machineName,
  );
  if (!machine) return { passed: false, message: `Machine not found: ${machineName}` };

  const fromState = str(props.from);
  const toState = str(props.to);
  const guarded = props.guarded === undefined || props.guarded === '' ? undefined : isTruthy(props.guarded);
  const transitions = getChildren(machine, 'transition').filter((transition) => {
    const transitionProps = getProps(transition);
    if (str(transitionProps.name) !== transitionName) return false;
    if (fromState && !parseNameList(str(transitionProps.from)).includes(fromState)) return false;
    if (toState && str(transitionProps.to) !== toState) return false;
    if (guarded !== undefined) {
      const hasGuard = transitionProps.guard !== undefined && transitionProps.guard !== '';
      if (hasGuard !== guarded) return false;
    }
    return true;
  });

  if (transitions.length > 0) return { passed: true };

  const declared = getChildren(machine, 'transition')
    .filter((transition) => str(getProps(transition).name) === transitionName)
    .map((transition) => {
      const transitionProps = getProps(transition);
      return `${str(transitionProps.name)} from=${str(transitionProps.from) || '<missing>'} to=${str(transitionProps.to) || '<missing>'}${transitionProps.guard !== undefined && transitionProps.guard !== '' ? ' guarded=true' : ' guarded=false'}`;
    });
  return {
    passed: false,
    message:
      declared.length > 0
        ? `Machine ${machineName} transition ${transitionName} did not match constraints from=${fromState || '<any>'} to=${toState || '<any>'}${guarded !== undefined ? ` guarded=${guarded}` : ''}; declared: ${declared.join('; ')}`
        : `Machine ${machineName} transition not found: ${transitionName}`,
  };
}

function nodeWithProps(node: IRNode, props: Record<string, unknown>): IRNode {
  return { ...node, props };
}

function presetInvariants(node: IRNode): string[] | undefined {
  const preset = normalizeInvariant(str(getProps(node).preset));
  if (!preset) return undefined;
  return NATIVE_TEST_PRESETS[preset];
}

function evaluatePresetAssertion(
  node: IRNode,
  target: LoadedKernDocument,
  context?: NativeKernAssertionContext,
): EvaluatedAssertion[] {
  const preset = str(getProps(node).preset);
  const invariants = presetInvariants(node);
  if (!invariants) {
    return [
      {
        ruleId: presetRuleId(preset),
        assertion: `preset ${preset || '<missing>'}`,
        passed: false,
        severity: 'error',
        message: `Unsupported native preset: preset=${preset || '<missing>'}`,
      },
    ];
  }

  return invariants.map((invariant) => {
    const evaluated = evaluateNoInvariant(nodeWithProps(node, { ...getProps(node), no: invariant }), target, context);
    return {
      ruleId: invariantRuleId(invariant),
      assertion: `preset ${preset} / no ${invariant}`,
      passed: evaluated.passed,
      ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
      ...(evaluated.message ? { message: evaluated.message } : {}),
    };
  });
}

function evaluateNativeAssertion(
  node: IRNode,
  target: LoadedKernDocument,
  context?: NativeKernAssertionContext,
): EvaluatedAssertion[] {
  const props = getProps(node);
  if ('decompile' in props) {
    const evaluated = evaluateDecompileAssertion(node, target);
    return [
      {
        ruleId: 'decompile',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('import' in props) {
    const evaluated = evaluateImportAssertion(node, context);
    return [
      {
        ruleId: 'import',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('roundtrip' in props) {
    const evaluated = evaluateRoundtripAssertion(node, target);
    return [
      {
        ruleId: 'roundtrip',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('codegen' in props) {
    const evaluated = evaluateCodegenAssertion(node, target);
    return [
      {
        ruleId: 'codegen',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('preset' in props) return evaluatePresetAssertion(node, target, context);
  if ('node' in props) {
    const evaluated = evaluateNodeAssertion(node, target);
    return [
      {
        ruleId: 'kern:node',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('no' in props) {
    const evaluated = evaluateNoInvariant(node, target, context);
    return [
      {
        ruleId: invariantRuleId(str(props.no)),
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('has' in props) {
    const evaluated = evaluateHasInvariant(node, target, context);
    return [
      {
        ruleId: hasInvariantRuleId(str(props.has)),
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('guard' in props) {
    const evaluated = evaluateGuardExhaustiveness(node, target);
    return [
      {
        ruleId: 'guard:exhaustive',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('machine' in props && 'transition' in props) {
    const evaluated = evaluateMachineTransitionAssertion(node, target);
    return [
      {
        ruleId: 'machine:transition',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('machine' in props || 'reaches' in props) {
    const evaluated = evaluateMachineReachability(node, target);
    return [
      {
        ruleId: 'machine:reaches',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('fn' in props || 'derive' in props) {
    const evaluated = evaluateRuntimeBehavior(node, target, context?.fixtures || []);
    return [
      {
        ruleId: 'runtime:behavior',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('route' in props) {
    const evaluated = evaluateRuntimeRoute(
      node,
      target,
      context?.fixtures || [],
      context?.mocks || [],
      context?.mockCalls,
    );
    return [
      {
        ruleId: 'runtime:route',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('tool' in props) {
    const evaluated = evaluateRuntimeTool(
      node,
      target,
      context?.fixtures || [],
      context?.mocks || [],
      context?.mockCalls,
    );
    return [
      {
        ruleId: 'runtime:tool',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('effect' in props) {
    const evaluated = evaluateRuntimeEffect(
      node,
      target,
      context?.fixtures || [],
      context?.mocks || [],
      context?.mockCalls,
    );
    return [
      {
        ruleId: 'runtime:effect',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('mock' in props || 'called' in props) {
    const evaluated = evaluateRuntimeMockCall(node, context?.mocks || [], context?.mockCalls, context?.checkedMocks);
    return [
      {
        ruleId: 'mock:called',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  if ('expr' in props) {
    const evaluated = evaluateRuntimeExpression(node, target, context?.fixtures || []);
    return [
      {
        ruleId: 'expr',
        assertion: assertionLabel(node),
        passed: evaluated.passed,
        ...(isAssertionConfigurationFailure(evaluated.message) ? { severity: 'error' as const } : {}),
        ...(evaluated.message ? { message: evaluated.message } : {}),
      },
    ];
  }
  return [
    {
      ruleId: 'expect:unsupported',
      assertion: assertionLabel(node),
      passed: false,
      severity: 'error',
      message: 'Unsupported native expect assertion.',
    },
  ];
}

export function hasNativeKernTests(source: string): boolean {
  return collectNodes(parseDocumentWithDiagnostics(source).root, 'test').length > 0;
}

function isKernFile(file: string): boolean {
  return file.endsWith('.kern');
}

function hasNativeKernTestsInFile(file: string): boolean {
  try {
    return hasNativeKernTests(readFileSync(file, 'utf-8'));
  } catch {
    return false;
  }
}

function discoverNativeKernTestFilesInDir(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!DISCOVERY_SKIP_DIRS.has(entry.name)) walk(join(current, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;
      const file = join(current, entry.name);
      if (isKernFile(file) && hasNativeKernTestsInFile(file)) files.push(resolve(file));
    }
  }

  walk(dir);
  return files.sort();
}

export function discoverNativeKernTestFiles(input: string): string[] {
  const inputPath = resolve(input);
  if (!existsSync(inputPath)) return [];

  const stat = statSync(inputPath);
  if (stat.isDirectory()) return discoverNativeKernTestFilesInDir(inputPath);
  if (stat.isFile() && isKernFile(inputPath) && hasNativeKernTestsInFile(inputPath)) return [inputPath];
  return [];
}

export function runNativeKernTests(file: string, options: NativeKernTestOptions = {}): NativeKernTestSummary {
  const inputPath = resolve(file);
  const testDoc = loadKernDocument(inputPath);
  const results: NativeKernTestResult[] = [];
  const targetFiles = new Set<string>();
  const coverageExcludedTargetFiles = new Set<string>();
  const coverageIncludedTargetFiles = new Set<string>();

  if (testDoc.readError) {
    results.push(issueResult(inputPath, testDoc.readError));
    return summarizeNativeTestRun(inputPath, targetFiles, results);
  }

  const parseError = firstParseError(testDoc);
  if (parseError) {
    results.push(issueResult(inputPath, parseError.message, parseError));
    return summarizeNativeTestRun(inputPath, targetFiles, results);
  }

  const schemaViolation = testDoc.schemaViolations[0];
  if (schemaViolation) {
    results.push(issueResult(inputPath, schemaViolation.message, schemaViolation));
    return summarizeNativeTestRun(inputPath, targetFiles, results);
  }

  const testNodes = collectNodes(testDoc.root, 'test');
  const targetCache = new Map<string, LoadedKernDocument>([[inputPath, testDoc]]);
  const assertionsByTarget = new Map<string, CollectedAssertion[]>();

  const summarize = () =>
    summarizeNativeTestRun(
      inputPath,
      targetFiles,
      results,
      createCoverageSummary(
        [...targetFiles]
          .sort()
          .filter(
            (targetFile) => !coverageExcludedTargetFiles.has(targetFile) || coverageIncludedTargetFiles.has(targetFile),
          )
          .map((targetFile) => {
            const target = targetCache.get(targetFile);
            return coverageForTarget(
              target || {
                file: targetFile,
                diagnostics: [],
                schemaViolations: [],
                semanticViolations: [],
                readError: `Target not loaded: ${targetFile}`,
              },
              assertionsByTarget.get(targetFile) || [],
            );
          }),
      ),
    );

  for (const testNode of testNodes) {
    const suite = str(getProps(testNode).name) || 'unnamed test';
    const targetProp = str(getProps(testNode).target);
    const targetPath = targetProp ? resolve(dirname(inputPath), targetProp) : inputPath;
    targetFiles.add(targetPath);
    if (testNodeContributesCoverage(testNode)) {
      coverageIncludedTargetFiles.add(targetPath);
    } else {
      coverageExcludedTargetFiles.add(targetPath);
    }

    let target = targetCache.get(targetPath);
    if (!target) {
      target = loadKernDocument(targetPath);
      targetCache.set(targetPath, target);
    }

    const assertions = collectAssertions(testNode);
    const declaredMocks = new Map<string, RuntimeEffectMock>();
    for (const assertion of assertions) {
      for (const mock of assertion.mocks) declaredMocks.set(mock.id, mock);
    }
    const mockCalls = new Map<string, number>();
    const checkedMocks = new Set<string>();
    assertionsByTarget.set(targetPath, [...(assertionsByTarget.get(targetPath) || []), ...assertions]);
    if (assertions.length === 0) {
      results.push({
        suite,
        caseName: 'suite',
        ruleId: 'suite:hasassertions',
        assertion: 'has native expect assertions',
        severity: 'error',
        status: 'failed',
        message:
          'No native expect assertions found. Add expect machine=..., expect no=deriveCycles, or expect no=schemaViolations.',
        file: inputPath,
        line: testNode.loc?.line,
        col: testNode.loc?.col,
      });
      continue;
    }

    for (const assertion of assertions) {
      const context: NativeKernAssertionContext = {
        assertions,
        testFile: inputPath,
        fixtures: assertion.fixtures,
        mocks: assertion.mocks,
        mockCalls,
        checkedMocks,
      };
      const requestedSeverity = severityFromNode(assertion.node);
      for (const evaluated of evaluateNativeAssertion(assertion.node, target, context)) {
        const severity = effectiveSeverity(requestedSeverity, evaluated);
        const result: NativeKernTestResult = {
          suite: assertion.suite,
          caseName: assertion.caseName,
          ruleId: evaluated.ruleId,
          assertion: evaluated.assertion,
          severity,
          status: statusForEvaluation(evaluated.passed, severity),
          ...(evaluated.message ? { message: evaluated.message } : {}),
          file: inputPath,
          line: assertion.node.loc?.line,
          col: assertion.node.loc?.col,
        };
        if (!grepMatches(options, result)) continue;
        results.push(result);
        if (options.bail && result.status === 'failed') {
          return summarize();
        }
      }
    }

    for (const mock of declaredMocks.values()) {
      if ((mockCalls.get(mock.id) || 0) > 0 || checkedMocks.has(mock.id)) continue;
      const result: NativeKernTestResult = {
        suite,
        caseName: 'mock usage',
        ruleId: 'mock:unused',
        assertion: `mock effect ${mock.effect}`,
        severity: 'error',
        status: 'failed',
        message: `Native effect mock effect=${mock.effect} was declared but never used`,
        file: inputPath,
        line: mock.line,
        col: mock.col,
      };
      if (!grepMatches(options, result)) continue;
      results.push(result);
      if (options.bail) return summarize();
    }
  }

  return summarize();
}

export function runNativeKernTestRun(input: string, options: NativeKernTestOptions = {}): NativeKernTestRunSummary {
  const inputPath = resolve(input);
  const files: NativeKernTestSummary[] = [];
  for (const file of discoverNativeKernTestFiles(inputPath)) {
    const summary = runNativeKernTests(file, options);
    files.push(summary);
    if (options.bail && summary.failed > 0) break;
  }
  if (files.length === 0) {
    return {
      input: inputPath,
      testFiles: [],
      targetFiles: [],
      total: options.passWithNoTests ? 0 : 1,
      passed: 0,
      warnings: 0,
      failed: options.passWithNoTests ? 0 : 1,
      files: [],
      coverage: emptyCoverageSummary(),
    };
  }

  const targetFiles = new Set<string>();
  for (const file of files) {
    for (const target of file.targetFiles) targetFiles.add(target);
  }

  return {
    input: inputPath,
    testFiles: files.map((file) => file.file),
    targetFiles: [...targetFiles].sort(),
    total: files.reduce((sum, file) => sum + file.total, 0),
    passed: files.reduce((sum, file) => sum + file.passed, 0),
    warnings: files.reduce((sum, file) => sum + file.warnings, 0),
    failed: files.reduce((sum, file) => sum + file.failed, 0),
    files,
    coverage: combineCoverageSummaries(files.map((file) => file.coverage)),
  };
}

function summarizeNativeTestRun(
  file: string,
  targetFiles: Set<string>,
  results: NativeKernTestResult[],
  coverage: NativeKernTestCoverageSummary = emptyCoverageSummary(),
): NativeKernTestSummary {
  const passed = results.filter((result) => result.status === 'passed').length;
  const warnings = results.filter((result) => result.status === 'warning').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  return {
    file,
    targetFiles: [...targetFiles].sort(),
    total: results.length,
    passed,
    warnings,
    failed,
    results,
    coverage,
  };
}

function normalizeBaselineMessage(message: string): string {
  return message
    .replace(/\bat line \d+\b/g, 'at line <line>')
    .replace(/:\d+:\d+/g, ':<line>:<col>')
    .replace(/\s+/g, ' ')
    .trim();
}

function warningDetailMessages(message: string | undefined): string[] {
  if (!message) return [];
  const foundMatch = message.match(/^Found [^:]+:\s*(.+)$/);
  const body = foundMatch?.[1] || message;
  return body.split(/;\s+/).map(normalizeBaselineMessage).filter(Boolean);
}

function warningEntryKey(entry: NativeKernTestBaselineEntry): string {
  return (
    entry.signature ||
    JSON.stringify([
      entry.suite,
      entry.caseName,
      entry.ruleId,
      entry.assertion,
      entry.message ? normalizeBaselineMessage(entry.message) : '',
    ])
  );
}

function warningResultToBaselineEntries(result: NativeKernTestResult): NativeKernTestBaselineEntry[] {
  const details = warningDetailMessages(result.message);
  if (details.length === 0) {
    const signature = JSON.stringify([result.suite, result.caseName, result.ruleId, result.assertion, '']);
    return [
      {
        suite: result.suite,
        caseName: result.caseName,
        ruleId: result.ruleId,
        assertion: result.assertion,
        signature,
      },
    ];
  }
  return details.map((detail) => ({
    suite: result.suite,
    caseName: result.caseName,
    ruleId: result.ruleId,
    assertion: result.assertion,
    signature: JSON.stringify([result.suite, result.caseName, result.ruleId, result.assertion, detail]),
    message: detail,
  }));
}

export function createNativeKernTestBaseline(
  summary: NativeKernTestSummary | NativeKernTestRunSummary,
): NativeKernTestBaseline {
  const results = 'results' in summary ? summary.results : summary.files.flatMap((fileSummary) => fileSummary.results);
  const warnings = results.filter((result) => result.status === 'warning').flatMap(warningResultToBaselineEntries);
  const seen = new Set<string>();
  const uniqueWarnings: NativeKernTestBaselineEntry[] = [];
  for (const warning of warnings) {
    const key = warningEntryKey(warning);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueWarnings.push(warning);
  }
  uniqueWarnings.sort((a, b) => warningEntryKey(a).localeCompare(warningEntryKey(b)));
  return { version: 1, warnings: uniqueWarnings };
}

export function checkNativeKernTestBaseline(
  summary: NativeKernTestSummary | NativeKernTestRunSummary,
  baseline: NativeKernTestBaseline,
): NativeKernTestBaselineCheck {
  const actual = createNativeKernTestBaseline(summary).warnings;
  const expected = baseline.warnings || [];
  const expectedByKey = new Map(expected.map((entry) => [warningEntryKey(entry), entry]));
  const actualByKey = new Map(actual.map((entry) => [warningEntryKey(entry), entry]));
  const knownWarnings = actual.filter((entry) => expectedByKey.has(warningEntryKey(entry)));
  const newWarnings = actual.filter((entry) => !expectedByKey.has(warningEntryKey(entry)));
  const staleWarnings = expected.filter((entry) => !actualByKey.has(warningEntryKey(entry)));
  return {
    ok: newWarnings.length === 0 && staleWarnings.length === 0,
    knownWarnings,
    newWarnings,
    staleWarnings,
  };
}

function nativeCountsLine(summary: Pick<NativeKernTestSummary, 'failed' | 'passed' | 'total' | 'warnings'>): string {
  return `${summary.passed} passed, ${summary.warnings} warnings, ${summary.failed} failed, ${summary.total} total`;
}

function coverageLine(name: string, metric: NativeKernTestCoverageMetric): string {
  return `${name}: ${metric.covered}/${metric.total} (${metric.percent}%)`;
}

export function formatNativeKernTestCoverage(coverage: NativeKernTestCoverageSummary): string {
  const lines = [
    `coverage ${coverage.covered}/${coverage.total} (${coverage.percent}%)`,
    coverageLine('transitions', coverage.transitions),
    coverageLine('guards', coverage.guards),
    coverageLine('routes', coverage.routes),
    coverageLine('tools', coverage.tools),
    coverageLine('effects', coverage.effects),
  ];
  const uncoveredSections: Array<[string, string[]]> = [
    ['transitions', coverage.transitions.uncovered],
    ['guards', coverage.guards.uncovered],
    ['routes', coverage.routes.uncovered],
    ['tools', coverage.tools.uncovered],
    ['effects', coverage.effects.uncovered],
  ];
  for (const [name, uncovered] of uncoveredSections) {
    if (uncovered.length === 0) continue;
    lines.push(`uncovered ${name}:`);
    for (const item of uncovered) lines.push(`  ${item}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatNativeKernTestResult(result: NativeKernTestResult, summaryFile: string): string[] {
  const marker = result.status === 'passed' ? 'PASS' : result.status === 'warning' ? 'WARN' : 'FAIL';
  const loc = result.line
    ? ` (${relative(process.cwd(), result.file || summaryFile)}:${result.line}:${result.col ?? 1})`
    : '';
  const lines = [`${marker} ${result.suite} > ${result.caseName}: ${result.assertion} [${result.ruleId}]${loc}`];
  if (result.status !== 'passed' && result.message) {
    for (const line of result.message.split('\n')) lines.push(`  ${line}`);
  }
  return lines;
}

export function formatNativeKernTestSummary(
  summary: NativeKernTestSummary,
  options: NativeKernTestFormatOptions = {},
): string {
  const lines = [
    options.format === 'compact'
      ? `kern test ${relative(process.cwd(), summary.file) || summary.file} - ${nativeCountsLine(summary)}`
      : `kern test ${relative(process.cwd(), summary.file) || summary.file}`,
  ];
  const results =
    options.format === 'compact' ? summary.results.filter((result) => result.status !== 'passed') : summary.results;
  for (const result of results) {
    lines.push(...formatNativeKernTestResult(result, summary.file));
  }
  if (options.format === 'compact' && results.length === 0) return `${lines.join('\n')}\n`;
  if (options.format !== 'compact') lines.push(nativeCountsLine(summary));
  return `${lines.join('\n')}\n`;
}

export function formatNativeKernTestRunSummary(
  summary: NativeKernTestRunSummary,
  options: NativeKernTestFormatOptions = {},
): string {
  const lines = [
    options.format === 'compact'
      ? `kern test ${relative(process.cwd(), summary.input) || summary.input} - ${nativeCountsLine(summary)}`
      : `kern test ${relative(process.cwd(), summary.input) || summary.input}`,
  ];
  if (summary.files.length === 0) {
    lines.push('No native KERN test files found.');
    if (options.format !== 'compact') lines.push(nativeCountsLine(summary));
    return `${lines.join('\n')}\n`;
  }

  for (const fileSummary of summary.files) {
    if (options.format === 'compact') {
      const relFile = relative(process.cwd(), fileSummary.file) || fileSummary.file;
      if (fileSummary.failed > 0 || fileSummary.warnings > 0) {
        lines.push(`${relFile} - ${nativeCountsLine(fileSummary)}`);
        for (const result of fileSummary.results.filter((candidate) => candidate.status !== 'passed')) {
          lines.push(...formatNativeKernTestResult(result, fileSummary.file));
        }
      }
    } else {
      lines.push('');
      lines.push(formatNativeKernTestSummary(fileSummary).trimEnd());
    }
  }
  if (options.format !== 'compact') {
    lines.push('');
    lines.push(nativeCountsLine(summary));
  }
  return `${lines.join('\n')}\n`;
}
