/** Native KERN handler body eligibility classifier — slice 5a tests. */

import {
  classifyHandlerBody,
  type EligibilityResult,
  extractRawBodies,
  scanFileForEligibility,
} from '../src/native-eligibility.js';
import { isValidKernTypeAnnotation } from '../src/native-eligibility-ast.js';

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

  test('KERN-stdlib call is eligible', () => {
    expect(classifyHandlerBody(`return Text.upper(name);`).eligible).toBe(true);
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

  // Arrow / function inside expressions are rejected by the expression parser,
  // surfacing as `<stmt>-bad-expr` rather than a syntactic top-level bail.
  test('arrow function rejected (return-bad-expr)', () => rejected(`return xs.map(x => x * 2);`, 'return-bad-expr'));

  test('function declaration rejected (unsupported-stmt)', () =>
    rejected(`function inner() { return 1; }\nreturn inner();`, 'unsupported-stmt-FunctionDeclaration'));

  test('class declaration rejected (unsupported-stmt)', () =>
    rejected(`class Foo {}\nreturn new Foo();`, 'unsupported-stmt-ClassDeclaration'));

  test('classic for-loop rejected', () =>
    rejected(`for (let i = 0; i < xs.length; i++) { doThing(xs[i]); }`, 'for-stmt'));

  test('for-of non-block rejected to preserve verify byte-equivalence', () =>
    rejected(`for (const x of xs) doThing(x);\nreturn xs;`, 'for-of-non-block'));

  test('empty for-of block rejected to preserve verify byte-equivalence', () =>
    rejected(`for (const x of xs) {}\nreturn xs;`, 'for-of-empty-body'));

  test('for-of destructured binding rejected until each supports patterns', () =>
    rejected(`for (const [k, v] of pairs) {\n  use(k, v);\n}`, 'for-of-destructure'));

  test('for-of with unsafe type annotation rejected', () =>
    rejected(`for (const user: typeof import("fs") of users) {\n  notify(user);\n}`, 'for-of-bad-type'));

  test('for-of with mutation body rejected by inner reason', () =>
    rejected(`for (const x of xs) {\n  y += x;\n}\nreturn y;`, 'expr-stmt-assignment'));

  test('while non-block rejected to preserve verify byte-equivalence', () =>
    rejected(`while (i < 10) i++;\nreturn i;`, 'while-non-block'));

  test('empty while block rejected to preserve verify byte-equivalence', () =>
    rejected(`while (i < 10) {}\nreturn i;`, 'while-empty-body'));

  test('while with bad condition rejected', () => rejected(`while (x => x) {\n  return 1;\n}`, 'while-bad-cond'));

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

  test('typeof rejected (parser-expression bails)', () => rejected(`return typeof x === "string";`, 'return-bad-expr'));

  test('instanceof rejected (parser-expression bails)', () => rejected(`return x instanceof Date;`, 'return-bad-expr'));

  test('import statement rejected', () =>
    rejected(`import { foo } from 'bar';\nreturn foo();`, 'unsupported-stmt-ImportDeclaration'));

  test('computed non-expression assignment target rejected', () =>
    rejected(`obj[a => a] = 1;\nreturn obj;`, 'expr-stmt-bad-assign-target'));

  test('optional-chain assignment targets rejected', () => {
    rejected(`obj?.x = 1;\nreturn obj;`, 'expr-stmt-bad-assign-target');
    rejected(`arr?.[0] = 1;\nreturn arr;`, 'expr-stmt-bad-assign-target');
    rejected(`obj.x?.y = 1;\nreturn obj;`, 'expr-stmt-bad-assign-target');
  });

  test('post-increment rejected (mutation ExpressionStatement)', () =>
    rejected(`const x = 0;\nx++;\nreturn x;`, 'expr-stmt-mutation'));

  test('pre-decrement rejected (mutation ExpressionStatement)', () =>
    rejected(`const x = 5;\n--x;\nreturn x;`, 'expr-stmt-mutation'));

  test('compound add-assign rejected (assignment ExpressionStatement)', () =>
    rejected(`const x = 1;\nx += 2;\nreturn x;`, 'expr-stmt-assignment'));

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

  test('object destructuring let rejected (var-non-const)', () =>
    rejected(`let { a } = obj;\nreturn a;`, 'var-non-const'));

  test('array destructuring with rest rejected', () =>
    rejected(`const [first, ...rest] = xs;\nreturn first;`, 'var-destructure-rest'));

  test('empty object destructuring rejected', () => rejected(`const {} = obj;\nreturn obj;`, 'var-destructure-empty'));

  test('array destructuring with only holes rejected', () =>
    rejected(`const [,] = xs;\nreturn xs;`, 'var-destructure-empty'));

  test('var destructuring rejected (var-non-const)', () => rejected(`var { x } = obj;\nreturn x;`, 'var-non-const'));

  // `let name = …` (mutable binding) — the migrator only emits `let` from
  // `const`, so any `let` declaration in the body is rejected.
  test('let-bind without destructure rejected (var-non-const)', () =>
    rejected(`let x = 1;\nreturn x;`, 'var-non-const'));

  // Comments-present bails the migrator silently, so the classifier mirrors
  // that bail as a top-level reason (BEFORE statement walking).
  test('comments inside body rejected', () => rejected(`// note\nreturn 1;`, 'comments-present'));
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
      `  for (const x of xs) { y += x; }`,
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
});

// Type-check sanity — surfaces compile-time regressions if the public types
// drift from the runtime shape.
const _typeCheck: EligibilityResult = classifyHandlerBody('');
void _typeCheck;
