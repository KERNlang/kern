import { buildCanonicalKirFactModel } from '../src/kir-preview/facts.js';
import type { KernReviewTargetProfile } from '../src/kir-preview/types.js';

const profile: KernReviewTargetProfile = {
  format: 'kern.review.target-profile.1',
  id: 'test',
  version: 1,
  unsupportedCapabilities: [],
};

function artifact(value: boolean) {
  return {
    modules: [
      {
        id: 'facts.kern',
        exports: [],
        imports: [],
        roots: [
          {
            kind: 'class',
            properties: [{ key: 'name', value: { tag: 'text' as const, value: 'Dashboard' } }],
            children: [
              {
                kind: 'field',
                properties: [
                  { key: 'name', value: { tag: 'text' as const, value: 'route' } },
                  ...(value ? [{ key: 'value', value: { tag: 'text' as const, value: 'private' } }] : []),
                ],
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('KIR preview fact rendering', () => {
  it('preserves structural displays for absent and present value properties', () => {
    const missing = buildCanonicalKirFactModel(artifact(false), profile).facts.find(
      (fact) => fact.facet === 'structure' && fact.key === 'class/Dashboard/route',
    );
    const present = buildCanonicalKirFactModel(artifact(true), profile).facts.find(
      (fact) => fact.facet === 'structure' && fact.key === 'class/Dashboard/route',
    );

    expect(missing?.display).toBe('field:route');
    expect(present?.display).toBe('<canonical:text>');
  });
});
