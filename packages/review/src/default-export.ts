/**
 * Default-export resolver — bridges the gap between how seeds express
 * "this file's default export is public" (`{filePath}#default`) and how
 * the call graph indexes the same symbol internally.
 *
 * For `export default function Page() {}`, the call graph stores the
 * function under its declaration name (`Page`). The framework seed
 * (Next.js page convention, etc.) uses `default`. Without a bridge, the
 * (filePath, 'Page') dead-export check looks up (filePath, 'default') in
 * the seed map and misses — flagging Page as dead. This module returns
 * the call-graph-internal name so the caller can also accept that.
 *
 * Step 9b wires this into the dead-export rule. Splitting it lets us
 * test the resolver against every TypeScript default-export shape in
 * isolation — there are five distinct cases and getting any one wrong
 * silently re-introduces FPs.
 */

import { type ExportAssignment, type Node, type SourceFile, SyntaxKind } from 'ts-morph';

/**
 * Resolve the call-graph-internal name of a source file's default export.
 *
 * Returns the identifier the call graph would track the symbol under —
 * `'Page'` for `export default function Page() {}`, `'x'` for
 * `export default x` or `export { x as default }`, and `undefined` for
 * anonymous defaults (`export default function () {}` / `export default 42`)
 * or files with no default export at all.
 *
 * The five cases red-team #11 enumerated:
 *   1. `export default function Page() {}` → `'Page'`
 *   2. `export default class Page {}` → `'Page'`
 *   3. `export default x` (where x is a local identifier) → `'x'`
 *   4. `export { x as default }` → `'x'`
 *   5. anonymous (`export default function () {}`, `export default 42`,
 *      `export default { ... }`) → undefined
 *
 * `undefined` callers should fall back to the literal `'default'` —
 * that's how the call graph keys anonymous defaults internally
 * (resolveDefaultExportBinding in call-graph.ts uses 'default' as the
 * fallback name when the symbol carries no identifier).
 */
export function resolveDefaultExportName(sourceFile: SourceFile): string | undefined {
  const symbol = sourceFile.getDefaultExportSymbol();
  if (!symbol) return undefined;

  for (const decl of symbol.getDeclarations()) {
    const kind = decl.getKind();

    // Case 3 + 4: `export default x` and `export { x as default }`.
    // Both surface as ExportAssignment in ts-morph; getExpression() is
    // the identifier when a name is in play.
    if (kind === SyntaxKind.ExportAssignment) {
      const expr = (decl as ExportAssignment).getExpression();
      if (expr.getKind() === SyntaxKind.Identifier) {
        const text = expr.getText();
        if (text) return text;
      }
      // Anything else under an ExportAssignment is anonymous (literal,
      // object expression, function expression without a name, …).
      // Fall through to the next declaration just in case (rare for
      // ExportSpecifier-style aliasing the symbol resolved to).
      continue;
    }

    // Cases 1 + 2 + the named-function-expression form of 5: anything
    // with a `getName()` method (FunctionDeclaration, ClassDeclaration,
    // FunctionExpression, ClassExpression). Anonymous functions/classes
    // declared inline via `export default function () {}` have no name.
    const named = decl as Node & { getName?: () => string | undefined };
    if (typeof named.getName === 'function') {
      const name = named.getName();
      if (name) return name;
    }
  }

  return undefined;
}
