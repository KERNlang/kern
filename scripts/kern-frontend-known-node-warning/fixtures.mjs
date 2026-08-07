import { KernRuntime } from '../../packages/core/dist/runtime-state.js';

function membershipFlags(mask) {
  return {
    evolved: Boolean(mask & 1),
    multiline: Boolean(mask & 2),
    template: Boolean(mask & 4),
  };
}

export function knownNodeWarningTruthTableFixtures(policy) {
  const defaultMultilineTypes = new KernRuntime().multilineBlockTypes;
  const builtinType = policy.builtinNodeCatalog.find(
    (name) => !defaultMultilineTypes.has(name),
  );
  if (builtinType === undefined) throw new TypeError('known-node warning fixtures require a non-multiline built-in');
  const fixtures = [];
  for (const builtin of [false, true]) {
    for (let mask = 0; mask < 8; mask += 1) {
      const flags = membershipFlags(mask);
      const type = builtin ? builtinType : 'm4163_unknown_fixture';
      fixtures.push({
        ...flags,
        builtin,
        id: `${builtin ? 'builtin' : 'nonbuiltin'}-${mask.toString(2).padStart(3, '0')}`,
        source: `${type} value=1`,
        type,
      });
    }
  }
  fixtures.push({
    builtin: false,
    evolved: false,
    id: 'dropped',
    multiline: false,
    source: '123 value=1',
    template: false,
    type: '',
  });
  return Object.freeze(fixtures);
}
