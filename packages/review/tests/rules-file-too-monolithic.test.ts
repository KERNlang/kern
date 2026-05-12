import { reviewKernSource } from '../src/index.js';

function monolithFindings(source: string, filePath = 'src/app.kern') {
  const report = reviewKernSource(source, filePath);
  return report.findings.filter((f) => f.ruleId === 'file-too-monolithic');
}

function fnDecl(n: number): string {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(`fn name=fn${i} returns=void`);
    out.push('  handler <<<');
    out.push(`    return; // ${i}`);
    out.push('  >>>');
  }
  return out.join('\n');
}

function oversizedHandlerFn(name: string, bodyLines = 35): string {
  const body: string[] = [];
  for (let i = 0; i < bodyLines; i++) {
    body.push(`    const x${i} = ${i};`);
  }
  return [`fn name=${name} returns=void`, '  handler <<<', ...body, '  >>>'].join('\n');
}

describe('file-too-monolithic rule', () => {
  it('does not fire for small files (under floor of 3 concerns)', () => {
    const source = fnDecl(2);
    expect(monolithFindings(source)).toHaveLength(0);
  });

  it('does not fire at the threshold (12 ungrouped concerns)', () => {
    const source = fnDecl(12);
    expect(monolithFindings(source)).toHaveLength(0);
  });

  it('fires when ungrouped concerns exceed the threshold', () => {
    const source = fnDecl(13);
    const findings = monolithFindings(source);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].category).toBe('structure');
    expect(findings[0].message).toContain('13 top-level concern declarations');
    expect(findings[0].message).toContain('limit is 12');
    expect(findings[0].suggestion).toContain('module Name');
  });

  it('emits one finding per file regardless of how far above threshold', () => {
    const source = fnDecl(25);
    expect(monolithFindings(source)).toHaveLength(1);
  });

  it('breakdown lists concern types in the message', () => {
    const parts: string[] = [];
    for (let i = 1; i <= 8; i++) parts.push(`fn name=fn${i} returns=void\n  handler <<< return; >>>`);
    for (let i = 1; i <= 5; i++) parts.push(`route name=GET /r${i}\n  handler <<< return; >>>`);
    const findings = monolithFindings(parts.join('\n'));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toMatch(/8 fns/);
    expect(findings[0].message).toMatch(/5 routes/);
  });

  it('excludes declarations inside a module block from the count', () => {
    const moduleBlock = [
      'module name=domain',
      ...Array.from({ length: 10 }, (_, i) =>
        [`  fn name=mfn${i} returns=void`, '    handler <<< return; >>>'].join('\n'),
      ),
    ].join('\n');
    const looseFns = fnDecl(5);
    const source = `${moduleBlock}\n${looseFns}`;
    expect(monolithFindings(source)).toHaveLength(0);
  });

  it('fires when even after module grouping the ungrouped count is over threshold', () => {
    const moduleBlock = [
      'module name=domain',
      ...Array.from({ length: 5 }, (_, i) =>
        [`  fn name=mfn${i} returns=void`, '    handler <<< return; >>>'].join('\n'),
      ),
    ].join('\n');
    const looseFns = fnDecl(13);
    const source = `${moduleBlock}\n${looseFns}`;
    const findings = monolithFindings(source);
    expect(findings).toHaveLength(1);
    expect(findings[0].suggestion).toContain('already uses 1 module');
  });

  it('escalates threshold to 10 when ≥3 handlers exceed handler-size limit', () => {
    const oversized = [oversizedHandlerFn('big1'), oversizedHandlerFn('big2'), oversizedHandlerFn('big3')].join('\n');
    const small = fnDecl(8);
    const source = `${oversized}\n${small}`;
    const findings = monolithFindings(source);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Threshold tightened to 10');
    expect(findings[0].message).toContain('3 handlers');
  });

  it('does not escalate when only 2 handlers exceed handler-size', () => {
    const oversized = [oversizedHandlerFn('big1'), oversizedHandlerFn('big2')].join('\n');
    const small = fnDecl(9); // total = 11, under default threshold of 12, escalation would push to 10
    const source = `${oversized}\n${small}`;
    expect(monolithFindings(source)).toHaveLength(0);
  });

  it('skips test files (*.test.kern)', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'src/foo.test.kern')).toHaveLength(0);
  });

  it('skips spec files (*.spec.kern)', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'src/foo.spec.kern')).toHaveLength(0);
  });

  it('skips fixture files (*.fixture.kern)', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'src/foo.fixture.kern')).toHaveLength(0);
  });

  it('skips files under a /tests/ directory', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'pkg/tests/big.kern')).toHaveLength(0);
  });

  it('skips files under a /__generated__/ directory', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'pkg/__generated__/api.kern')).toHaveLength(0);
  });

  it('skips files under a /fixtures/ directory', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'pkg/fixtures/sample.kern')).toHaveLength(0);
  });

  it('skips barrel-style entrypoints (index.kern)', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'src/feature/index.kern')).toHaveLength(0);
  });

  it('skips barrel.kern and _entry.kern by basename', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'src/barrel.kern')).toHaveLength(0);
    expect(monolithFindings(source, 'src/_entry.kern')).toHaveLength(0);
  });

  it('handles Windows-style paths for carve-outs', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'src\\__generated__\\api.kern')).toHaveLength(0);
    expect(monolithFindings(source, 'src\\foo.test.kern')).toHaveLength(0);
  });

  it('counts a mix of concern types — fn, screen, route, service, handler', () => {
    const source = [
      'fn name=a returns=void\n  handler <<< return; >>>',
      'fn name=b returns=void\n  handler <<< return; >>>',
      'fn name=c returns=void\n  handler <<< return; >>>',
      'route name=GET /r1\n  handler <<< return; >>>',
      'route name=GET /r2\n  handler <<< return; >>>',
      'screen name=S1\n  render <<< return null; >>>',
      'screen name=S2\n  render <<< return null; >>>',
      'screen name=S3\n  render <<< return null; >>>',
      'service name=Svc1',
      'service name=Svc2',
      'fn name=d returns=void\n  handler <<< return; >>>',
      'fn name=e returns=void\n  handler <<< return; >>>',
      'fn name=f returns=void\n  handler <<< return; >>>',
    ].join('\n');
    const findings = monolithFindings(source);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('13 top-level concern declarations');
  });

  it('counts exported top-level declarations (export fn — loc.col is 8, not 1)', () => {
    // Regression: codex review caught that `export fn` declarations have loc.col=8
    // (after "export " prefix), so a loc.col===1 filter alone misses them entirely.
    const out: string[] = [];
    for (let i = 1; i <= 13; i++) {
      out.push(`export fn name=ef${i} returns=void`);
      out.push('  handler <<< return; >>>');
    }
    const findings = monolithFindings(out.join('\n'));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('13 top-level concern declarations');
  });

  it('skips files under a relative tests/ directory (no leading slash)', () => {
    // Regression: gemini review caught that '/tests/' substring fails for paths
    // like 'tests/app.kern' that have no leading slash.
    const source = fnDecl(20);
    expect(monolithFindings(source, 'tests/app.kern')).toHaveLength(0);
    expect(monolithFindings(source, 'fixtures/big.kern')).toHaveLength(0);
    expect(monolithFindings(source, '__generated__/api.kern')).toHaveLength(0);
  });

  it('skips *.generated.kern and *.gen.kern files', () => {
    const source = fnDecl(20);
    expect(monolithFindings(source, 'src/api.generated.kern')).toHaveLength(0);
    expect(monolithFindings(source, 'src/types.gen.kern')).toHaveLength(0);
  });

  it('does not count non-concern top-level nodes (use, import, type, const)', () => {
    const source = [
      'use path="./other.kern"',
      '  from name=Helper',
      'import from=react names=React',
      'type name=User alias=string',
      'const name=BASE_URL value="\'https://api.example\'"',
      fnDecl(5),
    ].join('\n');
    expect(monolithFindings(source)).toHaveLength(0);
  });
});
