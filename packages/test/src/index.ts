import type { IRNode, ParseDiagnostic, SchemaViolation, SemanticViolation } from '@kernlang/core';
import { generateCoreNode, parseDocumentWithDiagnostics, validateSchema, validateSemantics } from '@kernlang/core';
import type { Dirent } from 'fs';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';

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

export interface NativeKernTestSummary {
  file: string;
  targetFiles: string[];
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  results: NativeKernTestResult[];
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
}

export interface NativeKernTestOptions {
  grep?: string | RegExp;
  bail?: boolean;
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
  apisafety: ['duplicateRoutes', 'unvalidatedRoutes', 'unguardedEffects', 'uncheckedRoutePathParams'],
  coverage: ['untestedTransitions', 'untestedGuards'],
  effects: ['unguardedEffects', 'sensitiveEffectsRequireAuth', 'effectWithoutCleanup', 'unrecoveredAsync'],
  guard: ['invalidGuards', 'weakGuards'],
  machine: ['deadStates', 'duplicateTransitions'],
  mcpsafety: ['duplicateParams', 'invalidGuards', 'unguardedToolParams', 'missingPathGuards', 'ssrfRisks'],
  strict: [
    'duplicateNames',
    'duplicateRoutes',
    'duplicateTransitions',
    'deadStates',
    'deriveCycles',
    'codegenErrors',
    'invalidGuards',
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

function hasGuardLikeChild(node: IRNode): boolean {
  return (node.children || []).some((child) => ['guard', 'auth', 'validate'].includes(child.type));
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

function collectAssertions(testNode: IRNode): CollectedAssertion[] {
  const suite = str(getProps(testNode).name) || 'unnamed test';
  const assertions: CollectedAssertion[] = [];

  function pushExpectation(node: IRNode, path: string[]): void {
    assertions.push({
      suite,
      caseName: path.length > 0 ? path.join(' > ') : 'top-level',
      node,
    });
  }

  function visit(node: IRNode, path: string[]): void {
    if (node.type === 'expect') {
      pushExpectation(node, path);
      return;
    }

    if (node.type === 'it') {
      const nextPath = [...path, str(getProps(node).name) || 'it'];
      for (const child of node.children || []) {
        if (child.type === 'expect') pushExpectation(child, nextPath);
      }
      return;
    }

    if (node.type === 'describe') {
      const nextPath = [...path, str(getProps(node).name) || 'describe'];
      for (const child of node.children || []) visit(child, nextPath);
      return;
    }

    for (const child of node.children || []) visit(child, path);
  }

  visit(testNode, []);
  return assertions;
}

function assertionLabel(node: IRNode): string {
  const props = getProps(node);
  const preset = str(props.preset);
  const machine = str(props.machine);
  const reaches = str(props.reaches);
  const no = str(props.no);
  const guard = str(props.guard);
  const expr = exprToString(props.expr);

  if (preset) return `preset ${preset}`;
  if (no) return `${machine ? `machine ${machine} ` : ''}no ${no}`;
  if (guard) return `guard ${guard} exhaustive`;
  if (machine || reaches) return `machine ${machine || '<missing>'} reaches ${reaches || '<missing>'}`;
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

const EFFECT_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'network', re: /\b(fetch|axios|request|got)\s*\(/ },
  { kind: 'shell', re: /\b(exec|execFile|spawn|spawnSync)\s*\(/ },
  {
    kind: 'file',
    re: /\b(readFile|writeFile|appendFile|unlink|rm|rename|mkdir|rmdir|createReadStream|createWriteStream)\s*\(/,
  },
  { kind: 'database', re: /\b(query|execute|findMany|findUnique|create|update|delete|upsert)\s*\(/ },
  { kind: 'email', re: /\b(sendMail|sendEmail|mailer\.send|transporter\.send)\s*\(/ },
];

function classifyEffect(code: string): string | undefined {
  return EFFECT_PATTERNS.find((pattern) => pattern.re.test(code))?.kind;
}

function findUnguardedEffects(root: IRNode): string[] {
  const checkedTypes = new Set(['action', 'command', 'fn', 'job', 'middleware', 'route', 'tool']);
  const failures: string[] = [];

  function visit(node: IRNode): void {
    if (checkedTypes.has(node.type)) {
      const code = handlerText(node);
      const effectKind = classifyEffect(code);
      if (effectKind && !hasGuardLikeChild(node)) {
        failures.push(
          `${nodeLabel(node)} at line ${node.loc?.line ?? '?'} performs ${effectKind} effect without guard/auth/validate`,
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

      const code = handlerText(node);
      if (classifyEffect(code) === 'network' && !hasUrlAllowlistGuard(node)) {
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
      const effectKind = classifyEffect(handlerText(node));
      if (effectKind && !hasAuthLikeChild(node)) {
        failures.push(`${nodeLabel(node)} performs ${effectKind} effect without auth`);
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
    .filter((effect) => needsCleanup.test(handlerText(effect)) && getChildren(effect, 'cleanup').length === 0)
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

function findUntestedTransitions(
  root: IRNode,
  context: NativeKernAssertionContext | undefined,
  machineName?: string,
): string[] {
  const machines = selectedMachines(root, machineName);
  if (machineName && machines.length === 0) return [`Machine not found: ${machineName}`];

  const coveredByMachine = new Map<string, Set<string>>();
  for (const assertion of context?.assertions || []) {
    const props = getProps(assertion.node);
    const assertedMachine = str(props.machine);
    if (!assertedMachine || !('reaches' in props) || 'no' in props) continue;
    if (machineName && assertedMachine !== machineName) continue;
    const covered = coveredByMachine.get(assertedMachine) || new Set<string>();
    for (const transitionName of parseList(str(props.via))) covered.add(transitionName);
    coveredByMachine.set(assertedMachine, covered);
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
  const guardCoverageInvariants = new Set(['invalidguards', 'guardmisconfigurations', 'weakguards']);
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
  const unions = collectNodes(target.root, 'union');
  const union = unionName
    ? unions.find((candidate) => str(getProps(candidate).name) === unionName)
    : unions.length === 1
      ? unions[0]
      : undefined;

  if (!union) {
    return {
      passed: false,
      message: unionName
        ? `Union not found for guard exhaustiveness: ${unionName}`
        : 'Guard exhaustiveness needs over=<UnionName> when the target has zero or multiple unions',
    };
  }

  const variants = getChildren(union, 'variant')
    .map((variant) => str(getProps(variant).name) || str(getProps(variant).type))
    .filter(Boolean);
  if (variants.length === 0) return { passed: false, message: `Union ${str(getProps(union).name)} has no variants` };

  const explicitCoverage = new Set([
    ...parseNameList(str(props.covers)),
    ...parseNameList(str(getProps(guard).covers)),
    ...parseNameList(str(getProps(guard).allow)),
  ]);
  const searchable = nodeSearchText(guard);
  const missing = variants.filter((variant) => {
    if (explicitCoverage.has(variant)) return false;
    return !new RegExp(`(?:^|[^A-Za-z0-9_$])${escapeRegExp(variant)}(?:$|[^A-Za-z0-9_$])`).test(searchable);
  });

  return missing.length > 0
    ? {
        passed: false,
        message: `Guard ${guardName} is not exhaustive over ${str(getProps(union).name)}; missing variants: ${missing.join(', ')}`,
      }
    : { passed: true };
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
  if (!states.some((state) => state.name === targetState)) {
    return { passed: false, message: `State not found in machine ${machineName}: ${targetState}` };
  }

  const via = parseList(str(props.via));
  if (via.length > 0) {
    let current = initialState;
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
    }
    return current === targetState
      ? { passed: true, message: `Path ${via.join(' -> ')} reaches ${targetState}` }
      : { passed: false, message: `Path ${via.join(' -> ')} ended at ${current}, not ${targetState}` };
  }

  const queue: { state: string; path: string[] }[] = [{ state: initialState, path: [] }];
  const visited = new Set<string>([initialState]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.state === targetState) {
      return {
        passed: true,
        message:
          current.path.length > 0
            ? `Path ${current.path.join(' -> ')} reaches ${targetState}`
            : 'Target is initial state',
      };
    }
    for (const transition of transitions.filter((candidate) => candidate.from.includes(current.state))) {
      if (visited.has(transition.to)) continue;
      visited.add(transition.to);
      queue.push({ state: transition.to, path: [...current.path, transition.name] });
    }
  }

  return {
    passed: false,
    message: `State ${targetState} is not reachable from ${initialState} in machine ${machineName}`,
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
  if ('expr' in props) {
    return [
      {
        ruleId: 'expr',
        assertion: assertionLabel(node),
        passed: false,
        severity: 'error',
        message:
          'Runtime expr assertions are still compiled-test assertions; native kern test currently supports structural assertions.',
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

    const context: NativeKernAssertionContext = { assertions };
    for (const assertion of assertions) {
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
          return summarizeNativeTestRun(inputPath, targetFiles, results);
        }
      }
    }
  }

  return summarizeNativeTestRun(inputPath, targetFiles, results);
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
      total: 1,
      passed: 0,
      warnings: 0,
      failed: 1,
      files: [],
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
  };
}

function summarizeNativeTestRun(
  file: string,
  targetFiles: Set<string>,
  results: NativeKernTestResult[],
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
  };
}

export function formatNativeKernTestSummary(summary: NativeKernTestSummary): string {
  const lines = [`kern test ${relative(process.cwd(), summary.file) || summary.file}`];
  for (const result of summary.results) {
    const marker = result.status === 'passed' ? 'PASS' : result.status === 'warning' ? 'WARN' : 'FAIL';
    const loc = result.line
      ? ` (${relative(process.cwd(), result.file || summary.file)}:${result.line}:${result.col ?? 1})`
      : '';
    lines.push(`${marker} ${result.suite} > ${result.caseName}: ${result.assertion} [${result.ruleId}]${loc}`);
    if (result.status !== 'passed' && result.message) lines.push(`  ${result.message}`);
  }
  lines.push(
    `${summary.passed} passed, ${summary.warnings} warnings, ${summary.failed} failed, ${summary.total} total`,
  );
  return `${lines.join('\n')}\n`;
}

export function formatNativeKernTestRunSummary(summary: NativeKernTestRunSummary): string {
  const lines = [`kern test ${relative(process.cwd(), summary.input) || summary.input}`];
  if (summary.files.length === 0) {
    lines.push('No native KERN test files found.');
    lines.push(
      `${summary.passed} passed, ${summary.warnings} warnings, ${summary.failed} failed, ${summary.total} total`,
    );
    return `${lines.join('\n')}\n`;
  }

  for (const fileSummary of summary.files) {
    lines.push('');
    lines.push(formatNativeKernTestSummary(fileSummary).trimEnd());
  }
  lines.push('');
  lines.push(
    `${summary.passed} passed, ${summary.warnings} warnings, ${summary.failed} failed, ${summary.total} total`,
  );
  return `${lines.join('\n')}\n`;
}
