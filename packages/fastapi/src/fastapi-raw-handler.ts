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

// Replace contents of every string literal AND comment with `_` so
// JS-keyword detection regexes don't false-positive on tokens that
// appear only inside strings or comments. Preserves quote delimiters,
// newlines, and code outside strings. Honors backslash escapes so
// `"\""` doesn't terminate the string early.
//
// Comment forms recognized:
//   - Python line comments: `# ...` to end of line
//   - JS line comments: `// ...` to end of line
//   - JS block comments: `/* ... */`
//
// Review fix: Codex flagged on commit 68565826 that the original
// version stripped strings but NOT comments — a `lang="python"` body
// containing `# const x = 1` (a comment mentioning JS syntax) would
// still trip the `\bconst\s+\w+\s*=` regex and emit a NotImplementedError
// for valid Python.
export function stripStringsForJsCheck(code: string): string {
  let result = '';
  let i = 0;
  // null | quote-char | '//' (JS line) | '#' (Python line) | '/*' (JS block)
  let mode: '"' | "'" | '`' | '//' | '#' | '/*' | null = null;
  let escaped = false;
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (mode === '"' || mode === "'" || mode === '`') {
      if (escaped) {
        escaped = false;
        result += '_';
      } else if (ch === '\\') {
        escaped = true;
        result += '_';
      } else if (ch === mode) {
        mode = null;
        result += ch;
      } else {
        result += ch === '\n' ? '\n' : '_';
      }
      i += 1;
      continue;
    }
    if (mode === '//' || mode === '#') {
      if (ch === '\n') {
        mode = null;
        result += '\n';
      } else {
        result += '_';
      }
      i += 1;
      continue;
    }
    if (mode === '/*') {
      if (ch === '*' && next === '/') {
        mode = null;
        result += '__';
        i += 2;
        continue;
      }
      result += ch === '\n' ? '\n' : '_';
      i += 1;
      continue;
    }
    // mode is null — code mode
    if (ch === '"' || ch === "'" || ch === '`') {
      mode = ch;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      mode = '//';
      result += '__';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      mode = '/*';
      result += '__';
      i += 2;
      continue;
    }
    if (ch === '#') {
      // `#` is a Python line comment ONLY when not directly followed by
      // an identifier character. Modern JS uses `#x` for private class
      // fields; treating those as comments would hide real JS that
      // should be flagged (Codex review on commit ec6b5d45).
      const after = next;
      const isPrivateFieldStart = after !== undefined && /[A-Za-z_$]/.test(after);
      if (isPrivateFieldStart) {
        result += ch;
        i += 1;
        continue;
      }
      mode = '#';
      result += '_';
      i += 1;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

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
  // Run JS-keyword detection on a string-stripped view so a Python body
  // like `text = "uses res.send pattern"` or `msg = "const x = ..."`
  // doesn't false-positive. Backticks INSIDE strings are stripped to `_`,
  // but unmatched backticks outside strings (i.e., JS template literals)
  // still trip the check.
  //
  // M1 (Codex+Gemini on ae9663cf): the const/let/var detection used to
  // only match `\bKEYWORD\s+\w+\s*=` — missed destructuring forms
  // (`const {x} = obj`, `const [a] = arr`) and for-loop variants
  // (`for (var x of list)`, `for (let x in obj)`). Both are common JS
  // and produce invalid Python. Adding two more alternatives below.
  // The `var x;` no-init form is intentionally NOT detected: broadening
  // there would false-positive on Python `for var in items:` where `var`
  // is a Python loop variable name (not a keyword).
  //
  // M2 (Gemini+Codex on 85593a3f): drop the `[A-Z]` PascalCase constraint
  // on the `new` check and broaden to dotted callables — `new foo()`,
  // `new globalThis.Date()`, etc. all produce SyntaxError in Python.
  const stripped = stripStringsForJsCheck(code);
  return (
    /\bres\./.test(stripped) ||
    /`/.test(stripped) ||
    /\?\./.test(stripped) ||
    /\?\?/.test(stripped) ||
    /=>/.test(stripped) ||
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=/.test(stripped) || // assignment form ($-identifiers; JS identifiers don't start with digits)
    /\b(?:const|let|var)\s+[{[]/.test(stripped) || // destructuring form
    /\bfor(?:\s+await)?\s*\(\s*(?:var|let|const)\s+/.test(stripped) || // for / for-await loop variant
    /\bnew\s+[\w$]+(?:\.[\w$]+)*\s*\(/.test(stripped) || // ctor with parens
    // `new Foo` without parens is also valid JS (e.g., `return new Date`)
    // and produces SyntaxError in Python. Two false-positive guards
    // address review on fix-up 8 (Codex+Gemini, gemini-blocking):
    //   1. Variable-width lookbehind `(?<!\bfor\s+)` — handles
    //      `for  new in items:` with any whitespace between `for` and
    //      `new` (was single-space only).
    //   2. Negative lookahead for Python keywords after `new` — excludes
    //      `new is None`, `new in items`, `new for x in seq`,
    //      `new if cond else other`, `new and other`, `new or other`,
    //      `new not other`. These are all valid Python where `new` is
    //      a local variable name, not a JS construction.
    /(?<!\bfor\s+)\bnew\s+(?!(?:is|in|for|if|else|and|or|not)\b)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\b/.test(
      stripped,
    ) ||
    hasObjectShorthandOutsideStrings(code)
  );
}

export function unsupportedRawHandlerBody(indent: string): string[] {
  return [`${indent}raise NotImplementedError("Unsupported raw JavaScript handler syntax for FastAPI target")`];
}
