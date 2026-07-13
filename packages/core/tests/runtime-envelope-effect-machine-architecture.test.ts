import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInternalEffectMachineSequence } from '../src/ir/semantics/internal-effect-machine-sequence.js';
import {
  assertInternalEffectMachineStructureSupported,
  isInternalEffectMachineEligible,
} from '../src/ir/semantics/internal-effect-machine-structure.js';
import { INTERNAL_EFFECT_MACHINE_DISPOSITION } from '../src/ir/semantics/internal-effect-machine-types.js';

const sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../src/ir/semantics');

describe('private effect-machine architecture boundary', () => {
  test('splits the stable driver from structure and sequence internals', () => {
    expect(typeof isInternalEffectMachineEligible).toBe('function');
    expect(typeof assertInternalEffectMachineStructureSupported).toBe('function');
    expect(typeof runInternalEffectMachineSequence).toBe('function');
    expect(INTERNAL_EFFECT_MACHINE_DISPOSITION.try).toBe('legacy');

    const driver = readFileSync(resolve(sourceDirectory, 'internal-effect-machine.ts'), 'utf8');
    expect(driver.trimEnd().split('\n').length).toBeLessThan(300);
  });
});
