/**
 * Detection + emission helpers for raw `<<<...>>>` handler bodies when the
 * target is FastAPI/Python.
 *
 * Raw handler bodies are usually JavaScript/TypeScript — the legacy authoring
 * form before native KERN body-stmts existed. The TS codegen path can emit
 * them verbatim (it's already TypeScript), but the Python codegen must either
 * lower them or refuse them; emitting raw JS inside a Python `def` produces
 * invalid Python that breaks `ast.parse` on the generated module.
 *
 * Two helpers exposed:
 *   - `isUnsupportedJsHandlerBody`: returns true if the body uses
 *     JS-specific idioms that Python cannot accept verbatim (`res.X`,
 *     backtick template literals, optional chaining `?.`, nullish
 *     coalescing `??`, arrow functions `=>`, object shorthand inside
 *     literals).
 *   - `unsupportedRawHandlerBody`: returns the boilerplate Python that
 *     replaces an unsupported body with a `NotImplementedError` raise,
 *     so the route file still parses + imports cleanly.
 *
 * Co-locating these here (instead of inside fastapi-route.ts) lets the
 * portable-handler path in fastapi-portable.ts apply the same guard without
 * introducing an import cycle between portable and route.
 */

export function hasObjectShorthandOutsideStrings(expr: string): boolean {
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  while (index < expr.length) {
    const char = expr[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      index += 1;
      continue;
    }
    if (char !== '{' && char !== ',') {
      index += 1;
      continue;
    }
    index += 1;
    while (index < expr.length && /\s/.test(expr[index])) index += 1;
    if (index >= expr.length || !/[A-Za-z_$]/.test(expr[index])) continue;
    index += 1;
    while (index < expr.length && /[\w$]/.test(expr[index])) index += 1;
    while (index < expr.length && /\s/.test(expr[index])) index += 1;
    if (expr[index] === ',' || expr[index] === '}') return true;
  }

  return false;
}

export function isUnsupportedJsHandlerBody(code: string): boolean {
  return (
    /\bres\./.test(code) ||
    /`/.test(code) ||
    /\?\./.test(code) ||
    /\?\?/.test(code) ||
    /=>/.test(code) ||
    /\bconst\s+\w+\s*=/.test(code) ||
    /\blet\s+\w+\s*=/.test(code) ||
    /\bnew\s+[A-Z]\w*\s*\(/.test(code) ||
    hasObjectShorthandOutsideStrings(code)
  );
}

export function unsupportedRawHandlerBody(indent: string): string[] {
  return [`${indent}raise NotImplementedError("Unsupported raw JavaScript handler syntax for FastAPI target")`];
}
