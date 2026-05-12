/** Native KERN handler body eligibility classifier — slice 5a tests. */

import {
  classifyHandlerBody,
  type EligibilityResult,
  extractRawBodies,
  LEGACY_NEG_PATTERNS,
  scanFileForEligibility,
} from '../src/native-eligibility.js';
import {
  canonicalKernExpression,
  isValidKernExpression,
  isValidKernTypeAnnotation,
} from '../src/native-eligibility-ast.js';

describe('canonicalKernExpression — single-line normalization', () => {
  test('passes single-line expression through unchanged structure', () => {
    expect(canonicalKernExpression('x + 1')).toBe('x + 1');
    expect(canonicalKernExpression('process.env.X || "default"')).toBe('process.env.X || "default"');
  });

  test('preserves KERN stdlib call surface (does NOT translate List.map → .map)', () => {
    expect(canonicalKernExpression('List.map(users, user => user.name)')).toBe('List.map(users, user => user.name)');
  });

  test('collapses multi-line object literal to single line', () => {
    expect(canonicalKernExpression('{\n  a: 1,\n  b: 2,\n}')).toBe('{ a: 1, b: 2, }');
  });

  test('collapses multi-line call with object arg', () => {
    expect(canonicalKernExpression('fetch(url, {\n  method: "POST",\n  body: JSON.stringify({a:1}),\n})')).toBe(
      'fetch(url, { method: "POST", body: JSON.stringify({ a: 1 }), })',
    );
  });

  test('preserves single-line template literal verbatim', () => {
    expect(canonicalKernExpression('`hello ${name} world`')).toBe('`hello ${name} world`');
  });

  test('bails on multi-line template literal (cannot collapse semantically)', () => {
    expect(canonicalKernExpression('`hello\nworld`')).toBeNull();
  });

  test('bails on unparseable expression', () => {
    expect(canonicalKernExpression('await async (x) => { return x; }')).toBeNull();
  });
});

describe('classifier ≡ migrator invariant (codex review)', () => {
  test('isValidKernExpression rejects multi-line-template-bearing expressions', () => {
    // Critical: if classifyHandlerBody said "eligible" but
    // canonicalKernExpression bailed inside the migrator, kern review would
    // flag the body as native-KERN-eligible and `kern migrate` would silently
    // skip it — the exact trust-collapse pattern slice α-3 was designed to
    // prevent.
    const exprWithEmbeddedMultilineTemplate = 'notify(`hello\nworld ${name}`)';
    expect(canonicalKernExpression(exprWithEmbeddedMultilineTemplate)).toBeNull();
    expect(isValidKernExpression(exprWithEmbeddedMultilineTemplate)).toBe(false);
  });

  test('isValidKernExpression accepts the multi-line cases the migrator now lifts', () => {
    expect(isValidKernExpression('{\n  a: 1,\n  b: 2,\n}')).toBe(true);
    expect(isValidKernExpression('fetch(url, {\n  method: "POST"\n})')).toBe(true);
  });
});

describe('isValidKernTypeAnnotation', () => {
  test('accepts common safe TypeScript annotations', () => {
    expect(isValidKernTypeAnnotation('User | null')).toBe(true);
    expect(isValidKernTypeAnnotation('"on" | "off"')).toBe(true);
    expect(isValidKernTypeAnnotation('Map<string, number>')).toBe(true);
  });

  test('rejects unsafe or malformed annotations', () => {
    expect(isValidKernTypeAnnotation('string\nnumber')).toBe(false);
    expect(isValidKernTypeAnnotation('typeof import("fs")')).toBe(false);
    expect(isValidKernTypeAnnotation('`${evil}`')).toBe(false);
    expect(isValidKernTypeAnnotation('string; process.exit(1)')).toBe(false);
    expect(isValidKernTypeAnnotation('Map<string')).toBe(false);
  });
});

describe('classifyHandlerBody — eligible bodies', () => {
  test('empty body is eligible', () => {
    expect(classifyHandlerBody('')).toEqual({ eligible: true, reason: 'empty' });
  });

  test('whitespace-only body is eligible', () => {
    expect(classifyHandlerBody('   \n  \n  ')).toEqual({ eligible: true, reason: 'empty' });
  });

  test('simple let + return is eligible', () => {
    const body = `const x = 1;\nreturn x + 2;`;
    expect(classifyHandlerBody(body).eligible).toBe(true);
  });

  test('simple mutable let + assignment + return is eligible', () => {
    expect(classifyHandlerBody(`let total = 0;\ntotal += item.value;\nreturn total;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('KERN-stdlib call is eligible', () => {
    expect(classifyHandlerBody(`return Text.upper(name);`).eligible).toBe(true);
  });

  test('expression-bodied callbacks are eligible', () => {
    expect(classifyHandlerBody(`const names = List.map(users, user => user.name);\nreturn names;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('await + ? propagation rejected as ts-parse-error (slice α-3)', () => {
    // KERN-syntax postfix `?` (propagation) is NOT valid TS — `tsc` reports
    // a parse error. Slice α-3's classifier mirrors the migrator's TS parse
    // bail, so bodies that use the KERN-only `?` syntax are reported
    // ineligible. The right way to express propagation in a migratable body
    // is to write the `?` inside a `let value="…"` attribute (lang="kern"
    // body-statement form), not in the raw `<<<…>>>` body.
    expect(classifyHandlerBody(`const u = await fetchUser(id)?;\nreturn u.name;`).reason).toBe('ts-parse-error');
  });

  test('optional chain is eligible', () => {
    expect(classifyHandlerBody(`return user?.profile?.name;`).eligible).toBe(true);
  });
});

describe('classifyHandlerBody — slice 4d additions are now eligible', () => {
  // These bodies WERE ineligible under the /tmp/agon-rescan.mjs heuristic
  // (slice 4b baseline). Slice 4c+4d shipped support, so they should now
  // pass. Catching regressions here is the whole point of the test.

  test('try/catch block is eligible (slice 4c+4d)', () => {
    const body = `try {\n  return doThing();\n} catch (e) {\n  return null;\n}`;
    expect(classifyHandlerBody(body).eligible).toBe(true);
  });

  test('throw statement is eligible (slice 4c+4d)', () => {
    expect(classifyHandlerBody(`throw new Error("oops");`).eligible).toBe(true);
  });

  test('?? walrus is eligible (slice 4c)', () => {
    expect(classifyHandlerBody(`return name ?? "anon";`).eligible).toBe(true);
  });

  test('new ClassName(...) is eligible (slice 4c+4d)', () => {
    expect(classifyHandlerBody(`return new Date();`).eligible).toBe(true);
  });

  test('object spread is eligible (slice 4c+4d)', () => {
    expect(classifyHandlerBody(`return { ...base, id: 1 };`).eligible).toBe(true);
  });

  test('for-of block with migratable body is eligible', () => {
    const body = `for (const x of xs) {\n  doThing(x);\n}\nreturn xs;`;
    expect(classifyHandlerBody(body).eligible).toBe(true);
  });

  test('for-await-of block with migratable body is eligible', () => {
    const body = `for await (const x of xs) {\n  await doThing(x);\n}\nreturn xs;`;
    const result = classifyHandlerBody(body);
    expect(result).toEqual({ eligible: true, reason: 'ok' });
  });

  test('typed for-of block is eligible when the annotation is safe', () => {
    expect(classifyHandlerBody(`for (const user: User | null of users) {\n  notify(user);\n}`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`for await (const event: Event of events) {\n  await notify(event);\n}`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('async destructured pair for-of block is eligible', () => {
    expect(classifyHandlerBody(`for await (const [key, value] of cache) {\n  await notify(key, value);\n}`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('sync Object.entries pair for-of block is eligible as object/dict entries', () => {
    expect(
      classifyHandlerBody(
        `for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {\n  notify(key, value);\n}`,
      ),
    ).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('sync Object.entries key-only and value-only loops are eligible as object/dict entries', () => {
    expect(classifyHandlerBody(`for (const [key] of Object.entries(raw)) {\n  notify(key);\n}`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`for (const [, value] of Object.entries(raw)) {\n  notify(value);\n}`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('async Object.entries pair for-of is rejected because entries are sync object/dict semantics', () => {
    expect(
      classifyHandlerBody(`for await (const [key, value] of Object.entries(raw)) {\n  await notify(key, value);\n}`),
    ).toEqual({
      eligible: false,
      reason: 'for-of-async-object-entries',
    });
  });

  test('async one-binding entry destructure is rejected', () => {
    expect(classifyHandlerBody(`for await (const [key] of stream) {\n  await notify(key);\n}`)).toEqual({
      eligible: false,
      reason: 'for-of-async-entry',
    });
  });

  test('for-await-of with unsupported body is rejected by inner reason', () => {
    const body = `for await (const x of xs) {\n  x++;\n}`;
    const result = classifyHandlerBody(body);
    expect(result).toEqual({ eligible: false, reason: 'expr-stmt-mutation' });
  });

  test('object destructuring const is eligible', () => {
    expect(classifyHandlerBody(`const { id, name } = user;\nreturn id;`).eligible).toBe(true);
  });

  test('array destructuring const is eligible', () => {
    expect(classifyHandlerBody(`const [first, second] = pair;\nreturn first;`).eligible).toBe(true);
  });

  test('TS-style type assertions are eligible when they erase cleanly', () => {
    expect(classifyHandlerBody(`return params.filePath as string;`).eligible).toBe(true);
    expect(classifyHandlerBody(`return { role: "user" as const };`).eligible).toBe(true);
  });

  test('regex literals, generic calls, and non-null assertions are eligible', () => {
    expect(classifyHandlerBody(`if (/^ok$/i.test(input)) {\n  return input;\n}\nreturn null;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`const seen = new Set<string>();\nreturn seen;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`const value = data[1]!;\nreturn value;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('index access is eligible in let and return expressions', () => {
    expect(classifyHandlerBody(`const first = items[0];\nreturn first;`).eligible).toBe(true);
    expect(classifyHandlerBody(`return record[key];`).eligible).toBe(true);
  });

  test('optional element access is eligible in let and return expressions', () => {
    expect(classifyHandlerBody(`const maybe = items?.[0];\nreturn maybe;`).eligible).toBe(true);
    expect(classifyHandlerBody(`return users?.[id]?.name;`).eligible).toBe(true);
  });

  test('typed const bindings are eligible when the annotation is safe', () => {
    expect(classifyHandlerBody(`const user: User | null = loadUser();\nreturn user;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('plain assignment statements are eligible', () => {
    expect(classifyHandlerBody(`x = 1;\nreturn x;`).eligible).toBe(true);
    expect(classifyHandlerBody(`obj.x = value;\nreturn obj;`).eligible).toBe(true);
    expect(classifyHandlerBody(`arr[0] = value;\nreturn arr;`).eligible).toBe(true);
    expect(classifyHandlerBody(`this.value = 1;\nreturn this.value;`).eligible).toBe(true);
    expect(classifyHandlerBody(`arr[obj?.idx] = value;\nreturn arr;`).eligible).toBe(true);
  });

  test('cross-target-safe compound assignment statements are eligible', () => {
    expect(classifyHandlerBody(`total += item.value;\nreturn total;`)).toEqual({ eligible: true, reason: 'ok' });
    expect(classifyHandlerBody(`mask |= Flag.Ready;\nreturn mask;`)).toEqual({ eligible: true, reason: 'ok' });
    expect(classifyHandlerBody(`count **= 2;\nreturn count;`)).toEqual({ eligible: true, reason: 'ok' });
  });

  test('while block with migratable body is eligible', () => {
    const body = `while (queue.length > 0) {\n  const item = queue.shift();\n  process(item);\n}\nreturn queue;`;
    expect(classifyHandlerBody(body)).toEqual({ eligible: true, reason: 'ok' });
  });

  test('break and continue are eligible inside migratable loops', () => {
    expect(
      classifyHandlerBody(`for (const user of users) {\n  if (skip(user)) {\n    continue;\n  }\n  notify(user);\n}`),
    ).toEqual({ eligible: true, reason: 'ok' });
    expect(classifyHandlerBody(`while (running) {\n  tick();\n  break;\n}`)).toEqual({ eligible: true, reason: 'ok' });
  });

  test('break and continue keep loop context through try blocks', () => {
    expect(
      classifyHandlerBody(`for (const item of items) {\n  try {\n    break;\n  } catch (err) {\n    continue;\n  }\n}`),
    ).toEqual({ eligible: true, reason: 'ok' });
  });

  test('nested loops with break and continue are eligible', () => {
    expect(
      classifyHandlerBody(
        `while (outer) {\n  for (const item of items) {\n    if (skip(item)) {\n      continue;\n    }\n    break;\n  }\n}`,
      ),
    ).toEqual({ eligible: true, reason: 'ok' });
  });
});

describe('classifyHandlerBody — disqualifiers (slice α-3 AST walker)', () => {
  // Slice α-3: classifier now uses an AST walk instead of regex. Reasons are
  // kebab-case slugs naming the first blocking shape — see
  // native-eligibility-ast.ts. Old regex-source reasons (`'\\bfor\\s*\\('` etc.)
  // are no longer surfaced. Tests here pin the new slug for each disqualifier.
  function rejected(body: string, expectedReason: string): void {
    const result = classifyHandlerBody(body);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe(expectedReason);
  }

  // Block-bodied callbacks are still rejected by the expression parser,
  // surfacing as `<stmt>-bad-expr` rather than a syntactic top-level bail.
  test('block-bodied callback rejected (return-bad-expr)', () =>
    rejected(`return xs.map((x) => { return x * 2; });`, 'return-bad-expr'));

  test('function declaration rejected (unsupported-stmt)', () =>
    rejected(`function inner() { return 1; }\nreturn inner();`, 'unsupported-stmt-FunctionDeclaration'));

  test('template placeholder bodies are classified separately from parser errors', () =>
    rejected(`export const {{name}} = ({{params}}) => {\n  {{CHILDREN}}\n};`, 'template-placeholder'));

  test('framework object-fragment bodies are classified as foreign by design', () =>
    rejected(`toasts: [],\naddToast: (message) => {\n  set({ message });\n}`, 'foreign-by-design'));

  test('host runtime interop bodies are classified as foreign by design', () => {
    rejected(
      `const { Pool } = await import('pg');\nreturn new Pool({ connectionString: process.env.DATABASE_URL });`,
      'foreign-by-design',
    );
    rejected(
      `// Replace with your actual database connection\nconst { Pool } = await import('pg');\nreturn new Pool();`,
      'foreign-by-design',
    );
    rejected(`const mod = import('pg');\nreturn mod;`, 'foreign-by-design');
    rejected(
      `useEffect(() => {\n  const timer = setTimeout(load, 250);\n  return () => clearTimeout(timer);\n}, []);`,
      'foreign-by-design',
    );
    rejected(`res.on('close', () => abort.abort());\nreturn req.body;`, 'foreign-by-design');
    rejected(`res.statusCode = 200;\nreturn result;`, 'foreign-by-design');
    rejected(`return req?.body;`, 'foreign-by-design');
    rejected(`return req?.body.value;`, 'foreign-by-design');
  });

  test('plain request data reads stay migratable', () => {
    expect(classifyHandlerBody(`const { id } = req.params;\nreturn id;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`const { name } = req.body;\nreturn name;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('foreign/template classifiers ignore string literals and comment precedence', () => {
    expect(classifyHandlerBody(`const banner = "see process.env and {{name}} docs";\nreturn banner;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`// TODO: replace with JSON.parse later\nreturn 1;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`// FIXME\nreturn req.body;`)).toEqual({ eligible: true, reason: 'ok' });
    rejected(`// comment before broken code\nreturn 1 +;`, 'comments-present');
    rejected(`return 1 +;`, 'ts-parse-error');
  });

  test('JSON stdlib-shaped host calls stay migratable instead of foreign-excluded', () => {
    expect(classifyHandlerBody(`const parsed = JSON.parse(raw);\nreturn parsed;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('host interop classifier ignores shadowed local names', () => {
    expect(classifyHandlerBody(`const res = { status: "ok" };\nreturn res.status;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`const fetch = (url: string) => url;\nreturn fetch("/local");`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`const Pool = makePool;\nreturn new Pool();`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('class declaration rejected (unsupported-stmt)', () =>
    rejected(`class Foo {}\nreturn new Foo();`, 'unsupported-stmt-ClassDeclaration'));

  test('classic for-loop rejected', () =>
    rejected(`for (let i = 0; i < xs.length; i++) { doThing(xs[i]); }`, 'for-stmt'));

  test('for-of non-block rejected to preserve verify byte-equivalence', () =>
    rejected(`for (const x of xs) doThing(x);\nreturn xs;`, 'for-of-non-block'));

  test('empty for-of block rejected to preserve verify byte-equivalence', () =>
    rejected(`for (const x of xs) {}\nreturn xs;`, 'for-of-empty-body'));

  test('unsupported for-of destructured bindings are still rejected', () => {
    rejected(`for (const [key, value] of pairs) {\n  notify(key, value);\n}`, 'for-of-sync-pair');
    rejected(`for (const { id } of users) {\n  use(id);\n}`, 'for-of-destructure');
    rejected(`for (const [only] of pairs) {\n  use(only);\n}`, 'for-of-sync-pair');
    rejected(`for (const [, value] of pairs) {\n  use(value);\n}`, 'for-of-sync-pair');
    rejected(`for (const [k, v, extra] of pairs) {\n  use(k, v, extra);\n}`, 'for-of-destructure');
    rejected(`for (const [k, ...rest] of pairs) {\n  use(k, rest);\n}`, 'for-of-destructure');
    rejected(`for (const [k = "fallback", v] of pairs) {\n  use(k, v);\n}`, 'for-of-destructure');
    rejected(`for (const [[k], v] of pairs) {\n  use(k, v);\n}`, 'for-of-destructure');
    rejected(
      `for (const [k, v]: [string, number] of Object.entries(obj)) {\n  use(k, v);\n}`,
      'for-of-destructure-type',
    );
    rejected(`for await (const [k, v]: [string, number] of pairs) {\n  use(k, v);\n}`, 'for-of-destructure-type');
  });

  test('for-of with unsafe type annotation rejected', () =>
    rejected(`for (const user: typeof import("fs") of users) {\n  notify(user);\n}`, 'for-of-bad-type'));

  test('for-of with compound assignment body is eligible', () => {
    expect(classifyHandlerBody(`for (const x of xs) {\n  y += x;\n}\nreturn y;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('while non-block rejected to preserve verify byte-equivalence', () =>
    rejected(`while (i < 10) i++;\nreturn i;`, 'while-non-block'));

  test('empty while block rejected to preserve verify byte-equivalence', () =>
    rejected(`while (i < 10) {}\nreturn i;`, 'while-empty-body'));

  test('while with bad condition rejected', () =>
    rejected(`while (function () { return true; }) {\n  return 1;\n}`, 'while-bad-cond'));

  test('do-while rejected', () => rejected(`do { i = i + 1; } while (i < 10);`, 'do-while-stmt'));

  test('break and continue outside loops rejected', () => {
    rejected(`break;`, 'break-outside-loop');
    rejected(`continue;`, 'continue-outside-loop');
  });

  test('labeled break and continue rejected', () => {
    rejected(`while (running) {\n  break outer;\n}`, 'break-labeled');
    rejected(`while (running) {\n  continue outer;\n}`, 'continue-labeled');
  });

  test('switch rejected', () => rejected(`switch (k) { case 1: return 'a'; }`, 'switch-stmt'));

  test('typeof type guard is eligible', () => {
    expect(classifyHandlerBody(`return typeof x === "string";`)).toEqual({ eligible: true, reason: 'ok' });
  });

  test('standalone typeof return is eligible', () => {
    expect(classifyHandlerBody(`return typeof x;`)).toEqual({ eligible: true, reason: 'ok' });
  });

  test('legacy fast pre-filter no longer rejects typeof expressions', () => {
    const body = `return typeof x === "string";\nreturn typeof x;`;
    expect(LEGACY_NEG_PATTERNS.some((re) => re.test(body))).toBe(false);
  });

  test('instanceof rejected (parser-expression bails)', () => rejected(`return x instanceof Date;`, 'return-bad-expr'));

  test('import statement rejected', () =>
    rejected(`import { foo } from 'bar';\nreturn foo();`, 'unsupported-stmt-ImportDeclaration'));

  test('computed non-expression assignment target rejected', () =>
    rejected(`obj[(a) => { return a; }] = 1;\nreturn obj;`, 'expr-stmt-bad-assign-target'));

  test('optional-chain assignment targets rejected', () => {
    rejected(`obj?.x = 1;\nreturn obj;`, 'expr-stmt-bad-assign-target');
    rejected(`arr?.[0] = 1;\nreturn arr;`, 'expr-stmt-bad-assign-target');
    rejected(`obj.x?.y = 1;\nreturn obj;`, 'expr-stmt-bad-assign-target');
  });

  test('post-increment rejected (mutation ExpressionStatement)', () =>
    rejected(`const x = 0;\nx++;\nreturn x;`, 'expr-stmt-mutation'));

  test('pre-decrement rejected (mutation ExpressionStatement)', () =>
    rejected(`const x = 5;\n--x;\nreturn x;`, 'expr-stmt-mutation'));

  test('JS-only logical assignment rejected (assignment ExpressionStatement)', () =>
    rejected(`x &&= next;\nreturn x;`, 'expr-stmt-assignment'));

  test('JS-only unsigned right shift assignment rejected (assignment ExpressionStatement)', () =>
    rejected(`x >>>= 1;\nreturn x;`, 'expr-stmt-assignment'));

  test('void operator rejected (parser-expression bails)', () => rejected(`return void 0;`, 'return-bad-expr'));

  test('unsafe type annotation rejected', () =>
    rejected(`const mod: typeof import("fs") = value;\nreturn mod;`, 'var-bad-type'));

  test('typed destructuring is eligible when the annotation is safe', () => {
    expect(classifyHandlerBody(`const { x }: { x: number } = obj;\nreturn x;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
    expect(classifyHandlerBody(`const [x, y]: [number, string] = pair;\nreturn x;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('debugger statement rejected', () =>
    // TS SyntaxKind[kind] returns the LAST registered name — DebuggerStatement
    // and LastStatement share a numeric value, so the slug surfaces as
    // `unsupported-stmt-LastStatement`. Pin the actual emitted string.
    rejected(`debugger;\nreturn 1;`, 'unsupported-stmt-LastStatement'));

  test('object destructuring with rest rejected', () =>
    rejected(`const { a, ...rest } = obj;\nreturn a;`, 'var-destructure-rest'));

  test('const = template-literal is eligible (fmt body-stmt path)', () => {
    expect(classifyHandlerBody('const label = `${count} files`;\nreturn label;')).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('let = template-literal is eligible', () => {
    expect(classifyHandlerBody('let label = `${count}`;\nreturn label;')).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('return = template-literal is eligible', () => {
    expect(classifyHandlerBody('return `${ms}ms`;')).toEqual({ eligible: true, reason: 'ok' });
  });

  test('no-substitution template (literal-only) is eligible', () => {
    expect(classifyHandlerBody('const msg = `hello`;\nreturn msg;')).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('object destructuring let is eligible', () => {
    expect(classifyHandlerBody(`let { a } = obj;\nreturn a;`)).toEqual({ eligible: true, reason: 'ok' });
  });

  test('array destructuring let is eligible', () => {
    expect(classifyHandlerBody(`let [first, second] = xs;\nreturn first;`)).toEqual({ eligible: true, reason: 'ok' });
  });

  test('array destructuring with rest rejected', () =>
    rejected(`const [first, ...rest] = xs;\nreturn first;`, 'var-destructure-rest'));

  test('empty object destructuring rejected', () => rejected(`const {} = obj;\nreturn obj;`, 'var-destructure-empty'));

  test('array destructuring with only holes rejected', () =>
    rejected(`const [,] = xs;\nreturn xs;`, 'var-destructure-empty'));

  test('var destructuring rejected (var-non-const)', () => rejected(`var { x } = obj;\nreturn x;`, 'var-non-const'));

  test('simple mutable let is eligible', () => {
    expect(classifyHandlerBody(`let x = 1;\nreturn x;`)).toEqual({ eligible: true, reason: 'ok' });
  });

  test('standalone comments inside body are eligible and preserved by migration', () => {
    expect(classifyHandlerBody(`// note\nreturn 1;`)).toEqual({ eligible: true, reason: 'ok' });
    expect(classifyHandlerBody(`if (ok) {\n  // nested note\n  return 1;\n}\nreturn 0;`)).toEqual({
      eligible: true,
      reason: 'ok',
    });
  });

  test('inline and trailing comments remain rejected', () => {
    rejected(`return 1; // note`, 'comments-present');
    rejected(`return 1;\n// tail`, 'comments-present');
  });
});

describe('classifyHandlerBody — array / object literals stay eligible', () => {
  // Sanity: `return [1, 2, 3]` (array literal preceded by keyword + space)
  // must NOT trip the indexing pattern `[\w\]]\[`.
  test('array literal as return value is eligible', () => {
    expect(classifyHandlerBody(`return [1, 2, 3];`).eligible).toBe(true);
  });

  test('array literal as let value is eligible', () => {
    expect(classifyHandlerBody(`const xs = [1, 2, 3];\nreturn xs;`).eligible).toBe(true);
  });

  test('comparisons (==, ===, !=, <=, >=) stay eligible', () => {
    expect(classifyHandlerBody(`return x === 1 && y >= 2 && z != 3;`).eligible).toBe(true);
  });

  test('declarations with `=` stay eligible', () => {
    expect(classifyHandlerBody(`const x = 1;\nconst y = 2;\nreturn x + y;`).eligible).toBe(true);
  });
});

describe('extractRawBodies', () => {
  test('returns empty for content without bodies', () => {
    expect(extractRawBodies(`fn name="x" type=int value=42`)).toEqual([]);
  });

  test('extracts a single body with line positions', () => {
    const src = [`fn name="add"`, `handler<<<`, `  return a + b;`, `>>>`].join('\n');
    const bodies = extractRawBodies(src);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.text).toBe('  return a + b;');
    expect(bodies[0]?.startLine).toBe(2);
    expect(bodies[0]?.endLine).toBe(4);
  });

  test('extracts multiple bodies', () => {
    const src = [`fn name="a" handler<<<`, `  return 1;`, `>>>`, `fn name="b" handler<<<`, `  return 2;`, `>>>`].join(
      '\n',
    );
    const bodies = extractRawBodies(src);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.text).toBe('  return 1;');
    expect(bodies[1]?.text).toBe('  return 2;');
    expect(bodies[1]?.startLine).toBe(4);
  });

  test('preserves blank lines inside body', () => {
    const src = [`fn handler<<<`, `  const x = 1;`, ``, `  return x;`, `>>>`].join('\n');
    const bodies = extractRawBodies(src);
    expect(bodies[0]?.text).toBe('  const x = 1;\n\n  return x;');
  });

  // Inline shapes mirror parser-core.ts `parseLines`. Slice 5a review
  // (gemini) flagged that the v1 extractor only matched line-end `<<<` +
  // line-only `>>>`, missing inline forms that the parser accepts.
  test('extracts inline single-line body `<<< body >>>`', () => {
    const src = `fn handler <<< return 1; >>>`;
    const bodies = extractRawBodies(src);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.text).toBe('return 1;');
    expect(bodies[0]?.startLine).toBe(1);
    expect(bodies[0]?.endLine).toBe(1);
  });

  test('discards content after `<<<` on open line in multi-line shape', () => {
    // parser-core.ts `parseLines` drops `afterOpen` content in this shape;
    // the extractor mirrors that behaviour so they agree on body content.
    const src = [`fn handler<<< discarded;`, `  second;`, `>>>`].join('\n');
    const bodies = extractRawBodies(src);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.text).toBe('  second;');
  });

  test('extracts content + close on same line', () => {
    const src = [`fn handler<<<`, `  body line`, `  return 1; >>>`].join('\n');
    const bodies = extractRawBodies(src);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.text).toBe('  body line\nreturn 1;');
  });
});

describe('scanFileForEligibility', () => {
  test('aggregates eligibility across bodies', () => {
    const src = [
      `fn name="ok" handler<<<`,
      `  return 1 + 2;`,
      `>>>`,
      `fn name="loop" handler<<<`,
      `  for (const x of xs) { y &&= x; }`,
      `  return y;`,
      `>>>`,
      `fn name="empty" handler<<<`,
      `>>>`,
    ].join('\n');
    const report = scanFileForEligibility(src);
    expect(report.totalBodies).toBe(3);
    expect(report.eligibleBodies).toBe(2);
    expect(report.bodies[0]?.eligible).toBe(true);
    expect(report.bodies[1]?.eligible).toBe(false);
    expect(report.bodies[1]?.reason).toBe('expr-stmt-assignment');
    expect(report.bodies[2]?.eligible).toBe(true);
    expect(report.bodies[2]?.reason).toBe('empty');
  });

  test('preserves line positions on report', () => {
    const src = [`// header`, `fn handler<<<`, `  return 1;`, `>>>`].join('\n');
    const report = scanFileForEligibility(src);
    expect(report.bodies[0]?.startLine).toBe(2);
    expect(report.bodies[0]?.endLine).toBe(4);
  });

  test('classifies explicit host-language handler boundaries separately', () => {
    const src = [
      `fn name="foreign"`,
      `  handler lang=ts reason="express response adapter" <<<`,
      `    return 1 + 2;`,
      `  >>>`,
      `fn name="missingReason"`,
      `  handler lang=ts <<<`,
      `    return 1 + 2;`,
      `  >>>`,
    ].join('\n');
    const report = scanFileForEligibility(src);
    expect(report.totalBodies).toBe(2);
    expect(report.eligibleBodies).toBe(1);
    expect(report.bodies[0]?.declaredLang).toBe('ts');
    expect(report.bodies[0]?.declaredReason).toBe('express response adapter');
    expect(report.bodies[0]?.eligible).toBe(false);
    expect(report.bodies[0]?.reason).toBe('explicit-foreign');
    expect(report.bodies[1]?.eligible).toBe(true);
    expect(report.bodies[1]?.reason).toBe('ok');
  });

  test('classifies explicit handler boundaries when quoted props contain fence text', () => {
    const report = scanFileForEligibility(
      [
        'fn name=x',
        '  handler title="my <<< title" lang=TS reason="adapter" <<<',
        '    return res.body;',
        '  >>>',
      ].join('\n'),
    );
    expect(report.totalBodies).toBe(1);
    expect(report.eligibleBodies).toBe(0);
    expect(report.bodies[0]?.opener).toContain('title="my <<< title"');
    expect(report.bodies[0]?.declaredLang).toBe('TS');
    expect(report.bodies[0]?.declaredReason).toBe('adapter');
    expect(report.bodies[0]?.reason).toBe('explicit-foreign');
  });

  test('classifies handler bodies when string literals contain closing fence text', () => {
    const inline = extractRawBodies('fn name=x\n  handler <<< return ">>>"; >>>');
    expect(inline).toHaveLength(1);
    expect(inline[0]?.text).toBe('return ">>>";');

    const template = extractRawBodies('fn name=x\n  handler <<< return `>>>`; >>>');
    expect(template).toHaveLength(1);
    expect(template[0]?.text).toBe('return `>>>`;');

    const multiline = extractRawBodies(
      ['fn name=x', '  handler <<<', '    const marker = ">>>";', '    return marker;', '  >>>'].join('\n'),
    );
    expect(multiline).toHaveLength(1);
    expect(multiline[0]?.text).toContain('const marker = ">>>";');
    expect(multiline[0]?.text).toContain('return marker;');

    const multilineTemplate = extractRawBodies(
      ['fn name=x', '  handler <<<', '    const marker = `', '>>>', '`;', '    return marker;', '  >>>'].join('\n'),
    );
    expect(multilineTemplate).toHaveLength(1);
    expect(multilineTemplate[0]?.text).toContain('const marker = `');
    expect(multilineTemplate[0]?.text).toContain('>>>');
    expect(multilineTemplate[0]?.text).toContain('return marker;');
  });

  test('classifies inline explicit host-language handler boundaries separately', () => {
    const report = scanFileForEligibility(
      'fn name=x\n  handler lang=python reason="numpy bridge" <<< return 1 + 2; >>>',
    );
    expect(report.totalBodies).toBe(1);
    expect(report.eligibleBodies).toBe(0);
    expect(report.bodies[0]?.declaredLang).toBe('python');
    expect(report.bodies[0]?.reason).toBe('explicit-foreign');
  });

  test('does not treat native handler metadata as explicit foreign in scanner', () => {
    const report = scanFileForEligibility(
      ['fn name=x', '  handler lang=kern reason="invalid metadata" <<<', '    return 1 + 2;', '  >>>'].join('\n'),
    );
    expect(report.totalBodies).toBe(1);
    expect(report.bodies[0]?.reason).not.toBe('explicit-foreign');
  });

  test('does not classify non-handler raw blocks as explicit foreign handlers', () => {
    const src = [`codeblock lang=ts reason="docs sample" <<<`, `  return 1 + 2;`, `>>>`].join('\n');
    const report = scanFileForEligibility(src);
    expect(report.totalBodies).toBe(1);
    expect(report.bodies[0]?.opener).toBe('codeblock lang=ts reason="docs sample"');
    expect(report.bodies[0]?.eligible).toBe(true);
    expect(report.bodies[0]?.reason).toBe('ok');
  });
});

// Type-check sanity — surfaces compile-time regressions if the public types
// drift from the runtime shape.
const _typeCheck: EligibilityResult = classifyHandlerBody('');
void _typeCheck;
