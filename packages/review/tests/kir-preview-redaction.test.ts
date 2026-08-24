import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewKernModuleSets } from '@kernlang/review/kir-preview';
import { diffCanonicalKirFacts } from '../src/kir-preview/diff.js';
import { buildCanonicalKirFactModel } from '../src/kir-preview/facts.js';
import type { CanonicalValue, StructuralKirNodeView } from '../src/kir-preview/model.js';
import type { KernReviewTargetProfile } from '../src/kir-preview/types.js';

const profile: KernReviewTargetProfile = {
  format: 'kern.review.target-profile.1',
  id: 'redaction-test',
  version: 1,
  unsupportedCapabilities: [],
};

function text(value: string): CanonicalValue {
  return { tag: 'text', value };
}

function expression(kind: string, fields: Record<string, CanonicalValue>): CanonicalValue {
  return {
    tag: 'record',
    value: [
      {
        key: 'fields',
        value: {
          tag: 'record',
          value: Object.entries(fields).map(([key, value]) => ({ key, value })),
        },
      },
      { key: 'kind', value: text(kind) },
    ],
  };
}

function node(
  kind: string,
  properties: Record<string, CanonicalValue>,
  children: readonly StructuralKirNodeView[] = [],
): StructuralKirNodeView {
  return {
    kind,
    properties: Object.entries(properties).map(([key, value]) => ({
      key,
      value,
    })),
    children,
  };
}

function artifact(callValue: string, numericValue: string, thrownValue: string) {
  const call = expression('call', {
    args: {
      tag: 'list',
      value: [expression('text', { value: text(callValue) })],
    },
    callee: expression('identifier', { name: text('fetchUser') }),
  });
  const thrown = expression('new', {
    args: {
      tag: 'list',
      value: [expression('text', { value: text(thrownValue) })],
    },
    constructor: text('Error'),
  });
  const numeric = expression('integer', { value: text(numericValue) });
  return {
    modules: [
      {
        id: 'sensitive.kern',
        exports: [
          { kind: 'class' as const, name: 'Dashboard', source: null },
          { kind: 'fn' as const, name: 'main', source: null },
        ],
        imports: [],
        roots: [
          node('class', { name: text('Dashboard') }, [node('field', { name: text('route'), value: numeric })]),
          node('fn', { name: text('main') }, [node('return', { value: call }), node('throw', { value: thrown })]),
        ],
      },
    ],
  } as unknown as Parameters<typeof buildCanonicalKirFactModel>[0];
}

function source(callValue: string, numericValue: string, thrownValue: string): string {
  return [
    'fn name=main export=true',
    '  handler lang="kern"',
    `    return value="fetchUser(\\"${callValue}\\")"`,
    '',
    'fn name=effects export=true',
    '  handler lang="kern"',
    `    throw value="new Error(\\"${thrownValue}\\")"`,
    '',
    'class name=Dashboard export=true',
    `  field name=route value="${numericValue}"`,
    '',
  ].join('\n');
}

test('canonical findings redact changed literal contents while retaining shape and digest evidence', () => {
  const sensitive = [
    'tenant-secret-before',
    'tenant-secret-after',
    '700000000001',
    '700000000002',
    'throw-secret-before',
    'throw-secret-after',
  ];
  const base = buildCanonicalKirFactModel(
    artifact(sensitive[0] as string, sensitive[2] as string, sensitive[4] as string),
    profile,
  );
  const head = buildCanonicalKirFactModel(
    artifact(sensitive[1] as string, sensitive[3] as string, sensitive[5] as string),
    profile,
  );
  const findings = diffCanonicalKirFacts(base, head);

  assert.ok(findings.length > 0);
  const serialized = JSON.stringify(findings);
  for (const literal of sensitive) assert.doesNotMatch(serialized, new RegExp(literal));
  assert.match(serialized, /fetchUser/u, 'call targets remain useful identifiers');
  assert.match(serialized, /Error/u, 'constructor identifiers remain useful');
  assert.match(serialized, /sha256:[0-9a-f]{64}/u, 'redacted literals retain deterministic digest identity');
  assert.deepEqual(findings, diffCanonicalKirFacts(base, head), 'redacted output remains deterministic');
});

test('public canonical review results do not serialize changed literal contents', async () => {
  const sensitive = [
    'public-secret-before',
    'public-secret-after',
    '800000000001',
    '800000000002',
    'public-throw-before',
    'public-throw-after',
  ];
  const result = await reviewKernModuleSets({
    base: {
      modules: [
        {
          moduleId: 'sensitive.kern',
          source: source(sensitive[0] as string, sensitive[2] as string, sensitive[4] as string),
        },
      ],
    },
    head: {
      modules: [
        {
          moduleId: 'sensitive.kern',
          source: source(sensitive[1] as string, sensitive[3] as string, sensitive[5] as string),
        },
      ],
    },
    mode: 'canonical-kir-preview',
  });

  assert.equal(result.status, 'complete');
  assert.ok(result.findings.length > 0);
  const serialized = JSON.stringify(result);
  for (const literal of sensitive) assert.doesNotMatch(serialized, new RegExp(literal));
  assert.match(serialized, /fetchUser/u);
  assert.match(serialized, /sha256:[0-9a-f]{64}/u);
});
