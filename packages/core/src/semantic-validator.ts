/**
 * Semantic Validation — cross-reference checks that go beyond structural schema validation.
 *
 * Currently validates:
 *   1. Machine transitions reference valid states
 *   2. No duplicate sibling names (e.g., two `field name=id` in the same interface)
 *   3. `derive` cannot be a direct child of `each` when that `each` is inside
 *      a `render` block — `derive` compiles to `useMemo`, which violates React's
 *      Rules of Hooks when called inside a `.map()` callback.
 *   4. `set name=X` must have a matching `state name=X` declared in an ancestor
 *      screen/component. Otherwise codegen emits `setX(...)` with no bound
 *      setter, which fails at React runtime with no compile-time signal.
 *   5. `module > export` bindings must reference names visible in that module
 *      when the source is local, and resolver-enriched re-exports must name
 *      symbols that the resolver proved exist.
 */

import { collectExternalImportSymbols, type ExternalImportSymbolTable } from './external-symbols.js';
import { importRegistryOf } from './import-metadata.js';
import type { IRNode } from './types.js';

export interface SemanticViolation {
  rule: string;
  nodeType: string;
  message: string;
  line?: number;
  col?: number;
}

/**
 * Run semantic validation on an IR tree.
 * Returns an empty array when the tree is valid.
 */
export function validateSemantics(root: IRNode): SemanticViolation[] {
  const violations: SemanticViolation[] = [];
  validateNode(root, violations, [], []);
  return violations;
}

// True when the *innermost* handler ancestor is opted into native body-
// statement mode (`lang="kern"`). Body statements like `let`/`assign`/`do`/
// `if`/`try` nest freely inside that scope, so the let-parent rule has to
// be context-aware rather than a hardcoded sibling list. Walks back to the
// first `handler` ancestor and stops — a raw (non-`lang=kern`) handler
// nested inside a native handler must NOT inherit native-body permissions,
// or `let` would be silently accepted inside the raw boundary. Body-
// statement containers allowed as a `let` parent inside native body:
// handler, if, else, try, catch, finally, while, for, each.
function insideNativeBodyHandler(ancestorNodes: IRNode[]): boolean {
  for (let i = ancestorNodes.length - 1; i >= 0; i--) {
    const ancestor = ancestorNodes[i];
    if (ancestor.type === 'handler') return ancestor.props?.lang === 'kern';
  }
  return false;
}

function validateNode(
  node: IRNode,
  violations: SemanticViolation[],
  ancestry: string[],
  ancestorNodes: IRNode[],
): void {
  // ── Machine transition cross-ref ───────────────────────────────────
  if (node.type === 'machine' && node.children) {
    const stateNames = new Set<string>();
    for (const child of node.children) {
      if (child.type === 'state' && child.props?.name) {
        stateNames.add(child.props.name as string);
      }
    }

    for (const child of node.children) {
      if (child.type === 'transition') {
        const from = child.props?.from as string | undefined;
        const to = child.props?.to as string | undefined;
        const name = (child.props?.name as string) || '(unnamed)';

        if (from) {
          for (const source of from
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean)) {
            if (!stateNames.has(source)) {
              violations.push({
                rule: 'machine-transition-from',
                nodeType: 'transition',
                message: `Transition '${name}' references unknown state '${source}' in 'from'. Available states: ${[...stateNames].join(', ') || '(none)'}`,
                line: child.loc?.line,
                col: child.loc?.col,
              });
            }
          }
        }
        if (to && !stateNames.has(to)) {
          violations.push({
            rule: 'machine-transition-to',
            nodeType: 'transition',
            message: `Transition '${name}' references unknown state '${to}' in 'to'. Available states: ${[...stateNames].join(', ') || '(none)'}`,
            line: child.loc?.line,
            col: child.loc?.col,
          });
        }
      }
    }
  }

  // ── Module export cross-refs ────────────────────────────────────────
  if (node.type === 'module' && node.children) {
    const externalImports = collectExternalImportSymbols(node);
    validateModuleExternalImportConflicts(externalImports, violations);
    validateModuleExports(node, violations, externalImports);
  }

  // ── Duplicate sibling names ────────────────────────────────────────
  if (node.children && node.children.length > 1) {
    const seen = new Map<string, IRNode>();
    for (const child of node.children) {
      const name = child.props?.name as string | undefined;
      if (!name) continue;
      const key = `${child.type}:${name}`;
      const prev = seen.get(key);
      if (prev) {
        violations.push({
          rule: 'duplicate-sibling-name',
          nodeType: child.type,
          message: `Duplicate '${child.type}' named '${name}' — first defined at line ${prev.loc?.line ?? '?'}`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
      } else {
        seen.set(key, child);
      }
    }
  }

  // ── derive-inside-render-each — Rules-of-Hooks guard ───────────────
  // derive → useMemo (see packages/react/src/codegen-react.ts).
  // useMemo inside .map((item) => ...) violates React's Rules of Hooks.
  if (node.type === 'each' && ancestry.includes('render') && node.children) {
    for (const child of node.children) {
      if (child.type === 'derive') {
        violations.push({
          rule: 'no-derive-inside-render-each',
          nodeType: 'derive',
          message:
            '`derive` compiles to `useMemo`, which cannot run inside an `each`/`.map` callback (React Rules of Hooks). Move the derive above the `each`, or inline the expression in the handler.',
          line: child.loc?.line,
          col: child.loc?.col,
        });
      }
    }
  }

  // ── keyed each modes are body-stmt only (2026-05-06/2026-05-12) ───────
  // `pairKey`/`pairValue` and `entryKey`/`entryValue` lower to target-native
  // keyed collection loops. The render-path JSX emitter (codegen/screens.ts)
  // doesn't read these props, so a render-position keyed `each` would silently
  // emit `m.map((item, __i) => ...)` and lose the destructure.
  // Reject in render/group ancestor scope so the LLM sees the error rather
  // than a silently-wrong `.map()`.
  if (
    node.type === 'each' &&
    ('pairKey' in (node.props ?? {}) ||
      'pairValue' in (node.props ?? {}) ||
      'entryKey' in (node.props ?? {}) ||
      'entryValue' in (node.props ?? {}))
  ) {
    if (ancestry.includes('render') || ancestry.includes('group')) {
      violations.push({
        rule: 'each-keyed-mode-body-stmt-only',
        nodeType: 'each',
        message:
          '`each pairKey=/pairValue=/entryKey=/entryValue=` is a body-statement keyed collection form and cannot appear inside a `render`/`group` JSX context. Iterate the keyed collection ahead of the render block, or use the `name=` form with a render-key.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── each type= is body-stmt only (2026-05-07) ─────────────────────────
  // `type=` annotates a TS `for...of` binding. The render-path JSX emitter
  // lowers `each` to `.map(...)` and does not preserve that annotation, so
  // reject it in render/group scope instead of silently dropping it.
  if (node.type === 'each' && 'type' in (node.props ?? {})) {
    if (ancestry.includes('render') || ancestry.includes('group')) {
      violations.push({
        rule: 'each-type-body-stmt-only',
        nodeType: 'each',
        message:
          '`each type=` is a body-statement form for TS for...of bindings and cannot appear inside a `render`/`group` JSX context. Move the typed iteration above the render block, or omit type= in JSX composition.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── let must be a direct child of each OR a native body-stmt container ──
  // `let` has two valid parent contexts:
  //   1. `each` — iteration-scoped binding (emits `const` inside the `.map`
  //      callback). Valid in both render and native-body contexts.
  //   2. A body-statement container whose innermost handler ancestor is
  //      `handler lang="kern"`. The schema already accepts `let` as a
  //      child of handler/if/else/try/catch/finally/while/for, and the
  //      native body emitter lowers it correctly. The previous hardcoded
  //      sibling list (each/handler/if/else only) rejected legitimate
  //      uses of `let` inside try/catch/while/for and forced authors
  //      back to raw `<<<…>>>` bodies.
  //
  // Outside both contexts there's no codegen target and the binding is
  // silently dropped — fail loudly instead.
  //
  // OpenCode review fix: `parent === 'handler'` alone is not safe. The
  // body-statement parser-validator's `inNativeBody` is sticky once set,
  // so a raw handler nested inside a native handler would NOT have its
  // raw boundary detected by that validator. The semantic check below
  // verifies the immediate handler's lang=kern.
  if (node.type === 'let') {
    const parent = ancestry[ancestry.length - 1];
    const nativeBodyContainers = new Set(['if', 'else', 'try', 'catch', 'finally', 'while', 'for']);
    let approved = false;
    if (parent === 'each') {
      approved = true;
    } else if (parent === 'handler') {
      // Immediate handler boundary must be opted into kern body-stmt mode.
      const immediateHandler = ancestorNodes[ancestorNodes.length - 1];
      approved = immediateHandler?.props?.lang === 'kern';
    } else if (parent !== undefined && nativeBodyContainers.has(parent)) {
      approved = insideNativeBodyHandler(ancestorNodes);
    }
    if (!approved) {
      violations.push({
        rule: 'let-must-be-inside-each',
        nodeType: 'let',
        message:
          '`let` must be a direct child of `each`, or of `handler`/`if`/`else`/`try`/`catch`/`finally`/`while`/`for` inside a `handler lang="kern"` scope. Use `derive` for component-scoped bindings, or `const` at file scope.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── step / catch must be direct children of try ──────────────────────
  // Both are consumed by `generateTry`'s walk — placed elsewhere they hit
  // the defensive throw in the core dispatcher. Flagging semantically
  // surfaces the error with a line number during validation.
  if (node.type === 'step' || node.type === 'catch' || node.type === 'finally') {
    const parent = ancestry[ancestry.length - 1];
    if (parent !== 'try') {
      violations.push({
        rule: `${node.type}-must-be-inside-try`,
        nodeType: node.type,
        message: `\`${node.type}\` must be a direct child of \`try\`. Placing it elsewhere has no codegen target.`,
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── try may have at most one catch ───────────────────────────────────
  // JS only supports a single catch clause, so `generateTry` uses
  // `firstChild(node, 'catch')` — a second or third `catch` sibling would
  // be silently ignored. Flag it during validation so authors don't
  // assume a second catch handles a different error class.
  if (node.type === 'try' && node.children) {
    const catches = node.children.filter((c) => c.type === 'catch');
    if (catches.length > 1) {
      for (const extra of catches.slice(1)) {
        violations.push({
          rule: 'try-single-catch-only',
          nodeType: 'catch',
          message:
            '`try` supports at most one `catch` child — JavaScript has no multi-catch. Merge the error-handling logic or switch on `err instanceof …` inside a single catch.',
          line: extra.loc?.line,
          col: extra.loc?.col,
        });
      }
    }

    // ── try may have at most one finally (Codex review fix) ─────────────
    // Both JS and Python only model a single `finally` clause. The body-
    // statement emitter uses `findIndex` and would silently ignore a
    // second `finally` sibling; flag it during validation so the author
    // sees the duplicate at source level with a line number.
    const finallies = node.children.filter((c) => c.type === 'finally');
    if (finallies.length > 1) {
      for (const extra of finallies.slice(1)) {
        violations.push({
          rule: 'try-single-finally-only',
          nodeType: 'finally',
          message:
            '`try` supports at most one `finally` child — both JS and Python model a single finally clause. Merge the cleanup logic into one block.',
          line: extra.loc?.line,
          col: extra.loc?.col,
        });
      }
    }

    // ── finally is body-statement only (Codex review fix) ──────────────
    // Async-orchestration `try name=…` is consumed by `generateTry` in
    // `codegen/ground-layer.ts`, which only reads `step`/`handler`/`catch`.
    // A `finally` child of an orchestration `try` would pass the schema
    // (allowedChildren is shared between both shapes) but be silently
    // dropped at codegen. Reject it here so the author sees the mistake
    // at source level rather than discovering at runtime that cleanup
    // never ran.
    if (typeof node.props?.name === 'string' && node.props.name.length > 0 && finallies.length > 0) {
      for (const f of finallies) {
        violations.push({
          rule: 'finally-only-in-body-statement-try',
          nodeType: 'finally',
          message:
            '`finally` is only supported on body-statement `try` (inside `handler lang="kern"`). Async-orchestration `try name=…` does not have a finally codegen path; move cleanup into the surrounding handler or use a body-statement `try` for the protected block.',
          line: f.loc?.line,
          col: f.loc?.col,
        });
      }
    }
  }

  // ── group must be a direct child of render or another group ─────────
  // `group wrapper=...` is consumed by the composed-render walk in
  // `collectComposedPieces`, which only visits direct `render`/`group`
  // children. Placements like `render > each > group` or
  // `render > conditional > group` pass the schema but get silently dropped
  // at codegen because `generateEachJSX` / `generateConditionalJSX` don't
  // compose groups. Require a direct `render`/`group` parent so that silent
  // failure is caught as a validation error.
  if (node.type === 'group') {
    const parent = ancestry[ancestry.length - 1];
    if (parent !== 'render' && parent !== 'group') {
      violations.push({
        rule: 'group-must-be-inside-render',
        nodeType: 'group',
        message:
          '`group` must be a direct child of `render` or another `group`. Placing it inside `each`, `conditional`, or any other parent silently drops the wrapper at codegen.',
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // ── fmt inline-JSX form must sit inside render/group ─────────────────
  // `fmt template="..."` with no `name` and no `return=true` is the
  // inline-JSX form — it emits `{\`...\`}` as a JSX piece via
  // `collectComposedPieces`. Anywhere else (top-level, inside `fn`, inside
  // `each`/`conditional`, etc.) the codegen dispatcher throws. Flag the
  // misplacement semantically so authors get a line number.
  if (node.type === 'fmt') {
    const p = node.props || {};
    const returnMode = p.return === true || p.return === 'true';
    const isInline = !returnMode && !('name' in p);
    if (isInline) {
      const parent = ancestry[ancestry.length - 1];
      if (parent !== 'render' && parent !== 'group') {
        violations.push({
          rule: 'fmt-inline-must-be-inside-render',
          nodeType: 'fmt',
          message:
            '`fmt template="..."` without `name` or `return=true` is the inline-JSX form — it must be a direct child of `render` or `group`. Use `fmt name=X` for a binding or `fmt return=true` inside a `fn` body.',
          line: node.loc?.line,
          col: node.loc?.col,
        });
      }
    }
  }

  // ── set must match a state declaration ─────────────────────────────
  // `set name=X` lowers to `setX(...)` using the React useState convention.
  // If no ancestor declares `state name=X`, the emitted setter is unbound
  // and fails at React runtime with no compile-time signal.
  if (node.type === 'set') {
    const targetName = node.props?.name as string | undefined;
    if (targetName && !hasMatchingState(targetName, ancestorNodes)) {
      const declared = collectDeclaredStateNames(ancestorNodes);
      const hint =
        declared.length > 0
          ? ` Available in scope: ${declared.join(', ')}.`
          : ' No `state` declarations found in scope.';
      violations.push({
        rule: 'set-requires-matching-state',
        nodeType: 'set',
        message: `\`set name=${targetName}\` has no matching \`state name=${targetName}\` in scope — the emitted \`set${capitalize(targetName)}(...)\` will be unbound at runtime.${hint}`,
        line: node.loc?.line,
        col: node.loc?.col,
      });
    }
  }

  // Recurse
  if (node.children) {
    const nextAncestry = node.type ? [...ancestry, node.type] : ancestry;
    const nextAncestorNodes = node.type ? [...ancestorNodes, node] : ancestorNodes;
    for (const child of node.children) {
      validateNode(child, violations, nextAncestry, nextAncestorNodes);
    }
  }
}

interface ExportBinding {
  source: string;
  alias?: string;
}

type ExportBindingKind = 'value' | 'type';

interface ExportSourceBinding extends ExportBinding {
  kind: ExportBindingKind;
}

interface ModuleVisibleNames {
  all: Set<string>;
  local: Set<string>;
  externalValues: Set<string>;
  externalTypes: Set<string>;
}

function validateModuleExports(
  node: IRNode,
  violations: SemanticViolation[],
  externalImports: ExternalImportSymbolTable,
): void {
  const visibleNames = collectModuleVisibleNames(node, externalImports);

  for (const child of node.children ?? []) {
    if (child.type !== 'export') continue;
    const from = child.props?.from;
    const sourceNames = exportedSourceBindings(child);
    const resolvedSymbols =
      typeof child.props?.resolvedExportNames === 'string' ? parseNameSet(child.props.resolvedExportNames) : null;

    for (const sourceName of sourceNames) {
      const binding = parseExportBinding(sourceName.raw, sourceName.kind);
      if (!binding) {
        violations.push({
          rule: 'export-binding-invalid',
          nodeType: 'export',
          message: `Export binding '${sourceName.raw}' is invalid. Use 'Name' or 'Name as Alias' with valid identifiers.`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
        continue;
      }

      if (typeof from === 'string' && from.length > 0) {
        if (resolvedSymbols && !resolvedSymbols.has(binding.source)) {
          violations.push({
            rule: 'export-from-unknown-symbol',
            nodeType: 'export',
            message: `Re-export references '${binding.source}', but resolver metadata for '${from}' does not include that symbol.`,
            line: child.loc?.line,
            col: child.loc?.col,
          });
        }
        continue;
      }

      if (!visibleNames.all.has(binding.source)) {
        const available = [...visibleNames.all].sort();
        const hint = available.length > 0 ? ` Available names: ${available.join(', ')}.` : ' No visible names found.';
        violations.push({
          rule: 'export-local-unknown-symbol',
          nodeType: 'export',
          message: `Local export references unknown symbol '${binding.source}'.${hint}`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
        continue;
      }

      if (!hasVisibleExportKind(visibleNames, binding.source, binding.kind)) {
        const expected = binding.kind === 'type' ? 'type-only' : 'runtime value';
        const actual = binding.kind === 'type' ? 'runtime value' : 'type-only';
        violations.push({
          rule: 'export-local-kind-mismatch',
          nodeType: 'export',
          message: `Local ${binding.kind} export references '${binding.source}', but that external import is only visible as a ${actual} symbol. Use \`export ${binding.kind === 'type' ? 'names' : 'types'}=${binding.source}\` or add a ${expected} binding.`,
          line: child.loc?.line,
          col: child.loc?.col,
        });
      }
    }
  }
}

function collectModuleVisibleNames(moduleNode: IRNode, externalImports: ExternalImportSymbolTable): ModuleVisibleNames {
  const names: ModuleVisibleNames = {
    all: new Set(),
    local: new Set(),
    externalValues: new Set(),
    externalTypes: new Set(),
  };
  for (const symbol of externalImports.symbols) {
    names.all.add(symbol.localName);
    if (symbol.kind === 'type') names.externalTypes.add(symbol.localName);
    else names.externalValues.add(symbol.localName);
  }
  for (const child of moduleNode.children ?? []) {
    const name = child.props?.name;
    if (typeof name === 'string' && name.length > 0 && child.type !== 'export') {
      addLocalVisibleName(names, name);
    }

    if (child.type === 'use') {
      for (const fromChild of child.children ?? []) {
        if (fromChild.type !== 'from') continue;
        const importedName = fromChild.props?.name;
        const alias = fromChild.props?.as;
        if (typeof alias === 'string' && alias.length > 0) addLocalVisibleName(names, alias);
        else if (typeof importedName === 'string' && importedName.length > 0) addLocalVisibleName(names, importedName);
      }
    }

    if (child.type === 'import' && !isExternalImportNode(child)) {
      for (const imported of importLocalNames(child)) {
        addLocalVisibleName(names, imported);
      }
    }
  }
  return names;
}

function addLocalVisibleName(names: ModuleVisibleNames, name: string): void {
  names.all.add(name);
  names.local.add(name);
}

function hasVisibleExportKind(names: ModuleVisibleNames, name: string, kind: ExportBindingKind): boolean {
  if (names.local.has(name)) return true;
  return kind === 'type' ? names.externalTypes.has(name) : names.externalValues.has(name);
}

function isExternalImportNode(node: IRNode): boolean {
  if (node.type !== 'import') return false;
  return importRegistryOf(node.props?.registry) !== 'host';
}

function validateModuleExternalImportConflicts(
  externalImports: ExternalImportSymbolTable,
  violations: SemanticViolation[],
): void {
  for (const conflict of externalImports.conflicts) {
    const conflictingSymbols = conflictingExternalImportSymbols(conflict.symbols);
    const locationSymbol = conflictingSymbols[conflictingSymbols.length - 1];
    if (!locationSymbol) continue;
    const sources = conflictingSymbols
      .map((symbol) => `${symbol.registry}:${symbol.package}${symbol.sourceName ? `#${symbol.sourceName}` : ''}`)
      .join(', ');
    violations.push({
      rule: 'external-import-local-conflict',
      nodeType: 'import',
      message: `External import local name '${conflict.localName}' is declared by multiple imports (${sources}). Use an alias so native KERN has one binding for that name.`,
      // Point at the latest declaration so the diagnostic lands on the import
      // that made the name ambiguous.
      line: locationSymbol.line,
      col: locationSymbol.col,
    });
  }
}

function conflictingExternalImportSymbols(
  symbols: ExternalImportSymbolTable['symbols'],
): ExternalImportSymbolTable['symbols'] {
  const valueSymbols = symbols.filter((symbol) => symbol.kind !== 'type');
  const typeSymbols = symbols.filter((symbol) => symbol.kind === 'type');
  if (valueSymbols.length > 1 && typeSymbols.length > 1) return symbols;
  if (valueSymbols.length > 1) return valueSymbols;
  if (typeSymbols.length > 1) return typeSymbols;
  return symbols;
}

function importLocalNames(node: IRNode): string[] {
  const names: string[] = [];
  const props = node.props ?? {};
  if (typeof props.default === 'string' && props.default.length > 0 && props.default !== 'true') {
    names.push(props.default);
  }
  if (typeof props.names === 'string') {
    for (const raw of props.names.split(',')) {
      const name = raw.trim();
      const aliasMatch = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(name);
      if (aliasMatch) names.push(aliasMatch[2] ?? aliasMatch[1]);
      else if (isIdentifier(name)) names.push(name);
    }
  }
  return names;
}

function exportedSourceBindings(node: IRNode): Array<{ raw: string; kind: ExportBindingKind }> {
  const props = node.props ?? {};
  const names = [
    ...splitCsv(props.names).map((raw) => ({ raw, kind: 'value' as const })),
    ...splitCsv(props.types).map((raw) => ({ raw, kind: 'type' as const })),
  ];
  if (
    typeof props.default === 'string' &&
    props.default.length > 0 &&
    !(typeof props.from === 'string' && props.from.length > 0)
  ) {
    names.push({ raw: `${props.default} as default`, kind: 'value' });
  }
  return names;
}

function splitCsv(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseExportBinding(raw: string, kind: ExportBindingKind): ExportSourceBinding | null {
  const match = raw.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u);
  if (!match) return null;
  return { source: match[1], alias: match[2], kind };
}

function parseNameSet(raw: string): Set<string> {
  return new Set(splitCsv(raw));
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/u.test(value);
}

function hasMatchingState(name: string, ancestors: IRNode[]): boolean {
  for (const ancestor of ancestors) {
    if (!ancestor.children) continue;
    for (const child of ancestor.children) {
      // `cell` (body-stmt) and `state` (top-level / screen) both register a
      // setter binding. `set name=X` matches either declaration form.
      if ((child.type === 'state' || child.type === 'cell') && (child.props?.name as string | undefined) === name) {
        return true;
      }
    }
  }
  return false;
}

function collectDeclaredStateNames(ancestors: IRNode[]): string[] {
  const names: string[] = [];
  for (const ancestor of ancestors) {
    if (!ancestor.children) continue;
    for (const child of ancestor.children) {
      if (child.type === 'state' || child.type === 'cell') {
        const n = child.props?.name as string | undefined;
        if (n) names.push(n);
      }
    }
  }
  return names;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
