import { reviewSource } from '../src/index.js';

describe('AST-based Taint Analysis', () => {
  it('should detect simple taint flow from param to sink', () => {
    const source = `
      export function handler(req: any) {
        const cmd = req.body.command;
        exec(cmd);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));

    expect(taintFindings.length).toBeGreaterThan(0);
    expect(taintFindings[0].message).toContain('req (HTTP input)');
    expect(taintFindings[0].message).toContain('exec()');
  });

  it('should detect taint through destructuring', () => {
    const source = `
      export function handler(request: Request) {
        const { query } = request;
        const { id } = query;
        eval(id);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));

    expect(taintFindings.length).toBeGreaterThan(0);
    expect(taintFindings[0].message).toContain('request (HTTP input)');
    expect(taintFindings[0].message).toContain('eval()');
  });

  it('should handle sanitizers correctly', () => {
    const source = `
      export function handler(req: any) {
        const id = parseInt(req.query.id);
        db.query(\`SELECT * FROM users WHERE id = \${id}\`);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));

    // parseInt is sufficient for SQL injection on numeric IDs
    expect(taintFindings.length).toBe(0);
  });

  it('should detect insufficient sanitizers', () => {
    const source = `
      export function handler(req: any) {
        const cmd = parseInt(req.query.cmd);
        exec(cmd);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId === 'taint-insufficient-sanitizer');

    expect(taintFindings.length).toBe(1);
    expect(taintFindings[0].message).toContain("parseInt' does not protect against command injection");
  });
});
