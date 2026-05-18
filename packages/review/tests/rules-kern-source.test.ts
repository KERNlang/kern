import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reviewGraph, reviewKernSource } from '../src/index.js';

const TMP = join(tmpdir(), 'kern-review-kern-source-tests');

describe('.kern source rules', () => {
  it('reports undefined references from handler scope', () => {
    const source = `
screen name=Lookup
  const name=endpoint value="/api/providers"
  fn name=lookup params="provider:Provider" returns=string
    handler <<<
      return registry.get(provider, endpoint);
    >>>
`;
    const report = reviewKernSource(source, 'lookup.kern');
    const finding = report.findings.find((f) => f.ruleId === 'undefined-reference');

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('registry');
    expect(finding?.message).not.toContain('provider');
    expect(finding?.message).not.toContain('endpoint');
    expect(finding?.primarySpan.file).toBe('lookup.kern');
  });

  // Regression — Agon reported `use path="..." from name=X` bindings were
  // invisible to the undefined-reference rule: the codegen emitted the
  // matching `import { X } from '...';` line but `collectVisibleBindings`
  // never registered the binding, so any handler using X tripped a false
  // positive. The collector now special-cases `use` like `import`, walking
  // its `from` children and adding `as` (or `name` if no alias) to the
  // visible-binding set.
  it('treats `use path=... from name=X` bindings as visible to handlers', () => {
    const source = `
use path="./helper.kern"
  from name=parseUser
  from name=Validator kind=type
  from name=rawFn as=fn

fn name=callIt returns=string
  handler <<<
    parseUser("x");
    fn();
    return "ok";
  >>>
`;
    const report = reviewKernSource(source, 'use-bindings.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference');
    expect(undef.some((f) => f.message.includes('parseUser'))).toBe(false);
    expect(undef.some((f) => f.message.includes('fn'))).toBe(false);
  });

  // Regression — Agon-session diagnosis: aliased imports (`import { foo as
  // bar } from '...'`) lowered to a `names="foo as bar"` parser prop. The
  // import-binding collector then split on `,` and registered the literal
  // string `"foo as bar"` as the binding name. Any handler reference to the
  // alias (`bar`) tripped undefined-reference falsely — most visible in raw
  // `<<<>>>` blocks because that's where references hit the snippet
  // analyser. The `use`/`from` path already handled aliases via `alias ||
  // name`; the `import` path now mirrors that via `parseImportNames`.
  // Codex review fix on the alias-import follow-up: aliased TYPE-ONLY imports
  // (`import names="Foo as Bar" types=true`) MUST NOT register `Bar` as a
  // visible runtime binding. They lower to `import type { Foo as Bar }` in
  // TS codegen, which is erased at runtime — so a handler that calls
  // `Bar(...)` is a real `undefined-reference` and must keep firing.
  // Before this guard, the alias fix silently suppressed those findings.
  // Mirrors the `use/from` path's `kind === 'type'` skip.
  it('still flags VALUE-position usage of an ALIASED `import names=... types=true` binding', () => {
    const source = `
import names="OriginalType as LocalType" from="./types" types=true

fn name=callIt returns=string
  handler <<<
    return LocalType.parse("x");
  >>>
`;
    const report = reviewKernSource(source, 'aliased-type-only.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference');
    expect(undef.some((f) => f.message.includes('LocalType'))).toBe(true);
  });

  it('treats `import { foo as bar }` aliased names as the LOCAL binding (no false undefined-reference)', () => {
    const source = `
import names="readFileSync as readFile,writeFileSync as writeFile" from="node:fs"
import names="join" from="node:path"

fn name=callIt returns=string
  handler <<<
    const path = join("a", "b");
    const contents = readFile(path, "utf8");
    writeFile(path, contents);
    return contents;
  >>>
`;
    const report = reviewKernSource(source, 'aliased-import.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference');
    // The local bindings are `readFile`, `writeFile`, `join`. The imported
    // names (`readFileSync`, `writeFileSync`) are NOT visible at use-site.
    expect(undef.some((f) => f.message.includes('readFile'))).toBe(false);
    expect(undef.some((f) => f.message.includes('writeFile'))).toBe(false);
    expect(undef.some((f) => f.message.includes('join'))).toBe(false);
  });

  it('still flags references that are NOT declared via `use`', () => {
    const source = `
use path="./helper.kern"
  from name=parseUser

fn name=callIt returns=string
  handler <<<
    return missingFn(parseUser("x"));
  >>>
`;
    const report = reviewKernSource(source, 'use-partial.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference');
    expect(undef.some((f) => f.message.includes('missingFn'))).toBe(true);
    expect(undef.some((f) => f.message.includes('parseUser'))).toBe(false);
  });

  // Codex review fix — type-only `from` bindings must NOT join the visible
  // binding map. They're erased at runtime by `import type`, so any
  // value-position usage in a handler is a real undefined reference.
  // Type-position usage is already filtered out of the reference set by
  // the snippet analyzer, so the rule never sees it either way.
  it('flags value-position usage of a `from kind=type` binding', () => {
    const source = `
use path="./helper.kern"
  from name=Validator kind=type

fn name=callIt returns=string
  handler <<<
    return Validator.parse("x");
  >>>
`;
    const report = reviewKernSource(source, 'use-type-only.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference');
    expect(undef.some((f) => f.message.includes('Validator'))).toBe(true);
  });

  it('treats prop declarations inside a screen as bindings visible to handlers', () => {
    const source = `
screen name=Card
  prop name=title type=string
  prop name=count type=number optional=true
  fn name=render returns=string
    handler <<<
      return \`\${title} (\${count})\`;
    >>>
`;
    const report = reviewKernSource(source, 'card.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference');
    expect(undef.some((f) => f.message.includes('title'))).toBe(false);
    expect(undef.some((f) => f.message.includes('count'))).toBe(false);
  });

  it('does not treat yield in generator-style handlers as an undefined reference', () => {
    const source = `
server name=StreamApi
  const name=nextChunk value=1
  fn name=stream returns=number
    handler <<<
      yield nextChunk;
    >>>
`;
    const report = reviewKernSource(source, 'stream.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference');
    expect(undef).toEqual([]);
  });

  it('reports literal-union values used like objects but allows string methods', () => {
    const badSource = `
type name=Article values="news|blog"
fn name=formatArticle params="a:Article" returns=string
  handler <<<
    return a.name;
  >>>
`;
    const badReport = reviewKernSource(badSource, 'article.kern');
    const mismatch = badReport.findings.find((f) => f.ruleId === 'type-model-mismatch');

    expect(mismatch).toBeDefined();
    expect(mismatch?.category).toBe('type');
    expect(mismatch?.message).toContain('Article');
    expect(mismatch?.relatedSpans?.[0].file).toBe('article.kern');

    const okSource = `
type name=Article values="news|blog"
fn name=normalizeArticle params="a:Article" returns=string
  handler <<<
    return a.toUpperCase();
  >>>
`;
    const okReport = reviewKernSource(okSource, 'article-ok.kern');
    expect(okReport.findings.some((f) => f.ruleId === 'type-model-mismatch')).toBe(false);
  });

  it('reports unused state but treats reads and setters as usage', () => {
    const source = `
hook name=useSearch returns=void
  state name=query type=string init=""
  state name=loading type=boolean init=false
  callback name=handleChange params="value:string"
    handler <<<
      setQuery(value);
      return query;
    >>>
`;
    const report = reviewKernSource(source, 'hook.kern');
    const unused = report.findings.filter((f) => f.ruleId === 'unused-state');

    expect(unused).toHaveLength(1);
    expect(unused[0].message).toContain('loading');
    expect(unused[0].message).not.toContain('query');
  });

  it('reports handler-heavy files when handler code dominates tokens', () => {
    const source = `
fn name=heavy params="input:string" returns=string
  handler <<<
    const words = input.split(" ");
    const filtered = words.filter((word) => word.trim().length > 0);
    const mapped = filtered.map((word) => word.toUpperCase());
    return mapped.join("-");
  >>>
`;
    const report = reviewKernSource(source, 'heavy.kern');
    const finding = report.findings.find((f) => f.ruleId === 'handler-heavy');

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('info');
    expect(finding?.message).toContain('file tokens');
  });

  it('sees file-level imports from inside top-level fn handlers', () => {
    const source = `
import from="node:child_process" names=execFileSync
fn name=listBranches returns=string
  handler <<<
    return execFileSync('git', ['branch']).toString();
  >>>
`;
    const report = reviewKernSource(source, 'git.kern');
    const undef = report.findings.filter(
      (f) => f.ruleId === 'undefined-reference' && f.message.includes('execFileSync'),
    );
    expect(undef).toHaveLength(0);
  });

  it('sees cross-file .kern imports from handlers', () => {
    const source = `
import from="./agent.kern" names=AgentSession
fn name=startSession returns=unknown
  handler <<<
    return new AgentSession();
  >>>
`;
    const report = reviewKernSource(source, 'team.kern');
    const undef = report.findings.filter(
      (f) => f.ruleId === 'undefined-reference' && f.message.includes('AgentSession'),
    );
    expect(undef).toHaveLength(0);
  });

  it('registers optional params (cause?:unknown) as visible bindings', () => {
    const source = `
fn name=explain params="cause?:unknown, engineId?:string, count?:number" returns=string
  handler <<<
    return String(cause) + (engineId ?? '') + (count ?? 0);
  >>>
`;
    const report = reviewKernSource(source, 'explain.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference');
    expect(undef.flatMap((f) => f.message)).toEqual([]);
  });

  it('registers signal name=abort as a file-level binding visible to handlers', () => {
    const source = `
signal name=abort
fn name=runAgentMode returns=void
  handler <<<
    if (abort) return;
  >>>
`;
    const report = reviewKernSource(source, 'agent.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference' && f.message.includes('abort'));
    expect(undef).toHaveLength(0);
  });

  it('treats setImmediate and clearImmediate as Node ambients', () => {
    const source = `
fn name=yieldEventLoop returns=void
  handler <<<
    const token = setImmediate(() => {});
    clearImmediate(token);
  >>>
`;
    const report = reviewKernSource(source, 'yield.kern');
    const undef = report.findings.filter(
      (f) =>
        f.ruleId === 'undefined-reference' &&
        (f.message.includes('setImmediate') || f.message.includes('clearImmediate')),
    );
    expect(undef).toHaveLength(0);
  });

  it('lets local bindings shadow file-level declarations (no inverted scoping)', () => {
    // If the seed ran before the upward walk, top-level `Status` type would
    // override the inner `const status:string` and typeModelMismatch would
    // flag `.toUpperCase()` as a misuse of the literal union.
    const source = `
type name=Status values="ok|err"
fn name=describe returns=string
  const name=status type=string value="ready"
  handler <<<
    return status.toUpperCase();
  >>>
`;
    const report = reviewKernSource(source, 'shadow.kern');
    const mismatch = report.findings.filter((f) => f.ruleId === 'type-model-mismatch');
    expect(mismatch).toHaveLength(0);
  });

  it('does not leak a top-level fn nested declaration into a sibling fn', () => {
    // Two fns share a service parent. producer's local const must NOT leak
    // into consumer, even though both are seen during file-level seeding.
    const source = `
service name=Manager
  fn name=producer returns=string
    const name=secret value="shh"
    handler <<<
      return secret;
    >>>
  fn name=consumer returns=string
    handler <<<
      return secret;
    >>>
`;
    const report = reviewKernSource(source, 'leak.kern');
    const undef = report.findings.filter((f) => f.ruleId === 'undefined-reference' && f.message.includes('secret'));
    expect(undef).toHaveLength(1);
  });

  it('still surfaces type-model-mismatch when the typed binding is file-level', () => {
    const source = `
type name=Article values="news|blog"
const name=current type=Article value="news"
fn name=render returns=string
  handler <<<
    return current.name;
  >>>
`;
    const report = reviewKernSource(source, 'article-toplevel.kern');
    const mismatch = report.findings.filter((f) => f.ruleId === 'type-model-mismatch');
    expect(mismatch.length).toBeGreaterThan(0);
    expect(mismatch[0].message).toContain('Article');
  });

  it('reports missing confidence under requireConfidenceAnnotations and suppresses it when confidence exists', () => {
    const source = `
fn name=loadUser params="id:string" returns=unknown
  handler <<<
    const response = await fetch("/api/users/" + id);
    return response.json();
  >>>
`;
    const report = reviewKernSource(source, 'confidence-missing.kern', {
      requireConfidenceAnnotations: true,
      noCache: true,
    });
    const finding = report.findings.find((f) => f.ruleId === 'missing-confidence');

    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('info');
    expect(finding?.message).toContain('confidence annotations');
    expect(finding?.message).toContain('loadUser');

    const annotatedSource = `
fn name=loadUser confidence=0.7 params="id:string" returns=unknown
  handler <<<
    const response = await fetch("/api/users/" + id);
    return response.json();
  >>>
`;
    const annotatedReport = reviewKernSource(annotatedSource, 'confidence-present.kern', {
      requireConfidenceAnnotations: true,
      noCache: true,
    });
    expect(annotatedReport.findings.some((f) => f.ruleId === 'missing-confidence')).toBe(false);
  });

  it('reports duplicate top-level symbols across .kern files in graph review', () => {
    const dir = join(TMP, 'duplicate-symbols');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const aFile = join(dir, 'a.kern');
    const bFile = join(dir, 'b.kern');
    writeFileSync(
      aFile,
      `
fn name=loadUser returns=string
  handler <<<
    return "a";
  >>>
`,
    );
    writeFileSync(
      bFile,
      `
fn name=loadUser returns=string
  handler <<<
    return "b";
  >>>
`,
    );

    const reports = reviewGraph([aFile, bFile], { noCache: true });
    const aReport = reports.find((r) => r.filePath === aFile);
    const bReport = reports.find((r) => r.filePath === bFile);

    const aFinding = aReport?.findings.find((f) => f.ruleId === 'kern-duplicate-symbol');
    const bFinding = bReport?.findings.find((f) => f.ruleId === 'kern-duplicate-symbol');

    expect(aFinding).toBeDefined();
    expect(aFinding?.message).toContain('loadUser');
    expect(aFinding?.relatedSpans?.some((span) => span.file === bFile)).toBe(true);
    expect(bFinding).toBeDefined();
    expect(bFinding?.relatedSpans?.some((span) => span.file === aFile)).toBe(true);
  });

  it('missing-confidence is opt-in: silent by default, fires with requireConfidenceAnnotations', () => {
    const source = `
screen name=External
  fn name=fetchUser params="id:string" returns=User
    handler <<<
      return fetch(\`/api/users/\${id}\`).then(r => r.json());
    >>>
`;
    const defaultReport = reviewKernSource(source, 'api.kern', { noCache: true });
    expect(defaultReport.findings.some((f) => f.ruleId === 'missing-confidence')).toBe(false);

    const requiredReport = reviewKernSource(source, 'api.kern', { requireConfidenceAnnotations: true, noCache: true });
    expect(requiredReport.findings.some((f) => f.ruleId === 'missing-confidence')).toBe(true);
  });

  describe('async-predicate-return', () => {
    it('flags async fn passed directly to .filter()', () => {
      const source = `
fn name=isReady params="x:User" returns=boolean async=true
  handler <<<
    return await checkRemote(x);
  >>>
fn name=pickReady params="users:User[]" returns="User[]"
  handler <<<
    return users.filter(isReady);
  >>>
`;
      const report = reviewKernSource(source, 'pred.kern');
      const finding = report.findings.find((f) => f.ruleId === 'async-predicate-return');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('error');
      expect(finding?.message).toContain('isReady');
      expect(finding?.message).toContain('Promise<boolean>');
    });

    it('flags async fn passed to .find/.some/.every/.findIndex', () => {
      for (const method of ['find', 'some', 'every', 'findIndex']) {
        const source = `
fn name=isMatch params="x:User" returns=boolean async=true
  handler <<<
    return await remoteCheck(x);
  >>>
fn name=user params="users:User[]" returns=unknown
  handler <<<
    return users.${method}(isMatch);
  >>>
`;
        const report = reviewKernSource(source, `pred-${method}.kern`);
        const finding = report.findings.find((f) => f.ruleId === 'async-predicate-return');
        expect(finding).toBeDefined();
      }
    });

    it('does NOT flag async fn that is awaited (correct usage)', () => {
      const source = `
fn name=isReady params="x:User" returns=boolean async=true
  handler <<<
    return await checkRemote(x);
  >>>
fn name=gate params="x:User" returns=boolean async=true
  handler <<<
    if (await isReady(x)) return true;
    return false;
  >>>
`;
      const report = reviewKernSource(source, 'await.kern');
      expect(report.findings.some((f) => f.ruleId === 'async-predicate-return')).toBe(false);
    });

    it('does NOT flag synchronous fn passed to .filter()', () => {
      const source = `
fn name=isReady params="x:User" returns=boolean
  handler <<<
    return x.ready === true;
  >>>
fn name=pickReady params="users:User[]" returns="User[]"
  handler <<<
    return users.filter(isReady);
  >>>
`;
      const report = reviewKernSource(source, 'sync.kern');
      expect(report.findings.some((f) => f.ruleId === 'async-predicate-return')).toBe(false);
    });

    it('does NOT flag when handler param shadows the file-level async fn name (Codex P2)', () => {
      const source = `
fn name=isReady params="x:User" returns=boolean async=true
  handler <<<
    return await checkRemote(x);
  >>>
fn name=pickReady params="isReady:(u:User)=>boolean,users:User[]" returns="User[]"
  handler <<<
    return users.filter(isReady);
  >>>
`;
      const report = reviewKernSource(source, 'shadow.kern');
      expect(report.findings.some((f) => f.ruleId === 'async-predicate-return')).toBe(false);
    });
  });

  describe('this-is-outside-class', () => {
    it('flags standalone fn (no this: param) with returns="this is T"', () => {
      const source = `
fn name=isAdmin params="x:User" returns="this is Admin"
  handler <<<
    return x.role === "admin";
  >>>
`;
      const report = reviewKernSource(source, 'thisis.kern');
      const finding = report.findings.find((f) => f.ruleId === 'this-is-outside-class');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('error');
      expect(finding?.message).toContain('isAdmin');
    });

    it('does NOT flag method with returns="this is T"', () => {
      const source = `
service name=UserService
  method name=isAdmin params="" returns="this is AdminUser"
    handler <<<
      return (this as any).role === "admin";
    >>>
`;
      const report = reviewKernSource(source, 'method-thisis.kern');
      expect(report.findings.some((f) => f.ruleId === 'this-is-outside-class')).toBe(false);
    });

    it('does NOT flag fn with explicit this: parameter (Codex P2)', () => {
      const source = `
fn name=isAdmin params="this:User" returns="this is Admin"
  handler <<<
    return this.role === "admin";
  >>>
`;
      const report = reviewKernSource(source, 'fn-thisparam.kern');
      expect(report.findings.some((f) => f.ruleId === 'this-is-outside-class')).toBe(false);
    });

    it('flags getter with returns="this is T" (Codex P2)', () => {
      const source = `
service name=UserService
  getter name=isAdmin returns="this is AdminUser"
    handler <<<
      return (this as any).role === "admin";
    >>>
`;
      const report = reviewKernSource(source, 'getter-thisis.kern');
      const finding = report.findings.find((f) => f.ruleId === 'this-is-outside-class');
      expect(finding).toBeDefined();
    });

    it('does NOT flag fn with non-this type predicate "x is T"', () => {
      const source = `
fn name=isAdmin params="x:User" returns="x is Admin"
  handler <<<
    return x.role === "admin";
  >>>
`;
      const report = reviewKernSource(source, 'xis.kern');
      expect(report.findings.some((f) => f.ruleId === 'this-is-outside-class')).toBe(false);
    });
  });

  describe('multiple-string-indexers', () => {
    it('flags interface with two string-keyed indexers', () => {
      const source = `
interface name=Bag
  indexer keyName=k keyType=string type=string
  indexer keyName=k2 keyType=string type=number
`;
      const report = reviewKernSource(source, 'bag.kern');
      const finding = report.findings.find((f) => f.ruleId === 'multiple-string-indexers');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('error');
      expect(finding?.message).toContain('Bag');
      expect(finding?.message).toContain('2');
    });

    it('does NOT flag interface with one string and one number indexer', () => {
      const source = `
interface name=Mixed
  indexer keyName=k keyType=string type=string
  indexer keyName=i keyType=number type=string
`;
      const report = reviewKernSource(source, 'mixed.kern');
      expect(report.findings.some((f) => f.ruleId === 'multiple-string-indexers')).toBe(false);
    });

    it('does NOT flag interface with a single string indexer', () => {
      const source = `
interface name=Solo
  indexer keyName=k keyType=string type=string
`;
      const report = reviewKernSource(source, 'solo.kern');
      expect(report.findings.some((f) => f.ruleId === 'multiple-string-indexers')).toBe(false);
    });
  });

  describe('trailing-pipe-enum', () => {
    it('hints at trailing pipe in values (info/style severity per Codex P2)', () => {
      const source = `
type name=Status values="active|inactive|"
`;
      const report = reviewKernSource(source, 'status.kern');
      const finding = report.findings.find((f) => f.ruleId === 'trailing-pipe-enum');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('info');
      expect(finding?.category).toBe('style');
      expect(finding?.message).toContain('Status');
      expect(finding?.message).toContain('trailing');
    });

    it('hints at leading pipe in values', () => {
      const source = `
type name=Mode values="|read|write"
`;
      const report = reviewKernSource(source, 'mode.kern');
      const finding = report.findings.find((f) => f.ruleId === 'trailing-pipe-enum');
      expect(finding).toBeDefined();
      expect(finding?.message).toContain('leading');
    });

    it('hints at double pipe in values', () => {
      const source = `
type name=Phase values="init||done"
`;
      const report = reviewKernSource(source, 'phase.kern');
      const finding = report.findings.find((f) => f.ruleId === 'trailing-pipe-enum');
      expect(finding).toBeDefined();
      expect(finding?.message).toContain('empty middle');
    });

    it('does NOT hint on well-formed values', () => {
      const source = `
type name=Status values="active|inactive|banned"
`;
      const report = reviewKernSource(source, 'ok.kern');
      expect(report.findings.some((f) => f.ruleId === 'trailing-pipe-enum')).toBe(false);
    });
  });
});
