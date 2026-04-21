import { reviewKernSource } from '../src/index.js';

function setterCollisions(source: string) {
  const report = reviewKernSource(source, 'input.kern');
  return report.findings.filter((f) => f.ruleId === 'set-setter-name-collision');
}

describe('set-setter-name-collision rule', () => {
  it('flags both sites when the same name is bound as setter and state', () => {
    const source = `
class name=Store
  field name=value type=string
  setter name=value params="v:string"
    handler <<<
      this._value = v;
    >>>

screen name=Panel
  state name=value type=string initial="''"
  on event=change
    set name=value
      handler <<<
        return "new";
      >>>
`;
    const findings = setterCollisions(source);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const messages = findings.map((f) => f.message);
    for (const m of messages) {
      expect(m).toContain('setter name=value');
      expect(m).toContain('state name=value');
      expect(m).toContain('set value(v)');
      expect(m).toContain('setValue(v)');
    }
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].suggestion).toContain('Pick the spelling');
  });

  it('does not fire when only a class setter is declared (no matching state)', () => {
    const source = `
class name=Store
  field name=value type=string
  setter name=value params="v:string"
    handler <<<
      this._value = v;
    >>>
`;
    expect(setterCollisions(source)).toHaveLength(0);
  });

  it('does not fire when only a state is declared (no matching class setter)', () => {
    const source = `
screen name=Panel
  state name=value type=string initial="''"
`;
    expect(setterCollisions(source)).toHaveLength(0);
  });

  it('does not fire when setter and state use distinct names', () => {
    const source = `
class name=Store
  field name=stored type=string
  setter name=stored params="v:string"
    handler <<<
      this._stored = v;
    >>>

screen name=Panel
  state name=viewed type=string initial="''"
`;
    expect(setterCollisions(source)).toHaveLength(0);
  });

  it('fires once per colliding name even with multiple state or setter sites', () => {
    const source = `
class name=A
  setter name=x params="v:string"
    handler <<< this._x = v; >>>
class name=B
  setter name=x params="v:string"
    handler <<< this._x = v; >>>

screen name=Panel
  state name=x type=string initial="''"
`;
    const findings = setterCollisions(source);
    // Two setter sites + one state site = 3 findings with the same name
    expect(findings).toHaveLength(3);
  });
});
