import { reviewKernSource } from '../src/index.js';

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
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('file tokens');
  });

  it('reports missing confidence when none is present and suppresses it when confidence exists', () => {
    const source = `
fn name=loadUser params="id:string" returns=unknown
  handler <<<
    const response = await fetch("/api/users/" + id);
    return response.json();
  >>>
`;
    const report = reviewKernSource(source, 'confidence-missing.kern');
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
    const annotatedReport = reviewKernSource(annotatedSource, 'confidence-present.kern');
    expect(annotatedReport.findings.some((f) => f.ruleId === 'missing-confidence')).toBe(false);
  });
});
