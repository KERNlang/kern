import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import type { CanonicalValue, CanonicalValueLimits } from '../src/canonical-value/types.js';
import { decodeKirEvidence, encodeKirEvidence } from '../src/kir-evidence/canonical.js';
import { KirEvidenceError, type KirEvidenceInput } from '../src/kir-evidence/types.js';
import { encodeModuleKir } from '../src/kir-structural/module-canonical.js';
import type { ModuleKirInput } from '../src/kir-structural/module-types.js';

const limits: CanonicalValueLimits = {
  maxBytes: 262_144,
  maxDepth: 64,
  maxNodes: 4_096,
  maxStringBytes: 8_192,
  maxCollectionLength: 1_024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};

const source = '# π\nfn name=main export=true\n  handler lang=ts\n    let name=result value=null\n';

function modules(name = 'main'): ModuleKirInput[] {
  return [
    {
      id: 'main.kern',
      roots: [
        {
          type: 'fn',
          props: { export: true, name },
          children: [
            {
              type: 'handler',
              props: { lang: 'ts' },
              children: [{ type: 'let', props: { name: 'result', value: { __expr: true, code: 'null' } } }],
            },
          ],
        },
      ],
    },
  ];
}

function byteRange(content: string): readonly [number, number] {
  const characterOffset = source.indexOf(content);
  if (characterOffset < 0) throw new Error(`missing fixture content ${content}`);
  const encoder = new TextEncoder();
  const start = encoder.encode(source.slice(0, characterOffset)).length;
  return [start, start + encoder.encode(content).length];
}

function fixture(overrides: Partial<KirEvidenceInput> = {}): KirEvidenceInput {
  const semanticBytes = encodeModuleKir(modules(), limits);
  const [nodeStart, nodeEnd] = byteRange('fn name=main export=true');
  const [expressionStart, expressionEnd] = byteRange('null');
  return {
    semanticBytes,
    sources: [{ moduleId: 'main.kern', source }],
    spans: [
      {
        content: 'fn name=main export=true',
        endByte: nodeEnd,
        id: 'main-function',
        moduleId: 'main.kern',
        nodePath: [0],
        propertyKey: null,
        startByte: nodeStart,
      },
      {
        content: 'null',
        endByte: expressionEnd,
        id: 'null-expression',
        moduleId: 'main.kern',
        nodePath: [0, 0, 0],
        propertyKey: 'value',
        startByte: expressionStart,
      },
    ],
    diagnostics: [
      {
        category: 'validator',
        code: 'null-result',
        id: 'null-result-warning',
        message: 'The result is statically null.',
        moduleId: 'main.kern',
        severity: 'warning',
        spanId: 'null-expression',
      },
    ],
    ...overrides,
  };
}

function expectEvidenceCode(action: () => unknown, code: KirEvidenceError['code']): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(KirEvidenceError);
    expect((error as KirEvidenceError).code).toBe(code);
  }
}

function recordField(value: CanonicalValue, key: string): CanonicalValue {
  if (value.tag !== 'record') throw new Error(`expected record containing ${key}`);
  const field = value.value.find((entry) => entry.key === key)?.value;
  if (field === undefined) throw new Error(`missing field ${key}`);
  return field;
}

function listItem(value: CanonicalValue, index: number): CanonicalValue {
  if (value.tag !== 'list' || value.value[index] === undefined) throw new Error(`missing list item ${index}`);
  return value.value[index];
}

function mutateEvidence(bytes: Uint8Array, mutation: (value: CanonicalValue) => void): Uint8Array {
  const value = structuredClone(decodeCanonicalValue(bytes, limits));
  mutation(value);
  return encodeCanonicalValue(value, limits);
}

describe('internal KIR diagnostic and location evidence', () => {
  test('round-trips canonical non-ASCII source, node/expression spans, and diagnostics', () => {
    const input = fixture();
    const bytes = encodeKirEvidence(input, { limits });
    const artifact = decodeKirEvidence(bytes, input.semanticBytes, input.sources, { limits });
    expect(artifact.format).toBe('kern.kir.evidence.r1.5d.1-alpha');
    expect(artifact.proofLabel).toBe('ALPHA-NO-GO');
    expect(artifact.sources).toHaveLength(1);
    expect(artifact.spans.map((span) => span.id)).toEqual(['main-function', 'null-expression']);
    expect(artifact.diagnostics.map((diagnostic) => diagnostic.id)).toEqual(['null-result-warning']);
    expect(encodeCanonicalValue(decodeCanonicalValue(bytes, limits), limits)).toEqual(bytes);
  });

  test('requires zero-based half-open UTF-8 byte offsets instead of UTF-16 offsets', () => {
    const input = fixture();
    const expression = input.spans[1];
    if (!expression) throw new Error('missing expression span');
    const utf16Start = source.indexOf(expression.content);
    expect(utf16Start).not.toBe(expression.startByte);
    expectEvidenceCode(
      () =>
        encodeKirEvidence(
          {
            ...input,
            spans: [
              input.spans[0] as KirEvidenceInput['spans'][number],
              {
                ...expression,
                startByte: utf16Start,
                endByte: utf16Start + expression.content.length,
              },
            ],
          },
          { limits },
        ),
      'invalid-span',
    );
  });

  test('rejects unsupported versions, unknown fields, and reordered or duplicate rows', () => {
    const input = fixture();
    const bytes = encodeKirEvidence(input, { limits });
    const version = mutateEvidence(bytes, (value) => {
      const format = recordField(value, 'format');
      if (format.tag !== 'text') throw new Error('expected format');
      format.value = 'kern.kir.evidence.future';
    });
    expectEvidenceCode(
      () => decodeKirEvidence(version, input.semanticBytes, input.sources, { limits }),
      'unsupported-evidence-version',
    );

    const unknown = mutateEvidence(bytes, (value) => {
      if (value.tag !== 'record') throw new Error('expected artifact');
      value.value.push({ key: 'unknown', value: { tag: 'null' } });
    });
    expectEvidenceCode(
      () => decodeKirEvidence(unknown, input.semanticBytes, input.sources, { limits }),
      'invalid-evidence-artifact',
    );

    const duplicate = mutateEvidence(bytes, (value) => {
      const spans = recordField(value, 'spans');
      if (spans.tag !== 'list' || !spans.value[0]) throw new Error('expected spans');
      spans.value.push(structuredClone(spans.value[0]));
    });
    expectEvidenceCode(
      () => decodeKirEvidence(duplicate, input.semanticBytes, input.sources, { limits }),
      'invalid-evidence-artifact',
    );
  });

  test('rejects bad content, message hashes, ranges, and dangling paths', () => {
    const input = fixture();
    const bytes = encodeKirEvidence(input, { limits });
    const cases: readonly [(value: CanonicalValue) => void, KirEvidenceError['code']][] = [
      [
        (value) => {
          const content = recordField(listItem(recordField(value, 'spans'), 0), 'content');
          if (content.tag !== 'text') throw new Error('expected content');
          content.value = 'different';
        },
        'invalid-span',
      ],
      [
        (value) => {
          const message = recordField(listItem(recordField(value, 'diagnostics'), 0), 'message');
          if (message.tag !== 'text') throw new Error('expected message');
          message.value = 'wording drift';
        },
        'invalid-diagnostic',
      ],
      [
        (value) => {
          const span = listItem(recordField(value, 'spans'), 0);
          const start = recordField(span, 'startByte');
          const end = recordField(span, 'endByte');
          if (start.tag !== 'int' || end.tag !== 'int') throw new Error('expected offsets');
          start.value = end.value;
        },
        'invalid-span',
      ],
      [
        (value) => {
          const path = recordField(listItem(recordField(value, 'spans'), 0), 'nodePath');
          if (path.tag !== 'list') throw new Error('expected path');
          path.value = [{ tag: 'int', value: '99' }];
        },
        'dangling-span',
      ],
      [
        (value) => {
          const property = recordField(listItem(recordField(value, 'spans'), 1), 'propertyKey');
          if (property.tag !== 'text') throw new Error('expected property');
          property.value = 'missing';
        },
        'dangling-span',
      ],
    ];
    for (const [mutation, code] of cases) {
      expectEvidenceCode(
        () => decodeKirEvidence(mutateEvidence(bytes, mutation), input.semanticBytes, input.sources, { limits }),
        code,
      );
    }
  });

  test('requires expression span bytes to project to the bound structural expression', () => {
    const input = fixture();
    const expression = input.spans[1];
    if (!expression) throw new Error('missing expression span');
    const [startByte, endByte] = byteRange('handler lang=ts');
    expectEvidenceCode(
      () =>
        encodeKirEvidence(
          {
            ...input,
            spans: [input.spans[0]!, { ...expression, content: 'handler lang=ts', startByte, endByte }],
          },
          { limits },
        ),
      'dangling-span',
    );
  });

  test('rejects ambiguous source sets and unsafe writer offsets', () => {
    const input = fixture();
    expectEvidenceCode(
      () => encodeKirEvidence({ ...input, sources: [...input.sources, ...input.sources] }, { limits }),
      'source-binding-mismatch',
    );
    expectEvidenceCode(
      () =>
        encodeKirEvidence({ ...input, spans: [{ ...input.spans[0]!, startByte: 1.5 }, input.spans[1]!] }, { limits }),
      'invalid-span',
    );
  });

  test('binds multi-module sources by canonical module order regardless of input order', () => {
    const input = fixture();
    const root = modules()[0]?.roots[0];
    if (!root) throw new Error('missing module root');
    const semanticBytes = encodeModuleKir(
      [
        { id: 'z.kern', roots: [] },
        { id: 'a.kern', roots: [root] },
      ],
      limits,
    );
    const sources = [
      { moduleId: 'z.kern', source: '' },
      { moduleId: 'a.kern', source },
    ];
    const evidence = encodeKirEvidence(
      {
        ...input,
        semanticBytes,
        sources,
        spans: input.spans.map((span) => ({ ...span, moduleId: 'a.kern' })),
        diagnostics: input.diagnostics.map((diagnostic) => ({ ...diagnostic, moduleId: 'a.kern' })),
      },
      { limits },
    );
    expect(
      decodeKirEvidence(evidence, semanticBytes, sources, { limits }).sources.map((item) => item.moduleId),
    ).toEqual(['a.kern', 'z.kern']);
  });

  test('keeps evidence mutations outside semantic bytes and binds structural mutations', () => {
    const input = fixture();
    const evidence = encodeKirEvidence(input, { limits });
    const messageDrift = fixture({
      semanticBytes: input.semanticBytes,
      diagnostics: [{ ...input.diagnostics[0]!, message: 'Updated evidence wording.' }],
    });
    expect(messageDrift.semanticBytes).toEqual(input.semanticBytes);
    expect(encodeKirEvidence(messageDrift, { limits })).not.toEqual(evidence);

    const [handlerStart, handlerEnd] = byteRange('handler lang=ts');
    const spanDrift = fixture({
      semanticBytes: input.semanticBytes,
      spans: [
        {
          ...input.spans[0]!,
          content: 'handler lang=ts',
          startByte: handlerStart,
          endByte: handlerEnd,
        },
        input.spans[1]!,
      ],
    });
    expect(spanDrift.semanticBytes).toEqual(input.semanticBytes);
    expect(encodeKirEvidence(spanDrift, { limits })).not.toEqual(evidence);

    const changedSemantic = encodeModuleKir(modules('renamed'), limits);
    expect(changedSemantic).not.toEqual(input.semanticBytes);
    expectEvidenceCode(
      () => decodeKirEvidence(evidence, changedSemantic, input.sources, { limits }),
      'semantic-digest-mismatch',
    );
  });
});
