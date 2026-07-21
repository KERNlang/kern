import {
  type ExecuteKernSourceOptions,
  executeKernEntrySource,
  executeKernEntrySourceAsync,
  executeKernSource,
  executeKernSourceAsync,
  type KernRunnerAsyncCapabilities,
} from '../src/runner.js';

const mainEntry = { handler: 'main', kind: 'view', name: 'Budgeted' } as const;

function mainProgram(body: readonly string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...body.map((line) => `    ${line}`)].join('\n');
}

function budgetOptions(iterationBudget: number): ExecuteKernSourceOptions {
  return { iterationBudget };
}

const loopProgram = mainProgram(['for name=i from="0" to="2"', '  print value="i"']);

describe('public runner iteration-budget ownership', () => {
  test('preserves omission compatibility and forwards the exact budget through sync main and entry APIs', () => {
    expect(executeKernSource(loopProgram)).toBe('0\n1\n');
    expect(executeKernEntrySource(loopProgram, mainEntry)).toBe('0\n1\n');

    expect(() => executeKernSource(loopProgram, budgetOptions(1))).toThrow(/budget exhausted/u);
    expect(() => executeKernEntrySource(loopProgram, mainEntry, budgetOptions(1))).toThrow(/budget exhausted/u);

    expect(executeKernSource(loopProgram, budgetOptions(2))).toBe('0\n1\n');
    expect(executeKernEntrySource(loopProgram, mainEntry, budgetOptions(2))).toBe('0\n1\n');
  });

  test('forwards the exact budget through async-to-sync main and entry delegation', async () => {
    await expect(executeKernSourceAsync(loopProgram, budgetOptions(1))).rejects.toThrow(/budget exhausted/u);
    await expect(executeKernEntrySourceAsync(loopProgram, mainEntry, budgetOptions(1))).rejects.toThrow(
      /budget exhausted/u,
    );

    await expect(executeKernSourceAsync(loopProgram, budgetOptions(2))).resolves.toBe('0\n1\n');
    await expect(executeKernEntrySourceAsync(loopProgram, mainEntry, budgetOptions(2))).resolves.toBe('0\n1\n');
  });

  test('forwards the budget through the real async capability lane', async () => {
    const calls: number[] = [];
    const asyncCapabilities: KernRunnerAsyncCapabilities = {
      llm: {
        async complete(call) {
          const prompt = Number((call.input as { readonly prompt?: unknown }).prompt);
          calls.push(prompt);
          return prompt;
        },
      },
    };
    const program = mainProgram([
      'for name=i from="0" to="2"',
      '  capability namespace=llm operation=complete name=answer input="{ prompt: i }"',
      '  print value="answer"',
    ]);
    const options = {
      ...budgetOptions(1),
      asyncCapabilities,
      providedAsyncCapabilities: ['llm.complete'],
    };

    await expect(executeKernSourceAsync(program, options)).rejects.toThrow(/budget exhausted/u);
    expect(calls).toEqual([0]);
    calls.length = 0;

    await expect(executeKernSourceAsync(program, { ...options, ...budgetOptions(2) })).resolves.toBe('0\n1\n');
    expect(calls).toEqual([0, 1]);
  });

  test('admits bounded lambda and reachable helper loops only with caller-owned budgets', () => {
    const lambda = mainProgram(['let name=xs value="[1,2]"', 'lambda expr="List.map(xs, x => x)"']);
    const helper = [
      'fn name=count returns=number',
      '  handler lang="kern"',
      '    let name=total value="0"',
      '    for name=i from="0" to="2"',
      '      assign target=total value="total + 1"',
      '    return value="total"',
      mainProgram(['print value="count()"']),
    ].join('\n');

    expect(executeKernSource(lambda)).toBe('1,2\n');
    expect(() => executeKernSource(lambda, budgetOptions(1))).toThrow(/budget exhausted/u);
    expect(executeKernSource(lambda, budgetOptions(2))).toBe('1,2\n');

    expect(executeKernSource(helper)).toBe('2\n');
    // The helper trampoline retains exhaustion as the normalized leaf error's
    // cause; the public source wrapper intentionally exposes only the leaf.
    expect(() => executeKernSource(helper, budgetOptions(1))).toThrow();
    expect(executeKernSource(helper, budgetOptions(2))).toBe('2\n');
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid budget %p before a capability provider executes',
    (iterationBudget) => {
      let calls = 0;
      const program = mainProgram(['capability namespace=storage operation=get name=value input=""key""']);
      expect(() =>
        executeKernSource(program, {
          ...budgetOptions(iterationBudget),
          capabilities: { storage: { get: () => ++calls } },
        }),
      ).toThrow(/invalid-iteration-budget/u);
      expect(calls).toBe(0);
    },
  );
});
