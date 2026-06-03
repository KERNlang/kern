import {
  lookupPortableLogicPrimitive,
  PORTABLE_LOGIC_PRIMITIVE_IDS,
  portableLogicSupportForTarget,
} from '../src/codegen/portable-logic-primitives.js';

describe('portable logic primitive registry', () => {
  test('registers the Job-central R1 primitive surface explicitly', () => {
    expect(PORTABLE_LOGIC_PRIMITIVE_IDS).toEqual(['collection.has', 'time.epochMs', 'logic.not']);
  });

  test('reports per-target support for the current parity slice', () => {
    expect(portableLogicSupportForTarget('collection.has', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('time.epochMs', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('logic.not', 'python')).toBe('stable');
    expect(portableLogicSupportForTarget('time.epochMs', 'go')).toBe('unsupported');
  });

  test('lookup returns null for unknown primitive ids', () => {
    expect(lookupPortableLogicPrimitive('collection.has')?.purity).toBe('pure');
    expect(lookupPortableLogicPrimitive('host.randomThing')).toBeNull();
  });
});
