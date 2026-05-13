import { generateUnion } from '../src/codegen/type-system.ts';
import { parse } from '../src/parser.js';
import { validateSchema } from '../src/schema.js';
import type { IRNode } from '../src/types.js';

function findUnion(root: IRNode): IRNode {
  const u = (root.children ?? []).find((c) => c.type === 'union');
  if (!u) throw new Error('expected union in test source');
  return u;
}

describe('union discriminant inference + actionable diagnostic', () => {
  test('infers `kind` when all variant target interfaces share a single literal field', () => {
    const source = [
      'interface name=TextPart',
      '  field name=kind type=\'"text"\'',
      '  field name=text type=string',
      'interface name=ToolCallPart',
      '  field name=kind type=\'"tool_call"\'',
      '  field name=name type=string',
      'union name=MessagePart',
      '  variant type=TextPart',
      '  variant type=ToolCallPart',
    ].join('\n');

    const root = parse(source);
    const violations = validateSchema(root);
    expect(violations.filter((v) => /discriminant/.test(v.message))).toEqual([]);
    const union = findUnion(root);
    expect(union.props?.discriminant).toBe('kind');
  });

  test('explicit discriminant survives inference (no overwrite)', () => {
    const source = [
      'interface name=A',
      '  field name=kind type=\'"a"\'',
      '  field name=value type=string',
      'interface name=B',
      '  field name=kind type=\'"b"\'',
      'union name=AB discriminant=kind',
      '  variant type=A',
      '  variant type=B',
    ].join('\n');

    const root = parse(source);
    expect(validateSchema(root).filter((v) => /discriminant/.test(v.message))).toEqual([]);
    expect(findUnion(root).props?.discriminant).toBe('kind');
  });

  test('actionable diagnostic when multiple literal fields are shared (ambiguous)', () => {
    const source = [
      'interface name=A',
      '  field name=kind type=\'"a"\'',
      '  field name=tag type=\'"alpha"\'',
      '  field name=value type=string',
      'interface name=B',
      '  field name=kind type=\'"b"\'',
      '  field name=tag type=\'"beta"\'',
      'union name=AB',
      '  variant type=A',
      '  variant type=B',
    ].join('\n');

    const root = parse(source);
    const violations = validateSchema(root);
    const discrim = violations.find((v) => /requires discriminant=/.test(v.message));
    expect(discrim).toBeDefined();
    // Lists both ambiguous candidates rather than just "requires prop discriminant".
    expect(discrim?.message).toMatch(/likely discriminants:.*kind/);
    expect(discrim?.message).toMatch(/likely discriminants:.*tag/);
    // The scratch prop was stripped after diagnostic emission.
    expect(findUnion(root).props).not.toHaveProperty('__discriminantCandidates');
  });

  test('clear diagnostic when no shared literal field exists', () => {
    const source = [
      'interface name=A',
      '  field name=value type=string',
      'interface name=B',
      '  field name=label type=string',
      'union name=AB',
      '  variant type=A',
      '  variant type=B',
    ].join('\n');

    const root = parse(source);
    const violations = validateSchema(root);
    const discrim = violations.find((v) => /requires discriminant=/.test(v.message));
    expect(discrim).toBeDefined();
    expect(discrim?.message).toMatch(/set explicitly/);
  });

  test('does NOT infer when one resolved variant has no literal-typed fields', () => {
    // Codex review fix: a previous `continue` let `shared` keep `kind` even
    // when variant B had no literal fields at all — silently inferring a
    // discriminant that the variants don't actually share. The corrected
    // behaviour fails inference and surfaces the missing-discriminant
    // diagnostic instead.
    const source = [
      'interface name=A',
      '  field name=kind type=\'"a"\'',
      'interface name=B',
      '  field name=value type=string',
      'interface name=anyValue',
      '  field name=label type=string',
      'union name=AB',
      '  variant type=A',
      '  variant type=B',
    ].join('\n');

    const root = parse(source);
    const violations = validateSchema(root);
    // Inference must NOT have set a discriminant — the required-prop
    // diagnostic should fire.
    expect(findUnion(root).props?.discriminant).toBeUndefined();
    const discrim = violations.find((v) => /requires discriminant=/.test(v.message));
    expect(discrim).toBeDefined();
  });

  test('inferred discriminant emits identical TS to explicit discriminant', () => {
    const explicitSource = [
      'interface name=TextPart',
      '  field name=kind type=\'"text"\'',
      '  field name=text type=string',
      'interface name=ToolCallPart',
      '  field name=kind type=\'"tool_call"\'',
      'union name=MessagePart discriminant=kind',
      '  variant type=TextPart',
      '  variant type=ToolCallPart',
    ].join('\n');
    const inferredSource = explicitSource.replace('union name=MessagePart discriminant=kind', 'union name=MessagePart');

    const explicitRoot = parse(explicitSource);
    validateSchema(explicitRoot);
    const inferredRoot = parse(inferredSource);
    validateSchema(inferredRoot);

    const explicitTs = generateUnion(findUnion(explicitRoot)).join('\n');
    const inferredTs = generateUnion(findUnion(inferredRoot)).join('\n');
    expect(inferredTs).toBe(explicitTs);
  });
});
