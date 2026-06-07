/**
 * suggest-kern-primitive — migration rule that flags JS patterns where an
 * equivalent KERN primitive exists (array methods + fmt + conditional + async)
 * or where the expression is covered by the portable logic primitive registry.
 *
 * Fires as `info` / precision=`experimental` so kern-sight hides it by default.
 * Opt in with `--rule suggest-kern-primitive` for a one-shot migration scan.
 *
 * Covers the 22 shipped array primitives (post PR #93 + #103 + PR C):
 *   filter, find, some, every, findIndex, reduce, map, flatMap, flat, slice,
 *   at, sort, reverse, join, includes, indexOf, lastIndexOf, concat, forEach,
 *   compact, pluck, unique.
 *
 * Plus three structural primitives:
 *   - Template literal in `const` → `fmt name=x template="…"`
 *   - JSX ternary in `{…}`       → `conditional if="…"` + handler/else
 *   - async fn with try/catch    → `async name=X` + `recover`/`strategy`
 *
 * Special-cased shapes (route to the narrower primitive rather than the generic one):
 *   - `.filter(Boolean)`              → `compact`
 *   - `.map(x => x.prop[.chain])`     → `pluck`
 *   - `[...new Set(coll)]`            → `unique`
 *
 * Immutability note: TS `.sort()` and `.reverse()` mutate; KERN emits the
 * immutable `[...coll].sort(...)` / `[...coll].reverse()` shape. Suggestions
 * for those two methods include a callout so authors can audit callers before
 * migrating.
 */

import {
  buildKernSemanticSubstrate,
  lookupSemanticPrimitive,
  type PortableLogicPrimitiveId,
  type PortableLogicTarget,
  semanticPrimitiveSupportSummary,
} from '@kernlang/core';
import type {
  ArrowFunction,
  BinaryExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  NewExpression,
  Node as TsNode,
} from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, ReviewRule, RuleContext } from '../types.js';
import { finding } from './utils.js';

type MethodShape =
  | 'predicate'
  | 'expr'
  | 'reduce'
  | 'slice'
  | 'at'
  | 'flat'
  | 'value'
  | 'join'
  | 'concat'
  | 'sort'
  | 'reverse'
  | 'forEach';

interface MethodSpec {
  kernNode: string;
  shape: MethodShape;
}

const ARRAY_METHODS: Record<string, MethodSpec> = {
  filter: { kernNode: 'filter', shape: 'predicate' },
  find: { kernNode: 'find', shape: 'predicate' },
  some: { kernNode: 'some', shape: 'predicate' },
  every: { kernNode: 'every', shape: 'predicate' },
  findIndex: { kernNode: 'findIndex', shape: 'predicate' },
  map: { kernNode: 'map', shape: 'expr' },
  flatMap: { kernNode: 'flatMap', shape: 'expr' },
  reduce: { kernNode: 'reduce', shape: 'reduce' },
  slice: { kernNode: 'slice', shape: 'slice' },
  at: { kernNode: 'at', shape: 'at' },
  flat: { kernNode: 'flat', shape: 'flat' },
  join: { kernNode: 'join', shape: 'join' },
  includes: { kernNode: 'includes', shape: 'value' },
  indexOf: { kernNode: 'indexOf', shape: 'value' },
  lastIndexOf: { kernNode: 'lastIndexOf', shape: 'value' },
  concat: { kernNode: 'concat', shape: 'concat' },
  forEach: { kernNode: 'forEach', shape: 'forEach' },
  sort: { kernNode: 'sort', shape: 'sort' },
  reverse: { kernNode: 'reverse', shape: 'reverse' },
};

const PORTABLE_LOGIC_TARGETS: readonly PortableLogicTarget[] = ['ts', 'python', 'go'];
const KERN_SEMANTIC_SUBSTRATE = buildKernSemanticSubstrate();

// Node kinds whose descendants should be skipped — don't flag opportunities
// inside test files, type-only files, or generated code paths by path hint.
function shouldSkipFile(ctx: RuleContext): boolean {
  const p = ctx.filePath.toLowerCase();
  if (p.endsWith('.d.ts')) return true;
  if (p.includes('/node_modules/')) return true;
  if (p.includes('/dist/') || p.includes('/build/')) return true;
  if (p.includes('/generated/')) return true;
  return false;
}

function isArrowLike(n: TsNode | undefined): n is ArrowFunction | FunctionExpression {
  return !!n && (Node.isArrowFunction(n) || Node.isFunctionExpression(n));
}

/**
 * Extract an arrow/function body as a single expression string.
 * Returns null for block bodies (multi-statement), which aren't a clean fit
 * for an inline `where=` / `expr=` suggestion — those need a handler block.
 */
function extractSingleExprBody(arrow: ArrowFunction | FunctionExpression): string | null {
  const body = arrow.getBody();
  if (Node.isBlock(body)) return null;
  return body.getText();
}

function escapeKernString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Template-content escape: preserve whitespace (template body is significant)
 * but neutralise characters that would break out of a double-quoted `template=`
 * prop. `${…}` placeholders pass through untouched — that's the whole reason
 * `fmt` exists.
 */
function escapeKernTemplate(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isJsxLike(n: TsNode): boolean {
  return Node.isJsxElement(n) || Node.isJsxFragment(n) || Node.isJsxSelfClosingElement(n);
}

function paramName(arrow: ArrowFunction | FunctionExpression, idx: number): string | null {
  const params = arrow.getParameters();
  if (params.length <= idx) return null;
  const name = params[idx].getName();
  // Destructured or rest parameters — skip, they don't round-trip into a bare identifier binding.
  if (name.startsWith('{') || name.startsWith('[') || name.startsWith('...')) return null;
  return name;
}

/**
 * Is the arrow a Boolean-coercion shape `x => !!x` or `x => Boolean(x)` where
 * the coerced expression is just the first parameter? These are the two
 * common handwritten equivalents of `.filter(Boolean)` and route to `compact`.
 *
 * Only matches when the arrow's body references the parameter directly — not
 * a property access or a computed expression — so we don't silently rewrite
 * `x => !!x.active` (which is `filter where="x.active"`, not `compact`).
 */
function isBooleanCoercionOfFirstParam(arrow: ArrowFunction | FunctionExpression): boolean {
  if (arrow.getParameters().length !== 1) return false;
  const param = paramName(arrow, 0);
  if (!param) return false;
  const body = arrow.getBody();
  if (Node.isBlock(body)) return false;

  // `!!x` — PrefixUnaryExpression(!, PrefixUnaryExpression(!, <Identifier param>))
  if (Node.isPrefixUnaryExpression(body) && body.getOperatorToken() === SyntaxKind.ExclamationToken) {
    const inner = body.getOperand();
    if (Node.isPrefixUnaryExpression(inner) && inner.getOperatorToken() === SyntaxKind.ExclamationToken) {
      const innermost = inner.getOperand();
      if (Node.isIdentifier(innermost) && innermost.getText() === param) return true;
    }
  }

  // `Boolean(x)` — CallExpression where callee is Identifier "Boolean" and sole arg is the param.
  if (Node.isCallExpression(body)) {
    const callee = body.getExpression();
    if (Node.isIdentifier(callee) && callee.getText() === 'Boolean') {
      const args = body.getArguments();
      if (args.length === 1 && Node.isIdentifier(args[0]) && args[0].getText() === param) return true;
    }
  }

  return false;
}

/**
 * If the arrow body is a property-access chain rooted at `item` (the first
 * parameter), return the dot-path without the item prefix. Returns null for
 * anything else — computed access, method calls, nested expressions, or
 * optional-chain segments (since `pluck` emits plain dot-access that would
 * throw if an intermediate is nullish).
 *
 *   item => item.name                 → "name"
 *   u    => u.profile.address.city    → "profile.address.city"
 *   u    => u.profile?.name           → null  (optional chain; kern `pluck` emits plain `.`)
 *   x    => x.toUpperCase()           → null  (method call, not property chain)
 *   x    => x[0]                      → null  (computed, index access)
 *   x    => x                         → null  (just the parameter, no projection)
 */
function propertyAccessChainFromItem(arrow: ArrowFunction | FunctionExpression, itemName: string): string | null {
  const body = arrow.getBody();
  if (Node.isBlock(body)) return null;
  if (!Node.isPropertyAccessExpression(body)) return null;

  const segments: string[] = [];
  let cur: TsNode = body;
  while (Node.isPropertyAccessExpression(cur)) {
    // Optional-chain segments would require KERN to emit `item.a?.b`, which
    // the current `pluck` lowering does not support. Fall back to `map`.
    if (cur.hasQuestionDotToken()) return null;
    segments.unshift(cur.getName());
    cur = cur.getExpression();
  }
  if (!Node.isIdentifier(cur) || cur.getText() !== itemName) return null;
  return segments.join('.');
}

/**
 * Is the TS text safe to inject into a KERN bare prop value (after `prop=`)?
 * KERN's bare-prop parser stops at whitespace, `{`, and `$`. Anything else
 * must be wrapped in a raw-expression form `{{ … }}` so the receiver survives
 * parsing intact.
 */
function isBareKernValue(s: string): boolean {
  return /^[A-Za-z_$][\w.$[\]]*$/.test(s);
}

/**
 * Wrap a TS expression text for use as a KERN bare prop value. Identifiers
 * and simple property paths pass through; anything else becomes a raw-
 * expression block so whitespace/operators/calls don't break parsing.
 */
function toKernInValue(s: string): string {
  return isBareKernValue(s) ? s : `{{ ${s} }}`;
}

function nodeColumn(node: TsNode): number {
  return node.getSourceFile().getLineAndColumnAtPos(node.getStart()).column;
}

function portableLogicSupportSummary(id: PortableLogicPrimitiveId): string {
  return semanticPrimitiveSupportSummary(lookupSemanticPrimitive(KERN_SEMANTIC_SUBSTRATE, id), PORTABLE_LOGIC_TARGETS);
}

function portableLogicFinding(
  ctx: RuleContext,
  node: TsNode,
  id: PortableLogicPrimitiveId,
  label: string,
): ReviewFinding {
  const primitive = lookupSemanticPrimitive(KERN_SEMANTIC_SUBSTRATE, id);
  return finding(
    'suggest-kern-primitive',
    'info',
    'pattern',
    `JS ${label} is covered by KERN portable logic primitive \`${id}\` / \`${primitive.kernName}\` (${portableLogicSupportSummary(id)})`,
    ctx.filePath,
    node.getStartLineNumber(),
    nodeColumn(node),
    { suggestion: `portable logic primitive ${id}: ${node.getText()}` },
  );
}

function isNewExpressionFor(node: TsNode, constructorName: string): node is NewExpression {
  return Node.isNewExpression(node) && node.getExpression().getText() === constructorName;
}

function unwrapParenthesized(node: TsNode): TsNode {
  let current = node;
  while (Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
}

function isSimpleExpressionPosition(node: TsNode): boolean {
  let expr: TsNode = node;
  let parent = expr.getParent();
  while (parent && Node.isParenthesizedExpression(parent)) {
    expr = parent;
    parent = parent.getParent();
  }

  if (parent && Node.isVariableDeclaration(parent)) return parent.getInitializer() === expr;
  if (parent && Node.isReturnStatement(parent)) return parent.getExpression() === expr;
  return false;
}

type MathStaticMethod = 'min' | 'max';
interface ClampParts {
  value: TsNode;
  min: TsNode;
  max: TsNode;
}

function mathStaticMethod(call: CallExpression): MathStaticMethod | null {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  if (callee.getExpression().getText() !== 'Math') return null;
  const name = callee.getName();
  return name === 'min' || name === 'max' ? name : null;
}

function isMathStaticCall(call: CallExpression, methodName: MathStaticMethod): boolean {
  return mathStaticMethod(call) === methodName;
}

function isSideEffectFreeClampExpression(node: TsNode, allowLiteral: boolean): boolean {
  const unwrapped = unwrapParenthesized(node);
  if (Node.isIdentifier(unwrapped)) {
    return true;
  }
  if (allowLiteral && Node.isNumericLiteral(unwrapped)) {
    return true;
  }
  if (Node.isPropertyAccessExpression(unwrapped)) {
    return isSideEffectFreeClampExpression(unwrapped.getExpression(), true);
  }
  if (Node.isElementAccessExpression(unwrapped)) {
    const arg = unwrapped.getArgumentExpression();
    return (
      isSideEffectFreeClampExpression(unwrapped.getExpression(), true) &&
      !!arg &&
      isSideEffectFreeClampExpression(arg, true)
    );
  }
  if (Node.isPrefixUnaryExpression(unwrapped)) {
    const op = unwrapped.getOperatorToken();
    if (op === SyntaxKind.PlusPlusToken || op === SyntaxKind.MinusMinusToken) return false;
    return allowLiteral && isSideEffectFreeClampExpression(unwrapped.getOperand(), true);
  }
  return false;
}

function isSideEffectFreeClampBound(node: TsNode): boolean {
  return isSideEffectFreeClampExpression(node, true);
}

function isSideEffectFreeClampValue(node: TsNode): boolean {
  return isSideEffectFreeClampExpression(node, false);
}

function numericLiteralValue(node: TsNode): number | null {
  const unwrapped = unwrapParenthesized(node);
  if (Node.isNumericLiteral(unwrapped)) return Number(unwrapped.getLiteralText());
  if (Node.isPrefixUnaryExpression(unwrapped)) {
    const op = unwrapped.getOperatorToken();
    const operand = numericLiteralValue(unwrapped.getOperand());
    if (operand === null) return null;
    if (op === SyntaxKind.MinusToken) return -operand;
    if (op === SyntaxKind.PlusToken) return operand;
  }
  return null;
}

function hasReversedLiteralClampBounds(outerMethod: MathStaticMethod, outerBound: TsNode, innerBound: TsNode): boolean {
  const low = numericLiteralValue(outerMethod === 'max' ? outerBound : innerBound);
  const high = numericLiteralValue(outerMethod === 'max' ? innerBound : outerBound);
  return low !== null && high !== null && low > high;
}

function clampBoundHint(node: TsNode, role: 'min' | 'max'): number {
  if (numericLiteralValue(node) !== null) return 2;
  const segments = unwrapParenthesized(node).getText().toLowerCase().split(/[._]/).filter(Boolean);
  const hints = role === 'min' ? ['min', 'minimum', 'lo', 'low', 'lower'] : ['max', 'maximum', 'hi', 'high', 'upper'];
  if (
    segments.some((segment) =>
      hints.some((hint) => segment === hint || segment.startsWith(hint) || segment.endsWith(hint)),
    )
  ) {
    return 2;
  }
  return 0;
}

function portableClampParts(
  call: CallExpression,
  shadowsGlobalMath: boolean,
  options: { allowAmbiguous?: boolean } = {},
): ClampParts | null {
  if (shadowsGlobalMath) return null;
  const outerMethod = mathStaticMethod(call);
  if (!outerMethod) return null;
  const outerArgs = call.getArguments();
  if (outerArgs.length !== 2) return null;

  const innerMethod: MathStaticMethod = outerMethod === 'max' ? 'min' : 'max';
  for (const [innerIdx, candidate] of outerArgs.entries()) {
    const inner = unwrapParenthesized(candidate);
    if (!Node.isCallExpression(inner) || !isMathStaticCall(inner, innerMethod)) continue;
    const outerBound = outerArgs[innerIdx === 0 ? 1 : 0];
    if (!isSideEffectFreeClampBound(outerBound)) continue;

    const innerArgs = inner.getArguments();
    if (innerArgs.length !== 2) continue;
    const candidates: Array<{ value: TsNode; innerBound: TsNode; score: number }> = [];
    for (const [valueIdx, arg] of innerArgs.entries()) {
      const innerBound = innerArgs[valueIdx === 0 ? 1 : 0];
      if (
        isSideEffectFreeClampValue(arg) &&
        isSideEffectFreeClampBound(innerBound) &&
        !hasReversedLiteralClampBounds(outerMethod, outerBound, innerBound)
      ) {
        candidates.push({
          value: arg,
          innerBound,
          score: clampBoundHint(innerBound, outerMethod === 'max' ? 'max' : 'min'),
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (
      best &&
      options.allowAmbiguous !== true &&
      best.score === 0 &&
      candidates.length > 1 &&
      candidates[1]?.score === 0
    ) {
      return null;
    }
    if (best) {
      return outerMethod === 'max'
        ? { value: best.value, min: outerBound, max: best.innerBound }
        : { value: best.value, min: best.innerBound, max: outerBound };
    }
  }
  return null;
}

function isPortableClampCall(call: CallExpression, shadowsGlobalMath: boolean): boolean {
  return portableClampParts(call, shadowsGlobalMath, { allowAmbiguous: true }) !== null;
}

function expressionBindingName(node: TsNode): string {
  let expr: TsNode = node;
  let parent = expr.getParent();
  while (parent && Node.isParenthesizedExpression(parent)) {
    expr = parent;
    parent = parent.getParent();
  }
  if (parent && Node.isVariableDeclaration(parent) && parent.getInitializer() === expr) {
    const nameNode = parent.getNameNode();
    if (Node.isIdentifier(nameNode)) return nameNode.getText();
  }
  return '<name>';
}

function clampNodeSuggestion(call: CallExpression, parts: ClampParts): string {
  return `clamp name=${expressionBindingName(call)} value={{ ${parts.value.getText()} }} min={{ ${parts.min.getText()} }} max={{ ${parts.max.getText()} }}`;
}

function isRegexLiteral(node: TsNode | undefined): boolean {
  return !!node && node.getKind() === SyntaxKind.RegularExpressionLiteral;
}

function isRegExpConstructorCall(node: TsNode): boolean {
  const unwrapped = unwrapParenthesized(node);
  if (Node.isNewExpression(unwrapped) || Node.isCallExpression(unwrapped)) {
    // Text-based on purpose: shadowing global RegExp only suppresses a suggestion.
    return unwrapped.getExpression().getText() === 'RegExp';
  }
  return false;
}

function identifierInitializer(node: TsNode, seen = new Set<string>()): TsNode | null {
  const unwrapped = unwrapParenthesized(node);
  if (!Node.isIdentifier(unwrapped)) return null;
  const declarations = unwrapped.getSymbol()?.getDeclarations() ?? [];
  const key = declarations.map((decl) => `${decl.getSourceFile().getFilePath()}:${decl.getStart()}`).join('|');
  if (key) {
    if (seen.has(key)) return null;
    seen.add(key);
  }
  for (const decl of declarations) {
    if (!Node.isVariableDeclaration(decl)) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    const unwrappedInit = unwrapParenthesized(init);
    if (Node.isIdentifier(unwrappedInit)) return identifierInitializer(unwrappedInit, seen);
    return unwrappedInit;
  }
  return null;
}

function isRegexSearchValue(node: TsNode | undefined): boolean {
  if (!node) return false;
  const unwrapped = unwrapParenthesized(node);
  if (isRegexLiteral(unwrapped) || isRegExpConstructorCall(unwrapped)) return true;
  const init = identifierInitializer(unwrapped);
  return !!init && (isRegexLiteral(init) || isRegExpConstructorCall(init));
}

function isReplacementCallback(node: TsNode | undefined, seen = new Set<string>()): boolean {
  if (!node) return false;
  const unwrapped = unwrapParenthesized(node);
  if (Node.isArrowFunction(unwrapped) || Node.isFunctionExpression(unwrapped)) return true;

  if (!Node.isIdentifier(unwrapped)) return false;
  const declarations = unwrapped.getSymbol()?.getDeclarations() ?? [];
  const key = declarations.map((decl) => `${decl.getSourceFile().getFilePath()}:${decl.getStart()}`).join('|');
  if (key) {
    if (seen.has(key)) return false;
    seen.add(key);
  }
  for (const decl of declarations) {
    if (Node.isFunctionDeclaration(decl)) return true;
    if (!Node.isVariableDeclaration(decl)) continue;
    const init = decl.getInitializer();
    if (init && isReplacementCallback(init, seen)) return true;
  }
  return false;
}

function stringLiteralText(node: TsNode): string | null {
  const unwrapped = unwrapParenthesized(node);
  if (Node.isStringLiteral(unwrapped) || Node.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.getLiteralText();
  }
  return null;
}

function sourceFileDeclaresBinding(ctx: RuleContext, name: string): boolean {
  const isNamedIdentifier = (node: TsNode): boolean => Node.isIdentifier(node) && node.getText() === name;

  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    if (isNamedIdentifier(decl.getNameNode())) return true;
  }
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
    if (isNamedIdentifier(decl.getNameNode())) return true;
  }
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BindingElement)) {
    if (isNamedIdentifier(decl.getNameNode())) return true;
  }
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    if (decl.getName() === name) return true;
  }
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    if (decl.getName() === name) return true;
  }
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ImportSpecifier)) {
    const alias = decl.getAliasNode();
    if (alias ? alias.getText() === name : decl.getName() === name) return true;
  }
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NamespaceImport)) {
    if (decl.getName() === name) return true;
  }
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ImportClause)) {
    if (decl.getDefaultImport()?.getText() === name) return true;
  }
  return false;
}

function knownStringLiteralText(node: TsNode | undefined, seen = new Set<string>()): string | null {
  if (!node) return null;
  const unwrapped = unwrapParenthesized(node);
  const literal = stringLiteralText(unwrapped);
  if (literal !== null) return literal;
  if (Node.isIdentifier(unwrapped)) {
    const declarations = unwrapped.getSymbol()?.getDeclarations() ?? [];
    const key = declarations.map((decl) => `${decl.getSourceFile().getFilePath()}:${decl.getStart()}`).join('|');
    if (key) {
      if (seen.has(key)) return null;
      seen.add(key);
    }
    const init = identifierInitializer(unwrapped);
    return init ? knownStringLiteralText(init, seen) : null;
  }
  return null;
}

function isKnownStringSearchValue(node: TsNode | undefined): boolean {
  const text = knownStringLiteralText(node);
  return text !== null && text !== '';
}

function objectPortablePrimitiveFor(methodName: string): PortableLogicPrimitiveId | null {
  switch (methodName) {
    case 'keys':
      return 'object.keys';
    case 'values':
      return 'object.values';
    case 'entries':
      return 'object.entries';
    default:
      return null;
  }
}

function variableNameForInitializer(expr: TsNode): string | null {
  const parent = expr.getParent();
  if (!parent || !Node.isVariableDeclaration(parent) || parent.getInitializer() !== expr) return null;
  const nameNode = parent.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : null;
}

function formatKernStringListForQuotedProp(keys: string[]): string {
  return `[${keys.map((key) => `'${escapeKernSingleQuotedStringForQuotedProp(key)}'`).join(', ')}]`;
}

function escapeKernSingleQuotedStringForQuotedProp(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function objectPickFinding(
  ctx: RuleContext,
  node: TsNode,
  name: string,
  source: string,
  keys: string[],
): ReviewFinding {
  const formattedKeys = formatKernStringListForQuotedProp(keys);
  const sourceValue = toKernInValue(source);
  return finding(
    'suggest-kern-primitive',
    'info',
    'pattern',
    'JS shallow object pick could migrate to KERN `objectPick` — shallow own string-key record selection',
    ctx.filePath,
    node.getStartLineNumber(),
    nodeColumn(node),
    { suggestion: `objectPick name=${name} in=${sourceValue} keys="${formattedKeys}"` },
  );
}

function objectOmitFinding(
  ctx: RuleContext,
  node: TsNode,
  name: string,
  source: string,
  keys: string[],
): ReviewFinding {
  const formattedKeys = formatKernStringListForQuotedProp(keys);
  const sourceValue = toKernInValue(source);
  return finding(
    'suggest-kern-primitive',
    'info',
    'pattern',
    'JS shallow object omit could migrate to KERN `objectOmit` — shallow own string-key record omission',
    ctx.filePath,
    node.getStartLineNumber(),
    nodeColumn(node),
    { suggestion: `objectOmit name=${name} in=${sourceValue} keys="${formattedKeys}"` },
  );
}

function destructuredPropertyNameText(node: TsNode): string | null {
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNumericLiteral(node)) return node.getLiteralText();
  return null;
}

function firstTruthySuggestion(expr: BinaryExpression): { name: string; values: string } | null {
  if (expr.getOperatorToken().getKind() !== SyntaxKind.BarBarToken) return null;
  const name = variableNameForInitializer(expr);
  if (!name) return null;

  const values = flattenOrChain(expr);
  if (values.length < 2) return null;
  if (isObviousBooleanPredicateFallback(name, values)) return null;

  return { name, values: values.map((value) => value.getText()).join(', ') };
}

function flattenOrChain(expr: BinaryExpression): TsNode[] {
  const left = expr.getLeft();
  const right = expr.getRight();
  const out: TsNode[] = [];
  if (Node.isBinaryExpression(left) && left.getOperatorToken().getKind() === SyntaxKind.BarBarToken) {
    out.push(...flattenOrChain(left));
  } else {
    out.push(left);
  }
  if (Node.isBinaryExpression(right) && right.getOperatorToken().getKind() === SyntaxKind.BarBarToken) {
    out.push(...flattenOrChain(right));
  } else {
    out.push(right);
  }
  return out;
}

function isObviousBooleanPredicateFallback(name: string, values: TsNode[]): boolean {
  if (values.length !== 2) return false;
  const text = [name, ...values.map((value) => value.getText())];
  return text.every(looksLikeBooleanPredicateName);
}

function looksLikeBooleanPredicateName(value: string): boolean {
  return /^(?:is|has|can|should|did|will|ok|valid|enabled|ready|active)(?:[A-Z_]|$)/.test(value);
}

function coalesceSuggestion(expr: BinaryExpression): { name: string; values: string } | null {
  if (expr.getOperatorToken().getKind() !== SyntaxKind.QuestionQuestionToken) return null;
  const name = variableNameForInitializer(expr);
  if (!name) return null;

  const values = flattenQuestionQuestionChain(expr);
  if (values.length < 2) return null;

  return { name, values: values.map((value) => value.getText()).join(', ') };
}

function flattenQuestionQuestionChain(expr: BinaryExpression): TsNode[] {
  const left = unwrapParenthesizedExpression(expr.getLeft());
  const right = unwrapParenthesizedExpression(expr.getRight());
  const out: TsNode[] = [];
  if (Node.isBinaryExpression(left) && left.getOperatorToken().getKind() === SyntaxKind.QuestionQuestionToken) {
    out.push(...flattenQuestionQuestionChain(left));
  } else {
    out.push(left);
  }
  if (Node.isBinaryExpression(right) && right.getOperatorToken().getKind() === SyntaxKind.QuestionQuestionToken) {
    out.push(...flattenQuestionQuestionChain(right));
  } else {
    out.push(right);
  }
  return out;
}

function unwrapParenthesizedExpression(node: TsNode): TsNode {
  return Node.isParenthesizedExpression(node) ? node.getExpression() : node;
}

function coalesceFinding(ctx: RuleContext, node: TsNode, name: string, values: string): ReviewFinding {
  return finding(
    'suggest-kern-primitive',
    'info',
    'pattern',
    'JS nullish fallback chain could migrate to KERN `coalesce` — named portable fallback selection',
    ctx.filePath,
    node.getStartLineNumber(),
    nodeColumn(node),
    { suggestion: `coalesce name=${name} values="${escapeKernString(values)}"` },
  );
}

function firstTruthyFinding(ctx: RuleContext, node: TsNode, name: string, values: string): ReviewFinding {
  return finding(
    'suggest-kern-primitive',
    'info',
    'pattern',
    'JS truthy fallback chain could migrate to KERN `firstTruthy` — named portable fallback selection',
    ctx.filePath,
    node.getStartLineNumber(),
    nodeColumn(node),
    { suggestion: `firstTruthy name=${name} values="${escapeKernString(values)}"` },
  );
}

function objectLiteralPickSuggestion(expr: TsNode): { name: string; source: string; keys: string[] } | null {
  if (!Node.isObjectLiteralExpression(expr)) return null;
  const name = variableNameForInitializer(expr);
  if (!name) return null;

  const properties = expr.getProperties();
  if (properties.length === 0) return null;

  let commonReceiver: string | null = null;
  const keys: string[] = [];

  for (const prop of properties) {
    if (!Node.isPropertyAssignment(prop)) return null;
    const propKey = prop.getName();
    const initializer = prop.getInitializer();
    if (!initializer || !Node.isPropertyAccessExpression(initializer)) return null;

    const receiver = initializer.getExpression();
    if (!Node.isIdentifier(receiver)) return null;

    const accessedProp = initializer.getName();
    if (accessedProp !== propKey) return null;

    const receiverText = receiver.getText();
    if (commonReceiver === null) {
      commonReceiver = receiverText;
    } else if (commonReceiver !== receiverText) {
      return null;
    }

    keys.push(propKey);
  }

  if (!commonReceiver) return null;
  return { name, source: commonReceiver, keys };
}

function objectMergeFinding(ctx: RuleContext, node: TsNode, name: string, sources: string): ReviewFinding {
  return finding(
    'suggest-kern-primitive',
    'info',
    'pattern',
    'JS shallow object merge could migrate to KERN `objectMerge` — non-mutating, left-to-right, last-write-wins record merge',
    ctx.filePath,
    node.getStartLineNumber(),
    nodeColumn(node),
    { suggestion: `objectMerge name=${name} sources="${escapeKernString(sources)}"` },
  );
}

function objectAssignMergeSuggestion(call: CallExpression): { name: string; sources: string } | null {
  const name = variableNameForInitializer(call);
  if (!name) return null;
  const args = call.getArguments();
  if (args.length < 3) return null;
  const target = unwrapParenthesized(args[0]);
  if (!Node.isObjectLiteralExpression(target) || target.getProperties().length !== 0) return null;
  return {
    name,
    sources: args
      .slice(1)
      .map((arg) => arg.getText())
      .join(', '),
  };
}

function objectLiteralMergeSuggestion(expr: TsNode): { name: string; sources: string } | null {
  if (!Node.isObjectLiteralExpression(expr)) return null;
  const name = variableNameForInitializer(expr);
  if (!name) return null;

  const sources: string[] = [];
  let literalProps: string[] = [];
  const flushLiteral = () => {
    if (literalProps.length > 0) {
      sources.push(`{ ${literalProps.join(', ')} }`);
      literalProps = [];
    }
  };

  for (const prop of expr.getProperties()) {
    if (Node.isSpreadAssignment(prop)) {
      flushLiteral();
      sources.push(prop.getExpression().getText());
    } else {
      literalProps.push(prop.getText());
    }
  }
  flushLiteral();

  const spreadCount = expr.getProperties().filter((prop) => Node.isSpreadAssignment(prop)).length;
  return spreadCount > 0 && sources.length >= 2 ? { name, sources: sources.join(', ') } : null;
}

function stringPortablePrimitiveFor(call: CallExpression, methodName: string): PortableLogicPrimitiveId | null {
  const args = call.getArguments();
  switch (methodName) {
    case 'trim':
      return args.length === 0 ? 'string.trim' : null;
    case 'split':
      if (args.length < 1 || args.length > 2) return null;
      return isRegexSearchValue(args[0]) || !isKnownStringSearchValue(args[0]) ? null : 'string.split';
    case 'replace': {
      const replaceText = knownStringLiteralText(args[1]);
      if (
        args.length !== 2 ||
        isRegexSearchValue(args[0]) ||
        !isKnownStringSearchValue(args[0]) ||
        isReplacementCallback(args[1]) ||
        replaceText === null ||
        // Intentionally conservative: any "$" could participate in JS replacement-pattern syntax.
        replaceText.includes('$')
      ) {
        return null;
      }
      return 'string.replaceFirst';
    }
    case 'replaceAll': {
      const replaceAllText = knownStringLiteralText(args[1]);
      if (
        args.length !== 2 ||
        isRegexSearchValue(args[0]) ||
        !isKnownStringSearchValue(args[0]) ||
        isReplacementCallback(args[1]) ||
        replaceAllText === null ||
        // Intentionally conservative: any "$" could participate in JS replacement-pattern syntax.
        replaceAllText.includes('$')
      ) {
        return null;
      }
      return 'string.replaceAll';
    }
    default:
      return null;
  }
}

/**
 * Build the KERN primitive suggestion string for a single JS call site.
 * Returns null when the call shape can't be cleanly migrated (e.g. block body,
 * missing required args) — caller should skip silently in those cases.
 */
function buildSuggestion(spec: MethodSpec, collection: string, call: CallExpression): string | null {
  const args = call.getArguments();
  const name = '<name>';
  // Wrap non-bare receivers (chained calls, parenthesized, whitespace) so
  // KERN bare-prop parsing doesn't truncate at the first space.
  const inVal = toKernInValue(collection);

  switch (spec.shape) {
    case 'predicate': {
      // Skip arrows whose body references the second (index) parameter —
      // KERN's predicate-form primitives don't bind an index, so migrating
      // `(x, i) => i === 0` would silently drop `i`.
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      if (arrow.getParameters().length > 1) return null;
      const item = paramName(arrow, 0);
      if (!item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `${spec.kernNode} name=${name} in=${inVal}${itemProp} where="${escapeKernString(body)}"`;
    }
    case 'expr': {
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      if (arrow.getParameters().length > 1) return null;
      const item = paramName(arrow, 0);
      if (!item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `${spec.kernNode} name=${name} in=${inVal}${itemProp} expr="${escapeKernString(body)}"`;
    }
    case 'reduce': {
      if (args.length < 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      if (arrow.getParameters().length > 2) return null;
      const acc = paramName(arrow, 0);
      const item = paramName(arrow, 1);
      if (!acc || !item) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const initial = args[1]?.getText();
      if (!initial) return null;
      const accProp = acc === 'acc' ? '' : ` acc=${acc}`;
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `reduce name=${name} in=${inVal}${accProp}${itemProp} initial="${escapeKernString(initial)}" expr="${escapeKernString(body)}"`;
    }
    case 'slice': {
      const parts: string[] = [`slice name=${name} in=${inVal}`];
      const start = args[0]?.getText();
      const end = args[1]?.getText();
      if (start) parts.push(`start=${start}`);
      if (end) parts.push(`end=${end}`);
      return parts.join(' ');
    }
    case 'at': {
      const index = args[0]?.getText();
      if (!index) return null;
      return `at name=${name} in=${inVal} index=${index}`;
    }
    case 'flat': {
      const depth = args[0]?.getText();
      return depth ? `flat name=${name} in=${inVal} depth=${depth}` : `flat name=${name} in=${inVal}`;
    }
    case 'join': {
      const arg = args[0];
      if (!arg) return `join name=${name} in=${inVal}`;
      // Only string literals are safe as bare `separator=` props. Non-
      // literal separators need the raw-expression form; skip everything
      // else so the suggestion never changes runtime behavior.
      if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
        return `join name=${name} in=${inVal} separator=${arg.getText()}`;
      }
      return `join name=${name} in=${inVal} separator={{ ${arg.getText()} }}`;
    }
    case 'value': {
      const arg = args[0];
      if (!arg) return null;
      const value = arg.getText();
      // String literals can safely ride inside the double-quoted `value=`
      // prop (with escaping). Non-literal values need the raw-expression
      // form so the parser doesn't treat an identifier as a literal string.
      const valueProp =
        Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)
          ? `value="${escapeKernString(value)}"`
          : `value={{ ${value} }}`;
      const from = args[1]?.getText();
      const fromProp = from ? ` from=${from}` : '';
      return `${spec.kernNode} name=${name} in=${inVal} ${valueProp}${fromProp}`;
    }
    case 'concat': {
      if (args.length < 1) return null;
      const withArg = args.map((a) => a.getText()).join(', ');
      return `concat name=${name} in=${inVal} with={{ ${withArg} }}`;
    }
    case 'forEach': {
      if (args.length !== 1 || !isArrowLike(args[0])) return null;
      const arrow = args[0];
      const item = paramName(arrow, 0);
      if (!item) return null;
      const idx = paramName(arrow, 1);
      const idxProp = idx ? ` index=${idx}` : '';
      const itemProp = item === 'item' ? '' : ` item=${item}`;
      return `forEach in=${inVal}${itemProp}${idxProp}\n  handler <<<\n    ...\n  >>>`;
    }
    case 'sort': {
      if (args.length === 0) {
        return `sort name=${name} in=${inVal}  # NOTE: kern sort is immutable (spread source); TS .sort() mutates in place`;
      }
      if (!isArrowLike(args[0])) return null;
      const arrow = args[0];
      const a = paramName(arrow, 0);
      const b = paramName(arrow, 1);
      if (!a || !b) return null;
      const body = extractSingleExprBody(arrow);
      if (body === null) return null;
      const aProp = a === 'a' ? '' : ` a=${a}`;
      const bProp = b === 'b' ? '' : ` b=${b}`;
      return `sort name=${name} in=${inVal}${aProp}${bProp} compare="${escapeKernString(body)}"  # NOTE: kern sort is immutable`;
    }
    case 'reverse': {
      if (args.length !== 0) return null;
      return `reverse name=${name} in=${inVal}  # NOTE: kern reverse is immutable`;
    }
  }
}

function filterLengthCountSuggestion(collection: string, call: CallExpression): string | null {
  const parent = call.getParent();
  if (!Node.isPropertyAccessExpression(parent) || parent.getName() !== 'length') return null;

  const args = call.getArguments();
  if (args.length !== 1 || !isArrowLike(args[0])) return null;
  const arrow = args[0];
  if (arrow.getParameters().length !== 1) return null;

  const item = paramName(arrow, 0);
  if (!item) return null;
  const body = extractSingleExprBody(arrow);
  if (body === null) return null;

  const itemProp = item === 'item' ? '' : ` item=${item}`;
  return `count name=<name> in=${toKernInValue(collection)}${itemProp} where="${escapeKernString(body)}"`;
}

export function suggestKernPrimitive(ctx: RuleContext): ReviewFinding[] {
  if (shouldSkipFile(ctx)) return [];
  const findings: ReviewFinding[] = [];
  const shadowsGlobalObject = sourceFileDeclaresBinding(ctx, 'Object');
  const shadowsGlobalMath = sourceFileDeclaresBinding(ctx, 'Math');

  // `const label = preferred || nickname || 'Anonymous'`
  //   → firstTruthy name=label values="preferred, nickname, 'Anonymous'"
  for (const binary of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const suggestion = firstTruthySuggestion(binary);
    if (suggestion) {
      findings.push(firstTruthyFinding(ctx, binary, suggestion.name, suggestion.values));
    }
    const coalSuggest = coalesceSuggestion(binary);
    if (coalSuggest) {
      findings.push(coalesceFinding(ctx, binary, coalSuggest.name, coalSuggest.values));
    }
  }

  // `[...new Set(coll)]` → route to the dedicated `unique` primitive.
  for (const arr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrayLiteralExpression)) {
    const elements = arr.getElements();
    if (elements.length !== 1) continue;
    const first = elements[0];
    if (!Node.isSpreadElement(first)) continue;
    const spread = first.getExpression();
    if (!Node.isNewExpression(spread)) continue;
    if (spread.getExpression().getText() !== 'Set') continue;
    const args = spread.getArguments();
    if (args.length !== 1) continue;
    const source = args[0].getText();
    findings.push(
      finding(
        'suggest-kern-primitive',
        'info',
        'pattern',
        'JS [...new Set(...)] could migrate to KERN `unique` — named primitive for dedup',
        ctx.filePath,
        arr.getStartLineNumber(),
        1,
        { suggestion: `unique name=<name> in=${toKernInValue(source)}` },
      ),
    );
  }

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;

    const methodName = callee.getName();
    const receiver = callee.getExpression();
    const unwrappedReceiver = unwrapParenthesized(receiver);

    const clampParts = portableClampParts(call, shadowsGlobalMath);
    if (clampParts) {
      findings.push({
        ...portableLogicFinding(ctx, call, 'number.clamp', 'numeric clamp'),
        suggestion: clampNodeSuggestion(call, clampParts),
      });
      continue;
    }
    if (isPortableClampCall(call, shadowsGlobalMath)) {
      findings.push(portableLogicFinding(ctx, call, 'number.clamp', 'numeric clamp'));
      continue;
    }

    if (methodName === 'has' && isNewExpressionFor(unwrappedReceiver, 'Set')) {
      if (unwrappedReceiver.getArguments().length === 1 && call.getArguments().length === 1) {
        findings.push(portableLogicFinding(ctx, call, 'collection.has', 'Set membership'));
      }
      continue;
    }

    if (methodName === 'getTime' && isNewExpressionFor(unwrappedReceiver, 'Date')) {
      if (unwrappedReceiver.getArguments().length === 1 && call.getArguments().length === 0) {
        findings.push(portableLogicFinding(ctx, call, 'time.epochMs', 'epoch-millisecond conversion'));
      }
      continue;
    }

    if (Node.isIdentifier(unwrappedReceiver) && unwrappedReceiver.getText() === 'Object') {
      if (methodName === 'assign' && !shadowsGlobalObject) {
        const suggestion = objectAssignMergeSuggestion(call);
        if (suggestion) findings.push(objectMergeFinding(ctx, call, suggestion.name, suggestion.sources));
        continue;
      }
      const objectPrimitive = objectPortablePrimitiveFor(methodName);
      if (objectPrimitive && call.getArguments().length === 1 && !shadowsGlobalObject) {
        findings.push(portableLogicFinding(ctx, call, objectPrimitive, `Object.${methodName}`));
      }
      continue;
    }

    // Syntax-driven like the existing array-method suggestions: reviewSource
    // has no reliable project type context, so custom same-named methods may
    // produce advisory false positives.
    const stringPrimitive = stringPortablePrimitiveFor(call, methodName);
    if (stringPrimitive) {
      findings.push(portableLogicFinding(ctx, call, stringPrimitive, `string.${methodName}`));
      continue;
    }

    const spec = ARRAY_METHODS[methodName];
    if (!spec) continue;

    const collection = receiver.getText();
    const collectionIn = toKernInValue(collection);

    // `.filter(Boolean)`, `.filter(x => !!x)`, `.filter(x => Boolean(x))` →
    // route to the dedicated `compact` primitive. The three shapes are all
    // equivalent drop-falsy idioms; KERN prefers the named primitive.
    if (methodName === 'filter' && call.getArguments().length === 1) {
      const countSuggestion = filterLengthCountSuggestion(collection, call);
      if (countSuggestion) {
        findings.push(
          finding(
            'suggest-kern-primitive',
            'info',
            'pattern',
            'JS .filter(…).length could migrate to KERN `count` — named primitive for filtered cardinality',
            ctx.filePath,
            call.getStartLineNumber(),
            1,
            { suggestion: countSuggestion },
          ),
        );
        continue;
      }

      const arg = call.getArguments()[0];
      const isBooleanRef = Node.isIdentifier(arg) && arg.getText() === 'Boolean';
      const isCoercionArrow = isArrowLike(arg) && isBooleanCoercionOfFirstParam(arg);
      if (isBooleanRef || isCoercionArrow) {
        findings.push(
          finding(
            'suggest-kern-primitive',
            'info',
            'pattern',
            'JS drop-falsy filter could migrate to KERN `compact` — named primitive for drop-falsy',
            ctx.filePath,
            call.getStartLineNumber(),
            1,
            { suggestion: `compact name=<name> in=${collectionIn}` },
          ),
        );
        continue;
      }
    }

    // `.map(x => x.prop[.chain])` → route to the dedicated `pluck` primitive.
    // Only fires on single-param arrows (to skip `(x, i) => ...` which KERN
    // can't represent) and non-optional property chains.
    if (methodName === 'map' && call.getArguments().length === 1) {
      const arg = call.getArguments()[0];
      if (isArrowLike(arg) && arg.getParameters().length === 1) {
        const item = paramName(arg, 0);
        if (item) {
          const path = propertyAccessChainFromItem(arg, item);
          if (path) {
            findings.push(
              finding(
                'suggest-kern-primitive',
                'info',
                'pattern',
                'JS .map(x => x.<prop>) could migrate to KERN `pluck` — named primitive for property extraction',
                ctx.filePath,
                call.getStartLineNumber(),
                1,
                {
                  suggestion:
                    item === 'item'
                      ? `pluck name=<name> in=${collectionIn} prop=${path}`
                      : `pluck name=<name> in=${collectionIn} item=${item} prop=${path}`,
                },
              ),
            );
            continue;
          }
        }
      }
    }

    const suggestion = buildSuggestion(spec, collection, call);
    if (!suggestion) continue;

    findings.push(
      finding(
        'suggest-kern-primitive',
        'info',
        'pattern',
        `JS .${methodName}(…) could migrate to KERN \`${spec.kernNode}\` — one declarative binding instead of a handler-embedded call`,
        ctx.filePath,
        call.getStartLineNumber(),
        call.getStart() - call.getSourceFile().getFullText().lastIndexOf('\n', call.getStart()),
        { suggestion },
      ),
    );
  }

  for (const unary of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression)) {
    if (unary.getOperatorToken() !== SyntaxKind.ExclamationToken) continue;
    const parent = unary.getParent();
    if (parent && Node.isPrefixUnaryExpression(parent) && parent.getOperatorToken() === SyntaxKind.ExclamationToken) {
      continue;
    }
    const operand = unary.getOperand();
    if (Node.isPrefixUnaryExpression(operand) && operand.getOperatorToken() === SyntaxKind.ExclamationToken) {
      continue;
    }
    if (!isSimpleExpressionPosition(unary)) continue;

    findings.push(portableLogicFinding(ctx, unary, 'logic.not', 'boolean negation'));
  }

  // ── objectMerge / objectPick detector ──────────────────────────────────
  for (const obj of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    const mergeSuggestion = objectLiteralMergeSuggestion(obj);
    if (mergeSuggestion) {
      findings.push(objectMergeFinding(ctx, obj, mergeSuggestion.name, mergeSuggestion.sources));
      continue;
    }
    const pickSuggestion = objectLiteralPickSuggestion(obj);
    if (pickSuggestion) {
      findings.push(objectPickFinding(ctx, obj, pickSuggestion.name, pickSuggestion.source, pickSuggestion.keys));
    }
  }

  // ── objectOmit (destructuring) detector ────────────────────────────────
  for (const varDecl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = varDecl.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) continue;
    const elements = nameNode.getElements();
    if (elements.length === 0) continue;
    const lastElement = elements[elements.length - 1];
    if (!lastElement.getDotDotDotToken()) continue;

    const targetName = lastElement.getName();
    const initializer = varDecl.getInitializer();
    if (!initializer) continue;
    const sourceText = initializer.getText();

    const omittedKeys: string[] = [];
    let valid = true;
    for (let i = 0; i < elements.length - 1; i++) {
      const el = elements[i];
      if (el.getDotDotDotToken()) {
        valid = false;
        break;
      }
      const elNameNode = el.getNameNode();
      if (!Node.isIdentifier(elNameNode)) {
        valid = false;
        break;
      }
      const propNameNode = el.getPropertyNameNode();
      if (propNameNode) {
        const propName = destructuredPropertyNameText(propNameNode);
        if (propName === null) {
          valid = false;
          break;
        }
        omittedKeys.push(propName);
      } else {
        omittedKeys.push(elNameNode.getText());
      }
    }
    if (!valid || omittedKeys.length === 0) continue;

    findings.push(objectOmitFinding(ctx, varDecl, targetName, sourceText, omittedKeys));
  }

  // ── fmt detector ───────────────────────────────────────────────────────
  // Two call sites map cleanly to KERN's `fmt` primitive:
  //
  //   const label = `${count} files`;         → fmt name=label template="…"
  //   return `${msg} (${code})`;               → fmt return=true template="…"
  //
  // Only fires on TemplateExpression (has substitutions); plain backtick
  // strings are NoSubstitutionTemplateLiteral and don't need fmt.
  // Single-line only — multiline templates have meaningful whitespace that's
  // awkward to round-trip through a one-line suggestion.
  for (const tpl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    const parent = tpl.getParent();
    if (!parent) continue;

    const fullText = tpl.getText();
    if (!fullText.startsWith('`') || !fullText.endsWith('`') || fullText.length < 2) continue;
    const body = fullText.slice(1, -1);
    if (body.includes('\n')) continue;

    // Shape A — const initializer: `const x = \`…\`;`
    if (Node.isVariableDeclaration(parent) && parent.getInitializer() === tpl) {
      const nameNode = parent.getNameNode();
      if (!Node.isIdentifier(nameNode)) continue; // skip destructured bindings
      const name = nameNode.getText();
      findings.push(
        finding(
          'suggest-kern-primitive',
          'info',
          'pattern',
          'JS template literal could migrate to KERN `fmt` — named primitive for string interpolation',
          ctx.filePath,
          tpl.getStartLineNumber(),
          1,
          { suggestion: `fmt name=${name} template="${escapeKernTemplate(body)}"` },
        ),
      );
      continue;
    }

    // Shape B — return value: `return \`…\`;`
    // Use the return-position `fmt` form (`return=true`) which lowers to a
    // single `return \`…\`;` in generated TSX — one-liner replacement, no
    // intermediate binding needed.
    if (Node.isReturnStatement(parent) && parent.getExpression() === tpl) {
      findings.push(
        finding(
          'suggest-kern-primitive',
          'info',
          'pattern',
          'JS template literal in return position could migrate to KERN `fmt return=true`',
          ctx.filePath,
          tpl.getStartLineNumber(),
          1,
          { suggestion: `fmt return=true template="${escapeKernTemplate(body)}"` },
        ),
      );
    }
  }

  // ── conditional JSX detector ───────────────────────────────────────────
  // `{cond ? <A /> : <B />}` inside JSX → `conditional if="cond"` + two
  // handler children. Only fires when BOTH branches are JSX (skips the
  // `cond ? <A /> : null` case — that's a then-only `{cond && <A />}` shape).
  // Only fires when the ternary sits inside a JsxExpression container — a
  // top-level `return cond ? <A /> : <B />` doesn't cleanly map to a
  // conditional node (the whole return would need rewrapping).
  for (const cond of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
    const whenTrue = cond.getWhenTrue();
    const whenFalse = cond.getWhenFalse();
    if (!isJsxLike(whenTrue) || !isJsxLike(whenFalse)) continue;

    const parent = cond.getParent();
    if (!parent || !Node.isJsxExpression(parent)) continue;

    const condText = cond.getCondition().getText();
    const suggestion =
      `conditional if="${escapeKernString(condText)}"\n` +
      `  handler <<<\n    ${whenTrue.getText()}\n  >>>\n` +
      `  else\n    handler <<<\n      ${whenFalse.getText()}\n    >>>`;

    findings.push(
      finding(
        'suggest-kern-primitive',
        'info',
        'pattern',
        'JSX ternary could migrate to KERN `conditional` — declarative if/else render branch',
        ctx.filePath,
        cond.getStartLineNumber(),
        1,
        { suggestion },
      ),
    );
  }

  // ── async try/catch detector ───────────────────────────────────────────
  // `async function f() { try { await … } catch (e) { … } }` → `async name=f`
  // with a handler child for the try body and a `recover`/`strategy` pair for
  // the catch body.
  //
  // Only fires when:
  //   - the function is `async`
  //   - its body is a single TryStatement (so the full body maps to the async node)
  //   - the try block contains at least one `await` (else there's no async shape)
  //   - a catch clause is present (else there's no recovery to migrate)
  const asyncFns: Array<FunctionDeclaration | FunctionExpression | ArrowFunction> = [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
  ];
  for (const fn of asyncFns) {
    if (!fn.isAsync()) continue;

    const body = fn.getBody();
    if (!body || !Node.isBlock(body)) continue;

    const stmts = body.getStatements();
    if (stmts.length !== 1) continue;
    const tryStmt = stmts[0];
    if (!Node.isTryStatement(tryStmt)) continue;

    const tryBlock = tryStmt.getTryBlock();
    const catchClause = tryStmt.getCatchClause();
    if (!catchClause) continue;
    if (tryBlock.getDescendantsOfKind(SyntaxKind.AwaitExpression).length === 0) continue;

    let name = '<name>';
    if (Node.isFunctionDeclaration(fn)) {
      name = fn.getName() ?? '<name>';
    } else {
      const p = fn.getParent();
      if (p && Node.isVariableDeclaration(p)) {
        const n = p.getNameNode();
        if (Node.isIdentifier(n)) name = n.getText();
      }
    }

    const indent = (text: string, spaces: number): string =>
      text
        .split('\n')
        .map((line) => ' '.repeat(spaces) + line)
        .join('\n');

    const tryText = tryBlock
      .getStatements()
      .map((s) => s.getText())
      .join('\n');
    const catchText = catchClause
      .getBlock()
      .getStatements()
      .map((s) => s.getText())
      .join('\n');

    const suggestion =
      `async name=${name}\n` +
      `  handler <<<\n${indent(tryText, 4)}\n  >>>\n` +
      `  recover\n    strategy <<<\n${indent(catchText, 6)}\n    >>>`;

    findings.push(
      finding(
        'suggest-kern-primitive',
        'info',
        'pattern',
        'async try/catch could migrate to KERN `async` — named primitive with `recover`/`strategy` child',
        ctx.filePath,
        fn.getStartLineNumber(),
        1,
        { suggestion },
      ),
    );
  }

  return findings;
}

export const suggestKernPrimitiveRules: ReviewRule[] = [suggestKernPrimitive];
