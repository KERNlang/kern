/** SPEC — express DX fix ②: server `port` is env-parameterizable.
 *
 * The generated express shell must read the port from `process.env.PORT` with
 * the KERN-declared literal as a fallback, so the emitted server deploys to any
 * host that injects PORT without hand-editing generated code. Env vars are
 * strings, so the value must be coerced to a number.
 */

async function transpileShell(lines: string[]): Promise<string> {
  const { parse } = await import('../../core/src/parser.js');
  const { transpileExpress } = await import('../src/transpiler-express.js');
  return transpileExpress(parse(lines.join('\n'))).code;
}

const ROUTE = ['  route method=get path=/a', '    handler <<<', '      res.json({ ok: true })', '    >>>'];

describe('Express server port is env-parameterizable', () => {
  test('explicit port becomes a process.env.PORT fallback, not a bare literal', async () => {
    const code = await transpileShell(['server name=API port=8765', ...ROUTE]);
    // reads the env
    expect(code).toContain('process.env.PORT');
    // env vars are strings → coerced to a number
    expect(code).toMatch(/Number\(process\.env\.PORT\)/);
    // still honours the KERN-declared literal as the fallback
    expect(code).toMatch(/8765/);
    // FAILURE CASE: must NOT emit the old bare, non-deployable literal
    expect(code).not.toMatch(/const port = 8765;/);
  });

  test('omitted port defaults to 3000 behind the same env fallback', async () => {
    const code = await transpileShell(['server name=API', ...ROUTE]);
    expect(code).toContain('process.env.PORT');
    expect(code).toMatch(/3000/);
    expect(code).not.toMatch(/const port = 3000;/);
  });
});
