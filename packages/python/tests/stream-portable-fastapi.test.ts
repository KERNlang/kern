/** SPEC — slice 4c: portable `stream` body → FastAPI SSE (no raw JS).
 *
 * `fanout` lowers to an `asyncio.Queue` fan-in: N producer coroutines run under
 * `asyncio.gather(..., return_exceptions=True)` (the analogue of TS
 * `Promise.allSettled`), each putting pre-framed SSE strings; a merge task
 * pushes a sentinel and the generator drains until it. `each await` → `async
 * for` with a `request.is_disconnected()` break; `emit` → a `data:` frame built
 * by string concatenation (NOT an f-string — see the object-literal test).
 * Sequential bodies `yield` directly. Helper names carry a per-stream sequence
 * so sibling fan-outs don't collide.
 */

describe('Portable stream body → FastAPI SSE', () => {
  async function transpile(lines: string[]): Promise<string> {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
    const result = transpileFastAPI(parse(lines.join('\n')));
    const art = (result.artifacts ?? []).find(
      (a: { path: string }) => (a.path.includes('review') || a.path.includes('ticks')) && a.path.endsWith('.py'),
    );
    if (!art)
      throw new Error(`no stream artifact; have: ${(result.artifacts ?? []).map((a: any) => a.path).join(', ')}`);
    return art.content;
  }

  const REVIEW = [
    'server name=API port=8000',
    '  route method=post path=/api/review',
    '    schema body="{diff: string}"',
    '    stream',
    '      derive expanded expr={{ registry.expandInstances() }}',
    '      fanout name=config in=expanded',
    '        let name=adapter value="registry.getAdapter(config.id)"',
    '        each await=true name=event in={{ adapter.stream({ userPrompt: body.diff }) }}',
    '          emit value={{ event }}',
  ];

  test('fanout lowers to an asyncio.Queue fan-in with a gather merge task', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain('__k_q_config_0: asyncio.Queue = asyncio.Queue()');
    expect(code).toContain('async def __k_producer_config_0(config):');
    expect(code).toContain(
      'await asyncio.gather(*[__k_producer_config_0(config) for config in expanded], return_exceptions=True)',
    );
    expect(code).toContain('__k_merge_task_config_0 = asyncio.create_task(__k_merge_config_0())');
  });

  test('the generator drains the queue until the sentinel, then cancels the merge task', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain('__k_event_config_0 = await __k_q_config_0.get()');
    expect(code).toContain('if __k_event_config_0 is __k_done_config_0:');
    expect(code).toContain('yield __k_event_config_0');
    expect(code).toContain('__k_merge_task_config_0.cancel()');
  });

  test('each await → async for with a disconnect break; emit → a queued data frame', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain('async for event in adapter.stream(');
    expect(code).toContain('if await request.is_disconnected():');
    expect(code).toContain('await __k_q_config_0.put("data: " + json.dumps(event) + "\\n\\n")');
  });

  test('body.diff resolves to the Pydantic field and request is injected', async () => {
    const code = await transpile(REVIEW);
    expect(code).toContain('async def post_api_review(request: Request, body: RequestBody):');
    expect(code).toContain('userPrompt": body.diff'); // object-literal value rewritten
    expect(code).toContain('from fastapi import Request');
    expect(code).toContain('import json');
    expect(code).not.toContain('NotImplementedError');
  });

  test('an object-literal emit payload stays valid Python (concatenation, not an f-string)', async () => {
    // Regression for the nested-quote SyntaxError on Python <3.12: a dict
    // payload `{"type": …}` inside an f-string `f"…{json.dumps({"type":…})}…"`
    // reuses the outer quotes and fails to parse. Concatenation avoids it.
    const code = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/review',
      '    stream',
      '      fanout name=config in=expanded',
      '        each await=true name=event in={{ adapter.stream(config) }}',
      '          emit value={{ {type: event.type, data: event.payload} }}',
    ]);
    expect(code).toContain('"data: " + json.dumps({"type": event.type, "data": event.payload}) + "\\n\\n"');
    expect(code).not.toMatch(/f"data: \{json\.dumps\(\{/); // no f-string wrapping a dict
  });

  test('sibling fan-outs sharing a loop-var name get distinct helper suffixes', async () => {
    const code = await transpile([
      'server name=API port=8000',
      '  route method=post path=/api/review',
      '    stream',
      '      fanout name=item in=groupA',
      '        each await=true name=e in={{ src(item) }}',
      '          emit value={{ e }}',
      '      fanout name=item in=groupB',
      '        each await=true name=e in={{ src(item) }}',
      '          emit value={{ e }}',
    ]);
    expect(code).toContain('__k_q_item_0');
    expect(code).toContain('__k_q_item_1');
  });

  test('a stream mixing portable nodes with a raw handler fails loud', async () => {
    await expect(
      transpile([
        'server name=API port=8000',
        '  route method=post path=/api/review',
        '    stream',
        '      emit value={{ x }}',
        '      handler <<< something(); >>>',
      ]),
    ).rejects.toThrow(/mixes portable nodes/);
  });

  test('a sequential stream body (no fanout) yields directly with an event name', async () => {
    const code = await transpile([
      'server name=API port=8000',
      '  route method=get path=/api/ticks',
      '    stream',
      '      derive ticks expr={{ clock.ticks() }}',
      '      each await=true name=t in=ticks',
      '        emit value={{ t }} event="tick"',
    ]);
    expect(code).toContain('async for t in ticks:');
    expect(code).toContain('yield "event: tick\\ndata: " + json.dumps(t) + "\\n\\n"');
    expect(code).not.toContain('asyncio.gather');
    expect(code).toContain('yield "data: [DONE]\\n\\n"');
  });
});
