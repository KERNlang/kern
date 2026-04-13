#!/usr/bin/env node
/**
 * Smoke harness for the shadow-analyzer. Runs against the built `dist/` output
 * so it works even when the workspace Jest install is broken (see pnpm hoist
 * issue with `pretty-format`). Re-run with:
 *
 *   pnpm --filter @kernlang/core build && node packages/core/scripts/shadow-smoke.mjs
 */
import { analyzeShadow } from '../dist/shadow-analyzer.js';
import { parse } from '../dist/parser.js';

let pass = 0;
let fail = 0;

async function check(name, source, predicate) {
  try {
    const diags = await analyzeShadow(parse(source));
    const ok = predicate(diags);
    if (ok) {
      pass++;
      console.log(`  PASS  ${name}`);
    } else {
      fail++;
      console.log(`  FAIL  ${name}`);
      console.log(`        diagnostics: ${JSON.stringify(diags, null, 2)}`);
    }
  } catch (err) {
    fail++;
    console.log(`  ERR   ${name}: ${err.message}`);
    console.log(err.stack);
  }
}

const none = (diags) => diags.length === 0;
const hasShadowTs = (code) => (diags) => diags.some((d) => d.rule === 'shadow-ts' && d.tsCode === code);
const hasUnsupported = (parent) => (diags) =>
  diags.some((d) => d.rule === 'shadow-unsupported-context' && d.nodeType === parent);

console.log('\n── fn ──────────────────────────────────────────────');
await check(
  'undefined variable caught',
  ['fn name=calc params="value:number" returns=number', '  handler <<<', '    return missingValue + value;', '  >>>'].join(
    '\n',
  ),
  hasShadowTs(2304),
);
await check(
  'unused params not flagged',
  ['fn name=echo params="value:string" returns=string', '  handler <<<', "    return 'ok';", '  >>>'].join('\n'),
  none,
);
await check(
  'return type mismatch caught',
  ['fn name=count returns=number', '  handler <<<', "    return 'oops';", '  >>>'].join('\n'),
  hasShadowTs(2322),
);
await check(
  'clean handler no diagnostics',
  ['fn name=answer returns=number', '  handler <<<', '    return 42;', '  >>>'].join('\n'),
  none,
);
await check(
  'valid param refs no diagnostics',
  [
    'fn name=formatLabel params="id:string,count:number" returns=string',
    '  handler <<<',
    '    const label = `${id}:${count}`;',
    '    return label;',
    '  >>>',
  ].join('\n'),
  none,
);

console.log('\n── method ──────────────────────────────────────────');
await check(
  'this.field resolves on service method',
  [
    'service name=UserService',
    '  field name=count type=number',
    '  method name=bump returns=number',
    '    handler <<<',
    '      this.count += 1;',
    '      return this.count;',
    '    >>>',
  ].join('\n'),
  none,
);
await check(
  'missing this.field flagged',
  [
    'service name=UserService',
    '  field name=count type=number',
    '  method name=bad returns=number',
    '    handler <<<',
    '      return this.missingField;',
    '    >>>',
  ].join('\n'),
  hasShadowTs(2339),
);

console.log('\n── websocket ───────────────────────────────────────');
await check(
  'connect handler sees ws/path',
  [
    'websocket name=chat path="/ws"',
    '  on event=connect',
    '    handler <<<',
    '      ws.send(path);',
    '    >>>',
  ].join('\n'),
  none,
);
await check(
  'message handler sees data',
  [
    'websocket name=chat path="/ws"',
    '  on event=message',
    '    handler <<<',
    '      ws.send(data.greeting);',
    '    >>>',
  ].join('\n'),
  none,
);
await check(
  'unknown var in ws handler flagged',
  [
    'websocket name=chat path="/ws"',
    '  on event=connect',
    '    handler <<<',
    '      ws.send(nonexistent);',
    '    >>>',
  ].join('\n'),
  hasShadowTs(2304),
);

console.log('\n── Codex review regressions ────────────────────────');
await check(
  'multi-service methods do not cross-contaminate __ShadowSelf',
  [
    'service name=AService',
    '  field name=a type=number',
    '  method name=useA returns=number',
    '    handler <<<',
    '      return this.a;',
    '    >>>',
    'service name=BService',
    '  field name=b type=string',
    '  method name=useB returns=string',
    '    handler <<<',
    '      return this.b;',
    '    >>>',
  ].join('\n'),
  none,
);
await check(
  'referencing wrong service field is still caught (not hidden by module isolation)',
  [
    'service name=AService',
    '  field name=a type=number',
    '  method name=bad returns=number',
    '    handler <<<',
    '      return this.b;',
    '    >>>',
    'service name=BService',
    '  field name=b type=string',
  ].join('\n'),
  hasShadowTs(2339),
);
await check(
  'async fn allows `await` without TS1308',
  [
    'fn name=load async=true returns="Promise<number>"',
    '  handler <<<',
    '    const n = await Promise.resolve(42);',
    '    return n;',
    '  >>>',
  ].join('\n'),
  none,
);
await check(
  'plain fn using `await` is still flagged',
  [
    'fn name=bad returns=number',
    '  handler <<<',
    '    return await Promise.resolve(42);',
    '  >>>',
  ].join('\n'),
  (diags) => diags.some((d) => d.rule === 'shadow-ts' && (d.tsCode === 1308 || d.tsCode === 2355)),
);
await check(
  'repository method can reference this.modelType',
  [
    'model name=User',
    '  column name=id type=string',
    'repository name=UserRepo model=User',
    '  method name=label returns=string',
    '    handler <<<',
    '      return this.modelType;',
    '    >>>',
  ].join('\n'),
  none,
);
await check(
  'console.log does not trigger TS2584',
  [
    'fn name=chatter returns=void',
    '  handler <<<',
    '    console.log("hello");',
    '  >>>',
  ].join('\n'),
  none,
);
await check(
  'setTimeout/fetch/process available as ambient globals',
  [
    'fn name=mix async=true returns="Promise<void>"',
    '  handler <<<',
    '    setTimeout(() => {}, 100);',
    '    const r = await fetch("/x");',
    '    console.log(process.env.NODE_ENV, r);',
    '  >>>',
  ].join('\n'),
  none,
);

console.log('\n── Codex review round 3 regressions ────────────────');
await check(
  'sibling fn can be called from another fn handler',
  [
    'fn name=double params="n:number" returns=number',
    '  handler <<<',
    '    return n * 2;',
    '  >>>',
    'fn name=quad params="n:number" returns=number',
    '  handler <<<',
    '    return double(double(n));',
    '  >>>',
  ].join('\n'),
  none,
);
await check(
  'sibling const can be referenced (ignoring the const-handler skip)',
  [
    'const name=MAX type=number',
    '  handler <<<',
    '    42',
    '  >>>',
    'fn name=cap params="n:number" returns=number',
    '  handler <<<',
    '    return Math.min(n, MAX);',
    '  >>>',
  ].join('\n'),
  (diags) => diags.every((d) => d.rule !== 'shadow-ts'),
);
await check(
  'sibling error class can be thrown',
  [
    'error name=NotFound',
    'fn name=find params="id:string" returns=string',
    '  handler <<<',
    '    throw new NotFound();',
    '  >>>',
  ].join('\n'),
  none,
);
await check(
  'fn missing return value surfaced (signature-level TS2355)',
  [
    'fn name=bad returns=number',
    '  handler <<<',
    '    const x = 1;',
    '  >>>',
  ].join('\n'),
  hasShadowTs(2355),
);

console.log('\n── Codex review round 4 regressions ────────────────');
await check(
  'generator fn return type uses Generator<T>',
  [
    'fn name=nums generator=true returns=number',
    '  handler <<<',
    '    yield 1;',
    '    yield 2;',
    '  >>>',
    'fn name=sumNums returns=number',
    '  handler <<<',
    '    let total = 0;',
    '    for (const x of nums()) { total += x; }',
    '    return total;',
    '  >>>',
  ].join('\n'),
  (diags) => diags.every((d) => d.rule !== 'shadow-ts'),
);
await check(
  'stream fn return type uses AsyncGenerator<T>',
  [
    'fn name=pump stream=true returns=number',
    '  handler <<<',
    '    yield 1;',
    '  >>>',
    'fn name=drain async=true returns="Promise<number>"',
    '  handler <<<',
    '    let total = 0;',
    '    for await (const x of pump()) { total += x; }',
    '    return total;',
    '  >>>',
  ].join('\n'),
  (diags) => diags.every((d) => d.rule !== 'shadow-ts'),
);
await check(
  'model name is not constructible as a value',
  [
    'model name=User',
    '  column name=id type=string',
    'fn name=bad returns=unknown',
    '  handler <<<',
    '    return new User();',
    '  >>>',
  ].join('\n'),
  // Accept any shadow-ts diagnostic — TS2693 "only refers to a type" or similar.
  (diags) => diags.some((d) => d.rule === 'shadow-ts'),
);
await check(
  'model name is usable as a type',
  [
    'model name=User',
    '  column name=id type=string',
    'fn name=greet params="u:User" returns=string',
    '  handler <<<',
    '    return "hi " + u.id;',
    '  >>>',
  ].join('\n'),
  (diags) => diags.every((d) => d.rule !== 'shadow-ts'),
);

console.log('\n── unsupported ─────────────────────────────────────');
await check(
  'route handler flagged unsupported',
  [
    'server name=API',
    '  route path="/users" method=get',
    '    handler <<<',
    '      res.json([]);',
    '    >>>',
  ].join('\n'),
  hasUnsupported('route'),
);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
