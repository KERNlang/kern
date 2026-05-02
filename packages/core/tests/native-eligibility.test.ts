/** Native KERN handler body eligibility classifier — slice 5a tests. */

import {
  classifyHandlerBody,
  type EligibilityResult,
  extractRawBodies,
  scanFileForEligibility,
} from '../src/native-eligibility.js';

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

  test('await + ? propagation is eligible', () => {
    expect(classifyHandlerBody(`const u = await fetchUser(id)?;\nreturn u.name;`).eligible).toBe(true);
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
});

describe('classifyHandlerBody — disqualifiers', () => {
  function rejected(body: string, expectedSource: string): void {
    const result = classifyHandlerBody(body);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe(expectedSource);
  }

  test('arrow function rejected', () => rejected(`return xs.map(x => x * 2);`, '=>'));

  test('function declaration rejected', () =>
    rejected(`function inner() { return 1; }\nreturn inner();`, '\\bfunction\\b'));

  test('class declaration rejected', () => rejected(`class Foo {}\nreturn new Foo();`, '\\bclass\\s+\\w'));

  test('for-loop rejected', () => rejected(`for (const x of xs) { y += x; }\nreturn y;`, '\\bfor\\s*\\('));

  test('while-loop rejected', () => rejected(`while (i < 10) i++;\nreturn i;`, '\\bwhile\\s*\\('));

  test('switch rejected', () => rejected(`switch (k) { case 1: return 'a'; }`, '\\bswitch\\s*\\('));

  test('typeof rejected', () => rejected(`return typeof x === "string";`, '\\btypeof\\b'));

  test('instanceof rejected', () => rejected(`return x instanceof Date;`, '\\binstanceof\\b'));

  test('import statement rejected', () => rejected(`import { foo } from 'bar';\nreturn foo();`, '^\\s*import\\b'));

  test('require call rejected', () => rejected(`const x = require('x');\nreturn x;`, '\\brequire\\('));

  test('this.X = Y rejected', () =>
    // The generic property-assignment pattern catches this before the more
    // specific `\bthis\.\w+\s*=` pattern (first match wins).
    rejected(`this.value = 1;\nreturn this.value;`, '^\\s*\\w+(?:\\.\\w+|\\[[^\\]]+\\])+\\s*=[^=]'));

  test('console.log rejected', () => rejected(`console.log(x);\nreturn x;`, '\\bconsole\\.\\w'));

  test('process.env rejected', () => rejected(`return process.env.HOME;`, '\\bprocess\\.\\w'));

  test('Buffer rejected', () => rejected(`return Buffer.from(x);`, '\\bBuffer\\b'));

  test('globalThis rejected', () => rejected(`return globalThis.foo;`, '\\bglobalThis\\b'));

  test('res.X rejected', () => rejected(`res.json({ ok: true });\nreturn;`, '\\bres\\.\\w'));

  test('req.X rejected', () => rejected(`return req.body.id;`, '\\breq\\.\\w'));

  test('next() rejected', () => rejected(`next(err);\nreturn;`, '\\bnext\\('));

  test('JSON.parse rejected', () => rejected(`return JSON.parse(s);`, '\\bJSON\\.\\w'));

  test('argument spread rejected', () => rejected(`return f(...args);`, '\\(\\s*\\.{3}'));

  test('regex literal rejected', () => rejected(`return /abc/g.test(s);`, '\\/\\w+\\/[gimsy]*'));

  test('yield rejected', () => rejected(`yield 1;\nreturn 2;`, '\\byield\\b'));

  test('do-while rejected', () => {
    // Note: NEG_PATTERNS is first-match-wins; do-while bodies trip the
    // `while (` pattern before the `do {` pattern. Either is a valid
    // disqualifier — the test pins the actual reported reason.
    rejected(`do {\n  i++;\n} while (i < 5);`, '\\bwhile\\s*\\(');
  });

  // Destructuring gap — flagged by all three buddies (Codex/Gemini/OpenCode)
  // in the slice 5a review. Slice 4d only supports the single-binding
  // `let name=X value=EXPR` form; the rewriter (slice 5b) is what would
  // expand `let { a, b } = obj` into multiple lets.
  test('object destructuring const rejected', () =>
    rejected(`const { a, b } = obj;\nreturn a + b;`, '\\b(?:const|let|var)\\s*[{[]'));

  test('object destructuring let rejected', () =>
    rejected(`let { a } = obj;\nreturn a;`, '\\b(?:const|let|var)\\s*[{[]'));

  test('array destructuring rejected', () =>
    rejected(`const [first, ...rest] = xs;\nreturn first;`, '\\b(?:const|let|var)\\s*[{[]'));

  test('var destructuring rejected', () => rejected(`var { x } = obj;\nreturn x;`, '\\b(?:const|let|var)\\s*[{[]'));

  // Mutation / assignment / indexing — flagged by the slice 5a pre-push
  // review (codex+gemini). KERN's `let` lowers to `const`, the expression
  // parser rejects assignment in expressions, and lbracket-indexing breaks
  // codegen.
  test('post-increment rejected', () => rejected(`let x = 0;\nx++;\nreturn x;`, '\\+\\+|--'));

  test('pre-decrement rejected', () => rejected(`let x = 5;\n--x;\nreturn x;`, '\\+\\+|--'));

  test('compound add-assign rejected', () => rejected(`let x = 1;\nx += 2;\nreturn x;`, '[+\\-*/%]='));

  test('compound mul-assign rejected', () => rejected(`let x = 2;\nx *= 3;\nreturn x;`, '[+\\-*/%]='));

  test('property assignment rejected', () =>
    rejected(`obj.x = 1;\nreturn obj;`, '^\\s*\\w+(?:\\.\\w+|\\[[^\\]]+\\])+\\s*=[^=]'));

  test('bracket-index assignment rejected', () =>
    rejected(`arr[0] = 1;\nreturn arr;`, '^\\s*\\w+(?:\\.\\w+|\\[[^\\]]+\\])+\\s*=[^=]'));

  test('bare reassignment rejected', () => rejected(`x = 1;\nreturn x;`, '^\\s*\\w+\\s*=[^=>]'));

  test('delete operator rejected', () => rejected(`delete obj.x;\nreturn obj;`, '\\bdelete\\s'));

  test('indexing rejected', () => rejected(`return xs[0];`, '[\\w\\]]\\['));

  test('chained indexing rejected', () => rejected(`return arr[i][j];`, '[\\w\\]]\\['));

  test('void operator rejected', () => rejected(`return void 0;`, '\\bvoid\\s'));

  test('debugger statement rejected', () => rejected(`debugger;\nreturn 1;`, '\\bdebugger\\b'));

  test('with statement rejected', () => rejected(`with (obj) { return x; }`, '\\bwith\\s*\\('));

  test('eval call rejected', () => rejected(`return eval("1+2");`, '\\beval\\s*\\('));
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
    expect(report.bodies[1]?.reason).toBe('\\bfor\\s*\\(');
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
