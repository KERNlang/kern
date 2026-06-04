import {
  lookupPortableLogicPrimitive,
  PORTABLE_LOGIC_PRIMITIVE_IDS,
  type PortableLogicPrimitiveId,
  portableLogicSupportForTarget,
} from '../src/codegen/portable-logic-primitives.js';

describe('portable logic primitive registry', () => {
  test('registers the Job-central R1 primitive surface explicitly', () => {
    expect(PORTABLE_LOGIC_PRIMITIVE_IDS).toEqual([
      'collection.has',
      'time.epochMs',
      'logic.not',
      'object.keys',
      'object.values',
      'object.entries',
      'string.trim',
      'string.split',
      'string.replaceFirst',
      'string.replaceAll',
    ]);
  });

  test('reports per-target support for the current parity slice', () => {
    expect(portableLogicSupportForTarget('collection.has', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('time.epochMs', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('logic.not', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('object.entries', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('string.split', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('string.replaceFirst', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('time.epochMs', 'go')).toBe('unsupported');
    expect(portableLogicSupportForTarget('string.replaceAll', 'go')).toBe('unsupported');
  });

  test('object parity slice has matching target support', () => {
    const objectPrimitives: PortableLogicPrimitiveId[] = ['object.keys', 'object.values', 'object.entries'];
    for (const id of objectPrimitives) {
      expect(portableLogicSupportForTarget(id, 'ts')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'python')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'go')).toBe('unsupported');
    }
  });

  test('string parity slice has matching target support', () => {
    const stringPrimitives: PortableLogicPrimitiveId[] = [
      'string.trim',
      'string.split',
      'string.replaceFirst',
      'string.replaceAll',
    ];
    for (const id of stringPrimitives) {
      expect(portableLogicSupportForTarget(id, 'ts')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'python')).toBe('stable');
      expect(portableLogicSupportForTarget(id, 'go')).toBe('unsupported');
    }
  });

  test('lookup returns null for unknown primitive ids', () => {
    expect(lookupPortableLogicPrimitive('collection.has')?.purity).toBe('pure');
    expect(lookupPortableLogicPrimitive('object.keys')?.hostPatterns).toContain('Object.keys(obj)');
    expect(lookupPortableLogicPrimitive('object.values')?.hostPatterns).toContain('Object.values(obj)');
    expect(lookupPortableLogicPrimitive('object.entries')?.hostPatterns).toContain('Object.entries(obj)');
    expect(lookupPortableLogicPrimitive('string.trim')?.hostPatterns).toContain('value.trim()');
    expect(lookupPortableLogicPrimitive('string.split')?.hostPatterns).toContain('value.split(separator)');
    expect(lookupPortableLogicPrimitive('string.split')?.hostPatterns).toContain('value.split(separator, limit)');
    expect(lookupPortableLogicPrimitive('string.replaceFirst')?.hostPatterns).toContain(
      'value.replace(search, replacement)',
    );
    expect(lookupPortableLogicPrimitive('string.replaceAll')?.hostPatterns).toContain(
      'value.replaceAll(search, replacement)',
    );
    expect(lookupPortableLogicPrimitive('host.randomThing')).toBeNull();
  });

  test('does not register a named nullish/coalesce primitive', () => {
    // The language already has `??`; this guards against adding a duplicate registry API by accident.
    expect(PORTABLE_LOGIC_PRIMITIVE_IDS.some((id) => id.includes('nullish') || id.includes('coalesce'))).toBe(false);
    expect(lookupPortableLogicPrimitive('logic.nullishCoalesce')).toBeNull();
  });
});
