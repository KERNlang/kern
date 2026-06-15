import { parseLegacyParamSignature } from '../closure-eligibility.js';
import { validateRawHostNamespacesTS } from '../codegen-expression.js';
import { parseExpression } from '../parser-expression.js';
import { NODE_SCHEMAS } from '../schema.js';
import { moduleAmbientRuntimeBindingNames } from '../semantic-validator.js';
import { type IRNode, isExprObject } from '../types.js';
import { typescriptClosureClassifier, validateClosureBlockHostNamespacesTS } from '../typescript-closure-classifier.js';
import type { ValueIR } from '../value-ir.js';
import { isHostNamespaceRoot, unmappedHostNamespaceMessage } from './host-namespace.js';
import { isPortableStdlibMember, KERN_STDLIB_MODULES, suggestStdlibMember } from './kern-stdlib.js';
import {
  classifyRegexLiteralIndexReadFailClose,
  classifyRegexLiteralMemberReadFailClose,
  classifyRegexLiteralValueIRCallCalleeFailClose,
  REGEX_HOST_REGEXP_FAILCLOSE,
  regexLiteralReceiverIR,
} from './regex-normalize.js';

interface ValidationScope {
  readonly moduleBindings: ReadonlySet<string>;
  readonly locals: ReadonlySet<string>;
}

const TS_PARSE_OPTS = { closureClassifier: typescriptClosureClassifier };
const validatedNodes = new WeakMap<IRNode, number>();
const expressionScopes = new WeakMap<IRNode, Map<string, ReadonlySet<string>>>();

export interface IRHostNamespaceValidationOptions {
  userBindings?: ReadonlySet<string>;
}

export function beginIRHostNamespacesValidatedTS(root: IRNode, options?: IRHostNamespaceValidationOptions): boolean {
  if ((validatedNodes.get(root) ?? 0) > 0) return false;
  const moduleBindings = root.type === 'module' ? moduleAmbientRuntimeBindingNames(root) : new Set<string>();
  validateNode(root, { moduleBindings, locals: new Set(options?.userBindings ?? []) });
  markValidated(root);
  return true;
}

export function endIRHostNamespacesValidatedTS(root: IRNode, didBegin: boolean): void {
  if (!didBegin) return;
  unmarkValidated(root);
}

export function validatedHostNamespaceBindingsFor(node: IRNode, propName: string): ReadonlySet<string> | undefined {
  return expressionScopes.get(node)?.get(propName);
}

function markValidated(node: IRNode): void {
  validatedNodes.set(node, (validatedNodes.get(node) ?? 0) + 1);
  for (const child of node.children ?? []) markValidated(child);
}

function unmarkValidated(node: IRNode): void {
  const count = validatedNodes.get(node) ?? 0;
  if (count <= 1) {
    validatedNodes.delete(node);
    expressionScopes.delete(node);
  } else {
    validatedNodes.set(node, count - 1);
  }
  for (const child of node.children ?? []) unmarkValidated(child);
}

function validateNode(node: IRNode, scope: ValidationScope): void {
  const selfScope = scopeWithNames(scope, selfBindingNames(node));
  validateExpressionProps(node, selfScope);
  const legacyParams = validateLegacyParams(node, selfScope);
  if (legacyParams !== null) {
    validateChildren(node, scopeWithNames(selfScope, legacyParams));
    return;
  }
  let paramDefaultScope = selfScope;
  for (const child of node.children ?? []) {
    if (child.type !== 'param') continue;
    validateNode(child, paramDefaultScope);
    paramDefaultScope = scopeWithNames(paramDefaultScope, bindingNamesFromPatternChildren(child));
  }
  validateChildren(node, scopeWithNames(selfScope, paramChildNames(node)), { skipParamChildren: true });
}

function validateChildren(node: IRNode, scope: ValidationScope, options?: { skipParamChildren?: boolean }): void {
  const children = node.children ?? [];
  if (children.length === 0) return;
  const childBaseScope = scopeWithNames(scope, childScopeBindingNames(node));

  if (isSequentialScopeNode(node)) {
    let current = childBaseScope;
    for (const child of children) {
      if (options?.skipParamChildren && child.type === 'param') continue;
      const childScope = child.type === 'catch' ? scopeWithNames(current, catchBindingNames(child)) : current;
      validateNode(child, childScope);
      current = scopeWithNames(current, postStatementBindingNames(child));
    }
    return;
  }

  for (const child of children) {
    if (options?.skipParamChildren && child.type === 'param') continue;
    validateNode(child, childBaseScope);
  }
}

function validateExpressionProps(node: IRNode, scope: ValidationScope): void {
  const schema = NODE_SCHEMAS[node.type];
  if (!schema?.props || !node.props) return;
  for (const [propName, propSchema] of Object.entries(schema.props)) {
    if (propSchema.kind !== 'expression') continue;
    const raw = node.props[propName];
    if (raw === undefined || raw === '') continue;
    if (typeof raw === 'string' && node.__quotedProps?.includes(propName)) continue;
    const propScope = expressionPropScope(node, propName, scope);
    recordExpressionScope(node, propName, propScope);
    validateExpressionValue(raw, propScope, isConstValueEscapeHatch(node, propName));
  }
}

/** The ONE sanctioned raw-passthrough site: a `const`'s `value` prop. On a parse
 *  FAILURE here, `emitConstValue` ships the raw text verbatim (GAP 3), so the
 *  validator must NOT screen it — otherwise it would reject what emit ships. Every
 *  OTHER expression prop (field values, config values, param defaults, …) is NOT
 *  an escape hatch: an unparseable host-root in it fails CLOSED (BLOCKER 1). */
function isConstValueEscapeHatch(node: IRNode, propName: string): boolean {
  return node.type === 'const' && propName === 'value';
}

function expressionPropScope(node: IRNode, propName: string, scope: ValidationScope): ValidationScope {
  if (node.type === 'with' && propName === 'cleanup') {
    const name = stringName(node.props?.name);
    return name ? scopeWithNames(scope, [name]) : scope;
  }
  return scope;
}

function validateExpressionValue(raw: unknown, scope: ValidationScope, shipRawOnParseFailure = false): void {
  if (isExprObject(raw)) {
    return;
  }
  if (typeof raw !== 'string') return;
  let parsed: ValueIR;
  try {
    parsed = parseExpression(raw, TS_PARSE_OPTS);
  } catch (err) {
    if (isHostNamespaceValidationError(err)) throw err;
    // BLOCKER 1 — the "ship raw on parse failure" relaxation (GAP 3) is scoped to
    // the ONE const.value escape-hatch site (`emitConstValue` in type-system.ts):
    // there `shipRawOnParseFailure` is true and the raw text is shipped verbatim,
    // so the validator stays silent to match emit. This SHARED validator also runs
    // for EVERY OTHER expression prop (field values, config values, legacy param
    // defaults, …); for those, dropping the screen would fail-OPEN — an unparseable
    // host-root like `Date.now(]` as a field value or param default would validate
    // OK and emit verbatim invalid TS. Run the raw-text host-namespace scan so any
    // host root in unparseable NON-escape-hatch input fails CLOSED.
    if (!shipRawOnParseFailure) validateRawHostNamespacesTS(raw, exprContext(scope));
    return;
  }
  validateValueIR(parsed, scope);
}

function validateValueIR(node: ValueIR, scope: ValidationScope): void {
  switch (node.kind) {
    case 'numLit':
    case 'strLit':
    case 'boolLit':
    case 'nullLit':
    case 'undefLit':
    case 'regexLit':
      return;
    case 'ident':
      // Slice 2 — a BARE-VALUE host `RegExp` reference fails-close at the value
      // site (e.g. a `const R = RegExp` initializer). This is the alias-soundness
      // gate: rejecting `RegExp` here means `new R(...)` can never silently
      // diverge. Member/call/new receivers are handled by their own cases below
      // (they recurse into `validateValueIR(object)` only AFTER their own host-
      // root screen, so a rejected member never reaches a misleading value
      // diagnostic). Honors user shadowing via `isUserBinding`.
      rejectHostRegExpValueIR(node.name, scope);
      return;
    case 'tmplLit':
      for (const expr of node.expressions) validateValueIR(expr, scope);
      return;
    case 'member': {
      // Slice 2 — `/x/.source` / `/x/.flags`: a bare property READ on a regex
      // LITERAL launders the pattern/flags to a string. Routed through the SHARED
      // classifier (via the ValueIR adapter) so this site agrees with the TS/
      // Python emit legs and the closure walk BY CONSTRUCTION (always non-null
      // today — the empty portable-read allowlist — but one classifier owns the
      // truth). A portable DOTTED method CALLEE (`/x/.test`) never reaches here as
      // a bare member: the `call` case classifies the callee first and skips this
      // re-validation, so this read fail-close is only ever a genuine bare read.
      // The receiver is UNWRAPPED first so a wrapped read `(/x/ as any).source`
      // fails-close identically to the bare `/x/.source` (round-5 wrapped fix).
      if (regexLiteralReceiverIR(node.object) !== null) {
        const message = classifyRegexLiteralMemberReadFailClose(node);
        if (message !== null) throw new Error(message);
      }
      const root = hostNamespaceReceiverRoot(node.object);
      if (root) rejectUnboundHostNamespace(root, hostNamespaceMemberLabel(node.object, node.property), scope);
      validateValueIR(node.object, scope);
      return;
    }
    case 'index': {
      // Slice 2 review fix — the bracket (`index`) form of a regex-literal
      // property access (`/x/["source"]`, `/x/["test"]`) launders the
      // pattern/flags back to a string exactly like the dotted member form, so
      // it fails-close identically. A STRING-literal index goes through the same
      // (empty) portable-property allowlist; a COMPUTED / non-literal index is
      // unknowable and also fails-close. Mirrors the emit-path index screen. The
      // receiver is UNWRAPPED first so a wrapped bracket read `(/x/!)["source"]`
      // fails-close identically to the bare form (round-5 wrapped fix).
      if (regexLiteralReceiverIR(node.object) !== null) {
        // Routed through the SHARED classifier (a STRING index classifies like the
        // dotted read; a COMPUTED index is `property = null` → fail-close), so the
        // bracket form agrees with the dotted member form and the other legs by
        // construction. A bracket call `/x/["test"](s)` lands here (its callee is
        // an `index`, not a `member`) and fails-close exactly like a bare read.
        const message = classifyRegexLiteralIndexReadFailClose(node);
        if (message !== null) throw new Error(message);
      }
      const root = hostNamespaceReceiverRoot(node.object);
      if (root) {
        rejectUnboundHostNamespace(
          root,
          hostNamespaceMemberLabel(node.object, node.index.kind === 'strLit' ? node.index.value : '[computed]'),
          scope,
        );
      }
      validateValueIR(node.object, scope);
      // A regex-literal receiver was already fully classified above (and threw if
      // non-portable), so it never reaches `validateValueIR(object)`. The index
      // expression is still validated for ITS OWN host violations.
      validateValueIR(node.index, scope);
      return;
    }
    case 'call': {
      validateCallCallee(node.callee, scope);
      // BLOCKING fix — a DOTTED regex-literal method call (`/x/.test(s)`,
      // `/x/.exec(s)`, `/x/.compile(y)`) is classified by the SHARED classifier
      // here, the SAME decision the TS-emit (`lowerRegexCallTS`) + Python-emit
      // (`lowerRegexCallPython`) legs and the closure walk make. Without this, the
      // blanket `validateValueIR(node.callee)` below re-validated the callee as a
      // bare member READ and threw `REGEX_HOST_REGEXP_FAILCLOSE` on the COMMON
      // portable `/x/.test(s)` — an internal divergence from emit (which accepts
      // it). `undefined` = not a regex-literal dotted call → fall through to the
      // normal callee validation; `null` = PORTABLE (`/x/.test` non-`/g`) → skip
      // the callee re-validation (only the args still need checks); a string =
      // the precise fail-close message (`.exec`/`/g`-`.test`/non-portable method),
      // byte-identical to the emit legs.
      const regexCallee = classifyRegexLiteralValueIRCallCalleeFailClose(node);
      if (regexCallee === undefined) {
        validateValueIR(node.callee, scope);
      } else if (regexCallee !== null) {
        throw new Error(regexCallee);
      }
      for (const arg of node.args) validateValueIR(arg, scope);
      return;
    }
    case 'lambda': {
      const lambdaScope = scopeWithNames(
        scope,
        node.params.map((param) => param.name),
      );
      if (node.bodyBlock)
        validateClosureBlockHostNamespacesTS(node.bodyBlock.raw, exprContext(lambdaScope).isUserBinding);
      if (node.body) validateValueIR(node.body, lambdaScope);
      return;
    }
    case 'binary':
      validateValueIR(node.left, scope);
      validateValueIR(node.right, scope);
      return;
    case 'unary':
      // `typeof RegExp` (round-5 over-rejection fix) yields the string
      // `"function"` and launders no host value, so it must NOT trip the
      // bare-`RegExp` value reject. Skip validating a `typeof <bare ident>`
      // operand (the only check there is the bare-`RegExp` reject); any other
      // operand shape (`typeof RegExp.prototype` — a member) still descends and
      // fails-close. Mirrors the TS-emit + closure-walk `typeof` carve-outs.
      if (node.op === 'typeof' && node.argument.kind === 'ident') return;
      validateValueIR(node.argument, scope);
      return;
    case 'spread':
    case 'await':
    case 'propagate':
      validateValueIR(node.argument, scope);
      return;
    case 'new': {
      const root = newExpressionRootIdentifier(node.argument);
      // Slice 2 — `new RegExp(p)` throws the regex-specific message (BEFORE the
      // generic constructor reject) so construction fails-close byte-identically
      // across emit + validate + the Python target.
      if (root === 'RegExp') rejectHostRegExpValueIR(root, scope);
      if (root && !(root === 'Error' && isSimpleErrorConstructor(node.argument))) {
        rejectUnboundHostNamespace(root, 'constructor', scope);
      }
      validateNewArgument(node.argument, scope);
      return;
    }
    case 'typeAssert':
    case 'nonNull':
      validateValueIR(node.expression, scope);
      return;
    case 'objectLit':
      for (const entry of node.entries) {
        if ('argument' in entry) validateValueIR(entry.argument, scope);
        else validateValueIR(entry.value, scope);
      }
      return;
    case 'arrayLit':
      for (const item of node.items) validateValueIR(item, scope);
      return;
    case 'conditional':
      validateValueIR(node.test, scope);
      validateValueIR(node.consequent, scope);
      validateValueIR(node.alternate, scope);
      return;
    default:
      throw new Error(`Unsupported ValueIR kind in host namespace validation: ${(node as { kind?: string }).kind}`);
  }
}

function validateNewArgument(node: ValueIR, scope: ValidationScope): void {
  if (node.kind === 'call') {
    if (!(node.callee.kind === 'ident' && node.callee.name === 'Error')) validateCallCallee(node.callee, scope);
    for (const arg of node.args) validateValueIR(arg, scope);
    return;
  }
  validateValueIR(node, scope);
}

function validateCallCallee(callee: ValueIR, scope: ValidationScope): void {
  if (callee.kind === 'ident') {
    if (!isUserBinding(scope, callee.name) && (callee.name === 'Array' || callee.name === 'Object')) {
      throw new Error(`Unknown KERN-stdlib method/member '${callee.name}.call'.`);
    }
    // Slice 2 — a bare `RegExp(p, f)` call throws the regex-specific message
    // (BEFORE the generic host-root reject below) so its diagnostic matches the
    // emit path and the Python target, byte-identical.
    rejectHostRegExpValueIR(callee.name, scope);
    rejectUnboundHostNamespace(callee.name, 'call', scope);
    return;
  }
  if (callee.kind === 'member') {
    const root = hostNamespaceReceiverRoot(callee.object);
    if (root) rejectUnboundHostNamespace(root, hostNamespaceMemberLabel(callee.object, callee.property), scope);
  }
}

function rejectUnboundHostNamespace(root: string, member: string, scope: ValidationScope): void {
  // GAP 1 — unify the IR-validation path with the emit path against the ONE
  // KERN_STDLIB registry, but ONLY for real `Module.member` access/calls. The
  // emitter's stdlib dispatch (`applyStdlibLoweringTS`/`...PropertyLowering`)
  // fires on `Module.method` whose `Module` is a registered stdlib root WITHOUT
  // consulting user shadowing — `Math.floor` lowers, `Math.bogus` throws
  // `Unknown KERN-stdlib member` even when a user binding named `Math` is in
  // scope. Mirroring that here keeps validate<->emit in lockstep (a divergence
  // would let the validator silently pass `Math.bogus` that the emitter throws
  // on). The synthetic `'constructor'`/`'call'` sentinels are EXCLUDED: the
  // emitter does NOT route `new Map(...)` / bare `Map()` / `new Number(5)`
  // through stdlib unknown-member dispatch (those construct/call the host
  // value), so a stdlib root in those positions must fall through to the host-
  // root check below — which passes for stdlib modules, matching emit. (Bare
  // `Array()`/`Object()` are already special-cased by the caller.)
  if (KERN_STDLIB_MODULES.has(root) && member !== 'constructor' && member !== 'call') {
    if (isPortableStdlibMember(root, member)) return;
    throwUnknownStdlibMemberIR(root, member);
  }
  // Non-stdlib host roots (console/process/String/…) honor user shadowing: a
  // user binding of the same name is the user's value, not the host namespace.
  if (isUserBinding(scope, root)) return;
  if (!isHostNamespaceRoot(root)) return;
  throw new Error(unmappedHostNamespaceMessage('TypeScript', root, member));
}

/** Slice 2 — host-`RegExp` fail-close (IR-validate path). Throws the shared
 *  `REGEX_HOST_REGEXP_FAILCLOSE` for a bare-value / bare-call / `new` host
 *  `RegExp` reference, honoring user shadowing (a `const RegExp = x` local is the
 *  user's value). Mirrors `rejectHostRegExpValueTS` in codegen-expression.ts so
 *  the emit and validation paths fail-close identically. */
function rejectHostRegExpValueIR(name: string, scope: ValidationScope): void {
  if (name !== 'RegExp') return;
  if (isUserBinding(scope, name)) return;
  throw new Error(REGEX_HOST_REGEXP_FAILCLOSE);
}

/** Mirror of the emit path's `throwUnknownStdlibMember` so the same diagnostic
 *  (with the same did-you-mean suggestion) surfaces from the validation pass. */
function throwUnknownStdlibMemberIR(moduleName: string, memberName: string): never {
  const suggestion = suggestStdlibMember(moduleName, memberName);
  const hint = suggestion ? ` Did you mean '${moduleName}.${suggestion}'?` : '';
  throw new Error(`Unknown KERN-stdlib method/member '${moduleName}.${memberName}'.${hint}`);
}

function isHostNamespaceValidationError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Unsupported host namespace in TypeScript expression: ');
}

function exprContext(scope: ValidationScope): { isUserBinding(name: string): boolean } {
  return {
    isUserBinding(name: string): boolean {
      return isUserBinding(scope, name);
    },
  };
}

function isUserBinding(scope: ValidationScope, name: string): boolean {
  return scope.locals.has(name) || scope.moduleBindings.has(name);
}

function scopeWithNames(scope: ValidationScope, names: readonly string[]): ValidationScope {
  if (names.length === 0) return scope;
  const locals = new Set(scope.locals);
  for (const name of names) locals.add(name);
  return { moduleBindings: scope.moduleBindings, locals };
}

function recordExpressionScope(node: IRNode, propName: string, scope: ValidationScope): void {
  let scopes = expressionScopes.get(node);
  if (!scopes) {
    scopes = new Map();
    expressionScopes.set(node, scopes);
  }
  scopes.set(propName, new Set([...scope.moduleBindings, ...scope.locals]));
}

function selfBindingNames(node: IRNode): string[] {
  if (!isSelfBindingNode(node)) return [];
  const name = node.props?.name;
  return typeof name === 'string' && name.length > 0 ? [name] : [];
}

function isSelfBindingNode(node: IRNode): boolean {
  return (
    node.type === 'class' ||
    node.type === 'repository' ||
    node.type === 'service' ||
    node.type === 'fn' ||
    node.type === 'function' ||
    node.type === 'action'
  );
}

function catchBindingNames(node: IRNode): string[] {
  const name = node.props?.name;
  return typeof name === 'string' && name.length > 0 ? [name] : [];
}

function postStatementBindingNames(node: IRNode): string[] {
  if (node.type === 'destructure') return bindingNamesFromPatternChildren(node);
  if (
    node.type !== 'let' &&
    node.type !== 'const' &&
    node.type !== 'fn' &&
    node.type !== 'function' &&
    node.type !== 'class' &&
    node.type !== 'enum' &&
    node.type !== 'service' &&
    node.type !== 'screen' &&
    node.type !== 'action' &&
    node.type !== 'repository' &&
    node.type !== 'cache'
  ) {
    return [];
  }
  const name = node.props?.name;
  return typeof name === 'string' && name.length > 0 ? [name] : [];
}

function childScopeBindingNames(node: IRNode): string[] {
  switch (node.type) {
    case 'each':
      return [
        stringName(node.props?.name),
        stringName(node.props?.index),
        stringName(node.props?.pairKey),
        stringName(node.props?.pairValue),
        stringName(node.props?.entryKey),
        stringName(node.props?.entryValue),
      ].filter((name): name is string => Boolean(name));
    case 'for':
    case 'with':
      return [stringName(node.props?.name)].filter((name): name is string => Boolean(name));
    default:
      return [];
  }
}

function isSequentialScopeNode(node: IRNode): boolean {
  return (
    node.type === 'module' ||
    node.type === 'handler' ||
    node.type === 'try' ||
    node.type === 'catch' ||
    node.type === 'finally' ||
    node.type === 'if' ||
    node.type === 'else' ||
    node.type === 'each' ||
    node.type === 'while' ||
    node.type === 'for' ||
    node.type === 'with' ||
    node.type === 'path'
  );
}

function validateLegacyParams(node: IRNode, scope: ValidationScope): string[] | null {
  const rawParams = node.props?.params;
  if (typeof rawParams !== 'string' || rawParams.trim() === '') return null;
  const parsed = parseLegacyParams(rawParams);
  if (parsed === null) {
    // BLOCKER 1 + IMPORTANT 3 — the param string is MALFORMED (the TS parser
    // reported parse diagnostics). FAIL CLOSED on BOTH axes:
    //  - trust NO extracted bindings (a recovery-AST `process = (` must NOT make
    //    `process.exit()` in the body look shadowed — IMPORTANT 3), and
    //  - the emitter (`parseParamList`) still emits the raw param string
    //    verbatim, so a host root in the malformed default (`ts:number=Date.now(]`
    //    → `Date.now`) must still be REJECTED (BLOCKER 1) rather than slipping
    //    through unvalidated. The raw host-namespace scan over the whole string
    //    surfaces exactly `Module.member` / `Module(` host accesses, honoring
    //    user shadowing via `exprContext(scope)`.
    // Returning `[]` (not `null`) keeps `validateNode` on the legacy-params path
    // (this node HAS a `params` prop, so its param CHILDREN must not be used).
    validateRawHostNamespacesTS(rawParams, exprContext(scope));
    return [];
  }
  let defaultScope = scope;
  for (const param of parsed) {
    if (param.defaultValue !== null) validateExpressionValue(param.defaultValue, defaultScope);
    if (param.name) defaultScope = scopeWithNames(defaultScope, [param.name]);
  }
  return parsed.map((param) => param.name).filter((name): name is string => Boolean(name));
}

function paramChildNames(node: IRNode): string[] {
  const names: string[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== 'param') continue;
    names.push(...bindingNamesFromPatternChildren(child));
  }
  return names;
}

function bindingNamesFromPatternChildren(node: IRNode): string[] {
  const names: string[] = [];
  const hasPatternChildren = (node.children ?? []).some(
    (child) => child.type === 'binding' || child.type === 'element',
  );
  const ownName = stringName(node.props?.name);
  if (ownName && !hasPatternChildren) names.push(ownName);
  for (const child of node.children ?? []) {
    if (child.type !== 'binding' && child.type !== 'element') continue;
    const name = stringName(child.props?.name);
    if (name) names.push(name);
  }
  return names;
}

function stringName(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseLegacyParams(raw: string): Array<{ name: string | null; defaultValue: string | null }> | null {
  // GAP 4 + BLOCKER 2 — parse the legacy `params="..."` string with the REAL
  // TypeScript parser (auto-handling `==`/`===`/`<=`/`>=`, regex literals with
  // commas, nested generics, and template literals in defaults — every case the
  // old char-scanner mis-split). The `ts.createSourceFile` call lives in
  // `parseLegacyParamSignature` (closure-eligibility.ts, which already owns the
  // `typescript` import + AST helpers) so this module stays free of a static
  // `typescript` import — keeping the core barrel's typescript-importer pin at 5
  // (browser-spine-import-graph.test.ts). A MALFORMED param string yields `null`
  // (NOT a phantom recovery-AST), which `validateLegacyParams` turns into a
  // fail-closed raw scan + zero trusted bindings — IMPORTANT 3 + BLOCKER 1.
  const signature = parseLegacyParamSignature(raw);
  if (signature === null) return null;
  return signature.map((param) => ({ name: param.name, defaultValue: param.default }));
}

function newExpressionRootIdentifier(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'call' && node.callee.kind === 'ident') return node.callee.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return newExpressionRootIdentifier(node.expression);
  return null;
}

function isSimpleErrorConstructor(node: ValueIR): boolean {
  return (
    (node.kind === 'ident' && node.name === 'Error') ||
    (node.kind === 'call' && node.callee.kind === 'ident' && node.callee.name === 'Error')
  );
}

function hostNamespaceReceiverRoot(node: ValueIR): string | null {
  if (node.kind === 'ident') return node.name;
  if (node.kind === 'member' || node.kind === 'index') return hostNamespaceReceiverRoot(node.object);
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return hostNamespaceReceiverRoot(node.expression);
  return null;
}

function hostNamespaceMemberLabel(receiver: ValueIR, fallback: string): string {
  return firstMemberAfterRoot(receiver) ?? fallback;
}

function firstMemberAfterRoot(node: ValueIR): string | null {
  if (node.kind === 'member') {
    const nested = firstMemberAfterRoot(node.object);
    return nested ?? node.property;
  }
  if (node.kind === 'index') {
    const nested = firstMemberAfterRoot(node.object);
    if (nested) return nested;
    return node.index.kind === 'strLit' ? node.index.value : '[computed]';
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') return firstMemberAfterRoot(node.expression);
  return null;
}
