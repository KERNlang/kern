import type { IRNode, ParseDiagnostic, SchemaViolation, SemanticViolation } from '@kernlang/core';
import { generateCoreNode, parseDocumentWithDiagnostics, validateSchema, validateSemantics } from '@kernlang/core';
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
}

export interface NativeKernTestCoverageSummary {
  total: number;
  covered: number;
  percent: number;
  transitions: NativeKernTestCoverageMetric;
  guards: NativeKernTestCoverageMetric;
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
  fixtures?: RuntimeBinding[];
}

interface RuntimeBinding {
  name: string;
  expr: string;
  kind: 'expr' | 'fixture' | 'fn';
  line?: number;
}

interface RuntimeBindingOrder {
  ordered: RuntimeBinding[];
  error?: string;
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
  coverage: ['untestedTransitions', 'untestedGuards'],
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

function collectAssertions(testNode: IRNode): CollectedAssertion[] {
  const suite = str(getProps(testNode).name) || 'unnamed test';
  const assertions: CollectedAssertion[] = [];

  function pushExpectation(node: IRNode, path: string[], fixtures: RuntimeBinding[]): void {
    assertions.push({
      suite,
      caseName: path.length > 0 ? path.join(' > ') : 'top-level',
      node,
      fixtures,
    });
  }

  function visit(node: IRNode, path: string[], fixtures: RuntimeBinding[]): void {
    const scopedFixtures = [...fixtures, ...runtimeFixtureBindings(node)];

    if (node.type === 'expect') {
      pushExpectation(node, path, scopedFixtures);
      return;
    }

    if (node.type === 'it') {
      const nextPath = [...path, str(getProps(node).name) || 'it'];
      for (const child of node.children || []) {
        if (child.type === 'expect') pushExpectation(child, nextPath, scopedFixtures);
      }
      return;
    }

    if (node.type === 'describe') {
      const nextPath = [...path, str(getProps(node).name) || 'describe'];
      for (const child of node.children || []) visit(child, nextPath, scopedFixtures);
      return;
    }

    for (const child of node.children || []) visit(child, path, scopedFixtures);
  }

  visit(testNode, [], []);
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
  const guard = str(props.guard);
  const expr = exprToString(props.expr);
  const fn = str(props.fn);
  const derive = str(props.derive);
  const args = exprToString(props.args);
  const withValue = exprToString(props.with);
  const equals = props.equals === undefined ? '' : exprToString(props.equals) || String(props.equals);
  const matches = props.matches === undefined ? '' : String(props.matches);
  const throws = props.throws === undefined ? '' : String(props.throws || 'true');

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

  const explicitlyCovered = new Set(assertions.map((assertion) => str(getProps(assertion.node).guard)).filter(Boolean));

  return collectNodes(root, 'guard')
    .filter((guard) => {
      const name = str(getProps(guard).name);
      return !name || !explicitlyCovered.has(name);
    })
    .map((guard) => {
      const name = str(getProps(guard).name);
      return name
        ? `guard ${name} at line ${guard.loc?.line ?? '?'}`
        : `unnamed guard at line ${guard.loc?.line ?? '?'}`;
    });
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
    targets: [],
  };
}

function combineCoverageSummaries(summaries: NativeKernTestCoverageSummary[]): NativeKernTestCoverageSummary {
  const transitions = combineCoverageMetrics(summaries.map((summary) => summary.transitions));
  const guards = combineCoverageMetrics(summaries.map((summary) => summary.guards));
  const total = transitions.total + guards.total;
  const covered = transitions.covered + guards.covered;
  return {
    total,
    covered,
    percent: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100,
    transitions,
    guards,
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

  const explicitlyCovered = new Set(assertions.map((assertion) => str(getProps(assertion.node).guard)).filter(Boolean));
  const uncovered = guards
    .filter((guard) => {
      const name = str(getProps(guard).name);
      return !name || !explicitlyCovered.has(name);
    })
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
    };
  }
  return {
    file: target.file,
    transitions: machineTransitionCoverage(target.root, assertions),
    guards: guardCoverage(target.root, assertions),
  };
}

function createCoverageSummary(targets: NativeKernTestCoverageTarget[]): NativeKernTestCoverageSummary {
  const transitions = combineCoverageMetrics(targets.map((target) => target.transitions));
  const guards = combineCoverageMetrics(targets.map((target) => target.guards));
  const total = transitions.total + guards.total;
  const covered = transitions.covered + guards.covered;
  return {
    total,
    covered,
    percent: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100,
    transitions,
    guards,
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

const RUNTIME_EXPR_TIMEOUT_MS = 100;
const RUNTIME_ASYNC_PROCESS_TIMEOUT_MS = 1500;
const RUNTIME_EXPR_UNSAFE_TOKEN =
  /\b(?:async|class|constructor|Date|delete|do|eval|fetch|for|Function|global|globalThis|import|new|process|prototype|require|setInterval|setTimeout|switch|this|throw|try|while|with|WebSocket|XMLHttpRequest|__proto__)\b/;
const RUNTIME_FN_UNSAFE_TOKEN =
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

function isRuntimeBindingName(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function runtimeBindingSource(node: IRNode): { expr: string; kind: RuntimeBinding['kind'] } | undefined {
  if (node.type === 'const') return { expr: exprPropToRuntimeSource(node, 'value'), kind: 'expr' };
  if (node.type === 'derive' || node.type === 'let') {
    return { expr: exprPropToRuntimeSource(node, 'value') || exprPropToRuntimeSource(node, 'expr'), kind: 'expr' };
  }
  if (node.type === 'fn') return { expr: runtimeFunctionExpr(node), kind: 'fn' };
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
  const code = handlerText(node);
  if (!code) return '';

  const params = runtimeParamNames(node);
  if (!params.every(isRuntimeBindingName)) return '';
  const asyncKw = isTruthy(getProps(node).async) ? 'async ' : '';
  return `(${asyncKw}(${params.join(', ')}) => {\n${code.trim()}\n})`;
}

function collectRuntimeBindings(root: IRNode): RuntimeBinding[] {
  const bindings: RuntimeBinding[] = [];

  function visit(node: IRNode): void {
    if (node.type === 'const' || node.type === 'derive' || node.type === 'let' || node.type === 'fn') {
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
      const error = visit(dep);
      if (error) return error;
    }
    stack.pop();
    visiting.delete(name);
    visited.add(name);
    ordered.push(binding);
    return undefined;
  }

  for (const name of depsIn(entryExpr)) {
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
    Math,
    Number,
    Object,
    Promise,
    RangeError,
    ReferenceError,
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
    Math,
    Number,
    Object,
    Promise,
    RangeError,
    ReferenceError,
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
): { passed: boolean; message?: string } {
  const blocking = targetBlockingMessage(target);
  if (blocking) return { passed: false, message: blocking };

  const props = getProps(node);
  const trimmedExpr = expr.trim();
  if (!trimmedExpr) return { passed: false, message: `${label} assertion requires an executable expression` };

  const expectedSource = runtimeExpectedSource(node, 'equals');
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
        message: `Runtime expr assertion cannot execute expected equals value: ${formatThrownRuntimeError(expected.error)}`,
      };
    }
    return runtimeValuesEqual(actual.value, expected.value)
      ? { passed: true }
      : {
          passed: false,
          message:
            str(props.message) ||
            `${label} expected ${formatRuntimeValue(expected.value)}, received ${formatRuntimeValue(actual.value)}${runtimeExpressionContext(trimmedExpr, fixtures)}`,
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
          message: `Found untested guards: ${untested.join('; ')}. Add expect guard=<name> exhaustive=true or a guard-wide assertion such as expect preset=guard.`,
        }
      : { passed: true };
  }

  return { passed: false, message: `Unsupported native invariant: no=${str(getProps(node).no)}` };
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
        [...targetFiles].sort().map((targetFile) => {
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

    let target = targetCache.get(targetPath);
    if (!target) {
      target = loadKernDocument(targetPath);
      targetCache.set(targetPath, target);
    }

    const assertions = collectAssertions(testNode);
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
      const context: NativeKernAssertionContext = { assertions, fixtures: assertion.fixtures };
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
  ];
  const uncoveredTransitions = coverage.transitions.uncovered;
  const uncoveredGuards = coverage.guards.uncovered;
  if (uncoveredTransitions.length > 0) {
    lines.push('uncovered transitions:');
    for (const item of uncoveredTransitions) lines.push(`  ${item}`);
  }
  if (uncoveredGuards.length > 0) {
    lines.push('uncovered guards:');
    for (const item of uncoveredGuards) lines.push(`  ${item}`);
  }
  return `${lines.join('\n')}\n`;
}

function formatNativeKernTestResult(result: NativeKernTestResult, summaryFile: string): string[] {
  const marker = result.status === 'passed' ? 'PASS' : result.status === 'warning' ? 'WARN' : 'FAIL';
  const loc = result.line
    ? ` (${relative(process.cwd(), result.file || summaryFile)}:${result.line}:${result.col ?? 1})`
    : '';
  const lines = [`${marker} ${result.suite} > ${result.caseName}: ${result.assertion} [${result.ruleId}]${loc}`];
  if (result.status !== 'passed' && result.message) lines.push(`  ${result.message}`);
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
