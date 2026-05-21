/** SPEC — slice 4c: portable `stream` body → Express SSE (no raw JS).
 *
 * A `stream` whose body is `derive`/`let`/`fanout`/`each await`/`emit` lowers
 * to the same SSE scaffold the raw handler used (`emit()` helper, heartbeat,
 * finally `[DONE]`), but generates the fan-out + async-iteration + abort
 * plumbing from the nodes. Asserts the generated TS shape and that the legacy
 * raw-handler stream path is unchanged.
 */

async function transpile(lines: string[]): Promise<string> {
  const { parse } = await import('../../core/src/parser.js');
  const { transpileExpress } = await import('../src/transpiler-express.js');
  const result = transpileExpress(parse(lines.join('\n')));
  const art = (result.artifacts ?? []).find(
    (a: { path: string }) => a.path.includes('review') || a.path.includes('ticks'),
  );
  if (!art)
    throw new Error(`no stream route artifact; have: ${(result.artifacts ?? []).map((a: any) => a.path).join(', ')}`);
  return art.content;
}

describe('Portable stream body → Express SSE', () => {
  const REVIEW = [
    'server name=API port=3002',
    '  route method=post path=/api/review',
    '    schema body="{diff: string}"',
    '    stream',
    '      derive expanded expr={{ registry.expandInstances() }}',
    '      fanout name=config in=expanded',
    '        let name=adapter value="registry.getAdapter(config.id)"',
    '        each await=true name=event in={{ adapter.stream({ userPrompt: body.diff }) }}',
    '          emit value={{ event }}',
  ];

  test('fanout lowers to Promise.allSettled over an async map', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain('await Promise.allSettled(Array.from(expanded).map(async (config) => {');
    expect(code).toContain('const adapter = registry.getAdapter(config.id);');
  });

  test('each await lowers to a for-await loop and emit uses the scaffold helper', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain('for await (const event of adapter.stream({ userPrompt: req.body.diff })) {');
    expect(code).toContain('emit(event);');
  });

  test('portable refs are rewritten (body.diff → req.body.diff)', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain('req.body.diff');
    expect(code).not.toMatch(/[^.]\bbody\.diff/); // no un-prefixed body.diff
  });

  test('guards both the producer and the inner loop via the route-level abort controller', async () => {
    const code = await transpile(REVIEW);
    // producer skip + inner-loop break, both off the scaffold's `ac`
    expect(code).toContain('if (ac.signal.aborted) return;');
    expect(code).toContain('if (ac.signal.aborted) break;');
  });

  test('reuses the SSE scaffold (heartbeat + finally [DONE]) — not a raw handler', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain("'Content-Type': 'text/event-stream',");
    expect(code).toContain('const heartbeat = setInterval(');
    expect(code).toContain("res.write(`data: ${JSON.stringify('[DONE]')}\\n\\n`);");
    expect(code).not.toContain('NotImplementedError');
  });

  test('a plain sequential stream body (no fanout) emits a bare for-await + emit', async () => {
    const code = await transpile([
      'server name=API port=3002',
      '  route method=get path=/api/ticks',
      '    stream',
      '      derive ticks expr={{ clock.ticks() }}',
      '      each await=true name=t in=ticks',
      '        emit value={{ t }} event="tick"',
    ]);
    expect(code).toContain('for await (const t of ticks) {');
    expect(code).toContain("emit(t, 'tick');");
    expect(code).not.toContain('Promise.allSettled');
  });

  test('legacy raw-handler stream path is unchanged (reuses route-level ac, no portable nodes)', async () => {
    const code = await transpile([
      'server name=API port=3002',
      '  route method=post path=/api/review',
      '    stream',
      '      handler <<<',
      '        emit({ hello: 1 });',
      '      >>>',
    ]);
    expect(code).toContain('emit({ hello: 1 });');
  });

  test('reuses the route-level `ac` controller (no redundant second controller)', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain('const ac = new AbortController();');
    expect(code).toContain('if (ac.signal.aborted) return;');
    expect(code).not.toContain('__k_ac');
  });

  test('a stream mixing portable nodes with a raw handler fails loud', async () => {
    await expect(
      transpile([
        'server name=API port=3002',
        '  route method=post path=/api/review',
        '    stream',
        '      emit value={{ x }}',
        '      handler <<< emit(other); >>>',
      ]),
    ).rejects.toThrow(/mixes portable nodes/);
  });
});
