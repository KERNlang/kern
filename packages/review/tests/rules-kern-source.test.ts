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
});
